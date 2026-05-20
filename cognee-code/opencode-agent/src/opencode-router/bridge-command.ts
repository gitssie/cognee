import type { Logger } from "pino";

import type { ChannelName } from "./config.js";
import type { BridgeStore } from "./db.js";
import type { ChannelRegistry } from "./bridge-channel.js";

export type CommandSendOptions = { kind?: "reply" | "system" | "tool"; display?: boolean };

export type BridgeCommandContext = {
    channel: ChannelName;
    identityId: string;
    peerKey: string;
    peerId: string;
    text: string;
};

export type BridgeCommandRouterDeps = {
    store: BridgeStore;
    logger: Logger;
    workspaceRoot: string;
    channels: ChannelRegistry;
    sendText(
        channel: ChannelName,
        identityId: string,
        peerId: string,
        text: string,
        options?: CommandSendOptions,
    ): Promise<void>;
    resolveIdentityDirectory(channel: ChannelName, identityId: string): string;
    resolveScopedDirectory(input: string): { ok: true; directory: string } | { ok: false; error: string };
    stopActiveRun(input: {
        directory: string;
        sessionID: string;
        channel: ChannelName;
        identityId: string;
        peerKey: string;
    }): Promise<void>;
    compactSession(input: {
        directory: string;
        sessionID: string;
        channel: ChannelName;
        identityId: string;
        peerKey: string;
    }): Promise<void>;
};

export type BridgeCommandRouter = {
    route(context: BridgeCommandContext): Promise<boolean>;
};

export function createBridgeCommandRouter(deps: BridgeCommandRouterDeps): BridgeCommandRouter {
    const sendSystem = (
        channel: ChannelName,
        identityId: string,
        peerId: string,
        text: string,
    ) => deps.sendText(channel, identityId, peerId, text, { kind: "system" });

    return {
        async route({ channel, identityId, peerKey, peerId, text }) {
            const parts = text.slice(1).split(/\s+/);
            const command = parts[0]?.toLowerCase();
            const args = parts.slice(1);

            if (command === "reset") {
                await deps.store.clearSession(channel, identityId, peerKey);
                await sendSystem(channel, identityId, peerId, "Session reset. Send a message to start fresh.");
                deps.logger.info({ channel, peerId: peerKey }, "session reset");
                return true;
            }

            if (command === "new") {
                await deps.store.clearSession(channel, identityId, peerKey);
                await sendSystem(channel, identityId, peerId, "Started a fresh session. Send a message to continue.");
                return true;
            }

            if (command === "stop") {
                const session = await deps.store.getSession(channel, identityId, peerKey);
                if (!session?.session_id) {
                    await sendSystem(channel, identityId, peerId, "No active session to stop.");
                    return true;
                }
                const directory =
                    session.directory?.trim() ||
                    deps.resolveIdentityDirectory(channel, identityId);
                if (!directory) {
                    await sendSystem(channel, identityId, peerId, "No workspace directory configured for this session.");
                    return true;
                }
                await deps.stopActiveRun({
                    directory,
                    sessionID: session.session_id,
                    channel,
                    identityId,
                    peerKey,
                });
                await sendSystem(channel, identityId, peerId, "Stopped the active run.");
                return true;
            }

            if (command === "compact") {
                const session = await deps.store.getSession(channel, identityId, peerKey);
                if (!session?.session_id) {
                    await sendSystem(channel, identityId, peerId, "No session to compact yet. Send a message first.");
                    return true;
                }
                const directory =
                    session.directory?.trim() ||
                    deps.resolveIdentityDirectory(channel, identityId);
                if (!directory) {
                    await sendSystem(channel, identityId, peerId, "No workspace directory configured for this session.");
                    return true;
                }
                await deps.compactSession({
                    directory,
                    sessionID: session.session_id,
                    channel,
                    identityId,
                    peerKey,
                });
                await sendSystem(channel, identityId, peerId, "Session compacted.");
                return true;
            }

            if (command === "pair") {
                const pairingHandler = deps.channels.getPairingHandler(channel, identityId);
                if (!pairingHandler) {
                    await sendSystem(channel, identityId, peerId, "Pairing is not available for this channel.");
                    return true;
                }
                const binding = await deps.store.getBinding(channel, identityId, peerKey);
                const session = await deps.store.getSession(channel, identityId, peerKey);
                const pairing = await deps.channels.handlePairing(channel, identityId, {
                    identityId,
                    peerKey,
                    peerId,
                    text,
                    ...(binding?.directory?.trim() ? { bindingDirectory: binding.directory } : {}),
                    ...(session?.directory?.trim() ? { sessionDirectory: session.directory ?? undefined } : {}),
                });
                if (pairing === "handled") return true;
                await sendSystem(channel, identityId, peerId, "This chat is already paired.");
                return true;
            }

            if (command === "dir" || command === "cd") {
                const next = args.join(" ").trim();
                if (!next) {
                    const binding = await deps.store.getBinding(channel, identityId, peerKey);
                    const current =
                        binding?.directory?.trim() ||
                        (await deps.store.getSession(channel, identityId, peerKey))?.directory?.trim() ||
                        deps.resolveIdentityDirectory(channel, identityId);
                    await sendSystem(channel, identityId, peerId, `Current directory: ${current || "(none)"}`);
                    return true;
                }
                const scoped = deps.resolveScopedDirectory(next);
                if (!scoped.ok) {
                    await sendSystem(channel, identityId, peerId, scoped.error);
                    return true;
                }
                await deps.store.upsertBinding(channel, identityId, peerKey, scoped.directory);
                await deps.store.clearSession(channel, identityId, peerKey, scoped.directory);
                await sendSystem(channel, identityId, peerId, `Directory set to: ${scoped.directory}`);
                return true;
            }

            if (command === "agent") {
                await sendSystem(
                    channel,
                    identityId,
                    peerId,
                    [`Scope: workspace`, `Directory root: ${deps.workspaceRoot}`, `Current binding is handled by workspace files directly.`].join("\n"),
                );
                return true;
            }

            if (command === "help") {
                await sendSystem(
                    channel,
                    identityId,
                    peerId,
                    `/new - start a fresh session\n/stop - abort the active run\n/compact - summarize current session\n/pair <code> - pair this chat with a private Telegram bot\n/dir <path> - bind this chat to a workspace directory\n/dir - show current directory\n/agent - show workspace agent scope/path\n/reset - start fresh\n/help - this`,
                );
                return true;
            }

            return false;
        },
    };
}
