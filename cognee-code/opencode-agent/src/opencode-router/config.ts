import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(moduleDir, "..");
dotenv.config({ path: path.join(packageDir, ".env") });
dotenv.config();

export type ChannelName = string;

export type PluginOptions = Record<string, unknown>;
export type PluginSpec = string | [string, PluginOptions];
export type PluginOrigin = {
  spec: string;
  options?: PluginOptions;
  source: string;
  scope: "global" | "local";
};

/**
 * Parsed representation of a directory strategy string.
 *
 * The `directory` field on any identity
 * and on `OpenCodeRouterConfigFile` supports two formats beyond a plain path:
 *
 *   "per-peer"           — create <dataDir>/workspaces/<peerId>/, seed with built-in template
 *   "per-peer://<root>"  — create <root>/<peerId>/, seed with built-in template
 *   "/absolute/path"     — static directory (existing behaviour, unchanged)
 *
 * Parse with `parseDirectoryStrategy(value)`.
 */
export type DirectoryStrategy =
  | { mode: "static"; path: string }
  | { mode: "per-peer"; root: string };

/**
 * Parse a directory string into a DirectoryStrategy.
 * Returns undefined for empty/null input.
 */
export function parseDirectoryStrategy(value: string | undefined | null): DirectoryStrategy | undefined {
  if (!value?.trim()) return undefined;
  const v = value.trim();
  if (v === "per-peer") {
    return { mode: "per-peer", root: "" }; // root resolved at runtime from dataDir
  }
  const perPeerMatch = v.match(/^per-peer:\/\/(.+)$/);
  if (perPeerMatch) {
    return { mode: "per-peer", root: perPeerMatch[1].trim() };
  }
  return { mode: "static", path: v };
}

export type TelegramIdentity = {
  id: string;
  token: string;
  enabled?: boolean;
  // Optional default workspace directory to route peers into.
  // When set, opencodeRouter will auto-bind new peerIds to this directory.
  directory?: string;
  // Optional access mode. Private mode requires `/pair <code>` before first use.
  access?: "public" | "private";
  // sha256 hash (hex) of normalized pairing code for private mode.
  pairingCodeHash?: string;
};

export type SlackIdentity = {
  id: string;
  botToken: string;
  appToken: string;
  enabled?: boolean;
  directory?: string;
};

/**
 * Channel-agnostic identity — the common subset shared by all channel account types.
 * Channel-specific credentials live in configFile.channels[channelName].accounts[*].
 */
export type ChannelIdentity = {
  id: string;
  /** The channel name as it appears in the config file. */
  channel: string;
  enabled?: boolean;
  directory?: string;
};

/**
 * Per-channel block inside opencode-router.json.
 * `accounts` (or legacy per-channel names) carry the full channel-specific config;
 * only the common fields are surfaced in ChannelIdentity at runtime.
 */
