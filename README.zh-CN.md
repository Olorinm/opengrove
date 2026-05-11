<h1 align="center">
  <img src="assets/brand/opengrove-sapling.png" alt="OpenGrove logo" width="34" align="absmiddle" />
  OpenGrove — 本地优先 Agent 工作空间
</h1>

<p align="center">
  <strong>让人和 agent 在本地优先的工作台里对话、记忆和协作。</strong>
</p>

<p align="center">
  <a href="#开发"><img alt="Build" src="https://img.shields.io/badge/build-local-555555?style=for-the-badge" /></a>
  <img alt="Release" src="https://img.shields.io/badge/release-npm--ready-0b8ec2?style=for-the-badge" />
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-0b8ec2?style=for-the-badge" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#为什么需要-opengrove">为什么需要 OpenGrove</a> ·
  <a href="#内核">内核</a> ·
  <a href="#架构">架构</a> ·
  <a href="#开发">开发</a>
</p>

OpenGrove 为人、AI 编程 agent 和个人知识 agent 提供一个稳定的本地工作空间：Rooms、通讯录、资料库、可沉淀的本地知识文件、可见的工具活动、审批、产物、设置，以及一层可以承载多个原生 agent 内核并通过 Relay 邀请远程员工的 bridge。

它不是要替代 Codex、Claude Code、Hermes、Pi、OpenClaw、OpenCode 或其他 CLI。OpenGrove 更像它们外面的一层 host：保留本地状态的可检查性，把原生事件映射进统一界面，同时让每个内核继续掌管自己擅长的模型循环、原生工具、会话和提示词规则。

## 项目状态

OpenGrove 目前仍是早期本地开发项目。

- 包已经提供 npm CLI 入口；源码方式开发仍然支持。
- API、状态文件和 adapter 契约可能继续变化。
- 本地 bridge 默认绑定在 `127.0.0.1`。
- 需要 Node.js `>=20`。

## 快速开始

安装 CLI 并启动本地 bridge：

```bash
npm install -g opengrove
opengrove start
```

升级全局 npm 安装：

```bash
opengrove update
```

源码开发方式：

```bash
npm install
npm run typecheck
npm run bridge
```

打开本地 UI：

```text
http://127.0.0.1:37371/ui/
```

检查 bridge 状态：

```bash
curl http://127.0.0.1:37371/health
```

常用检查命令：

```bash
npm run check:secrets
npm run build
npm run smoke
npm run test:harness
npm run eval
```

## 为什么需要 OpenGrove

现在的 agent 工具已经很强，但上下文、记忆、生成文件、模型配置和工具活动经常散落在不同地方。OpenGrove 想把这些东西整理成一个本地工作空间。

- **本地优先的知识层**：memory、artifact、skill、routine、session、run trace 和 vault 文件都保存在本地 JSON 或文件系统状态里。
- **尊重原生内核**：Codex、Claude Code、Hermes、Pi、OpenClaw、OpenCode 和其他 CLI 可以继续使用自己的模型循环与工具，只通过 adapter 接入。
- **边界可见**：命令执行、文件修改、浏览器/桌面动作、长期记忆写入和权限变化都会表现为 typed event 或 approval。
- **产物是一等对象**：文件、笔记、媒体、批注和生成结果可以保存、预览、编辑、固定和复用。
- **界面保持安静**：对话、资料库、设置、诊断和运行控制更像一个专注工作台，而不是后台管理系统。

## 可以做什么

- 在 OpenGrove 本地 UI 中和 agent 对话。
- 通过设置界面或环境变量切换已安装的内核。
- 使用 Rooms 进行单聊或群聊式 kernel 对话，并通过 `@` mention 把同一条 prompt 路由给一个或多个已安装内核。
- 通过公共 Relay 邀请远程 agent 员工加入 Room，让朋友在自己的 OpenGrove 里选择一个本地员工加入并回复。
- 索引 `AGENTS.md`、`CLAUDE.md`、skills、配置文件和本地 vault 等原生知识来源。
- 使用浏览器扩展把页面上下文和选中文本发送到 bridge。
- 追踪 sessions、runs、executions、approvals、memory、artifacts、routines 和 provider capture 诊断信息。
- 将 OpenGrove skills 发布到支持原生 skill loading 的内核。
- 避免把 provider 凭证写进仓库文件。

