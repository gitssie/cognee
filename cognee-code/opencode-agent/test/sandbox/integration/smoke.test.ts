/**
 * Integration smoke test: create real microsandbox via SandboxManager.ensureRuntime().
 * Requires /dev/kvm AND DEEPSEEK_API_KEY for opencode to boot.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxManager } from "../../../src/sandbox/manager.js";

const HAS_KVM = existsSync("/dev/kvm");
const HAS_KEY = !!process.env.DEEPSEEK_API_KEY;

describe("smoke", () => {
  let testDir: string;
  let mgr: SandboxManager;
  const TEST_ID = `smoke-${Date.now()}`;

  afterAll(async () => {
    try { await mgr?.removeRuntime(TEST_ID); } catch {}
    try { await mgr?.shutdown(); } catch {}
    try { testDir && rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it("ensureRuntime creates a healthy sandbox with client", async () => {
    if (!HAS_KVM) return;
    if (!HAS_KEY) return console.log("   SKIP: DEEPSEEK_API_KEY not set");

    testDir = mkdtempSync(join(tmpdir(), "sandbox-smoke-"));
    mgr = new SandboxManager({
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 42000,
      portEnd: 42010,
      idleTtlMs: 300_000,
      maxRuntimeMs: 600_000,
      opencodeImage: "smanx/opencode:latest",
      cpus: 2,
      memoryMb: 1024,
      cleanupIntervalMs: 30_000,
      secrets: [
        { envName: "DEEPSEEK_API_KEY", value: process.env.DEEPSEEK_API_KEY!, allowHosts: ["api.deepseek.com"] },
      ],
    });

    const conn = await mgr.ensureRuntime(TEST_ID);

    expect(conn.sandboxName).toContain(TEST_ID.slice(0, 8));
    expect(conn.hostPort).toBeGreaterThan(42000);
    expect(conn.client.session).toBeDefined();
    expect(conn.client.session.create).toBeFunction();

    await conn.release();
  }, 180_000);

  it("listRuntimes shows the created sandbox", async () => {
    if (!HAS_KVM) return;
    if (!HAS_KEY) return;
    if (!mgr) return;

    const list = await mgr.listRuntimes();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].identity).toBe(TEST_ID);
  }, 10_000);
});
