# M8 OpenCode SDK 集成 — AI Agent 能力增强

> 本文档描述如何将 [OpenCode](https://opencode.ai) 的 Agent 能力集成到 cognee-code 项目中，为现有 AI Agent 体系增加完整的代码智能体（Coding Agent）功能。

---

## 一、集成目标与价值

### 1.1 OpenCode 是什么

OpenCode 是一个开源 AI 编码助手框架（基于 Bun 运行时），核心特性：

| 特性 | 说明 |
|------|------|
| **多 Agent 架构** | 内置 build / plan / explore / general 等多种 Agent |
| **工具系统** | 20+ 内置工具（bash、read、edit、write、glob、grep、webfetch 等） |
| **多 LLM 支持** | 20+ LLM 提供商（OpenAI、Claude、Gemini、Bedrock 等） |
| **MCP 协议** | 完整的 Model Context Protocol 支持（本地/远程 MCP 服务器） |
| **HTTP API** | 完整的 REST API + SSE 事件流 |
| **会话管理** | 持久化多轮对话、分叉、快照、权限控制 |
| **`@opencode-ai/sdk`** | 官方 JS/TS SDK，内置服务进程生命周期管理 |

### 1.2 与 cognee-code 的互补关系

| 维度 | cognee-code 提供 | OpenCode 提供 |
|------|----------------|--------------|
| **知识持久化** | 知识图谱、向量存储、编码规则 | 无 |
| **记忆管理** | cognify / search / write_memory | 无 |
| **代码执行** | Notebook 沙箱 | bash tool、PTY 终端 |
| **Agent 编排** | Pipeline / Task 系统 | Agent / Session / Tool 系统 |
| **代码理解** | 代码图谱提取、搜索 | LSP 集成、代码工具 |
| **文件操作** | 数据添加/删除 | read/edit/write/glob/grep |
| **外部服务** | MCP 服务端（暴露工具） | MCP 客户端（消费工具） |

**集成价值**：cognee-code 通过 MCP 将知识图谱能力暴露为 MCP 工具；OpenCode Agent 消费这些工具，获得长期记忆和知识检索能力。同时 cognee-code 通过 `@opencode-ai/sdk` 驱动 OpenCode 进程，执行具有完整工具链的编码任务。

---

## 二、架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        cognee-code                          │
│                                                             │
│  ┌─────────────────┐          ┌──────────────────────────┐  │
│  │  Python Backend │          │   Bun OpenCode Server    │  │
│  │  (FastAPI)      │◄────────►│   (opencode-agent/)      │  │
│  │                 │  HTTP    │                          │  │
│  │  - 知识图谱 API  │          │  用 @opencode-ai/sdk 启动 │  │
│  │  - 搜索 API      │          │  createOpencodeServer()  │  │
│  │  - MCP Server   │◄────────►│  createOpencodeClient()  │  │
│  │  - 编码规则 API  │  MCP     │                          │  │
│  └────────┬────────┘          └──────────────────────────┘  │
│           │                                                 │
│           │ 依赖                                             │
│           ▼                                                 │
│  ┌─────────────────┐                                        │
│  │  Cognee Engine  │                                        │
│  │  (知识图谱核心)  │                                        │
│  └─────────────────┘                                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │             Vue 3 + Quasar Frontend                  │    │
│  │  - 现有管理界面  - 新增 Coding Agent 对话界面          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 集成方案：直接使用 `@opencode-ai/sdk`

`@opencode-ai/sdk` 不仅仅是 HTTP 客户端，它内置了完整的服务进程生命周期管理：

```typescript
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk"

// createOpencodeServer() 内部通过 Node.js spawn() 启动 opencode serve 进程
// 等待进程就绪后返回 { url, close() }
const server = await createOpencodeServer({
  port: 4096,
  config: {
    mcp: {
      cognee: {
        type: "remote",
        url: "http://localhost:8000/mcp/",
      }
    }
  }
})

// 创建 HTTP 客户端连接到已启动的 server
const client = createOpencodeClient({ baseUrl: server.url })
```

或使用便捷函数一步完成：

```typescript
import { createOpencode } from "@opencode-ai/sdk"

const { client, server } = await createOpencode({
  port: 4096,
  config: { /* OpenCode 配置 */ }
})
```

**`@opencode-ai/sdk` 完整导出**：

| 导出 | 说明 |
|------|------|
| `createOpencodeServer(options?)` | 启动 opencode serve 进程，返回 `{ url, close() }` |
| `createOpencodeTui(options?)` | 启动 TUI 交互终端模式 |
| `createOpencodeClient(config?)` | 创建 HTTP 客户端（不启动进程） |
| `createOpencode(options?)` | 一键创建 server + client |
| `ServerOptions` | `{ hostname, port, signal, timeout, config }` |
| `TuiOptions` | `{ project, model, session, agent, signal, config }` |
| `OpencodeClient` | 完整类型化的 HTTP 客户端类 |

---

## 三、新增目录结构（opencode-agent/）

### 3.1 目录结构

```
cognee-code/opencode-agent/
├── package.json           # Bun 项目配置（依赖 @opencode-ai/sdk）
├── bunfig.toml            # Bun 运行时配置
├── tsconfig.json          # TypeScript 配置
├── src/
│   ├── index.ts           # 入口：启动 OpenCode server + 管理生命周期
│   ├── config.ts          # 动态生成 OpenCode 配置（MCP、Agent 等）
│   └── proxy.ts           # 可选：API 代理/路由层
└── README.md
```

### 3.2 package.json

```json
{
  "name": "opencode-agent",
  "version": "0.1.0",
  "description": "OpenCode Agent service for cognee-code",
  "private": true,
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "start": "bun run src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@opencode-ai/sdk": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

> **注意**：`@opencode-ai/sdk` 内部会调用系统安装的 `opencode` 命令（`bun x opencode` 或 `npm i -g opencode-ai`），无需将 opencode 源码作为依赖。

### 3.3 配置模块（src/config.ts）

```typescript
import type { Config } from "@opencode-ai/sdk"
import type { ServerOptions } from "@opencode-ai/sdk"

const COGNEE_MCP_URL = process.env.COGNEE_MCP_URL ?? "http://localhost:8000/mcp/"
const COGNEE_API_TOKEN = process.env.COGNEE_API_TOKEN

/** 构建传递给 createOpencodeServer 的配置 */
export function buildServerOptions(): ServerOptions {
  return {
    hostname: "0.0.0.0",
    port: Number(process.env.OPENCODE_PORT ?? 4096),
    timeout: 10_000,
    config: buildOpencodeConfig(),
  }
}

/** 构建 OpenCode 配置（通过 OPENCODE_CONFIG_CONTENT 环境变量注入）*/
function buildOpencodeConfig(): Config {
  const mcpHeaders: Record<string, string> = {}
  if (COGNEE_API_TOKEN) {
    mcpHeaders["Authorization"] = `Bearer ${COGNEE_API_TOKEN}`
  }

  return {
    // 默认模型（可被请求覆盖）
    // model: "claude-sonnet-4-5",

    // MCP 接入 cognee-code
    mcp: {
      cognee: {
        type: "remote",
        url: COGNEE_MCP_URL,
        enabled: true,
        ...(Object.keys(mcpHeaders).length > 0 ? { headers: mcpHeaders } : {}),
      },
    },

    // 自定义 Agent 定义
    agent: {
      "cognee-coder": {
        name: "cognee-coder",
        description:
          "拥有持久化记忆的 AI 编码助手，通过 cognee 知识图谱提供长期知识存储和检索",
        mode: "primary",
        prompt: [
          "你是一个拥有持久化记忆能力的高级编码助手。",
          "",
          "**记忆管理原则：**",
          "1. 开始新任务时，先用 read_memory 工具加载已有知识",
          "2. 执行搜索前，用 search 工具检索知识图谱中的相关内容",
          "3. 重要的编码决策、架构选择、最佳实践，用 write_memory 工具持久化保存",
          "4. 每次编码会话结束时，用 save_interaction 工具提取编码规则",
          "",
          "**编码原则：**",
          "- 遵循项目已有的代码风格和模式",
          "- 修改前先阅读相关文件",
          "- 每次修改范围尽量小且专注",
          "- 遇到不确定的设计决策时主动查询 cognee 知识库",
        ].join("\n"),
        steps: 50,
        temperature: 0.1,
        permission: {
          bash: { allow: ["*"] },
          write: { allow: ["*"] },
          edit: { allow: ["*"] },
          read: { allow: ["*"] },
          glob: { allow: ["*"] },
          grep: { allow: ["*"] },
        },
      },
    },
  }
}
```

### 3.4 启动入口（src/index.ts）

```typescript
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk"
import { buildServerOptions } from "./config"

const controller = new AbortController()

// 进程退出信号处理
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`Received ${sig}, shutting down OpenCode server...`)
    controller.abort()
  })
}

