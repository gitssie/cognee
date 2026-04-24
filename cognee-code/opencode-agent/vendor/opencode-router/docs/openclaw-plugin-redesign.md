# opencode-router 插件加载机制重做设计

## 背景

当前 `opencode-router` 的插件设计文档把加载机制建立在 `openclaw.plugin.json`、`plugins.load.paths`、`plugins.entries`、manifest registry 上，但参考代码 `/root/workspace/github/opencode/packages/opencode/src/plugin` 后可以确认：**opencode 当前插件系统的核心不是 manifest-first，而是 config-first 的 spec loader**。

因此这里需要收敛一个边界：

- **插件加载机制** 参考 `opencode` 现有实现。
- **插件加载后的能力消费** 可以继续为 `opencode-router` 保留 channel / route / outbound / gateway 这些运行时抽象。

也就是说，这次调整的重点不是否定插件化，而是把“怎么发现、解析、加载插件”从 OpenClaw 式假设，改成和 `opencode` 一致的加载模型。

---

## 参考代码范围

本结论基于以下源码：

- `packages/opencode/src/plugin/index.ts`
- `packages/opencode/src/plugin/loader.ts`
- `packages/opencode/src/plugin/shared.ts`
- `packages/opencode/src/plugin/install.ts`
- `packages/opencode/src/plugin/meta.ts`
- `packages/opencode/src/config/plugin.ts`
- `packages/opencode/src/config/config.ts`
- `packages/opencode/specs/tui-plugins.md`

---

## 核心结论

## 1. opencode 的加载入口是 `plugin` 列表，不是 manifest registry

`opencode` 里插件配置的主入口是：

```json
{
  "plugin": [
    "@acme/opencode-plugin@1.2.3",
    ["./plugins/demo.ts", { "label": "demo" }]
  ]
}
```

关键点：

- 每个条目是 `spec` 或 `[spec, options]`
- `spec` 可以是 npm spec、`file://`、相对路径、绝对路径
- 相对路径在配置合并时就会按**声明它的配置文件位置**解析
- 多份配置合并后，会形成带来源信息的 `plugin_origins`
- 去重发生在**真正 import 前**，按 npm 包名或 resolved file spec 去重

这和当前文档假设的：

- `plugins.load.paths`
- `plugins.entries[pluginId]`
- 先扫 manifest 再决定是否加载

不是一回事。

**结论：如果 `opencode-router` 要“参考 opencode”，加载层的主配置入口应改为 `plugin` 列表模型，而不是继续把 manifest/config entry 当作第一入口。**

## 2. opencode 的加载器是 resolve/load pipeline，不是 discovery/manifest/registry 三段式

`PluginLoader` 的真实流程是：

1. 先把配置项归一成 `Plan(spec, options, deprecated)`
2. `resolvePluginTarget(spec)`
   - npm：按需安装并返回目录
   - file/path：解析为本地文件或目录目标
3. `createPluginEntry(spec, target, kind)`
   - 判断 `server` / `tui` 入口
4. npm 插件执行 `engines.opencode` 兼容性校验
5. 动态 `import(entry)`
6. 把已加载模块交给上层 runtime 继续处理

也就是说，`opencode` 的加载器负责的是：

- spec 解析
- 入口解析
- 兼容性校验
- 模块导入
- 缺失入口/安装失败/导入失败的分级报告

**它不负责：**

- 扫 `openclaw.plugin.json`
- 建 manifest registry
- 先按 plugin id 做 schema gate
- 在加载阶段构造 channel-specific setup

所以 `opencode-router` 的文档必须从“registry-first 的加载机制”调整为“loader-first 的加载机制”。

## 3. 插件是否启用、插件 id、插件 options 都不是 manifest 先验信息

参考实现里：

- `options` 来自配置 tuple `[spec, options]`
- `id` 是**模块加载后**再解析出来的
- file 插件必须显式导出 `id`
- npm 插件可在缺省时回退到 `package.json.name`

这意味着：

- 加载前宿主不应假定自己已经有稳定的 plugin id → config entry 对应关系
- 加载前宿主只知道 `spec` 和可选 `options`
- plugin-level config 的第一输入面是 `options`，不是 `plugins.entries[pluginId].config`

所以当前文档中大量把 `plugins.entries[pluginId].config` 当成插件正式主配置面的表述，需要下调为：

- 若 `opencode-router` 保留额外 config namespace，它也应是**运行时层补充配置**
- 不能把它定义成参考 `opencode` 的加载主模型

