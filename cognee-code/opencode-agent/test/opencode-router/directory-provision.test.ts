/**
 * Integration test: directory provisioning — when a new user arrives,
 * the workspace directory is created under /work/userX and template
 * files (AGENTS.md, TOOLS.md, MEMORY.md) are seeded.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../src/opencode-router/logger.js";
import { provisionPeerDirectory } from "../../src/opencode-router/directory.js";
import type { DirectoryStrategy } from "../../src/opencode-router/config.js";

const WORKSPACE_ROOT = "/work";
const logger = createLogger("debug", { logFile: "/tmp/dir-prov-test.log" });

describe("Directory provisioning — new user workspace creation", () => {
  const testUsers = ["new-user-01", "user-with-dashes", "user.with.dots"];

  afterAll(() => {
    for (const name of [...testUsers, "persist-test-user", "session-provisioned"]) {
      try { rmSync(join(WORKSPACE_ROOT, name), { recursive: true }); } catch {}
    }
  });

  test("provisionPeerDirectory creates /work/userX and seeds template files", async () => {
    const strategy: DirectoryStrategy = { mode: "per-peer", root: WORKSPACE_ROOT };

    for (const userName of testUsers) {
      const dir = await provisionPeerDirectory(strategy, userName, "/tmp", logger);

      // 1. Directory was created
      expect(dir).toBe(join(WORKSPACE_ROOT, userName));
      expect(existsSync(dir)).toBeTrue();

      // 2. Template files were seeded as .md (converted from source .txt)
      for (const tmpl of ["AGENTS.md", "TOOLS.md", "MEMORY.md"]) {
        const tmplPath = join(dir, tmpl);
        expect(existsSync(tmplPath)).toBeTrue();
        // MEMORY.md is intentionally empty; AGENTS.md and TOOLS.md have content
        if (tmpl !== "MEMORY.md") {
          const content = readFileSync(tmplPath, "utf-8");
          expect(content.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("second call to provisionPeerDirectory does not overwrite user-modified template files", async () => {
    const userName = "persist-test-user";
    const strategy: DirectoryStrategy = { mode: "per-peer", root: WORKSPACE_ROOT };
    const dir = join(WORKSPACE_ROOT, userName);

    try { rmSync(dir, { recursive: true }); } catch {}
    mkdirSync(dir, { recursive: true });

    // Write a custom AGENTS.md first — it should NOT be overwritten by provisionPeerDirectory
    const customContent = "# Custom agent instructions for persist-test-user\n";
    const agentsPath = join(dir, "AGENTS.md");
    writeFileSync(agentsPath, customContent);

    // Now run provisionPeerDirectory again — should NOT overwrite
    await provisionPeerDirectory(strategy, userName, "/tmp", logger);

    const actual = readFileSync(agentsPath, "utf-8");
    expect(actual).toBe(customContent);

    // Cleanup
    try { rmSync(dir, { recursive: true }); } catch {}
  });

  test("new user session can use the provisioned directory with opencode", async () => {
    const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
    const client = createOpencodeClient({
      baseUrl: "http://127.0.0.1:4096",
      responseStyle: "data",
      throwOnError: true,
    } as any);

    const userName = "session-provisioned";
    const strategy: DirectoryStrategy = { mode: "per-peer", root: WORKSPACE_ROOT };
    const dir = await provisionPeerDirectory(strategy, userName, "/tmp", logger);

    // Create session pointing at the provisioned directory
    const session = await client.session.create({
      title: `provision-test-${userName}`,
      directory: dir,
    } as any);
    const sessionId = (session as any).data?.id ?? (session as any).id;
    expect(sessionId).toBeString();

    // Send a prompt — AI should be able to access the session directory
    const result = await client.session.prompt({
      sessionID: sessionId,
      parts: [{ type: "text", text: "Reply with exactly: PROVISIONED" }],
    } as any);
    const parts = (result as any).data?.parts ?? (result as any).parts ?? [];
    const text = parts.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
    console.log(`[provision-test] AI: ${text}`);

    expect(text).not.toBeEmpty();

    // Cleanup
    try { rmSync(dir, { recursive: true }); } catch {}
  }, 60000);
});
