import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";

import type { Logger } from "pino";

import type { ChannelName, Config } from "./config.js";
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
import type { OpencodeInstance } from "./opencode-instance.js";
import type { ChannelRegistry } from "./bridge-channel.js";

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

type RunStateLike = {
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
    instance: OpencodeInstance;
    mediaStore: MediaStore;
    channels: ChannelRegistry;
    pluginIdentities: Map<string, Map<string, { id: string; enabled: boolean; directory?: string; fingerprint?: string }>>;
    defaultDirectory: string;
    directoryPolicy?: DirectoryPolicy;
    adapterKey(channel: ChannelName, identityId: string): string;
    hasAdapter(channel: ChannelName, identityId: string): boolean;
    recordInboundActivity(now: number): void;
    resolveIdentityDirectory(channel: ChannelName, identityId: string): string;
    isDangerousRootDirectory(directory: string): boolean;
    resolveScopedDirectory(input: string): { ok: true; directory: string } | { ok: false; error: string };
    normalizeDirectory(input: string): string;
    handleCommand(channel: ChannelName, identityId: string, peerKey: string, peerId: string, text: string): Promise<boolean>;
    sendText(channel: ChannelName, identityId: string, peerId: string, text: string, options?: { kind?: "reply" | "system" | "tool" }): Promise<void>;
    sessionRuntime: BridgeSessionRuntime;
    reportThinking(runState: RunStateLike): void;
    reportDone(runState: RunStateLike): void;
    startTyping(runState: RunStateLike): void;
    stopTyping(key: string): void;
};

export type BridgeMessagePipeline = {
    handleInbound(message: PipelineInboundMessage): Promise<void>;
};

