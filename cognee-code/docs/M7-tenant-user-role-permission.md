# M7 — 租户 · 用户 · 角色 · 权限 · 数据集 基础功能需求

> 本文档对应 cognee 后端 `cognee/modules/users/` 与 `cognee/modules/data/` 中的多租户 RBAC（Role-Based Access Control）体系，覆盖租户管理、用户管理、角色管理、权限管理、数据集权限控制以及系统配置等基础功能。

---

## 7.0 数据模型总览

### 7.0.1 安全主体继承体系（Principal Hierarchy）

```
Principal (principals)          ← 所有安全主体的多态基类
  ├── User (users)              ← 系统用户，继承 FastAPI-Users + Principal
  ├── Tenant (tenants)          ← 租户/组织
  └── Role (roles)              ← 角色，归属于 Tenant
```

| 模型 | 数据库表 | 关键字段 | 多态标识 |
|------|---------|---------|---------|
| `Principal` | `principals` | `id (UUID)`, `type`, `created_at`, `updated_at` | `"principal"` |
| `User` | `users` | 继承 Principal + `email`, `hashed_password`, `is_active`, `is_superuser`, `is_verified`, `tenant_id` (当前租户FK) | `"user"` |
| `Tenant` | `tenants` | 继承 Principal + `name (唯一)`, `owner_id` | `"tenant"` |
| `Role` | `roles` | 继承 Principal + `name`, `tenant_id` (FK → tenants)，同一租户内 name 唯一 | `"role"` |

### 7.0.2 关联关系表

| 关联表 | 数据库表 | 复合主键 | 说明 |
|--------|---------|---------|------|
| `UserTenant` | `user_tenants` | `(user_id, tenant_id)` | 用户-租户多对多 |
| `UserRole` | `user_roles` | `(user_id, role_id)` | 用户-角色多对多 |

### 7.0.3 权限与访问控制模型

| 模型 | 数据库表 | 关键字段 | 说明 |
|------|---------|---------|------|
| `Permission` | `permissions` | `id (UUID)`, `name (唯一)` | 权限类型定义 |
| `ACL` | `acls` | `id`, `principal_id` (FK → principals), `permission_id` (FK → permissions), `dataset_id` (FK → datasets) | 访问控制列表条目 |
| `UserDefaultPermissions` | `user_default_permissions` | `(user_id, permission_id)` | 用户默认权限 |
| `RoleDefaultPermissions` | `role_default_permissions` | `(role_id, permission_id)` | 角色默认权限 |
| `TenantDefaultPermissions` | `tenant_default_permissions` | `(tenant_id, permission_id)` | 租户默认权限 |

### 7.0.4 数据集模型

| 模型 | 数据库表 | 关键字段 | 说明 |
|------|---------|---------|------|
| `Dataset` | `datasets` | `id`, `name`, `owner_id`, `tenant_id`, `created_at`, `updated_at` | 数据集，通过 ACL 与 Principal 关联 |
| `DatasetData` | `dataset_data` | `(dataset_id, data_id)` | 数据集-数据关联（多对多） |

---

## 7.1 租户管理（Tenant Management）

### 7.1.1 现有能力（已实现）

| 功能 | 源码位置 | 说明 |
|------|---------|------|
| 租户数据模型 | `modules/users/models/Tenant.py` | `Tenant(Principal)` 多态子类，含 `name (唯一)`, `owner_id` |
| 查询租户 | `permissions/methods/get_tenant.py` | 按 `tenant_id` 查询租户信息 |
| 租户拥有者鉴权 | `permissions/methods/has_user_management_permission.py` | 当前仅判断 `tenant.owner_id == requester_id`；TODO 注释表明计划支持管理员角色 |
| 租户-用户关联 | `models/UserTenant.py` | 用户可属于多个租户，通过 `user_tenants` 中间表 |
| 租户默认权限 | `models/TenantDefaultPermissions.py` + `permissions/methods/give_default_permission_to_tenant.py` | 为租户设置默认权限（自动对租户下所有数据集生效） |
| 数据集租户隔离 | `Dataset.tenant_id` + `get_all_user_permission_datasets()` | 返回数据集时过滤 `dataset.tenant_id == user.tenant_id` |
| 数据库级隔离 | `context_global_variables.py` → `set_database_global_context_variables()` | 当 `ENABLE_BACKEND_ACCESS_CONTROL=true` 时，每个数据集拥有独立的向量库和图数据库实例 |

