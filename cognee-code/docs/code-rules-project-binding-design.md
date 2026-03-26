# Code Rules 项目绑定设计方案（修订版 v3.1）

> 模块：M3 Code Rule Management 扩展  
> 版本：v3.1  
> 日期：2026-02-28  

---

## 1. 背景与问题

### 1.1 当前实现的问题

1. **规则无隔离**：`rules/service.py` 调用图数据库前没有设置 dataset 上下文，所有规则写入同一个全局 KuzuDB 文件
2. **项目状态仅在浏览器**：项目列表存储在 `localStorage`，换浏览器后丢失，无法多用户共享
3. **UI 语义错误**：`RuleManager.vue` 将"项目（Project）"与"规则（Rules）"混为一谈；实际上 Project 是顶层概念，文档（Documents）和规则（Rules）都是 Project 下的子资源

### 1.2 设计目标

1. **Project 是独立概念**，不强绑定 git_url，可以是任何类型
2. **每个 Project 有自己的 Dataset**（独立图 DB + 向量 DB）
3. **NodeSet 统一命名** `"coding_agent_rules"`，依靠物理 DB 文件隔离，无需名字区分
4. **项目列表持久化在服务端**（自定义 SQLite 表）
5. **删除 Project 时级联删除** Dataset 和图中规则

---

## 2. 技术基础

### 2.1 cognee Dataset 隔离机制

每个 cognee Dataset 在 `ENABLE_BACKEND_ACCESS_CONTROL=True` 时拥有独立的：
- KuzuDB 图数据库文件：`databases/{user_id}/{dataset_id}.pkl`
- LanceDB 向量数据库命名空间

通过 `set_database_global_context_variables(dataset_id, owner_id)` 切换当前 async task 的数据库上下文（`ContextVar` 实现，仅影响当前 async task）。

> 服务端 `.env` 已配置 `ENABLE_BACKEND_ACCESS_CONTROL=True`，隔离机制**完全可用**。

### 2.2 复用同一 SQLite 的方式

自定义表使用 cognee 同一个 `Base`（`cognee.infrastructure.databases.relational.ModelBase.Base`）和同一个 SQLite 文件（`cognee_db`），在 `lifespan` 启动时 `create_all` 创建，**零侵入 cognee 核心**。

---

## 3. 数据模型

### 3.1 Project 定义

Project 是顶层工作域，可以是：

| type | 含义 | 额外字段 |
|------|------|---------|
| `git` | Git 远程仓库 | `remote_url` |
| `file` | 本地文件系统路径 | `local_path` |
| `general` | 任意命名的知识域 | — |

每个 Project **持有一个专属 cognee Dataset**（`dataset_id`），该 Dataset 负责管理独立的图 / 向量数据库。

Project 下的两种子资源：
- **Documents**：通过 cognee 核心 Add → Cognify 流程上传到该 Dataset
- **Rules**：通过 `add_rule_associations` 写入该 Dataset 的图 DB（NodeSet `"coding_agent_rules"`）

### 3.2 新增表：`cc_projects`

```
cc_projects
├── id          : UUID, PK
├── name        : TEXT, NOT NULL                     -- 用户自定义显示名称
├── type        : TEXT, NOT NULL, DEFAULT 'general'  -- 'git' | 'file' | 'general'
├── remote_url  : TEXT, NULLABLE                     -- Git remote URL（type=git）
├── local_path  : TEXT, NULLABLE                     -- 本地路径（type=file）
├── dataset_id  : UUID, NOT NULL, INDEX              -- 关联 datasets.id（逻辑引用，无 FK 约束）
├── owner_id    : UUID, NOT NULL, INDEX              -- 关联 principals.id（逻辑引用，无 FK 约束）
├── created_at  : DATETIME
└── updated_at  : DATETIME

唯一约束：(owner_id, name)
```

> `dataset_id` / `owner_id` 不加外键约束，原因：SQLite FK 支持有限，且我们不控制 cognee 迁移顺序。

### 3.3 规则在图 DB 中的存储

```
每个 Project → 一个 cognee Dataset → 一个独立 KuzuDB 文件：
  databases/{user_id}/{dataset_id}.pkl
    └── NodeSet "coding_agent_rules"   ← 统一名称，物理隔离
         ├── Rule { id, text }
         └── ...
```

---

## 4. API 设计

### 4.1 项目管理 API（新增）

