/**
 * 集成测试: SandboxManager + smanx/opencode:latest
 *
 * 验证 ensureRuntime 能创建 sandbox 并返回可用的 httpUrl.
 * 不依赖 API key — 只测到 HTTP 可达.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SandboxManager } from "../../../src/sandbox/manager.js";

const HAS_KVM = existsSync("/dev/kvm");

function basicAuth(password: string) {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

describe("SandboxManager smanx/opencode", () => {
  let testDir: string;
  let mgr: SandboxManager;
  const TEST_ID = `smanx-manager-${Date.now()}`;

  afterAll(async () => {
    try { await mgr?.removeRuntime(TEST_ID); } catch {}
    try { await mgr?.shutdown(); } catch {}
    try { testDir && rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it("ensureRuntime 启动 sandbox 且 host HTTP 可达", async () => {
    if (!HAS_KVM) { console.log("SKIP: no /dev/kvm"); return; }

    testDir = mkdtempSync(join(tmpdir(), "sandbox-mgr-"));
    mgr = new SandboxManager({
      sandboxRoot: join(testDir, "sandboxes"),
      portStart: 50000,
      portEnd: 50009,
      idleTtlMs: 300_000,
      maxRuntimeMs: 600_000,
      opencodeImage: "smanx/opencode:latest",
      cpus: 1,
      memoryMb: 1024,
      cleanupIntervalMs: 30_000,
      secrets: [],
    });

    const conn = await mgr.ensureRuntime(TEST_ID);

    expect(conn.sandboxName).toContain("opencode-");
    expect(conn.hostPort).toBeGreaterThanOrEqual(50000);
    expect(conn.hostPort).toBeLessThanOrEqual(50009);
    expect(conn.baseUrl).toBe(`http://127.0.0.1:${conn.hostPort}`);

    // 验证 HTTP 可达
    let httpOk = false;
    const rt = await mgr.getRuntime(TEST_ID);
    expect(rt).not.toBeNull();
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const res = await fetch(`${conn.baseUrl}/global/health`, {
          headers: { Authorization: basicAuth(rt!.serverPassword) },
          signal: AbortSignal.timeout(3000),
        });
        console.log(`   /global/health attempt ${i + 1}: HTTP ${res.status}`);
        if (res.ok) {
          httpOk = true;
          break;
        }
      } catch (e: any) {
        if (i < 3) console.log(`   attempt ${i + 1}: ${e.message || e}`);
      }
    }
    expect(httpOk).toBe(true);

    await conn.release();
  }, 180_000);
});
