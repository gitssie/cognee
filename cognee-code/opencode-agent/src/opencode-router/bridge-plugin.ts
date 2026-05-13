import type { Logger } from "pino";

import type { ChannelName, Config, PluginOptions } from "./config.js";
import type { PipelineInboundMessage } from "./bridge-message-pipeline.js";
import type { ExtraRequestHandler } from "./health.js";
import { MediaStore } from "./media-store.js";
import { discoverBridgePluginCandidates, loadBridgePluginModule } from "./bridge-plugin-manifest.js";
import { loadRouterPluginHost, type RegisteredRouteHandler } from "./plugin-host.js";
import { createChannelRuntime } from "./channel-runtime.js";
import { BridgeStore } from "./db.js";

/**
 * Minimal structural interface for an OpenClaw ChannelPlugin.
 * We only reference the fields we actually use; the rest is left open.
 * This avoids a hard dependency on the `openclaw` package types.
 */
type ChannelPluginLike = {
  id: string;
  gateway?: {
    startAccount(ctx: {
      accountId: string;
      cfg: unknown;
      runtime: unknown;
      log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
      abortSignal: AbortSignal;
      setStatus(next: Record<string, unknown>): void;
    }): Promise<void>;
  };
  outbound?: {
    textChunkLimit?: number;
    sendText(params: { to: string; text: string; accountId: string; cfg: unknown }): Promise<unknown>;
  };
};

export type BridgeAdapter = {
  key: string;
  name: ChannelName;
  identityId: string;
  maxTextLength: number;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage?: (peerId: string, message: { parts: any[] }) => Promise<any>;
  sendText(peerId: string, text: string): Promise<void>;
  sendFile?: (peerId: string, filePath: string, caption?: string) => Promise<void>;
  sendTyping?: (peerId: string) => Promise<void>;
};

export type BridgePluginHostRecord = {
  id: string;
  name: string;
  channels: string[];
  channelPlugins: unknown[];
  toolNames: string[];
  routes: Array<{ path: string; auth?: string; match?: string }>;
  hooks: Array<{ hookName: string }>;
  pluginConfig: PluginOptions;
};

export type BridgeIdentityRecord = {
  id: string;
  enabled: boolean;
  directory?: string;
  fingerprint?: string;
};

export type BridgePluginContext = {
  config: Config;
  logger: Logger;
  mediaStore: MediaStore;
  handleInbound: (message: {
    channel: ChannelName;
  } & Omit<PipelineInboundMessage, "channel">) => Promise<void>;
  adapterKey: (channel: ChannelName, identityId: string) => string;
};

export type BridgePluginLoadResult = {
  hosts: Map<string, BridgePluginHostRecord>;
  adapters: BridgeAdapter[];
  extraRequestHandlers: ExtraRequestHandler[];
  pluginRouteHandlers: RegisteredRouteHandler[];
  identities: Map<string, Map<string, BridgeIdentityRecord>>;
  startGateways(): Promise<void>;
};

type RouterPluginModule = {
  id?: string;
  name?: string;
  register?: (api: any) => Promise<void> | void;
  createAdapters?: (context: BridgePluginContext) => Promise<BridgeAdapter[]> | BridgeAdapter[];
  createHttpHandlers?: (context: BridgePluginContext) => Promise<ExtraRequestHandler[]> | ExtraRequestHandler[];
  listIdentities?: (context: BridgePluginContext) => BridgeIdentityRecord[];
};

function normalizePluginModule(value: any): RouterPluginModule | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.register !== "function") return undefined;
  return value as RouterPluginModule;
}

function hostKeyForPlugin(plugin: RouterPluginModule, fallbackSpec: string): string {
  const id = typeof plugin.id === "string" ? plugin.id.trim() : "";
  if (id) return id;
  return fallbackSpec;
}