挂载到 `/api/v1/projects`：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v1/projects` | 列出当前用户的所有项目 |
| POST | `/api/v1/projects` | 创建项目（自动创建 Dataset） |
| PATCH | `/api/v1/projects/{id}` | 更新项目名称 / URL |
| DELETE | `/api/v1/projects/{id}` | 删除项目（级联删除 Dataset + 图规则） |

**POST 请求体示例：**

```json
{ "name": "Backend API", "type": "git", "remote_url": "https://github.com/org/repo" }
{ "name": "My Notes",    "type": "file", "local_path": "/home/user/notes" }
{ "name": "General",     "type": "general" }
```

**响应：**

```json
{
  "id": "uuid",
  "name": "Backend API",
  "type": "git",
  "remote_url": "https://github.com/org/repo",
  "local_path": null,
  "dataset_id": "uuid",
  "owner_id": "uuid",
  "created_at": "2026-02-28T..."
}
```

### 4.2 Rules API（修改）

`git_remote_url` 参数改为 `project_id`：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v1/rules?project_id=<uuid>` | 获取项目规则（省略 = 全局） |
| POST | `/api/v1/rules` | 添加规则 |
| DELETE | `/api/v1/rules/{rule_id}?project_id=<uuid>` | 删除规则 |

**POST 请求体：**
```json
{ "text": "Use async/await for all I/O operations", "project_id": "uuid" }
```
`project_id` 为 `null` 时操作全局规则（不切换 dataset 上下文）。

---

## 5. 后端实现步骤

### 5.1 新增 `src/modules/projects/` 模块

```
src/modules/projects/
├── __init__.py
├── models.py      ← SQLAlchemy ORM（cc_projects 表）
├── service.py     ← DB 操作 + Dataset 联动
└── router.py      ← FastAPI CRUD
```

**models.py 关键代码：**

```python
from cognee.infrastructure.databases.relational.ModelBase import Base

class Project(Base):
    __tablename__ = "cc_projects"
    id = Column(UUID, primary_key=True, default=uuid4)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False, default="general")
    remote_url = Column(String, nullable=True)
    local_path = Column(String, nullable=True)
    dataset_id = Column(UUID, nullable=False, index=True)
    owner_id = Column(UUID, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), ...)
    updated_at = Column(DateTime(timezone=True), ...)
    __table_args__ = (UniqueConstraint("owner_id", "name"),)
```

**service.py 关键逻辑：**

```python
from cognee.context_global_variables import set_database_global_context_variables

async def create_project(owner_id, name, type_, remote_url=None, local_path=None):
    # 1. 为该 project 创建专属 cognee Dataset
    #    Dataset name 用确定性 uuid5，保证幂等
    dataset_name = f"project:{owner_id}:{name}"
    dataset = await get_or_create_dataset(dataset_name, user)

    # 2. 写入 cc_projects
    project = Project(dataset_id=dataset.id, ...)
    ...

async def delete_project(project_id, owner_id):
    project = await get_project(project_id, owner_id)
    # 级联删除：先删图中规则
    await set_database_global_context_variables(project.dataset_id, owner_id)
    graph_engine = await get_graph_engine()
    await graph_engine.delete_nodeset("coding_agent_rules")
    # 再删 cognee Dataset（会级联删 DatasetDatabase 记录）
    await delete_dataset(project.dataset_id)
    # 最后删 cc_projects 记录
    ...
```

### 5.2 修改 `src/modules/rules/service.py`

```python
async def get_rules_with_ids(project_id: Optional[UUID], user_id: UUID):
    if project_id:
        project = await get_project_by_id(project_id, user_id)
        await set_database_global_context_variables(project.dataset_id, user_id)
    graph_engine = await get_graph_engine()
    # NodeSet 名称始终是 "coding_agent_rules"
    nodes_data, _ = await graph_engine.get_nodeset_subgraph(
        node_type=NodeSet, node_name=["coding_agent_rules"]
    )
    ...
```

### 5.3 在 `main.py` lifespan 中建表

```python
await setup()  # cognee 核心表先建

# 导入确保 Project 模型注册到 Base.metadata
from src.modules.projects.models import Project  # noqa: F401
from cognee.infrastructure.databases.relational.ModelBase import Base
from cognee.infrastructure.databases.relational import get_relational_engine

engine = await get_relational_engine()
async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)
```

---

## 6. 前端 UI 重构

### 6.1 导航变更

侧边栏 "Code Rules"（`/rules`）改为 **"Projects"**（`/projects`），图标改为 `folder_special`，Module 标记 M3。

```
旧：/rules → CodeRulesPage.vue → RuleManager.vue
新：/projects → ProjectsPage.vue（项目管理主页面）
```

### 6.2 页面结构

