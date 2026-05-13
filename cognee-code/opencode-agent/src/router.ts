import { startBridge, type BridgeDeps } from "./opencode-router/bridge.js";
import type { Config } from "./opencode-router/config.js";
import { createLogger } from "./opencode-router/logger.js";
import type { OpenCodeClientProvider } from "./opencode-router/client-provider.js";
import type { Logger } from "pino";

export type RouterHandle = {
    stop(): Promise<void>;
    configPath: string;
    logPath: string;
    logger: Logger;
};

export async function startRouter(
    provider: OpenCodeClientProvider,
    extraDeps: Partial<BridgeDeps>,
    config: Config,
    logger?: Logger,
): Promise<RouterHandle> {
    // Reuse the caller's logger if provided; otherwise create one writing to config.logFile
    const log = logger ?? createLogger(config.logLevel, { logFile: config.logFile });

    const bridge = await startBridge(
        config,
        log,
        { provider, ...extraDeps },
        undefined,
    );

    return {
        configPath: config.configPath,
        logPath: config.logFile,
        logger: log,
        async stop() {
            await bridge.stop();
        },
    };
}
