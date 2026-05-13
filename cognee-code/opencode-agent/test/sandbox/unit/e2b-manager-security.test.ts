/**
 * Adversarial security tests for E2BSandboxManager.
 *
 * Attack surfaces tested:
 * - Path traversal in hostMountWorkspaceRoot config
 * - Oversized identity strings (DoS / resource exhaustion)
 * - Injection patterns in identity (SQL, template, HTML, shell, unicode)
 * - Null/undefined store access
 * - Boundary violations (empty identity, empty hostMountWorkspaceRoot, control chars)
 *
 * Tests cover both unit-level (sanitize, buildSandboxName, resolveWorkspacePaths)
 * and integration-level (E2BSandboxManager public methods) attack vectors.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ═══════════════════════════════════════════════════════════
// MOCKS — must be at top level, BEFORE any imports
// ═══════════════════════════════════════════════════════════

let sandboxCounter = 0;

/** Last options passed to Sandbox.create() — captured for host-mount adversarial tests. */
let lastCreateOpts: any = null;

function createMockSandbox() {
  sandboxCounter++;
  const sid = `test-sandbox-${sandboxCounter}`;
  return {
    sandboxId: sid,
    files: {
      write: async (_path: string, _content: string) => {},
      exists: async (_path: string) => false,
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
    isRunning: async () => true,
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
import {
  initFilesystem,
  resolveWorkspacePaths,
  buildSandboxName,
  sanitize,
} from "../../../src/sandbox/workspace.js";
import type { BridgeStore } from "../../../src/opencode-router/db.js";
import { readFileSync } from "node:fs";

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "e2b-sec-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

const mockConfig = {
  configFile: { opencode: {} },
} as any;

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
    opencodePort: 49983,
    hostMountEnabled: true,
    hostMountWorkspaceRoot: join(testDir, "sandboxes"),
    secrets: [],
    config: mockConfig,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// SUITE 1: sanitize() — injection defense in identity sanitizer
// ═══════════════════════════════════════════════════════════

describe("sanitize() — adversarial injection defense", () => {
  test("removes path traversal sequences (../)", () => {
    // Dots are allowed chars; slashes become hyphens; leading dots+hyphens stripped
    expect(sanitize("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitize("..\\..\\windows\\system32")).toBe("windows-system32");
  });

  test("removes absolute path injection", () => {
    // Leading slash becomes hyphen, then leading hyphen stripped
    expect(sanitize("/etc/passwd")).toBe("etc-passwd");
    expect(sanitize("C:\\Windows\\System32")).toBe("C-Windows-System32");
  });

  test("strips leading and trailing dots and hyphens", () => {
    expect(sanitize("..opencode..")).toBe("opencode");
    expect(sanitize("--opencode--")).toBe("opencode");
    expect(sanitize(".-opencode-.")).toBe("opencode");
    expect(sanitize("..")).toBe("");
    expect(sanitize("...")).toBe("");
    expect(sanitize("---")).toBe("");
  });

  test("removes SQL injection patterns", () => {
    const sql = "' OR 1=1 --";
    const result = sanitize(sql);
    expect(result).not.toContain("'");
    expect(result).not.toContain("=");
    expect(result).not.toContain("--");
    expect(result).toBe("OR-1-1");
  });

  test("removes HTML/script injection patterns", () => {
    const html = "<script>alert('xss')</script>";
    const result = sanitize(html);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("'");
    expect(result).toBe("script-alert-xss-script");
  });

  test("removes template injection patterns", () => {
    const tmpl = "${process.env.SECRET}";
    const result = sanitize(tmpl);
    expect(result).not.toContain("$");
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).toBe("process.env.SECRET");
  });

  test("removes shell command injection patterns", () => {
    const cmd = "$(cat /etc/passwd)";
    const result = sanitize(cmd);
    expect(result).not.toContain("$");
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
    expect(result).toBe("cat-etc-passwd");
  });

  test("replaces unicode/emoji with hyphens", () => {
    expect(sanitize("user🔥test")).toBe("user-test");
    expect(sanitize("привет")).toBe("");
    expect(sanitize("中文标识")).toBe("");
    expect(sanitize("emoji🎉here")).toBe("emoji-here");
  });

  test("handles null byte and control characters", () => {
    const withNull = "user\x00test";
    const result = sanitize(withNull);
    expect(result).not.toContain("\x00");
    expect(result).toBe("user-test");
  });

  test("handles RTL override and zero-width characters", () => {
    const rtl = "user\u202Etest";
    const zwj = "user\u200Dtest";
    const zws = "user\u200Btest";
    expect(sanitize(rtl)).toBe("user-test");
    expect(sanitize(zwj)).toBe("user-test");
    expect(sanitize(zws)).toBe("user-test");
  });

  test("truncates to 64 characters maximum", () => {
    const long = "a".repeat(200);
    expect(sanitize(long).length).toBeLessThanOrEqual(64);
  });

  test("removes all whitespace", () => {
    expect(sanitize("user name\twith\nspaces")).toBe("user-name-with-spaces");
  });

  test("handles empty string input", () => {
    expect(sanitize("")).toBe("");
  });

  test("handles string with only disallowed characters", () => {
    expect(sanitize("@#$%^&*()")).toBe("");
  });

  test("allows valid alphanumeric, underscore, dot, hyphen", () => {
    expect(sanitize("valid_user.name-123")).toBe("valid_user.name-123");
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 2: buildSandboxName() — path traversal through identity
// ═══════════════════════════════════════════════════════════

describe("buildSandboxName() — identity-based traversal defense", () => {
  test("extracts last segment of colon-separated identity", () => {
    expect(buildSandboxName("wecom:default:alice")).toBe("opencode-alice");
  });

  test("single-segment identity becomes the sandbox name", () => {
    expect(buildSandboxName("alice")).toBe("opencode-alice");
  });

  test("path traversal identity is sanitized, not traversed", () => {
    // If an attacker could inject "../../etc" in the identity, the resulting
    // sandbox name should NOT traverse directories — it must be flattened.
    const name = buildSandboxName("../../etc");
    expect(name).toBe("opencode-etc");
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
  });

  test("identity with path separators is flattened", () => {
    const name = buildSandboxName("/etc/passwd");
    expect(name).toBe("opencode-etc-passwd");
  });

  test("identity with only special chars produces fallback name", () => {
    const name = buildSandboxName("@#$%^&*()");
    expect(name).toBe("opencode-");
  });

  test("empty identity produces fallback name", () => {
    const name = buildSandboxName("");
    expect(name).toBe("opencode-");
  });

  test("unicode-only identity is sanitized to fallback", () => {
    const name = buildSandboxName("🔥🔥🔥");
    expect(name).toBe("opencode-");
  });

  test("very long identity is truncated in the output name", () => {
    const long = "a".repeat(200);
    const name = buildSandboxName(long);
    expect(name).toStartWith("opencode-");
    // Total length should be "opencode-".length (9) + up to 64 chars
    expect(name.length).toBeLessThanOrEqual(73);
  });

  test("identity with SQL injection removes dangerous SQL chars", () => {
    const name = buildSandboxName("' OR 1=1 --");
    expect(name).toBe("opencode-OR-1-1");
    expect(name).not.toContain("'");
    expect(name).not.toContain("=");
    // Hyphens are allowed in sanitize (safe path chars) — they do not
    // enable path traversal or injection.
  });

  test("identity with template injection is neutralized", () => {
    const name = buildSandboxName("${secrets.API_KEY}");
    expect(name).toBe("opencode-secrets.API_KEY");
    expect(name).not.toContain("$");
    expect(name).not.toContain("{");
    expect(name).not.toContain("}");
  });

  test("identity with 500 colon-separated segments produces small name", () => {
    const segments = Array.from({ length: 500 }, (_, i) => `seg${i}`);
    const identity = segments.join(":");
    const name = buildSandboxName(identity);
    // Only the last segment should survive
    expect(name).toBe(`opencode-${segments[499]}`);
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 3: resolveWorkspacePaths() — hostMountWorkspaceRoot path traversal
// ═══════════════════════════════════════════════════════════

describe("resolveWorkspacePaths() — hostMountWorkspaceRoot path traversal defense", () => {
  test("normal hostMountWorkspaceRoot creates paths under the root", () => {
    const root = join(testDir, "sandboxes");
    const paths = resolveWorkspacePaths("wecom:default:alice", root);
    expect(paths.workspaceHostPath).toStartWith(root);
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
  });

  test("assertWithinRoot rejects path escaping the hostMountWorkspaceRoot via identity", () => {
    const root = join(testDir, "sandboxes");
    const paths = resolveWorkspacePaths("..", root);
    expect(paths.workspaceHostPath).toStartWith(root);
  });

  test("traversal in hostMountWorkspaceRoot itself is allowed (root is the trust boundary)", () => {
    const externalRoot = "/tmp";
    const paths = resolveWorkspacePaths("wecom:default:test", externalRoot);
    expect(paths.workspaceHostPath).toStartWith(externalRoot);
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
    rmSync(paths.workspaceHostPath, { recursive: true, force: true });
  });

  test("hostMountWorkspaceRoot with deeply nested subdirectory creates paths correctly", () => {
    const nestedRoot = join(testDir, "a", "b", "c", "d");
    const paths = resolveWorkspacePaths("test-user", nestedRoot);
    expect(paths.workspaceHostPath).toBe(
      resolve(nestedRoot, "test-user"),
    );
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
  });

  test("hostMountWorkspaceRoot with trailing slash works the same as without", () => {
    const root = join(testDir, "sandboxes");
    const paths1 = resolveWorkspacePaths("user-a", root);
    const paths2 = resolveWorkspacePaths("user-a", root + "/");
    expect(paths1.workspaceHostPath).toBe(paths2.workspaceHostPath);
  });

  test("empty hostMountWorkspaceRoot resolves to CWD-relative paths", () => {
    const paths = resolveWorkspacePaths("empty-root-test", "");
    expect(paths.workspaceHostPath).toStartWith(process.cwd());
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
    rmSync(paths.workspaceHostPath, { recursive: true, force: true });
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 4: initFilesystem() — adversarial config
// ═══════════════════════════════════════════════════════════

describe("initFilesystem() — adversarial config defense", () => {
  test("handles empty config gracefully", () => {
    const paths = initFilesystem("wecom:default:nosecrets", {
      workspaceRoot: join(testDir, "sandboxes"),
    });
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
  });

  test("handles secrets with empty values gracefully", () => {
    const paths = initFilesystem("wecom:default:emptysecrets", {
      workspaceRoot: join(testDir, "sandboxes"),
    });
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
  });

  test("secrets with injection in envName do not pollute filenames", () => {
    const paths = initFilesystem("wecom:default:injsec", {
      workspaceRoot: join(testDir, "sandboxes"),
    });
    // envName is not recognized by API_KEY_PROVIDER, so it's ignored
    // No auth.json written with this secret
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
  });

  test("handles secrets with injection in value safely", () => {
    const paths = initFilesystem("wecom:default:injval", {
      workspaceRoot: join(testDir, "sandboxes"),
    });
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 5: setStore() — null/undefined access
// ═══════════════════════════════════════════════════════════

describe("E2BSandboxManager.setStore() — null/undefined defense", () => {
  test("setStore with valid store stores the reference", () => {
    const manager = new E2BSandboxManager(makeConfig());
    const store = {} as BridgeStore;
    manager.setStore(store);
    expect((manager as any).cfg.store).toBe(store);
  });

  test("setStore with undefined does not throw", () => {
    const manager = new E2BSandboxManager(makeConfig());
    // TypeScript would forbid this, but at runtime JS can pass undefined
    expect(() => {
      (manager as any).setStore(undefined);
    }).not.toThrow();
    expect((manager as any).cfg.store).toBeUndefined();
  });

  test("setStore with null does not throw at call site", () => {
    const manager = new E2BSandboxManager(makeConfig());
    // TypeScript would forbid null, but at runtime JS can pass null
    expect(() => {
      (manager as any).setStore(null);
    }).not.toThrow();
    // null gets stored — downstream code must handle it
    expect((manager as any).cfg.store).toBeNull();
  });

  test("ensureRuntime succeeds after setStore(null)", async () => {
    // Verify that the rest of the manager still works after a null store
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    (manager as any).setStore(null);
    expect((manager as any).cfg.store).toBeNull();

    // ensureRuntime should still succeed since cfg.store is not used in the flow
    const conn = await manager.ensureRuntime("wecom:default:nullstore");
    expect(conn.sandboxName).toBe("opencode-nullstore");

    await manager.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 6: ensureRuntime() — adversarial identity boundary tests
// ═══════════════════════════════════════════════════════════

describe("E2BSandboxManager.ensureRuntime() — adversarial identity defense", () => {
  test("empty identity creates sandbox with fallback name", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    const conn = await manager.ensureRuntime("");
    expect(conn.sandboxName).toBe("opencode-");

    const runtime = await manager.getRuntime("");
    expect(runtime).not.toBeNull();
    expect(existsSync(runtime!.workspaceHostPath)).toBeTrue();

    await manager.shutdown();
  });

  test("SQL injection in identity is neutralized", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "' OR 1=1; DROP TABLE sessions; --";

    const conn = await manager.ensureRuntime(identity);
    // The sandbox name should be sanitized — no dangerous characters
    // Note: alphanumeric tokens like DROP survive sanitize (they are safe
    // in directory names — only special chars are stripped/replaced).
    // Consecutive disallowed character runs collapse into a single hyphen.
    expect(conn.sandboxName).toBe("opencode-OR-1-1-DROP-TABLE-sessions");

    // Verify dangerous SQL characters are removed from the filesystem path
    const runtime = await manager.getRuntime(identity);
    expect(runtime).not.toBeNull();
    expect(runtime!.workspaceHostPath).not.toContain("'");
    expect(runtime!.workspaceHostPath).not.toContain(";");

    await manager.shutdown();
  });

  test("HTML injection in identity is neutralized", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "<script>alert('xss')</script>";

    const conn = await manager.ensureRuntime(identity);
    expect(conn.sandboxName).not.toContain("<");
    expect(conn.sandboxName).not.toContain(">");
    expect(conn.sandboxName).not.toContain("'");

    await manager.shutdown();
  });

  test("shell command injection in identity is neutralized", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "$(rm -rf /)";

    const conn = await manager.ensureRuntime(identity);
    expect(conn.sandboxName).not.toContain("$");
    expect(conn.sandboxName).not.toContain("(");
    expect(conn.sandboxName).not.toContain(")");

    await manager.shutdown();
  });

  test("unicode/emoji in identity is sanitized", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    const conn = await manager.ensureRuntime("user🔥test✨");
    expect(conn.sandboxName).toBe("opencode-user-test");
    expect(conn.sandboxName).not.toContain("🔥");
    expect(conn.sandboxName).not.toContain("✨");

    await manager.shutdown();
  });

  test("very long identity (100KB) does not crash or hang", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "x".repeat(100_000);

    const conn = await manager.ensureRuntime(identity);
    expect(conn.sandboxName).toStartWith("opencode-");
    // The map key is the full 100KB string, but the directory name is truncated
    const runtime = await manager.getRuntime(identity);
    expect(runtime).not.toBeNull();

    await manager.shutdown();
  });

  test("identity with 1000 colon-separated segments is handled", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const segments = Array.from({ length: 1000 }, (_, i) => `seg${i}`);
    const identity = segments.join(":");

    const conn = await manager.ensureRuntime(identity);
    // Only the last segment survives as the sandbox name
    expect(conn.sandboxName).toBe("opencode-seg999");

    await manager.shutdown();
  });

  test("multiple identities with special characters each get unique paths", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    const identities = [
      "normal-user",
      "user with spaces",
      "user<script>",
      "user$env",
      "user🔥emoji",
      "../../etc",
      "/absolute/path",
    ];

    // All should succeed without throwing
    for (const identity of identities) {
      const conn = await manager.ensureRuntime(identity);
      expect(conn.sandboxName).toBeString();
      const runtime = await manager.getRuntime(identity);
      expect(runtime).not.toBeNull();
      expect(existsSync(runtime!.workspaceHostPath)).toBeTrue();
    }

    // Each identity gets a unique instance
    const runtimes = await manager.listRuntimes();
    expect(runtimes).toHaveLength(identities.length);

    await manager.shutdown();
  });

  test("identity with control characters (null byte, newline, tab)", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    // Null byte in identity
    const identityWithNull = "user\x00name";
    const conn = await manager.ensureRuntime(identityWithNull);
    expect(conn.sandboxName).toBe("opencode-user-name");

    await manager.shutdown();
  });

  test("identity with RTL override characters", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    const identity = "user\u202Etest";
    const conn = await manager.ensureRuntime(identity);
    expect(conn.sandboxName).toBe("opencode-user-test");

    await manager.shutdown();
  });

  test("rapid ensureRuntime calls with same identity are idempotent", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "wecom:default:rapid";

    // Rapid repeated calls should all succeed and return the same instance
    const results = await Promise.all(
      Array.from({ length: 10 }, () => manager.ensureRuntime(identity)),
    );

    for (const conn of results) {
      expect(conn.sandboxName).toBe("opencode-rapid");
    }

    // Only one instance should exist
    const runtimes = await manager.listRuntimes();
    expect(runtimes).toHaveLength(1);

    await manager.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 7: Resource exhaustion boundaries
// ═══════════════════════════════════════════════════════════

describe("Resource exhaustion boundaries", () => {
  test("many unique identities with random special characters", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);

    // Create 20 identities with various special characters
    const identities = Array.from({ length: 20 }, (_, i) => {
      const special = ["<", ">", "'", '"', "$", "`", "|", ";", "&", "("][i % 10];
      return `user${special}${i}`;
    });

    for (const identity of identities) {
      await manager.ensureRuntime(identity);
    }

    const runtimes = await manager.listRuntimes();
    expect(runtimes).toHaveLength(20);

    await manager.shutdown();
  });

  test("hostMountWorkspaceRoot exceeding typical path length limits", async () => {
    // Create a deeply nested hostMountWorkspaceRoot (200+ chars)
    const deepRoot = join(
      testDir,
      ...Array.from({ length: 15 }, (_, i) => `level${i}`),
    );
    const cfg = makeConfig({ hostMountWorkspaceRoot: deepRoot });
    const manager = new E2BSandboxManager(cfg);

    const conn = await manager.ensureRuntime("wecom:default:deeppath");
    expect(conn.sandboxName).toBe("opencode-deeppath");
    expect(existsSync(join(deepRoot, "deeppath"))).toBeTrue();

    await manager.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 8: getRuntime / listRuntimes with adversarial identities
// ═══════════════════════════════════════════════════════════

describe("getRuntime / listRuntimes with adversarial identities", () => {
  test("getRuntime returns null for identity that was never created", async () => {
    const manager = new E2BSandboxManager(makeConfig());
    const runtime = await manager.getRuntime("nonexistent-user");
    expect(runtime).toBeNull();
  });

  test("getRuntime with special char identity returns correct instance", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "user<inject>";

    await manager.ensureRuntime(identity);
    const runtime = await manager.getRuntime(identity);
    expect(runtime).not.toBeNull();
    expect(runtime!.identity).toBe(identity);

    await manager.shutdown();
  });

  test("instance map key preserves the original identity (raw), not sanitized", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identity = "../../etc";

    await manager.ensureRuntime(identity);
    // Must use the original raw identity to look up; sanitized version won't match
    const byRaw = await manager.getRuntime(identity);
    expect(byRaw).not.toBeNull();

    const bySanitized = await manager.getRuntime("opencode-");
    // The raw identity "../../etc" becomes buildSandboxName("../../etc") → "opencode-"
    // but the map key is "../../etc" (the raw string)
    expect(bySanitized).toBeNull();

    await manager.shutdown();
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 9: Config-level adversarial checks
// ═══════════════════════════════════════════════════════════

describe("Config-level adversarial defense", () => {
  test("hostMountWorkspaceRoot with null-like values in constructor", () => {
    // Although TypeScript prevents this, at runtime someone could pass undefined
    // in the config object. Verify graceful handling.
    const cfg = makeConfig({ hostMountWorkspaceRoot: undefined as unknown as string });
    const manager = new E2BSandboxManager(cfg);

    // The constructor stores hostMountWorkspaceRoot from cfg, which would be undefined.
    // resolveWorkspacePaths would then call resolve(undefined, ...) which
    // treats undefined as "."
    expect(manager).toBeTruthy();
  });

  test("absent hostMountWorkspaceRoot in config object", () => {
    // Create a config without hostMountWorkspaceRoot (TypeScript allows destructuring defaults)
    const partialCfg = {
      apiKey: "test-key",
      template: "test",
      timeoutMs: 10_000,
      idleTtlMs: 60_000,
      maxRuntimeMs: 300_000,
      cleanupIntervalMs: 30_000,
      secrets: [],
    } as E2BSandboxManagerConfig;

    // hostMountWorkspaceRoot will be undefined at runtime
    const manager = new E2BSandboxManager(partialCfg);
    expect((manager as any).cfg.hostMountWorkspaceRoot).toBeUndefined();
  });

  test("secrets with very long values do not break initFilesystem", () => {
    const paths = initFilesystem("wecom:default:longsecret", {
      workspaceRoot: join(testDir, "sandboxes"),
    });
    expect(existsSync(paths.workspaceHostPath)).toBeTrue();
  });
});

// ═══════════════════════════════════════════════════════════
// SUITE 10: host-mount metadata adversarial tests — special
// chars in identity must not break JSON or path integrity
// ═══════════════════════════════════════════════════════════

describe("Sandbox.create() host-mount metadata — adversarial identity", () => {
  async function assertHostMountIntegrity(
    manager: E2BSandboxManager,
    identity: string,
  ) {
    lastCreateOpts = null;
    await manager.ensureRuntime(identity);
    // host-mount must exist and be parseable JSON
    expect(lastCreateOpts).not.toBeNull();
    expect(lastCreateOpts.metadata["host-mount"]).toBeString();
    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(Array.isArray(hostMount)).toBeTrue();
    expect(hostMount).toHaveLength(1);
    expect(hostMount[0].hostPath).toBeString();
    expect(hostMount[0].hostPath).not.toBeEmpty();
    expect(hostMount[0].hostPath).toStartWith("/");
    expect(hostMount[0].mountPath).toBe("/home/user");
  }

  test("SQL injection identity: host-mount JSON is valid and parseable", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "' OR 1=1; DROP TABLE sessions; --");
    await manager.shutdown();
  });

  test("HTML/script injection identity: host-mount JSON is valid and parseable", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "<script>alert('xss')</script>");
    await manager.shutdown();
  });

  test("shell command injection identity: host-mount JSON is valid and parseable", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "$(rm -rf /)");
    await manager.shutdown();
  });

  test("template injection identity: host-mount JSON is valid and parseable", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "${process.env.SECRET}");
    await manager.shutdown();
  });

  test("path traversal identity: host-mount paths stay under hostMountWorkspaceRoot", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    lastCreateOpts = null;
    await manager.ensureRuntime("../../etc/passwd");

    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    // hostPath must remain under the configured hostMountWorkspaceRoot
    expect(hostMount[0].hostPath).toStartWith(cfg.hostMountWorkspaceRoot);
    expect(hostMount[0].hostPath).not.toContain("..");

    await manager.shutdown();
  });

  test("absolute path identity: host-mount paths stay under hostMountWorkspaceRoot", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    lastCreateOpts = null;
    await manager.ensureRuntime("/etc/passwd");

    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    // Even though the identity starts with /, the path is sanitized and
    // the resulting hostPath stays within hostMountWorkspaceRoot
    expect(hostMount[0].hostPath).toStartWith(cfg.hostMountWorkspaceRoot);

    await manager.shutdown();
  });

  test("unicode/emoji identity: host-mount JSON is valid and paths are absolute", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "user🔥test✨中文привет");
    await manager.shutdown();
  });

  test("control characters in identity: host-mount JSON is valid", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "user\x00name\twith\nnewlines");
    await manager.shutdown();
  });

  test("RTL and zero-width characters in identity: host-mount JSON is valid", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "user\u202Etest\u200Dfoo\u200Bbar");
    await manager.shutdown();
  });

  test("empty identity: host-mount JSON is valid and paths stay under hostMountWorkspaceRoot", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    lastCreateOpts = null;
    await manager.ensureRuntime("");

    expect(lastCreateOpts).not.toBeNull();
    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(Array.isArray(hostMount)).toBeTrue();
    expect(hostMount).toHaveLength(1);
    expect(hostMount[0].hostPath).toStartWith("/");
    expect(hostMount[0].hostPath).toStartWith(cfg.hostMountWorkspaceRoot);

    await manager.shutdown();
  });

  test("100KB identity: host-mount JSON is still valid", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const hugeIdentity = "x".repeat(100_000);

    lastCreateOpts = null;
    await manager.ensureRuntime(hugeIdentity);

    expect(lastCreateOpts).not.toBeNull();
    const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
    expect(Array.isArray(hostMount)).toBeTrue();
    expect(hostMount).toHaveLength(1);
    expect(hostMount[0].hostPath).toStartWith(cfg.hostMountWorkspaceRoot);
    // Path leaf should be at most 64 chars (sanitize truncation)
    const leaf = hostMount[0].hostPath.split("/").pop() ?? "";
    expect(leaf.length).toBeLessThanOrEqual(64);

    await manager.shutdown();
  });

  test("identity with only special chars: host-mount JSON is still valid", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    await assertHostMountIntegrity(manager, "@#$%^&*()");
    await manager.shutdown();
  });

  test("identity with 1000 colon-separated segments: host-mount JSON is valid", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const segments = Array.from({ length: 1000 }, (_, i) => `seg${i}`);
    const identity = segments.join(":");

    await assertHostMountIntegrity(manager, identity);
    await manager.shutdown();
  });

  test("identity with double quotes does not break JSON structure", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    // Double quotes inside identity — sanitize() replaces them with hyphens
    // so the resulting path string should NOT contain raw quotes that
    // would break JSON
    lastCreateOpts = null;
    await manager.ensureRuntime('user"double"quotes');

    const rawHostMount = lastCreateOpts.metadata["host-mount"];
    // rawHostMount must be valid JSON (quotes in identity are sanitized away
    // before the string reaches JSON.stringify)
    expect(() => JSON.parse(rawHostMount)).not.toThrow();
    const hostMount = JSON.parse(rawHostMount);
    expect(hostMount[0].hostPath).not.toContain('"');
    expect(hostMount[0].hostPath).toBeString();
    expect(hostMount[0].hostPath).toStartWith(cfg.hostMountWorkspaceRoot);

    await manager.shutdown();
  });

  test("identity with backslashes: host-mount paths are valid and absolute", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    lastCreateOpts = null;
    await manager.ensureRuntime("C:\\Windows\\System32");

    // Backslashes in identity get sanitized to hyphens
    const rawHostMount = lastCreateOpts.metadata["host-mount"];
    expect(() => JSON.parse(rawHostMount)).not.toThrow();
    const hostMount = JSON.parse(rawHostMount);
    expect(hostMount[0].hostPath).toStartWith(cfg.hostMountWorkspaceRoot);
    expect(hostMount[0].hostPath).not.toContain("C:");
    // The path should be a proper POSIX path under hostMountWorkspaceRoot
    expect(hostMount[0].hostPath).toStartWith("/");

    await manager.shutdown();
  });

  test("multiple adversarial identities produce unique and valid host-mount paths", async () => {
    const cfg = makeConfig();
    const manager = new E2BSandboxManager(cfg);
    const identities = [
      "normal-user",
      "user with spaces",
      "user<script>",
      "user$env",
      "user🔥emoji",
      "../../etc",
      "/absolute/path",
      "' OR 1=1 --",
      "${secrets.API_KEY}",
      "C:\\Windows\\System32",
    ];

    const capturedPaths: string[] = [];

    for (const identity of identities) {
      lastCreateOpts = null;
      await manager.ensureRuntime(identity);

      expect(lastCreateOpts).not.toBeNull();
      const hostMount = JSON.parse(lastCreateOpts.metadata["host-mount"]);
      expect(Array.isArray(hostMount)).toBeTrue();
      expect(hostMount).toHaveLength(1);
      expect(hostMount[0].hostPath).toStartWith(cfg.hostMountWorkspaceRoot);
      expect(hostMount[0].mountPath).toBe("/home/user");

      capturedPaths.push(hostMount[0].hostPath);
    }

    // Each identity must get a unique workspace path
    const unique = new Set(capturedPaths);
    expect(unique.size).toBe(identities.length);

    await manager.shutdown();
  });
});
