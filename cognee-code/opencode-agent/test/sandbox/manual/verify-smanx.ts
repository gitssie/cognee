import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Sandbox, NetworkPolicy } from "microsandbox";

// 测试 execStream + 监控循环 = manager.ts 的核心模式
async function test() {
  const name = `vt-${Date.now()}`;
  const ws = mkdtempSync(join(tmpdir(), `ws-`));
  mkdirSync(ws, { recursive: true });

  try {
    const sb = await Sandbox.builder(name)
      .replace()
      .image("ghcr.io/anomalyco/opencode:latest")
      .cpus(1).memory(1024).workdir("/workspace")
      .maxDuration(600).idleTimeout(300)
      .init("/bin/sleep", ["infinity"])
      .volume("/workspace", (v: any) => v.bind(ws))
      .network((n: any) => n.port(57000, 4096).policy(NetworkPolicy.allowAll()))
      .createDetached();

    // execStream 启动 opencode
    const handle = await sb.execStream("opencode", 
      ["serve", "--port", "4096", "--hostname", "0.0.0.0", "--log-level", "ERROR"]);

    // 监控循环（同 manager.ts）
    let exited = false;
    let exitCode = -1;
    const monitor = (async () => {
      try {
        for await (const e of handle) {
          if (e.kind === "exited") { exited = true; exitCode = e.code; break; }
        }
      } catch { /* stream closed */ }
    })();

    // wait for opencode
    let ok = false;
    for (let i = 1; i <= 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res = await fetch("http://127.0.0.1:57000/global/health", { signal: AbortSignal.timeout(4000) });
        console.log(`[${i}] HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`);
        ok = true;
        break;
      } catch (e: any) { if (i <= 3) console.log(`[${i}] ${e.message}`); }
    }

    console.log(ok ? "opencode PASS" : "opencode FAIL");

    // cleanup
    await handle.kill();
    await monitor;
    console.log(`exited=${exited} code=${exitCode}`);
    await sb.stop(); await new Promise(r => setTimeout(r, 2000));
    await Sandbox.remove(name);
    process.exit(ok ? 0 : 1);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}
test().catch(e => { console.error("FATAL:", e); process.exit(1); });
