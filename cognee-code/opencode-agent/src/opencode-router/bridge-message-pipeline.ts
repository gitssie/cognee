import { join } from "node:path";

import type { Logger } from "pino";

import type { ChannelName, Config, ModelRef } from "./config.js";
import { getBridgePluginIdentity } from "./bridge-plugin.js";
import type { DirectoryPolicy } from "./bridge-directory.js";
import {
  type InboundMessagePart,
  summarizeInboundPartsForPrompt,
  summarizeInboundPartsForReporter,
  textFromInboundParts,
} from "./media.js";
import type { MediaStore } from "./media-store.js";
import { truncateText } from "./text.js";
import type { BridgeSessionRuntime } from "./bridge-session.js";
import type { OpenCodeClientProvider } from "./client-provider.js";
import type { ChannelRegistry } from "./bridge-channel.js";

// ─── Public types ────────────────────────────────────────────────────────────

export type PipelineInboundMessage = {
  channel: ChannelName;
  identityId: string;
  peerId: string;
  text: string;
  parts?: InboundMessagePart[];
  raw: unknown;
  fromMe?: boolean;
  agentId?: string;
};

export type BridgeMessagePipelineDeps = {
  logger: Logger;
  config: Config;
  reporter?: {
    onInbound?: (message: {
      channel: ChannelName;
      identityId: string;
      peerId: string;
      text: string;
      fromMe?: boolean;
    }) => void;
  };
  store: any;
  provider: OpenCodeClientProvider;
  mediaStore: MediaStore;
  channels: ChannelRegistry;
  pluginIdentities: Map<
    string,
    Map<string, { id: string; enabled: boolean; directory?: string; fingerprint?: string }>
  >;
  directoryPolicy?: DirectoryPolicy;
  hasAdapter(channel: ChannelName, identityId: string): boolean;
  recordInboundActivity(now: number): void;
  resolveIdentityDirectory(channel: ChannelName, identityId: string): string;
  isDangerousRootDirectory(directory: string): boolean;
  resolveScopedDirectory(input: string): { ok: true; directory: string } | { ok: false; error: string };
  normalizeDirectory(input: string): string;
  handleCommand(channel: ChannelName, identityId: string, peerKey: string, peerId: string, text: string): Promise<boolean>;
  sendText(channel: ChannelName, identityId: string, peerId: string, text: string, options?: { kind?: "reply" | "system" | "tool" }): Promise<void>;
  sessionRuntime: BridgeSessionRuntime;
  /** Names of agents available in the OpenCode server. Used to validate per-account agent config. */
  availableAgents?: string[];
};

export type BridgeMessagePipeline = {
  handleInbound(message: PipelineInboundMessage): Promise<void>;
};

// ─── OpenCode session.prompt helpers ─────────────────────────────────────────

/**
 * Extract plain-text content from a `session.prompt` response.
 * The SDK returns `{ data: { parts: [{type, text}] } }` in responseStyle="fields" mode.
 */
function extractPromptText(response: unknown): string {
  const parts = (response as { data?: { parts?: Array<{ type?: string; text?: string }> } } | undefined)
    ?.data?.parts;
  return parts?.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") ?? "";
}

type PromptParams = {
  handle: Awaited<ReturnType<BridgeSessionRuntime["getHandle"]>>;
  sessionID: string;
  promptText: string;
  effectiveAgent?: string;
  effectiveModel?: ModelRef;
  inbound: PipelineInboundMessage;
  boundDirectory: string;
  peerKey: string;
  deps: BridgeMessagePipelineDeps;
};

/**
 * Send a prompt to OpenCode and return the assistant's reply text.
 * The sessionID is assumed to be valid (verified by ensureSession upstream).
 */
