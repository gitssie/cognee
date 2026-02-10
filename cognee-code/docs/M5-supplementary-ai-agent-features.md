# M5 补充功能 & AI Agent 增强能力

> 本文档包含两部分：1) cognee 现有代码中已有但未在 M1-M4 中充分覆盖的功能；2) 基于 AI Agent 通用最佳实践，建议新增的功能模块。

---

## 第一部分：现有代码中已有的补充功能

### 5.1 会话历史与多轮对话管理

#### 功能描述
系统在 Retriever 层面内置了完整的会话历史管理能力。每次搜索交互的 Question-Context-Answer 三元组会被持久化到 Redis 缓存中，支持基于 session_id 的多轮对话上下文传递。

#### 核心能力
| 能力 | 说明 |
|------|------|
| **会话保存** | 每次 Q&A 交互自动保存 (question, context_summary, answer) 到缓存 |
| **会话恢复** | 通过 session_id 获取历史对话，格式化为 `[时间戳] QUESTION / CONTEXT / ANSWER` |
| **多会话隔离** | 基于 user_id + session_id 双重隔离，支持同一用户多个并行会话 |
| **自动注入上下文** | 7 个 Retriever 自动获取并注入历史对话作为 LLM 的额外上下文 |
| **优雅降级** | 缓存不可用时静默降级，不影响主搜索流程 |

#### 支持的 Retriever
- GraphCompletionRetriever
- GraphCompletionCotRetriever
- GraphCompletionContextExtensionRetriever
- GraphSummaryCompletionRetriever
- TemporalRetriever
- TripletRetriever
- EntityCompletionRetriever

#### 前端需求
- 会话列表管理（创建/切换/删除会话）
- 会话历史展示（对话气泡式 UI）
- 多轮对话连续提问体验

---

### 5.2 用户反馈与质量调优

#### 功能描述
系统内置了用户对 AI 回答的反馈闭环机制。用户可以对任意回答提交文本反馈，系统使用 LLM 进行情感分析评估，并将反馈结果回写到知识图谱，调整相关节点的权重。

#### 核心流程
1. **用户提交反馈** → 文本形式
2. **LLM 情感分析** → 评估情感（Positive / Negative / Neutral）+ 评分（-5 到 +5）
3. **创建反馈数据点** → `CogneeUserFeedback` (feedback, sentiment, score)
4. **关联用户交互** → 通过 `gives_feedback_to` 边连接到最近 K 次交互
5. **图谱权重调整** → 调用 `graph_engine.apply_feedback_weight()` 更新节点权重

#### 数据模型
| 模型 | 字段 |
|------|------|
| **CogneeUserFeedback** | feedback (str), sentiment (str), score (float) |
| **CogneeUserInteraction** | question (str), answer (str), context (str) |
| **UserFeedbackEvaluation** | score (-5~+5), evaluation (positive/negative/neutral) |

#### 前端需求
- 每个 AI 回答下方的「👍 / 👎 / 评论」反馈按钮
- 反馈统计仪表盘（整体满意度、趋势变化）
- 反馈详情列表（按时间/评分筛选）

---

### 5.3 使用分析与监控

#### 功能描述
系统通过 `log_usage` 装饰器在所有 MCP 工具和 API 路由上进行调用日志采集，记录每次调用的函数名、参数、执行时间、成功/失败状态、用户 ID 等信息，存储到 Redis 缓存。

#### 采集范围
| 层级 | 覆盖范围 |
|------|----------|
| **MCP 工具** | cognify, search, save_interaction, list_data, delete, prune, cognify_status, write_memory, read_memory |
| **API 路由** | add, search, cognify, memify 等核心接口 |

#### 日志字段
- timestamp, function_name, log_type (api_endpoint / mcp_tool)
- user_id, parameters (已脱敏), result
- success/error, duration_ms, cognee_version

#### 前端需求
- 使用量仪表盘（调用次数、活跃用户、热门功能）
- 性能监控面板（平均响应时间、失败率趋势）
- 用户行为分析（常用搜索类型、知识库使用分布）

---

### 5.4 可观测性集成

#### 功能描述
系统通过 `Observer` 枚举支持接入外部 LLM 可观测性平台，用于监控 LLM 调用链路的性能、成本和质量。

#### 支持平台
| 平台 | 说明 |
|------|------|
| **Langfuse** | 开源 LLM 可观测平台，追踪 Prompt、Completion、Cost |
| **LangSmith** | LangChain 官方可观测平台 |
| **LLMLite** | 轻量级 LLM 代理层的监控 |
| **NONE** | 无监控（默认） |

#### 前端需求
- 设置页面中的可观测平台选择与配置
- 外链跳转到对应平台的仪表盘

---

### 5.5 Retriever 插件系统

#### 功能描述
系统提供 `use_retriever(search_type, retriever)` 注册机制，允许开发者注册自定义 Retriever 到任意 SearchType，实现搜索策略的扩展和替换。

