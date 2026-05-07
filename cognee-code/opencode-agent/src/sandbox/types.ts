import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import type { SandboxStatus as MicrosandboxStatus } from "microsandbox";

export type SandboxStatus = MicrosandboxStatus | "starting";

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
}

export interface OpenCodeSandboxManager {
  ensureRuntime(identity: string): Promise<SandboxConnection>;
  getRuntime(identity: string): Promise<SandboxRuntime | null>;
  stopRuntime(identity: string, reason: "idle" | "manual"): Promise<void>;
  removeRuntime(identity: string): Promise<void>;
  cleanupIdleRuntimes(): Promise<void>;
  startCleanupLoop(): () => void;
  listRuntimes(): Promise<SandboxRuntime[]>;
  shutdown(): Promise<void>;
}