// 启动 OpenCode 服务进程
// createOpencodeServer 内部通过 spawn("opencode", ["serve", ...]) 启动
const opts = buildServerOptions()
console.log(`Starting OpenCode server on port ${opts.port}...`)

const server = await createOpencodeServer({
  ...opts,
  signal: controller.signal,
})

console.log(`OpenCode server ready at ${server.url}`)

// 可选：验证 MCP 连接
const client = createOpencodeClient({ baseUrl: server.url })
try {
  const mcpStatus = await client.mcp.status()
  console.log("MCP connections:", JSON.stringify(mcpStatus.data, null, 2))
} catch (e) {
  console.warn("Could not check MCP status:", e)
}

// 保持进程存活，直到收到退出信号
await new Promise<void>((resolve) => {
  controller.signal.addEventListener("abort", () => {
    server.close()
    resolve()
  })
})
```

---

## 四、MCP 工具接入：cognee-code → OpenCode

### 4.1 cognee-code MCP Server 暴露的工具

cognee-code 已通过 `fastmcp` 实现了 MCP 服务端，暴露以下工具：

| MCP 工具 | 功能 | OpenCode Agent 使用场景 |
|----------|------|----------------------|
| `cognify` | 将代码/文本转化为知识图谱 | 学习新代码库后保存结构性知识 |
| `search` | 多模式知识图谱搜索 | 回答问题前先检索已有知识 |
| `write_memory` | 写入 AI 长期记忆 | 保存编码决策、架构决定 |
| `read_memory` | 读取全部长期记忆 | 开始新任务时加载背景知识 |
| `save_interaction` | 保存交互并提取编码规则 | 每次编码会话结束后自动提取规则 |
| `list_data` | 列出数据集和数据项 | 查看知识库内容概览 |
| `delete` | 删除特定数据 | 清理过时知识 |
| `prune` | 重置知识图谱 | 重新初始化知识库 |
| `cognify_status` | 查询管道状态 | 检查知识处理是否完成 |

### 4.2 MCP 连接方式

OpenCode 通过以下配置连接到 cognee-code MCP 服务：

**本地开发模式**（无认证）：
```typescript
mcp: {
  cognee: {
    type: "remote",
    url: "http://localhost:8000/mcp/",
    enabled: true,
  }
}
```

**生产模式**（带 JWT Token）：
```typescript
mcp: {
  cognee: {
    type: "remote",
    url: "http://localhost:8000/mcp/",
    headers: {
      "Authorization": `Bearer ${COGNEE_API_TOKEN}`
    },
    enabled: true,
  }
}
```

---

## 五、Python 后端调用 OpenCode Agent

### 5.1 新增 OpenCode 客户端模块

在 `server/src/modules/` 下新增 `opencode/` 模块：

```
server/src/modules/opencode/
├── __init__.py
├── client.py          # OpenCode HTTP 客户端（httpx）
├── schemas.py         # Pydantic 请求/响应模型
└── router.py          # FastAPI 路由
```

### 5.2 OpenCode HTTP 客户端（client.py）

```python
"""
OpenCode Agent HTTP 客户端
调用 opencode-agent 服务（由 @opencode-ai/sdk 启动的 Bun 进程）
"""

import json
from typing import AsyncIterator, Optional
import httpx
from pydantic import BaseModel

OPENCODE_BASE_URL = "http://localhost:4096"


class AgentSession(BaseModel):
    id: str
    title: str
    directory: str


