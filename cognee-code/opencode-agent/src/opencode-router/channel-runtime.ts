/**
 * OpenClaw-compatible channel runtime for the opencode-router plugin host.
 *
 * Implements channel.routing, channel.session, channel.reply, channel.media
 * backed by router infrastructure (BridgeStore, MediaStore, OpenCode client).
 *
 * OpenClaw-compatible channel plugins depend on these services to:
 *  - resolve routing (which OpenCode session to use)
 *  - read/write session timestamps
 *  - format and dispatch inbound context to OpenCode
 *  - save inbound media to the media store
 *  - fetch remote media
 *
 * Dispatch strategy (dispatchReplyWithBufferedBlockDispatcher):
 *  Delegates to bridge.ts unified inbound pipeline — session management, prompt,
 *  retries, tool updates, and reply delivery all handled there.
 */

import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

import type { Logger } from "pino";

import { BridgeStore } from "./db.js";
import { MediaStore } from "./media-store.js";
import type { Config, ChannelName } from "./config.js";
import type { InboundMessagePart, MediaKind } from "./media.js";
import { chunkText } from "./text.js";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type AgentRoute = {
  /** OpenCode session key used for routing (peer-scoped) */
  sessionKey: string;
  /** Optional agentId override from config */
  agentId?: string;
  /** accountId for the channel identity */
  accountId: string;
};

export type InboundContext = {
  Body: string;
  RawBody: string;
  CommandBody?: string;
  Attachments?: Array<{ name?: string; mimeType?: string; url?: string }>;
  From?: string;
  To?: string;
  SessionKey?: string;
  AccountId?: string;
  ChatType?: string;
  ConversationLabel?: string;
  SenderName?: string;
  SenderId?: string;
  Provider?: string;
  Surface?: string;
  MessageSid?: string;
  CommandAuthorized?: boolean;
  OriginatingChannel?: string;
  OriginatingTo?: string;
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  [key: string]: unknown;
};

export type EnvelopeOptions = {
  includeTimestamp: boolean;
  includeFrom: boolean;
};

export type DeliverPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
};

export type DeliverInfo = {
  kind: string;
};

export type DispatchOptions = {
  ctx: InboundContext;
  cfg: unknown;
  replyOptions?: { disableBlockStreaming?: boolean };
  dispatcherOptions: {
    deliver: (payload: DeliverPayload, info: DeliverInfo) => Promise<void>;
    onError?: (err: unknown, info: DeliverInfo) => void;
  };
};

export type SavedMedia = {
  path: string;
  contentType: string;
};

