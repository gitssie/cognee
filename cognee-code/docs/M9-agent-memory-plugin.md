# M9 Agent Memory — OpenCode Plugin 集成方案

> 本文档描述如何通过 `@opencode-ai/plugin` 将 cognee-code 的持久化知识图谱记忆能力注入 OpenCode Agent，实现跨会话、多项目的长期记忆管理。

---

## 一、背景与目标

### 1.1 问题陈述

M8 已完成 OpenCode SDK 的基础集成：通过 `@opencode-ai/sdk` 启动 OpenCode Server，通过 MCP 将 cognee 工具暴露给 Agent，让 Agent **主动调用** `search`、`write_memory` 等 MCP 工具来获取记忆。

但这一方案有一个根本性缺陷：**Agent 必须主动选择调用记忆工具**。在实际使用中，Agent 往往会忽略记忆检索（特别是在任务专注度高时），导致知识图谱中已有的相关知识无法自动应用。

### 1.2 M9 目标：记忆的主动注入

M9 通过 `@opencode-ai/plugin` 的 Hook 机制，将 cognee 记忆变为 **系统级能力**，而非依赖 Agent 主动选择：

| 能力 | M8（被动） | M9（主动） |
|------|-----------|-----------|
| 记忆检索 | Agent 主动调用 `search` MCP 工具 | Hook 自动将相关记忆注入 system prompt |
| 记忆保存 | Agent 主动调用 `write_memory` MCP 工具 | Hook 自动捕获 tool 输出并异步保存 |
| 会话压缩 | OpenCode 默认 LLM 摘要 | Hook 影响压缩 prompt，保存关键知识到 cognee |
| 跨会话传递 | 无 | 通过 `experimental.chat.system.transform` 注入历史上下文 |

### 1.3 与现有模块的关系

```
M1 知识库管理  ←→  cognee 知识图谱（数据存储层）
                          ↑↓  API
M9 Agent Memory Plugin ───┤    （bridge 层）
                          ↓
OpenCode Agent Hooks ────→ session 上下文（自动注入/保存）
```

---

## 二、OpenCode Plugin 系统概述

### 2.1 Plugin 接口

`@opencode-ai/plugin` 提供标准 Plugin 接口：

```typescript
// packages/plugin/src/index.ts
export type Plugin = (input: PluginInput) => Promise<Hooks>

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>  // OpenCode HTTP 客户端
  project: Project
  directory: string          // 当前项目目录
  worktree: string           // git worktree 根目录
  serverUrl: URL
  $: BunShell               // Bun shell 执行器
}
```

### 2.2 核心 Hooks 接口

```typescript
export interface Hooks {
  // 事件监听（只读）
  event?: (input: { event: Event }) => Promise<void>

  // 每次 chat 消息生成后触发（可修改 output）
  "chat.message"?: (
    input: { sessionID: string; agent?: string; model?: {...}; messageID?: string },
    output: { message: UserMessage; parts: Part[] },
  ) => Promise<void>

  // 修改 LLM system prompt 数组（主动注入记忆的关键 Hook）
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: Model },
    output: { system: string[] },
  ) => Promise<void>

  // 修改发送给 LLM 的历史消息列表
  "experimental.chat.messages.transform"?: (
    input: {},
    output: { messages: { info: Message; parts: Part[] }[] },
  ) => Promise<void>

  // 影响会话压缩行为（保存知识到 cognee 的时机）
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>

  // 工具调用前（可修改参数）
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>

  // 工具调用后（捕获结果，异步保存记忆）
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => Promise<void>

  // 注册自定义工具（直接暴露给 Agent）
  tool?: { [key: string]: ToolDefinition }
}
```

### 2.3 Plugin 加载机制

OpenCode 通过 `opencode.json` 中的 `plugin` 字段加载插件：

```json
// 项目级 opencode.json 或全局 ~/.opencode/config.json
{
  "plugin": ["file:///path/to/cognee-memory-plugin/src/index.ts"]
}
```

或发布为 npm 包后：

```json
{
  "plugin": ["cognee-opencode-memory"]
}
```

---

## 三、M9 Plugin 架构设计

### 3.1 Plugin 目录结构