class OpenCodeClient:
    """OpenCode Agent HTTP 客户端"""

    def __init__(self, base_url: str = OPENCODE_BASE_URL):
        self.base_url = base_url
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(connect=5.0, read=300.0, write=30.0, pool=5.0),
        )

    async def create_session(
        self,
        directory: str,
        title: str = "cognee-code session",
    ) -> AgentSession:
        """创建新的 Agent 会话"""
        resp = await self._client.post(
            "/session",
            json={"title": title, "directory": directory},
        )
        resp.raise_for_status()
        data = resp.json()
        return AgentSession(
            id=data["id"],
            title=data.get("title", title),
            directory=data.get("directory", directory),
        )

    async def send_prompt(
        self,
        session_id: str,
        message: str,
        directory: str,
        agent: str = "cognee-coder",
        model_id: str = "claude-sonnet-4-5",
        provider_id: str = "anthropic",
    ) -> dict:
        """向 Agent 发送提示并等待响应"""
        resp = await self._client.post(
            f"/session/{session_id}/prompt",
            json={
                "sessionID": session_id,
                "directory": directory,
                "agent": agent,
                "model": {
                    "modelID": model_id,
                    "providerID": provider_id,
                },
                "parts": [{"type": "text", "text": message}],
            },
        )
        resp.raise_for_status()
        return resp.json()

    async def stream_events(self, session_id: Optional[str] = None) -> AsyncIterator[dict]:
        """
        通过 SSE 流式接收 Agent 事件
        若传入 session_id，则只过滤该会话的事件
        """
        async with self._client.stream("GET", "/event") as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    try:
                        event = json.loads(line[6:])
                        if session_id is None:
                            yield event
                        elif event.get("properties", {}).get("sessionID") == session_id:
                            yield event
                    except json.JSONDecodeError:
                        pass

    async def get_session_messages(self, session_id: str) -> list[dict]:
        """获取会话所有消息"""
        resp = await self._client.get(f"/session/{session_id}/messages")
        resp.raise_for_status()
        return resp.json()

    async def list_agents(self, directory: str) -> list[dict]:
        """获取所有可用 Agent 列表"""
        resp = await self._client.get(
            "/app/agents",
            params={"directory": directory},
        )
        resp.raise_for_status()
        return resp.json()

    async def get_mcp_status(self, directory: str) -> dict:
        """获取 MCP 连接状态"""
        resp = await self._client.get(
            "/mcp/status",
            params={"directory": directory},
        )
        resp.raise_for_status()
        return resp.json()

    async def health_check(self) -> bool:
        """检查 OpenCode 服务是否可用"""
        try:
            resp = await self._client.get("/app/info", timeout=3.0)
            return resp.status_code == 200
        except Exception:
            return False

    async def close(self):
        await self._client.aclose()
```

### 5.3 FastAPI 路由（router.py）

```python
"""
OpenCode Agent API 路由
将 Agent 能力暴露给前端
"""

import json
from typing import AsyncIterator, Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .client import OpenCodeClient

router = APIRouter(prefix="/api/v1/agent", tags=["opencode-agent"])

_client: Optional[OpenCodeClient] = None


def get_client() -> OpenCodeClient:
    if _client is None:
        raise HTTPException(503, "OpenCode agent service not initialized")
    return _client


class CreateSessionRequest(BaseModel):
    directory: str
    title: str = "cognee-code session"


class PromptRequest(BaseModel):
    session_id: str
    message: str
    directory: str
    agent: str = "cognee-coder"
    model_id: str = "claude-sonnet-4-5"
    provider_id: str = "anthropic"


@router.post("/sessions")
async def create_session(
    req: CreateSessionRequest,
    client: OpenCodeClient = Depends(get_client),
):
    """创建新的 Agent 会话"""
    return await client.create_session(
        directory=req.directory,
        title=req.title,
    )


@router.post("/sessions/{session_id}/prompt")
async def send_prompt(
    session_id: str,
    req: PromptRequest,
    client: OpenCodeClient = Depends(get_client),
):
    """向指定会话发送提示（非流式，等待完成）"""
    return await client.send_prompt(
        session_id=session_id,
        message=req.message,
        directory=req.directory,
        agent=req.agent,
        model_id=req.model_id,
        provider_id=req.provider_id,
    )


@router.get("/sessions/{session_id}/stream")
async def stream_session(
    session_id: str,
    client: OpenCodeClient = Depends(get_client),
):
    """
    SSE 流式接收 Agent 事件
    前端通过此接口实时展示 Agent 执行过程（文字输出、工具调用等）
    """
    async def event_generator() -> AsyncIterator[str]:
        async for event in client.stream_events(session_id=session_id):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions/{session_id}/messages")
async def get_messages(
    session_id: str,
    client: OpenCodeClient = Depends(get_client),
):
    """获取会话所有消息记录"""
    return await client.get_session_messages(session_id)


@router.get("/agents")
async def list_agents(
    directory: str,
    client: OpenCodeClient = Depends(get_client),
):
    """列出所有可用 Agent"""
    return await client.list_agents(directory)


@router.get("/mcp/status")
async def get_mcp_status(
    directory: str,
    client: OpenCodeClient = Depends(get_client),
):
    """获取 MCP 连接状态（确认 cognee MCP 工具是否正常）"""
    return await client.get_mcp_status(directory)


@router.get("/health")
async def health_check(
    client: OpenCodeClient = Depends(get_client),
):
    """检查 OpenCode 服务健康状态"""
    ok = await client.health_check()
    if not ok:
        raise HTTPException(503, "OpenCode agent service unhealthy")
    return {"status": "ok"}
```

---

## 六、新增 API 端点清单

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | /api/v1/agent/sessions | 创建 Agent 会话 |
| POST | /api/v1/agent/sessions/{id}/prompt | 向 Agent 发送提示（非流式） |
| GET  | /api/v1/agent/sessions/{id}/stream | SSE 流式接收 Agent 事件 |
| GET  | /api/v1/agent/sessions/{id}/messages | 获取会话消息记录 |
| GET  | /api/v1/agent/agents | 列出可用 Agent |
| GET  | /api/v1/agent/mcp/status | 查询 MCP 连接状态 |
| GET  | /api/v1/agent/health | Agent 服务健康检查 |

---

## 七、前端 Coding Agent 界面

### 7.1 功能需求

**Agent 对话界面（新增页面 `/agent`）**：

| 组件 | 功能 |
|------|------|
| **会话侧边栏** | 会话列表（新建/切换/删除） |
| **对话主区域** | 用户提问 + AI 回答的对话气泡式展示 |
| **工具调用展示** | 实时显示 Agent 正在调用的工具（bash、cognify、search 等） |
| **流式输出** | 通过 SSE 实时渲染 Agent 的文字输出 |
| **文件变更预览** | Agent 修改文件时，展示 diff 预览 |
| **Agent 选择器** | 下拉选择 Agent（cognee-coder / explore / plan 等） |
| **模型选择器** | 选择底层 LLM（Claude / GPT-4 / Gemini 等） |
| **权限确认弹窗** | Agent 请求执行危险操作时需用户确认 |

### 7.2 消息部分（Part）渲染规则

| Part 类型 | 渲染方式 |
|-----------|---------|
| `text` | Markdown 渲染（含代码高亮） |
| `reasoning` | 折叠式"思考过程"展示 |
| `tool` (pending) | 工具调用 loading 指示器 |
| `tool` (running) | 工具名称 + 参数摘要 + 进度动画 |
| `tool` (completed) | 工具名称 + 展开/折叠输出 |
| `tool` (error) | 红色错误信息 |
| `agent` | 子 Agent 调用嵌套展示 |
| `file` | 文件附件预览 |

### 7.3 SSE 事件处理（TypeScript）

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

// 或直接连接 Python 后端代理
const client = createOpencodeClient({ baseUrl: "http://localhost:8000" })

// 流式接收事件
for await (const event of client.global.event()) {
  switch (event.type) {
    case "message.part.updated":
      // 更新对话中的消息部分
      updateMessagePart(event.properties.part)
      break
    case "permission.asked":
      // 展示权限确认弹窗
      showPermissionDialog(event.properties.request)
      break
    case "session.diff":
      // 展示文件变更摘要
      updateFileDiff(event.properties.summary)
      break
    case "session.idle":
      // Agent 完成当前轮次
      setAgentIdle()
      break
  }
}
```

