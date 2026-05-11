import type { Logger } from "pino";

import type { Config, ChannelName, OpenCodeRouterConfigFile } from "./config.js";
import { readConfigFile, writeConfigFile } from "./config.js";
import type { BridgeStore } from "./db.js";
import type { HealthHandlers, SendMessageResult } from "./health.js";
import type { MessageDeliveryResult, OutboundMessagePart } from "./media.js";
import type { MediaStore } from "./media-store.js";
import { getBridgePluginIdentity } from "./bridge-plugin.js";
import type { BridgeRuntimeState } from "./bridge-runtime.js";
import { type BridgeAdapter } from "./bridge-adapters.js";
import type { ChannelRegistry } from "./bridge-channel.js";
import { normalizePairingCodeHash, normalizeTelegramAccess } from "./telegram.js";

export type BridgeAdminHandlerParts = {
    identityHandlers: Pick<HealthHandlers,
        | "listAllIdentities"
        | "listTelegramIdentities"
        | "upsertTelegramIdentity"
        | "deleteTelegramIdentity"
        | "listSlackIdentities"
        | "upsertSlackIdentity"
        | "deleteSlackIdentity"
    >;
    bindingHandlers: Pick<HealthHandlers, "listBindings" | "setBinding" | "clearBinding">;
    messagingHandlers: Pick<HealthHandlers, "sendMessage">;
    groupsHandlers: Pick<HealthHandlers, "getGroupsEnabled" | "setGroupsEnabled">;
    passthroughHandlers?: Pick<HealthHandlers,
        | "listSandboxes"
        | "stopSandbox"
        | "removeSandbox"
        | "getAgentConfig"
        | "updateAgentConfig"
        | "extraRequestHandlers"
    >;
};

export function composeHealthAdminHandlers(parts: BridgeAdminHandlerParts): HealthHandlers {
    return {
        ...parts.identityHandlers,
        ...parts.bindingHandlers,
        ...parts.messagingHandlers,
        ...parts.groupsHandlers,
        ...(parts.passthroughHandlers ?? {}),
    };
}

type SendTargetDelivery = NonNullable<SendMessageResult["targets"]>[number];

export type BridgeAdminHandlersDeps = {
    config: Config;
    logger: Logger;
    store: BridgeStore;
    runtimeState: BridgeRuntimeState;
    adapters: Map<string, BridgeAdapter>;
    channels?: ChannelRegistry;
    mediaStore: MediaStore;
    workspaceRoot: string;
    workspaceRootNormalized: string;
    pluginIdentities: Map<string, Map<string, { id: string; enabled?: boolean; directory?: string; fingerprint?: string }>>;
    pluginExtraRequestHandlers: NonNullable<HealthHandlers["extraRequestHandlers"]>;
    pluginRouteHandlers: Array<{ path: string; match?: string; handler?: unknown }>;
    sandboxHandlers?: Pick<HealthHandlers, "listSandboxes" | "stopSandbox" | "removeSandbox">;
    agentConfigHandlers?: Pick<HealthHandlers, "getAgentConfig" | "updateAgentConfig">;
    adapterKey(channel: ChannelName, identityId: string): string;
    normalizeKnownChannel(value: string): ChannelName;
    normalizeIdentityId(value: string | undefined): string;
    normalizeDirectory(directory: string): string;
    resolveScopedDirectory(directory: string): { ok: true; directory: string } | { ok: false; error: string };
    listIdentityConfigs(channel: ChannelName): Array<{ id: string; directory: string }>;
    resolveOutboundParts(baseDirectory: string, input: { text?: string; parts?: unknown }): Promise<OutboundMessagePart[]>;
    deliverParts(
        channel: ChannelName,
        identityId: string,
        peerId: string,
        parts: OutboundMessagePart[],
        options?: { kind?: "reply" | "system" | "tool"; display?: boolean },
    ): Promise<MessageDeliveryResult>;
};

