# OpenGrove 项目概览

OpenGrove 是一个本地优先的 agent host，用来承载安静、有组织的工作流。它在原生 agent 内核、本地知识文件、工具边界、产物、设置、审批和诊断之间提供一层稳定的工作空间。

OpenGrove 不是新的模型循环，也不是通用聊天壳。当前设计是：原生内核继续负责自己的推理、工具、会话语义、上下文压缩和 provider 行为；OpenGrove 负责它们外面的 host 层。

## 当前产品形态

OpenGrove 目前有五个主要可见面：

- **本地 UI**：React 工作台，用于对话、运行控制、设置、知识文件、工具活动摘要、审批和诊断。
- **本地 bridge**：Node HTTP bridge，默认运行在 `127.0.0.1:37371`，负责提供 UI 并把请求路由到选中的内核。
- **知识库**：本地 JSON 状态，加上 `data/opengrove-vault/` 下的 file-first vault。
- **内核 adapters**：Codex、Claude Code、Hermes、Pi、OpenClaw、OpenCode、DeepSeek TUI、Gemini CLI、Qwen Code，以及通用外部 CLI。
- **浏览器 adapter**：一个很薄的扩展，用于暴露选中的页面上下文，但不变成第二个 agent runtime。

项目仍处在早期源码运行阶段。package 仍是 private，API 可能变化，本地数据格式还不是稳定发布契约。

## 核心思路

OpenGrove 把责任拆成三层。

1. **Kernel**
   原生运行时负责模型循环、原生工具、鉴权、上下文压缩、提示词规则和 provider 特有行为。

2. **Host**
   OpenGrove 负责本地状态、vault 文件、设置、审批 UI、bridge API、事件归一化、产物、记忆、routine 和长期记录。

3. **Adapter**
   每个 adapter 把原生行为映射成 OpenGrove 概念：启动回合、流式事件、审批、用户追问、产物、上下文压缩、运行控制、知识来源、provider 配置、诊断和 session 绑定。

这样系统可以扩展，同时不假装所有 agent 内部都长得一样。

## 分层架构

### Core

`src/core/` 定义稳定的领域契约：

- event 类型
- policy 和 approval 概念
- registries
- memory、artifact、execution、routine、session、approval 和 working-state stores
- agent、tool、knowledge 和 runtime 共享类型

`src/core.ts` 只保留一层很薄的 re-export。

### App Composition

`src/app/create-opengrove.ts` 负责组装可运行的 host：

- 注册 host tools 和 capabilities
- 加载 skills 和 packs
- 准备上下文
- 连接 stores
- 监听 compaction 和 working-state 变化
- 在内核支持时发布兼容的原生 skills
- 创建 bridge 使用的 `OpenGroveApp`

`src/app/skill-tree.ts` 支持 skill 组织和发现。

### Kernel Layer

`src/kernel/` 定义 adapter 边界：

- `types.ts`：adapter capabilities、session handles、runtime controls、discovery snapshots 和 knowledge source 类型
- `adapter.ts`：通用 runtime adapter 和 OpenGrove vault knowledge sources
- `discovery.ts`：本地 binary/config/source 发现辅助函数
- `tool-bridge.ts`：把 host tools 映射成内核可用的行为
- `adapters/`：Codex、Claude Code、Hermes、Pi 和外部 CLI 的具体 adapters

当前 kernel ids：

- `codex`
- `claude-code`
- `hermes`
- `pi`
- `openclaw`
- `deepseek-tui`
- `gemini-cli`
- `qwen-code`
- `opencode`

### Runtime Layer

`src/runtime/` 放具体执行桥：

- Codex app-server / RPC bridge、approval bridge、dynamic tool bridge、auth refresh、event projection 和 thread binding
- Claude Code CLI bridge
- Claude Agent SDK runtime，包含 OpenGrove MCP tools、approval 和用户追问处理
- Hermes CLI bridge 和 provider config 生成
- Pi native/runtime bridge
- 通用外部 CLI runtime
- kernel subprocess proxy 环境注入
- provider HTTP capture 工具
- Codex RPC capture 工具
- session history helpers
- scripted session 测试 runtime

Runtime 层应该归一化事件，但不遮住原生内核真实发生的事情。

### Server Layer

`src/server/` 运行本地 bridge，并负责大部分 host 编排：

- 静态 UI 服务
- `/health`、`/inventory`、`/ask/stream`、`/approvals`、`/memory`、`/artifacts`、`/routines`、`/events`、`/context-records` 和 settings routes
- bridge security、CORS、token 检查和本地 env 加载
- bridge state 和持久化 settings
- kernel selection 和 runtime control 生成
- kernel registry、路径覆盖、config-home 覆盖和 kernel model routing
- provider profiles、provider bindings、原生 provider discovery 和 provider env 构造
- 为部分兼容 provider 准备的 Codex responses/chat proxy
- 基于 async local storage 的 per-turn context
- knowledge file sync、vault file serving、artifact/media extraction、approval actions、working-state sync 和 trajectory records

Bridge 是本地优先的，不应该把私有 provider key 存进可跟踪文件。

### Knowledge Layer

`src/knowledge/` 把本地记录和文件整理成可用视图：

- memory view
- artifact view
- skill view
- feedback scoring
- organizer helpers
- JSON-backed knowledge store 和 ledgers

