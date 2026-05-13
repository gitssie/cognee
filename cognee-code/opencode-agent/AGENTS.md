# opencode-agent

Bun project that provides an OpenCode Agent server with per-user microsandbox isolation. Integrates the opencode-router (channel bridging) and cognee MCP tools (persistent knowledge graph).

## Architecture

```
src/
├── opencode-router/           ← 核心路由层 (channel 接入 + workspace 管理)
│   ├── bridge.ts              ← 消息路由入口，编排 adapter / client / session
│   ├── client-provider.ts     ← OpenCodeClientProvider 接口 (classic / sandbox)
│   ├── workspace-init.ts      ← workspace 初始化 capability (effect Layer)
│   ├── workspace-template/    ← 模板资源 (AGENTS.txt, TOOLS.txt, MEMORY.txt)
│   ├── media-store.ts         ← 媒体文件存储 (download / save / relocate)
│   ├── directory.ts           ← per-peer workspace 目录初始化
│   ├── shims/openclaw/        ← openclaw 插件 SDK shim
│   └── ...                    ← config, db, delivery, slack, telegram 等
│
├── sandbox/                   ← 部署模式：microsandbox per-user VM 生命周期
│   ├── manager.ts             ← VM 创建/销毁/重启，发布 workspace.init 事件
│   ├── sandbox-provider.ts    ← 实现 OpenCodeClientProvider (sandbox 模式)
│   ├── shared-provider.ts     ← 实现 OpenCodeClientProvider (classic 模式)
│   ├── workspace.ts           ← workspace/data 路径解析
│   └── types.ts               ← SandboxRuntime, SandboxManagerConfig 等类型
│
├── events.ts                  ← EventBus (effect/PubSub + Context.Service + Layer)
├── builder.ts                 ← ServiceBuilder: 组装 router + sandbox + effects
├── config.ts                  ← 环境变量 / 配置文件解析
├── router.ts                  ← opencode-router 启动适配层
├── plugin/                    ← OpenCode 插件集成 (cognee MCP hooks)
└── index.ts                   ← 入口

Effect-TS layers (composed in builder.ts):
  EventBusLive          — PubSub-backed event bus
  WorkspaceInitLive     — 订阅 workspace.init，seed 模板文件到 workspace
```

## Key design decisions

| 决策 | 说明 |
|------|------|
| 唯一配置入口 `opencode-router.json` | sandbox/agent/permission 全在这里，代码零 hardcode |
| `workspace.ts` 直通 `opencode` 章节 | `buildOpencodeAgentJson()` 读 JSON → 原样写入沙箱 `opencode.json` |
| `accounts[].directory` 必须配 | 没有就报错，不走 `opencodeDirectory` 兜底 |
| sandbox 网络不配 DNS | microsandbox 读宿主 `/etc/resolv.conf`，最快 |
| opencode-router 在 `src/` 内 | 非 vendor/第三方依赖，是项目核心路由层 |
| sandbox 只管 VM 生命周期 | 不关心 workspace 内容、模板文件、目录策略 |
| host-mount 挂载 `/home/user` | E2B/Cube sandbox 将宿主目录挂载到 `/home/user`，opencode config/data 目录随之持久化 |
| CubeAPI `envs` 不生效 | 当前版本 `Sandbox.create` 的 `envs` 不传入容器，auth/config 通过写文件注入 |

## host-mount 挂载策略

**挂载点**: 宿主目录 → `/home/user`（沙箱内）

```
宿主路径 (hostMountWorkspaceRoot/safePeer/)
├── workspace/                    ← E2B_WORKSPACE (/home/user/workspace)
├── .config/opencode/
│   └── opencode.json             ← 每次 ensure() 时由 agent 写入
└── .local/share/opencode/
    └── auth.json                 ← 每次 ensure() 时由 agent 写入（含 API keys）
```

**文件写入时序**（每次 `ensure()` 调用）：
1. `mkdir -p /home/user/workspace .config/opencode .local/share/opencode`
2. 写 `auth.json`（来自 secrets 配置，含 API keys）
3. 写 `opencode.json`（来自 `opencode-router.json` 的 `opencode` 章节）
4. 写 `AGENTS.md` / `TOOLS.md` / `MEMORY.md`（workspace 模板）
5. 等待 opencode HTTP 健康检查通过

**持久化效果**：sandbox 重启后，宿主目录保留上次会话数据（opencode 状态、历史等），auth/config 在每次启动时重写确保最新。

## 配置文件 `opencode-router.json`

唯一配置文件，结构：

```json
{
  "router": { "rootDir": ".opencode-router", ... },
  "sandbox": {
    "apiUrl": "http://172.16.17.231:3000",
    "apiKey": "dummy",
    "template": "opencode-tools",
    "timeoutMs": 300000,
    "hostMount": {
      "enabled": true,
      "workspaceRoot": "workspaces"
    }
  },
  "opencode": { "$schema": "...", "permission": {...}, "agent": { "cognee-coder": { ... } } },
  "channels": { "wecom": { "accounts": [{ "id": "default", "directory": "per-peer://workspaces", ... }] } },
  "healthPort": 3005
}
```

