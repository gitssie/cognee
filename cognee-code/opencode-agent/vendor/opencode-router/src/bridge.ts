import { setTimeout as delay } from "node:timers/promises";

import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Logger } from "pino";

import type { Config, ChannelName, OpenCodeRouterConfigFile, DirectoryStrategy } from "./config.js";
import { readConfigFile, writeConfigFile, parseDirectoryStrategy } from "./config.js";
import { BridgeStore } from "./db.js";
import { classifyDeliveryError } from "./delivery.js";
import { normalizeEvent } from "./events.js";
import { startHealthServer, type HealthSnapshot } from "./health.js";
import { type InboundMessagePart, type MessageDeliveryResult, type OutboundMessagePart, normalizeOutboundParts, summarizeInboundPartsForPrompt, summarizeInboundPartsForReporter, textFromInboundParts } from "./media.js";
import { MediaStore } from "./media-store.js";
import { buildPermissionRules, createClient } from "./opencode.js";
import { isWithinWorkspaceRootPath, normalizeScopedDirectoryPath } from "./path-scope.js";
import { chunkText, formatInputSummary, truncateText } from "./text.js";
import { getBridgePluginIdentity, loadBridgePluginRegistry } from "./bridge-plugin.js";
import { createSlackAdapter } from "./slack.js";
import { createTelegramAdapter, isTelegramPeerId } from "./telegram.js";

type Adapter = {
  key: string;
  name: ChannelName;
  identityId: string;
  maxTextLength: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage?: (peerId: string, message: { parts: OutboundMessagePart[] }) => Promise<MessageDeliveryResult>;
  sendText(peerId: string, text: string): Promise<void>;
  sendFile?: (peerId: string, filePath: string, caption?: string) => Promise<void>;
  sendTyping?: (peerId: string) => Promise<void>;
};

type AdapterStartResult =
  | { status: "started" }
  | { status: "timeout" }
  | { status: "error"; error: unknown };

async function startAdapterBounded(
  adapter: Adapter,
  options: { timeoutMs: number; onError?: (error: unknown) => void },
): Promise<AdapterStartResult> {
  const outcome = adapter
    .start()
    .then(() => ({ ok: true as const }))
    .catch((error) => ({ ok: false as const, error }));

  if (options.onError) {
    void outcome.then((result) => {
      if (!result.ok) {
        options.onError?.(result.error);
      }
    });
  }

  const winner = await Promise.race([
    outcome.then((result) => ({ kind: "outcome" as const, result })),
    delay(options.timeoutMs).then(() => ({ kind: "timeout" as const })),
  ]);

  if (winner.kind === "timeout") return { status: "timeout" };
  if (winner.result.ok) return { status: "started" };
  return { status: "error", error: winner.result.error };
}

type OutboundKind = "reply" | "system" | "tool";

type BridgeDeps = {
  client?: ReturnType<typeof createClient>;
  clientFactory?: (directory: string) => ReturnType<typeof createClient>;
  store?: BridgeStore;
  adapters?: Map<string, Adapter>;
  disableEventStream?: boolean;
  disableHealthServer?: boolean;
};

export type BridgeReporter = {
  onStatus?: (message: string) => void;
  onInbound?: (message: {
    channel: ChannelName;
    identityId: string;
    peerId: string;
    text: string;
    fromMe?: boolean;
  }) => void;
  onOutbound?: (message: {
    channel: ChannelName;
    identityId: string;
    peerId: string;
    text: string;
    kind: OutboundKind;
  }) => void;
};

type InboundMessage = {
  channel: ChannelName;
  identityId: string;
  peerId: string;
  text: string;
  parts?: InboundMessagePart[];
  raw: unknown;
  fromMe?: boolean;
};

type SendTargetDelivery = {
  identityId: string;
  peerId: string;
  attemptedParts: number;
  sentParts: number;
  partResults: MessageDeliveryResult["partResults"];
};

type ModelRef = {
  providerID: string;
  modelID: string;
};

type RunState = {
  key: string;
  directory: string;
  sessionID: string;
  channel: ChannelName;
  identityId: string;
  adapterKey: string;
  peerId: string;
  peerKey: string;
  toolUpdatesEnabled: boolean;
  seenToolStates: Map<string, string>;
  thinkingLabel?: string;
  thinkingActive?: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  bash: "bash",
  read: "read",
  write: "write",
  edit: "edit",
  patch: "patch",
  multiedit: "edit",
  grep: "grep",
  glob: "glob",
  task: "agent",
  webfetch: "webfetch",
};

function getChannelLabel(channel: string): string {
  return channel;
}

const TYPING_INTERVAL_MS = 6000;

// Model presets for quick switching
const MODEL_PRESETS: Record<string, ModelRef> = {
  opus: { providerID: "anthropic", modelID: "claude-opus-4-5-20251101" },
  codex: { providerID: "openai", modelID: "gpt-5.2-codex" },
};

// Per-user model overrides (channel:peerId -> ModelRef)
const userModelOverrides = new Map<string, ModelRef>();

function getUserModelKey(channel: ChannelName, identityId: string, peerId: string): string {
  return `${channel}:${identityId}:${peerId}`;
}

function getUserModel(channel: ChannelName, identityId: string, peerId: string, defaultModel?: ModelRef): ModelRef | undefined {
  const key = getUserModelKey(channel, identityId, peerId);
  return userModelOverrides.get(key) ?? defaultModel;
}

function setUserModel(channel: ChannelName, identityId: string, peerId: string, model: ModelRef | undefined): void {
  const key = getUserModelKey(channel, identityId, peerId);
  if (model) {
    userModelOverrides.set(key, model);
  } else {
    userModelOverrides.delete(key);
  }
}

function adapterKey(channel: ChannelName, identityId: string): string {
  return `${channel}:${identityId}`;
}

function invalidTelegramPeerIdError(): Error & { status?: number } {
  const error = new Error(
    "Telegram requires a numeric chat_id for direct targets. Usernames like @name cannot be used as peerId.",
  ) as Error & { status?: number };
  error.status = 400;
  return error;
}

const PAIRING_CODE_HASH_PATTERN = /^[a-f0-9]{64}$/;

function normalizeTelegramAccess(value: unknown): "public" | "private" {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "private" ? "private" : "public";
}

function normalizePairingCodeHash(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!PAIRING_CODE_HASH_PATTERN.test(raw)) return "";
  return raw;
}

function normalizePairingCodeValue(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashPairingCode(value: string): string {
  return createHash("sha256").update(normalizePairingCodeValue(value)).digest("hex");
}

function extractPairingCodeFromCommand(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/pair(?:@[A-Za-z0-9_]+)?\s+(.+)$/i);
  if (!match?.[1]) return "";
  return normalizePairingCodeValue(match[1]);
}

function normalizeIdentityId(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "default";
  const safe = trimmed.replace(/[^a-zA-Z0-9_.-]+/g, "-");
  const cleaned = safe.replace(/^-+|-+$/g, "").slice(0, 48);
  return cleaned || "default";
}

// ──────────────────────────────────────────────────────────────────────────────
// Directory provisioning (per-peer strategy)
// ──────────────────────────────────────────────────────────────────────────────

// Built-in workspace template bundled with opencode-router.
const BUILTIN_TEMPLATE_DIR = new URL("../shims/openclaw/workspace-template", import.meta.url).pathname;

/**
 * Given a parsed DirectoryStrategy, a peerId, and the router dataDir (used as
 * the default root for bare "per-peer"), return the resolved absolute directory.
 *
 * For mode="per-peer":
 *  - Creates <root>/<safePeerId>/ on first call.
 *  - Copies built-in template files (non-recursively) unless they already exist.
 *
 * Works for any channel — the caller is responsible for resolving the strategy
 * from whatever identity or global config is appropriate.
 */
async function provisionPeerDirectory(
  strategy: DirectoryStrategy,
  peerId: string,
  dataDir: string,
  logger: Logger,
): Promise<string> {
  if (strategy.mode === "static") {
    return strategy.path;
  }

  const routerRoot = resolve(dataDir, "..");
  const root = strategy.root
    ? resolve(isAbsolute(strategy.root) ? strategy.root : join(routerRoot, strategy.root))
    : join(routerRoot, "workspaces");
  // Sanitize peerId to a safe directory component
  const safePeer = peerId.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "default";
  const peerDir = join(root, safePeer);

  try {
    await mkdir(peerDir, { recursive: true });
  } catch (err) {
    logger.warn({ err, peerDir }, "directory-policy: failed to create peer directory");
    return peerDir;
  }

  // Copy built-in template files — skip files that already exist
  try {
    const entries = await readdir(BUILTIN_TEMPLATE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const src = join(BUILTIN_TEMPLATE_DIR, entry.name);
      const dst = join(peerDir, entry.name);
      try {
        await stat(dst);
        // Already exists — preserve user modifications
      } catch {
        await copyFile(src, dst);
        logger.debug({ dst }, "directory-policy: seeded template file");
      }
    }
  } catch (err) {
    logger.warn({ err, template: BUILTIN_TEMPLATE_DIR }, "directory-policy: failed to seed template files");
  }

  return peerDir;
}