---

## 八、内置 Agent 说明

### 8.1 Agent 对照表

| Agent 名称 | 来源 | 用途 | 在 cognee-code 的使用场景 |
|-----------|------|------|--------------------------|
| `cognee-coder` | 自定义（M8 新增） | 带记忆的编码助手 | 日常编码任务，利用知识图谱 |
| `build` | OpenCode 内置 | 默认编码 Agent | 无需知识图谱的快速任务 |
| `plan` | OpenCode 内置 | 只分析不执行 | 代码审查、方案讨论 |
| `explore` | OpenCode 内置 | 快速代码探索 | 快速了解代码库结构 |
| `general` | OpenCode 内置 | 通用多步任务 | 复杂的跨文件重构 |

### 8.2 cognee-coder Agent 设计原则

`cognee-coder` 是专为 cognee-code 设计的自定义 Agent，其 Prompt 要求 Agent 在每次任务中：

1. **任务开始** → 调用 `read_memory` 加载已有知识
2. **搜索前** → 调用 `search` 检索知识图谱
3. **发现重要知识** → 调用 `write_memory` 保存
4. **任务结束** → 调用 `save_interaction` 提取编码规则

---

## 九、Docker Compose 集成

### 9.1 更新 docker-compose.yml

```yaml
version: "3.9"
services:
  # 现有 Python 后端
  backend:
    build: ./server
    ports:
      - "8000:8000"
    environment:
      - LLM_API_KEY=${LLM_API_KEY}
      - GRAPH_DATABASE_URL=${NEO4J_URL}
    depends_on:
      - neo4j
      - redis

  # 新增 OpenCode Agent 服务（Bun）
  opencode-agent:
    build:
      context: ./opencode-agent
      dockerfile: Dockerfile
    ports:
      - "4096:4096"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - COGNEE_API_TOKEN=${COGNEE_API_TOKEN}
      - COGNEE_MCP_URL=http://backend:8000/mcp/
      - OPENCODE_PORT=4096
    depends_on:
      - backend

  # 现有前端
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend
      - opencode-agent

  neo4j:
    image: neo4j:5
    # ...

  redis:
    image: redis:7-alpine
    # ...
```

### 9.2 opencode-agent/Dockerfile

```dockerfile
FROM oven/bun:1.2-alpine

# 安装 opencode CLI（@opencode-ai/sdk 内部 spawn 调用它）
RUN bun add -g opencode-ai

WORKDIR /app

COPY package.json bunfig.toml ./
RUN bun install --production

COPY src/ ./src/

ENV NODE_ENV=production

EXPOSE 4096

CMD ["bun", "run", "src/index.ts"]
```

---

## 十、功能优先级

| 优先级 | 功能 | 工作量 | 说明 |
|--------|------|--------|------|
| **P0** | `opencode-agent/` 子项目搭建 | 小 | Bun 项目，依赖 `@opencode-ai/sdk` |
| **P0** | MCP 连接验证 | 小 | 确认 OpenCode 能调用 cognify/search 等工具 |
| **P0** | Python 客户端模块 | 中 | `opencode/client.py` + `router.py` |
| **P0** | 前端基础对话界面 | 中 | 会话管理 + 文字流式输出 |
| **P1** | 工具调用可视化 | 中 | 展示 Agent 工具调用过程 |
| **P1** | 自定义 `cognee-coder` Agent | 小 | 配置带记忆管理 Prompt 的 Agent |
| **P1** | 权限确认弹窗 | 小 | bash/write 等敏感操作需用户确认 |
| **P1** | 文件变更 diff 预览 | 中 | Agent 修改文件后展示 diff |
| **P2** | 多 Agent 选择器 | 小 | 前端下拉切换不同 Agent |
| **P2** | 模型选择器 | 小 | 前端选择底层 LLM |
| **P2** | 会话历史持久化 | 小 | 保存和恢复历史对话 |
| **P3** | ACP 协议集成 | 大 | 支持 IDE 插件接入（VS Code 等） |
| **P3** | 自定义工具开发 | 中 | 为 OpenCode 开发 cognee 专属内置工具 |

---

## 十一、关键依赖与环境变量

### Python 后端新增依赖

```toml
# server/pyproject.toml 新增
httpx = ">=0.27.0,<1.0.0"    # 调用 OpenCode HTTP API
```

### Bun 子项目依赖

```json
{
  "dependencies": {
    "@opencode-ai/sdk": "latest"
  }
}
```

### 新增环境变量

```bash
# opencode-agent 服务
OPENCODE_PORT=4096                          # OpenCode 服务端口
COGNEE_MCP_URL=http://localhost:8000/mcp/  # cognee MCP 服务地址
COGNEE_API_TOKEN=                          # cognee 认证 Token（可选）

# LLM API Keys（opencode-agent 进程使用）
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
```

---

## 十二、与现有模块的关系

| 现有模块 | 与 M8 的关系 |
|---------|------------|
| **M1 知识库管理** | OpenCode Agent 通过 `cognify` / `search` MCP 工具操作 M1 数据集 |
| **M3 编码规则** | Agent 通过 `save_interaction` 自动提取编码规则存入 M3 |
| **M4 AI Task** | OpenCode Session = M4 任务的执行载体；M4 Responses API 可调用 OpenCode |
| **M5 会话历史** | OpenCode Session 历史 + M5 会话历史共同构成完整对话记录体系 |
| **M5 工具审计** | OpenCode 工具调用记录可接入 M5 的 Tool Use 审计追踪 |
| **M7 权限管理** | M7 的 JWT 认证用于保护 OpenCode Agent 的 API 访问 |

---

## 十三、数据集上下文注入方案

用户在 UI 中选择特定数据集后，需要将该信息传递给 OpenCode Agent，让 Agent 调用 MCP 工具时能够精准限定查询范围。

### 13.1 核心问题分析

`/session/:id/prompt` 接口的请求体包含 `system` 字段（字符串），可以注入**每条消息级别的额外系统提示**，这是无需修改 OpenCode 核心代码的最佳注入点：

```typescript
// OpenCode PromptInput 结构（官方 SDK 已支持）
{
  sessionID: string,
  system?: string,      // ← 每条消息的额外系统提示（追加到 Agent 的基础 prompt）
  agent?: string,
  model?: { providerID, modelID },
  parts: Part[],
}
```

OpenCode 内部处理逻辑（`src/session/llm.ts`）：

