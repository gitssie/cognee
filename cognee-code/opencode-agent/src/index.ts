import "dotenv/config";

import { ServiceBuilder, type Service } from "./builder";

const SANDBOX =
    process.env.OPENCODE_SANDBOX_ENABLED === "true" ||
    process.env.OPENCODE_SANDBOX_ENABLED === "1";

const service: Service = SANDBOX
    ? await ServiceBuilder.sandbox().build()
    : await ServiceBuilder.classic().build();

const shutdown = () => {
    console.log("[opencode-agent] Shutting down...");
    void service.stop().finally(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// Keep process alive until signal
await new Promise<void>(() => {});
