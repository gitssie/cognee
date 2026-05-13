import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";

export const OPENCODE_GUEST_PORT = 4096;
const HEARTBEAT_MS = 1_000;
const AGENTS_POLL_MS = 5_000;
const START_TIMEOUT_MS = 120_000;

export function createOpencodeServerClient(
  hostPort: number,
  baseUrl?: string,
  directory?: string,
): OpencodeClient {
  return createOpencodeClient({
    baseUrl: baseUrl ?? `http://127.0.0.1:${hostPort}`,
    directory,
    throwOnError: true,
  } as any);
}

export async function waitForOpenCodeReady(
  client: OpencodeClient,
  directory: string,
  logger?: Logger,
): Promise<string[]> {
  logger?.info({ directory }, "waiting for opencode health");
  await waitForHealth(client, logger);
  logger?.info({ directory }, "opencode healthy; waiting for agents");
  const agents = await waitForAgents(client, directory, logger);
  logger?.info({ directory }, "opencode ready");
  return agents;
}

export async function isOpenCodeHealthy(
  client: OpencodeClient,
  logger?: Logger,
): Promise<boolean> {
  try {
    const result = await client.global.health({
      signal: AbortSignal.timeout(5_000),
    } as any) as { data?: { healthy?: boolean }; healthy?: boolean };
    const body = result.data ?? result;
    return body.healthy !== false;
  } catch (err) {
    logger?.debug({ err }, "opencode health check failed");
    return false;
  }
}

export async function hasActiveSessions(client: OpencodeClient, directory: string): Promise<boolean> {
  try {
    const response = await client.session.status({ directory });
    const statuses = (response as { data?: Record<string, { type?: string }> }).data ?? {};
    return Object.values(statuses).some(
      (status) => status?.type === "busy" || status?.type === "retry",
    );
  } catch {
    return true;
  }
}

async function waitForHealth(client: OpencodeClient, logger?: Logger): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const result = await client.global.health({
        signal: AbortSignal.timeout(10_000),
      } as any) as { data?: { healthy?: boolean }; healthy?: boolean };
      // responseStyle="fields": body is result.data; fallback to result for compat
      const body = result.data ?? result;
      if (body.healthy !== false) return;
    } catch (err) {
      logger?.debug({ err }, "opencode health not ready, retrying");
    }
    await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS));
  }
  throw new Error(`OpenCode not alive after ${START_TIMEOUT_MS}ms`);
}

async function waitForAgents(client: OpencodeClient, directory: string, logger?: Logger): Promise<string[]> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await client.app.agents({ directory }, {
        signal: AbortSignal.timeout(5_000),
      } as any) as { data?: unknown[] } | unknown[];
      const agents = Array.isArray(result) ? result : (result as any).data ?? [];
      if (agents.length > 0) {
        return agents.map((a: any) => a.name as string).filter(Boolean);
      }
    } catch (err) {
      logger?.debug({ err }, "opencode agents not ready, retrying");
    }
    await new Promise((resolve) => setTimeout(resolve, AGENTS_POLL_MS));
  }
  return [];
}