```
cognee-code/opencode-agent/
├── src/
│   ├── index.ts                    # (M8) OpenCode Server 启动入口
│   ├── config.ts                   # (M8) 配置模块
│   └── plugin/                     # (M9 新增) cognee Memory Plugin
│       ├── index.ts                # Plugin 主入口，导出 CogneeMemoryPlugin
│       ├── memory-client.ts        # cognee Python API 客户端（HTTP）
│       ├── hooks/
│       │   ├── system-transform.ts # Hook: 注入记忆到 system prompt
│       │   ├── session-compact.ts  # Hook: 会话压缩时保存知识
│       │   ├── tool-after.ts       # Hook: 工具调用后异步保存记忆
│       │   └── chat-message.ts     # Hook: 消息完成后提取编码规则
│       └── tools/
│           ├── memory-search.ts    # Tool: 手动触发记忆搜索
│           └── memory-save.ts      # Tool: 手动保存记忆片段
└── package.json
```

### 3.2 整体数据流

```
用户发送消息
     │
     ▼
[Hook: experimental.chat.system.transform]
  ↓ 调用 cognee /api/v1/search
  ↓ 将相关记忆注入 system prompt
     │
     ▼
LLM 生成响应（携带记忆上下文）
     │
     ├──── 调用工具（bash/read/write 等）
     │         │
     │         ▼
     │    [Hook: tool.execute.after]
     │      ↓ 异步保存关键 tool 输出到 cognee
     │
     ▼
消息完成
     │
     ├──── [Hook: chat.message]
     │       ↓ 提取编码规则，save_interaction
     │
会话压缩触发
     │
     ▼
[Hook: experimental.session.compacting]
  ↓ 从 cognee 检索相关历史知识作为压缩上下文
  ↓ 压缩完成后，将摘要保存到 cognee
```

---

## 四、核心实现

### 4.1 cognee API 客户端（memory-client.ts）

```typescript
/**
 * cognee Python Backend HTTP 客户端
 * 供 Plugin 在 Bun 进程内调用 cognee 的记忆 API
 */

const COGNEE_BASE_URL = process.env.COGNEE_API_URL ?? "http://localhost:8000"
const COGNEE_TOKEN = process.env.COGNEE_API_TOKEN

export interface MemorySearchResult {
  content: string
  score: number
  metadata?: Record<string, any>
}

export class CogneeMemoryClient {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(baseUrl = COGNEE_BASE_URL, token?: string) {
    this.baseUrl = baseUrl
    this.headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  /** 语义搜索知识图谱（注入 system prompt 前调用） */
  async search(
    query: string,
    options?: {
      searchType?: "GRAPH_COMPLETION" | "SUMMARIES" | "CHUNKS"
      datasets?: string[]
      limit?: number
    },
  ): Promise<MemorySearchResult[]> {
    const resp = await fetch(`${this.baseUrl}/api/v1/search`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        query,
        search_type: options?.searchType ?? "GRAPH_COMPLETION",
        datasets: options?.datasets,
      }),
      signal: AbortSignal.timeout(3000), // 最多等待 3 秒，避免阻塞
    })
    if (!resp.ok) return []
    const data = await resp.json()
    return Array.isArray(data) ? data.slice(0, options?.limit ?? 5) : []
  }

  /** 读取长期记忆（AI memory） */
  async readMemory(): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/api/v1/memory`, {
      headers: this.headers,
      signal: AbortSignal.timeout(3000),
    })
    if (!resp.ok) return ""
    const data = await resp.json()
    return typeof data === "string" ? data : JSON.stringify(data)
  }

  /** 写入长期记忆 */
  async writeMemory(content: string, metadata?: Record<string, any>): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/memory`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ content, metadata }),
    }).catch(() => {}) // 异步写入，失败不阻断
  }

  /** 将文本/代码添加到知识图谱 */
  async cognify(text: string, datasetName?: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/add`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ text, dataset_name: datasetName ?? "agent-memory" }),
    }).catch(() => {})
    // cognify 是异步管道，无需等待完成
  }

  /** 保存交互记录并提取编码规则 */
  async saveInteraction(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/interactions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        session_id: sessionId,
        user_message: userMessage,
        assistant_response: assistantResponse,
      }),
    }).catch(() => {})
  }
}

