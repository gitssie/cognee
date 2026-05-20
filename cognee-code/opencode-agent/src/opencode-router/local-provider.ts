import { createSharedServerProvider } from "../sandbox/shared-provider.js";
import type { Config } from "./config.js";
import { createClient } from "./opencode.js";
import type { OpenCodeClientProvider } from "./client-provider.js";
import type { Logger } from "pino";

export function createLocalProvider(config: Config, logger?: Logger): OpenCodeClientProvider {
  const log = (typeof logger?.child === "function"
    ? logger.child({ component: "local-provider" })
    : undefined) as Logger | undefined;
  const rootClient = createClient(config);
  log?.info({ opencodeUrl: config.opencodeUrl }, "local-provider: root client created");
  return createSharedServerProvider(
    (directory: string) => createClient(config, directory),
    rootClient,
    log,
    {
      checkHealth: async () => {
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
    },
  );
}