export type ChannelConfig = {
  enabled?: boolean;
  /** The list of accounts/bots/apps for this channel. */
  accounts?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type OpenCodeRouterConfigFile = {
  version: number;
  opencodeUrl?: string;
  /**
   * Default workspace directory or strategy string.
   * Supports: "/absolute/path", "per-peer", "per-peer://<root>"
   */
  opencodeDirectory?: string;
  groupsEnabled?: boolean;
  plugin?: PluginSpec[];
  plugins?: {
    enabled?: boolean;
    allow?: string[];
    deny?: string[];
    load?: {
      paths?: string[];
    };
    entries?: Record<
      string,
      {
        enabled?: boolean;
        hooks?: {
          allowPromptInjection?: boolean;
        };
        config?: Record<string, unknown>;
      }
    >;
  };
  channels?: Record<string, ChannelConfig>;
};

export type ModelRef = {
  providerID: string;
  modelID: string;
};

export type Config = {
  configPath: string;
  configFile: OpenCodeRouterConfigFile;
  opencodeUrl: string;
  opencodeDirectory: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  model?: ModelRef;
  plugins: {
    enabled: boolean;
    allow: string[];
    deny: string[];
    loadPaths: string[];
    entries: Record<
      string,
      {
        enabled?: boolean;
        hooks?: {
          allowPromptInjection?: boolean;
        };
        config?: Record<string, unknown>;
      }
    >;
  };
  pluginOrigins: PluginOrigin[];
  telegramBots: TelegramIdentity[];
  slackApps: SlackIdentity[];
  /** All configured channel identities in a channel-agnostic view. */
  channels: ChannelIdentity[];
  dataDir: string;
  dbPath: string;
  logFile: string;
  toolUpdatesEnabled: boolean;
  groupsEnabled: boolean;
  permissionMode: "allow" | "deny";
  toolOutputLimit: number;
  healthPort?: number;
  logLevel: string;
};

type EnvLike = NodeJS.ProcessEnv;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePluginEntries(
  entries:
    | Record<
        string,
        {
          enabled?: boolean;
          hooks?: {
            allowPromptInjection?: boolean;
          };
          config?: Record<string, unknown>;
        }
      >
    | undefined,
): Config["plugins"]["entries"] {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return {};
  }
  const normalized: Config["plugins"]["entries"] = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!key.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const record = value as {
      enabled?: unknown;
      hooks?: { allowPromptInjection?: unknown };
      config?: unknown;
    };
    normalized[key.trim()] = {
      ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
      ...(record.hooks && typeof record.hooks.allowPromptInjection === "boolean"
        ? { hooks: { allowPromptInjection: record.hooks.allowPromptInjection } }
        : {}),
      ...(record.config && typeof record.config === "object" && !Array.isArray(record.config)
        ? { config: record.config as Record<string, unknown> }
        : {}),
    };
  }
  return normalized;
}

function isPluginOptions(value: unknown): value is PluginOptions {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPathLikePluginSpec(spec: string): boolean {
  return spec.startsWith("file://") || spec.startsWith(".") || path.isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec);
}

function packageNameFromPluginSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) {
    const versionIndex = trimmed.indexOf("@", 1 + trimmed.indexOf("/"));
    return versionIndex > 0 ? trimmed.slice(0, versionIndex) : trimmed;
  }
  const versionIndex = trimmed.indexOf("@");
  return versionIndex > 0 ? trimmed.slice(0, versionIndex) : trimmed;
}

function resolvePluginSpecValue(spec: string, configPath: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("file://")) {
    return fileURLToPath(trimmed);
  }
  if (!isPathLikePluginSpec(trimmed)) {
    return trimmed;
  }
  if (path.isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return path.resolve(trimmed);
  }
  return path.resolve(path.dirname(configPath), trimmed);
}

function normalizePluginSpecEntry(entry: unknown, configPath: string): PluginOrigin | undefined {
  if (typeof entry === "string") {
    const spec = resolvePluginSpecValue(entry, configPath);
    if (!spec) return undefined;
    return { spec, source: configPath, scope: "local" };
  }
  if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== "string") {
    return undefined;
  }
  const spec = resolvePluginSpecValue(entry[0], configPath);
  if (!spec) return undefined;
  return {
    spec,
    ...(isPluginOptions(entry[1]) ? { options: entry[1] } : {}),
    source: configPath,
    scope: "local",
  };
}

function pluginIdentityKey(spec: string): string {
  if (isPathLikePluginSpec(spec)) {
    return path.resolve(spec);
  }
  return packageNameFromPluginSpec(spec);
}

function legacyPluginConfigForSpec(
  spec: string,
  entries: Config["plugins"]["entries"],
): PluginOptions | undefined {
  const packageName = packageNameFromPluginSpec(spec);
  const direct = entries[spec];
  if (isPluginOptions(direct?.config)) return direct.config;
  if (packageName) {
    const byPackage = entries[packageName];
    if (isPluginOptions(byPackage?.config)) return byPackage.config;
  }
  return undefined;
}

