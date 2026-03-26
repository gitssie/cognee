# M9-2 OpenCode Plugin — Project / Dataset / Rules 集成设计

> 本文档描述如何通过 `@opencode-ai/plugin` 将 cognee-code 的 **Project → Dataset（知识库）→ Rules（编码规则）** 三层结构与 OpenCode Agent 深度集成，实现基于当前项目自动识别并注入编码规则的能力。

---

## 一、背景与目标

### 1.1 现有系统结构

cognee-code 后端已实现三层知识结构：

| 层级 | 实体 | 关键字段 |
|------|------|---------|
| **Project** | `projects` 表 | `id`, `name`, `opencode_project_id`, `remote_url`, `local_path`, `dataset_id` |
| **Dataset** | `datasets` 表（cognee 原生） | 每个 project 对应一个，通过 `create_authorized_dataset(name, user)` 创建 |
| **Rules** | cognee 知识图谱（graph DB） | `NodeSet("coding_agent_rules")`，在 project 的 dataset DB context 下 |

Project 的关键匹配字段：
- `opencode_project_id`：OpenCode 生成的项目 ID（git 根提交哈希），跨分支/worktree 稳定
- `remote_url`：git remote origin URL（旧字段，仍保留）
- `local_path`：本地路径（旧字段，仍保留）

### 1.2 OpenCode Project ID 机制

OpenCode 的 `project.id` 由 `git rev-list --max-parents=0 --all` 生成（git 根提交哈希），具有以下特性：

- **跨分支稳定**：同一仓库的任何分支都有相同的根提交哈希
- **跨 worktree 稳定**：同一仓库的所有 worktree 共享同一 `project.id`
- **全局唯一**：不同仓库几乎不可能有相同的根提交哈希

### 1.3 Plugin 运行上下文

OpenCode Plugin 的 `PluginInput` 提供了项目信息：

```typescript
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project          // OpenCode 自身的 project 对象
  directory: string         // 当前工作目录（session 级别）
  worktree: string          // git worktree 根目录
  serverUrl: URL
  $: BunShell
}
```

**`input.project.id`** 是 Plugin 识别当前代码项目的关键输入（根提交哈希）。

### 1.4 核心思路：通过 opencode_project_id 直查 Project

Plugin 在初始化时，直接用 `input.project.id` 查询 cognee-code 后端：

```
Plugin 初始化
    │
    ├── 读取 input.project.id（根提交哈希）
    ├── 调用 GET /api/v1/projects?opencode_project_id=<id>
    └── 获得匹配的 Project（或 null）
              │
              ▼
         找到匹配 Project → 缓存 (opencodeProjectId → project, 5 min TTL)
```

---

## 二、数据流设计

```
OpenCode Agent 启动（input.project.id = "abc123..."）
        │
        ▼ Plugin 初始化
          └── GET /api/v1/projects?opencode_project_id=abc123
               → 找到 Project { id: "xxx", name: "myapp", dataset_id: "yyy" }
        │
        ▼ 用户发送消息
        │
        ▼ Hook: experimental.chat.system.transform
          ├── 1. GET /api/v1/rules?project_id=xxx → 获取编码规则列表（5 min 缓存）
          ├── 2. 将规则注入 system prompt（硬约束）
          └── 3. 注入 dataset 知识库搜索提示（告知 LLM 可用的 dataset 名称）
        │
        ▼ LLM 生成代码（自动遵守编码规则，可主动调用 search 工具）
```

---

## 三、Backend API

### 3.1 已有接口

| 接口 | 用途 |
|------|------|
| `GET /api/v1/projects?opencode_project_id={id}` | 通过 OpenCode project ID 直查 project |
| `GET /api/v1/rules?project_id={id}` | 获取指定 project 的编码规则 |
| `POST /api/v1/auth/login` | 登录，返回 `Set-Cookie: auth_token=...` |

### 3.2 接口返回格式

```typescript
// GET /api/v1/projects 返回
interface ProjectOut {
  id: string                     // UUID
  name: string
  type: string
  opencode_project_id: string | null  // 新增字段
  remote_url: string | null
  local_path: string | null
  dataset_id: string             // UUID
  owner_id: string
  created_at: string
  updated_at: string
}

// GET /api/v1/rules?project_id=xxx 返回
interface RuleItem {
  id: string           // UUID
  text: string
}
```

### 3.3 认证方式

后端使用 **Cookie Transport**（非 Bearer Token）：

1. `POST /api/v1/auth/login` with `application/x-www-form-urlencoded` (`username` + `password`)
2. 响应头 `Set-Cookie: auth_token=<value>; ...`
3. 后续请求携带 `Cookie: auth_token=<value>`

