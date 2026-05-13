/**
 * SharedServerProvider — adapts the single-OpenCode-server model to
 * the OpenCodeClientProvider interface.
 *
 * Delegates client creation to the bridge's existing getClient() factory and
 * health checks to the bridge's rootClient.
 */
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeClientProvider, ClientHandle, ProviderHealth } from "../opencode-router/client-provider.js";
import { mkdir, rename } from "node:fs/promises";
import { join, basename } from "node:path";

/**
 * Callbacks the bridge provides — the provider is a thin adapter, not
 * a re-implementation of the bridge's client management.
 */
export interface SharedProviderBridge {
  /** Resolve an OpenCode client for a given directory. */
  getClient(directory: string): OpencodeClient;
  /** Check the single server's health. */
  checkHealth(): Promise<ProviderHealth>;
}

export function createSharedServerProvider(bridge: SharedProviderBridge): OpenCodeClientProvider {
  return {
    kind: "local",

    async getClientForDirectory(directory: string): Promise<ClientHandle> {
      return {
        client: bridge.getClient(directory),
        directory,
        release: async () => {},
      };
    },

    async getClientForSession({ directory }): Promise<ClientHandle> {
      return {
        client: bridge.getClient(directory),
        directory,
        release: async () => {},
      };
    },

    async getHealth(): Promise<ProviderHealth> {
      return bridge.checkHealth();
    },

    async provisionFiles(sourcePaths: string[], targetDirectory: string): Promise<Map<string, string>> {
      const mediaDir = join(targetDirectory, ".opencode-router", "media");
      await mkdir(mediaDir, { recursive: true });
      const moved = new Map<string, string>();
      for (const src of sourcePaths) {
        const dst = join(mediaDir, basename(src));
        await rename(src, dst);
        moved.set(src, dst);
      }
      return moved;
    },

    async shutdown(): Promise<void> {},
  };
}