```
ProjectsPage.vue
├── 左侧面板：项目列表（ProjectSidebar.vue）
│   ├── 搜索框
│   ├── "+ New Project" 按钮
│   └── 项目列表（每项显示 name + type 图标）
└── 右侧面板：项目详情（ProjectDetail.vue）
    ├── 顶部工具栏：项目名称 + type badge + 操作按钮
    └── 选项卡（q-tabs）
        ├── Documents（文档）  ← 复用现有 DataList.vue 逻辑
        └── Rules（编码规则）  ← 迁移自 RuleManager.vue 的规则列表部分
```

### 6.3 组件拆分

```
src/components/projects/
├── ProjectSidebar.vue     ← 项目列表 + 新建对话框
├── ProjectDetail.vue      ← 选项卡容器
├── ProjectDocuments.vue   ← 文档列表（复用 DataList.vue）
└── ProjectRules.vue       ← 规则列表（从 RuleManager.vue 提取）
```

`RuleManager.vue` 不删除，但改为只负责**全局规则**（`project_id=null`）的展示，或整体废弃，视决策而定。

### 6.4 新增服务：`src/services/projects.ts`

```typescript
export interface Project {
  id: string;
  name: string;
  type: 'git' | 'file' | 'general';
  remote_url?: string | null;
  local_path?: string | null;
  dataset_id: string;
  owner_id: string;
  created_at: string;
}

export const ProjectsService = {
  async getProjects(): Promise<Project[]>,
  async createProject(input: CreateProjectInput): Promise<Project>,
  async updateProject(id: string, input: Partial<CreateProjectInput>): Promise<Project>,
  async deleteProject(id: string): Promise<void>,
}
```

### 6.5 Rules 服务变更

`src/services/rules.ts` 中将 `gitRemoteUrl?: string` 参数改为 `projectId?: string`：

```typescript
getRules(projectId?: string): Promise<Rule[]>
addRule(text: string, projectId?: string): Promise<void>
deleteRule(ruleId: string, projectId?: string): Promise<void>
```

---

## 7. 数据流

```
用户进入 /projects：
  GET /api/v1/projects → 返回 cc_projects 列表

用户点击 "+ New Project"：
  POST /api/v1/projects {name, type, remote_url?}
    → server 创建 cognee Dataset（uuid5 确定性 ID）
    → server INSERT cc_projects {dataset_id, ...}
    → 返回 Project 对象

用户选择项目后切换到 "Rules" 选项卡：
  GET /api/v1/rules?project_id={id}
    → server get_project → 取 dataset_id
    → set_database_global_context_variables(dataset_id, user_id)
    → get_graph_engine() → 读取该 dataset 专属图 DB
    → 返回 NodeSet "coding_agent_rules" 下的所有规则

用户点击 "Delete Project"：
  DELETE /api/v1/projects/{id}
    → 切换到该 project 的 dataset 上下文
    → 删除图 DB 中 "coding_agent_rules" NodeSet
    → 删除 cognee Dataset 记录
    → 删除 cc_projects 记录
```

---

## 8. 表间关系

```
cognee 核心表（只读引用，不修改）：
┌──────────────┐      ┌──────────────────────────┐
│  principals  │      │        datasets           │
│  (users...)  │      │  id/name/owner_id/...     │
└──────────────┘      └──────────────────────────┘
      ↑ owner_id（应用层保证一致性）    ↑ dataset_id（应用层保证一致性）
      │                                 │
我们新增的表：
┌────────────────────────────────────────────────────────┐
│                     cc_projects                         │
│  id / name / type / remote_url / local_path            │
│  dataset_id / owner_id / created_at / updated_at       │
└────────────────────────────────────────────────────────┘

图数据库（KuzuDB，每个 dataset 独立文件）：
  databases/{user_id}/{dataset_id}.pkl
      └── NodeSet "coding_agent_rules"  ← 统一名称，物理隔离
```

---

## 9. 决策确认

| # | 决策 | 结论 |
|---|------|------|
| 1 | 删除 Project 是否级联删除 Dataset + 图规则？ | **是** |
| 2 | 前端 UI 是否重构为 Projects 管理页面？ | **是**，`/rules` → `/projects`，项目内含 Documents + Rules 两个 Tab |
| 3 | NodeSet 命名方式 | **统一 `"coding_agent_rules"`**，依靠 Dataset 物理隔离 |
| 4 | 是否保留全局规则（无 project_id）？ | **是**，`project_id=null` 操作全局图 DB（不切换上下文） |
| 5 | 是否需要 Alembic 管理 cc_projects 表？ | **否**，MVP 阶段用 `create_all` 直接建表 |
