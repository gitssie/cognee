/**
 * E2BSandboxManager — E2B/Cube Sandbox implementation of OpenCodeSandboxManager.
 *
 * Mirrors the local SandboxManager shape: manager owns per-identity instances,
 * instances own lifecycle, serialization, readiness, monitoring, and disposal.
 */

import { Effect, Semaphore } from "effect";
import { Sandbox, type CommandHandle } from "@e2b/code-interpreter";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  OpenCodeSandboxManager,
  ProviderSecret,
  SandboxConnection,
  SandboxPresence,
  SandboxRuntime,
} from "./types";
import {
  createOpencodeServerClient,
  OPENCODE_GUEST_PORT,
  waitForOpenCodeReady,
} from "./opencode-client";
import { buildSandboxEnvironment } from "./env";
import { buildOpencodeAgentJson, buildSandboxName } from "./workspace";
import { initFilesystem, type WorkspacePaths } from "./workspace";
import type { BridgeStore } from "../opencode-router/db.js";

import agentsMd from "../opencode-router/workspace-template/AGENTS.txt";
import toolsMd from "../opencode-router/workspace-template/TOOLS.txt";
import memoryMd from "../opencode-router/workspace-template/MEMORY.txt";

function isMissingPausedSandboxError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
  const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
  return (
    message.includes("SandboxNotFoundError") ||
    message.includes("Paused sandbox") ||
    message.includes("not found") ||
    causeMessage.includes("SandboxNotFoundError") ||
    causeMessage.includes("Paused sandbox") ||
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
    if (isMissingPausedSandboxError(error)) return { exists: false };
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
  opencodePort?: number;
  secrets: ProviderSecret[];
  cleanupIntervalMs: number;
  sandboxRoot: string;
  store?: BridgeStore;
  logger?: Logger;
}

