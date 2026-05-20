import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";

import type { Logger } from "pino";

import type { Config, ChannelName } from "./config.js";
import { BridgeStore } from "./db.js";
import {
    type InboundMessagePart,
    type MessageDeliveryResult,
    type OutboundMessagePart,
} from "./media.js";
import { MediaStore } from "./media-store.js";
import { createBridgeRuntime, type BridgePaths } from "./bridge-runtime.js";
import { BridgeHealthController } from "./bridge-health.js";
import { createBridgeCommandRouter } from "./bridge-command.js";
import { createBridgeMessagePipeline, type BridgeMessagePipeline } from "./bridge-message-pipeline.js";
import { BridgeSessionRuntime } from "./bridge-session.js";
import { AdapterRegistry, startAdapterBounded, type BridgeAdapter as Adapter } from "./bridge-adapters.js";
import { ChannelRegistry, PluginChannel, SlackChannel, TelegramChannel } from "./bridge-channel.js";
import { createDirectoryPolicy } from "./bridge-directory.js";
import { BridgeMediaFlow } from "./bridge-media.js";
import { createBridgePluginGateway } from "./bridge-plugin-gateway.js";
import { createBridgeAdminHandlers } from "./bridge-admin-handlers.js";
import { formatInputSummary } from "./text.js";
import { createBridgeMessageStream } from "./bridge-message-stream.js";

type OutboundKind = "reply" | "system" | "tool";

import type { OpenCodeClientProvider } from "./client-provider.js";
import type {
    SandboxListResult,
    SandboxOperationResult,
    AgentConfigResult,
    AgentConfigUpdateInput,
} from "./health.js";

export type BridgeDeps = {
    /** OpenCode client provider (local/shared server or sandbox). */
    provider: OpenCodeClientProvider;
    store?: BridgeStore;
    paths?: Partial<BridgePaths>;
    mediaStore?: MediaStore;
    adapters?: Map<string, Adapter>;
    disableEventStream?: boolean;
    disableHealthServer?: boolean;
    /** Sandbox management handlers (sandbox mode only). */
    sandboxHandlers?: {
        listSandboxes: () => Promise<SandboxListResult>;
        stopSandbox: (identity: string) => Promise<SandboxOperationResult>;
        removeSandbox: (identity: string) => Promise<SandboxOperationResult>;
    };
    /** Agent config handlers for reading/updating opencode section. */
    agentConfigHandlers?: {
        getAgentConfig: () => Promise<AgentConfigResult>;
        updateAgentConfig: (
            input: AgentConfigUpdateInput,
        ) => Promise<AgentConfigResult>;
    };
    /** Sandbox manager that receives the store for DB lifecycle tracking. */
    sandboxManager?: { setStore(store: BridgeStore): void };
    /** Names of agents available in the OpenCode server (used to validate per-account agent config). */
    availableAgents?: string[];
};

export type BridgeReporter = {
    onStatus?: (message: string) => void;
    onInbound?: (message: {
        channel: ChannelName;
        identityId: string;
        peerId: string;
        text: string;
        fromMe?: boolean;
    }) => void;
    onOutbound?: (message: {
        channel: ChannelName;
        identityId: string;
        peerId: string;
        text: string;
        kind: OutboundKind;
    }) => void;
};

type InboundMessage = {
    channel: ChannelName;
    identityId: string;
    peerId: string;
    text: string;
    parts?: InboundMessagePart[];
    raw: unknown;
    fromMe?: boolean;
    agentId?: string;
};

type ModelRef = {
    providerID: string;
    modelID: string;
};


/*type RunState = {
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
};*/

function getChannelLabel(channel: string): string {
    return channel;
}

function adapterKey(channel: ChannelName, identityId: string): string {
    return `${channel}:${identityId}`;
}

function normalizeIdentityId(value: string | undefined): string {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return "default";
    const safe = trimmed.replace(/[^a-zA-Z0-9_.-]+/g, "-");
    const cleaned = safe.replace(/^-+|-+$/g, "").slice(0, 48);
    return cleaned || "default";
}

// ──────────────────────────────────────────────────────────────────────────────
// Directory provisioning (per-peer strategy) — see directory.ts
// ──────────────────────────────────────────────────────────────────────────────

