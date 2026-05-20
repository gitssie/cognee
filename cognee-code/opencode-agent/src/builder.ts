import { join } from "node:path";
import type { OpenCodeClientProvider } from "./opencode-router/client-provider";

import { loadConfig, type Config } from "./opencode-router/config";
import { startRouter } from "./router";
import { E2BSandboxManager, createSandboxClientProvider } from "./sandbox/index";
import { createLocalProvider } from "./opencode-router/local-provider";
import type { ProviderSecret } from "./sandbox/types";
import { makeRuntime } from "./events";
import { WorkspaceInitLive } from "./opencode-router/workspace-init";
import { startAdminProxy } from "./admin-proxy";
import { createLogger } from "./opencode-router/logger";

// ── Shared helpers ─────────────────────────────────────────

function resolveSecrets(config: Config): ProviderSecret[] {
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
  private _secrets?: ProviderSecret[];

  static create(): ServiceBuilder {
    return new ServiceBuilder();
  }

  withSecrets(secrets: ProviderSecret[]): this {
    this._secrets = [...secrets];
    return this;
  }

  async build(): Promise<Service> {
    // Parse config exactly once — all sub-systems receive Config directly.
    const config = loadConfig(process.env, { requireOpencode: false });
    return this._build(config);
  }

  private async _build(config: Config): Promise<Service> {
    const cleanup: Array<() => Promise<void> | void> = [];
    let provider: OpenCodeClientProvider;
    let manager: E2BSandboxManager | undefined;

    // Single unified log file for the entire service (router + sandbox + builder)
    const logPath = join(config.paths.logDir, "opencode-agent.log");
    const logger = createLogger(config.logLevel, { logFile: logPath });

    if (config.mode === "directory") {
      logger.info({ mode: "directory", workspaceRoot: config.directory.workspaceRoot }, "opencode-agent: directory mode");
      console.log(`[opencode-agent] Directory mode (shared opencode serve)`);
      console.log(`[opencode-agent] opencode url:         ${config.opencodeUrl}`);
      console.log(`[opencode-agent] workspace root:       ${config.directory.workspaceRoot}`);

      provider = createLocalProvider(config, logger);
      process.env.OPENCODE_URL = config.opencodeUrl;
    } else {
      // sandbox mode
      const { sandbox } = config;
      const secrets = this._secrets ?? resolveSecrets(config);

      logger.info(
        { mode: "sandbox", provider: "e2b", apiUrl: sandbox.apiUrl || "(cloud)", template: sandbox.template, timeoutMs: sandbox.timeoutMs, secrets: secrets.map(s => s.envName) },
        "opencode-agent: sandbox mode",
      );
      console.log(`[opencode-agent] Sandbox mode (E2B/Cube Sandbox)`);
      console.log(`[opencode-agent] e2b api url:    ${sandbox.apiUrl || "(cloud)"}`);
      console.log(`[opencode-agent] e2b template:   ${sandbox.template}`);
      console.log(`[opencode-agent] e2b timeoutMs:  ${sandbox.timeoutMs}`);
      console.log(`[opencode-agent] secrets:        ${secrets.map(s => s.envName).join(", ") || "none"}`);

      makeRuntime(WorkspaceInitLive as any);

      manager = new E2BSandboxManager({
        apiKey: sandbox.apiKey,
        apiUrl: sandbox.apiUrl || undefined,
        template: sandbox.template,
        timeoutMs: sandbox.timeoutMs,
        opencodePort: sandbox.opencodePort,
        idleTtlMs: sandbox.idleTtlMs,
        maxRuntimeMs: sandbox.maxRuntimeMs,
        cleanupIntervalMs: sandbox.cleanupIntervalMs,
        hostMountEnabled: sandbox.hostMountEnabled,
        hostMountWorkspaceRoot: sandbox.hostMountWorkspaceRoot,
        secrets,
        logger: logger.child({ component: "sandbox", provider: "e2b" }),
        config,
      });

      provider = createSandboxClientProvider(manager, logger);
      cleanup.push(() => manager!.shutdown().catch(() => {}));

      const stopAdminProxy = startAdminProxy(manager, {
        port: 4096,
        host: sandbox.healthHost,
      });
      cleanup.push(stopAdminProxy);

      process.env.OPENCODE_URL = "http://127.0.0.1:4096";
    }

    const router = await startRouter(provider, { sandboxManager: manager as any }, config, logger);

    console.log(`[opencode-agent] router config: ${router.configPath}`);
    console.log(`[opencode-agent] router logs:   ${logPath}`);
    logger.info({ configPath: router.configPath, logPath }, "opencode-agent service started");

    return {
      log: { configPath: router.configPath, routerLogPath: logPath, serviceLogPath: logPath },
      async stop() {
        logger.info("opencode-agent service stopping");
        await router.stop().catch(() => {});
        for (const stop of cleanup.reverse()) await stop();
      },
    };
  }
}