### 7.1.2 待建设功能（建议）

| 功能 | 说明 |
|------|------|
| **F7.1.1** 租户 CRUD API | 提供 `POST/GET/PUT/DELETE /api/v1/tenants` 完整 REST 接口 |
| **F7.1.2** 租户成员管理 | `POST /tenants/{id}/members` 邀请用户、`DELETE /tenants/{id}/members/{user_id}` 移除成员 |
| **F7.1.3** 租户切换 | 用户通过 `PUT /users/me/tenant` 切换当前活跃租户（更新 `user.tenant_id`） |
| **F7.1.4** 租户配额 | 为每个租户设置数据集数量、存储容量、API 调用限额 |
| **F7.1.5** 租户管理员角色 | 扩展 `has_user_management_permission()` 支持 admin 角色（源码 TODO 标注） |
| **F7.1.6** 租户层级（组织树） | 支持父子租户关系，权限可向下继承 |

---

## 7.2 用户管理（User Management）

### 7.2.1 现有能力（已实现）

| 功能 | 源码位置 | 说明 |
|------|---------|------|
| 用户注册 | `api/v1/users/routers/get_register_router.py` → FastAPI-Users `get_register_router(UserRead, UserCreate)` | `POST /api/v1/users/register` |
| 用户登录 | `api/v1/users/routers/get_auth_router.py` → JWT + Cookie 双模式认证 | `POST /api/v1/users/auth/login` |
| 获取当前用户 | `get_auth_router()` 内 `GET /auth/me` | 返回已认证用户 email |
| 用户信息更新 | `get_users_router()` → FastAPI-Users 标准用户 CRUD | `PATCH /api/v1/users/{id}` |
| 密码重置 | `get_reset_password_router()` | `POST /forgot-password`, `POST /reset-password` |
| 邮箱验证 | `get_verify_router()` | `POST /request-verify-token`, `POST /verify` |
| 默认用户 | `methods/create_default_user.py` | 通过 `base_config` 读取默认邮箱/密码，自动创建超级用户 |
| 认证策略 | `methods/get_authenticated_user.py` | 由 `REQUIRE_AUTHENTICATION` / `ENABLE_BACKEND_ACCESS_CONTROL` 环境变量控制；关闭时自动降级为默认用户 |
| 用户创建 | `methods/create_user.py` | 程序化创建用户，支持 `is_superuser`, `auto_login` 参数 |
| 用户删除 | `methods/delete_user.py` | 按 ID 删除用户 |
| 用户查询 | `methods/get_user.py`, `get_user_by_email.py`, `get_default_user.py` | 支持按 ID / Email / 默认用户查询 |
| 用户-角色关联 | `models/UserRole.py` | 用户可拥有多个角色 |
| 用户默认权限 | `models/UserDefaultPermissions.py` + `permissions/methods/give_default_permission_to_user.py` | 为用户设置默认权限 |

### 7.2.2 认证架构

```
FastAPI-Users ─┬─ API Auth Backend  (Bearer Token / Header)
               └─ Client Auth Backend (JWT Cookie / Set-Cookie)
                      │
                      ▼
               JWTStrategy
               ├─ secret: env FASTAPI_USERS_JWT_SECRET
               └─ lifetime: env JWT_LIFETIME_SECONDS (default 3600)
```

- **UserManager** (`get_user_manager.py`)：继承 `UUIDIDMixin + BaseUserManager`，支持 `on_after_login`（自动提取 Cookie Token 并以 JSON 返回）、`on_after_register`、`on_after_forgot_password`、`on_after_request_verify` 生命周期回调。

### 7.2.3 待建设功能（建议）

| 功能 | 说明 |
|------|------|
| **F7.2.1** 用户资料扩展 | 扩展 User 模型增加 `display_name`, `avatar_url`, `phone`, `timezone`, `language` 字段 |
| **F7.2.2** 用户状态管理 | 支持 `suspend`, `lock`, `deactivate` 等细粒度状态 |
| **F7.2.3** 第三方 OAuth | 集成 GitHub / Google / LDAP / SAML SSO 登录 |
| **F7.2.4** 双因素认证 (2FA) | 支持 TOTP / Email OTP 二次验证 |
| **F7.2.5** 登录审计日志 | 记录每次登录的 IP、User-Agent、时间、结果 |
| **F7.2.6** Token 刷新 | 支持 Refresh Token 机制，避免频繁重新登录 |
| **F7.2.7** 批量用户导入 | 通过 CSV/Excel 批量创建用户并分配租户和角色 |