export async function startBridge(
    config: Config,
    logger: Logger,
    deps: BridgeDeps,
    reporter?: BridgeReporter,
) {
    const reportStatus = reporter?.onStatus;
    const dirWorkspaceRoot = config.mode === "directory"
        ? config.directory.workspaceRoot
        : undefined;
    const runtime = await createBridgeRuntime(config, {
        paths: {
            ...(dirWorkspaceRoot ? { workspaceRoot: dirWorkspaceRoot } : {}),
            ...(deps.paths ?? {}),
        },
        mediaStore: deps.mediaStore,
    });
    // In directory mode, workspaceRoot comes from config.directory.workspaceRoot (typically /work).
    // In sandbox mode, workspaceRoot comes from runtime.paths (the router's own workspace directory).
    const workspaceRoot = dirWorkspaceRoot ?? runtime.paths.workspaceRoot;
    const { mediaStore } = runtime;

    const provider = deps.provider;
    const directoryPolicy = createDirectoryPolicy({ config, workspaceRoot, logger, provider });
    const isDangerousRootDirectory = directoryPolicy.isDangerousRootDirectory;
    const resolveIdentityDirectoryStr = directoryPolicy.resolveIdentityDirectory;

    const normalizeKnownChannel = (value: string): ChannelName => {
        const channel = value.trim().toLowerCase();
        if (!channel || !channels.hasChannelName(channel))
            throw new Error("Invalid channel");
        return channel;
    };
    const store = deps.store ?? new BridgeStore(config.dbUrl);
    deps.sandboxManager?.setStore(store);
    const pluginHosts = new Map<string, any>();
    const pluginIdentities = new Map<string, Map<string, { id: string; enabled: boolean; directory?: string; fingerprint?: string }>>();

    logger.debug(
        {
            configPath: config.configPath,
            opencodeUrl: config.opencodeUrl,
            opencodeDirectory: config.opencodeDirectory,
            telegramBots: config.telegramBots.map((bot) => ({
                id: bot.id,
                enabled: bot.enabled !== false,
            })),
            slackApps: config.slackApps.map((app) => ({
                id: app.id,
                enabled: app.enabled !== false,
            })),
            groupsEnabled: config.groupsEnabled,
            permissionMode: config.permissionMode,
            toolUpdatesEnabled: config.toolUpdatesEnabled,
            pluginHosts: Array.from(pluginHosts.keys()),
        },
        "bridge config",
    );

    const adapterRegistry = new AdapterRegistry(deps.adapters);
    const adapters = adapterRegistry.toMap();
    const channels = new ChannelRegistry();
    const usingInjectedAdapters = Boolean(deps.adapters);

    for (const adapter of adapters.values()) {
        channels.set(new PluginChannel(adapter));
    }

    const sessionRuntime = new BridgeSessionRuntime({
        logger,
        config,
        store,
        provider,
        reportStatus,
        getChannelLabel,
        formatPeer: (_channel, peerId) => peerId,
    });
    const formatPeer = (_channel: ChannelName, peerId: string) => peerId;

    const normalizeDirectory = directoryPolicy.normalizeDirectory;
    const resolveScopedDirectory = directoryPolicy.resolveScopedDirectory;
    const workspaceRootNormalized = normalizeDirectory(workspaceRoot);

    const runtimeState = runtime.state;

    const mediaFlow = new BridgeMediaFlow({
        mediaStore,
        getAdapter: (key) => adapters.get(key),
        adapterKey,
        reporter,
        recordOutboundActivity: (now) => runtimeState.recordOutboundActivity(now),
    });

    const resolveOutboundParts = async (
        baseDirectory: string,
        input: { text?: string; parts?: unknown },
    ): Promise<OutboundMessagePart[]> => {
        return mediaFlow.resolveOutboundParts(baseDirectory, input);
    };

    const deliverParts = async (
        channel: ChannelName,
        identityId: string,
        peerId: string,
        parts: OutboundMessagePart[],
        options: { kind?: OutboundKind; display?: boolean } = {},
    ): Promise<MessageDeliveryResult> => {
        return mediaFlow.deliverParts(channel, identityId, peerId, parts, options);
    };

    const getHealthChannels = () => ({
        ...Object.fromEntries(
            Array.from(channels.knownChannelNames()).map((channel) => [
                channel,
                pluginHosts.has(channel) ||
                    Array.from(adapters.keys()).some((key) => key.startsWith(`${channel}:`)) ||
                    config.channels.some(
                        (identity) => identity.channel === channel && identity.enabled !== false,
                    ),
            ]),
        ),
        // WhatsApp removed; keep field for backward compatibility.
        whatsapp: false,
    });

    const healthHandlers = createBridgeAdminHandlers({
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
        pluginExtraRequestHandlers: [],
        pluginRouteHandlers: [],
        sandboxHandlers: deps.sandboxHandlers,
        agentConfigHandlers: deps.agentConfigHandlers,
        adapterKey,
        normalizeKnownChannel,
        normalizeIdentityId,
        normalizeDirectory,
        resolveScopedDirectory,
        listIdentityConfigs: (channel) => channels.listIdentityConfigs(channel),
        resolveOutboundParts,
        deliverParts,
    });

    const healthController = new BridgeHealthController({
        provider,
        state: runtimeState,
        opencodeUrl: config.opencodeUrl,
        getChannels: getHealthChannels,
        logger,
        port: config.healthPort,
        disabled: deps.disableHealthServer,
        handlers: healthHandlers,
    });
    await healthController.start();

    async function sendText(
        channel: ChannelName,
        identityId: string,
        peerId: string,
        text: string,
        options: { kind?: OutboundKind; display?: boolean } = {},
    ) {
        const parts: OutboundMessagePart[] =
            text.startsWith("FILE:") && text.substring(5).trim()
                ? [{ type: "file", filePath: text.substring(5).trim() }]
                : [{ type: "text", text }];
        const delivery = await deliverParts(
            channel,
            identityId,
            peerId,
            parts,
            options,
        );
        if (delivery.sentParts < delivery.attemptedParts) {
            const message =
                delivery.partResults.find((part) => !part.sent)?.error ||
                "Failed to send message";
            throw new Error(message);
        }
    }

    const commandRouter = createBridgeCommandRouter({
        store,
        logger,
        workspaceRoot,
        channels,
        sendText,
        resolveIdentityDirectory: resolveIdentityDirectoryStr,
        resolveScopedDirectory,
        stopActiveRun: (input) => sessionRuntime.abortSession(input),
        compactSession: (input) => sessionRuntime.compactSession(input),
    });

    async function handleCommand(
        channel: ChannelName,
        identityId: string,
        peerKey: string,
        peerId: string,
        text: string,
    ): Promise<boolean> {
        return commandRouter.route({ channel, identityId, peerKey, peerId, text });
    }

    const messageStream = createBridgeMessageStream();

    const messagePipeline = createBridgeMessagePipeline({
        logger,
        config,
        reporter,
        store,
        provider,
        mediaStore,
        channels,
        stream: messageStream,
        pluginIdentities,
        directoryPolicy,
        hasAdapter: (channel, identityId) => adapters.has(adapterKey(channel, identityId)),
        recordInboundActivity: (now) => runtimeState.recordInboundActivity(now),
        resolveIdentityDirectory: resolveIdentityDirectoryStr,
        isDangerousRootDirectory,
        resolveScopedDirectory,
        normalizeDirectory,
        handleCommand,
        sendText,
        sessionRuntime,
        availableAgents: deps.availableAgents,
    });

    const pluginGateway = await createBridgePluginGateway({
        config,
        logger,
        mediaStore,
        handleInbound: (message) => messagePipeline.handleInbound(message),
        adapterKey,
    });
    for (const [name, host] of pluginGateway.hosts.entries()) {
        pluginHosts.set(name, host);
        logger.info(
            {
                pluginId: host.id,
                channels: host.channels,
                tools: host.toolNames,
                routeCount: host.routes.length,
                hookCount: host.hooks.length,
            },
            `${name} plugin host ready`,
        );
    }
    for (const [channel, identities] of pluginGateway.identities.entries()) {
        pluginIdentities.set(channel, identities);
    }
    for (const adapter of pluginGateway.adapters) {
        logger.debug({ identityId: adapter.identityId, channel: adapter.name }, "plugin adapter enabled");
        const channel = new PluginChannel(adapter);
        channels.set(channel);
        adapters.set(channel.key, channel.asAdapter());
    }

    await pluginGateway.startGateways();

    for (const adapter of Array.from(adapters.values())) {
        const startResult = await startAdapterBounded(adapter, {
            timeoutMs: 8_000,
            onError: (error) => {
                logger.error(
                    {
                        error,
                        channel: adapter.name,
                        identityId: adapter.identityId,
                    },
                    "adapter start failed",
                );
                adapters.delete(adapter.key);
            },
        });

        if (startResult.status === "timeout") {
            logger.warn(
                {
                    channel: adapter.name,
                    identityId: adapter.identityId,
                    timeoutMs: 8_000,
                },
                "adapter start timed out",
            );
            reportStatus?.(
                `${getChannelLabel(adapter.name)}/${adapter.identityId} adapter starting...`,
            );
            continue;
        }

        if (startResult.status === "error") {
            reportStatus?.(
                `${getChannelLabel(adapter.name)}/${adapter.identityId} adapter failed to start.`,
            );
            continue;
        }

        reportStatus?.(
            `${getChannelLabel(adapter.name)}/${adapter.identityId} adapter started.`,
        );
    }

    logger.info({ channels: Array.from(adapters.keys()) }, "bridge started");
    reportStatus?.(`Bridge running. Logs: ${config.logFile}`);

    return {
        async stop() {
            healthController.stop();
            for (const adapter of adapters.values()) {
                await adapter.stop();
            }
            await store.close();
            await provider.shutdown();
            await delay(50);
        }
    };
}
