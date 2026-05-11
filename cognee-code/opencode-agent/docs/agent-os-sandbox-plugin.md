# agent-os Sandbox Plugin 设计文档

## 概述

新增一个独立的 OpenCode Plugin，将 **agent-os**（`@rivet-dev/agent-os`）作为进程内隔离执行环境，
为 OpenCode session 提供沙箱化的 shell 执行和文件系统操作能力。

**关键特性：**
- **进程内运行**：agent-os 基于 V8 isolate + WebAssembly，无需启动 VM 或容器，冷启动约 6ms。
- **host 目录直接挂载**：通过 `createHostDirBackend` 将 OpenCode session 的工作目录 bind mount 到沙箱 `/workspace`，无需 git 同步。
- **独立于 cognee plugin**：不替换、不依赖现有知识注入 plugin，并行挂载。

---

## agent-os 核心 API

基于 `@rivet-dev/agent-os` + `@rivet-dev/agent-os-common`：

```typescript
import { AgentOs } from "@rivet-dev/agent-os"
import common from "@rivet-dev/agent-os-common"
import { createHostDirBackend } from "@rivet-dev/agent-os-core"

// 创建 VM（进程内，~6ms）
const vm = await AgentOs.create({
  software: [common],
  mounts: [
    {
      path: "/workspace",
      driver: createHostDirBackend({ hostPath: "/path/to/project" }),
      readOnly: false,
    },
  ],
})

// 执行命令（one-shot）
const result = await vm.exec("ls /workspace")
// result: { stdout, stderr, exitCode }

// 文件操作
await vm.writeFile("/workspace/hello.ts", "console.log('hi')")
const content = await vm.readFile("/workspace/hello.ts")  // Uint8Array

// 释放 VM
await vm.dispose()
```

---

## Plugin 集成点（OpenCode 侧）

| OpenCode 机制 | 用法 |
|--------------|------|
| `Plugin` 工厂函数 | `AgentOsSandboxPlugin = async (input) => Hooks` |
| `PluginInput.directory` | host 工作目录，mount 到沙箱 `/workspace` |
| `Hooks.tool` | 注册 `sandbox_exec`、`sandbox_read`、`sandbox_write`、`sandbox_status` |
| `ToolDefinition.args` (Zod) | 参数 schema，由 `registry.ts` 的 `fromPlugin()` 包装成 Effect Schema |
| `ToolContext.ask()` | 执行前申请权限，与内置 shell 权限体系一致 |
| `Hooks.event` | 监听 `session.idle` / `session.deleted`，触发 `vm.dispose()` |

---

## 目录结构

```
src/plugin/
├── index.ts                        ← 现有 cognee plugin（不变）
└── agent-plugin/                   ← 新增模块（本文档描述范围）
    ├── index.ts                    ← AgentOsSandboxPlugin 工厂函数
    ├── sandbox-manager.ts          ← per-session VM 生命周期（创建/复用/释放）
    ├── tools/
    │   ├── exec.ts                 ← sandbox_exec 工具
    │   ├── read.ts                 ← sandbox_read 工具
    │   ├── write.ts                ← sandbox_write 工具
    │   └── status.ts               ← sandbox_status 工具
    ├── hooks/
    │   └── event.ts                ← event hook：session 结束时 dispose VM
    └── types.ts                    ← SandboxVm、SandboxManagerConfig 类型
```

---

## 实现设计

### Plugin 入口

```typescript
// src/plugin/agent-plugin/index.ts
import type { Plugin } from "@opencode-ai/plugin"
import { createSandboxManager } from "./sandbox-manager"
import { execTool } from "./tools/exec"
import { readTool } from "./tools/read"
import { writeTool } from "./tools/write"
import { statusTool } from "./tools/status"
import { createEventHook } from "./hooks/event"

export const AgentOsSandboxPlugin: Plugin = async (input) => {
  const manager = await createSandboxManager({
    hostDirectory: input.directory,
    projectId: input.project.id,
  })

  return {
    tool: {
      sandbox_exec:   execTool(manager),
      sandbox_read:   readTool(manager),
      sandbox_write:  writeTool(manager),
      sandbox_status: statusTool(manager),
    },
    event: createEventHook(manager),
  }
}
```

### SandboxManager（VM 生命周期）