export function createBridgeMessagePipeline(deps: BridgeMessagePipelineDeps): BridgeMessagePipeline {
    return {
        async handleInbound(message) {
            if (!deps.hasAdapter(message.channel, message.identityId)) return;
            deps.recordInboundActivity(Date.now());
            const normalizedParts: InboundMessagePart[] =
                Array.isArray(message.parts) && message.parts.length
                    ? message.parts
                    : message.text.trim()
                      ? [{ type: "text", text: message.text }]
                      : [];
            const inboundText = textFromInboundParts(normalizedParts, message.text).trim();
            const inbound: PipelineInboundMessage = {
                ...message,
                text: inboundText,
                ...(normalizedParts.length ? { parts: normalizedParts } : {}),
            };

            if (inbound.fromMe) {
                deps.logger.debug({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId }, "inbound ignored (self-authored)");
                return;
            }

            const configuredPluginIdentity = getBridgePluginIdentity(deps.pluginIdentities, inbound.channel, inbound.identityId);
            if (deps.pluginIdentities.has(inbound.channel) && (!configuredPluginIdentity || configuredPluginIdentity.enabled === false)) {
                deps.logger.warn({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId }, "channel inbound ignored (identity disabled or missing)");
                return;
            }

            const reporterInboundText = inbound.text || summarizeInboundPartsForReporter(inbound.parts) || "[empty message]";
            deps.logger.debug({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, fromMe: inbound.fromMe, length: reporterInboundText.length, preview: truncateText(reporterInboundText.trim(), 120) }, "inbound received");
            deps.logger.info({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, length: reporterInboundText.length }, "received message");

            const peerKey = inbound.peerId;
            const trimmedText = inbound.text.trim();
            let binding = deps.store.getBinding(inbound.channel, inbound.identityId, peerKey);
            let session = deps.store.getSession(inbound.channel, inbound.identityId, peerKey);

            const pairingHandler = deps.channels.getPairingHandler(inbound.channel, inbound.identityId);
            if (pairingHandler) {
                const pairingGate = await deps.channels.handlePairing(inbound.channel, inbound.identityId, {
                    identityId: inbound.identityId,
                    peerKey,
                    peerId: inbound.peerId,
                    text: trimmedText,
                    ...(binding?.directory?.trim() ? { bindingDirectory: binding.directory } : {}),
                    ...(session?.directory?.trim() ? { sessionDirectory: session.directory ?? undefined } : {}),
                });
                if (pairingGate === "handled") return;
                binding = deps.store.getBinding(inbound.channel, inbound.identityId, peerKey);
                session = deps.store.getSession(inbound.channel, inbound.identityId, peerKey);
            }

            if (trimmedText.startsWith("/")) {
                const commandHandled = await deps.handleCommand(inbound.channel, inbound.identityId, peerKey, inbound.peerId, trimmedText);
                if (commandHandled) return;
            }

            deps.reporter?.onInbound?.({
                channel: inbound.channel,
                identityId: inbound.identityId,
                peerId: inbound.peerId,
                text: reporterInboundText,
                fromMe: inbound.fromMe,
            });

            const { identityDirectory, policyDirectory } = deps.directoryPolicy
                ? await deps.directoryPolicy.provisionPolicyDirectory({
                      channel: inbound.channel,
                      identityId: inbound.identityId,
                      peerId: inbound.peerId,
                      bindingDirectory: binding?.directory,
                  })
                : { identityDirectory: deps.resolveIdentityDirectory(inbound.channel, inbound.identityId), policyDirectory: "" };

            const boundDirectoryCandidate =
                binding?.directory?.trim() || identityDirectory || policyDirectory || session?.directory?.trim() || deps.defaultDirectory;
            const hasExplicitBinding = Boolean(binding?.directory?.trim() || session?.directory?.trim() || identityDirectory);
            if (!boundDirectoryCandidate || (!hasExplicitBinding && deps.isDangerousRootDirectory(boundDirectoryCandidate))) {
                await deps.sendText(inbound.channel, inbound.identityId, inbound.peerId, "No workspace directory configured for this identity. Ask your OpenWork host to set it, or reply with /dir <path>.", { kind: "system" });
                return;
            }

            const scopedBound = deps.resolveScopedDirectory(boundDirectoryCandidate);
            if (!scopedBound.ok) {
                await deps.sendText(inbound.channel, inbound.identityId, inbound.peerId, scopedBound.error, { kind: "system" });
                return;
            }
            const boundDirectory = scopedBound.directory;

            if (inbound.parts && inbound.parts.length > 0) {
                const mediaParts = inbound.parts.filter((p) => p.type === "media").map((p) => p.media as { filePath?: string });
                const filePaths = mediaParts.map((m) => m.filePath?.trim() ?? "").filter(Boolean);
                if (filePaths.length > 0) {
                    try {
                        const moved = await deps.instance
                            .provisionFiles(filePaths, { channel: inbound.channel, identityId: inbound.identityId, peerKey, directory: boundDirectory })
                            .catch(() => deps.mediaStore.relocateInboundFiles(filePaths, join(boundDirectory, ".opencode-router", "media")));
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
            }

            const shouldAutoBind = deps.channels.shouldAutoBind(inbound.channel, inbound.identityId);
            if (shouldAutoBind && !binding?.directory?.trim()) {
                deps.store.upsertBinding(inbound.channel, inbound.identityId, peerKey, boundDirectory);
            }

            const sessionID =
                session?.session_id && deps.normalizeDirectory(session?.directory ?? "") === deps.normalizeDirectory(boundDirectory)
                    ? session.session_id
                    : await deps.sessionRuntime.createSession({ channel: inbound.channel, identityId: inbound.identityId, peerId: inbound.peerId, peerKey, directory: boundDirectory });
            const key = deps.sessionRuntime.keyForSession(boundDirectory, sessionID);
            deps.logger.debug({ sessionID, channel: inbound.channel, peerId: inbound.peerId, reused: Boolean(session?.session_id) }, "session resolved");

            deps.sessionRuntime.enqueue(key, async () => {
                const runState: RunStateLike = {
                    key,
                    directory: boundDirectory,
                    sessionID,
                    channel: inbound.channel,
                    identityId: inbound.identityId,
                    adapterKey: deps.adapterKey(inbound.channel, inbound.identityId),
                    peerId: inbound.peerId,
                    peerKey,
                    toolUpdatesEnabled: deps.config.toolUpdatesEnabled,
                    seenToolStates: new Map(),
                };
                deps.sessionRuntime.activeRuns.set(key, runState as any);
                deps.sessionRuntime.reportThinking(runState as any);
                deps.sessionRuntime.startTyping(runState as any);
                try {
                    const effectiveModel = deps.config.model;
                    const effectiveAgent = inbound.agentId?.trim() || undefined;
                    const attachmentSummary = summarizeInboundPartsForPrompt(inbound.parts);
                    const incomingText = inbound.text || "(no text; user sent media)";
                    const promptText = [incomingText, ...(attachmentSummary.length ? ["", "Incoming attachments:", ...attachmentSummary] : [])].join("\n");
                    deps.logger.debug({ sessionID, length: inbound.text.length, agent: effectiveAgent, model: effectiveModel }, "prompt start");

                    type PromptPart = { type?: string; text?: string; ignored?: boolean };
                    const extractReply = (parts: PromptPart[]) => parts.filter((part) => part.type === "text" && !part.ignored).map((part) => part.text ?? "").join("\n").trim();
                    const logPromptResponse = (attempt: "initial" | "retry", parts: PromptPart[]) => {
                        const textParts = parts.filter((part) => part.type === "text" && !part.ignored);
                        deps.logger.debug({ sessionID, attempt, partCount: parts.length, textCount: textParts.length, partTypes: parts.map((p) => p.type), ignoredCount: parts.filter((p) => p.ignored).length }, "prompt response");
                    };
                    const runPrompt = async (): Promise<PromptPart[]> => {
                        const handle = await deps.sessionRuntime.getHandle({ channel: inbound.channel, identityId: inbound.identityId, peerKey, directory: boundDirectory });
                        const response = await handle.client.session.prompt({
                            sessionID,
                            parts: [{ type: "text", text: promptText }],
                            ...(effectiveAgent ? { agent: effectiveAgent } : {}),
                            ...(effectiveModel ? { model: effectiveModel } : {}),
                        });
                        return (response as { parts?: PromptPart[] }).parts ?? [];
                    };
                    const promptWithTimeout = async (label: string): Promise<PromptPart[]> => {
                        const startedAt = Date.now();
                        deps.logger.info({ sessionID, label }, "prompt sent to opencode (waiting for LLM)");
                        let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
                            const elapsed = Math.round((Date.now() - startedAt) / 1000);
                            deps.logger.warn({ sessionID, label, elapsed }, "prompt still waiting for opencode LLM");
                        }, 30_000);
                        try {
                            const result = await Promise.race([
                                runPrompt(),
                                delay(600_000).then(() => {
                                    throw new Error("OpenCode prompt timed out after 600s");
                                }),
                            ]);
                            deps.logger.info({ sessionID, label, elapsed: Math.round((Date.now() - startedAt) / 1000) }, "prompt completed");
                            return result;
                        } finally {
                            if (heartbeat) clearInterval(heartbeat);
                            heartbeat = null;
                        }
                    };

                    let parts = await promptWithTimeout("initial");
                    logPromptResponse("initial", parts);
                    let reply = extractReply(parts);
                    if (!reply && !parts.some((part) => part.type === "tool")) {
                        for (let retry = 0; retry < 3 && !reply; retry++) {
                            deps.logger.warn({ sessionID, retry }, "prompt returned no visible text; retrying");
                            await new Promise((r) => setTimeout(r, 3000 * (retry + 1)));
                            parts = await promptWithTimeout("retry");
                            logPromptResponse("retry", parts);
                            reply = extractReply(parts);
                        }
                    }

                    if (reply) {
                        deps.logger.debug({ sessionID, replyLength: reply.length }, "reply built");
                        await deps.sendText(inbound.channel, inbound.identityId, inbound.peerId, reply, { kind: "reply" });
                    } else {
                        deps.logger.warn({ sessionID, partTypes: parts.map((part) => part.type), ignoredCount: parts.filter((part) => part.ignored).length }, "prompt returned no visible text; clearing session");
                        deps.store.clearSession(inbound.channel, inbound.identityId, peerKey);
                        await deps.sendText(inbound.channel, inbound.identityId, inbound.peerId, "No visible response was generated. I reset this chat session in case stale state was blocking replies. Send your message again.", { kind: "system" });
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message || "" : String(error);
                    deps.logger.error({ error: { message: msg, name: error instanceof Error ? error.name : undefined, stack: error instanceof Error ? error.stack?.split("\n").slice(0, 3).join("\n") : undefined, cause: error instanceof Error ? (error as any).cause : undefined, status: (error as any)?.status ?? (error as any)?.statusCode ?? undefined }, sessionID }, "prompt failed");
                    let errorMessage = "Error: failed to reach OpenCode.";
                    if (msg.includes("401") || msg.includes("Unauthorized")) errorMessage = "Error: OpenCode authentication failed (401). Check credentials.";
                    else if (msg.includes("403") || msg.includes("Forbidden")) errorMessage = "Error: OpenCode access forbidden (403).";
                    else if (msg.includes("404") || msg.includes("Not Found")) errorMessage = "Error: OpenCode endpoint not found (404).";
                    else if (msg.includes("429") || msg.includes("rate limit")) errorMessage = "Error: Rate limited. Please wait and try again.";
                    else if (msg.includes("500") || msg.includes("Internal Server")) errorMessage = "Error: OpenCode server error (500).";
                    else if (msg.includes("model") || msg.includes("provider")) errorMessage = `Error: Model/provider issue - ${msg.slice(0, 100)}`;
                    else if (msg.includes("ECONNREFUSED") || msg.includes("connection")) errorMessage = "Error: Cannot connect to OpenCode. Is it running?";
                    else if (msg.trim()) errorMessage = `Error: ${msg.slice(0, 150)}`;
                    await deps.sendText(inbound.channel, inbound.identityId, inbound.peerId, errorMessage, { kind: "system" });
                } finally {
                    deps.sessionRuntime.stopTyping(key);
                    deps.sessionRuntime.reportDone(runState as any);
                    deps.sessionRuntime.activeRuns.delete(key);
                }
            });
        },
    };
}
