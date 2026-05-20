/**
 * SharedServerProvider — adapts the single-OpenCode-server model to
 * the OpenCodeClientProvider interface.
 *
 * Directory mode uses a single ReactiveSSEListener for the entire provider:
 * client.global.event() pushes events for ALL directories, and we fan out
 * by sessionID. This avoids one SSE connection per directory and supports
 * client hot-swap if the server restarts.
 */
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";
import type { OpenCodeClientProvider, ClientHandle, ProviderHealth } from "../opencode-router/client-provider.js";
import { ReactiveSSEListener } from "../sse-listener.js";
import { mkdir, rename } from "node:fs/promises";
import { join, basename } from "node:path";

export interface SharedProviderOptions {
  checkHealth(): Promise<ProviderHealth>;
}

/** Creates per-directory OpenCode clients. */
export type ClientFactory = (directory: string) => OpencodeClient;

export function createSharedServerProvider(
  clientFactory: ClientFactory,
  rootClient: OpencodeClient,
  logger: Logger | undefined,
  opts: SharedProviderOptions,
): OpenCodeClientProvider {
  const log = (typeof logger?.child === "function"
    ? logger.child({ component: "shared-provider" })
    : undefined) as Logger | undefined;

  // Single ReactiveSSEListener — one global SSE connection for all directories.
  // Uses rootClient (no directory baked in) for global.event() monitoring.
  const sseHub = new ReactiveSSEListener({ logger: log });
  sseHub.setClient(rootClient);
  log?.info("shared-provider: SSE hub started with root client");

  function makeHandle(directory: string): ClientHandle {
    const client = clientFactory(directory);
    log?.debug({ directory }, "shared-provider: creating per-directory client");
    return {
      client,
      directory,
      sseListener: sseHub,
      release: async () => {},
    };
  }

  return {
    kind: "local",

    async getClientForDirectory(directory: string): Promise<ClientHandle> {
      return makeHandle(directory);
    },

    async getClientForSession(context: { directory: string }): Promise<ClientHandle> {
      return makeHandle(context.directory);
    },

    async getHealth(): Promise<ProviderHealth> {
      return opts.checkHealth();
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
      log?.info("shared-provider: shutting down SSE hub");
      sseHub.stop();
    },
  };
}