---

## 7.3 角色管理（Role Management）

### 7.3.1 现有能力（已实现）

| 功能 | 源码位置 | 说明 |
|------|---------|------|
| 角色数据模型 | `models/Role.py` | `Role(Principal)` 多态子类，含 `name`, `tenant_id`，同一租户内 name 唯一约束 |
| 查询角色 | `permissions/methods/get_role.py` | 按 `(tenant_id, role_name)` 查询角色 |
| 角色默认权限 | `models/RoleDefaultPermissions.py` + `permissions/methods/give_default_permission_to_role.py` | 为角色设置默认权限 |
| 用户角色关联 | `models/UserRole.py` | 多对多关联，用户可拥有同一租户下的多个角色 |
| 角色权限继承 | `permissions/methods/get_all_user_permission_datasets.py` | 查询用户权限时，自动聚合用户直接权限 + 租户权限 + 角色权限 |

### 7.3.2 待建设功能（建议）

| 功能 | 说明 |
|------|------|
| **F7.3.1** 角色 CRUD API | `POST/GET/PUT/DELETE /api/v1/tenants/{tenant_id}/roles` |
| **F7.3.2** 内置角色模板 | 预置 `admin`, `editor`, `viewer` 角色模板，创建租户时自动初始化 |
| **F7.3.3** 角色-用户分配 API | `POST/DELETE /api/v1/roles/{role_id}/users/{user_id}` |
| **F7.3.4** 角色权限批量配置 | `PUT /api/v1/roles/{role_id}/permissions` 批量设置角色拥有的权限列表 |
| **F7.3.5** 自定义角色 | 允许租户管理员创建自定义角色并灵活分配权限 |
| **F7.3.6** 角色互斥/依赖 | 支持角色互斥约束（如 admin 与 auditor 不可同时拥有）和依赖关系 |

---

## 7.4 权限管理（Permission Management）

### 7.4.1 现有权限类型

```python
# cognee/modules/users/permissions/permission_types.py
PERMISSION_TYPES = ["read", "write", "delete", "share"]
```

| 权限 | 含义 |
|------|------|
| `read` | 读取数据集中的数据、执行搜索 |
| `write` | 向数据集添加数据、执行 cognify |
| `delete` | 删除数据集或数据集中的数据 |
| `share` | 将数据集权限授予其他用户/角色/租户（必须拥有 share 权限才能转授） |

### 7.4.2 现有能力（已实现）

| 功能 | 源码位置 | 说明 |
|------|---------|------|
| 权限定义模型 | `models/Permission.py` | `name` 唯一索引，按需自动创建 |
| 授予数据集权限 | `permissions/methods/give_permission_on_dataset.py` | 为 Principal 在指定 Dataset 上创建 ACL 条目；内置重试机制（3次 exponential backoff） |
| 鉴权授权转授 | `permissions/methods/authorized_give_permission_on_datasets.py` | 先验证请求者拥有 `share` 权限，再将指定权限授予目标 Principal |
| 检查权限 | `permissions/methods/check_permission_on_dataset.py` | 验证用户对某数据集是否拥有指定权限 |
| 查询用户可访问数据集 | `permissions/methods/get_all_user_permission_datasets.py` | 聚合 User 直接权限 + Tenant 级权限 + Role 级权限，去重后按 `tenant_id` 过滤 |
| 查询指定数据集权限 | `permissions/methods/get_specific_user_permission_datasets.py` | 验证用户对指定数据集列表的权限，缺失则抛出 `PermissionDeniedError` |
| 查询 Principal 数据集 | `permissions/methods/get_principal_datasets.py` | 通过 ACL JOIN Permission 查询任意 Principal（User/Tenant/Role）拥有的数据集列表 |
| 获取用户文档 ID | `permissions/methods/get_document_ids_for_user.py` | 通过 ACL 权限链获取用户有读权限的所有文档 ID |
| 默认权限分配 | 三个方法：`give_default_permission_to_user/role/tenant` | 为新创建的实体自动赋予默认权限 |

### 7.4.3 ACL（访问控制列表）模型

```
ACL 条目 = (Principal, Permission, Dataset)
```

- **Principal**：可以是 User / Tenant / Role（通过多态继承的 `principal_id` FK）
- **Permission**：`read` / `write` / `delete` / `share` 之一
- **Dataset**：目标数据集
- **级联删除**：删除 Dataset 时自动删除关联的所有 ACL 条目