## 远程员工和 Relay

OpenGrove 可以通过 OpenGrove Relay 转发 Room 消息。这个能力用于邀请朋友电脑上的本地 agent 加入你的 Room，同时不需要把任何一方的本地 bridge 暴露到公网。

Relay 只是消息路由边界。真正执行回复的员工仍然由各自本地 OpenGrove 选择并运行。

典型流程：

1. Room 创建者在设置里配置公共 Relay。
2. 创建者在 Room 里生成员工邀请链接。
3. 朋友在浏览器打开邀请链接。
4. 朋友的 OpenGrove 打开 Rooms，并让他选择哪个本地员工加入。
5. Room 消息和最终回复通过 Relay 传递，每个成员使用自己的 room member token。

接受邀请的朋友不需要 Relay admin token。他只会拿到邀请 token；接受后，本地 OpenGrove 会保存这个房间专属的 member token。

启动 Relay 服务：

```bash
OPENGROVE_RELAY_TOKEN=replace-with-random-admin-token \
OPENGROVE_RELAY_STATE_PATH=/var/lib/opengrove-relay/state.json \
opengrove relay --host 0.0.0.0 --port 37372
```

正式或半正式使用时，建议把 Relay 放到 HTTPS 后面，并配置：

```bash
OPENGROVE_RELAY_ENABLED=1
OPENGROVE_RELAY_URL=https://relay.example.com
OPENGROVE_RELAY_TOKEN=replace-with-random-admin-token
```

安全边界：

- Relay URL 可以公开。
- Relay admin token 只能给创建 workspace、room 和 invite 的节点使用，不能发给朋友。
- 邀请链接只发给目标朋友。
- member token 只属于某个房间成员，接受邀请后保存在本地状态里。
- 跨不可信网络使用 Relay 时应启用 HTTPS。

## 内核

OpenGrove 通过 `OPENGROVE_KERNEL` 选择内核。默认值是 `auto`，会按 Codex、Claude Code、OpenClaw、Hermes、Pi、DeepSeek TUI、其他已配置外部 CLI 内核的顺序自动选择第一个可用内核。

```bash
# 自动选择
OPENGROVE_KERNEL=auto npm run bridge

# 指定内核
OPENGROVE_KERNEL=codex npm run bridge
OPENGROVE_KERNEL=claude-code npm run bridge
OPENGROVE_KERNEL=hermes npm run bridge
OPENGROVE_KERNEL=openclaw npm run bridge
OPENGROVE_KERNEL=opencode npm run bridge
```

支持的内核 id：

| 内核 | 当前 runtime 路径 | OpenGrove 记录的更深/首选路径 | 覆盖配置 |
| --- | --- | --- | --- |
| Codex | `codex app-server --listen stdio://` JSON-RPC bridge | 原生 app-server 事件、审批、dynamic tools、thread 复用 | `OPENGROVE_CODEX_BIN` |
| Claude Code | Claude Code SDK / CLI stream bridge | SDK 管理 session 和 Claude Code 原生工具 | `OPENGROVE_CLAUDE_CLI_PATH` |
| Hermes | 默认走 stdio JSON-RPC 上的 ACP；配置后可走 OpenAI-compatible HTTP gateway | ACP session updates、原生 permission requests、原生 skill directory | `OPENGROVE_HERMES_BIN`, `OPENGROVE_HERMES_API_URL` |
| Pi | one-shot CLI fallback（`pi -p`） | JSONL RPC | `OPENGROVE_PI_BIN` |
| OpenClaw | 配置后走 OpenAI-compatible HTTP gateway；否则 one-shot CLI fallback | Gateway WebSocket | `OPENGROVE_OPENCLAW_BIN`, `OPENGROVE_OPENCLAW_API_URL` |
| OpenCode | one-shot CLI fallback（`opencode run`） | ACP | `OPENGROVE_OPENCODE_BIN` |
| DeepSeek TUI | one-shot CLI fallback（`deepseek --print`） | stdio JSON-RPC | `OPENGROVE_DEEPSEEK_TUI_BIN` |
| Gemini CLI | one-shot CLI fallback | one-shot CLI | `OPENGROVE_GEMINI_CLI_BIN` |
| Qwen Code | one-shot CLI fallback | one-shot CLI | `OPENGROVE_QWEN_CODE_BIN` |

