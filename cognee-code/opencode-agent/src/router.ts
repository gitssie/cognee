import { startBridge } from "../vendor/opencode-router/src/bridge.js";
import { loadConfig } from "../vendor/opencode-router/src/config.js";
import { createLogger } from "../vendor/opencode-router/src/logger.js";

export type RouterHandle = {
    stop(): Promise<void>;
    configPath: string;
    logPath: string;
};

export async function startRouter(): Promise<RouterHandle> {
    const config = loadConfig(process.env, { requireOpencode: false });
    const logger = createLogger(config.logLevel, { logFile: config.logFile });
    const bridge = await startBridge(config, logger);

    return {
        configPath: config.configPath,
        logPath: config.logFile,
        async stop() {
            await bridge.stop();
        },
    };
}