### 7.4.4 权限聚合逻辑

```
用户可访问数据集 = 
  ∪ { User 直接持有权限的数据集 }
  ∪ { User 所属 Tenant 持有权限的数据集 }
  ∪ { User 拥有的 Role 持有权限的数据集 }
  → 去重
  → 过滤: dataset.tenant_id == user.tenant_id (当前租户)
```

### 7.4.5 待建设功能（建议）

| 功能 | 说明 |
|------|------|
| **F7.4.1** 权限管理 API | `GET/POST/DELETE /api/v1/datasets/{id}/permissions` 查看/授予/撤销数据集权限 |
| **F7.4.2** 细粒度资源权限 | 将 ACL 扩展到不仅限于 Dataset，支持对 Graph Node / Pipeline / Rule 等资源类型设置权限 |
| **F7.4.3** 权限继承策略 | 支持权限从 Tenant → Role → User 的继承与覆盖策略配置 |
| **F7.4.4** 权限撤销 | 补充 `revoke_permission_on_dataset()` 方法（删除 ACL 条目） |
| **F7.4.5** 权限变更审计 | 记录每次权限授予/撤销的操作者、时间、目标 |
| **F7.4.6** 临时权限 | 支持带过期时间的临时权限（`ACL.expires_at`） |
| **F7.4.7** 自定义权限类型 | 允许动态注册新的权限类型（如 `execute`, `admin`, `export`） |

---

## 7.5 数据集权限控制（Dataset Access Control）

### 7.5.1 现有能力（已实现）

| 功能 | 说明 |
|------|------|
| **数据集归属** | `Dataset.owner_id` 标识创建者，`Dataset.tenant_id` 标识所属租户 |
| **数据集-ACL 关联** | `Dataset.acls` 关系（一对多），支持级联删除 |
| **租户数据隔离** | 查询时自动按 `user.tenant_id` 过滤，用户只能看到当前租户的数据集 |
| **数据库级隔离** | `ENABLE_BACKEND_ACCESS_CONTROL=true` 时，每个数据集拥有独立的向量库（LanceDB）和图数据库（KuzuDB）实例 |
| **ContextVar 隔离** | 通过 `set_database_global_context_variables()` 将数据集专属的 DB 配置注入当前异步上下文 |
| **文件存储隔离** | 文件存储路径按 `{data_root}/{tenant_id or user_id}/` 隔离 |

### 7.5.2 数据库级隔离架构

```
ENABLE_BACKEND_ACCESS_CONTROL=true
  │
  ▼
set_database_global_context_variables(dataset, user_id)
  ├─ get_or_create_dataset_database()   → 创建/获取数据集专属 DB
  ├─ resolve_dataset_database_connection_info()  → 解析连接信息
  ├─ ContextVar(vector_db_config) ← 数据集专属向量库配置
  ├─ ContextVar(graph_db_config)  ← 数据集专属图数据库配置
  └─ ContextVar(file_storage_config) ← 数据集专属文件存储路径
```

**支持的数据库组合：**
- 关系型：SQLite / Postgres
- 向量库：LanceDB
- 图数据库：KuzuDB

### 7.5.3 待建设功能（建议）

| 功能 | 说明 |
|------|------|
| **F7.5.1** 数据集共享管理界面 | 可视化管理数据集的共享状态、查看谁有访问权限 |
| **F7.5.2** 数据集公开/私有标记 | `Dataset.visibility` 字段支持 `private` / `tenant` / `public` 可见性 |
| **F7.5.3** 数据集所有权转移 | `POST /datasets/{id}/transfer` 将数据集转移给其他用户 |
| **F7.5.4** 跨租户数据集共享 | 源码 TODO 标注：考虑是否允许跨租户共享，需设计跨租户 ACL |

---

## 7.6 异常处理体系

| 异常类 | HTTP 状态码 | 触发场景 |
|--------|-----------|---------|
| `UserNotFoundError` | 404 | 用户不存在 |
| `TenantNotFoundError` | 404 | 租户不存在 |
| `RoleNotFoundError` | 404 | 角色不存在 |
| `PermissionDeniedError` | 403 | 用户无权限访问资源 |
| `PermissionNotFoundError` | (自定义) | 权限类型不存在或不在允许列表中 |
| `GivePermissionOnDatasetError` | (重试异常) | ACL 创建失败，触发最多 3 次指数退避重试 |
| `EntityAlreadyExistsError` | (DB异常) | 重复创建默认权限时捕获并忽略 |

