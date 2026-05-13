/**
 * Unit tests for ensureWorkspaceFilesEffect — host-mount detection and fallback.
 *
 * Two branches:
 * 1. Host-mount active: sb.files.read("/workspace/AGENTS.md") succeeds → skip writes
 * 2. No host-mount: sb.files.read throws → write template files
 *
 * Mocks: @e2b/code-interpreter (controllable files.read), @opencode-ai/sdk/v2 (health).
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════
// CONTROLLABLE MOCK STATE — shared between tests
// ═══════════════════════════════════════════════════════════

/** When true, sb.files.read("/workspace/AGENTS.md") resolves (simulating host-mount). */
let filesReadShouldSucceed = false;
/** How many times sb.files.write() was called. */
let filesWriteCallCount = 0;
/** Paths passed to sb.files.write(), in order. */
let filesWritePaths: string[] = [];

// ═══════════════════════════════════════════════════════════
// MOCKS — MUST be at top level, before any imports
// ═══════════════════════════════════════════════════════════

function buildMockSandbox() {
  return {
    sandboxId: "test-sid",
    files: {
      read: async (_path: string) => {
        if (filesReadShouldSucceed) return "# AGENTS.md content";
        throw new Error("File not found");
      },
      write: async (path: string, _content: string) => {
        filesWriteCallCount++;
        filesWritePaths.push(path);
      },
    },
    commands: {
      run: async (_cmd: string, _opts?: any) => ({
        wait: async () => ({ exitCode: 0 }),
      }),
    },
    getHost: (_port: number) => "https://host.example.com",
    setTimeout: async (_ms: number) => {},
    kill: async () => {},
    pause: async () => {},
  };
}

mock.module("@e2b/code-interpreter", () => ({
  Sandbox: {
    create: async () => buildMockSandbox(),
    connect: async () => buildMockSandbox(),
    list: (_opts?: any) => ({ nextItems: async () => [] }),
    getInfo: async (_id: string, _opts?: any) => ({ state: "running" }),
  },
}));

mock.module("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: (_opts: any) => ({
    session: {
      create: async () => ({ id: "ses_test" }),
      prompt: async () => ({ parts: [] }),
      status: async () => ({ data: {} }),
    },
    global: {
      health: async () => ({ data: { healthy: true } }),
    },
    app: {
      agents: async () => ({ data: [{ id: "agent-1", name: "test" }] }),
    },
  }),
}));

// ═══════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════

import { E2BSandboxManager } from "../../../src/sandbox/e2b-manager.js";
import type { E2BSandboxManagerConfig } from "../../../src/sandbox/e2b-manager.js";
import type { ProviderSecret } from "../../../src/sandbox/types.js";

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "e2b-wf-"));
  filesReadShouldSucceed = false;
  filesWriteCallCount = 0;
  filesWritePaths = [];
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeConfig(
  overrides: Partial<E2BSandboxManagerConfig> = {},
): E2BSandboxManagerConfig {
  return {
    apiKey: "test-key",
    template: "opencode-tools",
    timeoutMs: 10_000,
    idleTtlMs: 60_000,
    maxRuntimeMs: 300_000,
    cleanupIntervalMs: 30_000,
    hostMountEnabled: true,
    hostMountWorkspaceRoot: join(testDir, "sandboxes"),
    secrets: [],
    ...overrides,
  };
}

function makeSecret(envName: string, value: string): ProviderSecret {
  return { envName, value, allowHosts: [] };
}

// ═══════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════

describe("ensureWorkspaceFilesEffect — host-mount detection", () => {
  test(
    "skip writes when AGENTS.md exists via files.read (host-mount active)",
    async () => {
      filesReadShouldSucceed = true;
      const manager = new E2BSandboxManager(makeConfig());

      await manager.ensureRuntime("wecom:default:hostmount-yes");

      // Host-mount active → files.read succeeded → early return, 0 writes
      expect(filesWriteCallCount).toBe(0);

      await manager.shutdown();
    },
  );

  test(
    "write template files when AGENTS.md read throws (no host-mount)",
    async () => {
      filesReadShouldSucceed = false;
      const manager = new E2BSandboxManager(makeConfig());

      await manager.ensureRuntime("wecom:default:hostmount-no");

      // 4 files: opencode.json + AGENTS.md + TOOLS.md + MEMORY.md
      expect(filesWriteCallCount).toBe(4);
      expect(filesWritePaths).toContain("/workspace/AGENTS.md");
      expect(filesWritePaths).toContain("/workspace/TOOLS.md");
      expect(filesWritePaths).toContain("/workspace/MEMORY.md");
      expect(filesWritePaths).toContain(
        "/home/user/.config/opencode/opencode.json",
      );

      await manager.shutdown();
    },
  );

  test(
    "write auth.json + templates when secrets configured and no host-mount",
    async () => {
      filesReadShouldSucceed = false;
      const manager = new E2BSandboxManager(
        makeConfig({
          secrets: [
            makeSecret("DEEPSEEK_API_KEY", "sk-test-key"),
          ],
        }),
      );

      await manager.ensureRuntime("wecom:default:hostmount-secrets");

      // 5 files: auth.json + opencode.json + AGENTS.md + TOOLS.md + MEMORY.md
      expect(filesWriteCallCount).toBe(5);
      expect(filesWritePaths).toContain(
        "/home/user/.local/share/opencode/auth.json",
      );
      expect(filesWritePaths).toContain("/workspace/AGENTS.md");
      expect(filesWritePaths).toContain("/workspace/TOOLS.md");
      expect(filesWritePaths).toContain("/workspace/MEMORY.md");

      await manager.shutdown();
    },
  );

  test(
    "skip all writes including auth.json when host-mount active despite secrets",
    async () => {
      filesReadShouldSucceed = true;
      const manager = new E2BSandboxManager(
        makeConfig({
          secrets: [
            makeSecret("ANTHROPIC_API_KEY", "sk-ant-test"),
          ],
        }),
      );

      await manager.ensureRuntime("wecom:default:hostmount-auth-skip");

      // Host-mount active → no writes at all, auth.json skipped too
      expect(filesWriteCallCount).toBe(0);

      await manager.shutdown();
    },
  );

  test(
    "no auth.json written when secrets have no matching API_KEY_PROVIDER entry",
    async () => {
      filesReadShouldSucceed = false;
      const manager = new E2BSandboxManager(
        makeConfig({
          secrets: [
            makeSecret("UNKNOWN_API_KEY", "sk-unknown"),
          ],
        }),
      );

      await manager.ensureRuntime("wecom:default:hostmount-unknown-secret");

      // No matching provider → auth is empty → 4 writes (no auth.json)
      expect(filesWriteCallCount).toBe(4);
      expect(filesWritePaths).not.toContain(
        "/home/user/.local/share/opencode/auth.json",
      );
      expect(filesWritePaths).toContain("/workspace/AGENTS.md");

      await manager.shutdown();
    },
  );
});
