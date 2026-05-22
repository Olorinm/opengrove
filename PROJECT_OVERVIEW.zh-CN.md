# OpenGrove 项目概览

OpenGrove 是一个本地优先的原生编程 agent 工作空间。它为 Codex、Claude
Code、Hermes、OpenCode、Copilot、Pi 等 kernel 提供统一 host：Rooms、员工
联系人、知识文件、审批、产物、挂载 App、开发预览会话、诊断，以及可选的
Matrix/Tuwunel 远程协作。

OpenGrove 不替代 kernel 的模型循环。原生 kernel 继续拥有自己的工具、会话、
认证、压缩、provider 行为和配置；OpenGrove 负责它们外层的产品与协作界面。

## 当前产品面

- **本地 UI**：React 工作空间，覆盖聊天、Rooms、联系人、知识库、设置、Apps、
  visual preview / developer mode、语音输入、审批和诊断。
- **本地 Bridge**：默认运行在 `127.0.0.1:37371` 的 Node HTTP 服务，负责 UI、
  host 状态持久化，以及把 turn 路由到选中的 kernel。
- **Room ledger**：服务端维护的本地房间状态，记录成员、消息、mention、run 状态
  和通用远程 provenance。
- **知识库**：`data/opengrove-vault/` 下的文件优先知识库，加上反馈、证据、修订
  和交付 ledger。
- **Kernel adapters**：面向 Codex、Claude Code、Hermes、Pi、OpenClaw、
  OpenCode、Copilot、Kimi、Kiro、DeepSeek、Gemini CLI、Qwen Code、Cursor
  Agent 和兼容外部 CLI 的协议级桥接。
- **OpenGrove Apps**：可挂载的本地 app 根目录，可组合 skills、CLIs、workspace
  文件、provider env 需求、预览和 developer sessions。
- **浏览器扩展**：轻量网页上下文适配器，不持久化页面内容，也不直接调用 bridge。

## 架构

OpenGrove 分三层职责。

| 层 | 负责 |
| --- | --- |
| Kernel | 原生推理循环、原生工具、认证、会话语义、provider 配置、压缩和 runtime 权限 |
| Host | 本地状态、Bridge API、Rooms、知识文件、审批、产物、设置、provider binding、extension inventory、诊断和事件历史 |
| Adapter | 将原生 transport/events/tools 映射成 OpenGrove events、runtime controls、knowledge sources、approvals 和 session handles |

原则很直接：在 kernel 边界保留原生能力，只规范 host 和 UI 必须理解的部分。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `src/core/` | 事件、policy、registry、store、runtime/knowledge 共享类型 |
| `src/app/` | 组合 root，连接 stores、tools、skills、packs、context 和 kernels |
| `src/kernel/` | adapter contracts、discovery、manifest、tool bridge 和 kernel adapters |
| `src/runtime/` | Codex RPC、Claude SDK/CLI、ACP、HTTP/SSE、Gateway WebSocket、Pi、generic CLI、capture、projector |
| `src/server/` | 本地 bridge、routes、settings、kernel selection、provider binding、approvals、rooms、apps、voice、preview、knowledge files |
| `src/server/remote/` | 可选 Matrix/Tuwunel runtime、invites、delivery 和 ledger projection |
| `src/rooms/` | 服务端 room ledger 与事件模型 |
| `src/knowledge/` | 知识 store 视图、organizer、feedback 和 vault-facing records |
| `src/skills/` | skill catalog、invocation state 和原生 skill 发布 helpers |
| `web/src/` | 本地 React UI 与浏览器侧 bridge client |
| `extension/` | 浏览器页面上下文适配器 |

## 上下文与安全

OpenGrove 不应该把整个工作区塞进每次 prompt。默认 turn context 保持小：用户输入、
显式附件、显式 context chips、runtime controls 和少量相关 hint。完整文件应由原生
工具在需要时读取。

Secrets 应放在被忽略的本地文件、环境变量或原生 provider 配置里，不能写进 prompt、
event logs、workspace 文件或 tracked docs。

高风险动作需要通过 typed approvals、event logs 和 UI feedback 保持可见。Bridge
默认只绑定 `127.0.0.1`；如果暴露给非本地客户端，请先设置
`OPENGROVE_BRIDGE_TOKEN`。

## 文档

- `README.md`：安装、快速开始、功能概览和支持矩阵。
- `docs/TECHNICAL_REFERENCE.md`：kernel/provider 设置、Bridge API、数据路径、仓库结构、安全说明和故障排查。
- `docs/CORE_DECISIONS.md`：稳定的产品与技术决策。
- `docs/OPENGROVE_APP_SPEC.md`：挂载 App manifest 与能力布局。
- `docs/RELEASE_PROCESS.md`：版本、release notes、GitHub Release 和 npm 发布流程。

长草稿、实验记录和敏感本地笔记应放在 public docs 之外，例如 `docs.local/`。
