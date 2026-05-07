import { Effect, Semaphore } from "effect";
import { NetworkPolicy, Sandbox } from "microsandbox";
import type { ExecHandle } from "microsandbox";
import { randomUUID } from "node:crypto";
import type {
    OpenCodeSandboxManager,
    SandboxConnection,
    SandboxManagerConfig,
    SandboxRuntime,
} from "./types";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { PortAllocator } from "./port-allocator";
import {
    buildSandboxName,
    initFilesystem,
} from "./workspace";
import {
    createOpencodeServerClient,
    OPENCODE_GUEST_PORT,
    hasActiveSessions,
    waitForOpenCodeReady,
} from "./opencode-client";
import { buildSandboxEnvironment } from "./env";

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Sandbox builder
// ═══════════════════════════════════════════════════════════

function newBuilder(
    name: string,
    cfg: SandboxManagerConfig,
    hostPort: number,
    password: string,
    paths: { workspaceHostPath: string; opencodeDataHostPath: string },
) {
    const b = Sandbox.builder(name)
        .replace()
        .image(cfg.opencodeImage)
        .cpus(cfg.cpus)
        .memory(cfg.memoryMb)
        .workdir("/workspace")
        .maxDuration(Math.ceil(cfg.maxRuntimeMs / 1000))
        .idleTimeout(Math.ceil(cfg.idleTtlMs / 1000))
        .volume("/workspace", (v: any) => v.bind(paths.workspaceHostPath))
        .volume("/data", (v: any) => v.bind(paths.opencodeDataHostPath))
        .init("/bin/sleep", ["infinity"])
        .network((n: any) =>
            n
                .port(hostPort, OPENCODE_GUEST_PORT)
                .policy(NetworkPolicy.allowAll())
                .dns((d: any) =>
                    d.nameservers(["114.114.114.114", "8.8.8.8", "1.1.1.1"]),
                ),
        );

    for (const s of cfg.secrets) {
        if (typeof b.secretEnv === "function") {
            b.secretEnv(s.envName, s.value, s.allowHosts[0]);
        } else {
            b.env(s.envName, s.value);
        }
    }

    for (const [key, value] of Object.entries(buildSandboxEnvironment(password, []))) {
        b.env(key, value);
    }
    b.env("OPENCODE_HOSTNAME", "0.0.0.0");
    b.env("OPENCODE_PORT", String(OPENCODE_GUEST_PORT));

    return b;
}

// ═══════════════════════════════════════════════════════════
// SandboxManager — uses microsandbox DB as source of truth
// ═══════════════════════════════════════════════════════════

class SandboxInstance implements SandboxRuntime {
    sandboxName: string;
    image: string;
    hostPort = 0;
    guestPort = OPENCODE_GUEST_PORT;
    serverPassword = "";
    workspaceHostPath = "";
    status: SandboxRuntime["status"] = "stopped";
    lastActivityAt = 0;
    lastHealthCheckAt = 0;
    createdAt = 0;
    done: Promise<void> = Promise.resolve();
    private sandbox: Sandbox | null = null;
    private client: OpencodeClient | null = null;
    private readonly mutex = Semaphore.makeUnsafe(1);

    constructor(
        public identity: string,
        private cfg: SandboxManagerConfig,
        private ports: PortAllocator,
        private onDispose: (identity: string, instance: SandboxInstance) => void,
    ) {
        this.sandboxName = buildSandboxName(identity);
        this.image = cfg.opencodeImage;
    }

    ensure(): Promise<SandboxConnection> {
        return this.runExclusive(this.ensureEffect());
    }

    async stop(): Promise<void> {
        return this.runExclusive(this.stopEffect());
    }

    async remove(): Promise<void> {
        return this.runExclusive(this.removeEffect());
    }

    private ensureEffect(): Effect.Effect<SandboxConnection, unknown> {
        return Effect.suspend(() => {
            if (this.status === "running" && this.hostPort !== 0 && this.client) {
                console.log(`[sandbox-instance:${this.identity}] reuse running port=${this.hostPort}`);
                return Effect.succeed(this.buildConnection());
            }
            console.log(`[sandbox-instance:${this.identity}] restart status=${this.status} port=${this.hostPort}`);
            return this.stopEffect(false).pipe(Effect.andThen(() => this.startEffect()));
        });
    }