// 单例，在 Plugin 初始化时创建
export const memoryClient = new CogneeMemoryClient(COGNEE_BASE_URL, COGNEE_TOKEN)
```

### 4.2 system prompt 记忆注入 Hook（hooks/system-transform.ts）

```typescript
/**
 * Hook: experimental.chat.system.transform
 *
 * 在每次 LLM 调用前，从 cognee 检索与当前会话相关的知识，
 * 注入到 system prompt 中，实现自动记忆增强。
 */

import type { Hooks } from "@opencode-ai/plugin"
import { memoryClient } from "../memory-client"

// 每个 session 的最新用户消息缓存（由 chat.message Hook 维护）
export const sessionLastQuery = new Map<string, string>()

export function createSystemTransformHook(): NonNullable<Hooks["experimental.chat.system.transform"]> {
  return async (input, output) => {
    const sessionID = input.sessionID
    if (!sessionID) return

    // 取该 session 最新的用户查询作为检索 query
    const query = sessionLastQuery.get(sessionID)
    if (!query || query.length < 5) return

    try {
      // 并行获取：语义搜索 + 长期记忆
      const [searchResults, longTermMemory] = await Promise.all([
        memoryClient.search(query, {
          searchType: "GRAPH_COMPLETION",
          limit: 5,
        }),
        memoryClient.readMemory(),
      ])

      const injections: string[] = []

      // 注入语义搜索结果
      if (searchResults.length > 0) {
        const snippets = searchResults
          .map((r, i) => `${i + 1}. ${r.content.slice(0, 500)}`)
          .join("\n")
        injections.push(
          [
            "## 知识库相关上下文（来自 cognee 知识图谱）",
            "以下是与当前任务相关的历史知识，供参考：",
            snippets,
          ].join("\n"),
        )
      }

      // 注入长期记忆（编码规则、项目约定等）
      if (longTermMemory && longTermMemory.trim().length > 0) {
        injections.push(
          [
            "## 长期记忆（项目约定与编码规则）",
            longTermMemory.slice(0, 2000), // 限制长度
          ].join("\n"),
        )
      }

      // 将注入内容添加到 system prompt 数组末尾
      if (injections.length > 0) {
        output.system.push(...injections)
      }
    } catch {
      // 记忆检索失败不阻断正常流程
    }
  }
}
```

### 4.3 会话压缩 Hook（hooks/session-compact.ts）

```typescript
/**
 * Hook: experimental.session.compacting
 *
 * 会话触达上下文上限时自动触发压缩。
 * 本 Hook 的职责：
 * 1. 向压缩 prompt 注入相关历史知识（让摘要更准确）
 * 2. 压缩完成后，将摘要异步保存到 cognee
 */

import type { Hooks } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { memoryClient } from "../memory-client"
import { sessionLastQuery } from "./system-transform"

export function createCompactingHook(
  input: PluginInput,
): NonNullable<Hooks["experimental.session.compacting"]> {
  return async (hookInput, output) => {
    const { sessionID } = hookInput
    const query = sessionLastQuery.get(sessionID) ?? "代码项目开发"

    try {
      // 从 cognee 检索与本次压缩相关的历史上下文
      const results = await memoryClient.search(query, {
        searchType: "SUMMARIES",
        limit: 3,
      })

      if (results.length > 0) {
        const historicalContext = results.map((r) => r.content).join("\n\n")
        // 注入到压缩 prompt 的 context 中
        output.context.push(
          `## 相关历史知识（来自 cognee，供压缩摘要参考）\n${historicalContext}`,
        )
      }

      // 压缩完成后异步保存摘要（通过 event Hook 监听 Compacted 事件实现）
    } catch {
      // 失败不影响压缩
    }
  }
}
```

### 4.4 工具调用后异步保存 Hook（hooks/tool-after.ts）

```typescript
/**
 * Hook: tool.execute.after
 *
 * 工具调用完成后，根据工具类型决定是否将关键信息异步保存到 cognee。
 *
 * 保存策略：
 * - bash: 仅保存成功的构建/测试命令输出
 * - read/glob/grep: 不保存（纯查询）
 * - write/edit: 保存文件修改摘要
 * - webfetch: 保存获取到的关键信息
 */

import type { Hooks } from "@opencode-ai/plugin"
import { memoryClient } from "../memory-client"

// 需要保存记忆的工具白名单
const MEMORY_TOOLS = new Set(["bash", "write", "edit", "webfetch"])

// 命令输出长度上限（避免保存噪音）
const MAX_OUTPUT_LENGTH = 2000

