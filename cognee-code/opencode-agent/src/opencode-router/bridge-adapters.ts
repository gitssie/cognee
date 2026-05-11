import { setTimeout as delay } from "node:timers/promises";
import type { ChannelName } from "./config.js";
import type { MessageDeliveryResult, OutboundMessagePart } from "./media.js";

export type BridgeAdapter = {
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

export type AdapterStartResult =
    | { status: "started" }
    | { status: "timeout" }
    | { status: "error"; error: unknown };

export async function startAdapterBounded(
    adapter: BridgeAdapter,
    options: { timeoutMs: number; onError?: (error: unknown) => void },
): Promise<AdapterStartResult> {
    const outcome = adapter
        .start()
        .then(() => ({ ok: true as const }))
        .catch((error) => ({ ok: false as const, error }));

    if (options.onError) {
        void outcome.then((result) => {
            if (!result.ok) options.onError?.(result.error);
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

export class AdapterRegistry {
    constructor(private readonly adapters = new Map<string, BridgeAdapter>()) {}

    get size(): number {
        return this.adapters.size;
    }

    usingInjected(source?: Map<string, BridgeAdapter>): boolean {
        return Boolean(source);
    }

    get(key: string): BridgeAdapter | undefined {
        return this.adapters.get(key);
    }

    has(key: string): boolean {
        return this.adapters.has(key);
    }

    set(key: string, adapter: BridgeAdapter): void {
        this.adapters.set(key, adapter);
    }

    delete(key: string): boolean {
        return this.adapters.delete(key);
    }

    keys(): IterableIterator<string> {
        return this.adapters.keys();
    }

    values(): IterableIterator<BridgeAdapter> {
        return this.adapters.values();
    }

    entries(): IterableIterator<[string, BridgeAdapter]> {
        return this.adapters.entries();
    }

    toMap(): Map<string, BridgeAdapter> {
        return this.adapters;
    }

    hasChannel(channel: ChannelName): boolean {
        return Array.from(this.adapters.keys()).some((key) => key.startsWith(`${channel}:`));
    }

    find(predicate: (adapter: BridgeAdapter) => boolean): BridgeAdapter | undefined {
        return Array.from(this.adapters.values()).find(predicate);
    }

    async stopAll(): Promise<void> {
        for (const adapter of this.adapters.values()) {
            await adapter.stop();
        }
    }
}
