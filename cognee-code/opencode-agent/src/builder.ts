import { createOpencode, type Agent } from "@opencode-ai/sdk/v2";

import {
  buildOpencodeOptions,
  buildRouterEnv,
  buildSandboxConfig,
  getRouterRuntimePaths,
  type RouterRuntimePaths,
} from "./config";
import { startRouter, type RouterHandle } from "./router";
import { SandboxManager, HttpSandboxManager, createSandboxClientProvider } from "./sandbox/index";
import type { ProviderSecret } from "./sandbox/types";
import { makeRuntime } from "./events";
import { WorkspaceInitLive } from "./opencode-router/workspace-init";
import { startAdminProxy } from "./admin-proxy";

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
    logPath: string;
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
    return this._mode === "sandbox"
      ? this._buildSandbox()
      : this._buildClassic();
  }

  // ── Classic mode ───────────────────────────────────────

  private async _buildClassic(): Promise<Service> {
    console.log("[opencode-agent] Classic mode (single shared OpenCode server)");

    const opencode = await createOpencode(buildOpencodeOptions());
    Object.assign(process.env, buildRouterEnv(toLoopback(opencode.server.url), this._paths));
    const router = await startRouter();

    const agents = await opencode.client.app.agents();
    console.log(`OpenCode server running at ${opencode.server.url}`);
    console.log(`Available agents: ${(agents.data ?? []).map((a: Agent) => a.name).join(", ") || "none"}`);
    console.log(`OpenCode router config: ${router.configPath}`);
    console.log(`OpenCode router logs:   ${router.logPath}`);

    return {
      log: { configPath: router.configPath, logPath: router.logPath },
      async stop() {
        await router.stop().catch(() => {});
        opencode.server.close();
      },
    };
  }

  // ── Sandbox mode ───────────────────────────────────────

  private async _buildSandbox(): Promise<Service> {
    const secrets = this._secrets ?? resolveSecrets();
    const config = buildSandboxConfig(this._paths);

    console.log("[opencode-agent] Sandbox mode (microsandbox per-user isolation)");
    console.log(`[opencode-agent] sandbox root:   ${config.sandboxRoot}`);
    console.log(`[opencode-agent] port range:     ${config.portStart}–${config.portEnd}`);
    console.log(`[opencode-agent] image:          ${config.opencodeImage}`);
    console.log(`[opencode-agent] secrets:        ${secrets.map(s => s.envName).join(", ") || "none"}`);

    // Compose effect layers — mirrors opencode bootstrap-runtime Layer.mergeAll pattern.
    // WorkspaceTemplate depends on EventBus; both are composed into a single runtime.
    makeRuntime(WorkspaceInitLive as any);

    // Select SandboxManager based on deployment mode:
    // - Local:    microsandbox npm package (requires /dev/kvm on host)
    // - MCP/HTTP: remote MCP sandbox server (open-code-agent in Docker)
    const mcpUrl = process.env.OPENCODE_SANDBOX_MCP_URL?.trim();
    const manager = mcpUrl
      ? new HttpSandboxManager({
          mcpUrl,
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
        });

    const provider = createSandboxClientProvider(manager);
    const stopCleanupLoop = manager.startCleanupLoop();

    // Admin proxy so AgentPage.vue (admin panel) can reach the admin sandbox.
    // Lazy: the admin sandbox is created on first request, not at startup.
    const adminHost = process.env.OPENCODE_ADMIN_PROXY_HOST?.trim() || "127.0.0.1";
    Object.assign(process.env, buildRouterEnv("http://127.0.0.1:4096", this._paths));
    const router = await startRouter(provider);

    const stopAdminProxy = startAdminProxy(manager, { port: 4096, host: adminHost });

    console.log(`[opencode-agent] router config: ${router.configPath}`);
    console.log(`[opencode-agent] router logs:   ${router.logPath}`);

    return {
      log: { configPath: router.configPath, logPath: router.logPath },
      async stop() {
        stopCleanupLoop();
        stopAdminProxy();
        await router.stop().catch(() => {});
        await manager.shutdown().catch(() => {});
      },
    };
  }
}