```typescript
// src/plugin/agent-plugin/sandbox-manager.ts
import { AgentOs } from "@rivet-dev/agent-os"
import common from "@rivet-dev/agent-os-common"
import { createHostDirBackend } from "@rivet-dev/agent-os-core"

export type SandboxManagerConfig = {
  hostDirectory: string   // OpenCode session 工作目录
  projectId: string
}

export interface SandboxManager {
  ensureVm(): Promise<AgentOs>           // 按需创建，已存在则复用
  getStatus(): Promise<SandboxStatus>
  release(): Promise<void>               // dispose VM
}

export type SandboxStatus = {
  projectId: string
  hostDirectory: string
  sandboxWorkdir: "/workspace"
  running: boolean
}

export async function createSandboxManager(config: SandboxManagerConfig): Promise<SandboxManager> {
  let vm: AgentOs | null = null

  return {
    async ensureVm() {
      if (vm) return vm
      vm = await AgentOs.create({
        software: [common],
        mounts: [
          {
            path: "/workspace",
            driver: createHostDirBackend({ hostPath: config.hostDirectory }),
            readOnly: false,
          },
        ],
      })
      return vm
    },

    async getStatus() {
      return {
        projectId: config.projectId,
        hostDirectory: config.hostDirectory,
        sandboxWorkdir: "/workspace",
        running: vm !== null,
      }
    },

    async release() {
      if (vm) {
        await vm.dispose()
        vm = null
      }
    },
  }
}
```

### sandbox_exec 工具

```typescript
// src/plugin/agent-plugin/tools/exec.ts
import type { ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import type { SandboxManager } from "../sandbox-manager"

export function execTool(manager: SandboxManager): ToolDefinition {
  return {
    description: `Execute a shell command inside the isolated agent-os sandbox.
The project directory is mounted at /workspace inside the sandbox.
Use this for isolated command execution with V8+WASM security boundaries.`,
    args: {
      command: z.string().describe("Shell command to execute inside the sandbox"),
      timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    },
    execute: async (args, ctx) => {
      await ctx.ask({
        permission: "execute",
        patterns: [],
        always: [],
        metadata: { command: args.command },
      })

      const vm = await manager.ensureVm()
      const result = await vm.exec(args.command, { timeout: args.timeout ?? 30_000 })

      const parts: string[] = []
      if (result.stdout) parts.push(`<stdout>\n${result.stdout}\n</stdout>`)
      if (result.stderr) parts.push(`<stderr>\n${result.stderr}\n</stderr>`)
      parts.push(`<exit_code>${result.exitCode}</exit_code>`)

      return {
        output: parts.join("\n"),
        metadata: { exitCode: result.exitCode },
      }
    },
  }
}
```

### sandbox_read 工具

```typescript
// src/plugin/agent-plugin/tools/read.ts
import type { ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import type { SandboxManager } from "../sandbox-manager"

export function readTool(manager: SandboxManager): ToolDefinition {
  return {
    description: "Read a file from the agent-os sandbox (path relative to /workspace or absolute).",
    args: {
      path: z.string().describe("File path inside the sandbox (e.g. /workspace/src/main.ts)"),
    },
    execute: async (args, ctx) => {
      await ctx.ask({
        permission: "read",
        patterns: [args.path],
        always: [],
        metadata: {},
      })

      const vm = await manager.ensureVm()
      const bytes = await vm.readFile(args.path)
      const content = new TextDecoder().decode(bytes)

      return {
        output: content,
        metadata: { path: args.path, size: bytes.length },
      }
    },
  }
}
```

### sandbox_write 工具

```typescript
// src/plugin/agent-plugin/tools/write.ts
import type { ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import type { SandboxManager } from "../sandbox-manager"

export function writeTool(manager: SandboxManager): ToolDefinition {
  return {
    description: "Write a file inside the agent-os sandbox (changes are reflected on the host via bind mount).",
    args: {
      path: z.string().describe("File path inside the sandbox (e.g. /workspace/src/main.ts)"),
      content: z.string().describe("File content to write"),
    },
    execute: async (args, ctx) => {
      await ctx.ask({
        permission: "edit",
        patterns: [args.path],
        always: [],
        metadata: { path: args.path },
      })

      const vm = await manager.ensureVm()
      await vm.writeFile(args.path, args.content)

      return {
        output: `Wrote ${args.path} successfully.`,
        metadata: { path: args.path },
      }
    },
  }
}
```

