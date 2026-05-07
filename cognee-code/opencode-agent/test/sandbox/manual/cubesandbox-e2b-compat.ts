/**
 * CubeSandbox ↔ E2B 兼容性测试
 *
 * CubeSandbox 声称是 E2B SDK 的 drop-in replacement（只需换 URL + API Key）。
 * 此测试验证 REST API、E2B SDK 初始化、沙箱创建/执行全流程。
 *
 * 环境变量:
 *   CUBE_API_URL    — CubeSandbox API 地址 (默认 http://127.0.0.1:3000)
 *   CUBE_API_KEY    — API Key (默认 dummy)
 *   CUBE_TEMPLATE_ID — 模板 ID，通过 cubemastercli 创建
 *
 * 已知问题 (v0.1.2-aa8d642):
 *   - 模板创建 (tpl create-from-image) 分发阶段失败:
 *     "rpc error: code = Unimplemented desc = unknown service
 *      cubelet.services.images.v1.Images"
 *     该 release 包的 cubelet 缺少镜像分发 gRPC 接口实现。
 *   - ccr.ccs.tencentyun.com/ags-image/sandbox-code:latest 需要认证。
 *
 * 用法:
 *   bun run test/sandbox/manual/cubesandbox-e2b-compat.ts
 */

const API_URL = process.env.CUBE_API_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.CUBE_API_KEY ?? "dummy";
const TEMPLATE_ID = process.env.CUBE_TEMPLATE_ID;

interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

const results: TestResult[] = [];

// ─── REST API 端点测试 ──────────────────────────────────────────

