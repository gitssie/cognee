import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";

export const OPENCODE_GUEST_PORT = 4096;
const HEARTBEAT_MS = 1_000;
const AGENTS_POLL_MS = 5_000;
const START_TIMEOUT_MS = 120_000;

export function createOpencodeServerClient(hostPort: number, password: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl: `http://127.0.0.1:${hostPort}`,
    directory: "/workspace",
    responseStyle: "data",
    throwOnError: true,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    },
  } as any);
}

export async function waitForOpenCodeReady(client: OpencodeClient): Promise<void> {
  await waitForHealth(client);
  await waitForAgents(client);
}

export async function hasActiveSessions(client: OpencodeClient): Promise<boolean> {
  try {
    const response = await client.session.status({ directory: "/workspace" });
    const statuses = (response as { data?: Record<string, { type?: string }> }).data ?? {};
    return Object.values(statuses).some(
      (status) => status?.type === "busy" || status?.type === "retry",
    );
  } catch {
    return true;
  }
}

async function waitForHealth(client: OpencodeClient): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const result = await client.global.health({
        signal: AbortSignal.timeout(10_000),
      } as any) as { data?: { healthy?: boolean }; healthy?: boolean };
      const body = result.data ?? result;
      if (body.healthy !== false) return;
    } catch {
      /* server not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS));
  }
  throw new Error(`OpenCode not alive after ${START_TIMEOUT_MS}ms`);
}

async function waitForAgents(client: OpencodeClient): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await client.app.agents({ directory: "/workspace" }, {
        signal: AbortSignal.timeout(5_000),
      } as any) as { data?: unknown[] } | unknown[];
      const agents = Array.isArray(result) ? result : result.data ?? [];
      if (agents.length > 0) return;
    } catch {
      /* still loading agents */
    }
    await new Promise((resolve) => setTimeout(resolve, AGENTS_POLL_MS));
  }
}
