# OpenGrove 技术参考

本文覆盖 kernel 配置、provider 设置、Bridge API、Rooms 与 ledger、数据路径、仓库结构和故障排查。入门介绍见 [README 中文版](../README.zh-CN.md)。

## 状态

OpenGrove 仍是早期 local development project。

- package 已有 npm 安装用的 CLI entrypoint；源码 checkout 开发仍然支持。
- API、state files 和 adapter contracts 仍可能变化。
- bridge 是 local-first，默认绑定 `127.0.0.1`。
- 需要 Node.js `>=20`。

---

## Kernels

OpenGrove 通过 `OPENGROVE_KERNEL` 选择 kernel。默认值是 `auto`，会优先选择 Codex，然后是 Claude Code、Hermes、OpenCode/Copilot/Kimi/Kiro/OpenClaw/Pi/DeepSeek TUI 等深协议 kernels，最后是 structured CLI kernels。

```bash
# 自动选择
OPENGROVE_KERNEL=auto npm run bridge

# 强制指定 kernel
OPENGROVE_KERNEL=codex npm run bridge
OPENGROVE_KERNEL=claude-code npm run bridge
OPENGROVE_KERNEL=hermes npm run bridge
OPENGROVE_KERNEL=openclaw npm run bridge
OPENGROVE_KERNEL=opencode npm run bridge
```

### Kernel 详情