export function createToolAfterHook(): NonNullable<Hooks["tool.execute.after"]> {
  return async (hookInput, output) => {
    const { tool, sessionID, args } = hookInput

    if (!MEMORY_TOOLS.has(tool)) return

    try {
      const content = output.output.slice(0, MAX_OUTPUT_LENGTH)
      if (!content.trim()) return

      let memoryText: string

      switch (tool) {
        case "bash": {
          // 只保存非平凡、非错误的命令输出
          if (
            content.includes("error") ||
            content.includes("Error") ||
            content.length < 50
          )
            return
          memoryText = `执行命令: ${args.command ?? ""}\n输出摘要:\n${content}`
          break
        }
        case "write":
        case "edit": {
          const filePath = args.filePath ?? args.path ?? "unknown"
          memoryText = `文件修改: ${filePath}\n${output.title ?? ""}`
          break
        }
        case "webfetch": {
          memoryText = `网页内容 (${args.url ?? ""}):\n${content}`
          break
        }
        default:
          return
      }

      // 异步保存，不阻断主流程
      memoryClient.cognify(memoryText, "agent-tool-outputs").catch(() => {})
    } catch {
      // 静默失败
    }
  }
}
```

### 4.5 消息完成 Hook（hooks/chat-message.ts）

```typescript
/**
 * Hook: chat.message
 *
 * 每次 Assistant 消息生成完成后：
 * 1. 缓存用户消息作为下次 system-transform 的检索 query
 * 2. 异步提取编码规则并保存
 */

import type { Hooks } from "@opencode-ai/plugin"
import { memoryClient } from "../memory-client"
import { sessionLastQuery } from "./system-transform"

export function createChatMessageHook(): NonNullable<Hooks["chat.message"]> {
  return async (hookInput, output) => {
    const { sessionID } = hookInput
    const { message, parts } = output

    // 1. 从 user message 的 text parts 提取查询文本，缓存供下次检索使用
    const userText = message.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join(" ")
      .trim()

    if (userText && userText.length > 5) {
      sessionLastQuery.set(sessionID, userText)
    }

    // 2. 提取 assistant 的文字回复
    const assistantText = parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text ?? "")
      .join("\n")
      .trim()

    if (!assistantText || assistantText.length < 100) return

    // 3. 异步保存交互（提取编码规则）
    memoryClient
      .saveInteraction(sessionID, userText ?? "", assistantText)
      .catch(() => {})
  }
}
```

### 4.6 自定义工具（tools/memory-search.ts & memory-save.ts）

```typescript
// tools/memory-search.ts
import { tool } from "@opencode-ai/plugin"
import { memoryClient } from "../memory-client"

export const memorySearchTool = tool({
  description:
    "在 cognee 知识图谱中搜索相关知识。当需要回顾项目历史、查找编码规范、了解过去的技术决策时使用。",
  args: {
    query: tool.schema.string().describe("搜索查询，描述你想了解的知识"),
    search_type: tool.schema
      .enum(["GRAPH_COMPLETION", "SUMMARIES", "CHUNKS"])
      .optional()
      .describe("搜索类型：GRAPH_COMPLETION=知识图谱推理，SUMMARIES=摘要，CHUNKS=原始片段"),
    datasets: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("限定搜索的数据集名称列表，不传则搜索全部"),
  },
  async execute(args, context) {
    const results = await memoryClient.search(args.query, {
      searchType: args.search_type as any,
      datasets: args.datasets,
      limit: 5,
    })
    if (results.length === 0) return "未找到相关知识。"
    return results
      .map((r, i) => `[${i + 1}] (相关度: ${r.score?.toFixed(2) ?? "N/A"})\n${r.content}`)
      .join("\n\n---\n\n")
  },
})
```

```typescript
// tools/memory-save.ts
import { tool } from "@opencode-ai/plugin"
import { memoryClient } from "../memory-client"

