# M3：Code Rule 管理（编码规则管理）— 详细功能需求

> 模块编号：M3  
> 所属项目：Cognee-Code AI 辅助开发平台  
> 版本：v1.0  

---

## 1. 模块概述

编码规则管理模块为 AI Agent 提供持久化的编码最佳实践和项目规范记忆能力。规则可通过 AI 自动从对话/交互中提取，也可由用户/Agent 手动写入。规则存储在知识图谱中，并通过专用搜索类型检索，使 AI Agent 在代码生成和审查中始终遵循团队的编码规范。

核心概念：
- **Rule（规则）**：单条编码最佳实践或项目规范
- **RuleSet（规则集）**：规则的集合，从一次交互中提取的所有规则
- **NodeSet（节点集）**：规则在图谱中的分组标识（默认 `coding_agent_rules`）
- **规则来源追溯**：每条规则关联到其提取的原始文本块（DocumentChunk）

---

## 2. 规则数据模型

### 2.1 Rule（单条规则）

| 属性 | 类型 | 说明 |
|------|------|------|
| id | UUID | 基于规则内容生成的唯一标识 |
| text | string（必填） | 规则的文本内容 |
| belongs_to_set | NodeSet（可选） | 所属节点集 |
| metadata | dict | 索引配置：`{"index_fields": ["rule"]}` |

**Rule 继承自 DataPoint**，在知识图谱和向量数据库中均有存储。

### 2.2 RuleSet（规则集合）

| 属性 | 类型 | 说明 |
|------|------|------|
| rules | List[Rule]（必填） | 从输入文本中提取的规则列表 |

### 2.3 NodeSet（节点集分组）

| 属性 | 类型 | 说明 |
|------|------|------|
| id | UUID | 基于名称确定性生成（uuid5） |
| name | string | 节点集名称（如 `coding_agent_rules`） |

**说明：** NodeSet 用于在知识图谱中对规则进行逻辑分组。每条 Rule 通过 `belongs_to_set` 关联到一个 NodeSet。系统默认使用 `coding_agent_rules` 作为规则存储的节点集名称。

---

## 3. 规则创建

### 3.1 AI 自动提取规则

**功能描述：** 从用户-Agent 交互记录、对话文本中，通过 LLM 智能提取出通用性的编码最佳实践。

**处理流程：**

```
输入文本 → 获取已有规则 → LLM 智能提取 → 去重过滤 → 存储到图谱 → 关联原始文档块
```

**详细步骤：**

1. **获取已有规则**：
   - 通过 `get_existing_rules` 从图数据库中获取指定 NodeSet 下所有已存在的规则文本
   - 用于后续去重判断

2. **LLM 智能提取**：
   - 使用 System Prompt 指导 LLM：
     - 角色：关联代理（association agent），从用户-Agent 交互中提取开发者规则
     - 输入：用户-Agent 交互文本 + 已有规则列表
     - 约束：
       - 提取**通用的**、非特定于当前文本的规则
       - 规则必须**严格技术性**的
       - 每条规则代表**单一**的最佳实践或准则
       - **不要**提取与已有规则相似的规则
       - **不要**提取不通用或无附加价值的规则
       - 可以返回空列表（如果没有值得提取的新规则）
   - 输出：结构化的 RuleSet 对象

3. **规则存储**：
   - 每条 Rule 关联到指定的 NodeSet（默认 `coding_agent_rules`）
   - NodeSet ID 通过 `uuid5(NAMESPACE_OID, name)` 确定性生成
   - 调用 `add_data_points` 将规则存储到图谱和向量库

4. **原始文档关联**：
   - 通过向量搜索找到与输入文本最相似的 DocumentChunk
   - 为每条新 Rule 创建 `rule_associated_from` 关系边
   - 关系边结构：`Rule → rule_associated_from → DocumentChunk`
   - 存储到图数据库并建立索引

### 3.2 交互记录触发（save_interaction）

**功能描述：** 保存用户-Agent 交互记录，同时自动触发规则提取。

**处理流程：**
1. 将交互文本通过 `cognee.add` 添加到知识库（标记 node_set=`user_agent_interaction`）
2. 执行 `cognee.cognify` 构建交互的知识图谱
3. 调用 `add_rule_associations` 从交互中自动提取编码规则
4. 提取的规则存储到 `coding_agent_rules` 节点集

**触发方式：** MCP 工具 `save_interaction`

**限制：** 规则自动提取仅在直连模式下可用（非 API 代理模式）

### 3.3 手动写入规则（write_memory）

**功能描述：** Agent 或用户手动将重要信息写入长期记忆（规则库）。

**使用场景：**
- 用户偏好和工作风格
- 项目特定的需求或约束
- 重要决策及其理由
- 解决问题中学到的经验教训
- 项目特定的编码模式

**处理流程：**
1. 接收用户输入的记忆/规则文本
2. 调用 `add_rule_associations(data=memory, rules_nodeset_name="coding_agent_rules")`
3. LLM 从输入文本中提取结构化规则
4. 规则存储到 `coding_agent_rules` 节点集

**触发方式：** MCP 工具 `write_memory`

**限制：** 仅在直连模式下可用（非 API 代理模式）

