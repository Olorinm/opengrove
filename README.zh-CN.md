<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/opengrove-sapling.svg" />
    <img src="assets/brand/opengrove-sapling.svg" alt="OpenGrove" width="80" />
  </picture>
</p>

<h1 align="center">OpenGrove</h1>

<h3 align="center">One grove, every agent.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/opengrove"><img alt="npm" src="https://img.shields.io/npm/v/opengrove?style=flat-square&color=0b8ec2" /></a>
  <a href="https://github.com/Olorinm/opengrove/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Olorinm/opengrove?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-0b8ec2?style=flat-square" /></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-555?style=flat-square" />
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心特性">特性</a> ·
  <a href="#支持的内核">内核</a> ·
  <a href="#架构">架构</a> ·
  <a href="docs/TECHNICAL_REFERENCE.md">完整文档</a>
</p>

---

OpenGrove 是一个**本地优先的工作空间**，把你的编程 agent —— Codex、Claude Code、Hermes、OpenCode、Copilot 等 —— 统一收纳在一个屋檐下。每个 agent 保留自己的原生能力；OpenGrove 在上层添加共享房间、持久记忆、审批机制、产物管理和一个安静的 UI。

它不替代你的 agent，它给它们一个家。

## 快速开始

```bash
npm install -g opengrove
opengrove start
```

打开 **http://127.0.0.1:37371/ui/**，开始和你的 agent 对话。

<details>
<summary>从源码运行</summary>

```bash
git clone https://github.com/Olorinm/opengrove.git
cd opengrove
npm install
npm run bridge
```

</details>

## 核心特性

- **多内核切换** — 在一个界面中切换 Codex、Claude Code、Hermes、Pi、OpenClaw、OpenCode、Copilot、Kimi、Kiro、DeepSeek、Gemini CLI、Qwen Code、Cursor Agent
- **Rooms** — 私聊、群组对话、用 `@` 将消息路由到指定 agent
- **远程 Agent** — 通过 Matrix/Tuwunel 共享房间邀请其他机器上的 agent 加入协作
- **持久记忆** — 知识、产物、会话、执行轨迹保存在你自己控制的本地文件中
- **审批机制** — 文件修改、Shell 命令、高风险操作需要显式确认
- **浏览器扩展** — 将网页上下文和选区直接发送到对话中
- **Provider 自由** — 开箱支持 OpenAI、Anthropic、Gemini、DeepSeek 等 15+ 个供应商

## 支持的内核

| 内核 | 集成方式 |
| --- | --- |
| Codex | JSON-RPC app-server，原生事件 & 审批 |
| Claude Code | SDK / CLI 流式输出 |
| Hermes | ACP over stdio，HTTP 网关 |
| Pi | SDK in-process |
| OpenClaw | Gateway WebSocket |
| OpenCode | ACP over stdio |
| GitHub Copilot CLI | ACP over stdio |
| Kimi CLI | ACP over stdio |
| Kiro CLI | ACP over stdio |
| DeepSeek TUI | ACP over stdio |
| Gemini CLI | Structured stream JSON CLI |
| Qwen Code | Structured stream JSON CLI |
| Cursor Agent | Structured stream JSON CLI |

自动检测会选择第一个可用内核。手动指定：

```bash
OPENGROVE_KERNEL=claude-code opengrove start
```

## 架构

```text
┌─────────────────────────────┐
│  UI / 浏览器扩展             │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  Local Bridge (127.0.0.1)   │
│  ─ rooms、记忆、产物         │
│  ─ 审批 & 策略              │
│  ─ 知识库                   │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  内核适配器                  │
│  ─ Codex, Claude Code, ...  │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  原生 Agent 运行时           │
└─────────────────────────────┘
```

每个内核保留自己的模型循环、工具和提示词规则。OpenGrove 只负责将原生事件翻译为共享工作空间状态。

## 配置

创建 `~/.opengrove/.env.local` 或 `./.env.local`：

```bash
OPENGROVE_KERNEL=auto
OPENAI_API_KEY=sk-...
```

所有环境变量、Bridge API 端点、数据路径和高级选项请参阅[完整技术参考](docs/TECHNICAL_REFERENCE.md)。

## 参与贡献

```bash
npm install
npm run check        # secrets + typecheck
npm run build
npm run test:harness
```

欢迎提交 PR。提交前请运行 `npm run check:secrets`。

## 文档

- [技术参考](docs/TECHNICAL_REFERENCE.md) — 内核、Provider、Bridge API、Rooms & 账本、数据路径、故障排查
- [产品概览](PROJECT_OVERVIEW.md)
- [产品概览 (中文)](PROJECT_OVERVIEW.zh-CN.md)

## 许可

[Apache License 2.0](LICENSE)
