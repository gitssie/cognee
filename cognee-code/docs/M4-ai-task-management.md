# M4：AI Task 管理（AI 任务管理）— 详细功能需求

> 模块编号：M4  
> 所属项目：Cognee-Code AI 辅助开发平台  
> 版本：v1.0  

---

## 1. 模块概述

AI 任务管理模块为平台提供任务执行追踪、Notebook 交互式编程、OpenAI 兼容的响应接口、以及系统维护等功能。该模块使用户能够管理知识图谱处理管道的生命周期，在沙箱中执行代码，通过标准 API 与 AI 交互，以及维护系统数据。

核心概念：
- **Pipeline（管道）**：由多个 Task 组成的数据处理流水线
- **PipelineRun（管道运行）**：管道的一次执行实例，包含状态跟踪
- **Notebook（笔记本）**：交互式代码编辑与执行环境
- **Responses API**：OpenAI 兼容的 AI 响应接口，支持 Function Calling
- **Prune（清理）**：数据和系统状态的重置

---

## 2. 管道（Pipeline）生命周期管理

### 2.1 Pipeline 数据模型

**Pipeline（管道定义）：**

| 属性 | 类型 | 说明 |
|------|------|------|
| id | UUID | 管道唯一标识 |
| name | string | 管道名称（如 `cognify_pipeline`、`memify_pipeline`） |
| description | text | 管道描述（可选） |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |
| tasks | List[Task] | 管道包含的任务列表（多对多关联） |

**PipelineRun（管道运行记录）：**

| 属性 | 类型 | 说明 |
|------|------|------|
| id | UUID | 运行记录唯一标识 |
| pipeline_run_id | UUID（索引） | 管道运行 ID（用于关联同一次运行的多条记录） |
| pipeline_name | string | 管道名称 |
| pipeline_id | UUID（索引） | 管道定义 ID |
| dataset_id | UUID（索引） | 处理的数据集 ID |
| status | Enum | 运行状态 |
| run_info | JSON | 运行详情信息 |
| created_at | datetime | 记录创建时间 |

**PipelineRunStatus（运行状态枚举）：**

| 状态 | 说明 |
|------|------|
| DATASET_PROCESSING_INITIATED | 数据集处理已发起 |
| DATASET_PROCESSING_STARTED | 数据集处理已开始 |
| DATASET_PROCESSING_COMPLETED | 数据集处理已完成 |
| DATASET_PROCESSING_ERRORED | 数据集处理出错 |

### 2.2 管道运行事件

管道运行过程中产生的实时事件：

| 事件类型 | 说明 | 附带数据 |
|----------|------|----------|
| PipelineRunStarted | 管道开始运行 | pipeline_run_id, dataset_id, dataset_name |
| PipelineRunYield | 管道产出中间结果 | 同上 + payload |
| PipelineRunCompleted | 管道运行完成 | 同上 + payload |
| PipelineRunAlreadyCompleted | 管道已在之前完成（增量加载跳过） | 同上 |
| PipelineRunErrored | 管道运行出错 | 同上 + 错误信息 |

**事件通用属性：**
- status：事件类型标识
- pipeline_run_id：管道运行 ID
- dataset_id：数据集 ID
- dataset_name：数据集名称
- payload：可选载荷数据（Data 列表或其他）
- data_ingestion_info：可选数据摄入信息

### 2.3 管道状态查询

**功能描述：** 查询指定数据集上指定管道的最新运行状态。

**详细需求：**
- 输入参数：数据集 ID 列表 + 管道名称
- 查询逻辑：
  - 按 dataset_id 分组
  - 每组取 created_at 最新的一条记录
  - 返回 `{dataset_id: status}` 映射
- 应用场景：
  - MCP `cognify_status` 工具查询 cognify_pipeline 在 main_dataset 上的状态
  - 前端展示数据集的处理状态

### 2.4 Task（任务）抽象

**功能描述：** Pipeline 中的最小执行单元。

**Task 支持的可执行类型：**

| 类型 | 说明 |
|------|------|
| Async Generator | 异步生成器函数 |
| Generator | 同步生成器函数 |
| Coroutine | 异步协程函数 |
| Function | 普通同步函数 |

**Task 配置：**
- `batch_size`：每批处理的数据量（默认 1）
- `default_params`：默认参数（args + kwargs）

**前端展示需求：**
- 管道运行历史列表（按数据集分组）
- 运行状态实时展示（图标/颜色标识）
- 运行详情页（运行时间、处理的数据集、状态变更历史）
- 管道状态概览面板

