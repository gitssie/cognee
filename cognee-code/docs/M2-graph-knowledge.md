# M2：Graph Knowledge（知识图谱）— 详细功能需求

> 模块编号：M2  
> 所属项目：Cognee-Code AI 辅助开发平台  
> 版本：v1.0  

---

## 1. 模块概述

知识图谱模块是平台的核心智能层，负责将原始数据（文本、文件、代码等）转化为结构化的语义知识图谱。通过 LLM 驱动的实体抽取、关系发现和图谱构建，实现对知识的深层理解和智能检索。

核心概念：
- **Cognify（认知化处理）**：将原始数据转化为知识图谱的核心管道
- **本体（Ontology）**：用于约束知识图谱结构的语义模型
- **知识图谱可视化**：将图谱数据以交互式方式呈现
- **图谱富化（Memify）**：对已有知识图谱进行二次加工和增强
- **时序图谱**：支持时间维度的事件和实体提取

---

## 2. 知识图谱构建（Cognify）

### 2.1 标准 Cognify 管道

**功能描述：** 将已添加到数据集中的原始数据，通过 LLM 驱动的处理管道转化为结构化知识图谱。

**处理管道步骤：**

| 步骤 | 任务 | 说明 |
|------|------|------|
| 1 | classify_documents | 识别文档类型和结构（文本、代码、CSV 等） |
| 2 | extract_chunks_from_documents | 将文档拆分为语义有意义的文本块（chunk） |
| 3 | extract_graph_from_data | 使用 LLM 从文本块中抽取实体和关系，构建知识图谱 |
| 4 | summarize_text | 生成层级化的内容摘要 |
| 5 | add_data_points | 将数据点（实体、关系、摘要等）存储到图谱和向量数据库 |

**详细需求：**

- **输入数据来源**：
  - 通过 `add` 接口添加到数据集中的所有数据
  - 支持按数据集名称或 UUID 指定处理范围
  - 不指定数据集时处理用户所有数据

- **文本分块（Chunking）**：
  - 默认使用 TextChunker（基于段落的分块）
  - 可选 LangchainChunker（递归字符分割，支持重叠）
  - chunk 大小自动计算：`min(embedding_max_tokens, llm_max_tokens // 2)`
  - 默认范围 512-8192 tokens，取决于模型配置
  - 支持自定义 chunk_size 参数

- **实体抽取与图谱构建**：
  - 基于 LLM 驱动的智能实体抽取
  - 自动识别实体（人物、地点、组织、概念等）
  - 自动发现实体间的关系
  - 生成实体的向量嵌入用于语义搜索
  - 支持自定义 graph_model（知识图谱的 Pydantic 结构模型）
  - 默认使用 KnowledgeGraph 通用模型
  - 支持自定义领域模型（如科研论文、代码分析等专用结构）

- **内容摘要**：
  - 为每个文档/chunk 生成层级化摘要
  - 摘要数据存储到向量库和图谱，支持摘要搜索

- **数据点存储**：
  - 实体、关系、摘要等数据点存储到图数据库
  - 向量嵌入存储到向量数据库
  - 支持可选的三元组嵌入（triplet_embedding 配置项）

- **批次处理**：
  - 支持设置 chunks_per_batch 控制每批处理的 chunk 数量
  - 默认 100 个 chunk/批
  - 支持 data_per_batch 控制每批处理的数据项数量（默认 20）

### 2.2 自定义提示词（Custom Prompt）

**功能描述：** 用户可提供自定义 prompt 来控制 LLM 的实体抽取和图谱生成行为。

**详细需求：**
- 可在 Cognify 请求中传入 custom_prompt 字符串
- 该 prompt 替代默认的知识图谱提取 prompt
- 用途示例：
  - "关注技术概念和它们之间的关系，识别关键技术、方法论及其互联"
  - "提取人物、组织和事件，重点关注时间线关系"
  - "识别代码中的设计模式、架构决策和依赖关系"

### 2.3 后台异步执行

**功能描述：** 对于大规模数据集，Cognify 管道可在后台异步运行。