| Kernel | Runtime path | Provider/config boundary | Overrides |
| --- | --- | --- | --- |
| Codex | `codex app-server --listen stdio://` JSON-RPC bridge | 原生 app-server events、approvals、dynamic tools、thread reuse | `OPENGROVE_CODEX_BIN` |
| Claude Code | Claude Code SDK / CLI stream bridge | SDK-managed session 和 Claude Code 原生工具 | `OPENGROVE_CLAUDE_CLI_PATH` |
| Hermes | 默认 ACP over stdio JSON-RPC；配置后可走 OpenAI-compatible HTTP gateway | ACP session updates、原生 permission requests、原生 skill directory | `OPENGROVE_HERMES_BIN`、`OPENGROVE_HERMES_API_URL` |
| Pi | Pi Agent SDK in-process | OpenGrove 把 provider env/model 传给 `NativePiSession` | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`，可选 `PI_MODEL` |
| OpenClaw | Gateway WebSocket (`chat.send` + `agent.wait`) | OpenClaw 拥有自己的 provider config；OpenGrove 只需要 Gateway URL/auth | `OPENGROVE_OPENCLAW_GATEWAY_URL`、`OPENGROVE_OPENCLAW_GATEWAY_TOKEN` |
| OpenCode | ACP over stdio (`opencode acp`) | 除非显式选择 provider binding，否则 OpenCode 拥有原生 config | `OPENGROVE_OPENCODE_BIN` |
| GitHub Copilot CLI | ACP over stdio (`copilot --acp --stdio`) | 除非显式选择 provider binding，否则 Copilot 拥有原生 config | `OPENGROVE_COPILOT_BIN` |
| Kimi CLI | ACP over stdio (`kimi acp`) | Kimi 拥有原生 config | `OPENGROVE_KIMI_BIN` |
| Kiro CLI | ACP over stdio (`kiro-cli acp`) | Kiro 拥有原生 config | `OPENGROVE_KIRO_CLI_BIN` |
| DeepSeek TUI | ACP over stdio (`deepseek serve --acp`) | DeepSeek 拥有原生 config；选择 provider 时可注入 provider env | `OPENGROVE_DEEPSEEK_TUI_BIN` |
| Gemini CLI | structured stream JSON CLI | Gemini CLI config/env | `OPENGROVE_GEMINI_CLI_BIN` |
| Qwen Code | structured stream JSON CLI | Qwen Code config/env | `OPENGROVE_QWEN_CODE_BIN` |
| Cursor Agent | structured stream JSON CLI | Cursor Agent config/env | `OPENGROVE_CURSOR_AGENT_BIN` |

### Codex 专属选项

```bash
OPENGROVE_KERNEL=codex
OPENGROVE_CODEX_MODEL=gpt-5.4
OPENGROVE_CODEX_APPROVAL_POLICY=never
OPENGROVE_CODEX_SANDBOX=danger-full-access
npm run bridge
```

### Hermes 专属选项

```bash
OPENGROVE_KERNEL=hermes
OPENGROVE_HERMES_MODEL=your-model
OPENGROVE_HERMES_PROVIDER=your-provider
OPENGROVE_HERMES_TOOLSETS=shell,edit
npm run bridge
```

### OpenClaw Gateway 选项

```bash
OPENGROVE_KERNEL=openclaw
OPENGROVE_OPENCLAW_GATEWAY_URL=ws://127.0.0.1:PORT
OPENGROVE_OPENCLAW_GATEWAY_TOKEN=replace-with-gateway-token
npm run bridge
```

### OpenAI-compatible Gateway 选项

对于暴露 `/chat/completions` surface 的 kernels：

```bash
OPENGROVE_KERNEL=hermes
OPENGROVE_HERMES_API_URL=http://127.0.0.1:8000/v1
OPENGROVE_HERMES_API_KEY=replace-with-your-key
OPENGROVE_HERMES_MODEL=your-model
npm run bridge
```

---

## Kernel 集成层

Kernel integrations 分成四层：

关于 kernels、skills、CLIs、tools、MCP servers、plugins 和 OpenGrove Apps 的共享产品与技术判断，见 [核心判断](./CORE_DECISIONS.zh-CN.md)。

| Layer | Purpose |
| --- | --- |
| Transport | 拥有 wire boundary：ACP、stdio JSON-RPC、HTTP/SSE、Gateway WebSocket、PTY terminal、structured stream JSON CLI，或 SDK in-process。 |
| Event projector | 将原生事件转换成 OpenGrove events，例如 `assistant.delta`、`tool.started`、`tool.finished` 和 `approval.requested`。 |
| Kernel manifest | 记录 launch command、session strategy、provider binding、approval policy、event mapping、capabilities 和 rollout status。 |
| Harness template | 给每种协议一个 fake-server test shape，这样新增 kernel 时不用猜 runtime 行为。 |

已实现 runtime paths 包括 Codex app-server JSON-RPC、Claude Code SDK/CLI streaming、Hermes ACP、Pi SDK in-process、OpenClaw Gateway WebSocket、OpenCode/Copilot/Kimi/Kiro/DeepSeek ACP、支持 HTTP kernels 的 OpenAI-compatible HTTP/SSE，以及针对最深 headless surface 是 structured CLI protocol 的 CLI 的 structured stream JSON CLI paths。

---

## Providers

Provider setup 可以在 settings UI 或环境变量中管理。OpenGrove 支持原生 provider profiles 和 compatible API providers，包括 OpenAI、Anthropic、Gemini、DeepSeek、Zhipu GLM、Kimi、DashScope、Qianfan、SiliconFlow、ModelScope、MiniMax、Stepfun、OpenRouter、NewAPI，以及 `src/server/provider-profiles.ts` 中定义的其他 provider。

Settings UI 会把 local bridge preferences 写入 `data/bridge-settings.json`。该文件被 git ignore，可能包含粘贴的 provider API keys、custom provider definitions、kernel/provider bindings、invite landing settings，以及可选的 `remote.matrix` homeserver credentials 和 sync cursors。把它当作本地 secret file；共享或可复现配置优先使用环境变量。

### 环境文件加载顺序

1. `OPENGROVE_ENV_FILE`
2. `~/.opengrove/.env.local`
3. `./.env.local`
4. `./.env`

### 最小配置

```bash
OPENGROVE_KERNEL=auto
OPENAI_API_KEY=replace-with-your-key

