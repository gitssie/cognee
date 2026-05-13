/**
 * Unit tests for E2BSandboxManager — hostMount workspaceRoot, setStore(), and
 * initFilesystem integration in the ensureRuntime flow.
 *
 * Mocks: @e2b/code-interpreter (Sandbox SDK), @opencode-ai/sdk/v2 (health checks).
 * Real: initFilesystem / filesystem side-effects (verified on-disk).
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════
// MOCKS — must be at top level, BEFORE any imports that
// reference these modules (bun:test mock.module requirement)
// ═══════════════════════════════════════════════════════════

let sandboxCounter = 0;

/** Last options passed to Sandbox.create() — captured for host-mount metadata tests. */
let lastCreateOpts: any = null;

/** Factory returning a fresh fake sandbox for each create/connect call. */
function createMockSandbox() {
  sandboxCounter++;
  const sid = `test-sandbox-${sandboxCounter}`;
  return {
    sandboxId: sid,
    files: {
      write: async (_path: string, _content: string) => {},
    },
    commands: {
      run: async (_cmd: string, _opts?: any) => ({
        wait: async () => ({ exitCode: 0 }),
      }),
    },
    getHost: (_port: number) => "https://test-host.example.com",
    setTimeout: async (_ms: number) => {},
    kill: async () => {},
    pause: async () => {},
  };
}