**详细需求：**
- 通过 run_in_background=true 参数控制
- **阻塞模式（默认）**：等待处理完成后返回完整结果
- **后台模式**：立即返回 pipeline_run_id，实际处理在后台继续
- 后台模式推荐用于大数据集（>100MB）
- 返回值包含 pipeline_run_id 用于后续状态追踪

### 2.4 WebSocket 实时订阅

**功能描述：** 通过 WebSocket 连接实时获取 Cognify 管道的运行事件。

**详细需求：**
- 连接地址：`/api/v1/cognify/subscribe/{pipeline_run_id}`
- 通过 cookie 进行身份认证
- 实时推送管道运行信息事件
- 事件类型包括：
  - 处理进度信息（PipelineRunInfo）
  - 处理完成通知（PipelineRunCompleted）
  - 处理错误通知（PipelineRunErrored）
- 正常完成后关闭连接（WS_1000_NORMAL_CLOSURE）
- 认证失败关闭连接（WS_1008_POLICY_VIOLATION）

### 2.5 时序图谱（Temporal Cognify）

**功能描述：** 专门针对时间维度的知识图谱构建，提取事件和时间戳信息。

**时序处理管道：**

| 步骤 | 任务 | 说明 |
|------|------|------|
| 1 | classify_documents | 文档类型识别 |
| 2 | extract_chunks_from_documents | 文本分块 |
| 3 | extract_events_and_timestamps | 从 chunk 中提取事件和时间戳 |
| 4 | extract_knowledge_graph_from_events | 从事件中构建知识图谱 |
| 5 | add_data_points | 存储数据点 |

**详细需求：**
- 通过 temporal_cognify=true 参数激活
- 专注于事件驱动的知识提取
- 识别事件的时间属性和因果关系
- 默认 chunks_per_batch = 10（比标准管道小，因为时序处理更复杂）

### 2.6 增量加载

**功能描述：** 避免对已处理过的数据重复执行 Cognify。

**详细需求：**
- 默认开启（incremental_loading=true）
- 基于管道缓存（use_pipeline_cache=true）跟踪已处理的数据
- 仅对新增或修改的数据执行处理
- 可关闭以强制重新处理所有数据

### 2.7 Cognify 配置

**功能描述：** Cognify 管道的全局配置项。

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| classification_model | 文档分类模型 | DefaultContentPrediction |
| summarization_model | 摘要生成模型 | SummarizedContent |
| triplet_embedding | 是否生成三元组嵌入 | false |
| chunks_per_batch | 每批处理的 chunk 数量 | None（使用代码默认 100） |

**前端展示需求：**
- Cognify 配置面板（在数据集详情页或系统设置页）
- chunk_size、chunks_per_batch 参数设置
- 自定义 prompt 输入框
- 后台/同步执行模式切换
- 管道运行进度实时展示
- 管道运行历史记录

---

## 3. 本体（Ontology）管理

### 3.1 上传本体

**功能描述：** 上传 OWL 格式的本体文件，用于约束知识图谱的构建结构。

**详细需求：**
- 仅支持 `.owl` 格式文件
- 每次上传一个文件，对应一个用户自定义的 ontology_key
- ontology_key 在用户范围内唯一，不可重复
- 可附加描述信息（description）
- 文件存储在用户专属目录（临时目录 /ontologies/{user_id}/）
- 元数据以 JSON 文件存储（metadata.json）
- 返回上传结果：ontology_key、文件名、文件大小、上传时间、描述

### 3.2 批量上传本体

**功能描述：** 一次上传多个本体文件。

**详细需求：**
- key 数量必须与文件数量一致
- 不允许重复 key
- 逐个执行上传

### 3.3 查看本体列表

**功能描述：** 列出当前用户已上传的所有本体。

**详细需求：**
- 按用户筛选
- 返回 metadata.json 中所有本体的元信息

### 3.4 获取本体内容

**功能描述：** 获取指定 ontology_key 对应的本体文件内容。

**详细需求：**
- 支持一次获取多个 key 的内容
- 以 UTF-8 编码读取文件
- 用于 Cognify 时引用本体

### 3.5 本体在 Cognify 中的使用

**功能描述：** 在 Cognify 管道中使用上传的本体来约束知识图谱结构。