# 非浏览器客户端的可选 bridge 保护。
OPENGROVE_BRIDGE_TOKEN=dev-secret
OPENGROVE_BRIDGE_ALLOWED_ORIGINS=http://127.0.0.1:37371
```

浏览器扩展从 `chrome.storage.local.opengroveBridgeToken` 读取同一个 bridge token。

---

## Rooms、Ledger 与 Matrix

Rooms 由 server-side `RoomChannelStore` 支持，而不是浏览器 `localStorage`。UI 从 `/rooms` 获取当前 Rooms snapshot，通过 `/rooms/events` 轮询增量变化，并把用户消息发回 bridge。Room state 持久化在 `data/local-state.json` 的 `rooms` 字段下。

Local room ledger 是 OpenGrove 的 materialized room view。对于纯本地 rooms，它是本地事实来源。对于 Matrix-backed shared rooms，Matrix 是远程 event-history authority，room ledger 是本地 projection/cache，用于 UI 渲染、agent context windows、去重和 run status。Ledger 存储通用 remote provenance，并且只有 bridge-side remote adapters 写入这些字段。

当消息指向本地成员时，bridge 会为每个 runnable target 调度一个 room agent run，用当前消息和近期 ledger window 构造 per-member prompt，然后把最终结果写回同一个 ledger。支持 native sessions 的 kernels 仍在这个 ledger-backed prompt 后面保持 per-room-member 的原生连续性。如果 agent 需要更早的 channel context，可以用 `room.ledger.read`，传入 `roomId`、可选 `query`、`limit`、`beforeSeq` 或 `afterSeq`。

Matrix/Tuwunel 隔离在 remote modules 后面：

- `src/server/remote/runtime-manager.ts` 启动和刷新可选 remote runtimes。
- `src/server/remote/delivery.ts` 分发 remote member delivery，不把 Matrix 暴露给本地 Rooms route。
- `src/remote/matrix/client.ts` 拥有原始 Matrix client-server API 调用。
- `src/server/remote/matrix/invites.ts` 拥有 Matrix room 创建和 invite payload。
- `src/server/remote/matrix/ledger-sync.ts` 拥有 Matrix sync 以及到 `RoomChannelStore` 的 projection。
- `src/server/remote/matrix/delivery.ts` 拥有发往 remote Matrix members 的 outbound requests。

本地 `/rooms` API 不接收 Matrix bindings 或 Matrix event ids。只有 remote endpoints 和 background sync loop 会给 rooms/messages 附加 Matrix metadata。Matrix sync 完全在 bridge-side；frontend 不拥有 Matrix state，也不直接调用 Matrix。只有当 Matrix 已启用且 homeserver URL、user id 和 access token 都已配置时，sync loop 才会启动。

---

## Remote Agent Employees

OpenGrove 使用 Matrix-compatible homeservers 进行远程 Room membership 和 message delivery。OpenGrove 当前不提供托管 Matrix 服务；用户应指向自己部署或信任的 homeserver。商业友好的默认目标是 Tuwunel；Synapse 和其他 Matrix homeservers 可作为参考部署。

Homeserver 是远程路由和远程持久化边界。每个 OpenGrove node 仍然保留自己的本地 room ledger，选择并运行自己的 employees，并把 model/API credentials 留在 owner 机器上。

### 典型流程

1. Room owner 在 Settings 中配置 Matrix/Tuwunel 和公开 invite landing page。
2. Owner 打开一个 Room 并创建 employee invite link。
3. 朋友在浏览器里打开 invite link。
4. 朋友的 OpenGrove 打开 Rooms view，并询问哪个本地 employee 加入。
5. 被选中的 employee 加入 Matrix Room，并发布 OpenGrove agent profile event。
6. Bridge Matrix sync loop 将 remote Matrix events 映射进本地 room ledger projection，并通过 Matrix custom events 发布最终本地回复。

### Matrix 配置

```bash
OPENGROVE_MATRIX_ENABLED=1
OPENGROVE_MATRIX_HOMESERVER_URL=https://matrix.example.com
OPENGROVE_MATRIX_USER_ID=@alice:matrix.example.com
OPENGROVE_MATRIX_ACCESS_TOKEN=replace-with-local-matrix-token
OPENGROVE_INVITE_BASE_URL=https://invite.example.com
```

### 安全边界

- Matrix homeserver URL 和 invite landing page URL 可以公开。
- Matrix access tokens 必须留在每个 OpenGrove node 本地。
- Invite links 只应发给目标人。
- Invite landing page 不携带 Room messages；它只把 opaque invite payload 转发进本地 OpenGrove UI。
- 浏览器 UI 不执行 Matrix sync；它只读写本地 bridge Room API。
- 在不可信网络中使用 Matrix 和 invite landing page 时应使用 HTTPS。

---

## Bridge API

Local bridge 是 UI、state、tools 和 kernels 之间的边界。

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | bridge status、active kernel、settings summary |
| `/inventory` | `GET` | knowledge、memory、artifacts、sessions、tools、skills 和 capabilities |
| `/ask/stream` | `POST` | streaming agent turn API |
| `/approvals` | `GET` | 列出 approval requests |
| `/approvals/:id/approve` | `POST` | approve pending action |
| `/approvals/:id/reject` | `POST` | reject pending action |
| `/memory` | `GET` | 列出或搜索 memory |
| `/artifacts` | `GET` / `POST` | 列出或创建 artifacts |
| `/routines` | `GET` | 列出 routines |
| `/context-records` | `GET` | recent prompt/context diagnostics |
| `/settings` | `GET` / `PATCH` | 读取或更新本地 bridge settings |
| `/extensions` | `GET` | 扫描已挂载 skills、CLIs、MCP config、hooks、plugins 和 tool roots |
| `/extensions/skills/*` | `POST` | 为原生 kernel import、publish、republish 或 unpublish skills |
| `/apps/:appId/files` | `GET` | 列出 mounted App workspace files |
| `/apps/:appId/file` | `GET` / `PATCH` | 读取或更新一个 mounted App workspace file |
| `/apps/:appId/raw/*` | `GET` | 提供 mounted App raw assets/files |
| `/developer/sessions` | `GET` / `POST` | 列出或创建 App developer sessions |
| `/voice/stt/providers` | `GET` | 列出已配置的 speech-to-text providers |
| `/voice/transcriptions` | `POST` | 通过当前 STT provider 转写上传音频 |
| `/rooms` | `GET` / `POST` | 读取 room ledger snapshot 或创建 room |
| `/rooms/events` | `GET` | 按 `afterEventSeq` 轮询 room ledger events |
| `/rooms/dm` | `POST` | 打开或创建和一个 member 的 direct room |
| `/rooms/:roomId` | `PATCH` | 更新本地 room title、pin/archive state 或 badge |
| `/rooms/members` | `POST` | upsert global room member |
| `/rooms/:roomId/members` | `POST` | 给 room 添加 member |
| `/rooms/:roomId/members/:memberId` | `DELETE` | 从 room 移除 member |
| `/rooms/:roomId/messages` | `GET` / `POST` | 读取 room messages，或发送用户消息并调度 room runs |
| `/rooms/:roomId/messages/:messageId` | `PATCH` | 更新本地 message status、run metadata 或 rendered parts |
| `/rooms/remote-invites` | `POST` | 创建 Matrix/Tuwunel shared Room invite |
| `/rooms/matrix/join` | `POST` | 加入 Matrix shared Room，并发布 selected employee profile |

Matrix timeline sync 由 bridge-side background loop 处理，不是公开 frontend endpoint。

当设置 `OPENGROVE_BRIDGE_TOKEN` 时，非 health endpoints 需要 `x-opengrove-token` header。

---

## 本地数据

默认情况下，OpenGrove 把 runtime state 写在 `data/` 下：

| Path | Purpose |
| --- | --- |
| `data/local-state.json` | 持久化 memory、artifacts、sessions、runs、approvals、routines、events 和 server-backed room ledger |
| `data/bridge-settings.json` | 被 ignore 的 local bridge settings，包括 kernel/provider bindings、custom providers、可选 API keys、invite landing settings，以及可选 `remote.matrix` credentials/sync cursors |
| `data/opengrove-vault/` | OpenGrove knowledge 的 file-first vault mirror |
| `data/codex-threads.json` | OpenGrove session 到 Codex thread 的 bindings |
| `data/provider-http-captures/` | 可选 provider HTTP capture diagnostics |
| `data/trajectories/` | run trajectory records |

`data/`、`dist/`、`web-dist/`、`.env*`、原生 agent config folders、caches 和 dependency folders 都被仓库 ignore。

用以下变量覆盖主 state file：

```bash
OPENGROVE_STATE_PATH=/absolute/path/to/local-state.json
```

---

## 浏览器扩展

OpenGrove 在 `extension/` 里包含一个用于 page context 的轻量浏览器扩展。

1. 打开 Chrome 或 Edge extension management。
2. 启用 developer mode。
3. 选择 "Load unpacked"。
4. 选择本仓库的 `extension/` 目录。

该扩展会把选中的 page context 发送给 OpenGrove，但它不会直接调用 local bridge，不会持久化 page content，不会读取 password inputs，并且会跳过浏览器内部或敏感 URL surfaces。

---

## 仓库结构

```text
src/core/              稳定 event、policy、registry、store 和共享 type contracts
src/app/               OpenGrove composition root 和 app wiring
src/kernel/            Kernel contracts、discovery、tool bridge 和 adapters
src/runtime/           Codex、Claude Code、Hermes、Pi、HTTP、generic CLI、proxy、capture、transports 和 projectors
src/server/            Local bridge、settings、kernel selection、routes、approvals、artifacts
src/server/remote/     Bridge-side remote services 和 Matrix ledger projection
src/remote/            Transport clients，例如 raw Matrix client-server API wrapper
src/rooms/             Server-backed local room ledger、members、messages、remote provenance 和 room events
src/invite/            Public invite landing page server
src/knowledge/         Knowledge store views、organizer helpers、feedback 和 vault logic
src/skills/            Skill catalog、runtime 和 native publication helpers
src/tests/             Skills、kernels、runtimes 和 bridge selection 的 harness tests
src/evals/             Evaluation runner
web/                   React local UI
web/src/components/rooms/
                       Rooms、contacts、member targeting、mentions 和 room API integration
extension/             Browser context adapter
assets/brand/          Wordmark、sapling mark 和 visual system assets
```

---

## 开发

安装一次：

```bash
npm install
```

运行检查：

```bash
npm run check:secrets
npm run typecheck
npm run build
npm run smoke
npm run test:rooms
npm run test:harness
```

运行 bridge：

```bash
npm run bridge
```

`bridge` 命令会在启动 `dist/server/local-bridge.js` 前同时构建 server 和 web assets。

npm CLI 暴露同样的 bridge：

```bash
opengrove start
opengrove update
opengrove --version
```

当 `opengrove update` 检测到 source checkout 时，它会打印 `git pull`、`npm install` 和 `npm run build` 流程，而不是直接修改 checkout。

---

## 设计原则

- 把 kernel-specific behavior 留在 adapters。
- 保持 host concepts 小、typed、可见。
- 优先使用显式用户上下文，而不是 ambient prompt stuffing。
- 尽量让原生 kernels 使用自己的 tools 和 skill loaders。
- Secrets 只存放在 ignored local files、environment variables 或 provider-native config。
- 高风险动作通过 policy、approvals 和 event logs 保持可见。
- UI 保持安静：collapsed tool summaries、stable status rows，不放半接线 controls。
- 交互色保持语义化：blue 表示 active/focus/action states，green 表示 OpenGrove identity 和真正成功。

---

## 安全说明

OpenGrove 是 local-first，但它仍可能连接强大的原生 agents 和 tools。应把 browser content、remote pages 和 inbound instructions 都视为不可信输入。

- Local bridge 默认绑定 `127.0.0.1`。
- 在把 bridge 暴露给任何非本地 client 前，设置 `OPENGROVE_BRIDGE_TOKEN`。
- 用 `OPENGROVE_BRIDGE_ALLOWED_ORIGINS` 限制 CORS。
- 不要提交 `.env`、`.env.local`、`data/bridge-settings.json`、provider keys、Matrix access tokens、OAuth tokens、native auth files 或 capture logs。
- 提交前运行 `npm run check:secrets`；它会扫描 tracked 和未被 ignore 的 untracked files，查找高置信 secrets 和本地绝对路径。
- 除非正在主动调试，否则保持 provider HTTP capture 关闭。
- 对 commands、file changes、desktop/browser actions 和 durable memory writes 认真检查 approvals。

---

## 故障排查

### 没找到 kernel

安装一个受支持的 kernel，或指定其 binary：

```bash
OPENGROVE_CODEX_BIN=/absolute/path/to/codex npm run bridge
```

### UI 无法连接 bridge

检查 bridge 是否运行，以及浏览器 origin 是否被允许：

```bash
curl http://127.0.0.1:37371/health
```

如果设置了 `OPENGROVE_BRIDGE_TOKEN`，确保 UI 或 extension 使用同一个 token。

### Provider credentials 没被识别

把 secrets 放到 `~/.opengrove/.env.local` 或 `./.env.local`，然后重启 bridge。对于 provider-native kernels，也检查 kernel 自己的 config directory。

### State 看起来过期

停止 bridge，备份 `data/local-state.json` 和 `data/bridge-settings.json`，然后重启。OpenGrove 会重新创建缺失的 local state files。