export const memorySaveTool = tool({
  description:
    "将重要知识保存到 cognee 知识图谱。适用于：架构决策、技术选型原因、项目约定、踩坑记录等值得长期保存的信息。",
  args: {
    content: tool.schema.string().describe("要保存的知识内容"),
    dataset: tool.schema
      .string()
      .optional()
      .describe("目标数据集名称，默认为 'agent-memory'"),
    as_rule: tool.schema
      .boolean()
      .optional()
      .describe("是否保存为长期记忆（编码规则），默认 false"),
  },
  async execute(args) {
    if (args.as_rule) {
      await memoryClient.writeMemory(args.content)
      return `已保存到长期记忆（编码规则）。`
    }
    await memoryClient.cognify(args.content, args.dataset ?? "agent-memory")
    return `已提交到知识图谱（数据集: ${args.dataset ?? "agent-memory"}），异步处理中。`
  },
})
```

### 4.7 Plugin 主入口（plugin/index.ts）

```typescript
/**
 * CogneeMemoryPlugin — OpenCode 记忆增强插件
 *
 * 通过 opencode.json 的 plugin 字段注册：
 * {
 *   "plugin": ["file:///path/to/opencode-agent/src/plugin/index.ts"]
 * }
 */

import type { Plugin } from "@opencode-ai/plugin"
import { createSystemTransformHook } from "./hooks/system-transform"
import { createCompactingHook } from "./hooks/session-compact"
import { createToolAfterHook } from "./hooks/tool-after"
import { createChatMessageHook } from "./hooks/chat-message"
import { memorySearchTool } from "./tools/memory-search"
import { memorySaveTool } from "./tools/memory-save"

export const CogneeMemoryPlugin: Plugin = async (input) => {
  console.log("[CogneeMemoryPlugin] Initializing agent memory plugin...")
  console.log(`[CogneeMemoryPlugin] Cognee API: ${process.env.COGNEE_API_URL ?? "http://localhost:8000"}`)

  return {
    // === 自动记忆注入 ===
    // 每次 LLM 调用前，从 cognee 检索相关知识注入 system prompt
    "experimental.chat.system.transform": createSystemTransformHook(),

    // === 会话压缩增强 ===
    // 压缩时注入历史上下文，压缩后保存摘要
    "experimental.session.compacting": createCompactingHook(input),

    // === 工具结果异步保存 ===
    // 工具调用完成后，异步将关键输出保存到知识图谱
    "tool.execute.after": createToolAfterHook(),

    // === 消息完成时提取规则 ===
    // 每次 assistant 回复完成后，更新查询缓存并异步提取编码规则
    "chat.message": createChatMessageHook(),

    // === 自定义工具（Agent 可主动调用） ===
    tool: {
      cognee_search: memorySearchTool,
      cognee_save: memorySaveTool,
    },
  }
}

// 默认导出（OpenCode Plugin Loader 扫描所有具名导出）
export default CogneeMemoryPlugin
```

---

## 五、配置集成

### 5.1 将 Plugin 注册到 OpenCode 配置

在 `src/config.ts`（M8）的 `buildOpencodeConfig()` 中添加 plugin 注册：

```typescript
// cognee-code/opencode-agent/src/config.ts

function buildOpencodeConfig(): Config {
  // Plugin 路径（相对于 opencode-agent/ 目录的绝对路径）
  const pluginPath = new URL("./plugin/index.ts", import.meta.url).pathname

  return {
    // (M8 已有的 MCP 配置)
    mcp: {
      cognee: {
        type: "remote",
        url: COGNEE_MCP_URL,
        enabled: true,
      },
    },

    // (M9 新增) 注册 cognee Memory Plugin
    plugin: [`file://${pluginPath}`],

    // (M8 已有的) 自定义 Agent 配置
    agent: {
      "cognee-coder": {
        // ... 同 M8，但可简化 prompt，因记忆注入已由 Plugin 自动处理
        prompt: [
          "你是一个高级编码助手，拥有通过 cognee 知识图谱自动管理的持久化记忆。",
          "",
          "记忆已由系统自动注入到上下文中，你也可以主动使用以下工具：",
          "- `cognee_search`: 搜索知识图谱获取更多相关知识",
          "- `cognee_save`: 将重要的架构决策或项目约定保存到知识图谱",
          "",
          "编码原则：遵循项目已有风格，修改范围尽量小且专注。",
        ].join("\n"),
        // ... 其余配置同 M8
      },
    },
  }
}
```

### 5.2 环境变量

```bash
# M9 新增
COGNEE_API_URL=http://localhost:8000      # cognee Python 后端地址
COGNEE_API_TOKEN=                        # cognee 认证 Token（可选）

