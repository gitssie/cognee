import { Sandbox, NetworkPolicy } from "microsandbox";

const NAME = `sim-${Date.now()}`;
const PORT = 42052;
const PASS = "test123";

async function main() {
  try { const old = await Sandbox.get(NAME); await old.kill?.(); } catch {}

  // 1. Create sandbox — just keep it alive, no opencode in entrypoint
  console.log("1. Creating sandbox ...");
  const sb = await Sandbox.builder(NAME)
    .image("ghcr.io/anomalyco/opencode:latest")
    .cpus(2).memory(1024)
    .entrypoint(["/bin/sleep", "99999"])
    .env("OPENCODE_SERVER_USERNAME", "opencode")
    .env("OPENCODE_SERVER_PASSWORD", PASS)
    .env("OPENCODE_DISABLE_AUTOUPDATE", "true")
    .env("OPENCODE_DISABLE_MODELS_FETCH", "true")
    .env("HOME", "/root")
    .network((n: any) => n.port(PORT, 4096).policy(NetworkPolicy.allowAll()))
    .createDetached();
  console.log(`   name=${NAME} port=${PORT}`);

  // 2. Start opencode serve via sb.shell() in background
  console.log("2. Starting opencode serve via sb.shell() ...");
  // sb.shell() is blocking — we need to use sb.exec with nohup & pattern.
  // Actually, sb.shell() returns when the command exits.
  // For backgrounding, use sb.exec() to trigger it async.
  sb.shell("nohup opencode serve --hostname 0.0.0.0 --port 4096 --print-logs > /tmp/ol.log 2>&1 &").catch(() => {});
  // Small delay before this returns, but nohup & makes it background.

  // 3. Wait and check
  console.log("3. Waiting for health ...");
  const auth = Buffer.from(`opencode:${PASS}`).toString("base64");
  for (let i = 1; i <= 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/global/health`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const body = await res.json();
        console.log(`   attempt ${i}: HEALTHY — ${JSON.stringify(body)}`);
        break;
      }
    } catch (e: any) {
      if (i <= 3) console.log(`   attempt ${i}: ${e.message}`);
    }
    if (i === 30) console.log("   TIMEOUT — checking inside ...");
  }

  // 4. Inspect inside
  console.log("4. ps aux | grep opencode:");
  const ps = await sb.shell("ps aux | grep opencode");
  console.log(ps.stdout() || "(none)");

  console.log("5. netstat -tlnp:");
  const ns = await sb.shell("netstat -tlnp");
  console.log(ns.stdout());

  console.log("6. opencode log (last 20 lines):");
  const log = await sb.shell("tail -20 /tmp/ol.log 2>/dev/null || echo '(empty)'");
  console.log(log.stdout());

  console.log("7. Cleanup ...");
  await sb.kill?.();
  console.log("   Done.");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