---

## 7.7 系统配置管理（Settings）

### 7.7.1 现有能力

| 功能 | API 端点 | 说明 |
|------|---------|------|
| 获取系统设置 | `GET /api/v1/settings` | 返回 LLM 配置（provider/model/api_key）+ 向量库配置（provider/url/api_key） |
| 保存系统设置 | `POST /api/v1/settings` | 更新 LLM 和/或向量库配置 |

**支持的 LLM Provider：** openai / ollama / anthropic / gemini / mistral
**支持的 VectorDB Provider：** lancedb / chromadb / pgvector

### 7.7.2 关键环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ENABLE_BACKEND_ACCESS_CONTROL` | 自动检测 | 启用多用户访问控制模式 |
| `REQUIRE_AUTHENTICATION` | `"true"` | 是否强制认证（关闭则降级为默认用户） |
| `FASTAPI_USERS_JWT_SECRET` | `"super_secret"` | JWT 签名密钥 |
| `JWT_LIFETIME_SECONDS` | `3600` | JWT Token 有效期（秒） |
| `FASTAPI_USERS_RESET_PASSWORD_TOKEN_SECRET` | `"super_secret"` | 密码重置令牌密钥 |
| `FASTAPI_USERS_VERIFICATION_TOKEN_SECRET` | `"super_secret"` | 邮箱验证令牌密钥 |

### 7.7.3 待建设功能（建议）

| 功能 | 说明 |
|------|------|
| **F7.7.1** 租户级配置 | 每个租户可拥有独立的 LLM / VectorDB / Graph 配置 |
| **F7.7.2** 配置变更审计 | 记录谁在什么时间修改了哪项配置 |
| **F7.7.3** 配置权限控制 | 仅 admin 角色可修改系统级配置 |

---

## 7.8 API 端点汇总

### 7.8.1 现有认证/用户端点（FastAPI-Users 提供）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/users/auth/login` | POST | 用户登录（JWT Cookie + Bearer Token） |
| `/api/v1/users/auth/logout` | POST | 用户登出 |
| `/api/v1/users/auth/me` | GET | 获取当前用户信息 |
| `/api/v1/users/register` | POST | 用户注册 |
| `/api/v1/users/{id}` | GET/PATCH/DELETE | 用户 CRUD |
| `/api/v1/users/forgot-password` | POST | 忘记密码 |
| `/api/v1/users/reset-password` | POST | 重置密码 |
| `/api/v1/users/request-verify-token` | POST | 请求邮箱验证 |
| `/api/v1/users/verify` | POST | 验证邮箱 |
| `/api/v1/settings` | GET/POST | 系统设置 |

### 7.8.2 待建设 API 端点（建议）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/v1/tenants` | POST/GET | 创建租户 / 列出用户所属租户 |
| `/api/v1/tenants/{id}` | GET/PUT/DELETE | 租户详情 / 更新 / 删除 |
| `/api/v1/tenants/{id}/members` | GET/POST/DELETE | 租户成员管理 |
| `/api/v1/tenants/{id}/roles` | GET/POST | 租户角色列表 / 创建角色 |
| `/api/v1/roles/{id}` | GET/PUT/DELETE | 角色详情 / 更新 / 删除 |
| `/api/v1/roles/{id}/users` | GET/POST/DELETE | 角色-用户分配 |
| `/api/v1/roles/{id}/permissions` | GET/PUT | 角色权限配置 |
| `/api/v1/datasets/{id}/permissions` | GET/POST/DELETE | 数据集权限管理 |
| `/api/v1/users/me/tenant` | PUT | 切换当前活跃租户 |

---

## 7.9 与其他模块的关系

| 关联模块 | 交互方式 |
|---------|---------|
| **M1 知识库/文件管理** | Dataset 是权限控制的核心资源；所有 `add()` / `search()` / `delete()` 操作通过 ACL 鉴权 |
| **M2 Graph Knowledge** | `cognify()` 前验证 `write` 权限；图数据库通过 ContextVar 实现数据集级隔离 |
| **M3 Code Rule** | Rule/RuleSet 可扩展 ACL 支持，实现团队级规则共享 |
| **M4 AI Task** | Pipeline 执行时检查用户对目标数据集的权限 |
| **M5 补充功能** | Session 历史按用户隔离；Usage 日志记录操作者身份 |
| **M6 扩展功能** | 分布式任务携带用户上下文；Web Scraper 结果写入用户数据集 |