产品方向是 file-first。Vault 应该先像一个可检查的本地工作空间；更高级的 wiki、图谱和引用关系可以后续建立在它之上。

### Skills、Packs 与 Capabilities

`src/skills/` 负责 skill catalog 加载、runtime 行为和原生发布辅助逻辑。Skill 是知识对象，不是权限豁免。

`src/packs/` 和 `src/capabilities/` 包含内置能力面，例如：

- browser action support
- computer use support
- Weread companion support

如果某个内核有原生 skill loading，OpenGrove 应该把 skill 发布或引用到该内核期望的位置，而不是把完整 skill 正文硬塞进 prompt。

### Tools

`src/tools/` 定义 host tools：

- browser context
- browser actions
- computer state
- memory
- skills
- host UI actions

高风险动作仍然要通过 policy、approval、event log 和 UI feedback 保持可见。

### Web UI

`web/src/` 是本地 UI：

- conversation thread runtime
- chat composer 和 skill command menu
- message activity summaries
- conversation sidebar
- 用于 kernels、providers、paths、proxy 和 knowledge sources 的 settings dialog
- knowledge file/editor views
- runtime UI model 和 bridge queries
- 本地化 UI 文案

UI 只应该展示有完整交互闭环的控件。隐藏功能或半接好的功能不要露出来。

### Browser Extension

`extension/` 是一个小型浏览器上下文 adapter：

- selection snapshots
- page snapshot messages
- sidebar toggle event
- host-requested snapshots

它不直接调用本地 bridge，不持久化页面内容，不读取 password inputs，并且会跳过敏感浏览器页面。

## 上下文策略

OpenGrove 不应该每轮都把所有东西塞进 prompt。

普通对话默认上下文应该很小：

- 用户输入
- 显式附件
- 显式 context chips
- 当前 runtime controls
- 必要时的少量 browser/computer/vault hints

Vault AI 的上下文更窄：

- 当前文件路径
- 当前文件类型
- 必要时的选中文本或小段预览
- 提醒模型可以使用原生 read/search 工具读取完整内容

规则很简单：用户明确加入的内容可以放进去；环境上下文要轻；完整文件需要时用工具读。

## Provider 策略

Provider 配置在 host 层保持 kernel-neutral，但在 adapter 边界会变成 kernel-specific。

当前 bridge 支持：

- provider profiles
- OpenAI-compatible、Anthropic-compatible、Gemini-compatible、native OAuth 和 custom gateway protocols
- provider-to-kernel bindings
- 每个内核不同的 env/config-file/native-api binding mode
- model aliasing 和 kernel model routing
- Codex、Claude Code 等内核的原生 provider discovery
- 可选的 kernel subprocess proxy 注入
- 可选的 provider HTTP capture 诊断

Secrets 应该只放在本地环境文件或原生 provider config 中，不能进入跟踪文件。

## Approval 与安全

OpenGrove 把高风险动作当成 host 可见事件：

- 执行命令
- 修改文件
- 改变权限范围
- 浏览器动作
- 桌面动作
- 写入长期 memory
- 改变 provider/capture 设置

Approval 层应该是 typed、可见、并且 kernel-aware 的。UI 应该根据不同 approval 类型清晰渲染，而不是把所有请求都当成一段普通文本。

## 本地数据与敏感内容

默认本地运行路径：

- `data/local-state.json`
- `data/bridge-settings.json`
- `data/opengrove-vault/`
- `data/codex-threads.json`
- `data/provider-http-captures/`
- `data/trajectories/`

仓库会忽略 `data/`、`dist/`、`web-dist/`、`.env*`、原生 agent config folders、缓存和依赖目录。

环境文件加载顺序：

1. `OPENGROVE_ENV_FILE`
2. `~/.opengrove/.env.local`
3. `./.env.local`
4. `./.env`

提交前运行：

```bash
npm run check:secrets
```

当前 checker 会扫描 tracked 和未被 ignore 的 untracked 文件，查找高置信度 secret 和本地绝对路径。

## 开发规则

- 先读真实代码，再判断某个 kernel 怎么工作。
- Kernel 特有逻辑放进 adapters 或 runtimes。
- Host 概念要小、明确、类型化。
- Provider 凭证不能进入 tracked files。
- 没有完整交互闭环的设置控件不要展示。
- UI 改动要在浏览器里实际验证，不只跑 typecheck。
- 有意义的提交前至少跑 `npm run check:secrets` 和 `npm run typecheck`。
- Runtime 或 adapter 改动，条件允许时还要跑 `npm run build`、`npm run smoke` 和 `npm run test:harness`。

## 当前技术栈

- TypeScript
- Node local bridge server
- React 19
- Vite / 自定义 web build script
- CodeMirror Markdown 编辑
- Zustand 和 React Query
- JSON-backed local state stores
- Codex、Claude Code、Hermes、Pi 和 generic CLI runtime adapters
- Claude Agent SDK
- OpenGrove browser extension

## 常用命令

```bash
npm install
npm run check:secrets
npm run typecheck
npm run build
npm run smoke
npm run test:harness
npm run eval
npm run bridge
```

本地 UI 地址：

```text
http://127.0.0.1:37371/ui/
```

## 一句话总结

OpenGrove 是一个本地优先的 agent host：它让不同 AI 内核在同一个安静工作空间里协作，同时保持上下文明确、工具可见、知识可沉淀、产物可复用、provider 路由可配置，并且本地状态可检查。
