import { startBridge, type BridgeDeps } from "./opencode-router/bridge.js";
import { loadConfig } from "./opencode-router/config.js";
import { createLogger } from "./opencode-router/logger.js";
import type { OpenCodeClientProvider } from "./opencode-router/client-provider.js";
import { createLocalProvider } from "./opencode-router/local-provider.js";
import type { Logger } from "pino";

export type RouterHandle = {
    stop(): Promise<void>;
    configPath: string;
    logPath: string;
    logger: Logger;
};

export async function startRouter(
    provider?: OpenCodeClientProvider,
    extraDeps?: Partial<BridgeDeps>,
): Promise<RouterHandle> {
    const config = loadConfig(process.env, { requireOpencode: false });
    const logger = createLogger(config.logLevel, { logFile: config.logFile });
    const resolvedProvider = provider ?? createLocalProvider(config);

    const deps: BridgeDeps = {
        provider: resolvedProvider,
        ...(extraDeps ?? {}),
    };

    const bridge = await startBridge(
        config,
        logger,
        deps,
        undefined,
    );

    return {
        configPath: config.configPath,
        logPath: config.logFile,
        logger,
        async stop() {
            await bridge.stop();
        },
    };
}
