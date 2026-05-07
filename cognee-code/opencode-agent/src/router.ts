import { startBridge } from "./opencode-router/bridge.js";
import { loadConfig } from "./opencode-router/config.js";
import { createLogger } from "./opencode-router/logger.js";
import type { OpenCodeClientProvider } from "./opencode-router/client-provider.js";

export type RouterHandle = {
    stop(): Promise<void>;
    configPath: string;
    logPath: string;
};

export async function startRouter(
    provider?: OpenCodeClientProvider,
): Promise<RouterHandle> {
    const config = loadConfig(process.env, { requireOpencode: false });
    const logger = createLogger(config.logLevel, { logFile: config.logFile });
    const bridge = await startBridge(config, logger, undefined, provider ? {
        provider,
    } : undefined);

    return {
        configPath: config.configPath,
        logPath: config.logFile,
        async stop() {
            await bridge.stop();
        },
    };
}