#### 扩展点
| 扩展点 | 接口 | 说明 |
|--------|------|------|
| **BaseRetriever** | `async retrieve(query, user) → List` | 搜索策略基类 |
| **BaseContextProvider** | `async get_context(entities, query) → str` | 上下文组装策略 |
| **BaseEntityExtractor** | `async extract_entities(text) → List[Entity]` | 实体抽取策略 |

#### 现有实现
- **ContextProvider**: `TripletSearchContextProvider`（三元组搜索上下文）、`SummarizedTripletSearchContextProvider`（摘要版）
- **EntityExtractor**: `DummyEntityExtractor`（示例实现）
- **Community Retrievers**: 全局注册表 `registered_community_retrievers`

#### 前端需求（面向开发者）
- 插件管理页面（查看已注册的自定义 Retriever 列表）
- 搜索策略配置（按 SearchType 选择使用哪个 Retriever）

---

### 5.6 评估框架

#### 功能描述
cognee 内置了一套评估框架 (`eval_framework`)，用于衡量知识图谱质量、搜索准确率和 AI 回答质量。

#### 核心模块
| 模块 | 说明 |
|------|------|
| **analysis** | 评估结果分析工具 |
| **answer_generation** | 基准答案生成 |
| **benchmark_adapters** | 适配不同评估数据集 |
| **corpus_builder** | 语料库构建 |
| **evaluation** | 评估执行引擎 |
| **metrics_dashboard** | 指标可视化仪表盘 |

#### 前端需求
- 评估任务创建与执行
- 评估报告展示（准确率、召回率、F1 等指标）
- 评估结果对比（不同模型/配置之间的比较）

---

## 第二部分：建议新增的 AI Agent 功能

### 5.7 Prompt 模板管理

#### 功能描述
为 AI Agent 提供 Prompt 模板的 CRUD 管理能力，支持不同场景下的 Prompt 复用、版本管理和 A/B 测试。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **模板 CRUD** | 创建、查看、编辑、删除 Prompt 模板 |
| **变量插值** | 支持 `{{variable}}` 占位符，运行时替换 |
| **版本管理** | 每次修改自动保存版本，支持回滚 |
| **分类标签** | 按用途分类（系统提示、用户提示、规则提取等） |
| **效果评估** | 跟踪每个模板版本的使用频率和用户反馈评分 |

#### 与现有系统的关系
cognee 已有 `coding_rule_association_agent_system.txt`、`coding_rule_association_agent_user.txt` 等硬编码的提示模板文件，该功能将其升级为可管理的动态模板。

---

### 5.8 Agent 人格配置

#### 功能描述
允许用户定义不同的 AI Agent 人格/角色，每个人格拥有独立的系统提示、行为模式和知识范围，适用于不同工作场景。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **人格创建** | 定义名称、描述、系统提示、可用工具集 |
| **人格切换** | 在不同人格间切换，改变 Agent 行为 |
| **知识范围绑定** | 每个人格可绑定特定的 Dataset 或 NodeSet |
| **行为约束** | 定义回答风格（简洁/详细）、语言、格式偏好 |

#### 典型场景
- **Code Reviewer**: 绑定编码规则知识库，专注代码评审
- **Technical Writer**: 绑定文档知识库，生成技术文档
- **QA Analyst**: 绑定测试知识库，辅助测试用例生成

---

### 5.9 知识图谱版本控制

#### 功能描述
为知识图谱提供类 Git 的版本控制能力，记录每次 Cognify 操作带来的图谱变更，支持版本对比和回滚。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **快照** | 每次 Cognify 自动创建图谱快照（或差异记录） |
| **版本列表** | 查看所有历史版本及变更摘要 |
| **差异对比** | 对比两个版本之间新增/删除/修改的节点和边 |
| **回滚** | 将图谱回滚到指定历史版本 |
| **分支** | 基于某个版本创建实验分支，独立修改后可合并 |

---

### 5.10 知识库导入/导出

#### 功能描述
支持知识图谱的标准化导入导出，便于知识库的迁移、共享和备份。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **导出格式** | JSON-LD、RDF/Turtle、CSV、Neo4j Dump |
| **部分导出** | 按 Dataset、NodeSet 或子图范围导出 |
| **导入合并** | 导入时自动检测冲突，支持覆盖/合并/跳过策略 |
| **跨实例同步** | 两个 cognee 实例之间的知识库同步 |

---

### 5.11 事件通知与 Webhook

#### 功能描述
为异步操作（如 Cognify、Pipeline 运行）提供事件通知能力，让外部系统能够感知状态变化。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **事件类型** | cognify_completed, cognify_failed, data_added, data_deleted, rule_extracted, pipeline_finished |
| **通知渠道** | Webhook (HTTP POST)、WebSocket (已有基础)、邮件 |
| **Webhook 管理** | 注册/编辑/删除 Webhook URL，配置事件过滤 |
| **重试机制** | Webhook 调用失败自动重试（指数退避） |
| **事件日志** | 所有事件的审计日志，可查询和回放 |

