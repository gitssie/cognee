import { readConfigFile, writeConfigFile, type PluginOptions } from "./config.js";
import type { Logger } from "pino";
import type { ChannelRuntime } from "./channel-runtime.js";

export type RouterPluginRuntime = {
  channel: {
    text: {
      chunkMarkdownText: (text: string, limit: number) => string[];
      chunkText: (text: string, limit: number) => string[];
      resolveMarkdownTableMode: (_config?: unknown) => "keep";
      convertMarkdownTables: (text: string) => string;
    };
    routing?: ChannelRuntime["channel"]["routing"];
    session?: ChannelRuntime["channel"]["session"];
    reply?: ChannelRuntime["channel"]["reply"];
    media?: ChannelRuntime["channel"]["media"];
  };
  config: {
    writeConfigFile: (_config: unknown) => Promise<void>;
  };
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type RegisteredTool = {
  tool: unknown;
  opts?: { name?: string; names?: string[]; optional?: boolean };
};

export type RegisteredRoute = {
  path: string;
  auth?: string;
  match?: string;
};

export type RegisteredRouteHandler = RegisteredRoute & {
  handler?: unknown;
};

export type RegisteredHook = {
  hookName: string;
};

export type RouterPluginHost = {
  id: string;
  name: string;
  channels: string[];
  channelPlugins: unknown[];
  toolNames: string[];
  routes: RegisteredRoute[];
  hooks: RegisteredHook[];
  routeHandlers: RegisteredRouteHandler[];
  runtime: RouterPluginRuntime;
  pluginConfig: PluginOptions;
};

function chunkText(text: string, limit: number): string[] {
  const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 4000;
  if (text.length <= normalizedLimit) {
    return [text];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += normalizedLimit) {
    chunks.push(text.slice(index, index + normalizedLimit));
  }
  return chunks.filter(Boolean);
}

export function createRouterPluginRuntime(label: string, configPath: string, pluginConfig: PluginOptions, logger?: Logger, channelRuntime?: ChannelRuntime): RouterPluginRuntime {
  return {
    channel: {
      text: {
        chunkMarkdownText: channelRuntime?.channel.text.chunkMarkdownText ?? chunkText,
        chunkText: channelRuntime?.channel.text.chunkText ?? chunkText,
        resolveMarkdownTableMode: () => "keep",
        convertMarkdownTables: (text) => text,
      },
      ...(channelRuntime ? {
        routing: channelRuntime.channel.routing,
        session: channelRuntime.channel.session,
        reply: channelRuntime.channel.reply,
        media: channelRuntime.channel.media,
      } : {}),
    },
    config: {
      async writeConfigFile(nextConfig: unknown) {
        if (!nextConfig || typeof nextConfig !== "object" || Array.isArray(nextConfig)) {
          throw new Error(`${label} plugin config.writeConfigFile expected object config`);
        }
        const { config: current } = readConfigFile(configPath);
        const next = {
          ...current,
          version: current.version ?? 1,
          plugins: {
            ...(current.plugins ?? {}),
            entries: {
              ...(current.plugins?.entries ?? {}),
              [label]: {
                ...(current.plugins?.entries?.[label] ?? {}),
                config: nextConfig as Record<string, unknown>,
              },
            },
          },
        };
        writeConfigFile(configPath, next);
      },
    },
    log: (message) => logger ? logger.info({ plugin: label }, message) : console.error(`[${label}-plugin] ${message}`),
    error: (message) => logger ? logger.error({ plugin: label }, message) : console.error(`[${label}-plugin] ${message}`),
  };
}

export async function loadRouterPluginHost(input: {
  plugin: any;
  hostId?: string;
  hostName?: string;
  source: string;
  label: string;
  configPath: string;
  pluginConfig?: PluginOptions;
  logger?: Logger;
  channelRuntime?: ChannelRuntime;
}): Promise<RouterPluginHost> {
  const channels: string[] = [];
  const channelPlugins: unknown[] = [];
  const tools: RegisteredTool[] = [];
  const routes: RegisteredRoute[] = [];
  const routeHandlers: RegisteredRouteHandler[] = [];
  const hooks: RegisteredHook[] = [];
  const pluginConfig = input.pluginConfig ?? {};
  const runtime = createRouterPluginRuntime(input.label, input.configPath, pluginConfig, input.logger, input.channelRuntime);
  const { config: currentConfig } = readConfigFile(input.configPath);

  await input.plugin.register({
    id: input.hostId ?? input.plugin.id,
    name: input.hostName ?? input.plugin.name,
    version: "0.0.0",
    description: `${input.hostName ?? input.plugin.name} host`,
    source: input.source,
    config: currentConfig,
    pluginConfig,
    runtime,
    logger: {
      info: (message: string) => input.logger ? input.logger.info({ plugin: input.label }, message) : console.error(`[${input.label}-plugin] ${message}`),
      warn: (message: string) => input.logger ? input.logger.warn({ plugin: input.label }, message) : console.error(`[${input.label}-plugin] ${message}`),
      error: (message: string) => input.logger ? input.logger.error({ plugin: input.label }, message) : console.error(`[${input.label}-plugin] ${message}`),
    },
    registerTool(tool: unknown, opts?: { name?: string; names?: string[]; optional?: boolean }) {
      tools.push({ tool, opts });
    },
    registerHook(_events: unknown, _handler: unknown, _opts?: unknown) {},
    registerHttpRoute(params: { path?: string; auth?: string; match?: string; handler?: unknown }) {
      const route = {
        path: String(params.path ?? ""),
        ...(params.auth ? { auth: params.auth } : {}),
        ...(params.match ? { match: params.match } : {}),
      };
      routes.push(route);
      routeHandlers.push({ ...route, ...(params.handler ? { handler: params.handler } : {}) });
    },
    registerChannel(registration: { plugin?: { id?: string }; id?: string }) {
      const channelId = registration.plugin?.id ?? registration.id;
      if (channelId) channels.push(channelId);
      if (registration.plugin) channelPlugins.push(registration.plugin);
    },
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerProvider() {},
    registerCommand() {},
    registerContextEngine() {},
    resolvePath(path: string) {
      return path;
    },
    on(hookName: string) {
      hooks.push({ hookName });
    },
  });

  return {
    id: input.plugin.id,
    name: input.plugin.name,
    channels: [...new Set(channels)],
    channelPlugins,
    toolNames: tools
      .map(({ tool, opts }) => {
        const namedTool = tool as { name?: string };
        return opts?.name ?? namedTool.name ?? "";
      })
      .filter(Boolean),
    routes,
    hooks,
    routeHandlers,
    runtime,
    pluginConfig,
  };
}
