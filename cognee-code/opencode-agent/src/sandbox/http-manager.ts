/**
 * HttpSandboxManager — MCP-backed implementation of OpenCodeSandboxManager.
 *
 * Instead of importing `microsandbox` directly (which requires /dev/kvm on the
 * local machine), this manager talks to a remote MCP sandbox server over HTTP.
 * The MCP server (e.g. microsandbox-mcp with SSE transport) runs on a host that
 * has KVM support.
 *
 * Architecture:
 *   opencode-agent (Docker)  ——HTTP JSON-RPC→  microsandbox-mcp (host, KVM)
 *      PortAllocator (local)                       Sandbox VM (opencode inside)
 *
 * The port allocator stays LOCAL to avoid distributed race conditions.
 * Workspace filesystem init (auth.json, opencode.json, template files) also
 * happens locally before bind-mounting into the sandbox VM.
 */

import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { McpSandboxClient } from "./mcp-client";
import { PortAllocator } from "./port-allocator";
import { buildSandboxName, initFilesystem } from "./workspace";
import {
  createOpencodeServerClient,
  OPENCODE_GUEST_PORT,
  hasActiveSessions,
  waitForOpenCodeReady,
} from "./opencode-client";
import { buildSandboxEnvironment } from "./env";
import type { Logger } from "pino";
import type {
  OpenCodeSandboxManager,
  SandboxConnection,
  SandboxRuntime,
  ProviderSecret,
} from "./types";

// ═══════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════

const SETTLE_MS = 3_000;

// ═══════════════════════════════════════════════════════════
// Config type
// ═══════════════════════════════════════════════════════════

export interface HttpSandboxManagerConfig {
  /** URL of the sandbox MCP server (e.g. "http://host:3456/mcp"). */
  mcpUrl: string;
  /** Host root for per-user sandbox workspace/data directories. */
  sandboxRoot: string;
  /** Start of local port allocation range. */
  portStart: number;
  /** End of local port allocation range. */
  portEnd: number;
  /** Idle TTL in ms before stopping a sandbox. */
  idleTtlMs: number;
  /** Max sandbox runtime in ms before forced drain. */
  maxRuntimeMs: number;
  /** OpenCode OCI image. */
  opencodeImage: string;
  /** Per-sandbox CPU count. */
  cpus: number;
  /** Per-sandbox memory in MB. */
  memoryMb: number;
  /** Cleanup check interval in ms. */
  cleanupIntervalMs: number;
  /** Provider API secrets forwarded into sandboxes. */
  secrets: ProviderSecret[];
  logger?: Logger;
}

// ═══════════════════════════════════════════════════════════
// Entry tracking
// ═══════════════════════════════════════════════════════════

interface Entry {
  runtime: SandboxRuntime;
}

// ═══════════════════════════════════════════════════════════
// HttpSandboxManager
// ═══════════════════════════════════════════════════════════

export class HttpSandboxManager implements OpenCodeSandboxManager {
  private entries = new Map<string, Entry>();
  private ports: PortAllocator;
  private mcp: McpSandboxClient;

  constructor(private cfg: HttpSandboxManagerConfig) {
    this.ports = new PortAllocator(cfg.portStart, cfg.portEnd);
    this.mcp = new McpSandboxClient(cfg.mcpUrl);
  }

  // ── ensureRuntime ────────────────────────────────────────

  async ensureRuntime(identity: string): Promise<SandboxConnection> {
    this.cfg.logger?.info({ identity }, "ensure http sandbox runtime");
    const existing = this.entries.get(identity);
    if (existing) {
      try {
        const status = await this._inspectStatus(identity);
        if (status === "running" || status === "draining") {
          return this._connection(existing.runtime);
        }
      } catch {
        // Sandbox gone — recreate below
      }
      // Stopped/crashed — recreate
      await this._removeVm(identity);
    }
    return this._create(identity);
  }

  // ── getRuntime ───────────────────────────────────────────