## 4. opencode 先做配置归一与去重，再做模块加载

`config/plugin.ts` 与 `config/config.ts` 里的关键信号是：

- path spec 在 merge 时先解析，避免后续相对路径语义漂移
- `plugin_origins` 保留 winning spec 的来源与 scope
- 去重依据是：
  - npm：包名
  - file：resolved file URL

这对 `opencode-router` 的直接约束是：

- 不要在运行时 discovery 阶段再做“来源解释”
- 要在 config 层先把 plugin spec 归一化
- 要在 import 前完成 precedence 与 dedupe

否则又会出现：

- 宿主一边按 load path 扫描
- 一边按 plugin id 配 entry
- 一边再按 channel 做桥接

三个维度互相缠绕的问题。

## 5. opencode 的 internal plugin 与 external plugin 共享同一加载契约

`plugin/index.ts` 中先加载 `INTERNAL_PLUGINS`，再加载 external plugins；但两者最终都进入同一 hook/runtime 执行面。

这说明推荐模型应当是：

- builtin/internal plugin：宿主直接 import
- external plugin：通过 `PluginLoader.loadExternal()` 解析与导入
- 二者最终都进入同一注册/初始化流程

这比当前 `opencode-router` 里“manifest candidate → createWecomBridgePlugin()` 的分叉方式更合理。

## 6. opencode 的模块契约是 target-specific，不是一个 manifest 描述全部运行时

参考代码里明确存在目标隔离：

- `server` 模块
- `tui` 模块
- 一个 v1 模块不能同时导出 `server` 和 `tui`

这说明加载层更适合围绕：

- **目标类型**（server/router/channel-runtime）
- **入口点解析**

来设计，而不是围绕一个宿主私有 manifest 扩张出越来越多字段。

对 `opencode-router` 来说，应优先定义：

- router target 的模块入口契约
- 该 target 能注册哪些 capability

而不是先定义 `openclaw.plugin.json` 再让宿主去猜如何装配。

## 7. opencode 允许缺失入口被跳过，而不是所有插件错误都升级为致命失败

`PluginLoader` 会区分：

- install 错误
- entry 解析错误
- compatibility 错误
- load 错误
- 缺失目标入口（missing）

尤其是“缺失目标入口”在参考实现里是可报告、可跳过的分支，不一定等于整个插件系统失败。

因此 `opencode-router` 设计上也应当保留：

- 可跳过的 plugin candidate
- 可观测的失败分类
- 非致命错误的继续加载能力

而不是要求每个 candidate 都必须满足一套严格 manifest 前置约束。

## 8. opencode 的加载顺序是“并行解析/导入 + 顺序初始化”

参考实现里：

- 外部插件 resolve/load 可以并行
- 真正执行插件、注册 hook/capability 时保持顺序，确保行为可预测

这对 `opencode-router` 的设计意义是：

- loader 层可以并发
- runtime register 层应保持稳定顺序
- 不要把“发现顺序、导入顺序、通道注册顺序”混成隐式副作用

## 9. file plugin 的一次重试机制是加载器的一部分

`PluginLoader.loadExternal()` 支持：

- 对本地 file plugins，在首次失败后等待依赖准备完成
- 然后重试一次

这个细节很重要，因为它说明参考实现并不是“扫到了就立即判死刑”，而是允许本地开发态插件有一次 dependency-ready 之后的重试窗口。

如果 `opencode-router` 也要支持本地开发插件，建议保留这一点。

---

## 对 opencode-router 的修正结论

## 1. 需要放弃把 `openclaw.plugin.json` 当成加载主入口

如果目标是参考 `opencode`，那么：

- `openclaw.plugin.json` 不应再是插件加载的第一入口
- `plugins.load.paths` 不应再是主配置模型
- `plugins.entries[pluginId].config` 不应再被定义为加载层唯一正式输入面

这些结构最多只能作为：

- 兼容旧设计的过渡层
- 或运行时 capability 描述的补充元数据

**但不能继续主导加载流程。**

## 2. 新的加载主模型应为 `plugin` 列表

建议 `opencode-router` 的目标配置形态改为：

```json
{
  "plugin": [
    "@wecom/opencode-router-plugin",
    [
      "./plugins/wecom.ts",
      {
        "accounts": [
          {
            "id": "default",
            "enabled": true,
            "directory": "/workspace/.tmp/wecom",
            "botId": "...",
            "secret": "..."
          }
        ]
      }
    ]
  ]
}
```

其语义应与参考实现保持一致：

- string = 只有 spec
- tuple = `spec + plugin options`
- 相对路径按声明配置文件解析
- 多配置源合并后先 dedupe 再加载

## 3. 加载层与运行时 registry 要分开

这次文档里最需要改正的点是：

> “registry-first” 适合描述运行时 capability 组织方式；
> 但它不是参考 `opencode` 的插件加载机制。

建议把两层拆开：

### 加载层

- 输入：`plugin` specs / options
- 输出：已解析并 import 的 plugin modules

### 运行时层

- 输入：已加载 plugin modules
- 输出：channel / route / outbound / gateway / hook registry

这样 `opencode-router` 仍然可以保留通用 capability registry，
但不能再把“先做 registry/manifest”写成加载机制本身。

## 4. `bridge-plugin-wecom.ts` 仍然应删除，但理由要改写

之前文档删除它的理由主要建立在 OpenClaw manifest/registry 模型上。

调整后，删除理由应改成：

- 参考 `opencode` 后，宿主应先按统一 loader 加载 plugin module
- 然后让 plugin 在统一 runtime 中注册 capability
- 而不是宿主根据 channel 名把某个插件转成专用 setup factory

所以：

- `bridge-plugin-wecom.ts` 仍然是错误方向
- 但错误点是 **setup-first / channel-first**
- 不再需要借助“manifest registry 必须先存在”来论证

## 5. `plugin-host.ts` 仍要加强，但它属于 runtime，不属于 loader

这一点也要和旧文档区分开。

`plugin-host.ts` 的职责应该是：

- 向已加载模块提供 runtime API
- 收集 channel / route / hook / outbound 等注册结果
- 形成 router 可消费的 capability registry

它不应该负责：

- 插件 spec 发现
- manifest 扫描
- plugin enable policy 的主判定

这些职责应尽量前移到 config normalization + loader pipeline。

## 6. 配置兼容迁移应在 config 层完成，不要在 bridge 层拼装

若当前已有：

- `plugins.load.paths`
- `plugins.entries`
- `channels.wecom.accounts`

建议迁移策略是：

1. 在 config load 阶段把旧结构转换成内存态 `plugin` 列表
2. 如果旧配置里有独立 plugin config，也转成 tuple options
3. bridge/runtime 只消费归一化后的 `plugin_origins` / loaded plugins

不要继续在 bridge 层同时理解：

- load paths
- plugin entries
- channels.wecom
- wecom bridge setup

否则加载机制永远不会干净。

---

## 建议的目标架构

## 1. Config Normalization

职责：

- 读取 `plugin` 列表
- 解析相对路径 spec
- 合并多层配置
- 生成 `plugin_origins`
- 先做 dedupe / precedence
- 兼容期把旧字段映射到 `plugin` 列表

输出：

- `plugin_origins: Array<{ spec, source, scope }>`

## 2. Plugin Loader

职责：

- `spec -> target`
- target entrypoint 解析
- npm 兼容性检查
- 动态 import
- 区分 missing / install / entry / compatibility / load 错误
- 对 file plugins 支持一次重试

输出：

- `loaded plugins`

## 3. Plugin Runtime Host

职责：

- 给每个 loaded plugin 提供 runtime API
- 顺序执行 plugin register/init
- 解析 plugin id
- 收集 capability

输出：

- `channelRegistry`
- `routeRegistry`
- `hookRegistry`
- `outboundRegistry`
- `gatewayRegistry`

## 4. Bridge / Router Runtime

职责：

- 只消费 registry
- 不再按 `channel === "wecom"` 决定加载逻辑
- 不再直接 import 特定通道 helper

## 5. opencode-agent 统一启动集成层

`cognee-code/opencode-agent/src` 现在已经有统一启动 `opencode` 的入口：

- `src/index.ts` 负责启动 `opencode serve`
- `src/config.ts` 负责构造 `OPENCODE_CONFIG_CONTENT`
- `src/plugin/index.ts` 负责注入 cognee 自己的 opencode plugin

这意味着后续不应让 `opencode-router` 长期作为一个完全独立、手工启动的旁路进程；
更合理的目标是：

- 由 `opencode-agent` 负责统一启动编排
- `opencode-agent` 启动 `opencode`
- `opencode-agent` 再启动 `opencode-router`
- 两者共享同一组工作目录、认证信息、端口与插件安装策略

### 5.1 集成目标

统一启动后，应达到：

1. 用户只启动一次 `opencode-agent`
2. `opencode-agent` 同时拉起：
   - opencode 主服务
   - opencode-router
3. router 使用 `opencode-agent` 约定好的 data dir / workspace / health port
4. router 的 plugin runtime 目录也挂在 agent 控制的工作区下
5. 出现退出/异常时，由 agent 统一回收子进程

### 5.2 推荐的启动职责划分

#### `opencode-agent`

- 负责主进程生命周期
- 负责环境变量拼装
- 负责 `opencode` 子进程启动
- 负责 `opencode-router` 子进程启动
- 负责 stdout/stderr 聚合日志
- 负责 shutdown fan-out

#### `opencode-router`

- 只负责消息通道桥接
- 只负责 channel/plugin runtime
- 只假设 `OPENCODE_URL`、`OPENCODE_DIRECTORY`、`OPENCODE_ROUTER_DATA_DIR` 等运行参数已准备好
- 不再承担“由谁来启动整个系统”的职责

### 5.3 推荐的配置流向

建议由 `opencode-agent/src/config.ts` 统一产出两类配置：

#### A. `opencode` 配置

继续走现有：

- `OPENCODE_CONFIG_CONTENT`
- 内含 cognee MCP、cognee plugin、agent 配置

#### B. `opencode-router` 配置

新增一份 router runtime config 生成逻辑，例如：

- 生成/维护 `opencode-router.json`
- 写入 agent 控制的 data dir
- 其中包括：
  - `opencodeDirectory`
  - `plugin`
  - `channels.wecom.accounts`
  - `groupsEnabled`
  - health port 等 router 参数

这样做的关键好处是：

- router config 不再手工漂移
- 测试环境与生产环境都由 agent 统一产出
- plugin install runtime dir 也能稳定落在 agent 工作区内

### 5.4 推荐的目录布局

建议统一收口到 `opencode-agent` 工作目录下，例如：

```text
.tmp/wecom-router/
  workspace/
  data/
    opencode-router.json
    plugins/
      package.json
      node_modules/
    logs/