```typescript
// system 数组最终拼接为完整系统提示
const system = [
  ...(agent.prompt ? [agent.prompt] : []),  // Agent 基础 prompt
  ...input.system,                          // 全局 system
  ...(userMessage.system ? [userMessage.system] : []),  // ← 每条消息的 system 注入
].filter(Boolean).join("\n")
```

### 13.2 推荐方案：通过 `system` 字段注入数据集约束

**前端发送 prompt 时**，将用户选择的数据集信息拼入 `system` 字段：

```typescript
// 前端代码（Vue 3 + @opencode-ai/sdk）
const sendPrompt = async (userMessage: string, selectedDatasets: Dataset[]) => {
  const client = createOpencodeClient({ baseUrl: OPENCODE_BASE_URL })

  // 构建数据集约束的系统提示
  const datasetContext = selectedDatasets.length > 0
    ? [
        "## 知识库查询约束",
        "用户已选择以下数据集进行查询，调用 search 工具时必须将 datasets 参数限定为以下数据集：",
        selectedDatasets.map(ds => `- 数据集名称: "${ds.name}"（ID: ${ds.id}）`).join("\n"),
        "不要查询未列出的数据集中的内容。",
      ].join("\n")
    : "## 知识库查询约束\n用户未指定数据集，可以查询所有有权访问的数据集。"

  await client.session.prompt({
    path: { id: sessionId },
    body: {
      system: datasetContext,    // ← 注入数据集约束
      agent: "cognee-coder",
      parts: [
        { type: "text", text: userMessage }
      ],
    },
  })
}
```

**效果**：Agent 在收到消息时，系统提示变为：

```
[cognee-coder Agent 基础 prompt]
...

## 知识库查询约束
用户已选择以下数据集进行查询，调用 search 工具时必须将 datasets 参数限定为以下数据集：
- 数据集名称: "项目A文档"（ID: uuid-123）
- 数据集名称: "API规范"（ID: uuid-456）
不要查询未列出的数据集中的内容。

[用户消息]
```

### 13.3 前端架构：直接使用 `@opencode-ai/sdk` 连接 OpenCode

前端**不经过 Python 后端**，直接调用 OpenCode 服务，效率最高：

```
前端 (Vue 3)
   │
   ├── @opencode-ai/sdk ──► OpenCode Server (localhost:4096)
   │     └─ createOpencodeClient()      │
   │                                   ├── MCP → cognee Python (8000/mcp)
   │                                   │         └── 限定 dataset 查询
   │                                   └── SSE 事件流直接推送给前端
   │
   └── axios ──► Python Backend (localhost:8000)
         └─ 知识库管理、数据集列表、用户认证等
```

**实现代码（Vue 3 Composable）**：

```typescript
// frontend/src/composables/useAgentSession.ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { ref, type Ref } from "vue"

const OPENCODE_URL = import.meta.env.VITE_OPENCODE_URL ?? "http://localhost:4096"

export function useAgentSession() {
  const client = createOpencodeClient({
    baseUrl: OPENCODE_URL,
    directory: "/workspace",   // 工作目录，通过 x-opencode-directory header 传递
  })

  const sessionId: Ref<string | null> = ref(null)
  const isStreaming = ref(false)

  /** 创建新会话 */
  const createSession = async (title = "cognee 编码助手") => {
    const resp = await client.session.create({ body: { title } })
    sessionId.value = resp.data!.id
    return resp.data!
  }

  /** 发送消息（携带数据集上下文） */
  const sendMessage = async (
    text: string,
    selectedDatasets: Array<{ id: string; name: string }> = [],
  ) => {
    if (!sessionId.value) {
      await createSession()
    }

    // 构建数据集约束 system prompt
    const system = buildDatasetConstraint(selectedDatasets)

    isStreaming.value = true
    try {
      await client.session.prompt({
        path: { id: sessionId.value! },
        body: {
          system,
          agent: "cognee-coder",
          parts: [{ type: "text", text }],
        },
      })
    } finally {
      isStreaming.value = false
    }
  }

  /** 订阅 Agent 事件流 */
  const subscribeEvents = async (
    onEvent: (event: unknown) => void,
    signal?: AbortSignal,
  ) => {
    for await (const event of client.global.event({ signal })) {
      // 只处理当前会话的事件
      const props = (event as any)?.properties
      if (!sessionId.value || props?.sessionID === sessionId.value) {
        onEvent(event)
      }
    }
  }

  return { sessionId, isStreaming, createSession, sendMessage, subscribeEvents }
}

/** 构建数据集约束的系统提示 */
function buildDatasetConstraint(datasets: Array<{ id: string; name: string }>): string {
  if (datasets.length === 0) {
    return "## 知识库查询约束\n用户未指定数据集，可查询所有有权访问的数据集。"
  }
  return [
    "## 知识库查询约束",
    "调用 search 工具时，datasets 参数必须限定为以下数据集（用数据集名称或 ID）：",
    datasets.map(ds => `- "${ds.name}" (ID: ${ds.id})`).join("\n"),
    "严格遵守此约束，不要查询未列出的数据集。",
  ].join("\n")
}
```

### 13.4 数据集选择器组件

**前端组件**（`frontend/src/components/DatasetSelector.vue`）：

```vue
<template>
  <div class="dataset-selector">
    <q-select
      v-model="selected"
      :options="datasets"
      option-label="name"
      option-value="id"
      multiple
      label="选择知识库数据集（可多选）"
      dense
      filled
      emit-value
      map-options
    >
      <template #prepend>
        <q-icon name="storage" />
      </template>
      <template #selected-item="scope">
        <q-chip
          removable
          @remove="scope.removeAtIndex(scope.index)"
          :label="scope.opt.name"
          size="sm"
          color="primary"
          text-color="white"
        />
      </template>
    </q-select>
    <div v-if="selected.length === 0" class="text-caption text-grey q-mt-xs">
      未选择数据集时，Agent 将查询所有有权访问的数据集
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import axios from "axios"

const selected = defineModel<string[]>({ default: () => [] })
const datasets = ref<Array<{ id: string; name: string }>>([])

onMounted(async () => {
  // 从 Python 后端获取用户有权访问的数据集列表
  const resp = await axios.get("/api/v1/datasets")
  datasets.value = resp.data
})
</script>
```

### 13.5 cognee MCP 工具的数据集参数支持

cognee-code 的 MCP `search` 工具已支持 `datasets` 参数来限定查询范围。Agent 在接收到系统提示中的数据集约束后，应在调用 `search` 时传入对应的数据集名称：

```
# Agent 调用 MCP search 工具时的正确姿势（由 system 约束驱动）
search(
  query="如何处理异步错误",
  search_type="GRAPH_COMPLETION",
  datasets=["项目A文档", "API规范"]   # ← 来自 system 注入的数据集约束
)
```