export type FetchedMedia = {
  buffer: Buffer;
  contentType: string;
  fileName?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Classify a MIME type string into the media kind used by InboundMediaAttachment. */
function mimeToMediaKind(mimeType: string): MediaKind {
  const base = mimeType.toLowerCase().split(";")[0].trim();
  if (base.startsWith("image/")) return "image";
  if (base.startsWith("audio/")) return "audio";
  return "file";
}

/** Extract a file name from a URL pathname, ignoring query strings. */
function fileNameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "media";
  } catch {
    return url.split("/").pop()?.split("?")[0] || "media";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Routing helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the OpenCode agent name from a config object.
 *
 * The cfg passed by the channel plugin is the full opencode-router.json.
 * Priority:
 *  1. Per-account:   cfg.channels.<channel>.accounts.<accountId>.opencode.agent
 *  2. Top-level:     cfg.opencode.agent
 *  3. Legacy:        cfg.agent.agentId
 */
function resolveOpencodeAgent(cfg: unknown, channel: string, accountId: string): string | undefined {
  const c = cfg as any;
  const fromAccount = c?.channels?.[channel]?.accounts?.[accountId]?.opencode?.agent as string | undefined;
  if (fromAccount?.trim()) return fromAccount.trim();
  const fromTop = c?.opencode?.agent as string | undefined;
  if (fromTop?.trim()) return fromTop.trim();
  const fromLegacy = c?.agent?.agentId as string | undefined;
  if (fromLegacy?.trim()) return fromLegacy.trim();
  return undefined;
}

function resolveAgentRoute(params: {
  cfg: unknown;
  channel: string;
  accountId: string;
  peer: { kind: "direct" | "group"; id: string };
}): AgentRoute {
  const agentId = resolveOpencodeAgent(params.cfg, params.channel, params.accountId);
  const sessionKey = `${params.channel}:${params.accountId}:${params.peer.kind}:${params.peer.id}`;
  return { sessionKey, agentId, accountId: params.accountId };
}

// ──────────────────────────────────────────────────────────────────────────────
// InboundMessagePart builder — converts InboundContext → InboundMessagePart[]
// ──────────────────────────────────────────────────────────────────────────────

function buildInboundParts(ctx: InboundContext): InboundMessagePart[] {
  const parts: InboundMessagePart[] = [];
  const bodyText = String(ctx.Body ?? ctx.RawBody ?? "").trim();
  const source = String(ctx.OriginatingChannel ?? ctx.Provider ?? "channel").trim().toLowerCase() || "channel";

  if (bodyText) {
    parts.push({ type: "text", text: bodyText });
  }

  // Primary media attachment from ctx.MediaPath
  if (typeof ctx.MediaPath === "string" && ctx.MediaPath.trim()) {
    const filePath = ctx.MediaPath.trim();
    const mimeType = typeof ctx.MediaType === "string" && ctx.MediaType.trim()
      ? ctx.MediaType.trim()
      : "application/octet-stream";
    parts.push({
      type: "media",
      media: {
        id: randomUUID(),
        kind: mimeToMediaKind(mimeType),
        source,
        status: "ready",
        filePath,
        filename: basename(filePath),
        mimeType,
      },
    });
  }

  // Additional attachments (e.g. multi-image or voice messages)
  if (Array.isArray(ctx.Attachments)) {
    for (const att of ctx.Attachments as Array<{ url?: string; mimeType?: string; name?: string }>) {
      const filePath = att.url?.trim();
      if (!filePath) continue;
      // Deduplicate against MediaPath already added above
      if (parts.some((p) => p.type === "media" && p.media.filePath === filePath)) continue;
      const mimeType = att.mimeType ?? "application/octet-stream";
      parts.push({
        type: "media",
        media: {
          id: randomUUID(),
          kind: mimeToMediaKind(mimeType),
          source,
          status: "ready",
          filePath,
          filename: att.name ?? basename(filePath),
          mimeType,
        },
      });
    }
  }

  return parts;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public factory
// ──────────────────────────────────────────────────────────────────────────────

export type ChannelRuntimeDeps = {
  config: Config;
  store: BridgeStore;
  mediaStore: MediaStore;
  logger: Logger;
  /**
   * Bridge handleInbound — delegates inbound messages directly to bridge.ts
   * unified pipeline for session management, prompt, retries, and reply delivery.
   */
  handleInbound: (message: {
    channel: ChannelName;
    identityId: string;
    peerId: string;
    text: string;
    agentId?: string;
    parts?: InboundMessagePart[];
    raw: unknown;
    fromMe?: boolean;
  }) => Promise<void>;
};

export function createChannelRuntime(deps: ChannelRuntimeDeps) {
  const { config, store, mediaStore, logger } = deps;

  return {
    channel: {
      // ── text ─────────────────────────────────────────────────────────────────
      text: {
        chunkMarkdownText: (text: string, limit: number): string[] =>
          chunkText(text, limit > 0 ? limit : 4000),
        chunkText: (text: string, limit: number): string[] =>
          chunkText(text, limit > 0 ? limit : 4000),
        resolveMarkdownTableMode: (_config?: unknown): "keep" => "keep",
        convertMarkdownTables: (text: string, _mode?: unknown): string => text,
      },

      // ── routing ──────────────────────────────────────────────────────────────
      routing: {
        resolveAgentRoute(params: {
          cfg: unknown;
          channel: string;
          accountId: string;
          peer: { kind: "direct" | "group"; id: string };
        }): AgentRoute {
          return resolveAgentRoute(params);
        },
      },

      // ── session ──────────────────────────────────────────────────────────────
      session: {
        resolveStorePath(_storeConfig: unknown, opts?: { agentId?: string }): string {
          const dataDir = config.dataDir ?? join(process.cwd(), ".tmp", "opencode-router", "data");
          const suffix = opts?.agentId ? `/${opts.agentId}` : "";
          return join(dataDir, `sessions${suffix}`);
        },

        readSessionUpdatedAt(_params: { storePath: string; sessionKey: string }): number | undefined {
          // Session timestamps are managed by bridge.ts BridgeStore
          return undefined;
        },

        async recordInboundSession(_params: {
          storePath: string;
          sessionKey: string;
          ctx: InboundContext;
          onRecordError?: (err: unknown) => void;
        }): Promise<void> {
          // Session recording is handled by bridge.ts
        },
      },

      // ── reply ─────────────────────────────────────────────────────────────────
      reply: {
        resolveEnvelopeFormatOptions(_cfg: unknown): EnvelopeOptions {
          return { includeTimestamp: true, includeFrom: true };
        },

        formatAgentEnvelope(params: {
          channel: string;
          from: string;
          previousTimestamp?: number;
          envelope: EnvelopeOptions;
          body: string;
        }): string {
          const lines: string[] = [];
          if (params.envelope.includeTimestamp) {
            const ts = params.previousTimestamp
              ? `(prev: ${new Date(params.previousTimestamp).toISOString()})`
              : `(${new Date().toISOString()})`;
            lines.push(`[${params.channel}] ${params.from} ${ts}`);
          }
          lines.push(params.body);
          return lines.join("\n");
        },

        finalizeInboundContext(params: InboundContext): InboundContext {
          return { ...params };
        },

        async dispatchReplyWithBufferedBlockDispatcher(options: DispatchOptions): Promise<void> {
          const { ctx, dispatcherOptions } = options;
          const { onError } = dispatcherOptions;

          const accountId = String(ctx.AccountId ?? "default");
          const channel = (String(ctx.OriginatingChannel ?? ctx.Provider ?? "channel").trim().toLowerCase() || "channel") as ChannelName;
          const peerId = String(ctx.SenderId ?? ctx.From ?? "unknown");
          const bodyText = String(ctx.Body ?? ctx.RawBody ?? "").trim();

          const inboundParts = buildInboundParts(ctx);

          if (inboundParts.length === 0) {
            logger.warn({ accountId, peerId }, "channel-runtime: empty prompt and no media, skipping dispatch");
            return;
          }

          const mediaCount = inboundParts.filter((p) => p.type === "media").length;
          const route = resolveAgentRoute({
            cfg: options.cfg,
            channel,
            accountId,
            peer: { kind: "direct", id: peerId },
          });
          logger.info({ channel, accountId, peerId, mediaCount }, "channel-runtime: delegating to bridge handleInbound");

          try {
            await deps.handleInbound({
              channel,
              identityId: accountId,
              peerId,
              text: bodyText,
              agentId: route.agentId,
              parts: inboundParts,
              raw: ctx,
            });
          } catch (err) {
            logger.error({ err, accountId, peerId }, "channel-runtime: bridge handleInbound failed");
            onError?.(err, { kind: "error" });
          }
        },
      },

      // ── media ─────────────────────────────────────────────────────────────────
      media: {
        async saveMediaBuffer(
          buffer: Buffer,
          contentType: string,
          _context: string,
          _maxBytes?: number,
          originalFileName?: string,
        ): Promise<SavedMedia> {
          // Temporarily store in the global media root.
          // bridge.ts handleInbound will relocate the file to the correct peer
          // workspace directory once boundDirectory is resolved.
          const stored = await mediaStore.saveInboundBuffer({
            channel: "inbound",
            identityId: "default",
            peerId: "pending",
            kind: mimeToMediaKind(contentType),
            buffer: new Uint8Array(buffer),
            mimeType: contentType,
            ...(originalFileName ? { filename: originalFileName } : {}),
          });
          return { path: stored.filePath, contentType };
        },

        async fetchRemoteMedia(params: { url: string; headers?: Record<string, string> }): Promise<FetchedMedia> {
          const res = await fetch(params.url, {
            signal: AbortSignal.timeout(30_000),
            ...(params.headers ? { headers: params.headers } : {}),
          });
          if (!res.ok) {
            throw new Error(`fetchRemoteMedia failed: ${res.status} ${res.statusText}`);
          }
          const buffer = Buffer.from(await res.arrayBuffer());
          const contentType = res.headers.get("content-type") ?? "application/octet-stream";
          return { buffer, contentType, fileName: fileNameFromUrl(params.url) };
        },
      },
    },
  };
}

export type ChannelRuntime = ReturnType<typeof createChannelRuntime>;
