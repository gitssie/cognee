/**
 * Unit tests for config mode detection and directory config resolution.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "../../src/opencode-router/config.js";

let testDir: string;

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "config-ut-"));
  // Create a minimal directory structure that loadConfig expects
  mkdirSync(join(testDir, "workspaces"), { recursive: true });
  mkdirSync(join(testDir, "data", "logs"), { recursive: true });
});

function writeConfigFile(content: Record<string, unknown>): string {
  const configPath = join(testDir, "opencode-router.json");
  writeFileSync(configPath, JSON.stringify(content, null, 2));
  return configPath;
}

function makeEnv(configPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENCODE_ROUTER_CONFIG_PATH: configPath,
    OPENCODE_ROUTER_ROOT_DIR: testDir,
  };
}

describe("Mode detection", () => {
  it("detects sandbox mode when sandbox.apiUrl is configured", () => {
    const configPath = writeConfigFile({
      version: 1,
      sandbox: {
        apiUrl: "http://e2b.local:3000",
        apiKey: "dummy",
        template: "opencode-tools",
      },
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("sandbox");
  });

  it("detects directory mode when no sandbox section exists", () => {
    const configPath = writeConfigFile({
      version: 1,
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("directory");
  });

  it("detects directory mode when sandbox section exists but apiUrl is empty", () => {
    const configPath = writeConfigFile({
      version: 1,
      sandbox: {
        template: "opencode-tools",
      },
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("directory");
  });

  it("explicit mode field overrides auto-detection", () => {
    // Even with sandbox config, explicit mode="directory" wins
    const configPath = writeConfigFile({
      version: 1,
      mode: "directory",
      sandbox: {
        apiUrl: "http://e2b.local:3000",
        apiKey: "dummy",
      },
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("directory");
  });
});

describe("Directory config resolution", () => {
  it("defaults workspaceRoot to /work when no directory config provided", () => {
    const configPath = writeConfigFile({
      version: 1,
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("directory");
    expect(config.directory.workspaceRoot).toBe("/work");
  });

  it("uses configured directory.workspaceRoot", () => {
    const configPath = writeConfigFile({
      version: 1,
      directory: {
        workspaceRoot: "/data/workspaces",
      },
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("directory");
    expect(config.directory.workspaceRoot).toBe("/data/workspaces");
  });

  it("resolves relative directory.workspaceRoot against rootDir", () => {
    const configPath = writeConfigFile({
      version: 1,
      router: {
        rootDir: testDir,
      },
      directory: {
        workspaceRoot: "user-workspaces",
      },
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("directory");
    expect(config.directory.workspaceRoot).toBe(resolve(testDir, "user-workspaces"));
  });
});

describe("Sandbox config still works", () => {
  it("resolves sandbox config correctly in sandbox mode", () => {
    const configPath = writeConfigFile({
      version: 1,
      sandbox: {
        apiUrl: "http://e2b.local:3000",
        apiKey: "secret-key",
        template: "my-template",
        timeoutMs: 120000,
      },
      channels: {},
    });
    const config = loadConfig(makeEnv(configPath), { requireOpencode: false });
    expect(config.mode).toBe("sandbox");
    expect(config.sandbox.apiUrl).toBe("http://e2b.local:3000");
    expect(config.sandbox.apiKey).toBe("secret-key");
    expect(config.sandbox.template).toBe("my-template");
    expect(config.sandbox.timeoutMs).toBe(120000);
  });
});
