import type { ChannelName } from "./config.js";
import { classifyDeliveryError } from "./delivery.js";
import { type MessageDeliveryResult, type OutboundMessagePart, normalizeOutboundParts } from "./media.js";
import type { MediaStore } from "./media-store.js";
import { chunkText, truncateText } from "./text.js";
import type { BridgeAdapter } from "./bridge-adapters.js";

export type BridgeMediaFlowDeps = {
    mediaStore: MediaStore;
    getAdapter(key: string): BridgeAdapter | undefined;
    adapterKey(channel: ChannelName, identityId: string): string;
    reporter?: {
        onOutbound?: (message: {
            channel: ChannelName;
            identityId: string;
            peerId: string;
            text: string;
            kind: "reply" | "system" | "tool";
        }) => void;
    };
    recordOutboundActivity(now: number): void;
    maxBytes?: number;
};

export class BridgeMediaFlow {
    private readonly outboundMediaMaxBytes: number;

    constructor(private readonly deps: BridgeMediaFlowDeps) {
        this.outboundMediaMaxBytes = deps.maxBytes ?? parseMaxBytes();
    }

    async resolveOutboundParts(baseDirectory: string, input: { text?: string; parts?: unknown }): Promise<OutboundMessagePart[]> {
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
            const file = await this.deps.mediaStore.resolveOutboundFile({
                filePath: part.filePath,
                baseDirectory,
                maxBytes: this.outboundMediaMaxBytes,
            });
            resolved.push({ ...part, filePath: file.filePath, ...(part.filename ? {} : { filename: file.filename }) });
        }
        return resolved;
    }

    async deliverParts(
        channel: ChannelName,
        identityId: string,
        peerId: string,
        parts: OutboundMessagePart[],
        options: { kind?: "reply" | "system" | "tool"; display?: boolean } = {},
    ): Promise<MessageDeliveryResult> {
        const adapter = this.deps.getAdapter(this.deps.adapterKey(channel, identityId));
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
                const preview = part.type === "text" ? truncateText(part.text, 240) : `[${part.type}] ${part.filename || part.filePath}`;
                this.deps.reporter?.onOutbound?.({ channel, identityId, peerId, text: preview, kind });
            }
        }

        this.deps.recordOutboundActivity(Date.now());

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
                    for (const chunk of chunkText(part.text, adapter.maxTextLength)) await adapter.sendText(peerId, chunk);
                } else if (adapter.sendFile) {
                    await adapter.sendFile(peerId, part.filePath, part.caption);
                } else {
                    throw new Error(`Adapter does not support ${part.type} media`);
                }
                sentParts += 1;
                partResults.push({ index, type: part.type, sent: true });
            } catch (error) {
                const classified = classifyDeliveryError(error);
                partResults.push({ index, type: part.type, sent: false, error: classified.message, code: classified.code, retryable: classified.retryable });
            }
        }

        return { attemptedParts: parts.length, sentParts, partResults };
    }
}

function parseMaxBytes(): number {
    const raw = Number.parseInt(process.env.OPENCODE_ROUTER_MAX_MEDIA_BYTES ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 50 * 1024 * 1024;
}
