/**
 * E2BSandboxManager — E2B/Cube Sandbox implementation of OpenCodeSandboxManager.
 *
 * Mirrors the local SandboxManager shape: manager owns per-identity instances,
 * instances own lifecycle, serialization, readiness, monitoring, and disposal.
 *
 * Design notes for the Cube/E2B variant:
 *
 * - The sandbox template already runs `opencode serve` as its main process.
 *   We never launch opencode ourselves — the sandbox image owns that.
 *
 * - IMPORTANT: The current CubeAPI version does NOT pass `envs` from
 *   `Sandbox.create` into the container.
 *
 * - host-mount strategy: the host directory is mounted at /home/user inside
 *   the sandbox. This means opencode's config/data dirs
 *   (/home/user/.config/opencode, /home/user/.local/share/opencode) live on
 *   the host and can be pre-populated before or between sandbox runs.
 *   The workspace is at /home/user/workspace (E2B_WORKSPACE).
 *
 * - auth.json and opencode.json are written to the host directory on every
 *   ensure() call, before opencode starts reading them.
 */

import { Effect, Semaphore } from "effect";
import { Sandbox } from "@e2b/code-interpreter";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  OpenCodeSandboxManager,
  ProviderSecret,
  SandboxConnection,
  SandboxPresence,
  SandboxRuntime,
  SandboxStatus,
} from "./types";
import {
  createOpencodeServerClient,
  OPENCODE_GUEST_PORT,
  waitForOpenCodeReady,
} from "./opencode-client";
import { buildSandboxEnvironment } from "./env";
import { buildOpencodeAgentJson, buildSandboxName } from "./workspace";
import { initFilesystem } from "./workspace";
import type { BridgeStore } from "../opencode-router/db.js";
import type { Config } from "../opencode-router/config.js";

import agentsMd from "../opencode-router/workspace-template/AGENTS.txt";
import toolsMd from "../opencode-router/workspace-template/TOOLS.txt";
import memoryMd from "../opencode-router/workspace-template/MEMORY.txt";

function isMissingkilldSandboxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cause =
    error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const causeMessage =
    cause instanceof Error ? cause.message : String(cause ?? "");
  return (
    message.includes("SandboxNotFoundError") ||
    message.includes("killd sandbox") ||
    message.includes("not found") ||
    causeMessage.includes("SandboxNotFoundError") ||
    causeMessage.includes("killd sandbox") ||
    causeMessage.includes("not found")
  );
}

async function inspectE2BSandbox(
  sandboxId: string,
  cfg: Pick<E2BSandboxManagerConfig, "apiKey" | "apiUrl" | "timeoutMs">,
): Promise<SandboxPresence> {
  try {
    const info = await Sandbox.getInfo(sandboxId, {
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl,
      timeoutMs: cfg.timeoutMs,
    } as any);
    return { exists: true, state: (info as { state?: string }).state };
  } catch (error) {
    if (isMissingkilldSandboxError(error)) return { exists: false };
    throw error;
  }
}

export interface E2BSandboxManagerConfig {
  apiKey: string;
  apiUrl?: string;
  template: string;
  timeoutMs: number;
  idleTtlMs: number;
  maxRuntimeMs: number;
  opencodePort: number;
  secrets: ProviderSecret[];
  cleanupIntervalMs: number;
  hostMountEnabled: boolean;
  hostMountWorkspaceRoot: string;
  store?: BridgeStore;
  logger?: Logger;
  /** Parsed router config — used to write opencode.json into the sandbox. */
  config: Config;
}

const API_KEY_PROVIDER: Record<string, string> = {
  DEEPSEEK_API_KEY: "deepseek",
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
};

export const E2B_HOME = "/home/user";
export const E2B_WORKSPACE = "/home/user/workspace";

const E2B_OPENCODE_PATHS = {
  configDir: "/home/user/.config/opencode",
  dataDir: "/home/user/.local/share/opencode",
  stateDir: "/home/user/.local/state",
  cacheDir: "/home/user/.cache",
  authJson: "/home/user/.local/share/opencode/auth.json",
  opencodeJson: "/home/user/.config/opencode/opencode.json",
} as const;