- `opencode` 章节：每次 ensure() 时写入沙箱 `/home/user/.config/opencode/opencode.json`
- `sandbox.hostMount.workspaceRoot`：相对于 `router.rootDir` 的路径，per-user 目录为 `workspaceRoot/safePeer/`
- 该目录整体挂载为沙箱内的 `/home/user`
- `channels`：wecom 账号配置，`directory` 必填

## 远端环境要求

- 宿主机有 `/dev/kvm`（microsandbox 需要）
- 远端目录 `/home/opencode-agent/`：
  - `.env.local` — 含 `DEEPSEEK_API_KEY=sk-xxx` 等 API keys
  - `opencode-router.json` — 配置文件
  - `.opencode-router/workspaces/` — per-user host-mount 目录（自动创建）
    - `<safePeer>/` — 单用户目录，挂载为沙箱内 `/home/user`
      - `workspace/` — opencode 工作区（`E2B_WORKSPACE`）
      - `.config/opencode/opencode.json` — 由 agent 写入
      - `.local/share/opencode/auth.json` — 由 agent 写入
- Docker 容器 `--network host --privileged --device /dev/kvm`

## 构建 & 部署

```bash
# 1. typecheck + test
bun run typecheck
bun test test/sandbox/unit/

# 2. 编译
bun run build

# 3. 构建 Docker 镜像（无缓存）
rtk docker build --no-cache -f Dockerfile.sandbox -t opencode-agent:sandbox .

# 4. 导出 & 上传远端
docker save opencode-agent:sandbox | gzip > /tmp/opencode-agent-sandbox.tar.gz
scp /tmp/opencode-agent-sandbox.tar.gz root@<REMOTE_IP>:/tmp/

# 5. 上传配置（每次改 opencode-router.json 后）
scp opencode-router.json root@<REMOTE_IP>:/home/opencode-agent/opencode-router.json

# 6. 远端加载镜像 & 重启
ssh root@<REMOTE_IP> '
docker load < /tmp/opencode-agent-sandbox.tar.gz
docker rm -f opencode-agent || true
docker run -d --name opencode-agent --restart unless-stopped \
  --network host --privileged --device /dev/kvm \
  --env-file /home/opencode-agent/.env.local \
  -e MSB_HOME=/home/opencode-agent \
  -e OPENCODE_ROUTER_CONFIG_PATH=/home/opencode-agent/opencode-router.json \
  -v /root/.microsandbox:/root/.microsandbox \
  -v /home/opencode-agent:/home/opencode-agent \
  -v /opt/glibc-2.41:/opt/glibc-2.41:ro \
  -v /opt/glibc-2.39:/opt/glibc-2.39:ro \
  opencode-agent:sandbox
'

# 7. 验证健康
curl http://<REMOTE_IP>:3005/health
```

## 远端排查

```bash
# 看日志
ssh root@<REMOTE_IP> 'docker logs --tail 100 opencode-agent'

# 查沙箱写入的 opencode.json（host-mount 路径）
ssh root@<REMOTE_IP> \
  'cat /home/opencode-agent/.opencode-router/workspaces/<safePeer>/.config/opencode/opencode.json'

# 查沙箱写入的 auth.json
ssh root@<REMOTE_IP> \
  'cat /home/opencode-agent/.opencode-router/workspaces/<safePeer>/.local/share/opencode/auth.json'

# 查 workspace 目录
ssh root@<REMOTE_IP> \
  'ls /home/opencode-agent/.opencode-router/workspaces/<safePeer>/workspace/'

# 查 opencode 日志（在沙箱 host-mount 目录内）
ssh root@<REMOTE_IP> \
  'ls /home/opencode-agent/.opencode-router/workspaces/<safePeer>/.local/share/opencode/log/'
```

## Development

```bash
bun install
bun run dev          # hot-reload 开发模式
bun run typecheck    # tsc --noEmit
bun run build        # tsc 编译
bun test             # 全部测试
bun test test/sandbox/unit/  # 单元测试
```

## Dependencies

| 包 | 用途 |
|----|------|
| `@opencode-ai/sdk` | OpenCode 客户端 SDK |
| `effect` | Effect-TS (PubSub, Layer, Stream, Ref) |
| `microsandbox` | VM 沙箱管理 |
| `commander` | CLI 入口 |
| `dotenv` | 环境变量加载 |
| `openclaw` (shim) | openclaw 插件兼容层 (本地 file: 依赖) |

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- Linux host with `/dev/kvm`
- Docker
- `sshpass` (for remote deploy)