### 13.6 方案对比总结

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **`system` 字段注入（推荐）** | 每条消息追加系统提示，指导 Agent 调用工具时限定数据集 | 无需修改 OpenCode 核心；Agent 能理解语义并灵活执行 | 依赖 LLM 遵循指令的能力 |
| 修改 OpenCode `extra` 字段 | 在 `PromptInput` 中增加 `extra` 字段，透传到 `Tool.Context` | 类型安全；工具代码直接访问 | 需要修改 OpenCode 核心代码，维护成本高 |
| 自定义 MCP 工具代理 | 在 opencode-agent 中实现代理 MCP，劫持 search 调用注入数据集 | 完全可控 | 复杂度高，需维护代理层 |

**推荐**：使用 `system` 字段注入方案。OpenCode Agent（尤其是 Claude）对系统提示的遵循度非常高，在 `cognee-coder` 的基础 prompt 中也明确要求 Agent 按约束调用工具，实际效果可靠。

---

## 十四、前端 UI 渲染：Quasar QChatMessage + markstream-vue

本节描述如何使用 **Quasar QChatMessage** 和 **markstream-vue** 构建 Agent 对话界面，实现流式 Markdown 渲染、代码高亮、工具调用可视化等功能。

### 14.1 依赖安装

```bash
# 在 cognee-code/frontend/ 目录下执行
yarn add markstream-vue
yarn add @opencode-ai/sdk

# markstream-vue 必须导入 CSS
# 在 src/css/app.scss 或 src/boot/ 中添加：
# import 'markstream-vue/index.css'
```

### 14.2 Quasar QChatMessage 组件概览

Quasar 的 `QChatMessage` 组件提供了气泡式聊天消息展示，关键 props：

| Prop | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 发送者名称 |
| `text` | `string[]` | 文本数组（每个元素一个气泡） |
| `sent` | `boolean` | `true` = 用户消息（靠右），`false` = AI 消息（靠左） |
| `avatar` | `string` | 头像 URL |
| `bg-color` | `string` | 气泡背景色（Quasar 色彩名） |
| `text-color` | `string` | 文字颜色 |
| `stamp` | `string` | 时间戳 |
| `size` | `string` | 气泡宽度（CSS 值，如 `"70%"`） |

`QChatMessage` 的 `default` slot 可替换气泡内容，用于嵌入 markstream-vue 渲染 Markdown。

### 14.3 markstream-vue 核心 API

markstream-vue 的主要导出是 `MarkdownRender`（默认导出），以及 `NodeRenderer` 组件：

| 导出 | 说明 |
|------|------|
| `default` (`MarkdownRender`) | 主渲染组件，接受 `content` 字符串 |
| `NodeRenderer` | 低层节点渲染器，接受 `nodes` 数组或 `content` |
| `enableMermaid()` | 启用 Mermaid 图表渲染 |
| `enableKatex()` | 启用 KaTeX 数学公式渲染 |

**`MarkdownRender` 关键 Props**（来自 `NodeRendererProps`）：

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `content` | `string` | - | Markdown 字符串 |
| `final` | `boolean` | `false` | `true` = 流式结束，停止 loading 状态 |
| `isDark` | `boolean` | `false` | 深色主题 |
| `typewriter` | `boolean` | `true` | 打字机动画效果 |
| `codeBlockStream` | `boolean` | `true` | 代码块流式更新 |
| `renderCodeBlocksAsPre` | `boolean` | `false` | 简化渲染代码块（无 Monaco） |
| `batchRendering` | `boolean` | `true` | 批量渲染，避免大量 flush |

### 14.4 完整 Agent 对话页面（AgentChatPage.vue）