**示例输入：**
- "用户偏好：代码注释使用中文"
- "本项目使用 FastAPI + async/await 全异步架构"
- "访问嵌套属性前必须检查 None"
- "代码必须符合 PEP8 标准，添加 Typing 和 Docstrings"

---

## 4. 规则检索

### 4.1 读取全部规则（read_memory）

**功能描述：** 读取所有已存储的规则/记忆，不做任何过滤。

**处理流程：**
1. 从图数据库获取 `coding_agent_rules` 节点集下的全部子图
2. 提取所有 Rule 节点的 text 字段
3. 格式化输出：带序号的规则列表

**返回格式：**
```
=== YOUR STORED RULES (N total) ===
1. 规则文本 1
2. 规则文本 2
...
```

**触发方式：** MCP 工具 `read_memory`

**限制：** 仅在直连模式下可用

### 4.2 语义搜索规则（CODING_RULES 搜索类型）

**功能描述：** 通过语义搜索查询与给定问题相关的编码规则。

**详细需求：**
- 搜索类型：`SearchType.CODING_RULES`
- 使用 `CodingRulesRetriever` 执行检索
- 支持按 node_name 过滤指定 NodeSet
  - 默认查询 `coding_agent_rules`
  - 可指定多个 NodeSet 名称（并行查询后合并结果）
- 不指定 node_name 时使用默认 `coding_agent_rules`

**检索方式：**
- 通过图引擎的 `get_nodeset_subgraph` 获取指定 NodeSet 的全部子图
- 提取所有 Rule 节点的 text 字段
- 支持并行查询多个 NodeSet
- 结果合并返回

**与 read_memory 的区别：**

| 维度 | read_memory | CODING_RULES 搜索 |
|------|------------|-------------------|
| 接口 | MCP 工具 | Search API |
| 过滤 | 无过滤，返回全部 | 支持 node_name 过滤 |
| 返回格式 | 格式化文本 | 原始列表 |
| 可用环境 | 仅直连模式 | 全模式（API/直连） |
| 用途 | Agent 审查自己的记忆 | 代码生成时查询相关规则 |

---

## 5. 规则管理（通过 Memify 管道）

### 5.1 自定义规则提取管道

**功能描述：** 通过 Memify 管道对已有知识图谱执行自定义规则提取和富化。

**标准使用流程：**

1. **定义抽取任务**（从图谱提取 chunk）：
   - `extract_subgraph_chunks`：从指定子图中提取所有文档块

2. **定义富化任务**（从 chunk 提取规则）：
   - `add_rule_associations`：从文档块中提取编码规则
   - 参数：
     - `rules_nodeset_name`：目标节点集名称（如 `"coding_agent_rules"`）
     - `task_config.batch_size`：每批处理的 chunk 数量（推荐 1）

3. **执行 Memify**：
   - 先执行抽取任务获取文档块
   - 再逐批执行富化任务提取规则
   - 支持指定 node_name 过滤子图范围

### 5.2 默认 Memify 行为

当用户不指定任何自定义任务时，Memify 的默认行为就是进行编码规则提取：
- 默认抽取任务 = extract_subgraph_chunks
- 默认富化任务 = add_rule_associations(rules_nodeset_name=`"coding_agent_rules"`)

---

## 6. 规则关联与溯源

### 6.1 规则-文档关联

**功能描述：** 每条规则自动关联到其来源的原始文档块，支持溯源。

**关联机制：**
- 对输入文本在 `DocumentChunk_text` 向量集合中执行相似搜索（limit=1）
- 找到最相似的 DocumentChunk 作为 origin
- 创建关系边：`Rule.id → rule_associated_from → DocumentChunk.id`
- 边的元数据：
  - relationship_name: `"rule_associated_from"`
  - source_node_id: Rule 的 UUID
  - target_node_id: DocumentChunk 的 UUID
  - ontology_valid: false

**溯源价值：**
- 了解规则的来源上下文
- 验证规则的合理性
- 在知识图谱可视化中展示规则与文档的关联

---

## 7. 前端展示需求

### 7.1 规则列表页

- 展示所有已存储的编码规则
- 按 NodeSet 分组展示
- 每条规则显示：文本内容、创建时间、来源文档

### 7.2 规则详情页

- 规则文本完整展示
- 关联的原始文档块（支持跳转查看原文）
- 规则所属的 NodeSet

### 7.3 规则操作

- 手动添加规则（write_memory 功能）
- 从指定数据集/子图批量提取规则（Memify 功能）
- 查看规则在图谱中的位置（跳转图谱可视化）

### 7.4 规则检索

- 搜索框支持 CODING_RULES 搜索
- 支持选择目标 NodeSet 过滤
- 结果列表展示匹配的规则

---

## 8. MCP 工具集成一览

| MCP 工具 | 功能 | 模式限制 |
|----------|------|---------|
| write_memory | 手动写入规则/记忆 | 仅直连模式 |
| read_memory | 读取全部已存储规则 | 仅直连模式 |
| save_interaction | 保存交互并自动提取规则 | 规则提取仅直连模式 |
| search (CODING_RULES) | 语义搜索编码规则 | 全模式 |