export async function startBridge(config: Config, logger: Logger, reporter?: BridgeReporter, deps: BridgeDeps = {}) {
  const reportStatus = reporter?.onStatus;
  const clients = new Map<string, ReturnType<typeof createClient>>();
  const defaultDirectory = config.opencodeDirectory;
  const defaultDirectoryStrategy = parseDirectoryStrategy(defaultDirectory);
  const routerRoot = resolve(config.dataDir, "..");
  const workspaceRoot = resolve(
    defaultDirectoryStrategy?.mode === "static"
      ? defaultDirectoryStrategy.path
      : defaultDirectoryStrategy?.mode === "per-peer"
        ? (defaultDirectoryStrategy.root
          ? isAbsolute(defaultDirectoryStrategy.root)
            ? defaultDirectoryStrategy.root
            : join(routerRoot, defaultDirectoryStrategy.root)
          : join(routerRoot, "workspaces"))
        : defaultDirectory || process.cwd(),
  );
  const mediaStore = new MediaStore(join(workspaceRoot, ".opencode-router", "media"));
  await mediaStore.ensureReady();

  const pluginInboundHandler = async (message: InboundMessage) => {
    await handleInbound(message);
  };


  const isDangerousRootDirectory = (dir: string) => {
    const normalized = dir.trim();
    if (!normalized) return true;
    if (process.platform !== "win32") {
      return normalized === "/";
    }
    // Windows roots like C:, C:/, C:\
    return /^[a-zA-Z]:\/?$/.test(normalized.replace(/\\/g, "/"));
  };

  const resolveIdentityDirectoryStr = (channel: string, identityId: string): string => {
    const id = identityId.trim();
    if (!id) return "";
    return config.channels.find((c) => c.channel === channel && c.id === id)?.directory?.trim() ?? "";
  };

  const resolveTelegramIdentityAccess = (
    identityId: string,
  ): { access: "public" | "private"; pairingCodeHash: string } => {
    const id = identityId.trim();
    if (!id) {
      return { access: "public", pairingCodeHash: "" };
    }
    const bot = config.telegramBots.find((entry) => entry.id === id);
    if (!bot) {
      return { access: "public", pairingCodeHash: "" };
    }
    const access = normalizeTelegramAccess((bot as any).access);
    const pairingCodeHash = normalizePairingCodeHash((bot as any).pairingCodeHash);
    if (access !== "private") {
      return { access: "public", pairingCodeHash: "" };
    }
    return { access: "private", pairingCodeHash };
  };

  const knownChannels = () =>
    new Set<string>([
      ...Object.keys(config.configFile.channels ?? {}),
      ...config.channels.map((entry) => entry.channel),
      ...config.telegramBots.map(() => "telegram"),
      ...config.slackApps.map(() => "slack"),
      ...Array.from(pluginIdentities.keys()),
      ...Array.from(adapters.values()).map((adapter) => adapter.name),
    ]);

  const normalizeKnownChannel = (value: string): ChannelName => {
    const channel = value.trim().toLowerCase();
    if (!channel || !knownChannels().has(channel)) throw new Error("Invalid channel");
    return channel;
  };

  const listIdentityConfigs = (channel: ChannelName): Array<{ id: string; directory: string }> => {
    return config.channels
      .filter((entry) => entry.channel === channel)
      .map((entry) => ({ id: entry.id, directory: (entry.directory ?? "").trim() }));
  };

  const getClient = (directory?: string | null) => {
    const resolved = (directory ?? "").trim() || defaultDirectory;
    if (deps.client && resolved === defaultDirectory) {
      return deps.client;
    }
    const existing = clients.get(resolved);
    if (existing) return existing;
    const next = deps.clientFactory ? deps.clientFactory(resolved) : createClient(config, resolved);
    clients.set(resolved, next);
    return next;
  };

  const rootClient = getClient(defaultDirectory);
  const store = deps.store ?? new BridgeStore(config.dbPath);
  const pluginHosts = new Map<string, { id: string; name: string; channels: string[]; channelPlugins: unknown[]; toolNames: string[]; routes: Array<{ path: string; auth?: string; match?: string }>; hooks: Array<{ hookName: string }>; pluginConfig: Record<string, unknown> }>();
  const pluginIdentities = new Map<string, Map<string, { id: string; enabled: boolean; directory?: string; fingerprint?: string }>>();
  const pluginLoadResult = await loadBridgePluginRegistry({
    config,
    logger,
    mediaStore,
    handleInbound: pluginInboundHandler,
    adapterKey,
  });

  logger.debug(
    {
      configPath: config.configPath,
      opencodeUrl: config.opencodeUrl,
      opencodeDirectory: config.opencodeDirectory,
      telegramBots: config.telegramBots.map((bot) => ({ id: bot.id, enabled: bot.enabled !== false })),
      slackApps: config.slackApps.map((app) => ({ id: app.id, enabled: app.enabled !== false })),
      groupsEnabled: config.groupsEnabled,
      permissionMode: config.permissionMode,
      toolUpdatesEnabled: config.toolUpdatesEnabled,
      pluginHosts: Array.from(pluginHosts.keys()),
    },
    "bridge config",
  );

  const adapters = deps.adapters ?? new Map<string, Adapter>();
  const usingInjectedAdapters = Boolean(deps.adapters);

  if (!usingInjectedAdapters) {
    const enabledTelegram = config.telegramBots.filter((bot) => bot.enabled !== false);
    if (enabledTelegram.length === 0) {
      logger.info("telegram adapters disabled");
      reportStatus?.("Telegram adapters disabled.");
    }
    for (const bot of enabledTelegram) {
      const key = adapterKey("telegram", bot.id);
      logger.debug({ identityId: bot.id }, "telegram adapter enabled");
      const base = createTelegramAdapter(bot, config, logger, handleInbound, mediaStore);
      adapters.set(key, { ...base, key });
    }

    const enabledSlack = config.slackApps.filter((app) => app.enabled !== false);
    if (enabledSlack.length === 0) {
      logger.info("slack adapters disabled");
      reportStatus?.("Slack adapters disabled.");
    }
    for (const app of enabledSlack) {
      const key = adapterKey("slack", app.id);
      logger.debug({ identityId: app.id }, "slack adapter enabled");
      const base = createSlackAdapter(app, config, logger, handleInbound, undefined, mediaStore);
      adapters.set(key, { ...base, key });
    }

    if (config.channels.every((account) => account.enabled === false)) {
      logger.info("channel adapters disabled");
      reportStatus?.("Channel adapters disabled.");
    }
    for (const [name, host] of pluginLoadResult.hosts.entries()) {
      pluginHosts.set(name, host);
      logger.info(
        {
          pluginId: host.id,
          channels: host.channels,
          tools: host.toolNames,
          routeCount: host.routes.length,
          hookCount: host.hooks.length,
        },
        `${name} plugin host ready`,
      );
    }
      for (const [channel, identities] of pluginLoadResult.identities.entries()) {
        pluginIdentities.set(channel, identities);
      }
    for (const adapter of pluginLoadResult.adapters) {
      logger.debug({ identityId: adapter.identityId, channel: adapter.name }, "plugin adapter enabled");
      adapters.set(adapter.key, adapter);
    }
  }

  const keyForSession = (directory: string, sessionID: string) => `${directory}::${sessionID}`;

  const sessionQueue = new Map<string, Promise<void>>();
  const activeRuns = new Map<string, RunState>();
  const sessionModels = new Map<string, ModelRef>();
  const typingLoops = new Map<string, NodeJS.Timeout>();

  const formatPeer = (_channel: ChannelName, peerId: string) => peerId;

  const normalizeDirectory = (input: string) =>
    normalizeScopedDirectoryPath(input, process.platform);

  const workspaceRootNormalized = normalizeDirectory(workspaceRoot);

  const isWithinWorkspaceRoot = (candidate: string) => {
    return isWithinWorkspaceRootPath({
      workspaceRoot,
      candidate,
      platform: process.platform,
    });
  };

  const resolveScopedDirectory = (input: string): { ok: true; directory: string } | { ok: false; error: string } => {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, error: "Directory is required." };
    const resolved = resolve(isAbsolute(trimmed) ? trimmed : join(workspaceRoot, trimmed));
    if (!isWithinWorkspaceRoot(resolved)) {
      return {
        ok: false,
        error: `Directory must stay within workspace root: ${workspaceRootNormalized}`,
      };
    }
    return { ok: true, directory: normalizeDirectory(resolved) };
  };

  const formatModelLabel = (model?: ModelRef) =>
    model ? `${model.providerID}/${model.modelID}` : null;

  const extractModelRef = (info: unknown): ModelRef | null => {
    if (!info || typeof info !== "object") return null;
    const record = info as { role?: unknown; model?: unknown };
    if (record.role !== "user") return null;
    if (!record.model || typeof record.model !== "object") return null;
    const model = record.model as { providerID?: unknown; modelID?: unknown };
    if (typeof model.providerID !== "string" || typeof model.modelID !== "string") return null;
    return { providerID: model.providerID, modelID: model.modelID };
  };

  const reportThinking = (run: RunState) => {
    if (!reportStatus) return;
    const modelLabel = formatModelLabel(sessionModels.get(run.key));
    const nextLabel = modelLabel ? `Thinking (${modelLabel})` : "Thinking...";
    if (run.thinkingLabel === nextLabel && run.thinkingActive) return;
    run.thinkingLabel = nextLabel;
    run.thinkingActive = true;
    reportStatus(
      `[${getChannelLabel(run.channel)}/${run.identityId}] ${formatPeer(run.channel, run.peerId)} ${nextLabel}`,
    );
  };

  const reportDone = (run: RunState) => {
    if (!reportStatus || !run.thinkingActive) return;
    const modelLabel = formatModelLabel(sessionModels.get(run.key));
    const suffix = modelLabel ? ` (${modelLabel})` : "";
    reportStatus(`[${getChannelLabel(run.channel)}/${run.identityId}] ${formatPeer(run.channel, run.peerId)} Done${suffix}`);
    run.thinkingActive = false;
  };

  const startTyping = (run: RunState) => {
    const adapter = adapters.get(run.adapterKey);
    if (!adapter?.sendTyping) return;
    if (typingLoops.has(run.key)) return;
    const sendTyping = async () => {
      try {
        await adapter.sendTyping?.(run.peerId);
      } catch (error) {
        logger.warn({ error, channel: run.channel, identityId: run.identityId }, "typing update failed");
      }
    };
    void sendTyping();
    const timer = setInterval(sendTyping, TYPING_INTERVAL_MS);
    typingLoops.set(run.key, timer);
  };

  const stopTyping = (key: string) => {
    const timer = typingLoops.get(key);
    if (!timer) return;
    clearInterval(timer);
    typingLoops.delete(key);
  };

  let opencodeHealthy = false;
  let opencodeVersion: string | undefined;

  const HEALTH_SLOW_INTERVAL_MS = 30_000;
  const HEALTH_FAST_INTERVAL_MS = 1_000;
  let healthIntervalMs = HEALTH_FAST_INTERVAL_MS;
  let healthTimer: NodeJS.Timeout | null = null;

  async function refreshHealth() {
    try {
      const health = await rootClient.global.health();
      opencodeHealthy = Boolean((health as { healthy?: boolean }).healthy);
      opencodeVersion = (health as { version?: string }).version;
    } catch (error) {
      logger.warn({ error }, "failed to reach opencode health");
      opencodeHealthy = false;
    }

    // After initial startup, switch to a slower poll once OpenCode is healthy.
    if (opencodeHealthy && healthIntervalMs !== HEALTH_SLOW_INTERVAL_MS) {
      healthIntervalMs = HEALTH_SLOW_INTERVAL_MS;
      if (healthTimer) {
        clearInterval(healthTimer);
      }
      healthTimer = setInterval(refreshHealth, healthIntervalMs);
    }
  }

  await refreshHealth();
  healthTimer = setInterval(refreshHealth, healthIntervalMs);

  // Mutable runtime state for groups (persisted to config file)
  let groupsEnabled = config.groupsEnabled;

  const startOfToday = (now: number) => {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };

  let activityDayStart = startOfToday(Date.now());
  let inboundToday = 0;
  let outboundToday = 0;
  let lastInboundAt: number | undefined;
  let lastOutboundAt: number | undefined;

  const ensureActivityDay = (now: number) => {
    const nextDayStart = startOfToday(now);
    if (nextDayStart === activityDayStart) return;
    activityDayStart = nextDayStart;
    inboundToday = 0;
    outboundToday = 0;
  };

  const recordInboundActivity = (now: number) => {
    ensureActivityDay(now);
    inboundToday += 1;
    lastInboundAt = now;
  };

  const recordOutboundActivity = (now: number) => {
    ensureActivityDay(now);
    outboundToday += 1;
    lastOutboundAt = now;
  };

  const outboundMediaMaxBytesRaw = Number.parseInt(process.env.OPENCODE_ROUTER_MAX_MEDIA_BYTES ?? "", 10);
  const outboundMediaMaxBytes =
    Number.isFinite(outboundMediaMaxBytesRaw) && outboundMediaMaxBytesRaw > 0
      ? outboundMediaMaxBytesRaw
      : 50 * 1024 * 1024;

  const resolveOutboundParts = async (
    baseDirectory: string,
    input: { text?: string; parts?: unknown },
  ): Promise<OutboundMessagePart[]> => {
    const normalized = normalizeOutboundParts(input);
    if (normalized.length === 0) {
      const error = new Error("text or parts is required") as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    const resolved: OutboundMessagePart[] = [];
    for (const part of normalized) {
      if (part.type === "text") {
        resolved.push(part);
        continue;
      }

      const file = await mediaStore.resolveOutboundFile({
        filePath: part.filePath,
        baseDirectory,
        maxBytes: outboundMediaMaxBytes,
      });
      resolved.push({
        ...part,
        filePath: file.filePath,
        ...(part.filename ? {} : { filename: file.filename }),
      });
    }

    return resolved;
  };

  const deliverParts = async (
    channel: ChannelName,
    identityId: string,
    peerId: string,
    parts: OutboundMessagePart[],
    options: { kind?: OutboundKind; display?: boolean } = {},
  ): Promise<MessageDeliveryResult> => {
    const adapter = adapters.get(adapterKey(channel, identityId));
    if (!adapter) {
      return {
        attemptedParts: parts.length,
        sentParts: 0,
        partResults: parts.map((part, index) => ({
          index,
          type: part.type,
          sent: false,
          error: "Adapter not running",
          code: "not_found",
          retryable: false,
        })),
      };
    }

    const kind = options.kind ?? "system";
    if (options.display !== false) {
      for (const part of parts) {
        const preview =
          part.type === "text"
            ? truncateText(part.text, 240)
            : `[${part.type}] ${part.filename || part.filePath}`;
        reporter?.onOutbound?.({ channel, identityId, peerId, text: preview, kind });
      }
    }

    recordOutboundActivity(Date.now());

    if (adapter.sendMessage) {
      try {
        return await adapter.sendMessage(peerId, { parts });
      } catch (error) {
        const classified = classifyDeliveryError(error);
        return {
          attemptedParts: parts.length,
          sentParts: 0,
          partResults: parts.map((part, index) => ({
            index,
            type: part.type,
            sent: false,
            error: classified.message,
            code: classified.code,
            retryable: classified.retryable,
          })),
        };
      }
    }

    const partResults: MessageDeliveryResult["partResults"] = [];
    let sentParts = 0;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      try {
        if (part.type === "text") {
          const chunks = chunkText(part.text, adapter.maxTextLength);
          for (const chunk of chunks) {
            await adapter.sendText(peerId, chunk);
          }
        } else if (adapter.sendFile) {
          await adapter.sendFile(peerId, part.filePath, part.caption);
        } else {
          throw new Error(`Adapter does not support ${part.type} media`);
        }

        sentParts += 1;
        partResults.push({ index, type: part.type, sent: true });
      } catch (error) {
        const classified = classifyDeliveryError(error);
        partResults.push({
          index,
          type: part.type,
          sent: false,
          error: classified.message,
          code: classified.code,
          retryable: classified.retryable,
        });
      }
    }

    return {
      attemptedParts: parts.length,
      sentParts,
      partResults,
    };
  };

  let stopHealthServer: (() => void) | null = null;
  if (!deps.disableHealthServer && config.healthPort) {
    stopHealthServer = await startHealthServer(
      config.healthPort,
      (): HealthSnapshot => ({
        ok: opencodeHealthy,
        opencode: {
          url: config.opencodeUrl,
          healthy: opencodeHealthy,
          version: opencodeVersion,
        },
        channels: {
          ...Object.fromEntries(
            Array.from(knownChannels()).map((channel) => [
              channel,
              pluginHosts.has(channel) ||
                Array.from(adapters.keys()).some((key) => key.startsWith(`${channel}:`)) ||
                config.channels.some((identity) => identity.channel === channel && identity.enabled !== false),
            ]),
          ),
          // WhatsApp removed; keep field for backward compatibility.
          whatsapp: false,
        },
        config: {
          groupsEnabled,
        },
        activity: {
          dayStart: activityDayStart,
          inboundToday,
          outboundToday,
          ...(typeof lastInboundAt === "number" ? { lastInboundAt } : {}),
          ...(typeof lastOutboundAt === "number" ? { lastOutboundAt } : {}),
          ...(typeof lastInboundAt === "number" || typeof lastOutboundAt === "number"
            ? { lastMessageAt: Math.max(lastInboundAt ?? 0, lastOutboundAt ?? 0) }
            : {}),
        },
      }),
      logger,
      {
        getGroupsEnabled: () => groupsEnabled,
        extraRequestHandlers: [
          ...pluginLoadResult.extraRequestHandlers,
          ...pluginLoadResult.pluginRouteHandlers
            .filter((r) => typeof r.handler === "function")
            .map((r) => {
              const handler = r.handler as (req: any, res: any) => Promise<void> | void;
              const routePath = r.path;
              const matchMode = r.match ?? "exact";
              return async (req: any, res: any, pathname: string): Promise<boolean> => {
                const matches =
                  matchMode === "prefix" ? pathname === routePath || pathname.startsWith(`${routePath}/`) || pathname.startsWith(`${routePath}?`) : pathname === routePath;
                if (!matches) return false;
                await handler(req, res);
                return true;
              };
            }),
        ],
        setGroupsEnabled: async (enabled: boolean) => {
          groupsEnabled = enabled;
          // Also update config so adapters see the change
          (config as any).groupsEnabled = enabled;
          
          // Persist to config file
          const { config: current } = readConfigFile(config.configPath);
          const next: OpenCodeRouterConfigFile = {
            ...current,
            groupsEnabled: enabled,
          };
          next.version = next.version ?? 1;
          writeConfigFile(config.configPath, next);
          config.configFile = next;
          
          logger.info({ groupsEnabled: enabled }, "groups config updated");
          return { groupsEnabled: enabled };
        },

        listTelegramIdentities: async () => {
          return {
            items: config.telegramBots.map((bot) => ({
              id: bot.id,
              enabled: bot.enabled !== false,
              running: adapters.has(adapterKey("telegram", bot.id)),
              access: normalizeTelegramAccess((bot as any).access),
              pairingRequired: normalizeTelegramAccess((bot as any).access) === "private",
            })),
          };
        },
        upsertTelegramIdentity: async (input: {
          id?: string;
          token: string;
          enabled?: boolean;
          directory?: string;
          access?: "public" | "private";
          pairingCodeHash?: string;
        }) => {
          const token = input.token?.trim() ?? "";
          if (!token) throw new Error("token is required");
          const id = normalizeIdentityId(input.id);
          if (id === "env") throw new Error("identity id 'env' is reserved");
          const enabled = input.enabled !== false;
          const directoryInput = typeof input.directory === "string" ? input.directory.trim() : "";
          const requestedAccess =
            typeof input.access === "string" && input.access.trim() ? normalizeTelegramAccess(input.access) : undefined;
          const requestedPairingCodeHash = normalizePairingCodeHash(input.pairingCodeHash);

          // Persist to config file.
          const { config: current } = readConfigFile(config.configPath);
          const telegram = current.channels?.telegram;
          const bots = Array.isArray((telegram as any)?.bots) ? (((telegram as any).bots as unknown[]) ?? []) : [];
          const nextBots: any[] = [];
          let found = false;
          for (const entry of bots) {
            if (!entry || typeof entry !== "object") continue;
            const record = entry as Record<string, unknown>;
            const entryId = normalizeIdentityId(typeof record.id === "string" ? record.id : "default");
            if (entryId !== id) {
              nextBots.push(entry);
              continue;
            }
            found = true;
            const existingDirectory = typeof record.directory === "string" ? record.directory.trim() : "";
            const directory = directoryInput || existingDirectory;
            const existingAccess = normalizeTelegramAccess(record.access);
            const existingPairingCodeHash = normalizePairingCodeHash(record.pairingCodeHash);
            const access = requestedAccess ?? existingAccess;
            const pairingCodeHash = access === "private" ? requestedPairingCodeHash || existingPairingCodeHash : "";
            if (access === "private" && !pairingCodeHash) {
              throw new Error("pairingCodeHash is required when Telegram access is private");
            }
            nextBots.push({
              id,
              token,
              enabled,
              ...(directory ? { directory } : {}),
              access,
              ...(access === "private" ? { pairingCodeHash } : {}),
            });
          }
          if (!found) {
            const access = requestedAccess ?? "public";
            const pairingCodeHash = access === "private" ? requestedPairingCodeHash : "";
            if (access === "private" && !pairingCodeHash) {
              throw new Error("pairingCodeHash is required when Telegram access is private");
            }
            nextBots.push({
              id,
              token,
              enabled,
              ...(directoryInput ? { directory: directoryInput } : {}),
              access,
              ...(access === "private" ? { pairingCodeHash } : {}),
            });
          }

          const next: OpenCodeRouterConfigFile = {
            ...current,
            channels: {
              ...current.channels,
              telegram: {
                ...(current.channels?.telegram ?? {}),
                enabled: true,
                bots: nextBots,
              },
            },
          };
          next.version = next.version ?? 1;
          writeConfigFile(config.configPath, next);
          config.configFile = next;

          // Update runtime identity list.
          const existingIdx = config.telegramBots.findIndex((bot) => bot.id === id);
          let runtimeAccess: "public" | "private" = requestedAccess ?? "public";
          let runtimePairingCodeHash = requestedPairingCodeHash;
          if (existingIdx >= 0) {
            const prev = config.telegramBots[existingIdx];
            const nextDirectory = directoryInput || (prev as any)?.directory || undefined;
            const prevAccess = normalizeTelegramAccess((prev as any)?.access);
            const prevPairingCodeHash = normalizePairingCodeHash((prev as any)?.pairingCodeHash);
            runtimeAccess = requestedAccess ?? prevAccess;
            runtimePairingCodeHash = runtimeAccess === "private" ? requestedPairingCodeHash || prevPairingCodeHash : "";
            if (runtimeAccess === "private" && !runtimePairingCodeHash) {
              throw new Error("pairingCodeHash is required when Telegram access is private");
            }
            config.telegramBots[existingIdx] = {
              id,
              token,
              enabled,
              ...(nextDirectory ? { directory: String(nextDirectory).trim() } : {}),
              access: runtimeAccess,
              ...(runtimeAccess === "private" ? { pairingCodeHash: runtimePairingCodeHash } : {}),
            };
          } else {
            runtimeAccess = requestedAccess ?? "public";
            runtimePairingCodeHash = runtimeAccess === "private" ? requestedPairingCodeHash : "";
            if (runtimeAccess === "private" && !runtimePairingCodeHash) {
              throw new Error("pairingCodeHash is required when Telegram access is private");
            }
            config.telegramBots.push({
              id,
              token,
              enabled,
              ...(directoryInput ? { directory: directoryInput } : {}),
              access: runtimeAccess,
              ...(runtimeAccess === "private" ? { pairingCodeHash: runtimePairingCodeHash } : {}),
            });
          }

          // Start/stop adapter.
          const key = adapterKey("telegram", id);
          const existing = adapters.get(key);
          if (!enabled) {
            if (existing) {
              try {
                await existing.stop();
              } catch (error) {
                logger.warn({ error, channel: "telegram", identityId: id }, "failed to stop telegram adapter");
              }
              adapters.delete(key);
            }
            return {
              id,
              enabled: false,
              access: runtimeAccess,
              pairingRequired: runtimeAccess === "private",
              applied: true,
            };
          }

          if (existing) {
            try {
              await existing.stop();
            } catch (error) {
              logger.warn({ error, channel: "telegram", identityId: id }, "failed to stop existing telegram adapter");
            }
            adapters.delete(key);
          }
          const base = createTelegramAdapter(
            {
              id,
              token,
              enabled,
              ...(directoryInput ? { directory: directoryInput } : {}),
              access: runtimeAccess,
              ...(runtimeAccess === "private" && runtimePairingCodeHash
                ? { pairingCodeHash: runtimePairingCodeHash }
                : {}),
            },
            config,
            logger,
            handleInbound,
            mediaStore,
          );
          const adapter = { ...base, key };
          adapters.set(key, adapter);

          const startResult = await startAdapterBounded(adapter, {
            timeoutMs: 2_500,
            onError: (error) => {
              logger.error({ error, channel: "telegram", identityId: id }, "telegram adapter start failed");
              adapters.delete(key);
            },
          });

          if (startResult.status === "timeout") {
            return {
              id,
              enabled: true,
              access: runtimeAccess,
              pairingRequired: runtimeAccess === "private",
              applied: false,
              starting: true,
            };
          }
          if (startResult.status === "error") {
            return {
              id,
              enabled: true,
              access: runtimeAccess,
              pairingRequired: runtimeAccess === "private",
              applied: false,
              error: String(startResult.error),
            };
          }
          return {
            id,
            enabled: true,
            access: runtimeAccess,
            pairingRequired: runtimeAccess === "private",
            applied: true,
          };
        },
        deleteTelegramIdentity: async (rawId: string) => {
          const id = normalizeIdentityId(rawId);
          if (id === "env") throw new Error("env identity cannot be deleted");

          const { config: current } = readConfigFile(config.configPath);
          const telegram = current.channels?.telegram;
          const bots = Array.isArray((telegram as any)?.bots) ? (((telegram as any).bots as unknown[]) ?? []) : [];
          const nextBots: any[] = [];
          let deleted = false;
          for (const entry of bots) {
            if (!entry || typeof entry !== "object") continue;
            const record = entry as Record<string, unknown>;
            const entryId = normalizeIdentityId(typeof record.id === "string" ? record.id : "default");
            if (entryId === id) {
              deleted = true;
              continue;
            }
            nextBots.push(entry);
          }
          const next: OpenCodeRouterConfigFile = {
            ...current,
            channels: {
              ...current.channels,
              telegram: {
                ...(current.channels?.telegram ?? {}),
                bots: nextBots,
              },
            },
          };
          next.version = next.version ?? 1;
          writeConfigFile(config.configPath, next);
          config.configFile = next;

          config.telegramBots.splice(
            0,
            config.telegramBots.length,
            ...config.telegramBots.filter((bot) => bot.id !== id),
          );

          const key = adapterKey("telegram", id);
          const existing = adapters.get(key);
          if (existing) {
            try {
              await existing.stop();
            } catch (error) {
              logger.warn({ error, channel: "telegram", identityId: id }, "failed to stop telegram adapter");
            }
            adapters.delete(key);
          }
          return { id, deleted };
        },

        listSlackIdentities: async () => {
          return {
            items: config.slackApps.map((app) => ({
              id: app.id,
              enabled: app.enabled !== false,
              running: adapters.has(adapterKey("slack", app.id)),
            })),
          };
        },
        upsertSlackIdentity: async (input: { id?: string; botToken: string; appToken: string; enabled?: boolean; directory?: string }) => {
          const botToken = input.botToken?.trim() ?? "";
          const appToken = input.appToken?.trim() ?? "";
          if (!botToken || !appToken) throw new Error("botToken and appToken are required");
          const id = normalizeIdentityId(input.id);
          if (id === "env") throw new Error("identity id 'env' is reserved");
          const enabled = input.enabled !== false;
          const directoryInput = typeof input.directory === "string" ? input.directory.trim() : "";

          const { config: current } = readConfigFile(config.configPath);
          const slack = current.channels?.slack;
          const apps = Array.isArray((slack as any)?.apps) ? (((slack as any).apps as unknown[]) ?? []) : [];
          const nextApps: any[] = [];
          let found = false;
          for (const entry of apps) {
            if (!entry || typeof entry !== "object") continue;
            const record = entry as Record<string, unknown>;
            const entryId = normalizeIdentityId(typeof record.id === "string" ? record.id : "default");
            if (entryId !== id) {
              nextApps.push(entry);
              continue;
            }
            found = true;
            const existingDirectory = typeof record.directory === "string" ? record.directory.trim() : "";
            const directory = directoryInput || existingDirectory;
            nextApps.push({ id, botToken, appToken, enabled, ...(directory ? { directory } : {}) });
          }
          if (!found) {
            nextApps.push({ id, botToken, appToken, enabled, ...(directoryInput ? { directory: directoryInput } : {}) });
          }

          const next: OpenCodeRouterConfigFile = {
            ...current,
            channels: {
              ...current.channels,
              slack: {
                ...(current.channels?.slack ?? {}),
                enabled: true,
                apps: nextApps,
              },
            },
          };
          next.version = next.version ?? 1;
          writeConfigFile(config.configPath, next);
          config.configFile = next;

          const existingIdx = config.slackApps.findIndex((app) => app.id === id);
          if (existingIdx >= 0) {
            const prev = config.slackApps[existingIdx];
            const nextDirectory = directoryInput || (prev as any)?.directory || undefined;
            config.slackApps[existingIdx] = {
              id,
              botToken,
              appToken,
              enabled,
              ...(nextDirectory ? { directory: String(nextDirectory).trim() } : {}),
            };
          } else {
            config.slackApps.push({ id, botToken, appToken, enabled, ...(directoryInput ? { directory: directoryInput } : {}) });
          }

          const key = adapterKey("slack", id);
          const existing = adapters.get(key);
          if (!enabled) {
            if (existing) {
              try {
                await existing.stop();
              } catch (error) {
                logger.warn({ error, channel: "slack", identityId: id }, "failed to stop slack adapter");
              }
              adapters.delete(key);
            }
            return { id, enabled: false, applied: true };
          }

          if (existing) {
            try {
              await existing.stop();
            } catch (error) {
              logger.warn({ error, channel: "slack", identityId: id }, "failed to stop existing slack adapter");
            }
            adapters.delete(key);
          }
          const base = createSlackAdapter(
            { id, botToken, appToken, enabled, ...(directoryInput ? { directory: directoryInput } : {}) },
            config,
            logger,
            handleInbound,
            undefined,
            mediaStore,
          );
          const adapter = { ...base, key };
          adapters.set(key, adapter);

          const startResult = await startAdapterBounded(adapter, {
            timeoutMs: 2_500,
            onError: (error) => {
              logger.error({ error, channel: "slack", identityId: id }, "slack adapter start failed");
              adapters.delete(key);
            },
          });

          if (startResult.status === "timeout") {
            return { id, enabled: true, applied: false, starting: true };
          }
          if (startResult.status === "error") {
            return { id, enabled: true, applied: false, error: String(startResult.error) };
          }
          return { id, enabled: true, applied: true };
        },
        deleteSlackIdentity: async (rawId: string) => {
          const id = normalizeIdentityId(rawId);
          if (id === "env") throw new Error("env identity cannot be deleted");

          const { config: current } = readConfigFile(config.configPath);
          const slack = current.channels?.slack;
          const apps = Array.isArray((slack as any)?.apps) ? (((slack as any).apps as unknown[]) ?? []) : [];
          const nextApps: any[] = [];
          let deleted = false;
          for (const entry of apps) {
            if (!entry || typeof entry !== "object") continue;
            const record = entry as Record<string, unknown>;
            const entryId = normalizeIdentityId(typeof record.id === "string" ? record.id : "default");
            if (entryId === id) {
              deleted = true;
              continue;
            }
            nextApps.push(entry);
          }
          const next: OpenCodeRouterConfigFile = {
            ...current,
            channels: {
              ...current.channels,
              slack: {
                ...(current.channels?.slack ?? {}),
                apps: nextApps,
              },
            },
          };
          next.version = next.version ?? 1;
          writeConfigFile(config.configPath, next);
          config.configFile = next;

          config.slackApps.splice(0, config.slackApps.length, ...config.slackApps.filter((app) => app.id !== id));

          const key = adapterKey("slack", id);
          const existing = adapters.get(key);
          if (existing) {
            try {
              await existing.stop();
            } catch (error) {
              logger.warn({ error, channel: "slack", identityId: id }, "failed to stop slack adapter");
            }
            adapters.delete(key);
          }
          return { id, deleted };
        },

        listBindings: async (filters?: { channel?: string; identityId?: string }) => {
          const channelRaw = filters?.channel?.trim().toLowerCase();
          const identityIdRaw = filters?.identityId?.trim();
          let channel: ChannelName | undefined;
          if (channelRaw) channel = normalizeKnownChannel(channelRaw);
          const identityId = identityIdRaw ? normalizeIdentityId(identityIdRaw) : undefined;
          const bindings = store.listBindings({ ...(channel ? { channel } : {}), ...(identityId ? { identityId } : {}) });
          return {
            items: bindings.map((entry) => ({
              channel: entry.channel,
              identityId: entry.identity_id,
              peerId: entry.peer_id,
              directory: entry.directory,
              updatedAt: entry.updated_at,
            })),
          };
        },
        setBinding: async (input: { channel: string; identityId?: string; peerId: string; directory: string }) => {
          const channel = normalizeKnownChannel(input.channel);
          const identityId = normalizeIdentityId(input.identityId);
          const peerKey = input.peerId.trim();
          const directory = input.directory.trim();
          if (!peerKey || !directory) {
            throw new Error("peerId and directory are required");
          }
          if (channel === "telegram" && !isTelegramPeerId(peerKey)) {
            throw invalidTelegramPeerIdError();
          }
          const scoped = resolveScopedDirectory(directory);
          if (!scoped.ok) {
            const error = new Error(scoped.error) as Error & { status?: number };
            error.status = 400;
            throw error;
          }
          const normalizedDir = scoped.directory;
          store.upsertBinding(channel, identityId, peerKey, normalizedDir);
          store.deleteSession(channel, identityId, peerKey);
          ensureEventSubscription(normalizedDir);
        },
        clearBinding: async (input: { channel: string; identityId?: string; peerId: string }) => {
          const channel = normalizeKnownChannel(input.channel);
          const identityId = normalizeIdentityId(input.identityId);
          const peerKey = input.peerId.trim();
          if (!peerKey) {
            throw new Error("peerId is required");
          }
          store.deleteBinding(channel, identityId, peerKey);
          store.deleteSession(channel, identityId, peerKey);
        },

        sendMessage: async (input: {
          channel: string;
          identityId?: string;
          directory?: string;
          peerId?: string;
          text?: string;
          parts?: OutboundMessagePart[];
          autoBind?: boolean;
        }) => {
          const channel = normalizeKnownChannel(input.channel);
          const identityId = input.identityId?.trim() ? normalizeIdentityId(input.identityId) : undefined;
          const directoryInput = (input.directory ?? "").trim();
          const peerId = (input.peerId ?? "").trim();
          const autoBind = input.autoBind === true;

          if (!directoryInput && !peerId) {
            throw new Error("directory or peerId is required");
          }
          if (channel === "telegram" && peerId && !isTelegramPeerId(peerId)) {
            throw invalidTelegramPeerIdError();
          }

          const normalizedDir = directoryInput ? (() => {
            const scoped = resolveScopedDirectory(directoryInput);
            if (!scoped.ok) {
              const error = new Error(scoped.error) as Error & { status?: number };
              error.status = 400;
              throw error;
            }
            return scoped.directory;
          })() : "";

          const baseDirectory = normalizedDir || workspaceRoot;
          const outboundParts = await resolveOutboundParts(baseDirectory, {
            text: input.text,
            parts: input.parts,
          });

          const makeTargetError = (
            targetIdentityId: string,
            targetPeerId: string,
            errorMessage: string,
            errorCode = "not_found",
          ): SendTargetDelivery => ({
            identityId: targetIdentityId,
            peerId: targetPeerId,
            attemptedParts: outboundParts.length,
            sentParts: 0,
            partResults: outboundParts.map((part, index) => ({
              index,
              type: part.type,
              sent: false,
              error: errorMessage,
              code: errorCode,
              retryable: false,
            })),
          });

          const deliveryFailed = (delivery: MessageDeliveryResult) =>
            delivery.attemptedParts > 0 && delivery.sentParts < delivery.attemptedParts;

          const primaryFailureMessage = (delivery: MessageDeliveryResult) =>
            delivery.partResults.find((part) => !part.sent)?.error || "Delivery failed";

          const resolveSendIdentityId = () => {
            if (identityId) return identityId;
            if (normalizedDir) {
              const configured = listIdentityConfigs(channel).find((entry) => {
                if (!entry.directory) return false;
                if (!adapters.has(adapterKey(channel, entry.id))) return false;
                return normalizeDirectory(entry.directory) === normalizedDir;
              });
              if (configured?.id) return configured.id;
            }
            const active = Array.from(adapters.values()).find((adapter) => adapter.name === channel);
            return active?.identityId;
          };

          const targetIdentityId = resolveSendIdentityId();
          if (peerId && !targetIdentityId) {
            return {
              channel,
              directory: normalizedDir || workspaceRootNormalized,
              peerId,
              attempted: 0,
              sent: 0,
              reason: `No ${channel} adapter is running for direct send`,
              targets: [],
            };
          }

          if (peerId && targetIdentityId) {
            const adapter = adapters.get(adapterKey(channel, targetIdentityId));
            if (!adapter) {
              const target = makeTargetError(targetIdentityId, peerId, "Adapter not running");
              return {
                channel,
                directory: normalizedDir || workspaceRootNormalized,
                identityId: targetIdentityId,
                peerId,
                attempted: 1,
                sent: 0,
                failures: [{ identityId: targetIdentityId, peerId, error: "Adapter not running" }],
                targets: [target],
              };
            }

            if (autoBind && normalizedDir) {
              store.upsertBinding(channel, targetIdentityId, peerId, normalizedDir);
              store.deleteSession(channel, targetIdentityId, peerId);
              ensureEventSubscription(normalizedDir);
            }

            const delivery = await deliverParts(channel, targetIdentityId, peerId, outboundParts, {
              kind: "system",
              display: false,
            });
            const failed = deliveryFailed(delivery);
            return {
              channel,
              directory: normalizedDir || workspaceRootNormalized,
              identityId: targetIdentityId,
              peerId,
              attempted: 1,
              sent: failed ? 0 : 1,
              ...(failed
                ? {
                    failures: [
                      {
                        identityId: targetIdentityId,
                        peerId,
                        error: primaryFailureMessage(delivery),
                      },
                    ],
                  }
                : {}),
              targets: [
                {
                  identityId: targetIdentityId,
                  peerId,
                  attemptedParts: delivery.attemptedParts,
                  sentParts: delivery.sentParts,
                  partResults: delivery.partResults,
                },
              ],
            };
          }

          const bindings = store.listBindings({
            channel,
            ...(identityId ? { identityId } : {}),
            directory: normalizedDir,
          });
          if (bindings.length === 0) {
            return {
              channel,
              directory: normalizedDir,
              ...(identityId ? { identityId } : {}),
              attempted: 0,
              sent: 0,
              reason: `No bound conversations for ${channel}${identityId ? `/${identityId}` : ""} at directory ${normalizedDir}`,
              targets: [],
            };
          }

          const failures: Array<{ identityId: string; peerId: string; error: string }> = [];
          const targets: SendTargetDelivery[] = [];
          let attempted = 0;
          let sent = 0;
          for (const binding of bindings) {
            attempted += 1;
            if (channel === "telegram" && !isTelegramPeerId(binding.peer_id)) {
              store.deleteBinding(channel, binding.identity_id, binding.peer_id);
              store.deleteSession(channel, binding.identity_id, binding.peer_id);
              const target = makeTargetError(
                binding.identity_id,
                binding.peer_id,
                "Invalid Telegram peerId binding removed (expected numeric chat_id)",
                "invalid_target",
              );
              targets.push(target);
              failures.push({
                identityId: binding.identity_id,
                peerId: binding.peer_id,
                error: "Invalid Telegram peerId binding removed (expected numeric chat_id)",
              });
              continue;
            }
            if (pluginIdentities.has(channel)) {
              const configured = getBridgePluginIdentity(pluginIdentities, channel, binding.identity_id);
              if (!configured) {
                const target = makeTargetError(binding.identity_id, binding.peer_id, `${channel} identity not configured`);
                targets.push(target);
                failures.push({
                  identityId: binding.identity_id,
                  peerId: binding.peer_id,
                  error: `${channel} identity not configured`,
                });
                continue;
              }
            }
            const adapter = adapters.get(adapterKey(channel, binding.identity_id));
            if (!adapter) {
              const target = makeTargetError(binding.identity_id, binding.peer_id, "Adapter not running");
              targets.push(target);
              failures.push({
                identityId: binding.identity_id,
                peerId: binding.peer_id,
                error: "Adapter not running",
              });
              continue;
            }
            const delivery = await deliverParts(channel, binding.identity_id, binding.peer_id, outboundParts, {
              kind: "system",
              display: false,
            });
            targets.push({
              identityId: binding.identity_id,
              peerId: binding.peer_id,
              attemptedParts: delivery.attemptedParts,
              sentParts: delivery.sentParts,
              partResults: delivery.partResults,
            });
            if (deliveryFailed(delivery)) {
              failures.push({
                identityId: binding.identity_id,
                peerId: binding.peer_id,
                error: primaryFailureMessage(delivery),
              });
            } else {
              sent += 1;
            }
          }

          return {
            channel,
            directory: normalizedDir,
            ...(identityId ? { identityId } : {}),
            attempted,
            sent,
            ...(failures.length ? { failures } : {}),
            targets,
          };
        },
      },
    );
  }

  const eventSubscriptions = new Map<string, AbortController>();

  const ensureEventSubscription = (directory: string) => {
    if (deps.disableEventStream) return;
    const resolved = directory.trim() || defaultDirectory;
    if (!resolved) return;
    if (eventSubscriptions.has(resolved)) return;

    const abort = new AbortController();
    eventSubscriptions.set(resolved, abort);
    const client = getClient(resolved);

    void (async () => {
      const subscription = await client.event.subscribe(undefined, { signal: abort.signal });
      for await (const raw of subscription.stream as AsyncIterable<unknown>) {
        const event = normalizeEvent(raw as any);
        if (!event) continue;

        if (event.type === "message.updated") {
          if (event.properties && typeof event.properties === "object") {
            const record = event.properties as Record<string, unknown>;
            const info = record.info as Record<string, unknown> | undefined;
            const sessionID = typeof info?.sessionID === "string" ? (info.sessionID as string) : null;
            const model = extractModelRef(info);
            if (sessionID && model) {
              const key = keyForSession(resolved, sessionID);
              sessionModels.set(key, model);
              const run = activeRuns.get(key);
              if (run) reportThinking(run);
            }
          }
        }

        if (event.type === "session.status") {
          if (event.properties && typeof event.properties === "object") {
            const record = event.properties as Record<string, unknown>;
            const sessionID = typeof record.sessionID === "string" ? record.sessionID : null;
            const status = record.status as { type?: unknown } | undefined;
            if (sessionID && (status?.type === "busy" || status?.type === "retry")) {
              const run = activeRuns.get(keyForSession(resolved, sessionID));
              if (run) {
                reportThinking(run);
                startTyping(run);
              }
            }
          }
        }

        if (event.type === "session.idle") {
          if (event.properties && typeof event.properties === "object") {
            const record = event.properties as Record<string, unknown>;
            const sessionID = typeof record.sessionID === "string" ? record.sessionID : null;
            if (sessionID) {
              const key = keyForSession(resolved, sessionID);
              stopTyping(key);
              const run = activeRuns.get(key);
              if (run) reportDone(run);
            }
          }
        }

        if (event.type === "message.part.updated") {
          const part = (event.properties as { part?: any })?.part;
          if (!part?.sessionID) continue;
          const run = activeRuns.get(keyForSession(resolved, part.sessionID));
          if (!run || !run.toolUpdatesEnabled) continue;
          if (part.type !== "tool") continue;

          const callId = part.callID as string | undefined;
          if (!callId) continue;
          const state = part.state as { status?: string; input?: Record<string, unknown>; output?: string; title?: string };
          const status = state?.status ?? "unknown";
          if (run.seenToolStates.get(callId) === status) continue;
          run.seenToolStates.set(callId, status);

          const label = TOOL_LABELS[part.tool] ?? part.tool;
          const title = state.title || truncateText(formatInputSummary(state.input ?? {}), 120) || "running";
          let message = `[tool] ${label} ${status}: ${title}`;

          if (status === "completed" && state.output) {
            const output = truncateText(state.output.trim(), config.toolOutputLimit);
            if (output) message += `\n${output}`;
          }

          await sendText(run.channel, run.identityId, run.peerId, message, { kind: "tool" });
        }

        if (event.type === "permission.asked") {
          const permission = event.properties as { id?: string; sessionID?: string };
          if (!permission?.id || !permission.sessionID) continue;
          const response = config.permissionMode === "deny" ? "reject" : "always";
          await client.permission.respond({
            sessionID: permission.sessionID,
            permissionID: permission.id,
            response,
          });
          if (response === "reject") {
            const run = activeRuns.get(keyForSession(resolved, permission.sessionID));
            if (run) {
              await sendText(run.channel, run.identityId, run.peerId, "Permission denied. Update configuration to allow tools.", {
                kind: "system",
              });
            }
          }
        }
      }
    })().catch((error) => {
      if (abort.signal.aborted) return;
      logger.error({ error, directory: resolved }, "event stream closed");
    });
  };

  ensureEventSubscription(defaultDirectory);

  async function sendText(
    channel: ChannelName,
    identityId: string,
    peerId: string,
    text: string,
    options: { kind?: OutboundKind; display?: boolean } = {},
  ) {
    const parts: OutboundMessagePart[] =
      text.startsWith("FILE:") && text.substring(5).trim()
        ? [{ type: "file", filePath: text.substring(5).trim() }]
        : [{ type: "text", text }];
    const delivery = await deliverParts(channel, identityId, peerId, parts, options);
    if (delivery.sentParts < delivery.attemptedParts) {
      const message = delivery.partResults.find((part) => !part.sent)?.error || "Failed to send message";
      throw new Error(message);
    }
  }

  async function stopActiveRun(directory: string, sessionID: string) {
    await getClient(directory).session.abort({ sessionID });
  }

  async function compactSession(directory: string, sessionID: string) {
    const response = await getClient(directory).session.messages({ sessionID, limit: 100 });
    const messages = ((response as { data?: Array<{ info?: { role?: string; providerID?: string; modelID?: string } }> }).data ?? []) as Array<{
      info?: { role?: string; providerID?: string; modelID?: string };
    }>;
    const lastAssistant = [...messages].reverse().find((entry) => entry.info?.role === "assistant" && entry.info?.providerID && entry.info?.modelID);
    await getClient(directory).session.summarize({
      sessionID,
      ...(lastAssistant?.info?.providerID ? { providerID: lastAssistant.info.providerID } : {}),
      ...(lastAssistant?.info?.modelID ? { modelID: lastAssistant.info.modelID } : {}),
      ...(!lastAssistant?.info?.providerID || !lastAssistant?.info?.modelID ? { auto: true } : {}),
    });
  }

  async function handleTelegramPairingGate(input: {
    identityId: string;
    peerKey: string;
    peerId: string;
    text: string;
    bindingDirectory?: string;
    sessionDirectory?: string;
  }): Promise<"continue" | "handled"> {
    const access = resolveTelegramIdentityAccess(input.identityId);
    if (access.access !== "private") {
      return "continue";
    }

    const hasKnownBinding = Boolean(input.bindingDirectory?.trim() || input.sessionDirectory?.trim());
    if (hasKnownBinding) {
      return "continue";
    }

    const pairingCode = extractPairingCodeFromCommand(input.text);
    if (!pairingCode) {
      await sendText(
        "telegram",
        input.identityId,
        input.peerId,
        "This Telegram bot is private. Ask your OpenWork host for the pairing code, then send /pair <code>.",
        { kind: "system" },
      );
      return "handled";
    }

    if (!access.pairingCodeHash) {
      await sendText(
        "telegram",
        input.identityId,
        input.peerId,
        "This Telegram bot is private but missing a pairing code. Ask your OpenWork host to reconnect it.",
        { kind: "system" },
      );
      return "handled";
    }

    if (hashPairingCode(pairingCode) !== access.pairingCodeHash) {
      await sendText("telegram", input.identityId, input.peerId, "Invalid pairing code. Try again with /pair <code>.", {
        kind: "system",
      });
      return "handled";
    }

    const identityDirectory = resolveIdentityDirectoryStr("telegram", input.identityId);
    const boundDirectoryCandidate = identityDirectory || defaultDirectory;
    const hasExplicitBinding = Boolean(identityDirectory);
    if (!boundDirectoryCandidate || (!hasExplicitBinding && isDangerousRootDirectory(boundDirectoryCandidate))) {
      await sendText(
        "telegram",
        input.identityId,
        input.peerId,
        "No workspace directory configured for this identity. Ask your OpenWork host to set it, or reply with /dir <path>.",
        { kind: "system" },
      );
      return "handled";
    }

    const scopedBound = resolveScopedDirectory(boundDirectoryCandidate);
    if (!scopedBound.ok) {
      await sendText("telegram", input.identityId, input.peerId, scopedBound.error, { kind: "system" });
      return "handled";
    }

    const boundDirectory = scopedBound.directory;
    store.upsertBinding("telegram", input.identityId, input.peerKey, boundDirectory);
    store.deleteSession("telegram", input.identityId, input.peerKey);
    ensureEventSubscription(boundDirectory);
    logger.info(
      { channel: "telegram", identityId: input.identityId, peerId: input.peerKey, directory: boundDirectory },
      "telegram private identity paired",
    );
    await sendText(
      "telegram",
      input.identityId,
      input.peerId,
      "Pairing successful. This chat is now linked to your worker.",
      { kind: "system" },
    );
    return "handled";
  }

  async function handleInbound(message: InboundMessage) {
    const adapter = adapters.get(adapterKey(message.channel, message.identityId));
    if (!adapter) return;
    recordInboundActivity(Date.now());
    const normalizedParts: InboundMessagePart[] =
      Array.isArray(message.parts) && message.parts.length
        ? message.parts
        : message.text.trim()
          ? [{ type: "text", text: message.text }]
          : [];
    const inboundText = textFromInboundParts(normalizedParts, message.text).trim();
    let inbound: InboundMessage = {
      ...message,
      text: inboundText,
      ...(normalizedParts.length ? { parts: normalizedParts } : {}),
    };

  if (inbound.fromMe) {
      logger.debug(
        {
          channel: inbound.channel,
          identityId: inbound.identityId,
          peerId: inbound.peerId,
        },
        "inbound ignored (self-authored)",
      );
    return;
  }

    const configuredPluginIdentity = getBridgePluginIdentity(pluginIdentities, inbound.channel, inbound.identityId);
      if (pluginIdentities.has(inbound.channel) && (!configuredPluginIdentity || configuredPluginIdentity.enabled === false)) {
        logger.warn(
          {
            channel: inbound.channel,
            identityId: inbound.identityId,
            peerId: inbound.peerId,
          },
          "channel inbound ignored (identity disabled or missing)",
        );
        return;
      }

    const reporterInboundText =
      inbound.text || summarizeInboundPartsForReporter(inbound.parts) || "[empty message]";
    logger.debug(
      {
        channel: inbound.channel,
        identityId: inbound.identityId,
        peerId: inbound.peerId,
        fromMe: inbound.fromMe,
        length: reporterInboundText.length,
        preview: truncateText(reporterInboundText.trim(), 120),
      },
      "inbound received",
    );
    logger.info(
      { channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, length: reporterInboundText.length },
      "received message",
    );
    const peerKey = inbound.peerId;
    const trimmedText = inbound.text.trim();
    let binding = store.getBinding(inbound.channel, inbound.identityId, peerKey);
    let session = store.getSession(inbound.channel, inbound.identityId, peerKey);

    if (inbound.channel === "telegram") {
      const pairingGate = await handleTelegramPairingGate({
        identityId: inbound.identityId,
        peerKey,
        peerId: inbound.peerId,
        text: trimmedText,
        ...(binding?.directory?.trim() ? { bindingDirectory: binding.directory } : {}),
        ...(session?.directory?.trim() ? { sessionDirectory: session.directory ?? undefined } : {}),
      });
      if (pairingGate === "handled") return;
      binding = store.getBinding(inbound.channel, inbound.identityId, peerKey);
      session = store.getSession(inbound.channel, inbound.identityId, peerKey);
    }

    // Handle bot commands
    if (trimmedText.startsWith("/")) {
      const commandHandled = await handleCommand(
        inbound.channel,
        inbound.identityId,
        peerKey,
        inbound.peerId,
        trimmedText,
      );
      if (commandHandled) return;
    }

    reporter?.onInbound?.({
      channel: inbound.channel,
      identityId: inbound.identityId,
      peerId: inbound.peerId,
      text: reporterInboundText,
      fromMe: inbound.fromMe,
    });

    const identityDirStr = resolveIdentityDirectoryStr(inbound.channel, inbound.identityId);
    // identityDirStr may encode a strategy ("per-peer", "per-peer://<root>") or a plain static path.
    const identityStrategy = parseDirectoryStrategy(identityDirStr);

    // Resolve the effective directory. Static strategies are used directly as identityDirectory;
    // per-peer strategies (and the global opencodeDirectory fallback) require async provisioning.
    const identityDirectory = identityStrategy?.mode === "static" ? identityStrategy.path : "";

    let policyDirectory = "";
    if (!binding?.directory?.trim() && !identityDirectory) {
      // Prefer per-peer identity strategy, then fall back to parsing the global opencodeDirectory.
      const strategy = (identityStrategy?.mode === "per-peer" ? identityStrategy : null)
        ?? parseDirectoryStrategy(config.opencodeDirectory?.trim());
      if (strategy?.mode === "per-peer") {
        policyDirectory = await provisionPeerDirectory(strategy, inbound.peerId, config.dataDir, logger);
        logger.info({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, policyDirectory }, "directory-policy: provisioned peer directory");
      }
    }

    const boundDirectoryCandidate =
      binding?.directory?.trim() || identityDirectory || policyDirectory || session?.directory?.trim() || defaultDirectory;

    const hasExplicitBinding = Boolean(binding?.directory?.trim() || session?.directory?.trim() || identityDirectory);
    if (!boundDirectoryCandidate || (!hasExplicitBinding && isDangerousRootDirectory(boundDirectoryCandidate))) {
      await sendText(
        inbound.channel,
        inbound.identityId,
        inbound.peerId,
        "No workspace directory configured for this identity. Ask your OpenWork host to set it, or reply with /dir <path>.",
        { kind: "system" },
      );
      return;
    }

    const scopedBound = resolveScopedDirectory(boundDirectoryCandidate);
    if (!scopedBound.ok) {
      await sendText(inbound.channel, inbound.identityId, inbound.peerId, scopedBound.error, { kind: "system" });
      return;
    }
    const boundDirectory = scopedBound.directory;

    const shouldAutoBind = !(
      inbound.channel === "telegram" && resolveTelegramIdentityAccess(inbound.identityId).access === "private"
    );
    if (shouldAutoBind && !binding?.directory?.trim()) {
      store.upsertBinding(inbound.channel, inbound.identityId, peerKey, boundDirectory);
    }

    ensureEventSubscription(boundDirectory);

    const sessionID =
      session?.session_id && normalizeDirectory(session?.directory ?? "") === normalizeDirectory(boundDirectory)
        ? session.session_id
        : await createSession({
            channel: inbound.channel,
            identityId: inbound.identityId,
            peerId: inbound.peerId,
            peerKey,
            directory: boundDirectory,
          });
    const key = keyForSession(boundDirectory, sessionID);
    logger.debug(
      {
        sessionID,
        channel: inbound.channel,
        peerId: inbound.peerId,
        reused: Boolean(session?.session_id),
      },
      "session resolved",
    );

    enqueue(key, async () => {
      const runState: RunState = {
        key,
        directory: boundDirectory,
        sessionID,
        channel: inbound.channel,
        identityId: inbound.identityId,
        adapterKey: adapterKey(inbound.channel, inbound.identityId),
        peerId: inbound.peerId,
        peerKey,
        toolUpdatesEnabled: config.toolUpdatesEnabled,
        seenToolStates: new Map(),
      };
      activeRuns.set(key, runState);
      reportThinking(runState);
      startTyping(runState);
      try {
        const effectiveModel = getUserModel(inbound.channel, inbound.identityId, peerKey, config.model);
        const attachmentSummary = summarizeInboundPartsForPrompt(inbound.parts);
        const incomingText = inbound.text || "(no text; user sent media)";
        const promptText = [
          incomingText,
          ...(attachmentSummary.length ? ["", "Incoming attachments:", ...attachmentSummary] : []),
        ].join("\n");
        logger.debug(
          {
            sessionID,
            length: inbound.text.length,
            model: effectiveModel,
          },
          "prompt start",
        );

        type PromptPart = { type?: string; text?: string; ignored?: boolean };

        const extractReply = (parts: PromptPart[]) =>
          parts
            .filter((part) => part.type === "text" && !part.ignored)
            .map((part) => part.text ?? "")
            .join("\n")
            .trim();

        const logPromptResponse = (attempt: "initial" | "retry", parts: PromptPart[]) => {
          const textParts = parts.filter((part) => part.type === "text" && !part.ignored);
          logger.debug(
            {
              sessionID,
              attempt,
              partCount: parts.length,
              textCount: textParts.length,
              partTypes: parts.map((p) => p.type),
              ignoredCount: parts.filter((p) => p.ignored).length,
            },
            "prompt response",
          );
        };

        const runPrompt = async (): Promise<PromptPart[]> => {
          const response = await getClient(boundDirectory).session.prompt({
            sessionID,
            parts: [{ type: "text", text: promptText }],
            ...(effectiveModel ? { model: effectiveModel } : {}),
          });
          return (response as { parts?: PromptPart[] }).parts ?? [];
        };

        let parts = await runPrompt();
        logPromptResponse("initial", parts);
        let reply = extractReply(parts);

        if (!reply && !parts.some((part) => part.type === "tool")) {
          logger.warn({ sessionID }, "prompt returned no visible text; retrying once");
          parts = await runPrompt();
          logPromptResponse("retry", parts);
          reply = extractReply(parts);
        }

        if (reply) {
          logger.debug({ sessionID, replyLength: reply.length }, "reply built");
          await sendText(inbound.channel, inbound.identityId, inbound.peerId, reply, { kind: "reply" });
        } else {
          logger.warn(
            { sessionID, partTypes: parts.map((part) => part.type), ignoredCount: parts.filter((part) => part.ignored).length },
            "prompt returned no visible text; clearing session",
          );
          store.deleteSession(inbound.channel, inbound.identityId, peerKey);
          await sendText(
            inbound.channel,
            inbound.identityId,
            inbound.peerId,
            "No visible response was generated. I reset this chat session in case stale state was blocking replies. Send your message again.",
            {
              kind: "system",
            },
          );
        }
      } catch (error) {
        // Log full error details for debugging
        const errorDetails = {
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : undefined,
          stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : undefined,
          cause: error instanceof Error ? (error as any).cause : undefined,
          status: (error as any)?.status ?? (error as any)?.statusCode ?? undefined,
        };
        logger.error({ error: errorDetails, sessionID }, "prompt failed");
        
        // Extract meaningful error details
        let errorMessage = "Error: failed to reach OpenCode.";
        if (error instanceof Error) {
          const msg = error.message || "";
          // Check for common error patterns
          if (msg.includes("401") || msg.includes("Unauthorized")) {
            errorMessage = "Error: OpenCode authentication failed (401). Check credentials.";
          } else if (msg.includes("403") || msg.includes("Forbidden")) {
            errorMessage = "Error: OpenCode access forbidden (403).";
          } else if (msg.includes("404") || msg.includes("Not Found")) {
            errorMessage = "Error: OpenCode endpoint not found (404).";
          } else if (msg.includes("429") || msg.includes("rate limit")) {
            errorMessage = "Error: Rate limited. Please wait and try again.";
          } else if (msg.includes("500") || msg.includes("Internal Server")) {
            errorMessage = "Error: OpenCode server error (500).";
          } else if (msg.includes("model") || msg.includes("provider")) {
            errorMessage = `Error: Model/provider issue - ${msg.slice(0, 100)}`;
          } else if (msg.includes("ECONNREFUSED") || msg.includes("connection")) {
            errorMessage = "Error: Cannot connect to OpenCode. Is it running?";
          } else if (msg.trim()) {
            // Include the actual error message (truncated)
            errorMessage = `Error: ${msg.slice(0, 150)}`;
          }
        }
        
        await sendText(inbound.channel, inbound.identityId, inbound.peerId, errorMessage, {
          kind: "system",
        });
      } finally {
        stopTyping(key);
        reportDone(runState);
        activeRuns.delete(key);
      }
    });
  }

  async function handleCommand(
    channel: ChannelName,
    identityId: string,
    peerKey: string,
    peerId: string,
    text: string,
  ): Promise<boolean> {
    const parts = text.slice(1).split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    // Model switching commands
    if (command && MODEL_PRESETS[command]) {
      const model = MODEL_PRESETS[command];
      setUserModel(channel, identityId, peerKey, model);
      await sendText(channel, identityId, peerId, `Model switched to ${model.providerID}/${model.modelID}`, {
        kind: "system",
      });
      logger.info({ channel, peerId: peerKey, model }, "model switched via command");
      return true;
    }

    // /model command - show current model
    if (command === "model") {
      const current = getUserModel(channel, identityId, peerKey, config.model);
      const modelStr = current ? `${current.providerID}/${current.modelID}` : "default";
      await sendText(channel, identityId, peerId, `Current model: ${modelStr}`, { kind: "system" });
      return true;
    }

    // /reset command - clear model override and session
    if (command === "reset") {
      setUserModel(channel, identityId, peerKey, undefined);
      store.deleteSession(channel, identityId, peerKey);
      await sendText(channel, identityId, peerId, "Session and model reset. Send a message to start fresh.", {
        kind: "system",
      });
      logger.info({ channel, peerId: peerKey }, "session and model reset");
      return true;
    }

    if (command === "new") {
      store.deleteSession(channel, identityId, peerKey);
      await sendText(channel, identityId, peerId, "Started a fresh session. Send a message to continue.", {
        kind: "system",
      });
      return true;
    }

    if (command === "stop") {
      const session = store.getSession(channel, identityId, peerKey);
      if (!session?.session_id) {
        await sendText(channel, identityId, peerId, "No active session to stop.", { kind: "system" });
        return true;
      }
      const directory = session.directory?.trim() || resolveIdentityDirectoryStr(channel, identityId) || defaultDirectory;
      await stopActiveRun(directory, session.session_id);
      await sendText(channel, identityId, peerId, "Stopped the active run.", { kind: "system" });
      return true;
    }

    if (command === "compact") {
      const session = store.getSession(channel, identityId, peerKey);
      if (!session?.session_id) {
        await sendText(channel, identityId, peerId, "No session to compact yet. Send a message first.", { kind: "system" });
        return true;
      }
      const directory = session.directory?.trim() || resolveIdentityDirectoryStr(channel, identityId) || defaultDirectory;
      await compactSession(directory, session.session_id);
      await sendText(channel, identityId, peerId, "Session compacted.", { kind: "system" });
      return true;
    }

    if (command === "pair") {
      if (channel !== "telegram") {
        await sendText(channel, identityId, peerId, "Pairing is only available for Telegram private bots.", {
          kind: "system",
        });
        return true;
      }
      const binding = store.getBinding(channel, identityId, peerKey);
      const session = store.getSession(channel, identityId, peerKey);
      const pairingGate = await handleTelegramPairingGate({
        identityId,
        peerKey,
        peerId,
        text,
        ...(binding?.directory?.trim() ? { bindingDirectory: binding.directory } : {}),
        ...(session?.directory?.trim() ? { sessionDirectory: session.directory ?? undefined } : {}),
      });
      if (pairingGate === "handled") return true;
      await sendText(channel, identityId, peerId, "This chat is already paired.", { kind: "system" });
      return true;
    }

    if (command === "dir" || command === "cd") {
      const next = args.join(" ").trim();
      if (!next) {
        const binding = store.getBinding(channel, identityId, peerKey);
        const current =
          binding?.directory?.trim() || store.getSession(channel, identityId, peerKey)?.directory?.trim() || defaultDirectory;
        await sendText(channel, identityId, peerId, `Current directory: ${current || "(none)"}`, { kind: "system" });
        return true;
      }
      const scoped = resolveScopedDirectory(next);
      if (!scoped.ok) {
        await sendText(channel, identityId, peerId, scoped.error, { kind: "system" });
        return true;
      }
      const normalized = scoped.directory;
      store.upsertBinding(channel, identityId, peerKey, normalized);
      store.deleteSession(channel, identityId, peerKey);
      ensureEventSubscription(normalized);
      await sendText(channel, identityId, peerId, `Directory set to: ${normalized}`, { kind: "system" });
      return true;
    }

    if (command === "agent") {
      await sendText(
        channel,
        identityId,
        peerId,
        [
          `Scope: workspace`,
          `Directory root: ${workspaceRoot}`,
          `Current binding is handled by workspace files directly.`,
        ].join("\n"),
        { kind: "system" },
      );
      return true;
    }

    // /help command
    if (command === "help") {
      const helpText = `/new - start a fresh session\n/stop - abort the active run\n/compact - summarize current session\n/opus - Claude Opus 4.5\n/codex - GPT 5.2 Codex\n/pair <code> - pair this chat with a private Telegram bot\n/dir <path> - bind this chat to a workspace directory\n/dir - show current directory\n/agent - show workspace agent scope/path\n/model - show current\n/reset - start fresh\n/help - this`;
      await sendText(channel, identityId, peerId, helpText, { kind: "system" });
      return true;
    }

    // Unknown command - don't handle, let it pass through as a message
    return false;
  }

  async function createSession(input: {
    channel: ChannelName;
    identityId: string;
    peerId: string;
    peerKey: string;
    directory: string;
  }): Promise<string> {
    const title = `opencode-router ${input.channel}/${input.identityId} ${input.peerId}`;
    const session = await getClient(input.directory).session.create({
      title,
      permission: buildPermissionRules(config.permissionMode),
    });
    const sessionID = (session as { id?: string }).id;
    if (!sessionID) throw new Error("Failed to create session");
    store.upsertSession(input.channel, input.identityId, input.peerKey, sessionID, input.directory);
    logger.info(
      { sessionID, channel: input.channel, identityId: input.identityId, peerId: input.peerKey, directory: input.directory },
      "session created",
    );
    reportStatus?.(
      `${getChannelLabel(input.channel)}/${input.identityId} session created for ${formatPeer(input.channel, input.peerId)} (ID: ${sessionID}).`,
    );
    return sessionID;
  }

  function enqueue(key: string, task: () => Promise<void>) {
    const previous = sessionQueue.get(key) ?? Promise.resolve();
    const next = previous
      .then(task)
      .catch((error) => {
        logger.error({ error }, "session task failed");
      })
      .finally(() => {
        if (sessionQueue.get(key) === next) {
          sessionQueue.delete(key);
        }
      });
    sessionQueue.set(key, next);
  }

  for (const adapter of Array.from(adapters.values())) {
    const startResult = await startAdapterBounded(adapter, {
      timeoutMs: 8_000,
      onError: (error) => {
        logger.error({ error, channel: adapter.name, identityId: adapter.identityId }, "adapter start failed");
        adapters.delete(adapter.key);
      },
    });

    if (startResult.status === "timeout") {
      logger.warn({ channel: adapter.name, identityId: adapter.identityId, timeoutMs: 8_000 }, "adapter start timed out");
      reportStatus?.(`${getChannelLabel(adapter.name)}/${adapter.identityId} adapter starting...`);
      continue;
    }

    if (startResult.status === "error") {
      reportStatus?.(`${getChannelLabel(adapter.name)}/${adapter.identityId} adapter failed to start.`);
      continue;
    }

    reportStatus?.(`${getChannelLabel(adapter.name)}/${adapter.identityId} adapter started.`);
  }

  logger.info({ channels: Array.from(adapters.keys()) }, "bridge started");
  reportStatus?.(`Bridge running. Logs: ${config.logFile}`);

  return {
    async stop() {
      if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
      }
      if (stopHealthServer) stopHealthServer();
      for (const abort of eventSubscriptions.values()) {
        abort.abort();
      }
      eventSubscriptions.clear();
      for (const timer of typingLoops.values()) {
        clearInterval(timer);
      }
      typingLoops.clear();
      for (const adapter of adapters.values()) {
        await adapter.stop();
      }
      store.close();
      await delay(50);
    },
    async dispatchInbound(message: {
      channel: ChannelName;
      identityId?: string;
      peerId: string;
      text?: string;
      parts?: InboundMessagePart[];
      raw?: unknown;
      fromMe?: boolean;
    }) {
      const identityId = (message.identityId ?? "default").trim() || "default";
      await handleInbound({
        channel: message.channel,
        identityId,
        peerId: message.peerId,
        text: message.text ?? "",
        ...(Array.isArray(message.parts) ? { parts: message.parts } : {}),
        raw: message.raw ?? null,
        fromMe: message.fromMe,
      });

      // For tests and programmatic callers: wait for the session queue to drain.
      const peerKey = message.peerId;
      const session = store.getSession(message.channel, identityId, peerKey);
      const sessionID = session?.session_id;
      const directory =
        session?.directory?.trim() || store.getBinding(message.channel, identityId, peerKey)?.directory?.trim() || defaultDirectory;
      const pending = sessionID && directory ? sessionQueue.get(keyForSession(directory, sessionID)) : null;
      if (pending) {
        await pending;
      }
    },
  };
}