**详细需求：**
- Cognify 请求中通过 ontology_key 参数引用本体
- 支持同时引用多个本体
- 系统使用 RDFLibOntologyResolver 解析 OWL 本体
- 本体内容以 StringIO 流方式传入解析器
- 也支持通过环境变量配置默认本体：
  - ontology_file_path
  - ontology_resolver
  - matching_strategy

**前端展示需求：**
- 本体管理页面：列表、上传、删除
- Cognify 页面中提供本体选择器（多选）
- 本体文件预览

---

## 4. 知识图谱可视化

### 4.1 数据集图谱数据获取

**功能描述：** 获取指定数据集的知识图谱结构化数据。

**详细需求：**
- 输入：数据集 ID
- 需对数据集具有 read 权限
- 返回结构化的图谱数据：
  - **节点列表**：每个节点包含
    - id（UUID 字符串）
    - label（显示名称，优先使用 name 属性，否则使用 type_id 格式）
    - type（节点类型）
    - properties（除 id/type/name/created_at/updated_at 之外的所有非空属性）
  - **边列表**：每条边包含
    - source（源节点 ID）
    - target（目标节点 ID）
    - label（关系名称）

### 4.2 图谱 HTML 可视化

**功能描述：** 生成交互式 HTML 可视化页面展示知识图谱。

**详细需求：**
- 使用 cognee_network_visualization 生成 HTML
- 可选保存到指定文件路径
- 默认保存到用户 home 目录
- 返回 HTML 内容（通过 HTMLResponse 返回）
- 交互式节点-边关系图，支持拖拽、缩放、点击

**前端展示需求：**
- 嵌入式图谱可视化组件
- 支持节点类型筛选
- 支持边关系类型筛选
- 支持节点搜索/高亮
- 支持节点详情面板（点击节点展示属性）
- 支持图谱布局切换

---

## 5. 图谱富化（Memify）

### 5.1 自定义管道富化

**功能描述：** 对已构建的知识图谱执行自定义的抽取和富化任务，扩展图谱的知识深度和广度。

**详细需求：**

**输入参数：**

| 参数 | 说明 |
|------|------|
| extraction_tasks | 抽取任务列表（从数据中提取信息） |
| enrichment_tasks | 富化任务列表（对提取的信息进行加工） |
| data | 可选输入数据，不提供则使用已有图谱数据 |
| dataset | 目标数据集名称或 UUID |
| node_name | 过滤特定节点集的子图 |
| run_in_background | 是否后台运行 |

**处理逻辑：**
- 如果未提供 data：
  - 从图数据库中获取指定节点集的子图数据（memory_fragment）
  - 通过 brute_force_triplet_search 获取
  - 可通过 node_type 和 node_name 过滤范围
- 如果提供了 data：直接将 data 作为第一个抽取任务的输入

**默认任务（无自定义时）：**
- 默认抽取任务：extract_subgraph_chunks（从子图中提取文本块）
- 默认富化任务：add_rule_associations（提取编码规则并关联到 coding_agent_rules 节点集）

**执行管道：**
- 先执行所有 extraction_tasks（按顺序）
- 再执行所有 enrichment_tasks（按顺序）
- 使用 memify_pipeline 管道名称
- 不使用管道缓存（use_pipeline_cache=false）
- 不使用增量加载（incremental_loading=false）

**前端展示需求：**
- 富化任务配置界面
- 任务选择器（可选可用的抽取/富化任务）
- 执行进度展示

---

## 6. 数据同步

### 6.1 同步到 Cognee Cloud

**功能描述：** 将本地数据集及知识图谱同步到 Cognee Cloud。

**详细需求：**
- 支持按数据集 ID 选择性同步
- 不指定则同步用户所有数据集
- 后台异步执行
- 创建同步操作记录，跟踪进度
- 同步功能特性：
  - 自动认证（使用 Cognee Cloud 凭证）
  - 数据压缩优化传输
  - 智能同步（增量更新）
  - 进度跟踪
  - 错误恢复和自动重试
  - 数据完整性校验
- 返回同步操作信息：
  - run_id（同步操作 ID）
  - status（started）
  - dataset_ids 和 dataset_names
  - timestamp
  - user_id

**前端展示需求：**
- 同步操作入口（数据集列表页或详情页）
- 同步进度展示
- 同步历史记录