Codex 常用配置：

```bash
OPENGROVE_KERNEL=codex
OPENGROVE_CODEX_MODEL=gpt-5.4
OPENGROVE_CODEX_APPROVAL_POLICY=never
OPENGROVE_CODEX_SANDBOX=danger-full-access
npm run bridge
```

Hermes 常用配置：

```bash
OPENGROVE_KERNEL=hermes
OPENGROVE_HERMES_MODEL=your-model
OPENGROVE_HERMES_PROVIDER=your-provider
OPENGROVE_HERMES_TOOLSETS=shell,edit
npm run bridge
```

如果某个内核暴露 `/chat/completions` 兼容接口，也可以通过 OpenAI-compatible gateway 接入：

```bash
OPENGROVE_KERNEL=openclaw
OPENGROVE_OPENCLAW_API_URL=http://127.0.0.1:11434/v1
OPENGROVE_OPENCLAW_API_KEY=replace-with-your-key
OPENGROVE_OPENCLAW_MODEL=your-model
npm run bridge

OPENGROVE_KERNEL=hermes
OPENGROVE_HERMES_API_URL=http://127.0.0.1:8000/v1
OPENGROVE_HERMES_API_KEY=replace-with-your-key
OPENGROVE_HERMES_MODEL=your-model
npm run bridge
```

## 内核接入层

OpenGrove 现在不再把所有内核都当成“prompt 输入、stdout 输出”。内核接入被拆成四层：

| 层 | 作用 |
| --- | --- |
| Transport | 负责真实通信边界：`acp`、`stdio-jsonrpc`、`jsonl-rpc`、`http-sse`、`websocket-gateway`、`pty-terminal`、`oneshot-cli` 或 `sdk-inprocess`。 |
| Event projector | 把各家原生事件转成 OpenGrove 事件，例如 `assistant.delta`、`tool.started`、`tool.finished`、`approval.requested`。 |
| Kernel manifest | 记录启动命令、session 策略、provider 绑定、approval 策略、事件映射、能力和 rollout 状态。 |
| Harness template | 给每种协议一套 fake-server 测试形状，让新内核接入时先验证事件和协议行为。 |

当前已经落地的 runtime 路径包括 Codex app-server JSON-RPC、Claude Code SDK/CLI streaming、Hermes ACP、带 host tool loop 的 OpenAI-compatible HTTP/SSE，以及 one-shot CLI fallback。尚未完全接通但更适合的协议会先写进 kernel manifest，这样后续可以按协议逐步替换 fallback。

## Provider 配置

Provider 可以在设置界面里管理，也可以通过环境变量配置。OpenGrove 支持原生 provider profile 和兼容 API provider，包括 OpenAI、Anthropic、Gemini、DeepSeek、Zhipu GLM、Kimi、DashScope、Qianfan、SiliconFlow、ModelScope、MiniMax、Stepfun、OpenRouter、NewAPI，以及 `src/server/provider-profiles.ts` 中定义的其他 provider。

环境文件按以下顺序加载：

1. `OPENGROVE_ENV_FILE`
2. `~/.opengrove/.env.local`
3. `./.env.local`
4. `./.env`

最小本地配置示例：

```bash
OPENGROVE_KERNEL=auto
OPENAI_API_KEY=replace-with-your-key

# 如果 bridge 会被非浏览器客户端访问，可以开启 token。
OPENGROVE_BRIDGE_TOKEN=dev-secret
OPENGROVE_BRIDGE_ALLOWED_ORIGINS=http://127.0.0.1:37371
```

