# cognee-code 项目知识库

## 1. 项目概述

cognee-code 是一个 AI 辅助开发平台，包含 4 个服务：

| 服务 | 技术栈 | 端口 | 说明 |
|------|--------|------|------|
| `server` | FastAPI + cognee 核心引擎 | 8000 | REST API + MCP |
| `frontend` | Vue 3 + Quasar + nginx | 3000 | SPA + 反向代理 |
| `opencode-agent` | Bun + microsandbox VM | 3005 | 用户隔离执行环境 |
| `muninn` | MuninnDB-FAISS | 8474-8477 | 向量数据库 + 认知记忆 |

## 2. 目录结构

```
cognee-code/
├── docker-compose.yml       # 统一部署编排
├── data/                    # 持久化数据（bind mount，不入 git）
│   ├── server/              #   服务端数据 (SQLite、文件)
│   ├── muninn/              #   MuninnDB 数据
│   └── agent/               #   OpenCode agent 状态
├── server/                  # FastAPI 后端
│   ├── src/main.py          #   应用入口 + lifespan
│   ├── src/modules/
│   │   ├── knowledge/       #   知识库 (dataset、cognify、SSE)
│   │   ├── projects/        #   项目管理
│   │   ├── mcp/             #   MCP 服务端
│   │   ├── muninn/          #   MuninnDB 管理 (vault 自动配置)
│   │   └── rules/           #   规则管理
│   ├── .env                 #   环境变量（真源头）
│   └── Dockerfile
├── frontend/                # Quasar SPA
│   ├── src/
│   │   ├── boot/            #   启动钩子 (axios、SSE 事件总线)
│   │   ├── components/      #   可复用组件
│   │   ├── layouts/         #   布局 (MainLayout)
│   │   ├── pages/           #   页面
│   │   ├── router/          #   路由 + 鉴权守卫
│   │   └── services/        #   API 调用层
│   ├── nginx.conf           #   nginx 反向代理配置
│   └── Dockerfile
├── opencode-agent/          # 沙箱代理
│   ├── opencode-router.json #   MCP 配置 → server:8000/mcp/
│   └── .env.local
└── docs/                    # 需求文档 + API 文档
    ├── functional-requirements.md
    └── vault-management-api.md
```

## 3. 构建 & 运行

### 3.1 完整启动

```bash
cd cognee-code
docker compose build --no-cache server   # server 依赖 core cognee 源码
docker compose up -d                     # 启动全部 4 个服务
```

### 3.2 单独开发前端

```bash
cd frontend
yarn install
yarn dev                                 # 默认 localhost:9000
```

### 3.3 单独开发后端

```bash
cd server
uv sync --dev --all-extras --reinstall
# 注意：server 以 local path 依赖 ../cognee，修改 core 后需重装
uv sync --dev --all-extras --reinstall-package cognee
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

## 4. 环境变量（关键项）

文件：`server/.env`

| 变量 | 值 | 说明 |
|------|----|------|
| `LLM_API_KEY` | DeepSeek API key | LLM 调用 |
| `LLM_MODEL` | `openai/deepseek-chat` | 模型 |
| `LLM_ENDPOINT` | `https://api.deepseek.com` | API 地址 |
| `EMBEDDING_PROVIDER` | `gemini` | 嵌入模型 |
| `VECTOR_DB_PROVIDER` | `muninn` | 向量数据库 |
| `VECTOR_DB_URL` | `http://localhost:8476` | compose 中覆盖为 `http://muninn:8476` |
| `VECTOR_DB_KEY` | （空） | vault 自动公开时无需 key |
| `DATA_ROOT_DIRECTORY` | `/app/data/data` | 数据文件路径 |
| `SYSTEM_ROOT_DIRECTORY` | `/app/data/system` | 系统文件（含 SQLite） |
| `MUNINN_ADMIN_USERNAME` | `root` | MuninnDB 管理员 |
| `MUNINN_ADMIN_PASSWORD` | `password` | MuninnDB 管理员密码 |
| `DEFAULT_USER_EMAIL` | `default_user@example.com` | 默认登录用户 |
| `DEFAULT_USER_PASSWORD` | `default_password` | 默认登录密码 |

**注意：** `DATA_ROOT_DIRECTORY` 和 `SYSTEM_ROOT_DIRECTORY` 必须指向容器内 `/app/data/` 挂载点，否则容器重建后数据丢失。

## 5. 数据持久化

所有持久化数据通过 bind mount 存储在 `cognee-code/data/`：

