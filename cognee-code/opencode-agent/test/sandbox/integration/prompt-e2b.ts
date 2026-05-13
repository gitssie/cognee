/**
 * E2B Sandbox + bridge-message-pipeline 端到端集成测试
 *
 * 目标：
 *   验证完整消息处理链路：
 *   inbound message
 *     → bridge-message-pipeline.handleInbound
 *       → BridgeSessionRuntime.ensureSession (通过 SandboxClientProvider → E2BSandboxManager)
 *         → promptStream (BridgeMessageStream via SSEListener)
 *           → sendText (回调捕获回复)
 *
 * 真正集成了（不复制/模拟生产代码）：
 *   - createBridgeMessagePipeline   (src/opencode-router/bridge-message-pipeline.ts)
 *   - BridgeSessionRuntime          (src/opencode-router/bridge-session.ts)
 *   - createBridgeMessageStream     (src/opencode-router/bridge-message-stream.ts)
 *   - createSandboxClientProvider   (src/sandbox/sandbox-provider.ts)
 *   - E2BSandboxManager             (src/sandbox/e2b-manager.ts)
 *
 * 用法:
 *   bun test/sandbox/integration/prompt-e2b.ts
 *
 * 环境变量（可选，默认读 opencode-router.json）:
 *   CUBE_API_URL    — 默认 http://172.16.17.231:3000
 *   DEEPSEEK_API_KEY
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";

import { E2BSandboxManager } from "../../../src/sandbox/e2b-manager.js";
import { createSandboxClientProvider } from "../../../src/sandbox/sandbox-provider.js";
import { BridgeSessionRuntime } from "../../../src/opencode-router/bridge-session.js";
import { createBridgeMessagePipeline } from "../../../src/opencode-router/bridge-message-pipeline.js";
import { createBridgeMessageStream } from "../../../src/opencode-router/bridge-message-stream.js";
import { BridgeStore } from "../../../src/opencode-router/db.js";
import { loadConfig } from "../../../src/opencode-router/config.js";
import type { PipelineInboundMessage } from "../../../src/opencode-router/bridge-message-pipeline.js";

// ── 配置 ───────────────────────────────────────────────────────────────────────
const API_URL = process.env.CUBE_API_URL ?? "http://172.16.17.231:3000";
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY ?? "";

// Point config to local opencode-router.json
if (!process.env.OPENCODE_ROUTER_CONFIG_PATH) {
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const __dir = dirname(fileURLToPath(import.meta.url));
  process.env.OPENCODE_ROUTER_CONFIG_PATH = join(__dir, "../../../opencode-router.json");
}
console.log("[config] OPENCODE_ROUTER_CONFIG_PATH =", process.env.OPENCODE_ROUTER_CONFIG_PATH);

// workspace root — 与 opencode-router.json 的 sandbox.hostMount.workspaceRoot 保持一致
// 绝对路径：<project-root>/.opencode-router/workspaces
const __projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKSPACE_ROOT = path.join(__projectRoot, ".opencode-router", "workspaces");

// 禁用 TLS 验证（cube.app 自签名）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const noProxy = process.env.no_proxy ?? "";
process.env.no_proxy = [noProxy, ".cube.app", "cube.app", "*.cube.app", "172.16.17.231"]
  .filter(Boolean)
  .join(",");
process.env.NO_PROXY = process.env.no_proxy;

const routerConfig = loadConfig(process.env, { requireOpencode: false });

// ── 测试常量 ──────────────────────────────────────────────────────────────────
const CHANNEL = "test" as const;
const IDENTITY_ID = "yinyousong";
// peerKey 必须与服务器上已建好的目录名一致：workspaces/yinyousong
// identity = "test:yinyousong:yinyousong" → peerKey="yinyousong" → safePeer="yinyousong"
const PEER_ID = "yinyousong";
const WORKSPACE_DIR = "/home/user/workspace";

// ── 工具函数 ──────────────────────────────────────────────────────────────────
function log(msg: string, data?: unknown) {
  const prefix = `[${new Date().toISOString().slice(11, 23)}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${msg}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  log("=== E2B + bridge-message-pipeline 端到端集成测试 ===");
  log("Config", { API_URL, IDENTITY_ID, WORKSPACE_DIR, hasDeepseekKey: !!DEEPSEEK_KEY });

  const logger = pino({ level: "debug" });

  // 1. 组装真实的生产组件（与 bridge.ts 中相同的方式）
  log("Step 1: 组装生产组件 (manager / provider / stream / sessionRuntime) ...");

  const manager = new E2BSandboxManager({
    apiKey: "dummy",
    apiUrl: API_URL,
    template: "opencode-tools",
    timeoutMs: 300_000,
    idleTtlMs: 3_600_000,
    maxRuntimeMs: 21_600_000,
    cleanupIntervalMs: 60_000,
    opencodePort: 4096,
    hostMountEnabled: true,
    hostMountWorkspaceRoot: WORKSPACE_ROOT,
    secrets: DEEPSEEK_KEY
      ? [{ envName: "DEEPSEEK_API_KEY", value: DEEPSEEK_KEY, allowHosts: [] }]
      : [],
    config: routerConfig,
    logger,
  });

  const provider = createSandboxClientProvider(manager, logger);

  const stream = createBridgeMessageStream();

  const dbPath = path.join(os.tmpdir(), `bridge-integration-${Date.now()}.db`);
  const store = new BridgeStore(dbPath);

  const sessionRuntime = new BridgeSessionRuntime({
    logger,
    config: routerConfig,
    store,
    provider,
    getChannelLabel: (ch) => ch,
    formatPeer: (_ch, peerId) => peerId,
  });

  // 捕获发送给用户的回复
  const replies: Array<{ peerId: string; text: string }> = [];

  const pipeline = createBridgeMessagePipeline({
    logger,
    config: routerConfig,
    store,
    provider,
    mediaStore: {
      relocateInboundFiles: async () => new Map(),
      saveFile: async () => "",
    } as any,
    channels: {
      getPairingHandler: () => null,
      handlePairing: async () => "handled",
      shouldAutoBind: () => false,
    } as any,
    stream,
    pluginIdentities: new Map(),
    directoryPolicy: undefined,
    hasAdapter: () => true,
    recordInboundActivity: () => {},
    resolveIdentityDirectory: () => WORKSPACE_DIR,
    isDangerousRootDirectory: () => false,
    resolveScopedDirectory: (dir) => ({ ok: true, directory: dir }),
    normalizeDirectory: (dir) => dir,
    handleCommand: async () => false,
    sendText: async (_ch, _id, peerId, text) => {
      log(`📨 sendText → peerId=${peerId}: "${text.slice(0, 200)}"`);
      replies.push({ peerId, text });
    },
    sessionRuntime,
  });

  log("Step 1: 组装完成");

  // 2. 先直接验证 sandbox 连通性和 promptAsync
  log("Step 2: 直接验证 sandbox 连通性 ...");
  // identity 格式 channel:identityId:peerKey → peerKey=yinyousong → safePeer=yinyousong
  // → workspaceHostPath = WORKSPACE_ROOT/yinyousong  (服务器上已建好)
  const identity = `${CHANNEL}:${IDENTITY_ID}:${PEER_ID}`;
  let conn: any;
  try {
    conn = await manager.ensureRuntime(identity);
    log("sandbox 连接成功", { sandboxId: conn.sandboxId, baseUrl: conn.baseUrl, directory: conn.directory });
  } catch (err) {
    log("❌ ensureRuntime 失败", { error: String(err), stack: err instanceof Error ? err.stack : undefined });
    process.exitCode = 1;
    return;
  }

  // health check
  try {
    const health = await conn.client.global.health();
    log("global.health()", JSON.stringify(health));
  } catch (err) {
    log("⚠️  global.health() 失败", String(err));
  }

  // session.create
  let sessionID: string;
  try {
    const sess = await conn.client.session.create({ title: "integration-test" });
    sessionID = (sess as any).data?.id ?? (sess as any).id;
    log(`session.create 成功: ${sessionID}`);
  } catch (err) {
    log("❌ session.create 失败", { error: String(err), cause: (err as any)?.cause });
    process.exitCode = 1;
    return;
  }

  // session.promptAsync
  try {
    log("调用 session.promptAsync ...");
    const r = await conn.client.session.promptAsync({
      sessionID,
      parts: [{ type: "text" as const, text: "Say exactly: HELLO_WORLD" }],
    });
    log("session.promptAsync 返回", JSON.stringify(r));
  } catch (err) {
    log("❌ session.promptAsync 失败", {
      error: String(err),
      cause: JSON.stringify((err as any)?.cause, null, 2),
      full: JSON.stringify(err, Object.getOwnPropertyNames(err as object), 2),
    });
    process.exitCode = 1;
    return;
  }

  // 3. 发送真实 inbound 消息，走 handleInbound 完整链路
  log("Step 3: 发送 inbound 消息 (handleInbound) ...");
  const inbound: PipelineInboundMessage = {
    channel: CHANNEL,
    identityId: IDENTITY_ID,
    peerId: PEER_ID,
    text: "Say exactly: HELLO_WORLD",
    raw: {},
  };

  try {
    await pipeline.handleInbound(inbound);
  } catch (err) {
    log("❌ handleInbound 抛出异常", { error: String(err), stack: err instanceof Error ? err.stack : undefined });
    process.exitCode = 1;
    return;
  }

  log("Step 3: handleInbound 已入队，等待处理完成 (最多 5 分钟) ...");
  const deadline = Date.now() + 300_000;
  while (replies.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  // 4. 断言
  log("Step 4: 验证结果 ...");
  if (replies.length === 0) {
    log("❌ 超时：未收到任何 sendText 回复");
    process.exitCode = 1;
    return;
  }

  const replyText = replies.map((r) => r.text).join("");
  log(`✅ 收到 ${replies.length} 条回复，总长度=${replyText.length}`);
  log(`✅ 回复预览: "${replyText.slice(0, 300)}"`);

  if (!replyText.trim()) {
    log("❌ 回复内容为空");
    process.exitCode = 1;
    return;
  }

  log("✅ 集成测试通过");
  await manager.shutdown().catch(() => {});
}

main();