浏览器扩展会从 `chrome.storage.local.opengroveBridgeToken` 读取同一个 bridge token。

## 本地数据

默认情况下，OpenGrove 会把运行状态写到 `data/` 目录下：

| 路径 | 用途 |
| --- | --- |
| `data/local-state.json` | 持久化 memory、artifacts、sessions、runs、approvals、routines 和 events |
| `data/bridge-settings.json` | 本地 bridge 设置与 kernel/provider 绑定 |
| `data/opengrove-vault/` | OpenGrove 知识库的 file-first vault 镜像 |
| `data/codex-threads.json` | OpenGrove session 与 Codex thread 的绑定 |
| `data/provider-http-captures/` | 可选的 provider HTTP capture 诊断信息 |
| `data/trajectories/` | run trajectory 记录 |

仓库会忽略 `data/`、`dist/`、`web-dist/`、`.env*`、原生 agent config folders、缓存和依赖目录。

覆盖主状态文件路径：

```bash
OPENGROVE_STATE_PATH=/absolute/path/to/local-state.json
```

## 浏览器适配器

OpenGrove 在 `extension/` 中提供了一个很小的浏览器扩展，用于采集页面上下文。

1. 打开 Chrome 或 Edge 的扩展管理页面。
2. 启用开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本仓库的 `extension/` 目录。

这个扩展会把选中的页面上下文交给 OpenGrove，但它不会直接调用本地 bridge，不会持久化页面内容，不会读取密码输入框，也会跳过浏览器内部页面和带有敏感 URL 暗示的页面。

更多细节见 [extension/README.md](extension/README.md)。

## Bridge API

本地 bridge 是 UI、状态、工具和内核之间的边界。

常用端点：

| 端点 | 方法 | 用途 |
| --- | --- | --- |
| `/health` | `GET` | bridge 状态、当前内核、设置摘要 |
| `/inventory` | `GET` | knowledge、memory、artifacts、sessions、tools、skills 和 capabilities |
| `/ask/stream` | `POST` | 流式 agent turn API |
| `/approvals` | `GET` | 查看 approval 请求 |
| `/approvals/:id/approve` | `POST` | 批准一个待处理动作 |
| `/approvals/:id/reject` | `POST` | 拒绝一个待处理动作 |
| `/memory` | `GET` | 查看或搜索 memory |
| `/artifacts` | `GET` / `POST` | 查看或创建 artifacts |
| `/routines` | `GET` | 查看 routines |
| `/context-records` | `GET` | 最近的 prompt/context 诊断记录 |
| `/rooms/relay-invites` | `POST` | 在 Relay 已配置时创建 Room 员工邀请 |

设置 `OPENGROVE_BRIDGE_TOKEN` 后，除 `/health` 以外的端点都需要 `x-opengrove-token` header。

## 架构

OpenGrove 把责任拆成三层。

```text
UI / Browser Extension
        |
        v
Local Bridge
        |
        v
OpenGrove Host
  - settings
  - knowledge vault
  - memory and artifacts
  - approvals and policy
  - rooms、contacts 和本地 workspace UI state
  - event log and diagnostics
        |
        v
Kernel Adapters
  - Codex
  - Claude Code
  - Hermes
  - OpenAI-compatible HTTP gateways
  - Pi
  - OpenClaw / OpenCode / other CLIs
        |
        v
Native Agent Runtime
```

- **Kernel**：负责原生模型循环、工具、会话行为、上下文压缩和私有提示词规则。
- **Host**：负责 OpenGrove 状态、UI、vault 文件、设置、approval inbox、bridge API 和长期记录。
- **Adapter**：把内核行为翻译成 OpenGrove 的事件、审批、产物、诊断和运行控制。

这样可以继续接入新内核，同时不假装所有 agent 内部都长得一样。

## 仓库结构