```yaml
# docker-compose.yml
volumes:
  - ./data/server:/app/data    # server SQLite + 文件
  - ./data/muninn:/data        # MuninnDB 向量数据
  - ./data/agent:/home/opencode-agent  # Agent 状态
```

`data/` 目录已加入 `.gitignore`。

## 6. MuninnDB Vault 管理

### 6.1 问题
MuninnDB 默认新 vault 为 "fail-closed"（锁定），需要 API key 才能写入。直接 cognify 会报 `VAULT_LOCKED`。

### 6.2 解决方案
server 在 cognify 启动前自动调用 MuninnDB admin API 将 vault 设为 public：

- **登录**: `POST http://muninn:8476/api/auth/login` (`root/password`)
- **公开 vault**: `PUT http://muninn:8475/api/admin/vaults/config` `{"public":true}`
- **实现**: `server/src/modules/muninn/admin.py` → `ensure_vault_public()`
- **调用点**: `server/src/modules/knowledge/cognify_router.py` cognify 之前

### 6.3 前端
创建数据集时 vault API key 为**可选**：
- 留空 → server 自动公开 vault
- 填入 → 使用 key 进行访问控制

## 7. 认证与鉴权

### 7.1 登录流程
- FastAPI-Users + CookieTransport
- `POST /api/v1/auth/login`（`application/x-www-form-urlencoded`）
- 成功返回 `Set-Cookie: auth_token=...`
- 前端 axios 配置 `withCredentials: true`

### 7.2 前端路由守卫
- `frontend/src/router/routes.ts`: 主路由设 `meta: { requiresAuth: true }`
- `frontend/src/router/index.ts`: `beforeEach` 检查登录状态，未登录跳 `/login`

### 7.3 SSE 事件总线
- `frontend/src/boot/sse.ts`: 启动时注入 `EventBus`，监听 `auth:login` 启动 SSE
- `frontend/src/pages/LoginPage.vue`: 登录成功 emit `auth:login`

## 8. 错误处理

### 8.1 Pipeline 错误透传
- `PipelineRunErrored` 新增 `error: Optional[str]` 字段
- `run_tasks.py` / `run_tasks_data_item.py` 填充 `error=str(error)`
- SSE shim (`server/src/main.py`) 透传 `error` 到前端
- 前端 `KnowledgePage.vue` 显示具体错误信息

### 8.2 前端服务
- 所有 service 使用 `axios.defaults.baseURL = '/'`（同源相对路径）
- 不依赖 `VITE_API_URL`

## 9. MCP 配置

文件：`opencode-agent/opencode-router.json`
```json
{
  "mcp": {
    "cognee": {
      "type": "remote",
      "url": "http://localhost:8000/mcp/"
    }
  }
}
```

## 10. 已知问题 & 注意事项

1. **Server 依赖 core cognee**：修改 `/root/workspace/github/cognee/cognee/` 后需重装
   ```bash
   cd server && uv sync --reinstall-package cognee
   ```
2. **Docker 构建前确保 core 修改已提交**：Dockerfile 从 `..` context 复制整个仓库
3. **MuninnDB 默认端口 8476** 同时提供 REST API 和 Web UI
4. **登录默认用户** 在 server lifespan 中 `create_default_user()` 自动创建
5. **MuninnDB vault 命名**：cognify 时通过 `get_dataset()` 查找真实 dataset name，与 `_resolve_dataset_vault_name()` 保持一致
6. **前端 cognify payload**：使用 `chunks_per_batch`（非 `chunkSize`/`chunkOverlapRatio`），对齐后端 `CognifyPayload`
7. **前端路由**：只有一个 `/` 路由（带 `requiresAuth: true`），去掉重复的无鉴权路由
8. **CORS**：`allow_origins` 只含 localhost（9000/3000/8000），不再包含 `*`
9. **前端 base URL**：所有 service 使用相对路径 `/api/v1`（由 nginx 代理），不硬编码 `localhost:8000`
10. **Rules 模块**：全局 context 使用 save/restore 模式，避免跨请求污染
11. **ACL 路由**：`get_tenant_users`、`get_dataset_permissions`、`revoke_permission` 增加权限校验
12. **Settings 页面**：只显示 `/api/v1/config` 返回的 `vector_db_provider`，移除 LLM/embedding 虚假字段
13. **Legacy knowledge API**：`routers.py` 已标记 DEPRECATED，未挂载到 main.py
14. **MuninnDB embedder**：通过 `MUNINN_VOYAGE_KEY` 环境变量配置，自动加载 Voyage AI