```vue
<template>
  <q-page class="column" style="height: 100vh;">
    <!-- 工具栏：Agent/模型选择 + 数据集选择器 -->
    <q-toolbar class="bg-primary text-white">
      <q-toolbar-title>AI 编码助手</q-toolbar-title>

      <q-select
        v-model="selectedAgent"
        :options="agentOptions"
        dense
        filled
        dark
        label="Agent"
        style="min-width: 140px"
        class="q-mr-sm"
      />

      <DatasetSelector v-model="selectedDatasets" class="q-mr-sm" style="min-width: 200px" />

      <q-chip
        v-if="mcpConnected"
        icon="check_circle"
        color="positive"
        text-color="white"
        label="MCP 已连接"
        dense
      />
      <q-chip
        v-else
        icon="error"
        color="negative"
        text-color="white"
        label="MCP 未连接"
        dense
      />
    </q-toolbar>

    <!-- 消息列表 -->
    <q-scroll-area ref="scrollAreaRef" class="col" style="padding: 16px;">
      <div v-for="msg in messages" :key="msg.id" class="q-mb-sm">
        <!-- 用户消息 -->
        <q-chat-message
          v-if="msg.role === 'user'"
          name="You"
          :text="[msg.text]"
          sent
          bg-color="primary"
          text-color="white"
          size="70%"
        />

        <!-- AI 消息（含 Markdown 渲染） -->
        <q-chat-message
          v-else-if="msg.role === 'assistant'"
          name="cognee-coder"
          avatar="/icons/ai-avatar.svg"
          bg-color="grey-2"
          size="85%"
        >
          <div>
            <!-- 思考过程（可折叠） -->
            <template v-if="msg.reasoning">
              <q-expansion-item
                dense
                icon="psychology"
                label="思考过程"
                class="q-mb-sm text-caption text-grey-7"
              >
                <div class="q-pa-sm text-caption text-grey-8" style="white-space: pre-wrap;">
                  {{ msg.reasoning }}
                </div>
              </q-expansion-item>
            </template>

            <!-- Markdown 主体内容（markstream-vue 渲染） -->
            <MarkdownRender
              v-if="msg.text"
              :content="msg.text"
              :final="msg.final"
              :is-dark="$q.dark.isActive"
              :typewriter="!msg.final"
              :code-block-stream="!msg.final"
              class="agent-markdown"
            />

            <!-- 工具调用列表 -->
            <div v-if="msg.toolCalls?.length" class="q-mt-sm">
              <AgentToolCall
                v-for="tool in msg.toolCalls"
                :key="tool.id"
                :tool="tool"
              />
            </div>

            <!-- 流式加载指示器 -->
            <q-spinner-dots
              v-if="msg.streaming && !msg.text"
              color="primary"
              size="1.5em"
            />
          </div>
        </q-chat-message>
      </div>
    </q-scroll-area>

    <!-- 输入区域 -->
    <div class="q-pa-md bg-white shadow-up-3">
      <q-input
        v-model="inputText"
        type="textarea"
        outlined
        autogrow
        :rows="2"
        placeholder="向 AI 编码助手提问..."
        :disable="isStreaming"
        @keydown.enter.ctrl="sendMessage"
      >
        <template #append>
          <q-btn
            round
            flat
            icon="send"
            color="primary"
            :loading="isStreaming"
            :disable="!inputText.trim()"
            @click="sendMessage"
          />
        </template>
      </q-input>
      <div class="text-caption text-grey q-mt-xs">Ctrl+Enter 发送</div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useQuasar } from 'quasar'
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
import DatasetSelector from 'src/components/DatasetSelector.vue'
import AgentToolCall from 'src/components/AgentToolCall.vue'

const $q = useQuasar()

// ─── 状态 ──────────────────────────────────────────────────────────────────
const inputText = ref('')
const isStreaming = ref(false)
const mcpConnected = ref(false)
const scrollAreaRef = ref()
const selectedAgent = ref('cognee-coder')
const selectedDatasets = ref<string[]>([])

const agentOptions = ['cognee-coder', 'build', 'plan', 'explore', 'general']

interface ToolCallState {
  id: string
  name: string
  state: 'pending' | 'running' | 'completed' | 'error'
  input?: string
  output?: string
  error?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  reasoning?: string
  toolCalls?: ToolCallState[]
  streaming?: boolean
  final?: boolean
}

const messages = ref<Message[]>([])

// ─── OpenCode 客户端 ────────────────────────────────────────────────────────
const OPENCODE_URL = import.meta.env.VITE_OPENCODE_URL ?? 'http://localhost:4096'
const client = createOpencodeClient({ baseUrl: OPENCODE_URL })

let sessionId: string | null = null
let eventAbortController: AbortController | null = null

// ─── 初始化 ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  // 创建会话
  const resp = await client.session.create({ body: { title: 'cognee 编码助手' } })
  sessionId = resp.data!.id

  // 检查 MCP 状态
  try {
    const status = await client.mcp.status()
    mcpConnected.value = !!status.data
  } catch {
    mcpConnected.value = false
  }

  // 开始订阅事件流
  startEventStream()
})

onUnmounted(() => {
  eventAbortController?.abort()
})

// ─── 发送消息 ────────────────────────────────────────────────────────────────
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || !sessionId) return

  inputText.value = ''

  // 添加用户消息
  messages.value.push({
    id: crypto.randomUUID(),
    role: 'user',
    text,
  })

  // 添加 AI 消息占位（流式填充）
  const aiMsgId = crypto.randomUUID()
  messages.value.push({
    id: aiMsgId,
    role: 'assistant',
    text: '',
    streaming: true,
    final: false,
    toolCalls: [],
  })

  isStreaming.value = true
  scrollToBottom()

  try {
    // 构建数据集约束
    const datasetNames = selectedDatasets.value
    const system = datasetNames.length > 0
      ? [
          '## 知识库查询约束',
          '调用 search 工具时，datasets 参数必须限定为以下数据集：',
          datasetNames.map(n => `- "${n}"`).join('\n'),
          '严格遵守此约束，不要查询未列出的数据集。',
        ].join('\n')
      : ''

    await client.session.prompt({
      path: { id: sessionId },
      body: {
        ...(system ? { system } : {}),
        agent: selectedAgent.value,
        parts: [{ type: 'text', text }],
      },
    })
  } catch (e) {
    const msg = messages.value.find(m => m.id === aiMsgId)
    if (msg) {
      msg.text = '发生错误，请重试。'
      msg.streaming = false
      msg.final = true
    }
    isStreaming.value = false
  }
}

// ─── 事件流处理 ──────────────────────────────────────────────────────────────
function startEventStream() {
  eventAbortController = new AbortController()

  ;(async () => {
    try {
      for await (const event of client.global.event({ signal: eventAbortController!.signal })) {
        handleEvent(event as any)
      }
    } catch {
      // AbortError: 正常关闭
    }
  })()
}

function handleEvent(event: any) {
  const props = event?.properties
  if (!props || props.sessionID !== sessionId) return

  const aiMsg = messages.value.findLast(m => m.role === 'assistant')
  if (!aiMsg) return

  switch (event.type) {
    case 'message.part.updated': {
      const part = props.part
      if (!part) break

      if (part.type === 'text' && part.text != null) {
        aiMsg.text = part.text
        scrollToBottom()
      } else if (part.type === 'reasoning' && part.text != null) {
        aiMsg.reasoning = part.text
      } else if (part.type === 'tool') {
        updateToolCall(aiMsg, part)
      }
      break
    }

    case 'session.idle': {
      // Agent 本轮完成
      if (aiMsg) {
        aiMsg.streaming = false
        aiMsg.final = true
      }
      isStreaming.value = false
      scrollToBottom()
      break
    }

    case 'session.error': {
      if (aiMsg) {
        aiMsg.text += '\n\n**错误**: ' + (props.error?.message ?? '未知错误')
        aiMsg.streaming = false
        aiMsg.final = true
      }
      isStreaming.value = false
      break
    }
  }
}

function updateToolCall(msg: Message, part: any) {
  if (!msg.toolCalls) msg.toolCalls = []
  const existing = msg.toolCalls.find(t => t.id === part.id)
  if (existing) {
    existing.state = part.state ?? existing.state
    if (part.output != null) existing.output = JSON.stringify(part.output, null, 2)
    if (part.error != null) existing.error = String(part.error)
  } else {
    msg.toolCalls.push({
      id: part.id ?? crypto.randomUUID(),
      name: part.tool ?? '未知工具',
      state: part.state ?? 'pending',
      input: part.input ? JSON.stringify(part.input, null, 2) : undefined,
    })
  }
}

async function scrollToBottom() {
  await nextTick()
  scrollAreaRef.value?.setScrollPercentage('vertical', 1.0)
}
</script>

<style lang="scss" scoped>
// markstream-vue 在气泡内的样式覆盖
.agent-markdown {
  font-size: 14px;
  line-height: 1.6;
  color: $dark;

  :deep(pre) {
    border-radius: 8px;
    margin: 8px 0;
  }

  :deep(code) {
    font-family: 'JetBrains Mono', monospace;
  }

  :deep(p) {
    margin: 4px 0;
  }
}
</style>
```

### 14.5 工具调用可视化组件（AgentToolCall.vue）