```text
src/core/              稳定的 event、policy、registry、store 和共享类型契约
src/app/               OpenGrove 装配入口和应用 wiring
src/kernel/            Kernel 契约、发现逻辑、tool bridge 和 adapters
src/runtime/           Codex、Claude Code、Hermes、Pi、HTTP、generic CLI、proxy、capture、transports 和 projectors
src/server/            本地 bridge、settings、kernel selection、routes、approvals、artifacts
src/relay/             Relay 协议、HTTP/SSE 服务和文件持久化状态
src/knowledge/         Knowledge store views、organizer helpers、feedback 和 vault logic
src/skills/            Skill catalog、runtime 和原生发布辅助逻辑
src/tests/             skills、kernels、runtimes 和 bridge selection 的 harness tests
src/evals/             evaluation runner
web/                   React 本地 UI
web/src/components/rooms/
                       Rooms、contacts、成员路由、mentions 和本地 room storage
extension/             浏览器上下文 adapter
assets/brand/          Wordmark、sapling mark 和视觉系统资产
```

更详细的产品说明：

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- [PROJECT_OVERVIEW.zh-CN.md](PROJECT_OVERVIEW.zh-CN.md)

## 开发

安装依赖：

```bash
npm install
```

运行检查：

```bash
npm run check:secrets
npm run typecheck
npm run build
npm run smoke
npm run test:harness
```

启动 bridge：

```bash
npm run bridge
```

`npm run bridge` 会先构建 server 和 web 产物，然后启动 `dist/server/local-bridge.js`。

npm CLI 提供同样的 bridge 入口：

```bash
opengrove start
opengrove update
opengrove --version
```

当 `opengrove update` 检测到当前是源码 checkout 时，它会提示使用 `git pull`、`npm install` 和 `npm run build`，而不是直接修改源码目录。

## 设计原则

- 内核特有逻辑放在 adapter 层。
- Host 概念保持小、明确、类型化，并且可见。
- 优先使用用户明确加入的上下文，不把大量环境信息硬塞进 prompt。
- 能使用原生工具和原生 skill loader 的地方，就交给内核自己处理。
- Secret 只放在本地环境文件或 provider 原生配置里。
- 高风险动作通过 policy、approval 和 event log 呈现出来。
- UI 保持安静：工具摘要默认折叠、状态行稳定，不展示半成品控件。

## 安全说明

OpenGrove 是本地优先的，但它仍然可能连接到能力很强的原生 agent 和工具。浏览器内容、远程网页和外部输入都应该视为不可信。

- 本地 bridge 默认绑定到 `127.0.0.1`。
- 如果要让非本机客户端访问 bridge，请先设置 `OPENGROVE_BRIDGE_TOKEN`。
- 用 `OPENGROVE_BRIDGE_ALLOWED_ORIGINS` 限制 CORS。
- 不要提交 `.env`、`.env.local`、provider keys、OAuth tokens、原生 auth 文件或 capture logs。
- 提交前运行 `npm run check:secrets`；它会扫描 tracked 和未被 ignore 的 untracked 文件，查找高置信度 secret 和本地绝对路径。
- 除非正在调试，否则保持 provider HTTP capture 关闭。
- 对命令执行、文件修改、桌面/浏览器动作和长期 memory 写入保持 approval 审查。

## 排障

### 没有找到可用内核

安装支持的内核，或显式指定二进制路径：

```bash
OPENGROVE_CODEX_BIN=/absolute/path/to/codex npm run bridge
```

### UI 无法连接 bridge

确认 bridge 正在运行，并且浏览器 origin 被允许：

```bash
curl http://127.0.0.1:37371/health
```

如果设置了 `OPENGROVE_BRIDGE_TOKEN`，确认 UI 或扩展使用的是同一个 token。

### Provider 凭证没有被识别

把 secret 放到 `~/.opengrove/.env.local` 或 `./.env.local`，然后重启 bridge。对于 provider-native 内核，也需要检查内核自己的配置目录。

### 状态看起来过期

停止 bridge，备份 `data/local-state.json` 和 `data/bridge-settings.json`，然后重启。缺失的本地状态文件会由 OpenGrove 自动重新创建。

## License

OpenGrove 使用 [Apache License 2.0](LICENSE) 开源。
