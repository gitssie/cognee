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
| opencode-router 在 `src/` 内 | 非 vendor/第三方依赖，是项目核心路由层 |
| workspace-init 是 router 的 capability | 目录初始化属于路由层，非 sandbox 基础设施 |
| 事件总线用 effect/PubSub | 镜像 opencode bus/ 模式：Context.Service + Layer + ManagedRuntime |
| provider.provisionFiles 抽象 | media 文件注入由 provider 决定策略 (sandbox → copyFile 到 VM mount) |
| sandbox 只管 VM 生命周期 | 不关心 workspace 内容、模板文件、目录策略 |

## Dependencies

| 包 | 用途 |
|----|------|
| `@opencode-ai/sdk` | OpenCode 客户端 SDK |
| `effect` | Effect-TS (PubSub, Layer, Stream, Ref) |
| `microsandbox` | VM 沙箱管理 |
| `commander` | CLI 入口 |
| `dotenv` | 环境变量加载 |
| `openclaw` (shim) | openclaw 插件兼容层 (本地 file: 依赖) |

## Development

```bash
bun install
bun run dev          # hot-reload 开发模式
bun run typecheck    # tsc --noEmit
bun run build        # tsc 编译
bun run router:dev   # 单独启动 opencode-router CLI
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_SANDBOX_ENABLED` | *(empty)* | `true` / `1` 启用 sandbox 模式 |
| `OPENCODE_SANDBOX_ROOT` | `<routerRoot>/sandboxes` | sandbox 数据根目录 |
| `OPENCODE_SANDBOX_PORT_START` | `42000` | 端口范围起始 |
| `OPENCODE_SANDBOX_PORT_END` | `45999` | 端口范围结束 |
| `OPENCODE_SANDBOX_IMAGE` | `ghcr.io/anomalyco/opencode:latest` | OpenCode OCI 镜像 |
| `OPENCODE_SANDBOX_CPUS` | `1` | 每 VM 的 CPU 核心数 |
| `OPENCODE_SANDBOX_MEMORY_MB` | `1024` | 每 VM 的内存 (MB) |
| `OPENCODE_SANDBOX_IDLE_TTL_MS` | `3600000` | 空闲超时 (ms) |
| `COGNEE_MCP_URL` | `http://localhost:8000/mcp/` | cognee MCP endpoint |
| `COGNEE_API_TOKEN` | *(empty)* | Bearer token |
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key |
| `OPENAI_API_KEY` | *(optional)* | OpenAI API key |
| `DEEPSEEK_API_KEY` | *(optional)* | DeepSeek API key |

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.2
- Linux host with `/dev/kvm` (sandbox 模式)
- `msb` / microsandbox 主机依赖
- cognee-code Python backend (port 8000) for MCP tools