class E2BSandboxInstance implements SandboxRuntime {
  sandboxName: string;
  template: string;
  hostPort = 0;
  guestPort: number;
  workspaceHostPath = "";
  /**
   * Derived entirely from `this.sandbox`:
   *   sandbox !== null → "running"
   *   sandbox === null → "stopped"
   *
   * No manually written status field — the sandbox handle IS the source of truth.
   */
  get status(): SandboxStatus {
    return this.sandbox !== null ? "running" : "stopped";
  }
  lastActivityAt = 0;
  lastHealthCheckAt = 0;
  createdAt = 0;
  done: Promise<void> = Promise.resolve();
  sandboxId = "";

  private sandbox: Sandbox | null = null;
  private client: OpencodeClient | null = null;
  private baseUrl = "";
  private readonly mutex = Semaphore.makeUnsafe(1);

  constructor(
    public identity: string,
    private cfg: E2BSandboxManagerConfig,
    private logger: Logger | undefined,
    private onDispose: (identity: string, instance: E2BSandboxInstance) => void,
  ) {
    this.sandboxName = buildSandboxName(identity);
    this.template = cfg.template;
    this.guestPort = cfg.opencodePort;
  }

  setLogger(logger: Logger | undefined): void {
    this.logger = logger;
  }

  ensure(sandboxId?: string | null): Promise<SandboxConnection> {
    if (sandboxId && !this.sandboxId) this.sandboxId = sandboxId;
    return this.runExclusive(this.acquireEffect());
  }

  stop(reason: "idle" | "manual" = "manual"): Promise<void> {
    return this.runExclusive(this.killEffect(reason));
  }

  remove(): Promise<void> {
    return this.runExclusive(this.destroyEffect());
  }

  provisionFiles(sourcePaths: string[]): Promise<Map<string, string>> {
    return this.runExclusive(
      Effect.tryPromise(() => this.uploadFilesAsync(sourcePaths)),
    );
  }

  private acquireEffect(): Effect.Effect<SandboxConnection, unknown> {
    return Effect.suspend(() => {
      // Already have an in-memory sandbox handle — verify it is still running
      // against the E2B API before reusing.
      if (this.sandbox !== null && this.client) {
        const sb = this.sandbox;
        return Effect.tryPromise(async (): Promise<SandboxConnection> => {
          const alive = await sb.isRunning();
          if (alive) {
            this.logger?.info({ sandboxId: this.sandboxId }, "reuse running e2b sandbox");
            this.lastActivityAt = Date.now();
            return this.connection();
          }
          // Sandbox died externally — clear stale handle and start fresh.
          this.logger?.warn({ sandboxId: this.sandboxId }, "sandbox no longer running; clearing stale handle");
          this.sandbox = null;
          this.client = null;
          this.baseUrl = "";
          return this.sandboxId
            ? this.reconnectSandboxAsync()
            : this.createSandboxAsync();
        });
      }

      // Clean up any stale in-memory sandbox handle before starting fresh.
      const cleanup = this.sandbox
        ? this.killEffect("manual", false)
        : Effect.void;

      // Choose path based on whether we have a persisted sandboxId to reconnect.
      const start = this.sandboxId
        ? Effect.tryPromise(() => this.reconnectSandboxAsync())
        : Effect.tryPromise(() => this.createSandboxAsync());

      return cleanup.pipe(Effect.andThen(start));
    });
  }

  private killEffect(
    reason: "idle" | "manual",
    dispose = true,
  ): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      const sb = this.sandbox;
      const stopCurrent = sb
        ? Effect.ignore(Effect.tryPromise(() => sb.kill()))
        : Effect.void;