export async function loadBridgePluginRegistry(context: BridgePluginContext): Promise<BridgePluginLoadResult> {
  const hosts = new Map<string, BridgePluginHostRecord>();
  const adapters: BridgeAdapter[] = [];
  const extraRequestHandlers: ExtraRequestHandler[] = [];
  const pluginRouteHandlers: RegisteredRouteHandler[] = [];
  const identities = new Map<string, Map<string, BridgeIdentityRecord>>();
  const gatewayStarters: Array<() => void> = [];
  const candidates = await discoverBridgePluginCandidates(context.config, context.logger);

  // Create the shared channel runtime backed by router infrastructure
  const store = new BridgeStore(context.config.dbPath);
  const channelRuntime = createChannelRuntime({
    config: context.config,
    store,
    mediaStore: context.mediaStore,
    logger: context.logger,
    handleInbound: context.handleInbound,
  });

  for (const candidate of candidates) {
    try {
      const loaded = await loadBridgePluginModule(candidate.entryPath);
      const pluginModule = normalizePluginModule(loaded);
      if (!pluginModule) continue;

      const host = await loadRouterPluginHost({
        plugin: pluginModule,
        source: candidate.entryPath,
        label: hostKeyForPlugin(pluginModule, candidate.origin.spec),
        configPath: context.config.configPath,
        logger: context.logger,
        channelRuntime,
        ...(candidate.origin.options ? { pluginConfig: candidate.origin.options } : {}),
      });

      for (const channel of host.channels) {
        hosts.set(channel, {
          id: host.id,
          name: host.name,
          channels: host.channels,
          channelPlugins: host.channelPlugins,
          toolNames: host.toolNames,
          routes: host.routes,
          hooks: host.hooks,
          pluginConfig: host.pluginConfig,
        });
      }

      // Collect HTTP route handlers registered via registerHttpRoute()
      pluginRouteHandlers.push(...host.routeHandlers);

      // Start channel account gateways (e.g., bot websocket / webhook connectors)
      for (const channelPlugin of host.channelPlugins) {
        const cp = channelPlugin as ChannelPluginLike;
        if (typeof cp?.gateway?.startAccount !== "function") continue;
        const channel = cp.id;
        const rawConfigFile = (context.config.configFile as Record<string, unknown> | undefined) ?? {};
        const channelConfig = (rawConfigFile?.channels as Record<string, unknown> | undefined)?.[channel] as Record<string, unknown> | undefined ?? {};

        // Normalize accounts from array to object format for channel plugins that expect an object map
        const accountsRaw = channelConfig.accounts;
        let accountsObj: Record<string, unknown> = {};
        let accountIds: string[];
        if (Array.isArray(accountsRaw)) {
          for (const entry of accountsRaw) {
            if (!entry || typeof entry !== "object") continue;
            const id = String((entry as Record<string, unknown>).id ?? "default");
            const { id: _id, ...rest } = entry as Record<string, unknown>;
            accountsObj[id] = rest;
          }
          accountIds = (accountsRaw as Array<Record<string, unknown>>)
            .filter((a) => a?.enabled !== false)
            .map((a) => String(a?.id ?? "default"));
        } else if (accountsRaw && typeof accountsRaw === "object") {
          accountsObj = accountsRaw as Record<string, unknown>;
          accountIds = Object.keys(accountsObj).filter(
            (k) => (accountsObj[k] as Record<string, unknown>)?.enabled !== false,
          );
        } else {
          accountIds = ["default"];
        }

        // Build normalized cfg with accounts as object
        const normalizedChannelConfig = { ...channelConfig, accounts: accountsObj };
        const normalizedConfigFile = {
          ...rawConfigFile,
          channels: {
            ...(rawConfigFile.channels as Record<string, unknown> | undefined),
            [channel]: normalizedChannelConfig,
          },
        };

        for (const accountId of accountIds) {
          const abortController = new AbortController();
          const accountCtx = {
            accountId,
            cfg: normalizedConfigFile,
            runtime: host.runtime,
            log: {
              info: (msg: string) => context.logger.info({ plugin: channel, accountId }, msg),
              warn: (msg: string) => context.logger.warn({ plugin: channel, accountId }, msg),
              error: (msg: string) => context.logger.error({ plugin: channel, accountId }, msg),
            },
            abortSignal: abortController.signal,
            setStatus: (_status: Record<string, unknown>) => {},
          };
          gatewayStarters.push(() => {
            context.logger.info({ channel, accountId }, "starting channel account gateway");
            cp.gateway!.startAccount(accountCtx).catch((err: unknown) => {
              context.logger.warn({ err, channel, accountId }, "channel gateway start error");
            });
          });

          // Synthesize a BridgeAdapter for each channel account so that
          // bridge.ts handleInbound can find the adapter and deliver replies.
          if (typeof cp?.outbound?.sendText === "function") {
            const adapterKey = context.adapterKey(channel as ChannelName, accountId);
            adapters.push({
              key: adapterKey,
              name: channel as ChannelName,
              identityId: accountId,
              maxTextLength: typeof cp.outbound.textChunkLimit === "number" ? cp.outbound.textChunkLimit : 4000,
              start: async () => {},
              stop: async () => {},
              sendText: async (peerId: string, text: string) => {
                await cp.outbound!.sendText({
                  to: peerId,
                  text,
                  accountId,
                  cfg: normalizedConfigFile,
                });
              },
            });
            context.logger.info({ channel, accountId, adapterKey }, "synthesized bridge adapter for channel account");
          }

          // Register identity so bridge.ts plugin identity checks can resolve this channel/account
          if (!identities.has(channel)) {
            identities.set(channel, new Map());
          }
          identities.get(channel)!.set(accountId, { id: accountId, enabled: true });
        }
      }

      if (typeof pluginModule.createAdapters === "function") {
        adapters.push(...(await pluginModule.createAdapters(context)));
      }
      if (typeof pluginModule.createHttpHandlers === "function") {
        extraRequestHandlers.push(...(await pluginModule.createHttpHandlers(context)));
      }
      if (typeof pluginModule.listIdentities === "function") {
        for (const channel of host.channels) {
          const channelIdentities = new Map<string, BridgeIdentityRecord>();
          for (const identity of pluginModule.listIdentities(context)) {
            channelIdentities.set(identity.id, identity);
          }
          identities.set(channel, channelIdentities);
        }
      }
    } catch (error) {
      context.logger.warn({ error, spec: candidate.origin.spec, entryPath: candidate.entryPath }, "failed to load bridge plugin");
    }
  }

  return {
    hosts,
    adapters,
    extraRequestHandlers,
    pluginRouteHandlers,
    identities,
    async startGateways() {
      for (const start of gatewayStarters) start();
    },
  };
}

export function getBridgePluginIdentity(
  identityMap: Map<string, Map<string, BridgeIdentityRecord>>,
  channel: string,
  identityId: string,
): BridgeIdentityRecord | undefined {
  return identityMap.get(channel)?.get(identityId);
}
