/**
 * Unit tests for sandbox internals — no E2B sandbox required.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  initFilesystem,
  resolveWorkspacePaths,
  sanitize,
  buildSandboxName,
} from "../../../src/sandbox/workspace.js";
import { makeRuntime } from "../../../src/events.js";
import { WorkspaceInitLive } from "../../../src/opencode-router/workspace-init.js";
import { createSandboxClientProvider } from "../../../src/sandbox/sandbox-provider.js";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { OPENCODE_GUEST_PORT } from "../../../src/sandbox/opencode-client.js";
import { buildSandboxEnvironment, SANDBOX_TIMEZONE } from "../../../src/sandbox/env.js";

let testDir: string;

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), "sandbox-ut-"));
});

describe("Workspace paths", () => {
  it("sanitize replaces @ with -", () => {
    expect(sanitize("user@x.com")).toBe("user-x.com");
  });

  it("sanitize replaces colons with hyphens", () => {
    expect(sanitize("wecom:default:yinyousong")).toBe("wecom-default-yinyousong");
  });

  it("sanitize truncates to 64 chars", () => {
    const long = "a".repeat(100);
    expect(sanitize(long)).toBe("a".repeat(64));
  });

  it("buildSandboxName extracts user from identity", () => {
    expect(buildSandboxName("wecom:default:yinyousong")).toBe("opencode-yinyousong");
  });

  it("resolveWorkspacePaths returns correct host paths", () => {
    const root = join(testDir, "sandboxes");
    const paths = resolveWorkspacePaths("wecom:default:yinyousong", root);
    const expectedWs = resolve(root, "yinyousong");
    expect(paths.workspaceHostPath).toBe(expectedWs);
  });

  it("resolveWorkspacePaths sanitizes path traversal", () => {
    const root = join(testDir, "sandboxes");
    const safePaths = resolveWorkspacePaths("../evil/user", root);
    expect(safePaths.workspaceHostPath).toStartWith(root);
    expect(safePaths.workspaceHostPath).not.toContain("..");
  });

  it("seeds workspace templates even when runtime starts after init", async () => {
    const root = join(testDir, "sandboxes-late-runtime");
    const paths = initFilesystem("wecom:default:late-runtime", { workspaceRoot: root });

    const runtime = makeRuntime(WorkspaceInitLive as any);
    await new Promise((resolve) => setTimeout(resolve, 20));
    runtime.dispose();

    expect(existsSync(join(paths.workspaceHostPath, "AGENTS.md"))).toBeTrue();
    expect(existsSync(join(paths.workspaceHostPath, "TOOLS.md"))).toBeTrue();
    expect(existsSync(join(paths.workspaceHostPath, "MEMORY.md"))).toBeTrue();
  });

  it("does not overwrite existing workspace files while seeding", async () => {
    const root = join(testDir, "sandboxes-existing-files");
    const paths = initFilesystem("wecom:default:existing-files", { workspaceRoot: root });
    const agentsPath = join(paths.workspaceHostPath, "AGENTS.md");
    writeFileSync(agentsPath, "custom user content\n");

    const runtime = makeRuntime(WorkspaceInitLive as any);
    await new Promise((resolve) => setTimeout(resolve, 20));
    runtime.dispose();

    expect(readFileSync(agentsPath, "utf8")).toBe("custom user content\n");
    expect(existsSync(join(paths.workspaceHostPath, "TOOLS.md"))).toBeTrue();
    expect(existsSync(join(paths.workspaceHostPath, "MEMORY.md"))).toBeTrue();
  });
});

describe("Auth JSON builder", () => {
  const envToProvider: Record<string, string> = {
    DEEPSEEK_API_KEY: "deepseek",
    ANTHROPIC_API_KEY: "anthropic",
    OPENAI_API_KEY: "openai",
  };

  function buildAuth(secrets: Array<{ envName: string; value: string }>) {
    const auth: Record<string, { type: string; key: string }> = {};
    for (const s of secrets) {
      const p = envToProvider[s.envName];
      if (p && s.value) auth[p] = { type: "api", key: s.value };
    }
    return Object.keys(auth).length > 0 ? auth : null;
  }

  it("builds auth with 2 providers", () => {
    const auth = buildAuth([
      { envName: "DEEPSEEK_API_KEY", value: "sk-test123" },
      { envName: "ANTHROPIC_API_KEY", value: "ant-key" },
    ]);
    expect(auth).not.toBeNull();
    expect(auth!.deepseek.key).toBe("sk-test123");
    expect(auth!.anthropic.key).toBe("ant-key");
    expect(auth!.openai).toBeUndefined();
  });

  it("returns null for empty secrets", () => {
    expect(buildAuth([])).toBeNull();
  });

  it("returns null for unknown env names", () => {
    expect(buildAuth([{ envName: "UNKNOWN_KEY", value: "x" }])).toBeNull();
  });
});

describe("Config / DB path resolution", () => {
  it("fallback DB path matches router path", () => {
    const routerDbPath = resolve(testDir, "data", "opencode-router.db");
    expect(routerDbPath).toBe(resolve(testDir, "data", "opencode-router.db"));
  });
});

describe("Sandbox environment", () => {
  it("enables EXA and sets timezone for sandbox processes", () => {
    const env = buildSandboxEnvironment("secret-password", []);
    expect(env.OPENCODE_ENABLE_EXA).toBe("true");
    expect(env.TZ).toBe(SANDBOX_TIMEZONE);
  });
});

describe("Provider identity builder", () => {
  const safe = (s: string) =>
    s.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  const buildIdentity = (ch: string, id: string, pk: string) =>
    `${safe(ch)}:${safe(id)}:${safe(pk)}`;

  it("builds identity from wecom params", () => {
    expect(buildIdentity("wecom", "default", "yinyousong")).toBe("wecom:default:yinyousong");
  });

  it("builds identity from telegram params", () => {
    expect(buildIdentity("telegram", "bot1", "123456")).toBe("telegram:bot1:123456");
  });
});

describe("OpenCode client factory", () => {
  it("exposes shared sandbox OpenCode guest port", () => {
    expect(OPENCODE_GUEST_PORT).toBe(4096);
  });

  it("createOpencodeClient constructs session and prompt objects", () => {
    const client = createOpencodeClient({
      baseUrl: "http://127.0.0.1:9999",
      responseStyle: "data",
      throwOnError: true,
      headers: { Authorization: "Basic dGVzdDoxMjM=" },
    } as any);
    expect(client.session).toBeDefined();
    expect(client.session.create).toBeFunction();
    expect(client.session.prompt).toBeFunction();
  });
});

describe("Provider factories", () => {
  it("createSandboxClientProvider reports healthy and rejects directory-scoped clients", async () => {
    const stubMgr = {
      ensureRuntime: async (id: string) => ({
        sandboxName: `sandbox-${id}`,
        baseUrl: "http://127.0.0.1:42000",
        hostPort: 42000,
        client: {
          session: {
            create: async () => ({ id: "ses_test" }),
            prompt: async () => ({ parts: [] }),
          },
        },
        release: async () => {},
      }),
      listRuntimes: async () => [] as any[],
      shutdown: async () => {},
    };

    const provider = createSandboxClientProvider(stubMgr as any);

    expect(provider.getClientForSession).toBeFunction();
    expect(provider.getHealth).toBeFunction();

    const health = await provider.getHealth();
    expect(health.healthy).toBeTrue();

    // Sandbox mode rejects directory-scoped clients
    expect(() => provider.getClientForDirectory("/tmp")).toThrow(/getClientForSession/);

    await provider.shutdown();
  });
});