# M8 已有（Plugin 也会用到）
COGNEE_MCP_URL=http://localhost:8000/mcp/
```

---

## 六、记忆生命周期设计

### 6.1 记忆类型与存储策略

| 记忆类型 | 存储位置 | 写入时机 | 读取时机 |
|---------|---------|---------|---------|
| **语义知识**（代码、文档） | cognee 知识图谱（向量+图） | `cognify()` 异步管道 | 每次 LLM 调用前，`search()` |
| **长期记忆**（编码规则）  | cognee AI memory           | `writeMemory()` | 每次 LLM 调用前，`readMemory()` |
| **交互历史**（规则提取）  | cognee 知识图谱             | 消息完成后异步 | 通过 `search()` 检索 |
| **会话上下文**（跨 session）| cognee 知识图谱           | 会话压缩时      | 压缩 Hook + system-transform |

### 6.2 记忆检索的性能优化

`experimental.chat.system.transform` 在**每次** LLM 调用前触发，需严格控制延迟：

```typescript
// 三级保护策略（hooks/system-transform.ts）

// 1. 超时控制：cognee 检索最多 3 秒
signal: AbortSignal.timeout(3000)

// 2. 查询去重：相同 query 3 分钟内命中缓存
const queryCache = new Map<string, { ts: number; result: MemorySearchResult[] }>()
const CACHE_TTL = 3 * 60 * 1000

// 3. 并行执行：search 和 readMemory 并行，互不阻塞
const [searchResults, longTermMemory] = await Promise.all([...])
```

### 6.3 噪音控制

工具调用后保存记忆（`tool.execute.after`）需过滤噪音：

- **不保存**：只读操作（read/glob/grep）、错误输出、过短内容（< 50 字）
- **保存**：成功的 bash 命令输出、文件修改摘要、webfetch 关键内容
- **限长**：单条记忆最多 2000 字符

---

## 七、跨会话记忆传递机制

### 7.1 问题背景

OpenCode 的会话（Session）默认是隔离的——新会话启动时，历史会话的对话内容不会自动携带。

M9 通过 cognee 知识图谱实现跨会话记忆传递：

```
Session A 执行任务
   ↓ 工具调用结果、编码规则通过 Hooks 保存到 cognee
   
Session B 启动新任务
   ↓ experimental.chat.system.transform 自动从 cognee 检索 Session A 留下的知识
   ↓ 注入 system prompt，Agent 即可利用跨会话知识
```

### 7.2 会话项目隔离

不同项目的记忆不应混淆。通过 `directory`（项目目录）作为数据集命名空间：

```typescript
// hooks/system-transform.ts 中的数据集隔离

import path from "path"

// 以项目目录名作为数据集前缀，隔离不同项目的记忆
const projectDataset = `project-${path.basename(input.directory)}`

const searchResults = await memoryClient.search(query, {
  datasets: [projectDataset, "agent-memory"], // 项目专属 + 全局记忆
})
```

---

## 八、与 M8 MCP 方案的协作关系

M9 Plugin 与 M8 MCP 方案是**互补而非替代**的关系：

| 场景 | 推荐方式 | 原因 |
|------|---------|------|
| 自动上下文注入 | M9 Plugin Hook | 无需 Agent 主动调用，始终生效 |
| Agent 主动检索特定知识 | M8 MCP 工具（`search`） + M9 `cognee_search` | Agent 可控，精准查询 |
| 批量导入文档/代码库 | M8 MCP 工具（`cognify`） | 大批量数据适合通过 MCP 操作 |
| 自动保存工具输出 | M9 Plugin Hook | 轻量、无需改变 Agent 行为 |
| 会话压缩知识保存 | M9 Plugin Hook | 与 OpenCode 生命周期自然集成 |

**配置建议**：M8 的 MCP cognee 配置 + M9 的 Plugin 配置同时启用，两者共享同一个 cognee 后端。

---

## 九、测试验证

### 9.1 Plugin 加载测试

```typescript
// opencode-agent/src/plugin/__tests__/plugin.test.ts
import { describe, it, expect, vi } from "bun:test"
import { CogneeMemoryPlugin } from "../index"
import { createOpencodeClient } from "@opencode-ai/sdk"