```vue
<template>
  <q-expansion-item
    :icon="toolIcon"
    :label="toolLabel"
    :header-class="headerClass"
    dense
    class="q-mb-xs tool-call-item"
  >
    <q-card flat bordered>
      <q-card-section class="q-pa-sm">
        <!-- 工具输入参数 -->
        <div v-if="tool.input" class="q-mb-sm">
          <div class="text-caption text-grey-6 q-mb-xs">输入参数</div>
          <pre class="tool-code">{{ tool.input }}</pre>
        </div>

        <!-- 工具输出（completed 状态） -->
        <div v-if="tool.state === 'completed' && tool.output">
          <div class="text-caption text-grey-6 q-mb-xs">输出结果</div>
          <pre class="tool-code">{{ truncate(tool.output, 500) }}</pre>
        </div>

        <!-- 工具错误（error 状态） -->
        <q-banner v-if="tool.state === 'error'" dense class="bg-negative text-white">
          <template #avatar><q-icon name="error" /></template>
          {{ tool.error ?? '工具执行失败' }}
        </q-banner>

        <!-- 运行中指示器 -->
        <q-linear-progress
          v-if="tool.state === 'running'"
          indeterminate
          color="primary"
          class="q-mt-xs"
        />
      </q-card-section>
    </q-card>
  </q-expansion-item>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface ToolCallState {
  id: string
  name: string
  state: 'pending' | 'running' | 'completed' | 'error'
  input?: string
  output?: string
  error?: string
}

const props = defineProps<{ tool: ToolCallState }>()

// 工具图标映射
const TOOL_ICONS: Record<string, string> = {
  bash: 'terminal',
  read: 'description',
  write: 'edit',
  edit: 'edit',
  glob: 'folder_open',
  grep: 'search',
  webfetch: 'public',
  cognify: 'hub',
  search: 'manage_search',
  write_memory: 'save',
  read_memory: 'memory',
  save_interaction: 'bookmark',
}

const toolIcon = computed(() => TOOL_ICONS[props.tool.name] ?? 'build')

const toolLabel = computed(() => {
  const stateLabel = {
    pending: '等待中',
    running: '执行中...',
    completed: '已完成',
    error: '执行失败',
  }[props.tool.state]
  return `${props.tool.name}  (${stateLabel})`
})

const headerClass = computed(() => ({
  'text-primary': props.tool.state === 'running',
  'text-positive': props.tool.state === 'completed',
  'text-negative': props.tool.state === 'error',
  'text-grey': props.tool.state === 'pending',
}))

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '\n...(截断)' : text
}
</script>

<style lang="scss" scoped>
.tool-call-item {
  border: 1px solid $grey-3;
  border-radius: 4px;
}

.tool-code {
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  background: $grey-1;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
```

### 14.6 markstream-vue 全局初始化（Boot 文件）

在 `frontend/src/boot/markstream.ts` 中初始化：

```typescript
// frontend/src/boot/markstream.ts
import { boot } from 'quasar/wrappers'
import 'markstream-vue/index.css'

// 按需启用可选功能（需要安装对应 peer 依赖）
// import { enableMermaid, enableKatex } from 'markstream-vue'
// enableMermaid()  // 需要: yarn add mermaid
// enableKatex()   // 需要: yarn add katex

export default boot(() => {
  // markstream-vue 无需显式注册，直接按需 import 即可
})
```

在 `quasar.config.ts` 中注册 boot 文件：

```typescript
// quasar.config.ts
boot: [
  'axios',
  'markstream',  // 新增
],
```

### 14.7 路由注册

在 `frontend/src/router/routes.ts` 中添加 Agent 对话页面：

```typescript
{
  path: '/agent',
  component: () => import('layouts/MainLayout.vue'),
  children: [
    {
      path: '',
      name: 'agent-chat',
      component: () => import('pages/AgentChatPage.vue'),
      meta: { title: 'AI 编码助手', requiresAuth: true },
    },
  ],
},
```

### 14.8 渲染架构总结

```
AgentChatPage.vue
├── QToolbar
│   ├── QSelect (Agent 选择)
│   ├── DatasetSelector.vue  → 限定 MCP search 范围
│   └── MCP 状态 Chip
├── QScrollArea（消息列表）
│   ├── QChatMessage [sent]    → 用户消息（纯文本）
│   └── QChatMessage [received]
│       ├── QExpansionItem     → 思考过程（reasoning part）
│       ├── MarkdownRender     → AI 文字输出（text part）
│       │   └── markstream-vue → 流式 Markdown + 代码高亮
│       └── AgentToolCall.vue  → 工具调用列表（tool part）
│           ├── 工具名 + 状态图标
│           ├── 输入参数 (pre)
│           └── 输出结果 (pre) / 错误信息 / 进度条
└── QInput（输入框）+ 发送按钮
```

**流式渲染流程**：
1. 用户发送消息 → `client.session.prompt()`（携带 `system` 数据集约束）
2. SSE 事件流 `message.part.updated` → 实时更新 `msg.text`
3. `MarkdownRender :content="msg.text" :final="false"` → 流式 Markdown 渲染（打字机效果）
4. `session.idle` 事件 → 设置 `:final="true"` → markstream-vue 完成渲染

---

## 附录 A：`@opencode-ai/sdk` 完整 API 参考

### 服务端（`@opencode-ai/sdk/server`）

```typescript
// 启动 opencode serve 进程
const server = await createOpencodeServer({
  hostname?: string,      // 默认 "127.0.0.1"
  port?: number,          // 默认 4096
  timeout?: number,       // 默认 5000ms，等待进程就绪的超时
  signal?: AbortSignal,   // 用于取消启动或停止服务
  config?: Config,        // OpenCode 配置（通过 OPENCODE_CONFIG_CONTENT 注入）
})
// 返回 { url: string, close(): void }

// 启动 TUI 交互终端
const tui = createOpencodeTui({
  project?: string,
  model?: string,
  session?: string,
  agent?: string,
  signal?: AbortSignal,
  config?: Config,
})
// 返回 { close(): void }

// 一键创建 server + client
const { client, server } = await createOpencode(options?: ServerOptions)
```

### 客户端（`@opencode-ai/sdk/client`）

```typescript
const client = createOpencodeClient({
  baseUrl: string,
  directory?: string,   // 通过 x-opencode-directory header 传递
  // ...httpx 配置
})

// Session API
client.session.list()
client.session.create({ body: { title, directory } })
client.session.get({ path: { id } })
client.session.delete({ path: { id } })
client.session.prompt({ path: { id }, body: { parts, model, agent } })
client.session.messages({ path: { id } })

// Agent API
client.app.agents()

// MCP API
client.mcp.status()
client.mcp.add({ body: { name, config } })

// 事件流
for await (const event of client.global.event()) { ... }

// Config API
client.config.get()
client.config.providers()
```

## 附录 B：SSE 事件类型参考

| 事件类型 | 触发时机 | 关键字段 |
|---------|---------|---------|
| `message.part.updated` | Agent 输出更新 | `part.type`, `part.text`, `part.state` |
| `permission.asked` | Agent 请求危险操作权限 | `request.tool`, `request.args` |
| `session.diff` | Agent 修改了文件 | `summary.additions`, `summary.deletions`, `summary.files` |
| `session.idle` | Agent 完成当前轮次 | `sessionID` |
| `session.error` | Agent 执行出错 | `error.message` |