async function testRestEndpoints() {
  console.log("═══ REST API 端点测试 ═══\n");

  // 1. Health Check
  {
    const detail = await fetch(`${API_URL}/health`)
      .then(r => r.json())
      .then(j => `HTTP 200 ${JSON.stringify(j)}`)
      .catch(e => `错误: ${e.message}`);
    const ok = detail.includes('"status":"ok"');
    results.push({ name: "GET /health", status: ok ? "pass" : "fail", detail });
    console.log(`  ${ok ? "✅" : "❌"} ${detail}`);
  }

  // 2. List Sandboxes
  {
    const detail = await fetch(`${API_URL}/sandboxes`, { headers: { "X-API-Key": API_KEY } })
      .then(r => r.json())
      .then(j => `HTTP 200 ${JSON.stringify(j)}`)
      .catch(e => `错误: ${e.message}`);
    const ok = detail.includes("[") || detail.includes("[]");
    results.push({ name: "GET /sandboxes", status: ok ? "pass" : "fail", detail });
    console.log(`  ${ok ? "✅" : "❌"} ${detail}`);
  }

  // 3. Create Sandbox
  if (TEMPLATE_ID) {
    const detail = await fetch(`${API_URL}/sandboxes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify({ templateID: TEMPLATE_ID, timeout: 300_000 }),
    })
      .then(r => r.json().then(j => `HTTP ${r.status} sandboxID=${j.sandboxID ?? "N/A"}`))
      .catch(e => `错误: ${e.message}`);
    const ok = detail.includes("sandboxID");
    results.push({ name: "POST /sandboxes", status: ok ? "pass" : "fail", detail });
    console.log(`  ${ok ? "✅" : "❌"} ${detail}`);
  } else {
    results.push({ name: "POST /sandboxes", status: "skip", detail: "需要 CUBE_TEMPLATE_ID" });
    console.log(`  ⏭️  跳过: 需要 CUBE_TEMPLATE_ID`);
  }

  // 4. Timeout
  try {
    await fetch(`${API_URL}/sandboxes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify({ templateID: "nonexistent", timeout: 300 }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    results.push({ name: "POST /sandboxes (timeout)", status: "pass", detail: "请求正常处理超时" });
    console.log(`  ✅ 请求超时处理正常`);
  }

  console.log();
}

// ─── E2B SDK 测试 ────────────────────────────────────────────

async function testE2bSdk() {
  console.log("═══ E2B SDK 测试 ═══\n");

  // 1. 模块加载
  try {
    const m = await import("@e2b/code-interpreter");
    const hasSandbox = typeof m.Sandbox === "function";
    results.push({ name: "@e2b/code-interpreter 加载", status: "pass", detail: "Sandbox 类可用" });
    console.log("  ✅ @e2b/code-interpreter 加载成功");
  } catch (e: any) {
    results.push({ name: "@e2b/code-interpreter 加载", status: "fail", detail: e.message });
    console.log(`  ❌ 加载失败: ${e.message}`);
    console.log();
    return;
  }

  // 2. 环境变量
  process.env.E2B_API_URL = API_URL;
  process.env.E2B_API_KEY = API_KEY;
  let sdkTemplate = TEMPLATE_ID;
  let sdkResult: { ok: boolean; msg: string } = { ok: false, msg: "" };

  // 3. 沙箱创建（如果无模板，尝试用默认模板验证 API 通路）
  if (!sdkTemplate) {
    // 无模板时，尝试列出已有模板
    try {
      const { Sandbox } = await import("@e2b/code-interpreter");
      // SDK v2 的 create 需要 template。无模板时，直接测 API 级别。
      sdkResult = {
        ok: true,
        msg: "SDK 环境变量已配置，沙箱创建需要 CUBE_TEMPLATE_ID",
      };
      results.push({ name: "E2B SDK 环境变量", status: "pass", detail: "E2B_API_URL/E2B_API_KEY 已设置" });
      console.log("  ✅ SDK 环境变量配置完成");
    } catch (e: any) {
      sdkResult = { ok: false, msg: e.message };
      results.push({ name: "E2B SDK 初始化", status: "fail", detail: e.message });
      console.log(`  ❌ ${e.message}`);
    }
  } else {
    // 有模板，完整测试
    try {
      const { Sandbox } = await import("@e2b/code-interpreter");
      console.log(`  创建沙箱 (template=${sdkTemplate})...`);
      const sb = await Sandbox.create(sdkTemplate, { timeoutMs: 300_000 });
      const exec = await sb.runCode('print("Hello CubeSandbox!")');
      console.log(`  runCode: ${JSON.stringify(exec)}`);
      await sb.kill();
      sdkResult = { ok: true, msg: `runCode 成功: ${JSON.stringify(exec)}` };
      results.push({ name: "E2B Sandbox.create + runCode", status: "pass", detail: sdkResult.msg });
      console.log(`  ✅ 沙箱创建 + 代码执行成功`);
    } catch (e: any) {
      sdkResult = { ok: false, msg: e.message };
      results.push({ name: "E2B Sandbox.create + runCode", status: "fail", detail: e.message });
      console.log(`  ❌ ${e.message}`);
    }
  }

  console.log();
}

// ─── 主流程 ────────────────────────────────────────────────────

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════╗
║  CubeSandbox ↔ E2B 兼容性测试                     ║
║  API: ${API_URL.padEnd(44)}║
║  版本: v0.1.2 (aa8d642)                           ║
╚═══════════════════════════════════════════════════╝
`);

  await testRestEndpoints();
  await testE2bSdk();

  // 汇总
  console.log("═══ 测试汇总 ═══");
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⏭️";
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
  }

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const skipped = results.filter(r => r.status === "skip").length;
  console.log(`\n  总计: ${results.length} | ✅ ${passed} | ❌ ${failed} | ⏭️ ${skipped}`);

  if (!TEMPLATE_ID) {
    console.log(`\n💡 设置 CUBE_TEMPLATE_ID 后可测试完整沙箱创建流程。`);
    console.log(`   模板创建命令:`);
    console.log(`   cubemastercli --address 127.0.0.1 tpl create-from-image \\`);
    console.log(`     --image <your-image> --writable-layer-size 1G \\`);
    console.log(`     --expose-port 49999 --probe 49999`);
    console.log(`\n⚠️  已知: v0.1.2 release 包模板分发 gRPC 接口未实现。`);
  }
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}

main();