describe("CogneeMemoryPlugin", () => {
  it("should initialize and return all required hooks", async () => {
    const mockInput = {
      client: createOpencodeClient({ baseUrl: "http://localhost:4096" }),
      project: { id: "test-project", path: "/tmp/test" } as any,
      directory: "/tmp/test",
      worktree: "/tmp/test",
      serverUrl: new URL("http://localhost:4096"),
      $: {} as any,
    }

    const hooks = await CogneeMemoryPlugin(mockInput)

    expect(hooks["experimental.chat.system.transform"]).toBeFunction()
    expect(hooks["experimental.session.compacting"]).toBeFunction()
    expect(hooks["tool.execute.after"]).toBeFunction()
    expect(hooks["chat.message"]).toBeFunction()
    expect(hooks.tool?.cognee_search).toBeDefined()
    expect(hooks.tool?.cognee_save).toBeDefined()
  })
})
```

### 9.2 记忆注入 E2E 验证

```typescript
// 验证步骤（手动/集成测试）
// 1. 在 Session A 中执行一个任务（如：分析 auth.ts 文件）
// 2. 等待 cognify 处理完成（cognify_status 查询）
// 3. 开启 Session B，发送相关问题
// 4. 检查 Session B 的第一条 LLM 调用是否携带了 Session A 留下的知识

// 验证 system prompt 是否包含记忆注入
// 可通过 OpenCode /event SSE 流中的 session.debug 事件观察
```

---

## 十、功能优先级

| 优先级 | 功能 | 工作量 | 说明 |
|--------|------|--------|------|
| **P0** | Plugin 骨架 + 加载验证 | 小 | 确认 Plugin 能被 OpenCode 正确加载 |
| **P0** | `cognee-memory-client.ts` | 小 | cognee HTTP API 封装，含超时/错误处理 |
| **P0** | `experimental.chat.system.transform` | 中 | 核心记忆注入 Hook，含缓存优化 |
| **P1** | `chat.message` Hook | 小 | 查询缓存 + 异步 saveInteraction |
| **P1** | `tool.execute.after` Hook | 小 | 工具输出过滤 + 异步 cognify |
| **P1** | `cognee_search` / `cognee_save` 工具 | 小 | Agent 主动操作记忆的工具 |
| **P1** | `experimental.session.compacting` | 中 | 压缩时注入历史知识 |
| **P2** | 项目级数据集隔离 | 小 | 按 directory 区分记忆命名空间 |
| **P2** | 查询缓存（TTL） | 小 | 避免相同 query 重复触发检索 |
| **P2** | Plugin 单元测试 | 中 | 覆盖 Hook 逻辑 + mock cognee |
| **P3** | 记忆压缩后异步保存 | 中 | 监听 Compacted 事件，保存摘要到 cognee |
| **P3** | 前端记忆可视化 | 大 | 在 Agent 对话界面显示注入了哪些记忆 |

---

## 十一、与现有模块的关系

| 模块 | M9 的交互方式 |
|------|-------------|
| **M1 知识库管理** | Plugin 通过 `/api/v1/add`（cognify）和 `/api/v1/search` 直接操作 M1 的数据集 |
| **M3 编码规则** | `chat.message` Hook 触发 `save_interaction`，自动提取规则存入 M3 |
| **M5 工具审计** | `tool.execute.after` Hook 可接入 M5 的 Tool Use 审计追踪 |
| **M8 SDK 集成** | Plugin 在 M8 的 `opencode-agent/` 子项目中实现，共用 `config.ts` |
| **M8 MCP Server** | Plugin 与 MCP 并行工作，互补而非替代；Plugin 直接调用 HTTP API，MCP 供 Agent 主动调用 |

---

## 十二、后续扩展方向

1. **`experimental.chat.messages.transform` Hook**：在消息历史中注入来自 cognee 的历史对话片段，实现更深层的跨会话上下文延续。

2. **`experimental.text.complete` Hook**：当 Agent 生成文本完成后，触发知识提取流程，将有价值的推理过程持久化。

3. **发布为独立 npm 包**：将 `CogneeMemoryPlugin` 发布为 `cognee-opencode-memory`，供任何 OpenCode 用户安装使用，将 cognee 知识图谱记忆能力开放给整个 OpenCode 生态。

4. **多模态记忆**：扩展 `tool.execute.after` 捕获 `webfetch` 返回的图片/文档，通过 cognee 的多模态处理管道存储视觉知识。