```

其中：

- `workspace/`：router 绑定的工作目录
- `data/opencode-router.json`：router 配置
- `data/plugins/node_modules/`：router 自己的插件安装目录
- `data/logs/`：router 日志

这个布局和当前已实现的“router 本地 node_modules 插件安装机制”是兼容的。

### 5.5 推荐的启动顺序

在 `opencode-agent/src/index.ts` 中建议采用：

1. 启动 `opencode serve`
2. 解析 server URL
3. 生成 router config 文件
4. 启动 `opencode-router`
   - 注入 `OPENCODE_URL=<serverUrl>`
   - 注入 `OPENCODE_ROUTER_DATA_DIR=<routerDataDir>`
   - 必要时注入 `OPENCODE_DIRECTORY=<workspaceDir>`
5. 聚合监控两个子进程状态
6. 任一关键进程退出时，执行统一 shutdown

### 5.5.1 当前仓库中的实际落地方式

`cognee-code/opencode-agent/src` 现在已经补上了 router 启动编排，实际约定如下：

1. `src/index.ts` 使用 `@opencode-ai/sdk/v2` 的 `createOpencode()` 启动 opencode server
2. server URL 就绪后，调用 `src/config.ts` 中的 router runtime 辅助函数：
   - `getRouterRuntimePaths()`：生成 `.tmp/wecom-router/` 目录布局
   - `ensureRouterRuntimeConfig()`：生成/刷新 `data/opencode-router.json`，但必须保留已有 `plugin`、`channels`、`groupsEnabled` 等 router 业务配置，不能覆盖掉现有 wecom 账户信息
   - `buildRouterEnv()`：注入 `OPENCODE_URL`、`OPENCODE_DIRECTORY`、`OPENCODE_ROUTER_DATA_DIR`、`OPENCODE_ROUTER_CONFIG_PATH`、`OPENCODE_ROUTER_LOG_FILE`
3. `src/index.ts` 再直接调用 `src/router.ts`
4. `src/router.ts` 直接复用 `vendor/opencode-router/src/config.ts`、`logger.ts`、`bridge.ts`
5. agent 进程内执行 `loadConfig()` + `startBridge()`，不再额外启动 router 子进程
6. `SIGINT` / `SIGTERM` 时由 agent 同时回收 opencode server 与 router bridge runtime

这意味着本文档前面提出的“统一 supervisor”仍然成立，但“router 必须作为独立子进程托管”已经不再符合当前代码路径。

### 5.5.2 当前启动命令对应关系

对齐当前仓库后，启动入口应理解为：

```bash
# 启动 opencode-agent（会同时启动 opencode + 内嵌 router bridge）
bun run dev

