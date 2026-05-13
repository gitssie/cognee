import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeClientProvider, ClientHandle, ProviderHealth } from "../opencode-router/client-provider.js";
import type { OpenCodeSandboxManager } from "./types";
import { sanitize } from "./workspace";

function buildIdentity(channel: string, identityId: string, peerKey: string): string {
  return `${sanitize(channel)}:${sanitize(identityId)}:${sanitize(peerKey)}`;
}

export function createSandboxClientProvider(manager: OpenCodeSandboxManager): OpenCodeClientProvider {
  return {
    kind: "sandbox",

    getClientForDirectory(): never {
      throw new Error("Sandbox provider requires getClientForSession context");
    },

    async getClientForSession({ channel, identityId, peerKey, sandboxId }): Promise<ClientHandle> {
      const identity = buildIdentity(channel, identityId, peerKey);
      const conn = await manager.ensureRuntime(identity, sandboxId);
      return conn;
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

    async provisionFiles(sourcePaths: string[], targetDirectory: string, channel: string, identityId: string, peerKey: string): Promise<Map<string, string>> {
      const identity = buildIdentity(channel, identityId, peerKey);
      return manager.provisionFiles(identity, sourcePaths);
    },

    async shutdown(): Promise<void> {
      await manager.shutdown();
    },
  };
}
