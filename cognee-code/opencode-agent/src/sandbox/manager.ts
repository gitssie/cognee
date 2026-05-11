import { Effect, Semaphore } from "effect";
import { NetworkPolicy, Sandbox } from "microsandbox";
import type { ExecEvent, ExecHandle } from "microsandbox";
import { randomUUID } from "node:crypto";
import type {
    OpenCodeSandboxManager,
    SandboxConnection,
    SandboxManagerConfig,
    SandboxRuntime,
} from "./types";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { PortAllocator } from "./port-allocator";
import { buildSandboxName, initFilesystem } from "./workspace";
import { basename } from "node:path";
import {
    createOpencodeServerClient,
    OPENCODE_GUEST_PORT,
    waitForOpenCodeReady,
} from "./opencode-client";
import { buildSandboxEnvironment } from "./env";
import type { Logger } from "pino";

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
                .policy(NetworkPolicy.allowAll()),
        );

    for (const s of cfg.secrets) {
        b.env(s.envName, s.value);
    }

    for (const [key, value] of Object.entries(
        buildSandboxEnvironment(password, []),
    )) {
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
        private logger: Logger | undefined,
        private onDispose: (
            identity: string,
            instance: SandboxInstance,
        ) => void,
    ) {
        this.sandboxName = buildSandboxName(identity);
        this.image = cfg.opencodeImage;
    }

    setLogger(logger: Logger | undefined): void {
        this.logger = logger;
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

    async provisionFiles(sourcePaths: string[]): Promise<Map<string, string>> {
        return this.runExclusive(this.provisionFilesEffect(sourcePaths));
    }

    private ensureEffect(): Effect.Effect<SandboxConnection, unknown> {
        return Effect.suspend(() => {
            if (
                this.status === "running" &&
                this.hostPort !== 0 &&
                this.client
            ) {
                this.logger?.info({ port: this.hostPort }, "reuse running sandbox");
                return Effect.succeed(this.buildConnection());
            }
            this.logger?.info(
                { status: this.status, port: this.hostPort },
                "restart sandbox",
            );
            return this.stopEffect(false).pipe(
                Effect.andThen(() => this.startEffect()),
            );
        });
    }

    private stopEffect(dispose = true): Effect.Effect<void, unknown> {
        return Effect.suspend(() => {
            const name = buildSandboxName(this.identity);
            this.logger?.info({ dispose, name }, "stop sandbox");
            const stopCurrent = this.sandbox
                ? this.stopCurrentSandboxEffect()
                : Effect.void;

            return stopCurrent.pipe(
                Effect.andThen(() => this.finalizeRuntimeEffect("stopped", dispose)),
                Effect.andThen(
                    Effect.tryPromise(() => Sandbox.get(name)).pipe(
                        Effect.andThen((existing) =>
                            Effect.tryPromise(() => existing.stop()),
                        ),
                        Effect.ignore,
                    ),
                ),
            );
        });
    }

    private removeEffect(): Effect.Effect<void, unknown> {
        return Effect.suspend(() => {
            const name = buildSandboxName(this.identity);
            const killCurrent = this.sandbox
                ? Effect.ignore(
                      Effect.tryPromise(
                          () => this.sandbox!.kill?.() ?? Promise.resolve(),
                      ),
                  )
                : Effect.void;

            return killCurrent.pipe(
                Effect.andThen(() => this.finalizeRuntimeEffect("stopped", true)),
                Effect.andThen(
                    Effect.ignore(
                        Effect.tryPromise(() => Sandbox.remove(name)),
                    ),
                ),
            );
        });
    }

    private runExclusive<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
        return Effect.runPromise(this.mutex.withPermit(effect));
    }

    private provisionFilesEffect(
        sourcePaths: string[],
    ): Effect.Effect<Map<string, string>, unknown> {
        return Effect.suspend(() => {
            if (!this.sandbox) {
                return Effect.fail(new Error(`Sandbox not running for: ${this.identity}`));
            }
            const fs = this.sandbox.fs();
            const mediaDir = "/workspace/.opencode-router/media";
            return Effect.tryPromise(() => fs.mkdir(mediaDir)).pipe(
                Effect.ignore,
                Effect.andThen(
                    Effect.forEach(sourcePaths, (src) => {
                        const dst = `${mediaDir}/${basename(src)}`;
                        return Effect.tryPromise(() => fs.copyFromHost(src, dst)).pipe(
                            Effect.as([src, dst] as const),
                        );
                    }),
                ),
                Effect.map((entries) => new Map(entries)),
            );
        });
    }

    private stopCurrentSandboxEffect(): Effect.Effect<void, never> {
        return Effect.ignore(Effect.tryPromise(() => this.sandbox!.stop()));
    }

    private finalizeRuntimeEffect(
        status: SandboxRuntime["status"],
        dispose: boolean,
    ): Effect.Effect<void> {
        return Effect.sync(() => {
            this.sandbox = null;
            this.client = null;
            this.releasePort();
            this.status = status;
            if (dispose) this.onDispose(this.identity, this);
        });
    }

    private startEffect(): Effect.Effect<SandboxConnection, unknown> {
        return Effect.suspend(() => {
            const name = buildSandboxName(this.identity);
            this.logger?.info({ name }, "start sandbox");
            const hostPort = this.ports.allocate();
            const password = randomUUID().replace(/-/g, "").slice(0, 20);
            const paths = initFilesystem(this.identity, this.cfg);
            const builder = newBuilder(
                name,
                this.cfg,
                hostPort,
                password,
                paths,
            );
            this.logger?.info(
                { port: hostPort, workspace: paths.workspaceHostPath },
                "allocated sandbox resources",
            );

            return Effect.tryPromise({
                try: () => builder.createDetached(),
                catch: (err) => {
                    this.ports.release(hostPort);
                    this.logger?.error({ err }, "createDetached failed");
                    return new Error(
                        `Sandbox "${name}" creation failed: ${String(err)}`,
                    );
                },
            }).pipe(
                Effect.flatMap((sb) =>
                    this.startOpencodeProcessEffect(sb).pipe(
                        Effect.flatMap((handle) => {
                            this.logger?.info("sandbox created, opencode exec started");
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
                            const client = createOpencodeServerClient(
                                hostPort,
                                password,
                            );
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

    private readyEffect(
        client: OpencodeClient,
    ): Effect.Effect<SandboxConnection, unknown> {
        this.logger?.info("wait opencode ready");
        return Effect.tryPromise(() => waitForOpenCodeReady(client)).pipe(
            Effect.andThen(
                Effect.sync(() => {
                    this.lastHealthCheckAt = Date.now();
                    this.lastActivityAt = Date.now();
                    this.status = "running";
                    this.logger?.info({ port: this.hostPort }, "opencode ready");
                    return this.buildConnection();
                }),
            ),
        );
    }

    private crashEffect(sb: Sandbox): Effect.Effect<void, never> {
        return Effect.ignore(Effect.tryPromise(() => sb.stop())).pipe(
            Effect.andThen(
                Effect.sync(() => {
                    this.logger?.error("crash during startup");
                }),
            ),
            Effect.andThen(() => this.finalizeRuntimeEffect("crashed", true)),
        );
    }

    private startOpencodeProcessEffect(
        sb: Sandbox,
    ): Effect.Effect<ExecHandle, unknown> {
        this.logger?.info("exec opencode serve");
        return Effect.tryPromise(() =>
            sb.execStream("opencode", [
                "serve",
                "--port",
                String(OPENCODE_GUEST_PORT),
                "--hostname",
                "0.0.0.0",
                "--log-level",
                "INFO",
                "--print-logs",
            ]),
        );
    }

    private async monitorOpencode(
        sb: Sandbox,
        handle: ExecHandle,
    ): Promise<void> {
        let ok = false;
        try {
            const events = handle[Symbol.asyncIterator]();
            while (true) {
                const result = await Promise.race([
                    events.next(),
                    new Promise<"idle">((resolve) =>
                        setTimeout(resolve, this.cfg.idleTtlMs, "idle"),
                    ),
                ]);
                if (result === "idle") {
                    ok = true;
                    this.logger?.info({ identity: this.identity }, "opencode idle timeout");
                    break;
                }
                if (result.done) {
                    ok = true;
                    break;
                }
                const e = result.value;
                this.lastActivityAt = Date.now();
                this.logOpencodeEvent(e);
                if (e.kind === "exited") {
                    ok = e.code === 0;
                    break;
                }
            }
        } catch {
            /* stream closed */
        } finally {
            this.logger?.info({ ok }, "opencode exited");
            await Effect.runPromise(
                Effect.ignore(Effect.tryPromise(() => sb.stop())).pipe(
                    Effect.andThen(() =>
                        this.finalizeRuntimeEffect(ok ? "stopped" : "crashed", true),
                    ),
                ),
            );
        }
    }

    private logOpencodeEvent(e: ExecEvent): void {
        const log = this.logger;
        if (!log?.isLevelEnabled("debug")) return;
        if (e.kind === "stdout" || e.kind === "stderr") {
            log.debug(
                {
                    identity: this.identity,
                    stream: e.kind,
                    output: this.decodeExecOutput(e),
                },
                "opencode output",
            );
            return;
        }
        log.debug({ identity: this.identity, event: e }, "opencode event");
    }

    private decodeExecOutput(e: ExecEvent): string | undefined {
        const data = "data" in e ? e.data : undefined;
        if (typeof data === "string") return data;
        if (data instanceof Uint8Array) return Buffer.from(data).toString("utf8");
        return undefined;
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
            sandboxId: this.sandboxName,
            baseUrl: u,
            hostPort: this.hostPort,
            client:
                this.client ??
                createOpencodeServerClient(this.hostPort, this.serverPassword),
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

    setLogger(logger: Logger | undefined): void {
        this.cfg.logger = logger;
        for (const instance of this.instances.values()) {
            instance.setLogger(logger?.child({ identity: instance.identity }));
        }
    }

    // ── ensureRuntime — SandboxInstance owns lifecycle state ─

    async ensureRuntime(identity: string): Promise<SandboxConnection> {
        this.cfg.logger?.info({ identity }, "ensure sandbox runtime");
        let instance = this.instances.get(identity);
        if (!instance) {
            this.cfg.logger?.info({ identity }, "create sandbox instance");
            instance = new SandboxInstance(
                identity,
                this.cfg,
                this.ports,
                this.cfg.logger?.child({ identity }),
                (id, disposed) => {
                    if (this.instances.get(id) === disposed) {
                        this.instances.delete(id);
                    }
                },
            );
            this.instances.set(identity, instance);
        }
        const conn = await instance.ensure();
        this.cfg.logger?.info(
            { identity, port: conn.hostPort },
            "ensure sandbox runtime done",
        );
        return conn;
    }

    // ── Queries — status from microsandbox DB ───────────────

    async getRuntime(id: string): Promise<SandboxRuntime | null> {
        return this.instances.get(id) ?? null;
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

    async cleanupIdleRuntimes(): Promise<void> {
        const now = Date.now();
        for (const [identity, instance] of this.instances.entries()) {
            if (now - instance.lastActivityAt < this.cfg.idleTtlMs) continue;
            await instance.stop();
            this.instances.delete(identity);
        }
    }

    startCleanupLoop(): () => void {
        const timer = setInterval(() => {
            void this.cleanupIdleRuntimes().catch((err) => {
                this.cfg.logger?.warn({ err }, "sandbox cleanup failed");
            });
        }, this.cfg.cleanupIntervalMs);
        timer.unref?.();
        return () => clearInterval(timer);
    }

    async shutdown(): Promise<void> {
        for (const instance of this.instances.values()) {
            await instance.stop();
        }
    }

}
