import "dotenv/config";

import { createOpencode, type Agent } from "@opencode-ai/sdk/v2";

import { buildOpencodeOptions, buildRouterEnv, getRouterRuntimePaths } from "./config";
import { startRouter } from "./router";

const opencode = await createOpencode(buildOpencodeOptions());
const routerPaths = getRouterRuntimePaths();
Object.assign(process.env, buildRouterEnv(opencode.server.url, routerPaths));
const router = await startRouter();

const shutdown = () => {
    void router.stop().finally(() => {
        opencode.server.close();
    });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

const agents = await opencode.client.app.agents();
const availableAgents = (agents.data ?? []).map((agent: Agent) => agent.name);

console.log(`OpenCode server running at ${opencode.server.url}`);
console.log(`Available agents: ${availableAgents.join(", ") || "none"}`);
console.log(`OpenCode router config: ${router.configPath}`);
console.log(`OpenCode router logs:   ${router.logPath}`);

await new Promise<void>(() => {
    // Keep the Bun process alive until it receives a shutdown signal.
});
