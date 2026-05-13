import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";
import type { SSEListener } from "../sse-listener.js";

export type SandboxStatus = "starting" | "running" | "paused" | "stopped" | "crashed" | "draining";

export type SandboxPresence = {
  exists: boolean;
  state?: "running" | "paused" | string;
};

export interface SandboxRuntime {
  identity: string;
  sandboxName: string;
  template: string;
  hostPort: number;
  guestPort: number;
  /** Host path mounted as /workspace inside the sandbox. */
  workspaceHostPath: string;
  status: SandboxStatus;
  lastActivityAt: number;
  lastHealthCheckAt: number;
  createdAt: number;
  /** Resolves when the opencode process exits (clean or crash). */
  done: Promise<void>;
}

export interface SandboxConnection {
  sandboxName: string;
  /** Provider-native sandbox ID (E2B UUID, microsandbox ID, etc.). */
  sandboxId: string;
  directory: string;
  baseUrl: string;
  hostPort: number;
  /** Idle TTL in milliseconds for this sandbox. */
  idleTtlMs: number;
  /** Shared SSE listener (single connection, fan-out by sessionID). */
  sseListener: SSEListener;
  /** @deprecated use sseListener */
  events(): never;
  client: OpencodeClient;
  release: () => Promise<void>;
}

export interface ProviderSecret {
  envName: string;
  value: string;
  allowHosts: string[];
}



export interface OpenCodeSandboxManager {
  setLogger?(logger: Logger | undefined): void;
  ensureRuntime(identity: string, sandboxId?: string | null): Promise<SandboxConnection>;
  inspectSandbox?(sandboxId: string): Promise<SandboxPresence>;
  getRuntime(identity: string): Promise<SandboxRuntime | null>;
  stopRuntime(identity: string, reason: "idle" | "manual"): Promise<void>;
  removeRuntime(identity: string): Promise<void>;
  listRuntimes(): Promise<SandboxRuntime[]>;
  cleanupIdleRuntimes?(): Promise<void>;
  startCleanupLoop?(): () => void;
  provisionFiles(identity: string, sourcePaths: string[]): Promise<Map<string, string>>;
  shutdown(): Promise<void>;
}