# 仅单独调试 router
bun run router:dev
```

其中：

- `bun run dev` / `bun run start` → `src/index.ts`
- `src/index.ts` → `createOpencode(...)` + `startRouter()`
- `startRouter()` → 直接调用 `loadConfig()` + `startBridge()`
- `bun run router:dev` → 直接运行 `vendor/opencode-router/src/cli.ts`

所以后续文档、README、实现都应以“agent 统一启动内嵌 router runtime”为主路径，以“router:dev 单独调试 CLI”为辅路径。

### 5.6 推荐的实现边界

这里要按当前仓库状态修正：

- `opencode-router` 代码虽然仍保留独立 CLI 边界
- 但 `opencode-agent` 主路径已经直接把 router 当作本地代码依赖使用
- 当前主路径不是 child process 托管，而是进程内 bridge 集成

因此更合适的表述是：

- 保留 `vendor/opencode-router/src/cli.ts` 作为独立调试/兼容入口
- 但 `opencode-agent` 的主启动链路直接 import router runtime 模块
- 统一生命周期仍由 agent 控制，只是不再通过额外子进程实现

### 5.7 分阶段迁移建议

#### 阶段 A：统一启动，并保留独立 CLI 入口

- `opencode-agent` 增加 router config 生成逻辑
- `opencode-agent` 直接集成 router bridge 启动逻辑
- 当前手工 CLI 启动方式继续可用，但不再是主路径

#### 阶段 B：统一观测与健康检查

- `opencode-agent` 汇总 opencode / router 状态
- 对外只暴露一层总体状态视图

#### 阶段 C：统一安装与发布入口

- 让 agent 在 setup/start 阶段自动确保 router 可执行文件存在
- 后续再决定是否要把 router 构建进一步并入 agent 工作流

### 5.8 结论

因此，对 `cognee-code/opencode-agent/src` 的推荐集成结论是：

> `opencode-agent` 应成为整个系统的统一 supervisor；
> `opencode-router` 保持独立运行单元，但由 agent 统一生成配置、统一启动、统一回收；
> router 的 plugin runtime 目录也归 agent 管理。

---

## 不再采用的旧结论

以下结论不再作为本设计文档的加载机制依据：

- “插件加载必须是 discovery -> manifest registry -> registry 三段式”
- “`plugins.entries[pluginId].config` 是正式唯一配置入口”
- “宿主应先围绕 `openclaw.plugin.json` 建模，再决定如何导入模块”

这些表述与参考代码不一致。

---

## 分阶段实施建议

## 阶段 1：文档收敛

- 明确加载机制参考 `opencode/src/plugin`
- 明确 `plugin` 列表是目标入口
- 明确 registry 是运行时层，不是加载层

## 阶段 2：配置归一

- 给 router 增加 `plugin` 列表配置
- 旧 `plugins.*` / `channels.*` 先映射到新内存模型
- 引入 `plugin_origins` 风格的归一化结果

## 阶段 3：通用 loader 落地

- 抽象 `resolve/load` pipeline
- 统一错误分类与日志
- 增加 file plugin retry

## 阶段 4：runtime host 与 registry 收敛

- 让 `plugin-host.ts` 专注 runtime API 与 capability 收集
- 删除 `bridge-plugin-wecom.ts`
- `bridge.ts` 只消费 registry

## 阶段 5：第二插件验证

- 用 DingTalk 或其他插件验证
- 确认新增插件只改配置与插件包，不改宿主主流程

---

## 结论

这次修正后的核心判断是：

> `opencode-router` 可以继续追求“插件加载后由统一 registry 消费能力”；
> 但其**插件加载机制**不应继续建立在 OpenClaw 风格的 manifest-first 假设上，
> 而应改成与 `opencode` 一致的 config-first、spec-first、loader-first 模型。

一句话概括：

- **加载**：参考 `opencode/src/plugin`
- **能力消费**：由 router 自己的 runtime registry 承接
- **迁移策略**：把旧字段先归一到 `plugin` 列表，再进入统一 loader