async function promptSync(params: PromptParams): Promise<string> {
  const { handle, sessionID, promptText, effectiveAgent, effectiveModel, deps, inbound } = params;

  const log = { channel: inbound.channel, identityId: inbound.identityId };

  // Validate effectiveAgent against the list of known agents (if available).
  // If the agent is not recognised, drop it rather than sending an unknown name.
  const knownAgents = deps.availableAgents;
  const resolvedAgent =
    effectiveAgent && (!knownAgents || knownAgents.includes(effectiveAgent))
      ? effectiveAgent
      : undefined;

  if (effectiveAgent && resolvedAgent === undefined) {
    deps.logger.warn({ ...log, requestedAgent: effectiveAgent, knownAgents }, "promptSync: agent not found in available list, omitting agent param");
  }

  deps.logger.info({ ...log, sessionID, agent: resolvedAgent }, "prompt: sending");

  const payload = {
    sessionID,
    parts: [{ type: "text" as const, text: promptText }],
    ...(resolvedAgent ? { agent: resolvedAgent } : {}),
    ...(effectiveModel ? { model: effectiveModel } : {}),
  };

  const t0 = Date.now();
  const result = await handle.client.session.prompt(payload);
  deps.logger.debug({ ...log, sessionID, result: JSON.stringify(result).slice(0, 500) }, "prompt: raw result");
  const text = extractPromptText(result);
  deps.logger.info({ ...log, sessionID, textLength: text.length, ms: Date.now() - t0 }, "prompt: done");
  return text;
}

// ─── Pipeline stages ──────────────────────────────────────────────────────────

/**
 * Stage 1 — Normalize the raw message into a canonical PipelineInboundMessage.
 * Converts text-only messages into a `parts` array for uniform downstream handling.
 */
function normalizeMessage(message: PipelineInboundMessage): PipelineInboundMessage {
  const normalizedParts: InboundMessagePart[] =
    Array.isArray(message.parts) && message.parts.length
      ? message.parts
      : message.text.trim()
        ? [{ type: "text", text: message.text }]
        : [];
  const inboundText = textFromInboundParts(normalizedParts, message.text).trim();
  return {
    ...message,
    text: inboundText,
    ...(normalizedParts.length ? { parts: normalizedParts } : {}),
  };
}

/**
 * Stage 2 — Gate: drop self-authored messages and disabled plugin identities.
 * Returns true if the message should be dropped.
 */
function shouldDropMessage(
  inbound: PipelineInboundMessage,
  pluginIdentities: BridgeMessagePipelineDeps["pluginIdentities"],
  logger: Logger,
): boolean {
  if (inbound.fromMe) {
    logger.debug({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId }, "inbound ignored (self-authored)");
    return true;
  }

  const configuredIdentity = getBridgePluginIdentity(pluginIdentities, inbound.channel, inbound.identityId);
  if (pluginIdentities.has(inbound.channel) && (!configuredIdentity || configuredIdentity.enabled === false)) {
    logger.warn({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId }, "channel inbound ignored (identity disabled or missing)");
    return true;
  }

  return false;
}

/**
 * Stage 3 — Pairing gate: if the channel uses identity pairing (e.g. Telegram
 * private mode), let the pairing handler inspect the message first.
 * Returns refreshed { binding, session } from the store after pairing.
 */
async function runPairingGate(
  inbound: PipelineInboundMessage,
  peerKey: string,
  deps: BridgeMessagePipelineDeps,
): Promise<{ handled: boolean; binding: any; session: any }> {
  let binding = deps.store.getBinding(inbound.channel, inbound.identityId, peerKey);
  let session = deps.store.getSession(inbound.channel, inbound.identityId, peerKey);

  const pairingHandler = deps.channels.getPairingHandler(inbound.channel, inbound.identityId);
  if (!pairingHandler) return { handled: false, binding, session };

  const gate = await deps.channels.handlePairing(inbound.channel, inbound.identityId, {
    identityId: inbound.identityId,
    peerKey,
    peerId: inbound.peerId,
    text: inbound.text.trim(),
    ...(binding?.directory?.trim() ? { bindingDirectory: binding.directory } : {}),
    ...(session?.directory?.trim() ? { sessionDirectory: session.directory ?? undefined } : {}),
  });

  if (gate === "handled") return { handled: true, binding, session };

  // Re-read binding/session — pairing may have updated them
  binding = deps.store.getBinding(inbound.channel, inbound.identityId, peerKey);
  session = deps.store.getSession(inbound.channel, inbound.identityId, peerKey);
  return { handled: false, binding, session };
}

/**
 * Stage 4 — Resolve the workspace directory for this peer.
 *
 * Priority (first non-empty wins):
 *   1. Explicit peer binding (from /bind or auto-bind)
 *   2. Identity-level directory from channel config
 *   3. Policy directory (per-peer provisioned directory)
 *   4. Previously persisted session directory
 *
 * Returns null + sends an error reply if no safe directory can be found.
 */