  async getRuntime(identity: string): Promise<SandboxRuntime | null> {
    const e = this.entries.get(identity);
    if (!e) return null;

    try {
      e.runtime.status = await this._inspectStatus(identity) as SandboxRuntime["status"];
    } catch {
      /* keep last known status */
    }
    return e.runtime;
  }

  // ── listRuntimes ─────────────────────────────────────────

  async listRuntimes(): Promise<SandboxRuntime[]> {
    const result: SandboxRuntime[] = [];
    for (const [identity, e] of this.entries) {
      try {
        const info = await this.mcp.callTool<{
          name: string;
          status: string;
        }>("sandbox_inspect", { name: e.runtime.sandboxName });
        e.runtime.status = (info.status as SandboxRuntime["status"]) ?? e.runtime.status;
      } catch {
        /* keep cached status */
      }
      result.push(e.runtime);
    }
    return result;
  }

  async provisionFiles(
    identity: string,
    sourcePaths: string[],
  ): Promise<Map<string, string>> {
    this.cfg.logger?.info({ identity, count: sourcePaths.length }, "provision http sandbox files");
    const e = this.entries.get(identity);
    if (!e) throw new Error(`Sandbox not found for: ${identity}`);
    const mediaDir = "/workspace/.opencode-router/media";
    await this.mcp.callTool("sandbox_exec", {
      name: e.runtime.sandboxName,
      cmd: "mkdir",
      args: ["-p", mediaDir],
    });
    const moved = new Map<string, string>();
    for (const src of sourcePaths) {
      const dst = `${mediaDir}/${basename(src)}`;
      await this.mcp.callTool("sandbox_exec", {
        name: e.runtime.sandboxName,
        cmd: "cp",
        args: [src, dst],
      });
      moved.set(src, dst);
    }
    return moved;
  }

  // ── stopRuntime ──────────────────────────────────────────

  async stopRuntime(identity: string, _reason: "idle" | "manual"): Promise<void> {
    this.cfg.logger?.info({ identity, reason: _reason }, "stop http sandbox runtime");
    const e = this.entries.get(identity);
    if (!e) return;

    try {
      await this.mcp.callTool("sandbox_stop", {
        name: e.runtime.sandboxName,
      });
    } catch {
      /* might already be stopped */
    }
    e.runtime.status = "stopped" as any;
  }

  // ── removeRuntime ────────────────────────────────────────

  async removeRuntime(identity: string): Promise<void> {
    this.cfg.logger?.info({ identity }, "remove http sandbox runtime");
    const e = this.entries.get(identity);
    if (!e) return;

    try {
      await this.mcp.callTool("sandbox_stop", {
        name: e.runtime.sandboxName,
        force: true,
      });
    } catch {
      /* ok */
    }

    try {
      await this.mcp.callTool("sandbox_remove", {
        name: e.runtime.sandboxName,
        force: true,
      });
    } catch {
      /* ok */
    }

    this.ports.release(e.runtime.hostPort);
    this.entries.delete(identity);
  }

  // ── cleanupIdleRuntimes ──────────────────────────────────

  async cleanupIdleRuntimes(): Promise<void> {
    const now = Date.now();
    for (const [identity, e] of this.entries) {
      if (now - e.runtime.lastActivityAt < this.cfg.idleTtlMs) continue;

      let status: string;
      try {
        status = await this._inspectStatus(identity);
      } catch {
        status = "crashed";
      }
      if (status !== "running" && status !== "draining") continue;

      const active = await this._hasActiveSessions(e.runtime);
      if (!active) await this.stopRuntime(identity, "idle");
    }
  }