const API_KEY_PROVIDER: Record<string, string> = {
  DEEPSEEK_API_KEY: "deepseek",
  ANTHROPIC_API_KEY: "anthropic",
  OPENAI_API_KEY: "openai",
};

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
  image: string;
  hostPort = 0;
  guestPort: number;
  serverPassword = "";
  workspaceHostPath = "";
  opencodeDataHostPath = "";
  status: SandboxRuntime["status"] = "stopped";
  lastActivityAt = 0;
  lastHealthCheckAt = 0;
  createdAt = 0;
  done: Promise<void> = Promise.resolve();
  sandboxId = "";

  private sandbox: Sandbox | null = null;
  private client: OpencodeClient | null = null;
  private baseUrl = "";
  private readonly mutex = Semaphore.makeUnsafe(1);
  private sandboxRoot: string;

  constructor(
    public identity: string,
    private cfg: E2BSandboxManagerConfig,
    private logger: Logger | undefined,
    private onDispose: (identity: string, instance: E2BSandboxInstance) => void,
  ) {
    this.sandboxName = buildSandboxName(identity);
    this.image = cfg.template;
    this.guestPort = cfg.opencodePort ?? OPENCODE_GUEST_PORT;
    this.sandboxRoot = cfg.sandboxRoot;
  }

  setLogger(logger: Logger | undefined): void {
    this.logger = logger;
  }

  ensure(sandboxId?: string | null): Promise<SandboxConnection> {
    if (sandboxId && !this.sandboxId) this.sandboxId = sandboxId;
    return this.runExclusive(this.ensureEffect());
  }

  stop(reason: "idle" | "manual" = "manual"): Promise<void> {
    return this.runExclusive(this.stopEffect(reason));
  }

  remove(): Promise<void> {
    return this.runExclusive(this.removeEffect());
  }

  provisionFiles(sourcePaths: string[]): Promise<Map<string, string>> {
    return this.runExclusive(this.provisionFilesEffect(sourcePaths));
  }

  private ensureEffect(): Effect.Effect<SandboxConnection, unknown> {
    return Effect.suspend(() => {
      if (this.status === "running" && this.sandbox && this.client) {
        this.logger?.info({ sandboxId: this.sandboxId, sandboxName: this.sandboxName }, "reuse running e2b sandbox");
        return Effect.succeed(this.buildConnection());
      }

      this.logger?.info({ status: this.status, sandboxId: this.sandboxId }, "start e2b sandbox");
      if (this.sandbox) {
        return this.stopEffect("manual", false).pipe(Effect.andThen(() => this.startEffect()));
      }
      return this.startEffect();
    });
  }

  private stopEffect(
    reason: "idle" | "manual",
    dispose = true,
  ): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      const sb = this.sandbox;
      const stopCurrent = sb
        ? Effect.ignore(Effect.tryPromise(() => sb.pause()))
        : Effect.void;

      return stopCurrent.pipe(
        Effect.andThen(() => this.finalizeRuntimeEffect("stopped", dispose)),
      );
    });
  }

  private removeEffect(): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      const sb = this.sandbox;
      const killCurrent = sb
        ? Effect.ignore(Effect.tryPromise(() => sb.kill()))
        : Effect.void;

      return killCurrent.pipe(
        Effect.andThen(
          Effect.sync(() => {
            const [ch, id, pk] = this.identity.split(":");
            this.cfg.store?.deleteSandbox(ch, id, pk);
          }),
        ),
        Effect.andThen(() => this.finalizeRuntimeEffect("stopped", true)),
      );
    });
  }

  private provisionFilesEffect(
    sourcePaths: string[],
  ): Effect.Effect<Map<string, string>, unknown> {
    return Effect.suspend(() => {
      if (!this.sandbox) {
        return Effect.fail(new Error(`Sandbox not running for: ${this.identity}`));
      }
      const mediaDir = "/workspace/.opencode-router/media";
      return Effect.tryPromise(() => this.sandbox!.commands.run(`mkdir -p ${mediaDir}`)).pipe(
        Effect.andThen(
          Effect.forEach(sourcePaths, (src) => {
            const dst = `${mediaDir}/${basename(src)}`;
            return Effect.tryPromise(async () => {
              const content = await readFile(src);
              await this.sandbox!.files.write(dst, content as unknown as string);
              return [src, dst] as const;
            });
          }),
        ),
        Effect.map((entries) => new Map(entries)),
      );
    });
  }

  private runExclusive<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
    return Effect.runPromise(this.mutex.withPermit(effect));
  }

  private finalizeRuntimeEffect(
    status: SandboxRuntime["status"],
    dispose: boolean,
  ): Effect.Effect<void> {
    return Effect.sync(() => {
      this.sandbox = null;
      this.client = null;
      this.baseUrl = "";
      this.status = status;
      if (dispose) this.sandboxId = "";
      if (dispose) this.onDispose(this.identity, this);
    });
  }

  private startEffect(): Effect.Effect<SandboxConnection, unknown> {
    return Effect.suspend(() => {
      const password = randomUUID().replace(/-/g, "").slice(0, 20);
      const envs = buildSandboxEnvironment(password, this.cfg.secrets);
      const self = this;
      // Initialize host workspace/data directories (idempotent — both create and connect paths)
      const hostPaths: WorkspacePaths = initFilesystem(self.identity, {
        sandboxRoot: self.sandboxRoot,
        secrets: self.cfg.secrets,
      });
      self.workspaceHostPath = hostPaths.workspaceHostPath;
      self.opencodeDataHostPath = hostPaths.opencodeDataHostPath;
      this.logger?.info(
        { template: this.cfg.template, apiUrl: this.cfg.apiUrl, sandboxId: this.sandboxId },
        this.sandboxId ? "connect e2b sandbox" : "resolve e2b sandbox",
      );

      /** Shared sandbox creation helper. */
      function createSandbox() {
        return Sandbox.create(self.cfg.template, {
          apiKey: self.cfg.apiKey,
          apiUrl: self.cfg.apiUrl,
          timeoutMs: self.cfg.timeoutMs,
          metadata: {
            "opencode.identity": self.identity,
            "opencode.sandboxName": self.sandboxName,
            "host-mount": JSON.stringify([
              { hostPath: self.workspaceHostPath, mountPath: "/workspace" },
              { hostPath: self.opencodeDataHostPath, mountPath: "/data" },
            ]),
          },
          envs,
        });
      }

      /** Connect to an existing sandbox by id. */
      function connectSandbox(sandboxId: string) {
        return Sandbox.connect(sandboxId, {
          apiKey: self.cfg.apiKey,
          apiUrl: self.cfg.apiUrl,
          timeoutMs: self.cfg.timeoutMs,
        });
      }

      /** Look up existing sandbox for this identity via metadata query. */
      async function findSandboxByIdentity(): Promise<Sandbox | null> {
        self.logger?.info({ identity: self.identity }, "lookup e2b sandbox by metadata");
        const domain = self.cfg.apiUrl ? new URL(self.cfg.apiUrl).host : undefined;
        const paginator = Sandbox.list({
          apiKey: self.cfg.apiKey,
          ...(domain ? { domain } : {}),
          query: {
            metadata: { "opencode.identity": self.identity },
            state: ["running", "paused"],
          },
          limit: 1,
        });
        const items = await paginator.nextItems();
        if (items.length > 0) {
          self.logger?.info({ sandboxId: items[0].sandboxId, state: items[0].state }, "found e2b sandbox via metadata");
          return connectSandbox(items[0].sandboxId);
        }
        return null;
      }

      /** Try metadata query first, then create new if nothing found. */
      async function findOrCreate(): Promise<Sandbox> {
        const found = await findSandboxByIdentity();
        if (found) return found;
        return createSandbox();
      }

      const sandboxEffect = this.sandboxId
        ? Effect.tryPromise(async () => {
            const sandboxId = this.sandboxId;
            const presence = await inspectE2BSandbox(sandboxId, this.cfg);
            if (!presence.exists) {
              self.logger?.warn({ sandboxId }, "stale e2b sandbox missing; trying metadata query");
              self.sandboxId = "";
              return findOrCreate();
            }
            self.logger?.info({ sandboxId, state: presence.state }, "connect existing e2b sandbox");
            return connectSandbox(sandboxId);
          })
        : Effect.tryPromise(() => findOrCreate());

      return sandboxEffect.pipe(
        Effect.flatMap((sb) =>
          this.ensureWorkspaceFilesEffect(sb).pipe(
            Effect.andThen(() =>
              Effect.sync(() => {
              const handle = this.startOpencodeProcessEffect(sb);
              this.sandbox = sb;
              this.sandboxId = sb.sandboxId;
              this.image = this.cfg.template;
              this.hostPort = 0;
              this.guestPort = this.cfg.opencodePort ?? OPENCODE_GUEST_PORT;
              this.serverPassword = password;
              this.baseUrl = `https://${sb.getHost(this.guestPort)}`;
              this.status = "starting";
              this.lastActivityAt = Date.now();
              this.lastHealthCheckAt = Date.now();
              this.createdAt = Date.now();
              this.done = this.monitorOpencode(sb, handle);

              // Persist sandbox to DB for session-independent lifecycle tracking
              {
                const [ch, id, pk] = self.identity.split(":");
                self.cfg.store?.upsertSandbox(ch, id, pk, sb.sandboxId, "running", self.workspaceHostPath, self.opencodeDataHostPath);
              }

              const client = createOpencodeServerClient(0, password, this.baseUrl);
              this.client = client;
              return { client, sb };
              }),
            ),
            Effect.flatMap(({ client, sb }) =>
              this.readyEffect(client).pipe(Effect.tapError(() => this.crashEffect(sb))),
            ),
          ),
        ),
      );
    });
  }

  private ensureWorkspaceFilesEffect(sb: Sandbox): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      const dirs = [
        E2B_OPENCODE_PATHS.dataDir,
        E2B_OPENCODE_PATHS.configDir,
        E2B_OPENCODE_PATHS.stateDir,
        E2B_OPENCODE_PATHS.cacheDir,
        "/workspace",
      ];

      const auth: Record<string, { type: "api"; key: string }> = {};
      for (const s of this.cfg.secrets) {
        const provider = API_KEY_PROVIDER[s.envName];
        if (provider && s.value) auth[provider] = { type: "api", key: s.value };
      }

      // Always create directories first (idempotent)
      return Effect.tryPromise(() => sb.commands.run(`mkdir -p ${dirs.join(" ")}`)).pipe(
        Effect.andThen(
          Effect.tryPromise(async () => {
            // Check if AGENTS.md exists via sb.files.read.
            // If it does, host-mount is working — skip file writes.
            try {
              await sb.files.read("/workspace/AGENTS.md");
              return; // File exists — skip writes
            } catch {
              // File doesn't exist — fall back to writing template files
            }

            if (Object.keys(auth).length > 0) {
              await sb.files.write(
                E2B_OPENCODE_PATHS.authJson,
                JSON.stringify(auth, null, 2) + "\n",
              );
            }
            await sb.files.write(
              E2B_OPENCODE_PATHS.opencodeJson,
              buildOpencodeAgentJson() + "\n",
            );
            await sb.files.write("/workspace/AGENTS.md", agentsMd);
            await sb.files.write("/workspace/TOOLS.md", toolsMd);
            await sb.files.write("/workspace/MEMORY.md", memoryMd);
          }),
        ),
      );
    });
  }

  private startOpencodeProcessEffect(sb: Sandbox): Promise<CommandHandle> {
    this.logger?.info("exec e2b opencode serve");
    return sb.commands.run(
        [
          "opencode",
          "serve",
          "--hostname",
          "0.0.0.0",
          "--port",
          String(this.guestPort),
          "--log-level",
          "ERROR",
        ].join(" "),
        {
          background: true,
          cwd: "/workspace",
          user: "user",
          timeoutMs: 0,
          requestTimeoutMs: 0,
        },
    );
  }

  private readyEffect(
    client: OpencodeClient,
  ): Effect.Effect<SandboxConnection, unknown> {
    this.logger?.info({ baseUrl: this.baseUrl }, "wait e2b opencode ready");
    return Effect.tryPromise(() => waitForOpenCodeReady(client)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          this.lastHealthCheckAt = Date.now();
          this.lastActivityAt = Date.now();
          this.status = "running";
          this.logger?.info({ baseUrl: this.baseUrl }, "e2b opencode ready");
          return this.buildConnection();
        }),
      ),
    );
  }

  private crashEffect(sb: Sandbox): Effect.Effect<void, never> {
    return Effect.ignore(Effect.tryPromise(() => sb.kill())).pipe(
      Effect.andThen(Effect.sync(() => this.logger?.error("e2b startup crashed"))),
      Effect.andThen(() => this.finalizeRuntimeEffect("crashed", true)),
    );
  }

  private async monitorOpencode(sb: Sandbox, handle: Promise<CommandHandle>): Promise<void> {
    let status: SandboxRuntime["status"] = "stopped";
    try {
      const commandHandle = await handle;
      const result = await commandHandle.wait().catch((err) => {
        if (typeof err === "object" && err !== null && "exitCode" in err) {
          return err as { exitCode: number };
        }
        throw err;
      });
      status = result.exitCode === 0 ? "stopped" : "crashed";
      this.logger?.info(
        { identity: this.identity, exitCode: result.exitCode },
        "e2b opencode exited",
      );
    } catch (err) {
      status = "crashed";
      this.logger?.warn({ err }, "e2b opencode monitor failed");
    } finally {
      await Effect.runPromise(
        Effect.sync(() => {
          const [ch, id, pk] = this.identity.split(":");
          this.cfg.store?.deleteSandbox(ch, id, pk);
        }).pipe(
          Effect.andThen(Effect.ignore(Effect.tryPromise(() => sb.pause()))),
          Effect.andThen(() => this.finalizeRuntimeEffect(status, false)),
        ),
      );
    }
  }

  private buildConnection(): SandboxConnection {
    this.lastActivityAt = Date.now();
    void this.sandbox?.setTimeout(this.cfg.timeoutMs).catch(() => {});
    return {
      sandboxName: this.sandboxName,
      sandboxId: this.sandboxId,
      baseUrl: this.baseUrl,
      hostPort: 0,
      client:
        this.client ??
        createOpencodeServerClient(0, this.serverPassword, this.baseUrl),
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

  async ensureRuntime(identity: string, sandboxId?: string | null): Promise<SandboxConnection> {
    this.prepareEnvironment();
    this.cfg.logger?.info({ identity, sandboxId: sandboxId ?? null }, "ensure e2b sandbox runtime");
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