async function resolveWorkspaceDirectory(
  inbound: PipelineInboundMessage,
  peerKey: string,
  binding: any,
  session: any,
  deps: BridgeMessagePipelineDeps,
): Promise<string | null> {
  const { identityDirectory, policyDirectory } = deps.directoryPolicy
    ? await deps.directoryPolicy.provisionPolicyDirectory({
        channel: inbound.channel,
        identityId: inbound.identityId,
        peerId: inbound.peerId,
        bindingDirectory: binding?.directory,
      })
    : {
        identityDirectory: deps.resolveIdentityDirectory(inbound.channel, inbound.identityId),
        policyDirectory: "",
      };

  const candidate = binding?.directory?.trim() || identityDirectory || policyDirectory || session?.directory?.trim();
  const hasExplicitBinding = Boolean(binding?.directory?.trim() || session?.directory?.trim() || identityDirectory);

  if (!candidate || (!hasExplicitBinding && deps.isDangerousRootDirectory(candidate))) {
    await deps.sendText(
      inbound.channel, inbound.identityId, inbound.peerId,
      "No workspace directory configured for this identity. Ask your OpenWork host to set it, or reply with /dir <path>.",
      { kind: "system" },
    );
    return null;
  }

  const scoped = deps.resolveScopedDirectory(candidate);
  if (!scoped.ok) {
    await deps.sendText(inbound.channel, inbound.identityId, inbound.peerId, scoped.error, { kind: "system" });
    return null;
  }

  return scoped.directory;
}

/**
 * Stage 5 — Provision inbound media files into the resolved workspace directory.
 * Falls back to a local media sub-folder if the provider fails.
 */
async function provisionMediaFiles(
  inbound: PipelineInboundMessage,
  peerKey: string,
  boundDirectory: string,
  deps: BridgeMessagePipelineDeps,
): Promise<void> {
  if (!inbound.parts?.length) return;

  const mediaParts = inbound.parts
    .filter((p) => p.type === "media")
    .map((p) => p.media as { filePath?: string });
  const filePaths = mediaParts.map((m) => m.filePath?.trim() ?? "").filter(Boolean);
  if (!filePaths.length) return;

  try {
    const moved = await deps.provider
      .provisionFiles(filePaths, boundDirectory, inbound.channel, inbound.identityId, peerKey)
      .catch(() =>
        deps.mediaStore.relocateInboundFiles(filePaths, join(boundDirectory, ".opencode-router", "media")),
      );
    for (const m of mediaParts) {
      const src = m.filePath?.trim();
      if (src && moved.has(src)) {
        m.filePath = moved.get(src);
        deps.logger.debug({ src, dst: m.filePath }, "media: provisioned file to workspace");
      }
    }
  } catch (err) {
    deps.logger.warn({ err }, "media: failed to provision files");
  }
}

// ─── Serial inbound handler (one peer at a time) ──────────────────────────────