function normalizePluginOrigins(file: OpenCodeRouterConfigFile, configPath: string): PluginOrigin[] {
  const pluginsConfig = normalizePluginsConfig(file);
  const normalized: PluginOrigin[] = [];
  const seen = new Set<string>();

  for (const entry of Array.isArray(file.plugin) ? file.plugin : []) {
    const next = normalizePluginSpecEntry(entry, configPath);
    if (!next) continue;
    const key = pluginIdentityKey(next.spec);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }

  for (const spec of pluginsConfig.loadPaths) {
    const resolvedSpec = resolvePluginSpecValue(spec, configPath);
    const key = pluginIdentityKey(resolvedSpec);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const legacyConfig = legacyPluginConfigForSpec(resolvedSpec, pluginsConfig.entries);
    normalized.push({
      spec: resolvedSpec,
      ...(legacyConfig ? { options: legacyConfig } : {}),
      source: configPath,
      scope: "local",
    });
  }

  return normalized;
}

function normalizePluginsConfig(file: OpenCodeRouterConfigFile) {
  const plugins = file.plugins;
  return {
    enabled: plugins?.enabled !== false,
    allow: Array.isArray(plugins?.allow) ? plugins!.allow.map((entry) => String(entry).trim()).filter(Boolean) : [],
    deny: Array.isArray(plugins?.deny) ? plugins!.deny.map((entry) => String(entry).trim()).filter(Boolean) : [],
    loadPaths: Array.isArray(plugins?.load?.paths)
      ? plugins!.load!.paths!.map((entry) => String(entry).trim()).filter(Boolean)
      : [],
    entries: normalizePluginEntries(plugins?.entries),
  };
}

function parseModel(value: string | undefined): ModelRef | undefined {
  if (!value?.trim()) return undefined;
  const parts = value.trim().split("/");
  if (parts.length < 2) return undefined;
  const providerID = parts[0];
  const modelID = parts.slice(1).join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function expandHome(value: string): string {
  if (!value.startsWith("~/")) return value;
  return path.join(os.homedir(), value.slice(2));
}

function resolveConfigPath(dataDir: string, env: EnvLike): string {
  const override = env.OPENCODE_ROUTER_CONFIG_PATH?.trim();
  if (override) return expandHome(override);
  return path.join(dataDir, "opencode-router.json");
}

export function readConfigFile(configPath: string): { exists: boolean; config: OpenCodeRouterConfigFile } {
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as OpenCodeRouterConfigFile;
    return { exists: true, config: parsed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, config: { version: 1 } };
    }
    throw error;
  }
}

export function writeConfigFile(configPath: string, config: OpenCodeRouterConfigFile) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function normalizeId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const safe = trimmed.replace(/[^a-zA-Z0-9_.-]+/g, "-");
  return safe.replace(/^-+|-+$/g, "").slice(0, 48) || "default";
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

function coerceTelegramBots(file: OpenCodeRouterConfigFile): TelegramIdentity[] {
  const telegram = file.channels?.telegram;
  const bots = Array.isArray((telegram as any)?.bots) ? ((telegram as any).bots as unknown[]) : [];
  const normalized: TelegramIdentity[] = [];
  for (const entry of bots) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const token = typeof record.token === "string" ? record.token.trim() : "";
    if (!token) continue;
    const id = normalizeId(typeof record.id === "string" ? record.id : "default");
    const directory = typeof record.directory === "string" ? record.directory.trim() : "";
    const access = normalizeTelegramAccess(record.access);
    const pairingCodeHash = normalizePairingCodeHash(record.pairingCodeHash);
    normalized.push({
      id,
      token,
      enabled: record.enabled === undefined ? true : record.enabled === true,
      ...(directory ? { directory } : {}),
      ...(access === "private" ? { access, ...(pairingCodeHash ? { pairingCodeHash } : {}) } : { access: "public" }),
    });
  }
  if (normalized.length) return normalized;

  // Legacy single-bot migration (in-memory).
  const legacyToken = typeof (telegram as any)?.token === "string" ? String((telegram as any).token).trim() : "";
  if (legacyToken) {
    return [{ id: "default", token: legacyToken, enabled: true }];
  }
  return [];
}