    private stopEffect(dispose = true): Effect.Effect<void, unknown> {
        return Effect.suspend(() => {
            const name = buildSandboxName(this.identity);
            console.log(`[sandbox-instance:${this.identity}] stop dispose=${dispose} name=${name}`);
            const stopCurrent = this.sandbox
                ? Effect.ignore(Effect.tryPromise(() => this.sandbox!.stop()))
                : Effect.void;

            return stopCurrent.pipe(
                Effect.andThen(Effect.sync(() => {
                    this.sandbox = null;
                    this.client = null;
                    this.releasePort();
                    this.status = "stopped";
                })),
                Effect.andThen(
                    Effect.tryPromise(() => Sandbox.get(name)).pipe(
                        Effect.andThen((existing) => Effect.tryPromise(() => existing.stop())),
                        Effect.ignore,
                    ),
                ),
                Effect.andThen(Effect.sync(() => {
                    if (dispose) this.onDispose(this.identity, this);
                })),
            );
        });
    }

    private removeEffect(): Effect.Effect<void, unknown> {
        return Effect.suspend(() => {
            const name = buildSandboxName(this.identity);
            const killCurrent = this.sandbox
                ? Effect.ignore(Effect.tryPromise(() => this.sandbox!.kill?.() ?? Promise.resolve()))
                : Effect.void;

            return killCurrent.pipe(
                Effect.andThen(Effect.sync(() => {
                    this.sandbox = null;
                    this.client = null;
                    this.releasePort();
                    this.status = "stopped";
                })),
                Effect.andThen(Effect.ignore(Effect.tryPromise(() => Sandbox.remove(name)))),
                Effect.andThen(Effect.sync(() => this.onDispose(this.identity, this))),
            );
        });
    }

    private runExclusive<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
        return Effect.runPromise(
            this.mutex.withPermit(effect),
        );
    }

    private startEffect(): Effect.Effect<SandboxConnection, unknown> {
        return Effect.suspend(() => {
            const name = buildSandboxName(this.identity);
            console.log(`[sandbox-instance:${this.identity}] start name=${name}`);
            const hostPort = this.ports.allocate();
            const password = randomUUID().replace(/-/g, "").slice(0, 20);
            const paths = initFilesystem(this.identity, this.cfg);
            const builder = newBuilder(name, this.cfg, hostPort, password, paths);
            console.log(`[sandbox-instance:${this.identity}] allocated port=${hostPort} workspace=${paths.workspaceHostPath}`);

            return Effect.tryPromise({
                try: () => builder.createDetached(),
                catch: (err) => {
                    this.ports.release(hostPort);
                    console.error(`[sandbox-instance:${this.identity}] createDetached failed`, err);
                    return new Error(`Sandbox "${name}" creation failed: ${String(err)}`);
                },
            }).pipe(
                Effect.flatMap((sb) =>
                    this.startOpencodeProcessEffect(sb).pipe(
                        Effect.flatMap((handle) => {
                            console.log(`[sandbox-instance:${this.identity}] sandbox created, opencode exec started`);
                            this.sandbox = sb;
                            this.sandboxName = name;
                            this.image = this.cfg.opencodeImage;
                            this.hostPort = hostPort;
                            this.guestPort = OPENCODE_GUEST_PORT;
                            this.serverPassword = password;
                            this.workspaceHostPath = paths.workspaceHostPath;
                            this.status = "starting";
                            this.lastActivityAt = Date.now();
                            this.lastHealthCheckAt = Date.now();
                            this.createdAt = Date.now();
                            this.done = this.monitorOpencode(sb, handle);
                            const client = createOpencodeServerClient(hostPort, password);
                            this.client = client;

                            return this.readyEffect(client).pipe(
                                Effect.tapError(() => this.crashEffect(sb)),
                            );
                        }),
                    ),
                ),
            );
        });
    }

    private readyEffect(client: OpencodeClient): Effect.Effect<SandboxConnection, unknown> {
        console.log(`[sandbox-instance:${this.identity}] wait ready`);
        return Effect.tryPromise(() => waitForOpenCodeReady(client)).pipe(
            Effect.andThen(Effect.sync(() => {
                this.lastHealthCheckAt = Date.now();
                this.lastActivityAt = Date.now();
                this.status = "running";
                console.log(`[sandbox-instance:${this.identity}] ready port=${this.hostPort}`);
                return this.buildConnection();
            })),
        );
    }

    private crashEffect(sb: Sandbox): Effect.Effect<void, never> {
        return Effect.ignore(Effect.tryPromise(() => sb.stop())).pipe(
            Effect.andThen(Effect.sync(() => {
                console.error(`[sandbox-instance:${this.identity}] crash during startup`);
                this.sandbox = null;
                this.client = null;
                this.releasePort();
                this.status = "crashed";
                this.onDispose(this.identity, this);
            })),
        );
    }

    private startOpencodeProcessEffect(sb: Sandbox): Effect.Effect<ExecHandle, unknown> {
        console.log(`[sandbox-instance:${this.identity}] exec opencode serve`);
        return Effect.tryPromise(() => sb.execStream("opencode", [
                "serve",
                "--port",
                String(OPENCODE_GUEST_PORT),
                "--hostname",
                "0.0.0.0",
                "--log-level",
                "ERROR",
            ]));
    }

    private async monitorOpencode(sb: Sandbox, handle: ExecHandle): Promise<void> {
            let ok = false;
            try {
                for await (const e of handle) {
                    if (e.kind === "exited") {
                        ok = e.code === 0;
                        break;
                    }
                }
            } catch {
                /* stream closed */
            } finally {
                this.status = ok ? "stopped" : "crashed";
                console.log(`[sandbox-instance:${this.identity}] opencode exited ok=${ok}`);
                try {
                    await sb.stop();
                } catch {
                    /* ok */
                }
                this.releasePort();
                this.client = null;
                this.onDispose(this.identity, this);
            }
    }

    private releasePort(): void {
        if (this.hostPort === 0) return;
        this.ports.release(this.hostPort);
        this.hostPort = 0;
    }

    private buildConnection(): SandboxConnection {
        this.lastActivityAt = Date.now();
        const u = `http://127.0.0.1:${this.hostPort}`;
        return {
            sandboxName: this.sandboxName,
            baseUrl: u,
            hostPort: this.hostPort,
            client: this.client ?? createOpencodeServerClient(this.hostPort, this.serverPassword),
            release: async () => {},
        };
    }
}