  startCleanupLoop(): () => void {
    const timer = setInterval(() => {
      void this.cleanupIdleRuntimes().catch((err) => {
        this.cfg.logger?.warn({ err }, "http sandbox cleanup failed");
      });
    }, this.cfg.cleanupIntervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  // ── shutdown ─────────────────────────────────────────────

  async shutdown(): Promise<void> {
    this.cfg.logger?.info({ count: this.entries.size }, "shutdown http sandbox manager");
    for (const e of this.entries.values()) {
      try {
        await this.mcp.callTool("sandbox_stop", {
          name: e.runtime.sandboxName,
          force: true,
        });
      } catch {
        /* ok */
      }
    }
  }

  // ═════════════════════════════════════════════════════════
  // Internal
  // ═════════════════════════════════════════════════════════

  private async _create(identity: string): Promise<SandboxConnection> {
    this.cfg.logger?.info({ identity }, "create http sandbox");
    // Release old resources
    const old = this.entries.get(identity);
    if (old) {
      this.ports.release(old.runtime.hostPort);
      try { await this._removeVm(identity); } catch { /* ok */ }
    }

    const hostPort = this.ports.allocate();
    const password = randomUUID().replace(/-/g, "").slice(0, 20);
    const name = buildSandboxName(identity);

    // Init host filesystem (workspace, data, auth.json, opencode.json)
    const paths = initFilesystem(identity, {
      sandboxRoot: this.cfg.sandboxRoot,
      secrets: this.cfg.secrets,
    });

    const env = buildSandboxEnvironment(password, this.cfg.secrets);

    // Call MCP to create the sandbox VM.
    // Start OpenCode as the entrypoint so it runs as the main process.
    await this.mcp.callTool("sandbox_create", {
      name,
      image: this.cfg.opencodeImage,
      cpus: this.cfg.cpus,
      memoryMib: this.cfg.memoryMb,
      workdir: "/workspace",
      maxDuration: Math.ceil(this.cfg.maxRuntimeMs / 1000),
      idleTimeout: Math.ceil(this.cfg.idleTtlMs / 1000),
      replace: true,
      env,
      volumes: [
        {
          guestPath: "/workspace",
          type: "bind",
          source: paths.workspaceHostPath,
        },
        {
          guestPath: "/data",
          type: "bind",
          source: paths.opencodeDataHostPath,
        },
      ],
      network: {
        hostPort,
          guestPort: OPENCODE_GUEST_PORT,
        policy: "allowAll",
      },
      entrypoint: [
        "sh",
        "-c",
        `opencode serve --hostname 0.0.0.0 --port ${OPENCODE_GUEST_PORT} --log-level ERROR`,
      ],
    });

    // Wait for OpenCode to be ready
    const client = createOpencodeServerClient(hostPort, password);
    await waitForOpenCodeReady(client);
    await new Promise((r) => setTimeout(r, SETTLE_MS));

    const rt: SandboxRuntime = {
      identity,
      sandboxName: name,
      image: this.cfg.opencodeImage,
      hostPort,
      guestPort: OPENCODE_GUEST_PORT,
      serverPassword: password,
      workspaceHostPath: paths.workspaceHostPath,
      status: "running",
      lastActivityAt: Date.now(),
      lastHealthCheckAt: Date.now(),
      createdAt: Date.now(),
      done: Promise.resolve(),
    };

    this.entries.set(identity, { runtime: rt });
    return this._connection(rt);
  }

  private async _inspectStatus(identity: string): Promise<string> {
    const name = buildSandboxName(identity);
    const info = await this.mcp.callTool<{ status: string }>(
      "sandbox_inspect",
      { name },
    );
    return info.status;
  }

  private async _removeVm(identity: string): Promise<void> {
    const name = buildSandboxName(identity);
    try {
      await this.mcp.callTool("sandbox_stop", { name, force: true });
    } catch { /* ok */ }
    try {
      await this.mcp.callTool("sandbox_remove", { name, force: true });
    } catch { /* ok */ }
  }

  private async _hasActiveSessions(r: SandboxRuntime): Promise<boolean> {
    try {
      return await hasActiveSessions(createOpencodeServerClient(r.hostPort, r.serverPassword));
    } catch {
      return true; // assume active on error
    }
  }

  private _connection(r: SandboxRuntime): SandboxConnection {
    r.lastActivityAt = Date.now();
    return {
      sandboxName: r.sandboxName,
      sandboxId: r.sandboxName,
      baseUrl: `http://127.0.0.1:${r.hostPort}`,
      hostPort: r.hostPort,
      client: createOpencodeServerClient(r.hostPort, r.serverPassword),
      release: async () => {},
    };
  }
}