环境变量：
- `COGNEE_API_URL`（默认 `http://localhost:8000`）
- `COGNEE_API_EMAIL`（默认 `default_user@example.com`）
- `COGNEE_API_PASSWORD`（默认 `default_password`）
- `AUTH_TOKEN_COOKIE_NAME`（默认 `auth_token`）

---

## 四、Plugin 实现

### 4.1 目录结构

```
cognee-code/opencode-agent/src/plugin/
├── message-v2.d.ts                # 类型声明
├── index.ts                       # Plugin 主入口
├── cognee-client.ts               # cognee REST API 客户端（含 cookie 认证）
└── hooks/
    └── system-transform.ts        # Hook: 注入 Rules + Dataset 提示
```

> `git-resolver.ts` 已删除 — 不再需要 git URL 匹配，直接使用 `opencode_project_id`。

### 4.2 cognee API 客户端（cognee-client.ts）

核心功能：

```typescript
// Cookie-based authentication with auto-retry on 401
async function apiFetch(url: string, init?: RequestInit): Promise<Response>

// Direct project lookup by OpenCode project id (5 min TTL cache)
export async function resolveProject(opencodeProjectId: string): Promise<ProjectItem | null>

// Fetch coding rules for a project
export async function getRulesByProjectId(projectId: string): Promise<RuleItem[]>
```

认证流程：
1. 首次调用时 `login()` → 提取并缓存 `auth_token` cookie
2. 后续请求携带缓存 cookie
3. 收到 401 时，清除缓存，重新 `login()`，然后重试原请求

### 4.3 system.transform Hook（hooks/system-transform.ts）

```typescript
export function createSystemTransformHook(
  opencodeProjectId: string,
): NonNullable<Hooks["experimental.chat.system.transform"]>
```

注入内容：
1. **编码规则（硬约束）** — `## Coding Rules (MUST follow)`，每条规则以编号列出
2. **知识库搜索提示（软上下文）** — 告知 LLM 可用的 dataset 和 `search` MCP 工具用法

缓存：rules 按 `projectId` 缓存 5 分钟（TTL）。

Project 未匹配时静默跳过（`if (!project) return`）。

### 4.4 Plugin 主入口（index.ts）

```typescript
export const CogneeProjectPlugin: Plugin = async (input) => {
  return {
    "experimental.chat.system.transform": createSystemTransformHook(input.project.id),
  }
}
```

### 4.5 config.ts 注册

```typescript
// cognee-code/opencode-agent/src/config.ts
plugin: [`file://${join(__dirname, "plugin", "index.ts")}`],
```

---

## 五、前端集成

### 5.1 opencode_project_id 字段

用户在前端创建项目时可以填写 `opencode_project_id`，填入 OpenCode 显示的项目 ID（git 根提交哈希）。

这样同一仓库在任意分支/worktree 下启动 OpenCode，都能自动匹配到该 cognee-code Project，无需手动配置。

### 5.2 前端 system-reminder 的角色调整

有了 Plugin 自动注入机制后，前端的 `<system-reminder>` 块职责变化：

| 职责 | 改变前 | 改变后 |
|------|--------|--------|
| Rules 注入 | 不做（依赖 LLM 主动 search） | **由 Plugin 自动注入**（硬约束） |
| Dataset 提示 | 通过 `<system-reminder>` 告知 LLM | Plugin 也会注入，两者互补 |
| search 工具提示 | `<system-reminder>` 提供 Usage 示例 | Plugin system prompt 也提供，冗余但无害 |

**结论**：前端 `<system-reminder>` 可保留（兜底），无需修改。Plugin 的注入与前端 reminder 是互补关系。

---

## 六、Project 未注册时的回退行为

当 `resolveProject` 找不到匹配 project 时：

1. Plugin 跳过 Rules 注入（静默返回）
2. 前端 `<system-reminder>` 仍然生效（用户手动选择的 dataset）
3. MCP `search` 工具仍然可用

---

## 七、与其他 M9 文档的关系

| 文档 | 重点 |
|------|------|
| **M9-agent-memory-plugin.md** | 通用记忆系统：`tool-after` 保存 tool 输出、`session.compacting` 保存摘要 |
| **M9-1-memory-design.md** | 记忆架构理论：分层记忆、Reflector、时间权重 |
| **本文档 (M9-2)** | 通过 opencode_project_id 识别 Project，自动注入该 Project 的 Rules 作为硬约束 |

**建议实施顺序**：先实现 M9-2（依赖的后端 API 已就绪，业务价值最直接），再叠加 M9-agent-memory-plugin.md 的通用记忆能力。