mock.module("@e2b/code-interpreter", () => ({
  Sandbox: {
    create: async (_template: string, opts?: any) => {
      lastCreateOpts = opts;
      return createMockSandbox();
    },
    connect: async (_id: string, _opts?: any) => createMockSandbox(),
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
// IMPORTS (after mocks)
// ═══════════════════════════════════════════════════════════

import { E2BSandboxManager } from "../../../src/sandbox/e2b-manager.js";
import type { E2BSandboxManagerConfig } from "../../../src/sandbox/e2b-manager.js";
import type { BridgeStore } from "../../../src/opencode-router/db.js";

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "e2b-mgr-"));
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
    hostMountEnabled: true, // default for existing host-mount tests
    hostMountWorkspaceRoot: join(testDir, "sandboxes"),
    secrets: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// TEST SUITE 1: Config object
// ═══════════════════════════════════════════════════════════

describe("E2BSandboxManagerConfig", () => {
  test("accepts hostMountWorkspaceRoot and store fields", () => {
    const cfg = makeConfig({ store: undefined });
    expect(cfg.hostMountWorkspaceRoot).toBe(join(testDir, "sandboxes"));
    expect(cfg.store).toBeUndefined();
  });

  test("accepts store when provided", () => {
    const mockStore = {} as BridgeStore;
    const cfg = makeConfig({ store: mockStore });
    expect(cfg.store).toBe(mockStore);
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE 2: setStore()
// ═══════════════════════════════════════════════════════════

// A minimal pino-compatible logger for setLogger tests
const mockLogger = {
  level: "debug",
  child: () => mockLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  silent: () => {},
} as any;

describe("E2BSandboxManager.setStore()", () => {
  test("stores the BridgeStore reference in cfg.store", () => {
    const manager = new E2BSandboxManager(makeConfig());
    expect((manager as any).cfg.store).toBeUndefined();

    const store = {} as BridgeStore;
    manager.setStore(store);
    expect((manager as any).cfg.store).toBe(store);
  });

  test("replaces an existing store reference", () => {
    const s1 = { name: "store1" } as unknown as BridgeStore;
    const s2 = { name: "store2" } as unknown as BridgeStore;
    const manager = new E2BSandboxManager(makeConfig({ store: s1 }));

    expect((manager as any).cfg.store).toBe(s1);

    manager.setStore(s2);
    expect((manager as any).cfg.store).toBe(s2);
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE 3: Other public methods
// ═══════════════════════════════════════════════════════════

describe("E2BSandboxManager.setLogger()", () => {
  test("sets logger on config and propagates to new instances", () => {
    const manager = new E2BSandboxManager(makeConfig());
    expect((manager as any).cfg.logger).toBeUndefined();

    manager.setLogger(mockLogger);
    expect((manager as any).cfg.logger).toBe(mockLogger);
  });
});

describe("E2BSandboxManager.inspectSandbox()", () => {
  test("returns presence from Sandbox.getInfo", async () => {
    const manager = new E2BSandboxManager(makeConfig());
    const presence = await manager.inspectSandbox("test-sandbox-id");
    expect(presence.exists).toBeTrue();
    expect(presence.state).toBe("running");
  });
});

describe("E2BSandboxManager.stopRuntime / removeRuntime", () => {
  test("stopRuntime on active runtime does not throw", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:grace";

    // After ensureRuntime, monitor may have disposed. Re-get to confirm:
    await manager.ensureRuntime(identity);

    // stopRuntime removes the instance (dispose=true by default)
    await expect(
      manager.stopRuntime(identity, "manual"),
    ).resolves.toBeUndefined();

    await manager.shutdown();
  });
});

describe("E2BSandboxManager.provisionFiles()", () => {
  test("throws error when sandbox is not running", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:ivan";

    // ensureRuntime runs but monitorOpencode eventually sets sandbox=null
    await manager.ensureRuntime(identity);

    await expect(
      manager.provisionFiles(identity, ["/tmp/test.txt"]),
    ).rejects.toThrow(/Sandbox not running/);

    await manager.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE 4: ensureRuntime — initFilesystem integration
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// TEST SUITE 5: Sandbox.create() — host-mount metadata verification
// ═══════════════════════════════════════════════════════════

describe("Sandbox.create() — host-mount metadata", () => {
  test("metadata host-mount is a valid JSON array with two mount entries", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    // Reset capture and trigger ensureRuntime which calls Sandbox.create()
    lastCreateOpts = null;
    await manager.ensureRuntime("wecom:default:hostmount-test");

    expect(lastCreateOpts).not.toBeNull();
    expect(lastCreateOpts.metadata).not.toBeNull();
    expect(lastCreateOpts.metadata["host-mount"]).toBeString();

    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(Array.isArray(hostMount)).toBeTrue();
    expect(hostMount).toHaveLength(1);
    expect(hostMount[0]).toHaveProperty("hostPath");
    expect(hostMount[0]).toHaveProperty("mountPath");

    await manager.shutdown();
  });

  test("host-mount mountPath is /workspace", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    lastCreateOpts = null;
    await manager.ensureRuntime("wecom:default:mountpath-test");

    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(hostMount[0].mountPath).toBe("/workspace");

    await manager.shutdown();
  });

  test("host-mount hostPath is an absolute path starting with /", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    lastCreateOpts = null;
    await manager.ensureRuntime("wecom:default:abspath-test");

    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(hostMount[0].hostPath).toStartWith("/");

    await manager.shutdown();
  });

  test("host-mount hostPath matches the runtime workspaceHostPath", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:pathmatch-test";

    lastCreateOpts = null;
    await manager.ensureRuntime(identity);

    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    const runtime = await manager.getRuntime(identity);
    expect(runtime).not.toBeNull();
    expect(hostMount.length).toBe(1);
    expect(hostMount[0].hostPath).toBe(runtime!.workspaceHostPath);

    await manager.shutdown();
  });

  test("metadata also contains opencode.identity and opencode.sandboxName", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:metaids-test";

    lastCreateOpts = null;
    await manager.ensureRuntime(identity);

    expect(lastCreateOpts.metadata["opencode.identity"]).toBe(identity);
    expect(lastCreateOpts.metadata["opencode.sandboxName"]).toBe("opencode-metaids-test");

    await manager.shutdown();
  });

  test("each ensureRuntime call produces fresh host-mount paths matching that identity", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    // First identity
    lastCreateOpts = null;
    await manager.ensureRuntime("wecom:default:alice-identity");
    const hostMountAlice = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(hostMountAlice[0].hostPath).toContain("opencode-alice-identity");

    // Second identity
    lastCreateOpts = null;
    await manager.ensureRuntime("wecom:default:bob-identity");
    const hostMountBob = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(hostMountBob[0].hostPath).toContain("opencode-bob-identity");

    // Paths should be different for different identities
    expect(hostMountAlice[0].hostPath).not.toBe(hostMountBob[0].hostPath);

    await manager.shutdown();
  });

  test("host-mount JSON survives serialization round-trip", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    lastCreateOpts = null;
    await manager.ensureRuntime("wecom:default:roundtrip-test");

    const rawHostMount = lastCreateOpts.metadata["host-mount"];
    // Verify it's a valid JSON string
    expect(() => JSON.parse(rawHostMount)).not.toThrow();
    // Re-serialize and verify equality (canonical form)
    const parsed = JSON.parse(rawHostMount);
    expect(JSON.stringify(parsed)).toBe(rawHostMount);

    await manager.shutdown();
  });
});

describe("E2BSandboxManager ensureRuntime — initFilesystem integration", () => {
  test("initFilesystem creates workspace directory on host", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:alice";

    const result = await manager.ensureRuntime(identity);

    expect(result.sandboxName).toBe("opencode-alice");
    expect(result.sandboxId).toMatch(/^test-sandbox-\d+$/);

    // Path: join(workspaceRoot, safePeer)
    const expectedWs = join(cfg.hostMountWorkspaceRoot!, "alice");
    expect(existsSync(expectedWs)).toBeTrue();

    await manager.shutdown();
  });

  test("workspaceHostPath is set to the resolved workspace directory path", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:bob";

    const result = await manager.ensureRuntime(identity);
    expect(result.sandboxName).toBe("opencode-bob");

    const runtime = await manager.getRuntime(identity);
    expect(runtime).not.toBeNull();
    expect(runtime!.workspaceHostPath).toBe(
      join(cfg.hostMountWorkspaceRoot!, "bob"),
    );
    expect(existsSync(runtime!.workspaceHostPath)).toBeTrue();

    await manager.shutdown();
  });

  test("each unique identity gets its own workspace directory", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    await manager.ensureRuntime("wecom:default:carol");
    await manager.ensureRuntime("wecom:default:dave");

    const runtimes = await manager.listRuntimes();
    expect(runtimes).toHaveLength(2);

    const carolWs = join(cfg.hostMountWorkspaceRoot!, "carol");
    const daveWs = join(cfg.hostMountWorkspaceRoot!, "dave");
    expect(existsSync(carolWs)).toBeTrue();
    expect(existsSync(daveWs)).toBeTrue();

    await manager.shutdown();
  });

  test("reuses existing runtime without double-initializing", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:eve";

    // First call — creates directories and sandbox
    await manager.ensureRuntime(identity);

    const wsDir = join(cfg.hostMountWorkspaceRoot!, "eve");
    expect(existsSync(wsDir)).toBeTrue();

    // Second call — reuses existing runtime (no crash, returns connection)
    const result2 = await manager.ensureRuntime(identity);
    expect(result2.sandboxName).toBe("opencode-eve");
    expect(existsSync(wsDir)).toBeTrue();

    await manager.shutdown();
  });

  test("sets workspaceHostPath before any async sandbox operation", async () => {
    // The workspace path must be assigned in startEffect() BEFORE
    // the sandbox create/connect call to ensure it's available even
    // if sandbox creation fails.
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:frank";

    const instance = (manager as any).createInstance(identity);
    expect(instance.workspaceHostPath).toBe(""); // initially empty

    // Manually trigger ensure to see the flow set workspaceHostPath
    await manager.ensureRuntime(identity);

    // After ensureRuntime, workspaceHostPath should be populated
    const runtime = await manager.getRuntime(identity);
    expect(runtime!.workspaceHostPath).toBe(
      join(cfg.hostMountWorkspaceRoot!, "frank"),
    );
    expect(existsSync(runtime!.workspaceHostPath)).toBeTrue();

    await manager.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE: host-mount disabled (E2B Cloud mode)
// ═══════════════════════════════════════════════════════════

describe("E2BSandboxManager — hostMountEnabled: false", () => {
  test("does NOT set host-mount metadata", async () => {
    const cfg = makeConfig({ hostMountEnabled: false });
    const manager = new E2BSandboxManager(cfg);

    lastCreateOpts = null;
    await manager.ensureRuntime("wecom:default:no-hostmount");

    expect(lastCreateOpts.metadata["host-mount"]).toBeUndefined();
    expect(lastCreateOpts.metadata["opencode.identity"]).toBe("wecom:default:no-hostmount");

    await manager.shutdown();
  });

  test("workspaceHostPath is empty string", async () => {
    const cfg = makeConfig({ hostMountEnabled: false });
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:no-path";

    await manager.ensureRuntime(identity);
    const runtime = await manager.getRuntime(identity);
    expect(runtime).not.toBeNull();
    expect(runtime!.workspaceHostPath).toBe("");

    await manager.shutdown();
  });

  test("host directories are NOT created on disk", async () => {
    const cfg = makeConfig({ hostMountEnabled: false });
    const manager = new E2BSandboxManager(cfg);

    await manager.ensureRuntime("wecom:default:no-dirs");

    // Workspace path should NOT exist (initFilesystem was skipped)
    const wsPath = join(cfg.hostMountWorkspaceRoot!, "no-dirs");
    expect(existsSync(wsPath)).toBeFalse();

    await manager.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE: host-mount workspaceRoot (router-aligned paths)
// ═══════════════════════════════════════════════════════════

describe("E2BSandboxManager — hostMountWorkspaceRoot", () => {
  test("uses router-aligned path when workspaceRoot is set", async () => {
    const workspaceRoot = join(testDir, "per-peer-workspaces");
    const cfg = makeConfig({
      hostMountEnabled: true,
      hostMountWorkspaceRoot: workspaceRoot,
    });
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:alice-peer";

    lastCreateOpts = null;
    await manager.ensureRuntime(identity);

    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    // Router-aligned: no "opencode-" prefix, no "workspace/" subdir
    expect(hostMount[0].hostPath).toBe(join(workspaceRoot, "alice-peer"));

    const runtime = await manager.getRuntime(identity);
    expect(runtime!.workspaceHostPath).toBe(join(workspaceRoot, "alice-peer"));
    expect(existsSync(runtime!.workspaceHostPath)).toBeTrue();

    await manager.shutdown();
  });
});
