import { createOpencode, type Agent } from "@opencode-ai/sdk/v2";
import { join } from "node:path";
import type { OpenCodeClientProvider } from "./opencode-router/client-provider";

import {
  buildOpencodeOptions,
  buildRouterEnv,
  buildSandboxConfig,
  getRouterRuntimePaths,
  type RouterRuntimePaths,
} from "./config";
import { startRouter, type RouterHandle } from "./router";
import { SandboxManager, HttpSandboxManager, E2BSandboxManager, createSandboxClientProvider } from "./sandbox/index";
import { createLocalProvider } from "./opencode-router/local-provider";
import type { ProviderSecret } from "./sandbox/types";
import { makeRuntime } from "./events";
import { WorkspaceInitLive } from "./opencode-router/workspace-init";
import { startAdminProxy } from "./admin-proxy";
import { createLogger } from "./opencode-router/logger";

// ── Shared helpers ─────────────────────────────────────────

function toLoopback(url: string): string {
  const u = new URL(url);
  if (u.hostname === "0.0.0.0") u.hostname = "127.0.0.1";
  return u.toString();
}

function resolveSecrets(): ProviderSecret[] {
  const secrets: ProviderSecret[] = [];
  const envs = [
    ["ANTHROPIC_API_KEY", "api.anthropic.com"],
    ["OPENAI_API_KEY", "api.openai.com"],
    ["DEEPSEEK_API_KEY", "api.deepseek.com"],
  ] as const;
  for (const [env, host] of envs) {
    const val = process.env[env]?.trim();
    if (val) secrets.push({ envName: env, value: val, allowHosts: [host] });
  }
  return secrets;
}

// ── Service type ───────────────────────────────────────────

export interface Service {
  stop(): Promise<void>;
  log: {
    configPath: string;
    routerLogPath: string;
    serviceLogPath: string;
  };
}

// ── Builder ────────────────────────────────────────────────

export class ServiceBuilder {
  private readonly _mode: "sandbox" | "classic";
  private readonly _paths: RouterRuntimePaths;
  private _secrets?: ProviderSecret[];

  private constructor(mode: "sandbox" | "classic", paths: RouterRuntimePaths) {
    this._mode = mode;
    this._paths = paths;
  }

  /** Start building a sandbox-mode service (microsandbox per-user isolation). */
  static sandbox(paths?: RouterRuntimePaths): ServiceBuilder {
    return new ServiceBuilder("sandbox", paths ?? getRouterRuntimePaths());
  }

  /** Start building a classic-mode service (single shared OpenCode server). */
  static classic(paths?: RouterRuntimePaths): ServiceBuilder {
    return new ServiceBuilder("classic", paths ?? getRouterRuntimePaths());
  }

  /** Provide API keys forwarded into sandboxes (sandbox mode only). */
  withSecrets(secrets: ProviderSecret[]): this {
    this._secrets = [...secrets];
    return this;
  }

  /** Build and start the service. Returns a running {@link Service}. */
  async build(): Promise<Service> {
    return this._build();
  }