function coerceSlackApps(file: OpenCodeRouterConfigFile): SlackIdentity[] {
  const slack = file.channels?.slack;
  const apps = Array.isArray((slack as any)?.apps) ? ((slack as any).apps as unknown[]) : [];
  const normalized: SlackIdentity[] = [];
  for (const entry of apps) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const botToken = typeof record.botToken === "string" ? record.botToken.trim() : "";
    const appToken = typeof record.appToken === "string" ? record.appToken.trim() : "";
    if (!botToken || !appToken) continue;
    const id = normalizeId(typeof record.id === "string" ? record.id : "default");
    const directory = typeof record.directory === "string" ? record.directory.trim() : "";
    normalized.push({
      id,
      botToken,
      appToken,
      enabled: record.enabled === undefined ? true : record.enabled === true,
      ...(directory ? { directory } : {}),
    });
  }
  if (normalized.length) return normalized;

  // Legacy single-app migration (in-memory).
  const legacyBot = typeof (slack as any)?.botToken === "string" ? String((slack as any).botToken).trim() : "";
  const legacyApp = typeof (slack as any)?.appToken === "string" ? String((slack as any).appToken).trim() : "";
  if (legacyBot && legacyApp) {
    return [{ id: "default", botToken: legacyBot, appToken: legacyApp, enabled: true }];
  }
  return [];
}

/**
 * Extract a flat list of ChannelIdentity objects from all channels in the config file.
 * Reads each channel's `accounts` array (the common key) and pulls out the shared fields.
 * Channel-specific credential fields are preserved in configFile for plugins that need them.
 */
function coerceChannelAccounts(file: OpenCodeRouterConfigFile): ChannelIdentity[] {
  const result: ChannelIdentity[] = [];
  const channels = file.channels;
  if (!channels || typeof channels !== "object") return result;
  for (const [channelName, channelCfg] of Object.entries(channels)) {
    if (!channelCfg || typeof channelCfg !== "object") continue;
    const cfg = channelCfg as Record<string, unknown>;
    // Support canonical "accounts" key as well as channel-specific aliases "bots" / "apps"
    const accountList =
      Array.isArray(cfg.accounts) ? cfg.accounts :
      Array.isArray(cfg.bots)     ? cfg.bots :
      Array.isArray(cfg.apps)     ? cfg.apps :
      [];
    for (const entry of accountList) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const id = normalizeId(typeof record.id === "string" ? record.id : "default");
      const enabled = record.enabled === undefined ? true : record.enabled === true;
      const directory = typeof record.directory === "string" ? record.directory.trim() : undefined;
      result.push({ id, channel: channelName, enabled, ...(directory ? { directory } : {}) });
    }
    // Legacy: if no accounts/bots/apps array but the channel block itself looks like a single account
    if (accountList.length === 0) {
      const metaKeys = new Set(["enabled", "accounts", "bots", "apps", "defaultAccount"]);
      const hasAccountFields = Object.keys(cfg).some((k) => !metaKeys.has(k));
      if (hasAccountFields) {
        const id = normalizeId(typeof cfg.id === "string" ? cfg.id : "default");
        const enabled = cfg.enabled === undefined ? true : cfg.enabled === true;
        const directory = typeof cfg.directory === "string" ? cfg.directory.trim() : undefined;
        result.push({ id, channel: channelName, enabled, ...(directory ? { directory } : {}) });
      }
    }
  }
  return result;
}

