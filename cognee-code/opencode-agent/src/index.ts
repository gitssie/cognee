import "dotenv/config";

import { ServiceBuilder, type Service } from "./builder";

const service: Service = await ServiceBuilder.create().build();

const shutdown = () => {
    console.log("[opencode-agent] Shutting down...");
    void service.stop().finally(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// Keep process alive until signal
await new Promise<void>(() => {});