export function createBridgeAdminHandlers(deps: BridgeAdminHandlersDeps): HealthHandlers {
    const {
        config,
        logger,
        store,
        runtimeState,
        adapters,
        channels,
        mediaStore,
        workspaceRoot,
        workspaceRootNormalized,
        pluginIdentities,
        pluginExtraRequestHandlers,
        pluginRouteHandlers,
        sandboxHandlers,
        agentConfigHandlers,
        adapterKey,
        normalizeKnownChannel,
        normalizeIdentityId,
        normalizeDirectory,
        resolveScopedDirectory,
        listIdentityConfigs,
        resolveOutboundParts,
        deliverParts,
    } = deps;

    const stopRuntimeAdapter = async (channel: ChannelName, identityId: string, message: string) => {
        const key = adapterKey(channel, identityId);
        const existing = adapters.get(key);
        if (!existing) return;
        try {
            await existing.stop();
        } catch (error) {
            logger.warn({ error, channel, identityId }, message);
        }
        adapters.delete(key);
        channels?.delete(key);
    };

    const adapterRestartRequired = (): never => {
        throw new Error("Identity config updated. Restart the bridge to apply channel lifecycle changes.");
    };

    return composeHealthAdminHandlers({
        identityHandlers: {
            listAllIdentities: async () => {
                const channels: Record<string, { items: Array<{ id: string; enabled: boolean; running: boolean; directory?: string; meta?: Record<string, unknown> }> }> = {};

                channels["telegram"] = {
                    items: config.telegramBots.map((bot) => ({
                        id: bot.id,
                        enabled: bot.enabled !== false,
                        running: adapters.has(adapterKey("telegram", bot.id)),
                        directory: bot.directory,
                        meta: {
                            access: normalizeTelegramAccess(bot.access),
                            pairingRequired: normalizeTelegramAccess(bot.access) === "private",
                        },
                    })),
                };

                channels["slack"] = {
                    items: config.slackApps.map((app) => ({
                        id: app.id,
                        enabled: app.enabled !== false,
                        running: adapters.has(adapterKey("slack", app.id)),
                        directory: app.directory,
                    })),
                };

                for (const entry of config.channels) {
                    if (entry.channel === "telegram" || entry.channel === "slack") continue;
                    const key = adapterKey(entry.channel, entry.id);
                    if (!channels[entry.channel]) channels[entry.channel] = { items: [] };
                    channels[entry.channel].items.push({
                        id: entry.id,
                        enabled: entry.enabled !== false,
                        running: adapters.has(key),
                        directory: entry.directory,
                    });
                }

                for (const [channel, identityMap] of pluginIdentities.entries()) {
                    if (!channels[channel]) channels[channel] = { items: [] };
                    for (const [, identity] of identityMap) {
                        channels[channel].items.push({
                            id: identity.id,
                            enabled: identity.enabled !== false,
                            running: adapters.has(adapterKey(channel, identity.id)),
                            directory: identity.directory,
                            meta: identity.fingerprint ? { fingerprint: identity.fingerprint } : undefined,
                        });
                    }
                }

                return { channels };
            },

            listTelegramIdentities: async () => ({
                items: config.telegramBots.map((bot) => ({
                    id: bot.id,
                    enabled: bot.enabled !== false,
                    running: adapters.has(adapterKey("telegram", bot.id)),
                    access: normalizeTelegramAccess(bot.access),
                    pairingRequired: normalizeTelegramAccess(bot.access) === "private",
                })),
            }),

            upsertTelegramIdentity: async (input) => {
                const token = input.token?.trim() ?? "";
                if (!token) throw new Error("token is required");
                const id = normalizeIdentityId(input.id);
                if (id === "env") throw new Error("identity id 'env' is reserved");
                const enabled = input.enabled !== false;
                const directoryInput = typeof input.directory === "string" ? input.directory.trim() : "";
                const requestedAccess = typeof input.access === "string" && input.access.trim() ? normalizeTelegramAccess(input.access) : undefined;
                const requestedPairingCodeHash = normalizePairingCodeHash(input.pairingCodeHash);

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
                    const access = requestedAccess ?? normalizeTelegramAccess(record.access);
                    const pairingCodeHash = access === "private" ? requestedPairingCodeHash || normalizePairingCodeHash(record.pairingCodeHash) : "";
                    if (access === "private" && !pairingCodeHash) throw new Error("pairingCodeHash is required when Telegram access is private");
                    nextBots.push({ id, token, enabled, ...(directory ? { directory } : {}), access, ...(access === "private" ? { pairingCodeHash } : {}) });
                }
                if (!found) {
                    const access = requestedAccess ?? "public";
                    const pairingCodeHash = access === "private" ? requestedPairingCodeHash : "";
                    if (access === "private" && !pairingCodeHash) throw new Error("pairingCodeHash is required when Telegram access is private");
                    nextBots.push({ id, token, enabled, ...(directoryInput ? { directory: directoryInput } : {}), access, ...(access === "private" ? { pairingCodeHash } : {}) });
                }

                const next: OpenCodeRouterConfigFile = { ...current, channels: { ...current.channels, telegram: { ...(current.channels?.telegram ?? {}), enabled: true, bots: nextBots } } };
                next.version = next.version ?? 1;
                writeConfigFile(config.configPath, next);
                config.configFile = next;

                const existingIdx = config.telegramBots.findIndex((bot) => bot.id === id);
                let runtimeAccess: "public" | "private" = requestedAccess ?? "public";
                let runtimePairingCodeHash = requestedPairingCodeHash;
                if (existingIdx >= 0) {
                    const prev = config.telegramBots[existingIdx];
                    const nextDirectory = directoryInput || prev.directory || undefined;
                    runtimeAccess = requestedAccess ?? normalizeTelegramAccess(prev.access);
                    runtimePairingCodeHash = runtimeAccess === "private" ? requestedPairingCodeHash || normalizePairingCodeHash(prev.pairingCodeHash) : "";
                    if (runtimeAccess === "private" && !runtimePairingCodeHash) throw new Error("pairingCodeHash is required when Telegram access is private");
                    config.telegramBots[existingIdx] = { id, token, enabled, ...(nextDirectory ? { directory: String(nextDirectory).trim() } : {}), access: runtimeAccess, ...(runtimeAccess === "private" ? { pairingCodeHash: runtimePairingCodeHash } : {}) };
                } else {
                    runtimeAccess = requestedAccess ?? "public";
                    runtimePairingCodeHash = runtimeAccess === "private" ? requestedPairingCodeHash : "";
                    if (runtimeAccess === "private" && !runtimePairingCodeHash) throw new Error("pairingCodeHash is required when Telegram access is private");
                    config.telegramBots.push({ id, token, enabled, ...(directoryInput ? { directory: directoryInput } : {}), access: runtimeAccess, ...(runtimeAccess === "private" ? { pairingCodeHash: runtimePairingCodeHash } : {}) });
                }

                if (!enabled) {
                    await stopRuntimeAdapter("telegram", id, "failed to stop telegram adapter");
                    return { id, enabled: false, access: runtimeAccess, pairingRequired: runtimeAccess === "private", applied: true };
                }
                return adapterRestartRequired();
            },

            deleteTelegramIdentity: async (rawId) => {
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
                    if (entryId === id) { deleted = true; continue; }
                    nextBots.push(entry);
                }
                const next: OpenCodeRouterConfigFile = { ...current, channels: { ...current.channels, telegram: { ...(current.channels?.telegram ?? {}), bots: nextBots } } };
                next.version = next.version ?? 1;
                writeConfigFile(config.configPath, next);
                config.configFile = next;
                config.telegramBots.splice(0, config.telegramBots.length, ...config.telegramBots.filter((bot) => bot.id !== id));
                await stopRuntimeAdapter("telegram", id, "failed to stop telegram adapter");
                return { id, deleted };
            },

            listSlackIdentities: async () => ({
                items: config.slackApps.map((app) => ({ id: app.id, enabled: app.enabled !== false, running: adapters.has(adapterKey("slack", app.id)) })),
            }),

            upsertSlackIdentity: async (input) => {
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
                    if (entryId !== id) { nextApps.push(entry); continue; }
                    found = true;
                    const existingDirectory = typeof record.directory === "string" ? record.directory.trim() : "";
                    const directory = directoryInput || existingDirectory;
                    nextApps.push({ id, botToken, appToken, enabled, ...(directory ? { directory } : {}) });
                }
                if (!found) nextApps.push({ id, botToken, appToken, enabled, ...(directoryInput ? { directory: directoryInput } : {}) });
                const next: OpenCodeRouterConfigFile = { ...current, channels: { ...current.channels, slack: { ...(current.channels?.slack ?? {}), enabled: true, apps: nextApps } } };
                next.version = next.version ?? 1;
                writeConfigFile(config.configPath, next);
                config.configFile = next;
                const existingIdx = config.slackApps.findIndex((app) => app.id === id);
                if (existingIdx >= 0) {
                    const prev = config.slackApps[existingIdx];
                    const nextDirectory = directoryInput || prev.directory || undefined;
                    config.slackApps[existingIdx] = { id, botToken, appToken, enabled, ...(nextDirectory ? { directory: String(nextDirectory).trim() } : {}) };
                } else {
                    config.slackApps.push({ id, botToken, appToken, enabled, ...(directoryInput ? { directory: directoryInput } : {}) });
                }
                if (!enabled) {
                    await stopRuntimeAdapter("slack", id, "failed to stop slack adapter");
                    return { id, enabled: false, applied: true };
                }
                return adapterRestartRequired();
            },

            deleteSlackIdentity: async (rawId) => {
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
                    if (entryId === id) { deleted = true; continue; }
                    nextApps.push(entry);
                }
                const next: OpenCodeRouterConfigFile = { ...current, channels: { ...current.channels, slack: { ...(current.channels?.slack ?? {}), apps: nextApps } } };
                next.version = next.version ?? 1;
                writeConfigFile(config.configPath, next);
                config.configFile = next;
                config.slackApps.splice(0, config.slackApps.length, ...config.slackApps.filter((app) => app.id !== id));
                await stopRuntimeAdapter("slack", id, "failed to stop slack adapter");
                return { id, deleted };
            },
        },

        groupsHandlers: {
            getGroupsEnabled: () => runtimeState.groupsEnabled,
            setGroupsEnabled: async (enabled) => {
                runtimeState.setGroupsEnabled(enabled);
                config.groupsEnabled = enabled;
                const { config: current } = readConfigFile(config.configPath);
                const next: OpenCodeRouterConfigFile = { ...current, groupsEnabled: enabled };
                next.version = next.version ?? 1;
                writeConfigFile(config.configPath, next);
                config.configFile = next;
                logger.info({ groupsEnabled: enabled }, "groups config updated");
                return { groupsEnabled: enabled };
            },
        },

        bindingHandlers: {
            listBindings: async (filters) => {
                const channelRaw = filters?.channel?.trim().toLowerCase();
                const identityIdRaw = filters?.identityId?.trim();
                let channel: ChannelName | undefined;
                if (channelRaw) channel = normalizeKnownChannel(channelRaw);
                const identityId = identityIdRaw ? normalizeIdentityId(identityIdRaw) : undefined;
                const bindings = store.listBindings({ ...(channel ? { channel } : {}), ...(identityId ? { identityId } : {}) });
                return { items: bindings.map((entry) => ({ channel: entry.channel, identityId: entry.identity_id, peerId: entry.peer_id, directory: entry.directory, updatedAt: entry.updated_at })) };
            },
            setBinding: async (input) => {
                const channel = normalizeKnownChannel(input.channel);
                const identityId = normalizeIdentityId(input.identityId);
                const peerKey = input.peerId.trim();
                const directory = input.directory.trim();
                if (!peerKey || !directory) throw new Error("peerId and directory are required");
                if (channels) channels.validatePeerId(channel, identityId, peerKey);
                else if (!channels) throw new Error(`No ${channel}/${identityId} channel registered for peer validation`);
                const scoped = resolveScopedDirectory(directory);
                if (!scoped.ok) {
                    const error = new Error(scoped.error) as Error & { status?: number };
                    error.status = 400;
                    throw error;
                }
                store.upsertBinding(channel, identityId, peerKey, scoped.directory);
                store.clearSession(channel, identityId, peerKey, scoped.directory);
            },
            clearBinding: async (input) => {
                const channel = normalizeKnownChannel(input.channel);
                const identityId = normalizeIdentityId(input.identityId);
                const peerKey = input.peerId.trim();
                if (!peerKey) throw new Error("peerId is required");
                store.deleteBinding(channel, identityId, peerKey);
                store.clearSession(channel, identityId, peerKey);
            },
        },

        messagingHandlers: {
            sendMessage: async (input) => {
                const channel = normalizeKnownChannel(input.channel);
                const identityId = input.identityId?.trim() ? normalizeIdentityId(input.identityId) : undefined;
                const directoryInput = (input.directory ?? "").trim();
                const peerId = (input.peerId ?? "").trim();
                const autoBind = input.autoBind === true;
                if (!directoryInput && !peerId) throw new Error("directory or peerId is required");
                if (peerId) {
                    if (identityId && channels) channels.validatePeerId(channel, identityId, peerId);
                    else if (!channels) throw new Error(`No ${channel} channel registered for peer validation`);
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

                const outboundParts = await resolveOutboundParts(normalizedDir || workspaceRoot, { text: input.text, parts: input.parts });
                const makeTargetError = (targetIdentityId: string, targetPeerId: string, errorMessage: string, errorCode = "not_found"): SendTargetDelivery => ({
                    identityId: targetIdentityId,
                    peerId: targetPeerId,
                    attemptedParts: outboundParts.length,
                    sentParts: 0,
                    partResults: outboundParts.map((part, index) => ({ index, type: part.type, sent: false, error: errorMessage, code: errorCode, retryable: false })),
                });
                const deliveryFailed = (delivery: MessageDeliveryResult) => delivery.attemptedParts > 0 && delivery.sentParts < delivery.attemptedParts;
                const primaryFailureMessage = (delivery: MessageDeliveryResult) => delivery.partResults.find((part) => !part.sent)?.error || "Delivery failed";
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
                    return Array.from(adapters.values()).find((adapter) => adapter.name === channel)?.identityId;
                };

                const targetIdentityId = resolveSendIdentityId();
                if (peerId && !targetIdentityId) return { channel, directory: normalizedDir || workspaceRootNormalized, peerId, attempted: 0, sent: 0, reason: `No ${channel} adapter is running for direct send`, targets: [] };

                if (peerId && targetIdentityId) {
                    if (!adapters.get(adapterKey(channel, targetIdentityId))) {
                        const target = makeTargetError(targetIdentityId, peerId, "Adapter not running");
                        return { channel, directory: normalizedDir || workspaceRootNormalized, identityId: targetIdentityId, peerId, attempted: 1, sent: 0, failures: [{ identityId: targetIdentityId, peerId, error: "Adapter not running" }], targets: [target] };
                    }
                    if (autoBind && normalizedDir) {
                        store.upsertBinding(channel, targetIdentityId, peerId, normalizedDir);
                        store.clearSession(channel, targetIdentityId, peerId, normalizedDir);
                    }
                    const delivery = await deliverParts(channel, targetIdentityId, peerId, outboundParts, { kind: "system", display: false });
                    const failed = deliveryFailed(delivery);
                    return {
                        channel,
                        directory: normalizedDir || workspaceRootNormalized,
                        identityId: targetIdentityId,
                        peerId,
                        attempted: 1,
                        sent: failed ? 0 : 1,
                        ...(failed ? { failures: [{ identityId: targetIdentityId, peerId, error: primaryFailureMessage(delivery) }] } : {}),
                        targets: [{ identityId: targetIdentityId, peerId, attemptedParts: delivery.attemptedParts, sentParts: delivery.sentParts, partResults: delivery.partResults }],
                    };
                }

                const bindings = store.listBindings({ channel, ...(identityId ? { identityId } : {}), directory: normalizedDir });
                if (bindings.length === 0) return { channel, directory: normalizedDir, ...(identityId ? { identityId } : {}), attempted: 0, sent: 0, reason: `No bound conversations for ${channel}${identityId ? `/${identityId}` : ""} at directory ${normalizedDir}`, targets: [] };
                const failures: Array<{ identityId: string; peerId: string; error: string }> = [];
                const targets: SendTargetDelivery[] = [];
                let attempted = 0;
                let sent = 0;
                for (const binding of bindings) {
                    attempted += 1;
                    try {
                        channels?.validatePeerId(channel, binding.identity_id, binding.peer_id);
                    } catch {
                        store.deleteBinding(channel, binding.identity_id, binding.peer_id);
                        store.clearSession(channel, binding.identity_id, binding.peer_id);
                        const error = "Invalid Telegram peerId binding removed (expected numeric chat_id)";
                        targets.push(makeTargetError(binding.identity_id, binding.peer_id, error, "invalid_target"));
                        failures.push({ identityId: binding.identity_id, peerId: binding.peer_id, error });
                        continue;
                    }
                    if (pluginIdentities.has(channel) && !getBridgePluginIdentity(pluginIdentities as any, channel, binding.identity_id)) {
                        const error = `${channel} identity not configured`;
                        targets.push(makeTargetError(binding.identity_id, binding.peer_id, error));
                        failures.push({ identityId: binding.identity_id, peerId: binding.peer_id, error });
                        continue;
                    }
                    if (!adapters.get(adapterKey(channel, binding.identity_id))) {
                        targets.push(makeTargetError(binding.identity_id, binding.peer_id, "Adapter not running"));
                        failures.push({ identityId: binding.identity_id, peerId: binding.peer_id, error: "Adapter not running" });
                        continue;
                    }
                    const delivery = await deliverParts(channel, binding.identity_id, binding.peer_id, outboundParts, { kind: "system", display: false });
                    targets.push({ identityId: binding.identity_id, peerId: binding.peer_id, attemptedParts: delivery.attemptedParts, sentParts: delivery.sentParts, partResults: delivery.partResults });
                    if (deliveryFailed(delivery)) failures.push({ identityId: binding.identity_id, peerId: binding.peer_id, error: primaryFailureMessage(delivery) });
                    else sent += 1;
                }
                return { channel, directory: normalizedDir, ...(identityId ? { identityId } : {}), attempted, sent, ...(failures.length ? { failures } : {}), targets };
            },
        },

        passthroughHandlers: {
            ...(sandboxHandlers ?? {}),
            ...(agentConfigHandlers ?? {}),
            extraRequestHandlers: [
                ...pluginExtraRequestHandlers,
                ...pluginRouteHandlers.filter((r) => typeof r.handler === "function").map((r) => {
                    const handler = r.handler as (req: any, res: any) => Promise<void> | void;
                    const routePath = r.path;
                    const matchMode = r.match ?? "exact";
                    return async (req: any, res: any, pathname: string): Promise<boolean> => {
                        const matches = matchMode === "prefix" ? pathname === routePath || pathname.startsWith(`${routePath}/`) || pathname.startsWith(`${routePath}?`) : pathname === routePath;
                        if (!matches) return false;
                        await handler(req, res);
                        return true;
                    };
                }),
            ],
        },
    });
}
