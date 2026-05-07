import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeClientProvider, ClientHandle, ProviderHealth } from "../opencode-router/client-provider.js";
import type { OpenCodeSandboxManager } from "./types";
import { sanitize } from "./workspace";
import { copyFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";

function buildIdentity(channel: string, identityId: string, peerKey: string): string {
  return `${sanitize(channel)}:${sanitize(identityId)}:${sanitize(peerKey)}`;
}

export function createSandboxClientProvider(manager: OpenCodeSandboxManager): OpenCodeClientProvider {
  // Cache of connections by identity. Validated on each request against live state.
  const connectionCache = new Map<string, { client: OpencodeClient; release: () => Promise<void>; sandboxName: string }>();

  return {
    async getClientForSession(channel: string, identityId: string, peerKey: string, _directory: string): Promise<ClientHandle> {
      const identity = buildIdentity(channel, identityId, peerKey);

      // Check if cached connection is still valid.
      const cached = connectionCache.get(identity);
      if (cached) {
        const rt = await manager.getRuntime(identity);
        if (rt && rt.sandboxName === cached.sandboxName && rt.status === "running") {
          return { client: cached.client, release: cached.release };
        }
        // Stale — recreate below.
        connectionCache.delete(identity);
      }

      const conn = await manager.ensureRuntime(identity);
      connectionCache.set(identity, { client: conn.client, release: conn.release, sandboxName: conn.sandboxName });
      return { client: conn.client, release: conn.release };
    },

    getClientForDirectory(_directory: string): OpencodeClient {
      throw new Error("SandboxClientProvider: use getClientForSession()");
    },

    async getHealth(): Promise<ProviderHealth> {
      try {
        const all = await manager.listRuntimes();
        const running = all.filter((r) => r.status === "running");
        return { healthy: true, version: `sandbox (${running.length}/${all.length} active)` };
      } catch {
        return { healthy: false, version: "sandbox" };
      }
    },

    ensureEventSubscription(_directory: string): void {
      // Handled by sandbox manager's cleanup loop.
    },

    async provisionFiles(sourcePaths: string[], targetDirectory: string, channel: string, identityId: string, peerKey: string): Promise<Map<string, string>> {
      const identity = buildIdentity(channel, identityId, peerKey);
      const rt = await manager.getRuntime(identity);
      if (!rt) throw new Error(`Sandbox not found for: ${identity}`);

      const workspaceRoot = rt.workspaceHostPath;
      const mediaDir = join(workspaceRoot, ".opencode-router", "media");
      await mkdir(mediaDir, { recursive: true });

      const moved = new Map<string, string>();
      for (const src of sourcePaths) {
        const dst = join(mediaDir, basename(src));
        await copyFile(src, dst);
        moved.set(src, dst);
      }
      return moved;
    },

    async shutdown(): Promise<void> {
      for (const [, c] of connectionCache) { try { await c.release(); } catch { /* ok */ } }
      connectionCache.clear();
      await manager.shutdown();
    },
  };
}