  private async _build(): Promise<Service> {
    const cleanup: Array<() => Promise<void> | void> = [];
    let provider: OpenCodeClientProvider;
    const serviceLogPath = join(this._paths.logDir, "service.log");
    const serviceLogger = createLogger(process.env.LOG_LEVEL?.trim() || "info", {
      logFile: serviceLogPath,
    });

    if (this._mode === "classic") {
      console.log("[opencode-agent] Classic mode (single shared OpenCode server)");
      serviceLogger.info({ mode: "classic" }, "start opencode-agent service");
      const opencode = await createOpencode(buildOpencodeOptions());
      cleanup.push(() => opencode.server.close());
      Object.assign(process.env, buildRouterEnv(toLoopback(opencode.server.url), this._paths));
      provider = createLocalProvider();

      const agents = await opencode.client.app.agents();
      console.log(`OpenCode server running at ${opencode.server.url}`);
      console.log(`Available agents: ${(agents.data ?? []).map((a: Agent) => a.name).join(", ") || "none"}`);
    } else {
    const secrets = this._secrets ?? resolveSecrets();
    const config = buildSandboxConfig(this._paths);

    console.log(`[opencode-agent] Sandbox mode (provider: ${config.provider})`);
    serviceLogger.info({ mode: "sandbox", provider: config.provider }, "start opencode-agent service");
    if (config.provider === "e2b") {
      console.log(`[opencode-agent] e2b api url:    ${config.e2bApiUrl || "(cloud)"}`);
      console.log(`[opencode-agent] e2b template:   ${config.e2bTemplate}`);
      console.log(`[opencode-agent] e2b timeoutMs:  ${config.e2bTimeoutMs}`);
      serviceLogger.info(
        {
          apiUrl: config.e2bApiUrl || "(cloud)",
          template: config.e2bTemplate,
          timeoutMs: config.e2bTimeoutMs,
        },
        "e2b sandbox config",
      );
    } else {
      console.log(`[opencode-agent] sandbox root:   ${config.sandboxRoot}`);
      console.log(`[opencode-agent] port range:     ${config.portStart}–${config.portEnd}`);
      console.log(`[opencode-agent] image:          ${config.opencodeImage}`);
      serviceLogger.info(
        {
          provider: config.provider,
          sandboxRoot: config.sandboxRoot,
          portStart: config.portStart,
          portEnd: config.portEnd,
          image: config.opencodeImage,
        },
        "sandbox config",
      );
    }
    console.log(`[opencode-agent] secrets:        ${secrets.map(s => s.envName).join(", ") || "none"}`);

    // Compose effect layers — mirrors opencode bootstrap-runtime Layer.mergeAll pattern.
    // WorkspaceTemplate depends on EventBus; both are composed into a single runtime.
    makeRuntime(WorkspaceInitLive as any);

    // Select SandboxManager based on deployment mode:
    // - E2B/Cube:  @e2b/code-interpreter SDK (cloud or self-hosted Cube Sandbox)
    // - MCP/HTTP:  remote MCP sandbox server (open-code-agent in Docker)
    // - Local:     microsandbox npm package (requires /dev/kvm on host)
    const manager = config.provider === "e2b"
      ? new E2BSandboxManager({
          apiKey: config.e2bApiKey ?? "dummy",
          apiUrl: config.e2bApiUrl || undefined,
          template: config.e2bTemplate ?? "opencode-tools",
          timeoutMs: config.e2bTimeoutMs ?? config.idleTtlMs,
          opencodePort: config.e2bOpencodePort,
          idleTtlMs: config.idleTtlMs,
           maxRuntimeMs: config.maxRuntimeMs,
           cleanupIntervalMs: config.cleanupIntervalMs,
           sandboxRoot: config.sandboxRoot,
           secrets,
           logger: serviceLogger.child({ component: "sandbox", provider: "e2b" }),
         })
       : config.provider === "http"
       ? new HttpSandboxManager({
          mcpUrl: config.mcpUrl!,
          sandboxRoot: config.sandboxRoot,
          portStart: config.portStart,
          portEnd: config.portEnd,
          idleTtlMs: config.idleTtlMs,
          maxRuntimeMs: config.maxRuntimeMs,
          opencodeImage: config.opencodeImage,
          cpus: config.cpus,
           memoryMb: config.memoryMb,
           cleanupIntervalMs: config.cleanupIntervalMs,
           secrets,
           logger: serviceLogger.child({ component: "sandbox", provider: "http" }),
         })
       : new SandboxManager({
          sandboxRoot: config.sandboxRoot,
          portStart: config.portStart,
          portEnd: config.portEnd,
          idleTtlMs: config.idleTtlMs,
          maxRuntimeMs: config.maxRuntimeMs,
          opencodeImage: config.opencodeImage,
          cpus: config.cpus,
           memoryMb: config.memoryMb,
           cleanupIntervalMs: config.cleanupIntervalMs,
           secrets,
           logger: serviceLogger.child({ component: "sandbox", provider: "local" }),
         });

    provider = createSandboxClientProvider(manager);
    cleanup.push(() => manager.shutdown().catch(() => {}));

    // Admin proxy so AgentPage.vue (admin panel) can reach the admin sandbox.
    // Lazy: the admin sandbox is created on first request, not at startup.
    const adminHost = process.env.OPENCODE_ADMIN_PROXY_HOST?.trim() || "127.0.0.1";
    Object.assign(process.env, buildRouterEnv("http://127.0.0.1:4096", this._paths));

    const stopAdminProxy = startAdminProxy(manager, { port: 4096, host: adminHost });
    cleanup.push(stopAdminProxy);
    }

    const router = await startRouter(provider, {
      sandboxManager: config.provider === "e2b" ? (manager as any) : undefined,
    });

    console.log(`[opencode-agent] router config: ${router.configPath}`);
    console.log(`[opencode-agent] router logs:   ${router.logPath}`);
    console.log(`[opencode-agent] service logs:  ${serviceLogPath}`);
    serviceLogger.info(
      { configPath: router.configPath, routerLogPath: router.logPath, serviceLogPath },
      "opencode-agent service started",
    );

    return {
      log: { configPath: router.configPath, routerLogPath: router.logPath, serviceLogPath },
      async stop() {
        serviceLogger.info("stop opencode-agent service");
        await router.stop().catch(() => {});
        for (const stop of cleanup.reverse()) await stop();
      },
    };
  }
}
