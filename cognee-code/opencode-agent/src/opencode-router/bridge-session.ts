import type { Logger } from "pino";
import type { ChannelName, Config } from "./config.js";
import type { BridgeStore } from "./db.js";
import type { OpenCodeClientProvider } from "./client-provider.js";
import { buildPermissionRules } from "./opencode.js";

export type SessionRuntimeDeps = {
    logger: Logger;
    config?: Config;
    store?: BridgeStore;
    provider: OpenCodeClientProvider;
    reportStatus?: (message: string) => void;
    getChannelLabel(channel: string): string;
    formatPeer(channel: ChannelName, peerId: string): string;
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
    constructor(private readonly deps: SessionRuntimeDeps) {}

    async getHandle(input: {
        channel: ChannelName;
        identityId: string;
        peerKey: string;
        directory: string;
    }) {
        const sandboxId = (await this.deps.store?.getSandbox(input.channel, input.identityId, input.peerKey))?.sandbox_id;
        return this.deps.provider.getClientForSession({
            ...input,
            sandboxId: sandboxId ?? undefined,
        });
    }

    /**
     * Ensure a valid OpenCode session exists for this peer+directory.
     *
     * - Reuses the stored sessionID when the directory matches AND the session
     *   still exists on the server (verified via GET /session/{id}).
     * - Creates a new session when the directory changed, the store is empty,
     *   or the stored sessionID is stale (e.g. after a sandbox restart).
     */
    async ensureSession(input: SessionContextInput & { storedSessionId?: string }): Promise<{ sessionID: string; handle: Awaited<ReturnType<BridgeSessionRuntime["getHandle"]>> }> {
        if (!this.deps.config || !this.deps.store)
            throw new Error("SessionRuntime config/store are not configured");

        const handle = await this.getHandle({
            channel: input.channel,
            identityId: input.identityId,
            peerKey: input.peerKey,
            directory: input.directory,
        });

        const storedId = input.storedSessionId?.trim();
        if (storedId) {
            const alive = await this.isSessionAlive(handle.client, storedId);
            this.deps.logger.debug(
                { channel: input.channel, identityId: input.identityId, sessionID: storedId, alive },
                "session-resolve: isSessionAlive result",
            );
            if (alive) return { sessionID: storedId, handle };
            this.deps.logger.warn(
                { channel: input.channel, identityId: input.identityId, sessionID: storedId },
                "stored sessionID is stale, creating a new session",
            );
        }

        const sessionID = await this.createSessionWithHandle(input, handle);
        return { sessionID, handle };
    }

    private async isSessionAlive(client: any, sessionID: string): Promise<boolean> {
        try {
            await client.session.get({ sessionID });
            return true;
        } catch {
            return false;
        }
    }

    private async createSessionWithHandle(
        input: SessionContextInput,
        handle: Awaited<ReturnType<typeof this.getHandle>>,
    ): Promise<string> {
        const title = `opencode-router ${input.channel}/${input.identityId} ${input.peerId}`;
        const sessionPayload = {
            title,
            directory: input.directory,
            permission: buildPermissionRules(this.deps.config!.permissionMode),
        };
        const session = await handle.client.session.create(sessionPayload);
        const sessionID =
            (session as { data?: { id?: string } }).data?.id ??
            (session as { id?: string }).id;
        if (!sessionID) throw new Error("Failed to create session");
        await this.deps.store!.upsertSession(
            input.channel,
            input.identityId,
            input.peerKey,
            sessionID,
            input.directory,
        );
        this.deps.logger.info(
            { sessionID, channel: input.channel, identityId: input.identityId, peerId: input.peerKey, directory: input.directory },
            "session created",
        );
        this.deps.reportStatus?.(
            `${this.deps.getChannelLabel(input.channel)}/${input.identityId} session created for ${this.deps.formatPeer(input.channel, input.peerId)} (ID: ${sessionID}).`,
        );
        return sessionID;
    }

    async createSession(input: SessionContextInput): Promise<string> {
        if (!this.deps.config || !this.deps.store)
            throw new Error("SessionRuntime config/store are not configured");
        const existingSession = await this.deps.store.getSession(
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
        return this.createSessionWithHandle(input, handle);
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
}
