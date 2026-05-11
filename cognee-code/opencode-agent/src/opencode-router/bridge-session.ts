import type { Logger } from "pino";
import type { ChannelName, Config } from "./config.js";
import type { BridgeStore } from "./db.js";
import type { OpencodeInstance } from "./opencode-instance.js";
import { buildPermissionRules } from "./opencode.js";

export type SessionRunState = {
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

export type SessionRuntimeDeps = {
    logger: Logger;
    config?: Config;
    store?: BridgeStore;
    instance: OpencodeInstance;
    reportStatus?: (message: string) => void;
    getChannelLabel(channel: string): string;
    formatPeer(channel: ChannelName, peerId: string): string;
    getAdapter(
        key: string,
    ):
        | {
              sendTyping?: (peerId: string) => Promise<void>;
              name: ChannelName;
              identityId: string;
          }
        | undefined;
    typingIntervalMs?: number;
    onEnqueue?: (key: string) => void;
};

export type SessionContextInput = {
    channel: ChannelName;
    identityId: string;
    peerId: string;
    peerKey: string;
    directory: string;
};

export type SessionOperationInput = {
    directory: string;
    sessionID: string;
    channel: ChannelName;
    identityId: string;
    peerKey: string;
};

export class BridgeSessionRuntime {
    readonly activeRuns = new Map<string, SessionRunState>();
    private readonly sessionQueue = new Map<string, Promise<void>>();
    private readonly sessionModels = new Map<
        string,
        { providerID: string; modelID: string }
    >();
    private readonly typingLoops = new Map<string, NodeJS.Timeout>();

    constructor(private readonly deps: SessionRuntimeDeps) {}

    keyForSession(directory: string, sessionID: string): string {
        return `${directory}::${sessionID}`;
    }

    getPending(key: string): Promise<void> | undefined {
        return this.sessionQueue.get(key);
    }

    async waitForSessionIdle(input: {
        channel: ChannelName;
        identityId: string;
        peerKey: string;
        defaultDirectory: string;
    }): Promise<void> {
        if (!this.deps.store) return;
        const session = this.deps.store.getSession(
            input.channel,
            input.identityId,
            input.peerKey,
        );
        const sessionID = session?.session_id;
        const directory =
            session?.directory?.trim() ||
            this.deps.store
                .getBinding(input.channel, input.identityId, input.peerKey)
                ?.directory?.trim() ||
            input.defaultDirectory;
        const pending =
            sessionID && directory
                ? this.getPending(this.keyForSession(directory, sessionID))
                : null;
        if (pending) await pending;
    }

    async getHandle(input: {
        channel: ChannelName;
        identityId: string;
        peerKey: string;
        directory: string;
    }) {
        const sandboxId = this.deps.store?.getSandbox(input.channel, input.identityId, input.peerKey)?.sandbox_id;
        return this.deps.instance.getClient({
            ...input,
            sandboxId: sandboxId ?? undefined,
        });
    }

    async createSession(input: SessionContextInput): Promise<string> {
        if (!this.deps.config || !this.deps.store)
            throw new Error("SessionRuntime config/store are not configured");
        const title = `opencode-router ${input.channel}/${input.identityId} ${input.peerId}`;
        const existingSession = this.deps.store.getSession(
            input.channel,
            input.identityId,
            input.peerKey,
        );
        const handle = await this.getHandle({
            channel: input.channel,
            identityId: input.identityId,
            peerKey: input.peerKey,
            directory: existingSession?.directory ?? input.directory,
        });
        const session = await handle.client.session.create({
            title,
            permission: buildPermissionRules(this.deps.config.permissionMode),
        });
        const sessionID = (session as { id?: string }).id;
        if (!sessionID) throw new Error("Failed to create session");
        this.deps.store.upsertSession(
            input.channel,
            input.identityId,
            input.peerKey,
            sessionID,
            input.directory,
        );
        this.deps.logger.info(
            {
                sessionID,
                channel: input.channel,
                identityId: input.identityId,
                peerId: input.peerKey,
                directory: input.directory,
            },
            "session created",
        );
        this.deps.reportStatus?.(
            `${this.deps.getChannelLabel(input.channel)}/${input.identityId} session created for ${this.deps.formatPeer(input.channel, input.peerId)} (ID: ${sessionID}).`,
        );
        return sessionID;
    }

    async abortSession(input: SessionOperationInput): Promise<void> {
        const handle = await this.getHandle(input);
        await handle.client.session.abort({ sessionID: input.sessionID });
    }

    async compactSession(input: SessionOperationInput): Promise<void> {
        const handle = await this.getHandle(input);
        const client = handle.client;
        await client.session.summarize({
            sessionID: input.sessionID,
        });
    }

    enqueue(key: string, task: () => Promise<void>): void {
        this.deps.onEnqueue?.(key);
        const previous = this.sessionQueue.get(key) ?? Promise.resolve();
        const next = previous
            .then(task)
            .catch((error) => {
                this.deps.logger.error({ error }, "session task failed");
            })
            .finally(() => {
                if (this.sessionQueue.get(key) === next) {
                    this.sessionQueue.delete(key);
                }
            });
        this.sessionQueue.set(key, next);
    }

    reportThinking(run: SessionRunState): void {
        if (!this.deps.reportStatus) return;
        const modelLabel = this.formatModelLabel(
            this.sessionModels.get(run.key),
        );
        const nextLabel = modelLabel
            ? `Thinking (${modelLabel})`
            : "Thinking...";
        if (run.thinkingLabel === nextLabel && run.thinkingActive) return;
        run.thinkingLabel = nextLabel;
        run.thinkingActive = true;
        this.deps.reportStatus(
            `[${this.deps.getChannelLabel(run.channel)}/${run.identityId}] ${this.deps.formatPeer(run.channel, run.peerId)} ${nextLabel}`,
        );
    }

    reportDone(run: SessionRunState): void {
        if (!this.deps.reportStatus || !run.thinkingActive) return;
        const modelLabel = this.formatModelLabel(
            this.sessionModels.get(run.key),
        );
        const suffix = modelLabel ? ` (${modelLabel})` : "";
        this.deps.reportStatus(
            `[${this.deps.getChannelLabel(run.channel)}/${run.identityId}] ${this.deps.formatPeer(run.channel, run.peerId)} Done${suffix}`,
        );
        run.thinkingActive = false;
    }

    startTyping(run: SessionRunState): void {
        const adapter = this.deps.getAdapter(run.adapterKey);
        if (!adapter?.sendTyping) return;
        if (this.typingLoops.has(run.key)) return;
        const sendTyping = async () => {
            try {
                await adapter.sendTyping?.(run.peerId);
            } catch (error) {
                this.deps.logger.warn(
                    { error, channel: run.channel, identityId: run.identityId },
                    "typing update failed",
                );
            }
        };
        void sendTyping();
        const timer = setInterval(
            sendTyping,
            this.deps.typingIntervalMs ?? 6000,
        );
        this.typingLoops.set(run.key, timer);
    }

    stopTyping(key: string): void {
        const timer = this.typingLoops.get(key);
        if (!timer) return;
        clearInterval(timer);
        this.typingLoops.delete(key);
    }

    stopAllTyping(): void {
        for (const timer of this.typingLoops.values()) {
            clearInterval(timer);
        }
        this.typingLoops.clear();
    }

    private formatModelLabel(model?: {
        providerID: string;
        modelID: string;
    }): string | null {
        return model ? `${model.providerID}/${model.modelID}` : null;
    }
}