---

## 3. Notebook（交互式笔记本）

### 3.1 数据模型

**NotebookCell（单元格）：**

| 属性 | 类型 | 说明 |
|------|------|------|
| id | UUID | 单元格唯一标识 |
| type | "markdown" \| "code" | 单元格类型 |
| name | string | 单元格名称 |
| content | string | 单元格内容（Markdown 文本或代码） |

**Notebook（笔记本）：**

| 属性 | 类型 | 说明 |
|------|------|------|
| id | UUID | 笔记本唯一标识 |
| owner_id | UUID（索引） | 所有者用户 ID |
| name | string（必填） | 笔记本名称 |
| cells | List[NotebookCell] | 单元格列表（JSON 存储） |
| deletable | boolean（默认 true） | 是否可删除 |
| created_at | datetime | 创建时间 |

### 3.2 笔记本管理

**3.2.1 获取笔记本列表**
- 按当前用户筛选
- 返回所有笔记本基本信息

**3.2.2 创建笔记本**
- 输入：名称、单元格列表（可选）
- 默认 deletable=true
- 关联到当前用户

**3.2.3 更新笔记本**
- 支持修改名称
- 支持修改单元格内容
- 通过 notebook_id 定位
- 权限校验：只能修改自己的笔记本

**3.2.4 删除笔记本**
- 通过 notebook_id 定位
- 权限校验：只能删除自己的笔记本
- deletable=false 的笔记本不可删除

**3.2.5 从远程 ipynb 导入**
- 支持从 zip URL 导入 .ipynb 文件
- 自动解析 ipynb 格式（nbformat）
- 提取所有 cell 转为 NotebookCell
- 支持附带数据文件的 zip 包
- 文件缓存到本地（基于 content hash）

### 3.3 单元格执行

**功能描述：** 在隔离的本地沙箱中执行 Notebook 的代码单元格。

**详细需求：**
- 输入：notebook_id + cell_id + 代码内容
- 执行环境特性：
  - 隔离的 Python 执行环境
  - 预注入 `cognee` 模块，可直接使用 cognee API
  - 支持异步代码（自动包装为 async handler）
  - 自定义 print 函数捕获输出
  - stdout/stderr 重定向
- 返回值：
  - result：print 输出的内容列表
  - error：错误信息（如有异常）

**安全特性：**
- 使用 exec() 在受控环境中执行
- 异常被捕获并格式化返回
- 不影响主进程状态

**前端展示需求：**
- Notebook 编辑器界面（类 Jupyter）
- 支持 Markdown 和 Code 两种单元格
- 代码单元格的运行按钮
- 执行结果/输出展示区域
- 错误信息高亮展示
- 单元格拖拽排序
- 新增/删除单元格

---

## 4. OpenAI 兼容响应接口（Responses API）

### 4.1 接口概述

**功能描述：** 提供 OpenAI Responses API 兼容的接口，支持 Function Calling，使第三方客户端可以像调用 OpenAI API 一样与 Cognee 交互。

### 4.2 请求模型

| 字段 | 类型 | 说明 |
|------|------|------|
| model | CogneeModel（枚举） | 模型标识，当前支持 `cognee-v1` |
| input | string（必填） | 用户输入文本 |
| tools | List[ToolFunction]（可选） | 可用工具列表 |
| tool_choice | string \| dict（默认 "auto"） | 工具选择策略 |
| user | string（可选） | 用户标识 |
| temperature | float（默认 1.0） | 生成随机性 |
| max_completion_tokens | int（可选） | 最大生成 token 数 |

### 4.3 默认工具

系统预置两个 Function Calling 工具：

**search 工具：**
- 在知识图谱中搜索信息
- 参数：search_query（必填）、search_type（CODE/GRAPH_COMPLETION/NATURAL_LANGUAGE）、top_k、datasets
- 对应 Cognee 的 search API

**cognify 工具：**
- 将文本转化为知识图谱
- 参数：text（必填）、ontology_file_path、custom_prompt
- 执行流程：先 add 文本，再 cognify 处理

### 4.4 处理流程

1. 接收用户输入和工具配置
2. 调用 OpenAI API（当前固定使用 gpt-4o）获取 function call 决策
3. 如果 OpenAI 返回 function_call 类型的输出：
   - 解析 function name 和 arguments
   - 通过 dispatch_function 路由到对应处理函数
   - 执行 Cognee 操作（search/cognify/prune）
   - 记录执行结果或错误
