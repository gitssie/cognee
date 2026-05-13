import type { Logger } from "pino";
import type { Config, ChannelName } from "./config.js";
import type { MediaStore } from "./media-store.js";
import type { BridgeAdapter } from "./bridge-adapters.js";
import {
    type BridgePluginContext,
    getBridgePluginIdentity,
    loadBridgePluginRegistry,
} from "./bridge-plugin.js";
import type { ExtraRequestHandler } from "./health.js";

export type PluginGatewayIdentity = {
    id: string;
    enabled: boolean;
    directory?: string;
    fingerprint?: string;
};

export type PluginGatewayHost = {
    id: string;
    name: string;
    channels: string[];
    channelPlugins: unknown[];
    toolNames: string[];
    routes: Array<{ path: string; auth?: string; match?: string }>;
    hooks: Array<{ hookName: string }>;
    pluginConfig: Record<string, unknown>;
};

export type BridgePluginGateway = {
    hosts: Map<string, PluginGatewayHost>;
    identities: Map<string, Map<string, PluginGatewayIdentity>>;
    adapters: BridgeAdapter[];
    extraRequestHandlers: ExtraRequestHandler[];
    pluginRouteHandlers: Array<{
        path: string;
        match?: string;
        handler?: unknown;
    }>;
    startGateways(): Promise<void>;
    isIdentityEnabled(channel: ChannelName, identityId: string): boolean;
};

export async function createBridgePluginGateway(input: {
    config: Config;
    logger: Logger;
    mediaStore: MediaStore;
    handleInbound: BridgePluginContext["handleInbound"];
    adapterKey(channel: ChannelName, identityId: string): string;
}): Promise<BridgePluginGateway> {
    const result = await loadBridgePluginRegistry(input);
    const hosts = new Map<string, PluginGatewayHost>();
    const identities = new Map<string, Map<string, PluginGatewayIdentity>>();

    for (const [name, host] of result.hosts.entries())
        hosts.set(name, host as PluginGatewayHost);
    for (const [channel, identityMap] of result.identities.entries()) {
        identities.set(
            channel,
            identityMap as Map<string, PluginGatewayIdentity>,
        );
    }

    return {
        hosts,
        identities,
        adapters: result.adapters as BridgeAdapter[],
        extraRequestHandlers: result.extraRequestHandlers,
        pluginRouteHandlers: result.pluginRouteHandlers,
        startGateways: result.startGateways,
        isIdentityEnabled(channel, identityId) {
            const configured = getBridgePluginIdentity(
                identities,
                channel,
                identityId,
            );
            return (
                !identities.has(channel) ||
                Boolean(configured && configured.enabled !== false)
            );
        },
    };
}