      return stopCurrent.pipe(
        Effect.andThen(() => this.clearRuntimeState(dispose)),
      );
    });
  }

  private destroyEffect(): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      const sb = this.sandbox;
      const killCurrent = sb
        ? Effect.ignore(Effect.tryPromise(() => sb.kill()))
        : Effect.void;

      return killCurrent.pipe(
        Effect.andThen(() => this.clearRuntimeState(true)),
      );
    });
  }

  private async uploadFilesAsync(
    sourcePaths: string[],
  ): Promise<Map<string, string>> {
    if (!this.sandbox) {
      throw new Error(`Sandbox not running for: ${this.identity}`);
    }
    const mediaDir = `${E2B_WORKSPACE}/.opencode-router/media`;
    await this.sandbox.commands.run(`mkdir -p ${mediaDir}`);
    const entries = await Promise.all(
      sourcePaths.map(async (src) => {
        const dst = `${mediaDir}/${basename(src)}`;
        const content = await readFile(src);
        await this.sandbox!.files.write(dst, content as unknown as string);
        return [src, dst] as const;
      }),
    );
    return new Map(entries);
  }

  private runExclusive<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
    return Effect.runPromise(this.mutex.withPermit(effect));
  }

  private clearRuntimeState(dispose: boolean): Effect.Effect<void> {
    return Effect.sync(() => {
      this.sandbox = null;
      this.client = null;
      this.baseUrl = "";
      if (dispose) this.sandboxId = "";
      if (dispose) this.onDispose(this.identity, this);
    });
  }

  // ── Entry points: create vs reconnect ──────────────────────────────────

  /**
   * Create a brand-new sandbox from the configured template and wait for
   * opencode (the sandbox main process) to become healthy.
   */
  private async createSandboxAsync(): Promise<SandboxConnection> {
    this.logger?.info(
      { template: this.cfg.template, identity: this.identity },
      "creating new e2b sandbox",
    );

    if (this.cfg.hostMountEnabled) {
      const hostPaths = initFilesystem(this.identity, {
        workspaceRoot: this.cfg.hostMountWorkspaceRoot,
      });
      this.workspaceHostPath = hostPaths.workspaceHostPath;
    }

    const metadata: Record<string, string> = {
      "opencode.identity": this.identity,
    };
    if (this.cfg.hostMountEnabled && this.workspaceHostPath) {
      metadata["host-mount"] = JSON.stringify([
        { hostPath: this.workspaceHostPath, mountPath: E2B_HOME },
      ]);
    }

    this.logger?.info(
      {
        template: this.cfg.template,
        apiUrl: this.cfg.apiUrl,
        metadata,
        hostMountEnabled: this.cfg.hostMountEnabled,
        workspaceHostPath: this.workspaceHostPath || null,
        mountPath: E2B_HOME,
        // NOTE: envs is passed here but the current CubeAPI version does NOT
        // forward envs into the container.
      },
      "sandbox create params",
    );

    const sb = await Sandbox.create(this.cfg.template, {
      apiKey: this.cfg.apiKey,
      apiUrl: this.cfg.apiUrl,
      metadata,
      envs: buildSandboxEnvironment(this.cfg.secrets),
    });
    this.logger?.info({ sandboxId: sb.sandboxId }, "e2b sandbox created");

    await Effect.runPromise(this.writeWorkspaceFilesEffect(sb));
    this.attachSandboxState(sb);
    this.resetSession();
    const conn = await this.attachAndAwaitOpencode(sb);
    return conn;
  }

  /**
   * Reconnect to the sandbox identified by `this.sandboxId`.
   * Falls back to createSandboxAsync if the sandbox is gone.
   */
  private async reconnectSandboxAsync(): Promise<SandboxConnection> {
    const sid = this.sandboxId;
    this.logger?.info(
      { sandboxId: sid },
      "reconnecting to existing e2b sandbox",
    );

    // Verify the sandbox still exists on the provider.
    const presence = await inspectE2BSandbox(sid, this.cfg);
    if (!presence.exists) {
      this.logger?.warn(
        { sandboxId: sid },
        "sandbox no longer exists; falling back to create",
      );
      this.sandboxId = "";
      return this.createSandboxAsync();
    }

    // Attach to the running sandbox.
    let sb: Sandbox;
    try {
      sb = await Sandbox.connect(sid, {
        apiKey: this.cfg.apiKey,
        apiUrl: this.cfg.apiUrl,
        timeoutMs: this.cfg.timeoutMs,
      });
    } catch (err) {
      if (isMissingkilldSandboxError(err)) {
        this.logger?.warn(
          { sandboxId: sid },
          "connect failed: sandbox dead; falling back to create",
        );
        this.sandboxId = "";
        return this.createSandboxAsync();
      }
      throw err;
    }

    // Confirm the sandbox is actually running.
    const running = await sb.isRunning().catch(() => false);
    if (!running) {
      this.logger?.warn(
        { sandboxId: sid },
        "sandbox not running; falling back to create",
      );
      this.sandboxId = "";
      return this.createSandboxAsync();
    }

    this.logger?.info({ sandboxId: sid }, "sandbox reachable; waiting for opencode");

    this.attachSandboxState(sb);
    await Effect.runPromise(this.writeWorkspaceFilesEffect(sb));
    const conn = await this.attachAndAwaitOpencode(sb);
    return conn;
  }

  // ── Shared post-setup: wait for opencode ready ────────────────────────

  /**
   * Wait until the opencode process (started automatically by the sandbox
   * template as the main process) becomes healthy.
   * We never launch opencode ourselves — the sandbox image owns that.
   */
  private attachAndAwaitOpencode(sb: Sandbox): Promise<SandboxConnection> {
    const client = createOpencodeServerClient(0, this.baseUrl, E2B_WORKSPACE);
    this.client = client;
    // done resolves immediately — opencode lifecycle is tied to the sandbox
    this.done = Promise.resolve();
    this.logger?.info(
      { sandboxId: sb.sandboxId, baseUrl: this.baseUrl },
      "waiting for opencode (sandbox main process)",
    );

    return Effect.runPromise(
      this.readyEffect(client).pipe(
        Effect.tapError(() => this.crashEffect(sb)),
      ),
    );
  }

  /** Bind in-memory runtime fields to the connected sandbox handle. */
  private attachSandboxState(sb: Sandbox): void {
    this.sandbox = sb;
    this.sandboxId = sb.sandboxId;
    this.template = this.cfg.template;
    this.hostPort = 0;
    this.guestPort = this.cfg.opencodePort;
    this.baseUrl = `https://${sb.getHost(this.guestPort)}`;
    this.lastActivityAt = Date.now();
    this.lastHealthCheckAt = Date.now();
    this.createdAt = Date.now();

    // Persist sandbox info to DB.
    const [ch, id, pk] = this.identity.split(":");
    this.cfg.store?.upsertSandbox(
      ch,
      id,
      pk,
      sb.sandboxId,
      "running",
      this.workspaceHostPath,
      "",
    );
  }

  /** Drop persisted session data after creating a fresh sandbox. */
  private resetSession(): void {
    const [ch, id, pk] = this.identity.split(":");
    this.cfg.store?.clearSession(ch, id, pk);
  }

  private writeWorkspaceFilesEffect(
    sb: Sandbox,
  ): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      this.logger?.info(
        { sandboxId: sb.sandboxId },
        "workspace files: start setup",
      );

      const auth: Record<string, { type: "api"; key: string }> = {};
      for (const s of this.cfg.secrets) {
        const provider = API_KEY_PROVIDER[s.envName];
        if (provider && s.value) auth[provider] = { type: "api", key: s.value };
      }

      return Effect.tryPromise(async () => {
        // auth.json: opencode reads on every auth lookup (no cache).
        if (Object.keys(auth).length > 0) {
          await sb.files.write(
            E2B_OPENCODE_PATHS.authJson,
            JSON.stringify(auth, null, 2) + "\n",
          );
        }

        // opencode.json: written on every ensure() so config is always current.
        await sb.files.write(
          E2B_OPENCODE_PATHS.opencodeJson,
          buildOpencodeAgentJson(this.cfg.config) + "\n",
        );

        // Template files — only write if absent (persists user edits across restarts).
        for (const [name, content] of [
          ["AGENTS.md", agentsMd],
          ["TOOLS.md", toolsMd],
          ["MEMORY.md", memoryMd],
        ] as const) {
          const p = `${E2B_WORKSPACE}/${name}`;
          if (!(await sb.files.exists(p))) await sb.files.write(p, content);
        }

        this.logger?.info({ sandboxId: sb.sandboxId }, "workspace files ready");
      });
    });
  }

  private readyEffect(
    client: OpencodeClient,
  ): Effect.Effect<SandboxConnection, unknown> {
    this.logger?.info({ baseUrl: this.baseUrl }, "wait e2b opencode ready");
    return Effect.tryPromise(() =>
      waitForOpenCodeReady(client, E2B_WORKSPACE, this.logger),
    ).pipe(
      Effect.andThen(
        Effect.sync(() => {
          this.lastHealthCheckAt = Date.now();
          this.lastActivityAt = Date.now();
          this.logger?.info(
            {
              sandboxId: this.sandboxId,
              baseUrl: this.baseUrl,
              status: "running",
            },
            "sandbox status => running (opencode ready)",
          );
          void this.sandbox?.setTimeout(this.cfg.timeoutMs).catch(() => {});
          return this.connection();
        }),
      ),
    );
  }

  private crashEffect(sb: Sandbox): Effect.Effect<void, never> {
    return Effect.ignore(Effect.tryPromise(() => sb.kill())).pipe(
      Effect.andThen(
        Effect.sync(() => this.logger?.error("e2b startup crashed")),
      ),
      Effect.andThen(() => this.clearRuntimeState(true)),
    );
  }

  private connection(): SandboxConnection {
    return {
      sandboxName: this.sandboxName,
      sandboxId: this.sandboxId,
      directory: E2B_WORKSPACE,
      baseUrl: this.baseUrl,
      hostPort: 0,
      client: this.client!,
      release: async () => {},
    };
  }
}

