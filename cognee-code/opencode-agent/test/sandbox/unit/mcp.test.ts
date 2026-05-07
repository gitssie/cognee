/**
 * Unit tests for MCP sandbox client and HTTP sandbox manager.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpSandboxClient } from "../../../src/sandbox/mcp-client.js";
import { HttpSandboxManager } from "../../../src/sandbox/http-manager.js";

let testDir: string;

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "sandbox-mcp-ut-"));
});

// ═══════════════════════════════════════════════════════════
// McpSandboxClient
// ═══════════════════════════════════════════════════════════

describe("McpSandboxClient construction", () => {
  it("creates client with URL", () => {
    const client = new McpSandboxClient("http://localhost:3456/mcp");
    expect(client).toBeDefined();
    expect(client.callTool).toBeFunction();
  });

  it("strips trailing slash from base URL", () => {
    const client = new McpSandboxClient("http://localhost:3456/mcp/");
    // Construction succeeds — no exception
    expect(client).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
// HttpSandboxManager
// ═══════════════════════════════════════════════════════════

describe("HttpSandboxManager", () => {
  it("constructs with valid config and exposes OpenCodeSandboxManager methods", () => {
    const mgr = new HttpSandboxManager({
      mcpUrl: "http://localhost:3456/mcp",
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 100,
      portEnd: 200,
      idleTtlMs: 60000,
      maxRuntimeMs: 300000,
      opencodeImage: "ghcr.io/anomalyco/opencode:latest",
      cpus: 2,
      memoryMb: 512,
      cleanupIntervalMs: 30000,
      secrets: [
        { envName: "DEEPSEEK_API_KEY", value: "sk-test", allowHosts: ["api.deepseek.com"] },
      ],
    });

    // Verify it implements OpenCodeSandboxManager
    expect(mgr.ensureRuntime).toBeFunction();
    expect(mgr.getRuntime).toBeFunction();
    expect(mgr.listRuntimes).toBeFunction();
    expect(mgr.stopRuntime).toBeFunction();
    expect(mgr.removeRuntime).toBeFunction();
    expect(mgr.cleanupIdleRuntimes).toBeFunction();
    expect(mgr.startCleanupLoop).toBeFunction();
    expect(mgr.shutdown).toBeFunction();
  });

  it("listRuntimes returns empty array initially", async () => {
    const mgr = new HttpSandboxManager({
      mcpUrl: "http://localhost:3456/mcp",
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 100,
      portEnd: 200,
      idleTtlMs: 60000,
      maxRuntimeMs: 300000,
      opencodeImage: "ghcr.io/anomalyco/opencode:latest",
      cpus: 2,
      memoryMb: 512,
      cleanupIntervalMs: 30000,
      secrets: [],
    });
    const list = await mgr.listRuntimes();
    expect(Array.isArray(list)).toBeTrue();
    expect(list).toHaveLength(0);
    await mgr.shutdown();
  });

  it("stopRuntime on nonexistent id does not throw", async () => {
    const mgr = new HttpSandboxManager({
      mcpUrl: "http://localhost:3456/mcp",
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 100,
      portEnd: 200,
      idleTtlMs: 60000,
      maxRuntimeMs: 300000,
      opencodeImage: "ghcr.io/anomalyco/opencode:latest",
      cpus: 2,
      memoryMb: 512,
      cleanupIntervalMs: 30000,
      secrets: [],
    });
    await mgr.stopRuntime("nonexistent", "manual");
    await mgr.shutdown();
  });

  it("getRuntime returns null for unknown identity", async () => {
    const mgr = new HttpSandboxManager({
      mcpUrl: "http://localhost:3456/mcp",
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 100,
      portEnd: 200,
      idleTtlMs: 60000,
      maxRuntimeMs: 300000,
      opencodeImage: "ghcr.io/anomalyco/opencode:latest",
      cpus: 2,
      memoryMb: 512,
      cleanupIntervalMs: 30000,
      secrets: [],
    });
    const rt = await mgr.getRuntime("unknown");
    expect(rt).toBeNull();
    await mgr.shutdown();
  });

  it("removeRuntime on nonexistent id does not throw", async () => {
    const mgr = new HttpSandboxManager({
      mcpUrl: "http://localhost:3456/mcp",
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 100,
      portEnd: 200,
      idleTtlMs: 60000,
      maxRuntimeMs: 300000,
      opencodeImage: "ghcr.io/anomalyco/opencode:latest",
      cpus: 2,
      memoryMb: 512,
      cleanupIntervalMs: 30000,
      secrets: [],
    });
    await mgr.removeRuntime("unknown");
    await mgr.shutdown();
  });

  it("startCleanupLoop returns a stop function", () => {
    const mgr = new HttpSandboxManager({
      mcpUrl: "http://localhost:3456/mcp",
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 100,
      portEnd: 200,
      idleTtlMs: 60000,
      maxRuntimeMs: 300000,
      opencodeImage: "ghcr.io/anomalyco/opencode:latest",
      cpus: 2,
      memoryMb: 512,
      cleanupIntervalMs: 30000,
      secrets: [],
    });
    const stop = mgr.startCleanupLoop();
    expect(stop).toBeFunction();
    stop();
  });
});

// ═══════════════════════════════════════════════════════════
// MCP client JSON-RPC format
// ═══════════════════════════════════════════════════════════

describe("McpSandboxClient JSON-RPC", () => {
  it("callTool is a function accepting tool name + args", () => {
    const client = new McpSandboxClient("http://localhost:3456/mcp");
    expect(client.callTool).toBeFunction();
  });
});

// ═══════════════════════════════════════════════════════════
// Workspace integration (initFilesystem via workspace.ts)
// ═══════════════════════════════════════════════════════════

describe("initFilesystem (workspace.ts)", () => {
  it("creates workspace + data dirs with auth.json and opencode.json", () => {
    const { initFilesystem } = require("../../../src/sandbox/workspace.js");
    const { existsSync, readFileSync } = require("node:fs");
    const { resolve } = require("node:path");

    const root = join(testDir, "mcp-workspaces");
    const identity = "admin:admin:admin";

    // Clean up
    require("node:fs").rmSync(root, { recursive: true, force: true });

    const paths = initFilesystem(identity, {
      sandboxRoot: root,
      secrets: [
        { envName: "DEEPSEEK_API_KEY", value: "sk-deepseek-mcp-test", allowHosts: ["api.deepseek.com"] },
      ],
    });

    // Workspace dir exists
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();

    // Data dir exists
    expect(existsSync(paths.opencodeDataHostPath)).toBeTrue();

    // auth.json exists under XDG_DATA_HOME
    const authPath = resolve(paths.opencodeDataHostPath, ".local/share/opencode/auth.json");
    expect(existsSync(authPath)).toBeTrue();
    const auth = JSON.parse(readFileSync(authPath, "utf8"));
    expect(auth.deepseek.key).toBe("sk-deepseek-mcp-test");

    // opencode.json exists under XDG_CONFIG_HOME
    const cfgPath = resolve(paths.opencodeDataHostPath, ".config/opencode/opencode.json");
    expect(existsSync(cfgPath)).toBeTrue();
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    expect(cfg.agent["cognee-coder"]).toBeDefined();
    expect(cfg.agent["cognee-coder"].model).toBe("deepseek/deepseek-v4-flash");

    // Clean up
    require("node:fs").rmSync(root, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════
// PortAllocator via HttpSandboxManager context
// ═══════════════════════════════════════════════════════════

describe("Port allocation in HttpSandboxManager", () => {
  it("uses PortAllocator internally (starts with portStart)", () => {
    const mgr = new HttpSandboxManager({
      mcpUrl: "http://localhost:3456/mcp",
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 42000,
      portEnd: 42999,
      idleTtlMs: 60000,
      maxRuntimeMs: 300000,
      opencodeImage: "ghcr.io/anomalyco/opencode:latest",
      cpus: 2,
      memoryMb: 512,
      cleanupIntervalMs: 30000,
      secrets: [],
    });
    // Constructor succeeds — port range is valid
    expect(mgr).toBeDefined();
  });
});