### sandbox_status 工具

```typescript
// src/plugin/agent-plugin/tools/status.ts
import type { ToolDefinition } from "@opencode-ai/plugin"
import z from "zod"
import type { SandboxManager } from "../sandbox-manager"

export function statusTool(manager: SandboxManager): ToolDefinition {
  return {
    description: "Get the current agent-os sandbox status for this session.",
    args: {},
    execute: async (_args, _ctx) => {
      const status = await manager.getStatus()
      return {
        output: JSON.stringify(status, null, 2),
        metadata: status,
      }
    },
  }
}
```

### event hook（session 结束时释放 VM）

```typescript
// src/plugin/agent-plugin/hooks/event.ts
import type { SandboxManager } from "../sandbox-manager"

export function createEventHook(manager: SandboxManager) {
  return async (event: { type: string }) => {
    if (event.type === "session.idle" || event.type === "session.deleted") {
      await manager.release()
    }
  }
}
```

---

## 沙箱内可用命令

通过 `@rivet-dev/agent-os-common` meta-package，沙箱内置以下 WASM 命令：

| 命令集 | 含义 |
|--------|------|
| coreutils | sh, cat, ls, cp, mv, rm, mkdir 等 80+ 命令 |
| sed | 流编辑 |
| grep / egrep / fgrep | 模式匹配 |
| gawk | awk 文本处理 |
| findutils | find, xargs |
| diffutils | diff |
| tar | 归档 |
| gzip | 压缩 |

如需 ripgrep、jq、curl 等，单独安装对应包并加入 `software` 数组。

---

## 生命周期规则

| 时机 | 操作 |
|------|------|
| 首次调用任意沙箱工具 | `ensureVm()` 按需创建，冷启动 ~6ms |
| 同一 session 后续调用 | 直接复用已有 VM（`ensureVm()` 幂等） |
| `event` 收到 `session.idle` | `manager.release()` → `vm.dispose()` |
| `event` 收到 `session.deleted` | 同上 |
| 进程退出 | VM 随进程销毁（无需额外清理） |

---

## 文件系统语义

| 路径 | 说明 |
|------|------|
| `/workspace` | host `input.directory` 的 bind mount，读写双向同步 |
| 沙箱内其他路径 | agent-os 内置 POSIX 虚拟 FS，进程销毁后丢失 |

写入 `/workspace/*` 的任何文件都会直接出现在 host 的 `input.directory` 下，无需手动同步。

---

## Plugin 注册

在 `opencode-router.json` 的 `opencode.plugins` 中增加：

```json
{
  "opencode": {
    "plugins": [
      "<path-to>/build/plugin/agent-plugin/index.js"
    ]
  }
}
```

或在 `opencode-agent` 启动时通过代码注册（视 OpenCode plugin loader 支持的方式）。

---

## 风险与边界

| 风险 | 说明 | 缓解措施 |
|------|------|---------|
| agent-os OpenCode 支持标注 "Coming Soon" | 官方 `@rivet-dev/agent-os-opencode` 包尚未发布 | 本 plugin 作为 **OpenCode Plugin**（JS plugin 层），不依赖 agent-os 的 OpenCode agent 能力；只用 agent-os VM 的 exec/readFile/writeFile API |
| V8 isolate 对原生二进制的限制 | 沙箱内只能运行 WASM 编译的命令，无法执行任意 host native binary | 对编码类任务（读写文件、跑 shell 脚本）足够；需要 native binary 时建议降级到 microsandbox |
| host 文件权限暴露 | bind mount 直接暴露 host 目录 | 只 mount `input.directory`，沙箱无法访问 host 其他路径 |
| session 未正确触发 idle 事件 | VM 泄漏 | `event` hook 双触发（idle + deleted）；agent-os VM 随进程销毁兜底 |

## 不在本 Plugin 范围内

- 替换/拦截内置 read/write/edit/shell 工具（需 workspace adapter API）
- git 同步
- 多用户 VM 隔离（由 opencode-agent 路由层保证）
- cognee 知识图谱（完全独立）