export class SandboxManager implements OpenCodeSandboxManager {
    private instances = new Map<string, SandboxInstance>();
    private ports: PortAllocator;

    constructor(private cfg: SandboxManagerConfig) {
        this.ports = new PortAllocator(cfg.portStart, cfg.portEnd);
    }

    // ── ensureRuntime — SandboxInstance owns lifecycle state ─

    async ensureRuntime(identity: string): Promise<SandboxConnection> {
        console.log(`[sandbox-manager] ensure ${identity}`);
        let instance = this.instances.get(identity);
        if (!instance) {
            console.log(`[sandbox-manager] create instance ${identity}`);
            instance = new SandboxInstance(
                identity,
                this.cfg,
                this.ports,
                (id, disposed) => {
                    if (this.instances.get(id) === disposed) {
                        this.instances.delete(id);
                    }
                },
            );
            this.instances.set(identity, instance);
        }
        const conn = await instance.ensure();
        console.log(`[sandbox-manager] ensure done ${identity} port=${conn.hostPort}`);
        return conn;
    }

    // ── Queries — status from microsandbox DB ───────────────

    async getRuntime(id: string): Promise<SandboxRuntime | null> {
        return this.instances.get(id) ?? null;
    }

    async listRuntimes(): Promise<SandboxRuntime[]> {
        return Array.from(this.instances.values());
    }

    // ── Stop / Remove ───────────────────────────────────────

    async stopRuntime(
        identity: string,
        _reason: "idle" | "manual",
    ): Promise<void> {
        await this.instances.get(identity)?.stop();
    }

    async removeRuntime(identity: string): Promise<void> {
        await this.instances.get(identity)?.remove();
        this.instances.delete(identity);
    }

    // ── Lifecycle (delegated to microsandbox) ───────────────

    async cleanupIdleRuntimes(): Promise<void> {
        const now = Date.now();
        for (const [identity, instance] of this.instances) {
            if (instance.hostPort === 0) continue;
            if (now - instance.lastActivityAt < this.cfg.idleTtlMs) continue;

            const status = instance.status;
            if (status !== "running" && status !== "draining") continue;

            const activeSessions = await this.hasActiveSessions(instance);
            if (!activeSessions) await this.stopRuntime(identity, "idle");
        }
    }

    startCleanupLoop(): () => void {
        const timer = setInterval(() => {
            void this.cleanupIdleRuntimes().catch((err) =>
                console.warn("[sandbox] cleanup failed", err),
            );
        }, this.cfg.cleanupIntervalMs);
        timer.unref?.();
        return () => clearInterval(timer);
    }

    async shutdown(): Promise<void> {
        for (const instance of this.instances.values()) {
            await instance.stop();
        }
    }

    // ═══════════════════════════════════════════════════════
    // Internal
    // ═══════════════════════════════════════════════════════

    private async hasActiveSessions(r: SandboxRuntime): Promise<boolean> {
        try {
            return await hasActiveSessions(createOpencodeServerClient(r.hostPort, r.serverPassword));
        } catch {
            return true;
        }
    }

}