async function handleInboundSerial(
  message: PipelineInboundMessage,
  deps: BridgeMessagePipelineDeps,
): Promise<void> {
  deps.recordInboundActivity(Date.now());

  // Stage 1 — Normalize
  const inbound = normalizeMessage(message);

  // Stage 2 — Drop self-authored or disabled-identity messages
  if (shouldDropMessage(inbound, deps.pluginIdentities, deps.logger)) return;

  // Log the received message for observability
  const reporterText = inbound.text || summarizeInboundPartsForReporter(inbound.parts) || "[empty message]";
  deps.logger.debug(
    { channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, length: reporterText.length, preview: truncateText(reporterText.trim(), 120) },
    "inbound received",
  );
  deps.logger.info(
    { channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, length: reporterText.length },
    "received message",
  );

  const peerKey = inbound.peerId;
  const trimmedText = inbound.text.trim();

  // Stage 3 — Pairing gate (e.g. Telegram private mode)
  const { handled, binding, session } = await runPairingGate(inbound, peerKey, deps);
  if (handled) return;

  // Stage 3b — Slash command handling (/bind, /unbind, /dir, /abort, etc.)
  if (trimmedText.startsWith("/")) {
    const commandHandled = await deps.handleCommand(inbound.channel, inbound.identityId, peerKey, inbound.peerId, trimmedText);
    if (commandHandled) return;
  }

  // Emit inbound event to reporter (e.g. for admin dashboard)
  deps.reporter?.onInbound?.({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, text: reporterText, fromMe: inbound.fromMe });

  // Stage 4 — Resolve workspace directory
  const boundDirectory = await resolveWorkspaceDirectory(inbound, peerKey, binding, session, deps);
  if (!boundDirectory) return;

  // Stage 5 — Provision attached media files into workspace
  await provisionMediaFiles(inbound, peerKey, boundDirectory, deps);

  // Auto-bind this peer to the resolved directory for future messages
  if (deps.channels.shouldAutoBind(inbound.channel, inbound.identityId) && !binding?.directory?.trim()) {
    deps.store.upsertBinding(inbound.channel, inbound.identityId, peerKey, boundDirectory);
  }

  // Stage 6 — Ensure a valid OpenCode session (creates or reuses+validates)
  const storedSessionId = session?.session_id &&
    deps.normalizeDirectory(session?.directory ?? "") === deps.normalizeDirectory(boundDirectory)
      ? (session.session_id as string)
      : undefined;

  const replyTarget = ((inbound.raw as Record<string, unknown>)?._bridgeReplyTarget as string)?.trim() || inbound.peerId;

  // Stage 7 — Send the prompt to OpenCode and deliver the reply
  try {
    const { sessionID, handle } = await deps.sessionRuntime.ensureSession({
      channel: inbound.channel,
      identityId: inbound.identityId,
      peerId: inbound.peerId,
      peerKey,
      directory: boundDirectory,
      storedSessionId,
    });
    deps.logger.debug(
      { sessionID, channel: inbound.channel, peerId: inbound.peerId, reused: sessionID === storedSessionId },
      "session resolved",
    );

    const effectiveModel = deps.config.model;
    const effectiveAgent = inbound.agentId?.trim() || undefined;
    const attachmentSummary = summarizeInboundPartsForPrompt(inbound.parts);
    const incomingText = inbound.text || "(no text; user sent media)";
    const promptText = [
      incomingText,
      ...(attachmentSummary.length ? ["", "Incoming attachments:", ...attachmentSummary] : []),
    ].join("\n");

    const replyText = await promptSync({ handle, sessionID, promptText, effectiveAgent, effectiveModel, inbound, boundDirectory, peerKey, deps });

    deps.logger.debug({ sessionID, textLength: replyText.length }, "prompt complete");
    const reply = replyText.trim() || "OpenCode completed without a visible text response.";
    await deps.sendText(inbound.channel, inbound.identityId, replyTarget, reply, { kind: "reply" });
  } catch (error) {
    const msg = error instanceof Error ? error.message || "" : String(error);
    deps.logger.error(
      {
        error: {
          message: msg,
          name: error instanceof Error ? error.name : undefined,
          stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : undefined,
          cause: error instanceof Error ? (error as any).cause : undefined,
          status: (error as any)?.status ?? (error as any)?.statusCode ?? undefined,
        },
      },
      "prompt failed",
    );
    await deps.sendText(
      inbound.channel, inbound.identityId, replyTarget,
      `Error: ${msg.trim() ? msg.slice(0, 150) : "failed to reach OpenCode."}`,
      { kind: "reply" },
    );
  }
}

// ─── Pipeline factory ─────────────────────────────────────────────────────────

export function createBridgeMessagePipeline(deps: BridgeMessagePipelineDeps): BridgeMessagePipeline {
  // Per-peer serialization: prevent concurrent message handling for the same peer.
  // This avoids duplicate sandbox initialization and session creation.
  const peerQueues = new Map<string, Promise<void>>();

  function runSerialForPeer(key: string, fn: () => Promise<void>): void {
    const prev = peerQueues.get(key) ?? Promise.resolve();
    const next = prev.then(fn).catch(() => {}).finally(() => {
      if (peerQueues.get(key) === next) peerQueues.delete(key);
    });
    peerQueues.set(key, next);
  }

  return {
    handleInbound(message) {
      if (!deps.hasAdapter(message.channel, message.identityId)) return Promise.resolve();
      const queueKey = `${message.channel}:${message.identityId}:${message.peerId}`;
      runSerialForPeer(queueKey, () => handleInboundSerial(message, deps));
      return Promise.resolve();
    },
  };
}
