import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { Logger } from "pino";
import type { SandboxStatus as MicrosandboxStatus } from "microsandbox";

export type SandboxStatus = MicrosandboxStatus | "starting" | "paused";

export type SandboxPresence = {
  exists: boolean;
  state?: "running" | "paused" | string;
};

export interface SandboxRuntime {
  identity: string;
  sandboxName: string;
  image: string;
  hostPort: number;
  guestPort: number;
  serverPassword: string;
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
  baseUrl: string;
  hostPort: number;
  client: OpencodeClient;
  release: () => Promise<void>;
}

export interface ProviderSecret {
  envName: string;
  value: string;
  allowHosts: string[];
}

export interface SandboxManagerConfig {
  sandboxRoot: string;
  portStart: number;
  portEnd: number;
  idleTtlMs: number;
  maxRuntimeMs: number;
  opencodeImage: string;
  cpus: number;
  memoryMb: number;
  secrets: ProviderSecret[];
  cleanupIntervalMs: number;
  logger?: Logger;
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
