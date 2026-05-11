import { createSharedServerProvider } from "../sandbox/shared-provider.js";
import { loadConfig, type Config } from "./config.js";
import { createClient } from "./opencode.js";
import type { OpenCodeClientProvider } from "./client-provider.js";

export function createLocalProvider(
  config: Config = loadConfig(process.env, { requireOpencode: false }),
): OpenCodeClientProvider {
  const defaultDirectory = process.env.OPENCODE_DIRECTORY || config.opencodeDirectory;
  const clients = new Map<string, ReturnType<typeof createClient>>();
  const getClient = (directory?: string | null) => {
    const resolved = (directory ?? "").trim() || defaultDirectory;
    const existing = clients.get(resolved);
    if (existing) return existing;
    const next = createClient(config, resolved);
    clients.set(resolved, next);
    return next;
  };
  const rootClient = getClient(defaultDirectory);
  return createSharedServerProvider({
    getClient,
    async checkHealth() {
      try {
        const health = await rootClient.global.health();
        return {
          healthy: Boolean((health as { healthy?: boolean }).healthy),
          version: (health as { version?: string }).version,
        };
      } catch {
        return { healthy: false };
      }
    },
  });
}