#### 与现有系统的关系
cognee 已有 WebSocket 通知用于 cognify 进度推送（via `TaskNotifier`），该功能是对其的扩展和通用化。

---

### 5.12 Agent 工作流编排

#### 功能描述
提供可视化的 Agent 工作流编排能力，将多个原子操作（添加数据→认知处理→搜索→提取规则）串联为自动化流水线。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **工作流定义** | 拖拽式编排多个 Task 节点 |
| **条件分支** | 基于上一步结果决定下一步（if/else） |
| **循环迭代** | 对集合中每个元素执行子流程 |
| **定时触发** | Cron 表达式定时执行工作流 |
| **变量传递** | 上一步输出作为下一步输入 |

#### 与现有系统的关系
cognee 已有 `Pipeline` + `Task` 的代码级编排能力，该功能是将其提升为可视化、用户可配置的工作流引擎。

---

### 5.13 RAG 质量评分与自动优化

#### 功能描述
对每次搜索/回答进行自动质量评分，并根据评分结果优化检索策略参数（如 top_k、chunk_size 等）。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **回答评分** | 使用 LLM 自动评估回答的相关性、完整性、准确性 |
| **检索质量** | 评估检索到的 chunk 与问题的语义相关度 |
| **参数自动调优** | 基于历史评分调整 top_k、搜索类型选择等参数 |
| **质量报告** | 定期生成搜索质量报告，标识低质量回答的模式 |

#### 与现有系统的关系
- 可复用 `eval_framework` 的评估指标
- 可结合用户反馈系统 (`UserQAFeedback`) 的人工评分

---

### 5.14 Tool Use 审计追踪

#### 功能描述
记录 AI Agent 每次工具调用的完整链路，提供可追溯的决策过程审计。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **调用链路** | 记录从用户请求到工具调用到最终响应的完整链路 |
| **决策日志** | 记录 Agent 选择某个工具/搜索类型的推理过程 |
| **成本追踪** | 记录每次 LLM 调用的 token 消耗和费用 |
| **回放能力** | 可视化回放某次交互的完整处理过程 |

#### 与现有系统的关系
- 复用 `usage_logger` 的日志采集基础设施
- 扩展 `Responses API` 的 `ChatUsage` (input_tokens, output_tokens) 记录

---

### 5.15 配额与速率限制管理

#### 功能描述
为多租户场景提供 API 和 LLM 调用的配额管理和速率限制能力。

#### 核心功能
| 功能 | 说明 |
|------|------|
| **用户配额** | 每个用户/组织的 API 调用次数限制（日/月） |
| **LLM Token 配额** | 每个用户/组织的 Token 消耗上限 |
| **速率限制** | 每分钟/每秒的请求频率限制 |
| **配额仪表盘** | 实时展示配额使用情况和剩余额度 |
| **超额策略** | 达到限额后的处理（排队/降级/拒绝） |

#### 与现有系统的关系
cognee 已有环境变量 `LLM_RATE_LIMIT_ENABLED` 和 `LLM_RATE_LIMIT_REQUESTS` 的基础速率限制，该功能是将其提升为完整的配额管理体系。

---

## 功能优先级建议

| 优先级 | 功能 | 理由 |
|--------|------|------|
| **P0 - 必须** | 5.1 会话历史管理 | 后端已完整实现，前端仅需 UI 对接 |
| **P0 - 必须** | 5.2 用户反馈 | 后端已实现，是提升 AI 质量的核心闭环 |
| **P0 - 必须** | 5.3 使用分析 | 后端已有数据采集，需仪表盘展示 |
| **P1 - 重要** | 5.7 Prompt 模板管理 | AI Agent 的核心配置能力 |
| **P1 - 重要** | 5.10 知识库导入/导出 | 数据可移植性的基本保障 |
| **P1 - 重要** | 5.11 事件通知 | 与外部系统集成的基础能力 |
| **P1 - 重要** | 5.14 Tool Use 审计 | Agent 行为的可解释性和可追溯性 |
| **P2 - 增强** | 5.4 可观测性集成 | 已有基础，需前端配置页面 |
| **P2 - 增强** | 5.8 Agent 人格配置 | 提升 Agent 场景适应性 |
| **P2 - 增强** | 5.12 工作流编排 | 提升自动化能力，需要较多开发量 |
| **P2 - 增强** | 5.13 RAG 质量评分 | 持续优化搜索质量 |
| **P3 - 远期** | 5.5 Retriever 插件 | 面向开发者的扩展能力 |
| **P3 - 远期** | 5.6 评估框架 | 质量保障体系 |
| **P3 - 远期** | 5.9 图谱版本控制 | 技术复杂度较高 |
| **P3 - 远期** | 5.15 配额管理 | 多租户商业化需求 |