4. 构建 OpenAI 兼容的响应体返回

### 4.5 响应模型

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 响应 ID（格式：`resp_xxx`） |
| created | int | 创建时间戳 |
| model | string | 使用的模型 |
| object | string | 固定 `"response"` |
| status | string | 固定 `"completed"` |
| tool_calls | List[ResponseToolCall] | 工具调用列表（含输入和输出） |
| usage | ChatUsage | Token 使用统计 |
| metadata | dict | 元数据 |

**前端展示需求：**
- API 测试面板（类似 Swagger UI）
- 工具调用过程可视化
- Token 使用统计

---

## 5. 数据清理与系统维护

### 5.1 清理数据（prune_data）

**功能描述：** 清除所有用户数据，包括数据集、文件、知识图谱内容。

**详细需求：**
- 清理向量数据库中的所有集合
- 清理图数据库中的所有节点和边
- 清理关系数据库中的数据记录
- 清理文件存储中的上传文件
- 保留系统配置

### 5.2 清理系统（prune_system）

**功能描述：** 清除系统级元数据。

**详细需求：**
- metadata=true 时清除系统元数据表
- 重置管道运行记录
- 重置系统缓存

### 5.3 组合清理（prune）

**功能描述：** MCP 工具的完整清理，同时执行数据清理和系统清理。

**处理流程：**
1. 执行 `prune_data()`
2. 执行 `prune_system(metadata=True)`

**使用场景：**
- 开发调试时重置环境
- 需要从零开始重建知识库
- 数据损坏时的恢复手段

**限制：** 操作不可撤销，需谨慎使用

**前端展示需求：**
- 系统维护页面
- 清理操作按钮（带确认对话框）
- 分别提供"清理数据"和"清理系统"选项
- 操作日志展示

---

## 6. MCP 工具集成一览

| MCP 工具 | 功能 | 模式限制 |
|----------|------|---------|
| cognify | 构建知识图谱 | 全模式 |
| cognify_status | 查询管道运行状态 | 仅直连模式 |
| search | 多模式知识搜索 | 全模式 |
| list_data | 列出数据集和数据项 | 全模式 |
| delete | 删除指定数据项 | 全模式 |
| prune | 完全重置系统 | 仅直连模式 |
| save_interaction | 保存交互并提取规则 | 规则提取仅直连模式 |
| write_memory | 写入长期记忆 | 仅直连模式 |
| read_memory | 读取全部记忆 | 仅直连模式 |

### MCP 服务端运行模式

| 传输方式 | 说明 |
|----------|------|
| stdio | 标准输入输出（默认，本地使用） |
| sse | Server-Sent Events（HTTP 长连接） |
| http | Streamable HTTP（可配置 host/port/path） |

### MCP 运行模式

| 模式 | 说明 |
|------|------|
| 直连模式 | 直接使用 cognee 库，功能完整 |
| API 代理模式 | 连接远程 Cognee API，部分功能受限 |

---

## 7. 系统配置管理

### 7.1 LLM 配置

**功能描述：** 管理 AI 模型的配置参数。

**可配置项：**
- LLM Provider（OpenAI / Ollama / Anthropic / Gemini / Mistral / DeepSeek / Groq / Custom）
- LLM Model（具体模型名称）
- LLM API Key
- LLM Endpoint（自定义端点 URL）
- LLM Temperature

### 7.2 向量数据库配置

**功能描述：** 管理向量数据库连接。

**可配置项：**
- Vector DB Provider（LanceDB / ChromaDB / PGVector / QDrant / Weaviate / Milvus）
- Vector DB URL / Host / Port
- Vector DB API Key
- Embedding Provider / Model / Dimensions / Max Tokens / Endpoint

**前端展示需求：**
- 系统设置页面
- LLM 配置表单（下拉选择 provider + 输入框）
- 向量数据库配置表单
- 配置保存/重置
- 连接测试按钮

---

## 8. 权限与多租户

### 8.1 数据集权限

**功能描述：** 控制数据集的访问权限。

**支持的权限级别：**
- read：读取数据集内容和图谱
- write：修改数据集数据
- admin：管理数据集权限和配置

**操作：**
- 授予用户/组对数据集的权限
- 撤销权限
- 查询数据集的权限列表
- 查询用户可访问的数据集

### 8.2 多租户支持

**功能描述：** 支持多租户环境下的数据隔离。

**需求：**
- 租户级别的数据隔离
- 租户级别的用户管理
- 跨租户数据共享（受控）
