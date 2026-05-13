/**
 * SharedServerProvider — adapts the single-OpenCode-server model to
 * the OpenCodeClientProvider interface.
 */
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpenCodeClientProvider, ClientHandle, ProviderHealth } from "../opencode-router/client-provider.js";
import { SSEListener } from "../sse-listener.js";
import { mkdir, rename } from "node:fs/promises";
import { join, basename } from "node:path";

export interface SharedProviderBridge {
  getClient(directory: string): OpencodeClient;
  checkHealth(): Promise<ProviderHealth>;
}

export function createSharedServerProvider(bridge: SharedProviderBridge): OpenCodeClientProvider {
  // One SSEListener per distinct client (keyed by directory / server URL).
  // For a shared server all clients hit the same endpoint, so we use a single listener.
  const listeners = new Map<string, SSEListener>();

  function getListener(client: OpencodeClient, key: string): SSEListener {
    let l = listeners.get(key);
    if (!l) {
      l = new SSEListener({ client });
      listeners.set(key, l);
    }
    return l;
  }

  function makeHandle(directory: string): ClientHandle {
    const client = bridge.getClient(directory);
    return {
      client,
      directory,
      sseListener: getListener(client, directory),
      release: async () => {},
    };
  }

  return {
    kind: "local",

    async getClientForDirectory(directory: string): Promise<ClientHandle> {
      return makeHandle(directory);
    },

    async getClientForSession({ directory }): Promise<ClientHandle> {
      return makeHandle(directory);
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

    async shutdown(): Promise<void> {
      for (const l of listeners.values()) l.stop();
      listeners.clear();
    },
  };
}