export class E2BSandboxManager implements OpenCodeSandboxManager {
  private instances = new Map<string, E2BSandboxInstance>();

  constructor(private cfg: E2BSandboxManagerConfig) {}

  setStore(store: BridgeStore): void {
    this.cfg.store = store;
  }

  private prepareEnvironment(): void {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= "0";
    const noProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? "";
    const entries = [".cube.app", "cube.app", "*.cube.app", "172.16.17.231"];
    process.env.no_proxy = [noProxy, ...entries].filter(Boolean).join(",");
    process.env.NO_PROXY = process.env.no_proxy;
  }

  private createInstance(identity: string): E2BSandboxInstance {
    return new E2BSandboxInstance(
      identity,
      this.cfg,
      this.cfg.logger?.child({ identity }),
      (id, disposed) => {
        if (this.instances.get(id) === disposed) {
          this.instances.delete(id);
        }
      },
    );
  }

  setLogger(logger: Logger | undefined): void {
    this.cfg.logger = logger;
    for (const instance of this.instances.values()) {
      instance.setLogger(logger?.child({ identity: instance.identity }));
    }
  }

  async ensureRuntime(
    identity: string,
    sandboxId?: string | null,
  ): Promise<SandboxConnection> {
    this.prepareEnvironment();
    this.cfg.logger?.info(
      { identity, sandboxId: sandboxId ?? null },
      "ensure e2b sandbox runtime",
    );
    let instance = this.instances.get(identity);
    if (!instance) {
      instance = this.createInstance(identity);
      this.instances.set(identity, instance);
    }
    return instance.ensure(sandboxId);
  }

  async inspectSandbox(sandboxId: string): Promise<SandboxPresence> {
    this.prepareEnvironment();
    return inspectE2BSandbox(sandboxId, this.cfg);
  }

  async getRuntime(identity: string): Promise<SandboxRuntime | null> {
    return this.instances.get(identity) ?? null;
  }

  async listRuntimes(): Promise<SandboxRuntime[]> {
    return Array.from(this.instances.values());
  }

  async provisionFiles(
    identity: string,
    sourcePaths: string[],
  ): Promise<Map<string, string>> {
    const instance = this.instances.get(identity);
    if (!instance) throw new Error(`Sandbox not found for: ${identity}`);
    return instance.provisionFiles(sourcePaths);
  }

  async stopRuntime(
    identity: string,
    reason: "idle" | "manual",
  ): Promise<void> {
    await this.instances.get(identity)?.stop(reason);
  }

  async removeRuntime(identity: string): Promise<void> {
    await this.instances.get(identity)?.remove();
    this.instances.delete(identity);
  }

  async shutdown(): Promise<void> {
    for (const instance of this.instances.values()) {
      await instance.stop("manual");
    }
  }
}
