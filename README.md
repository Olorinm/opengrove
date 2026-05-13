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
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#features">Features</a> ·
  <a href="#supported-kernels">Kernels</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="docs/TECHNICAL_REFERENCE.md">Full Docs</a>
</p>

---

OpenGrove is the **local-first workspace** that hosts your coding agents — Codex, Claude Code, Hermes, OpenCode, Copilot, and more — under one roof. Each agent keeps its native power; OpenGrove adds shared rooms, persistent memory, approvals, artifacts, and a calm UI on top.

It doesn't replace your agents. It gives them a home.

## Quickstart

```bash
npm install -g opengrove
opengrove start
```

Open **http://127.0.0.1:37371/ui/** and start talking to your agent.

<details>
<summary>From source</summary>

```bash
git clone https://github.com/Olorinm/opengrove.git
cd opengrove
npm install
npm run bridge
```

</details>

## Features

- **Multi-kernel** — switch between Codex, Claude Code, Hermes, Pi, OpenClaw, OpenCode, Copilot, Kimi, Kiro, DeepSeek, Gemini CLI, Qwen Code, and Cursor Agent from one UI
- **Rooms** — direct chats, group conversations, `@` mentions that route to specific agents
- **Remote agents** — invite agents from other machines via Matrix/Tuwunel shared rooms
- **Persistent memory** — knowledge, artifacts, sessions, and run traces stay in local files you own
- **Approvals** — file changes, shell commands, and risky actions require explicit sign-off
- **Browser extension** — send page context and selections straight into a conversation
- **Provider freedom** — OpenAI, Anthropic, Gemini, DeepSeek, and 15+ more providers supported out of the box

## Supported Kernels

| Kernel | Integration |
| --- | --- |
| Codex | JSON-RPC app-server, native events & approvals |
| Claude Code | SDK / CLI streaming |
| Hermes | ACP over stdio, HTTP gateway |
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

Auto-detection picks the first available kernel. Override with:

```bash
OPENGROVE_KERNEL=claude-code opengrove start
```

## Architecture

```text
┌─────────────────────────────┐
│  UI / Browser Extension     │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  Local Bridge (127.0.0.1)   │
│  ─ rooms, memory, artifacts │
│  ─ approvals & policy       │
│  ─ knowledge vault          │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  Kernel Adapters            │
│  ─ Codex, Claude Code, ...  │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  Native Agent Runtime       │
└─────────────────────────────┘
```

Each kernel keeps its own model loop, tools, and prompting rules. OpenGrove only translates native events into shared workspace state.

## Configuration

Create `~/.opengrove/.env.local` or `./.env.local`:

```bash
OPENGROVE_KERNEL=auto
OPENAI_API_KEY=sk-...
```

See the [full technical reference](docs/TECHNICAL_REFERENCE.md) for all environment variables, Bridge API endpoints, data paths, and advanced options.

## Contributing

```bash
npm install
npm run check        # secrets + typecheck
npm run build
npm run test:harness
```

PRs welcome. Please run `npm run check:secrets` before committing.

## Documentation

- [Technical Reference](docs/TECHNICAL_REFERENCE.md) — kernels, providers, Bridge API, rooms & ledger, data paths, troubleshooting
- [Product Overview](PROJECT_OVERVIEW.md) — longer product notes and roadmap context
- [产品概览 (中文)](PROJECT_OVERVIEW.zh-CN.md)

## License

[Apache License 2.0](LICENSE)