export function loadConfig(
  env: EnvLike = process.env,
  options: { requireOpencode?: boolean } = {},
): Config {
  const requireOpencode = options.requireOpencode ?? false;

  const defaultDataDir = path.join(os.homedir(), ".openwork", "opencode-router");
  const dataDir = expandHome(env.OPENCODE_ROUTER_DATA_DIR ?? defaultDataDir);
  const dbPath = expandHome(env.OPENCODE_ROUTER_DB_PATH ?? path.join(dataDir, "opencode-router.db"));
  const logFile = expandHome(env.OPENCODE_ROUTER_LOG_FILE ?? path.join(dataDir, "logs", "opencode-router.log"));
  const configPath = resolveConfigPath(dataDir, env);
  let { config: configFile } = readConfigFile(configPath);
  const opencodeDirectory = env.OPENCODE_DIRECTORY?.trim() || configFile.opencodeDirectory || "";
  if (!opencodeDirectory && requireOpencode) {
    throw new Error("OPENCODE_DIRECTORY is required");
  }
  const resolvedDirectory = opencodeDirectory || process.cwd();

  const toolOutputLimit = parseInteger(env.TOOL_OUTPUT_LIMIT) ?? 1200;
  const permissionMode = env.PERMISSION_MODE?.toLowerCase() === "deny" ? "deny" : "allow";

  // Identities are loaded from config. Env vars are still supported as a convenience
  // for single-identity setups.
  const telegramBots = coerceTelegramBots(configFile);
  const slackApps = coerceSlackApps(configFile);
  const channelIdentities = coerceChannelAccounts(configFile);

  const envTelegram = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (envTelegram && !telegramBots.some((bot) => bot.token === envTelegram)) {
    telegramBots.unshift({ id: "env", token: envTelegram, enabled: true });
  }
  const envSlackBot = env.SLACK_BOT_TOKEN?.trim() ?? "";
  const envSlackApp = env.SLACK_APP_TOKEN?.trim() ?? "";
  if (envSlackBot && envSlackApp && !slackApps.some((app) => app.botToken === envSlackBot && app.appToken === envSlackApp)) {
    slackApps.unshift({ id: "env", botToken: envSlackBot, appToken: envSlackApp, enabled: true });
  }
  const healthPort =
    parseInteger(env.OPENCODE_ROUTER_HEALTH_PORT) ??
    // Convenience alias (common on PaaS / local experiments)
    parseInteger(env.PORT) ??
    3005;
  const model = parseModel(env.OPENCODE_ROUTER_MODEL);
  const plugins = normalizePluginsConfig(configFile);
  const pluginOrigins = normalizePluginOrigins(configFile, configPath);

  const telegramEnabledDefault = (configFile.channels?.["telegram"] as ChannelConfig | undefined)?.enabled ?? true;
  const slackEnabledDefault = (configFile.channels?.["slack"] as ChannelConfig | undefined)?.enabled ?? true;

  // Apply per-channel env-var overrides to channel identities.
  // Apply per-channel env-var overrides to channel identities.
  // Convention: channel name "my-channel" → env var "MY_CHANNEL_ENABLED".
  const channels: ChannelIdentity[] = channelIdentities.map((identity) => {
    const channelEnabledDefault =
      (configFile.channels?.[identity.channel] as ChannelConfig | undefined)?.enabled ?? true;
    const envKey = `${identity.channel.toUpperCase().replace(/-/g, "_")}_ENABLED`;
    return {
      ...identity,
      enabled: identity.enabled !== false && parseBoolean(env[envKey], channelEnabledDefault),
    };
  });

  return {
    configPath,
    configFile,
    opencodeUrl: env.OPENCODE_URL?.trim() || configFile.opencodeUrl || "http://127.0.0.1:4096",
    opencodeDirectory: resolvedDirectory,
    opencodeUsername: env.OPENCODE_SERVER_USERNAME?.trim() || undefined,
    opencodePassword: env.OPENCODE_SERVER_PASSWORD?.trim() || undefined,
    model,
    plugins,
    pluginOrigins,
    telegramBots: telegramBots.map((bot) => ({ ...bot, enabled: bot.enabled !== false && parseBoolean(env.TELEGRAM_ENABLED, telegramEnabledDefault) })),
    slackApps: slackApps.map((app) => ({
      ...app,
      enabled: app.enabled !== false && parseBoolean(env.SLACK_ENABLED, slackEnabledDefault),
    })),
    channels,
    dataDir,
    dbPath,
    logFile,
    toolUpdatesEnabled: parseBoolean(env.TOOL_UPDATES_ENABLED, false),
    groupsEnabled: parseBoolean(env.GROUPS_ENABLED, configFile.groupsEnabled ?? false),
    permissionMode,
    toolOutputLimit,
    healthPort,
    logLevel: env.LOG_LEVEL?.trim() || "info",
  };
}
