<h1 align="center">
  <img src="assets/brand/opengrove-sapling.png" alt="OpenGrove logo" width="34" align="absmiddle" />
  OpenGrove — Local-first Agent Host
</h1>

<p align="center">
  <strong>A local-first agent host for calm, organized work.</strong>
</p>

<p align="center">
  <a href="#development"><img alt="Build" src="https://img.shields.io/badge/build-local-555555?style=for-the-badge" /></a>
  <img alt="Release" src="https://img.shields.io/badge/release-npm--ready-0b8ec2?style=for-the-badge" />
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-0b8ec2?style=for-the-badge" /></a>
</p>

<p align="center">
  English · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#why-opengrove">Why OpenGrove</a> ·
  <a href="#kernels">Kernels</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Development</a>
</p>

OpenGrove gives AI coding and knowledge agents a stable local workspace: a quiet UI, durable knowledge files, visible tool activity, approvals, artifacts, settings, and a bridge layer that can host multiple native agent kernels without flattening them into one generic chat loop.

It is not trying to replace Codex, Claude Code, Hermes, Pi, OpenClaw, OpenCode, or other CLIs. OpenGrove sits around them as the host: it keeps local state inspectable, maps native events into a shared UI, and lets each kernel keep the model loop, native tools, sessions, and prompting rules it already does well.

## Status

OpenGrove is an early local development project.

- The package has a CLI entrypoint for npm installation; source checkout development is still supported.
- APIs, state files, and adapter contracts may change.
- The bridge is local-first and binds to `127.0.0.1` by default.
- Node.js `>=20` is required.

## Quickstart

Install the CLI and start the local bridge:

```bash
npm install -g opengrove
opengrove start
```

Upgrade a global npm installation:

```bash
opengrove update
```

For source checkout development:

```bash
npm install
npm run typecheck
npm run bridge
```

Open the UI:

```text
http://127.0.0.1:37371/ui/
```

Check the bridge health endpoint:

```bash
curl http://127.0.0.1:37371/health
```

Useful development checks:

```bash
npm run check:secrets
npm run build
npm run smoke
npm run test:harness
npm run eval
```

## Why OpenGrove

Modern agent tools are powerful, but their context, memory, generated files, provider settings, and tool activity often live in separate places. OpenGrove turns those pieces into one local workspace.

- **Local-first knowledge**: memory, artifacts, skills, routines, sessions, run traces, and vault files stay in local JSON/filesystem-backed state.
- **Kernel-native execution**: Codex, Claude Code, Hermes, Pi, OpenClaw, OpenCode, and other CLIs can keep their own loops and tools behind adapter contracts.
- **Visible boundaries**: commands, file changes, browser/desktop actions, durable memory writes, and permission changes are represented as typed events and approvals.
- **First-class artifacts**: files, notes, media, annotations, and generated outputs can be saved, previewed, edited, pinned, and reused.
- **Calm UI**: conversation, vault, settings, diagnostics, and runtime controls are designed as a focused work surface rather than an admin dashboard.

## What You Can Do

- Talk to an agent through the local OpenGrove UI.
- Switch between installed kernels from settings or environment variables.
- Use Rooms for direct or group kernel conversations, including `@` mentions that route one prompt to one or more installed kernels.
- Invite a remote agent employee into a Room through a public Relay, so another OpenGrove node can choose one of its local employees to join and respond.
- Index native knowledge sources such as `AGENTS.md`, `CLAUDE.md`, skills, configs, and local vault files.
- Use a browser extension to send page context and selections into the bridge.
- Track sessions, runs, executions, approvals, memory, artifacts, routines, and provider capture diagnostics.
- Publish OpenGrove skills into kernels that support native skill loading.
- Keep provider credentials out of tracked repository files.

## Remote Agent Employees

OpenGrove can bridge Room messages through an OpenGrove Relay. This is meant for the case where you invite a friend's local agent into one of your Rooms without exposing either local bridge to the public internet.

The Relay is only a routing boundary. Local OpenGrove nodes still choose and run their own employees locally.

Typical flow:

1. The Room owner configures a public Relay in Settings.
2. The owner opens a Room and creates an employee invite link.
3. The friend opens the invite link in their browser.
4. The friend's OpenGrove opens the Rooms view and asks which local employee should join.
5. Room messages and final replies move through the Relay with per-room member tokens.

Friends accepting an invite do not need the Relay admin token. They only receive an invite token and, after accepting, a per-room member token stored in their local OpenGrove state.

Start a Relay server:

```bash
OPENGROVE_RELAY_TOKEN=replace-with-random-admin-token \
OPENGROVE_RELAY_STATE_PATH=/var/lib/opengrove-relay/state.json \
opengrove relay --host 0.0.0.0 --port 37372
```

For production-like use, put the Relay behind HTTPS and configure:

```bash
OPENGROVE_RELAY_ENABLED=1
OPENGROVE_RELAY_URL=https://relay.example.com
OPENGROVE_RELAY_TOKEN=replace-with-random-admin-token
```

Security boundaries:

- The Relay URL can be public.
- The Relay admin token must stay private to the node that creates workspaces, rooms, and invites.
- Invite links should only be sent to the intended person.
- Member tokens are scoped to a room member and are stored locally after invite acceptance.
- Use HTTPS for any Relay used across untrusted networks.

## Kernels

OpenGrove selects kernels through `OPENGROVE_KERNEL`. The default is `auto`, which chooses the first available kernel in this order: Codex, Claude Code, OpenClaw, Hermes, Pi, DeepSeek TUI, then other configured external CLI kernels.

```bash
# Automatic selection
OPENGROVE_KERNEL=auto npm run bridge

# Force a specific kernel
OPENGROVE_KERNEL=codex npm run bridge
OPENGROVE_KERNEL=claude-code npm run bridge
OPENGROVE_KERNEL=hermes npm run bridge
OPENGROVE_KERNEL=openclaw npm run bridge
OPENGROVE_KERNEL=opencode npm run bridge
```

Supported kernel ids:

| Kernel | Current runtime path | Deeper/preferred path tracked by OpenGrove | Overrides |
| --- | --- | --- | --- |
| Codex | `codex app-server --listen stdio://` JSON-RPC bridge | Native app-server events, approvals, dynamic tools, thread reuse | `OPENGROVE_CODEX_BIN` |
| Claude Code | Claude Code SDK / CLI stream bridge | SDK-managed session and native Claude Code tools | `OPENGROVE_CLAUDE_CLI_PATH` |
| Hermes | ACP over stdio JSON-RPC by default; OpenAI-compatible HTTP gateway when configured | ACP session updates, native permission requests, native skill directory | `OPENGROVE_HERMES_BIN`, `OPENGROVE_HERMES_API_URL` |
| Pi | one-shot CLI fallback (`pi -p`) | JSONL RPC | `OPENGROVE_PI_BIN` |
| OpenClaw | OpenAI-compatible HTTP gateway when configured; one-shot CLI fallback | Gateway WebSocket | `OPENGROVE_OPENCLAW_BIN`, `OPENGROVE_OPENCLAW_API_URL` |
| OpenCode | one-shot CLI fallback (`opencode run`) | ACP | `OPENGROVE_OPENCODE_BIN` |
| DeepSeek TUI | one-shot CLI fallback (`deepseek --print`) | stdio JSON-RPC | `OPENGROVE_DEEPSEEK_TUI_BIN` |
| Gemini CLI | one-shot CLI fallback | one-shot CLI | `OPENGROVE_GEMINI_CLI_BIN` |
| Qwen Code | one-shot CLI fallback | one-shot CLI | `OPENGROVE_QWEN_CODE_BIN` |

Codex-specific options:

```bash
OPENGROVE_KERNEL=codex
OPENGROVE_CODEX_MODEL=gpt-5.4
OPENGROVE_CODEX_APPROVAL_POLICY=never
OPENGROVE_CODEX_SANDBOX=danger-full-access
npm run bridge
```

Hermes-specific options:

```bash
OPENGROVE_KERNEL=hermes
OPENGROVE_HERMES_MODEL=your-model
OPENGROVE_HERMES_PROVIDER=your-provider
OPENGROVE_HERMES_TOOLSETS=shell,edit
npm run bridge
```

OpenAI-compatible gateway options for kernels that expose a `/chat/completions` surface:

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

## Kernel Integration Layers

OpenGrove no longer treats every kernel as "prompt in, stdout out." Kernel integrations are split into four small layers:

| Layer | Purpose |
| --- | --- |
| Transport | Owns the wire boundary: `acp`, `stdio-jsonrpc`, `jsonl-rpc`, `http-sse`, `websocket-gateway`, `pty-terminal`, `oneshot-cli`, or `sdk-inprocess`. |
| Event projector | Converts native events into OpenGrove events such as `assistant.delta`, `tool.started`, `tool.finished`, and `approval.requested`. |
| Kernel manifest | Records launch command, session strategy, provider binding, approval policy, event mapping, capabilities, and rollout status. |
| Harness template | Gives each protocol a fake-server test shape so new kernels can be added without guessing at runtime behavior. |

Implemented runtime paths include Codex app-server JSON-RPC, Claude Code SDK/CLI streaming, Hermes ACP, OpenAI-compatible HTTP/SSE with host tool loops, and one-shot CLI fallbacks. Preferred-but-not-yet-wired transports are documented in the kernel manifests so adapter work can move one protocol at a time.

## Providers

Provider setup can be managed in the settings UI or through environment variables. OpenGrove supports native provider profiles and compatible API providers, including OpenAI, Anthropic, Gemini, DeepSeek, Zhipu GLM, Kimi, DashScope, Qianfan, SiliconFlow, ModelScope, MiniMax, Stepfun, OpenRouter, NewAPI, and others defined in `src/server/provider-profiles.ts`.

Environment files are loaded in this order:

1. `OPENGROVE_ENV_FILE`
2. `~/.opengrove/.env.local`
3. `./.env.local`
4. `./.env`

Minimal local config example:

```bash
OPENGROVE_KERNEL=auto
OPENAI_API_KEY=replace-with-your-key

# Optional bridge protection for non-browser clients.
OPENGROVE_BRIDGE_TOKEN=dev-secret
OPENGROVE_BRIDGE_ALLOWED_ORIGINS=http://127.0.0.1:37371
```

The browser extension reads the same bridge token from `chrome.storage.local.opengroveBridgeToken`.

## Local Data

By default, OpenGrove writes runtime state under `data/`:

| Path | Purpose |
| --- | --- |
| `data/local-state.json` | persisted memory, artifacts, sessions, runs, approvals, routines, and events |
| `data/bridge-settings.json` | local bridge settings and kernel/provider bindings |
| `data/opengrove-vault/` | file-first vault mirror for OpenGrove knowledge |
| `data/codex-threads.json` | OpenGrove session to Codex thread bindings |
| `data/provider-http-captures/` | optional provider HTTP capture diagnostics |
| `data/trajectories/` | run trajectory records |

`data/`, `dist/`, `web-dist/`, `.env*`, native agent config folders, caches, and dependency folders are ignored by the repository.

Override the main state file with:

```bash
OPENGROVE_STATE_PATH=/absolute/path/to/local-state.json
```

## Browser Adapter

OpenGrove includes a small browser extension in `extension/` for page context.

1. Open Chrome or Edge extension management.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this repository's `extension/` directory.

The extension sends selected page context to OpenGrove, but it does not call the local bridge directly, does not persist page content, does not read password inputs, and skips browser-internal or sensitive URL surfaces.

See [extension/README.md](extension/README.md).

## Bridge API

The local bridge is the boundary between UI, state, tools, and kernels.

Common endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | bridge status, active kernel, settings summary |
| `/inventory` | `GET` | knowledge, memory, artifacts, sessions, tools, skills, and capabilities |
| `/ask/stream` | `POST` | streaming agent turn API |
| `/approvals` | `GET` | list approval requests |
| `/approvals/:id/approve` | `POST` | approve a pending action |
| `/approvals/:id/reject` | `POST` | reject a pending action |
| `/memory` | `GET` | list or search memory |
| `/artifacts` | `GET` / `POST` | list or create artifacts |
| `/routines` | `GET` | list routines |
| `/context-records` | `GET` | recent prompt/context diagnostics |
| `/rooms/relay-invites` | `POST` | create a Relay-backed Room invite when Relay is configured |

When `OPENGROVE_BRIDGE_TOKEN` is set, non-health endpoints require the `x-opengrove-token` header.

## Architecture

OpenGrove separates responsibility into three layers.

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
  - rooms, contacts, and local workspace UI state
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

- **Kernel**: owns the native model loop, tools, session behavior, compaction, and private prompting rules.
- **Host**: owns OpenGrove state, UI, vault files, settings, approval inbox, bridge APIs, and durable records.
- **Adapter**: translates kernel behavior into OpenGrove events, approvals, artifacts, diagnostics, and runtime controls.

This allows the project to add new kernels without pretending every agent works the same internally.

## Repository Layout

```text
src/core/              Stable event, policy, registry, store, and shared type contracts
src/app/               OpenGrove composition root and app wiring
src/kernel/            Kernel contracts, discovery, tool bridge, and adapters
src/runtime/           Codex, Claude Code, Hermes, Pi, HTTP, generic CLI, proxy, capture, transports, and projectors
src/server/            Local bridge, settings, kernel selection, routes, approvals, artifacts
src/relay/             Relay protocol, HTTP/SSE server, file-backed Relay state
src/knowledge/         Knowledge store views, organizer helpers, feedback, and vault logic
src/skills/            Skill catalog, runtime, and native publication helpers
src/tests/             Harness tests for skills, kernels, runtimes, and bridge selection
src/evals/             Evaluation runner
web/                   React local UI
web/src/components/rooms/
                       Rooms, contacts, member targeting, mentions, and local room storage
extension/             Browser context adapter
assets/brand/          Wordmark, sapling mark, and visual system assets
```

Longer product notes:

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
- [PROJECT_OVERVIEW.zh-CN.md](PROJECT_OVERVIEW.zh-CN.md)

## Development

Install once:

```bash
npm install
```

Run checks:

```bash
npm run check:secrets
npm run typecheck
npm run build
npm run smoke
npm run test:harness
```

Run the bridge:

```bash
npm run bridge
```

The bridge command builds both server and web assets before starting `dist/server/local-bridge.js`.

The npm CLI exposes the same bridge with:

```bash
opengrove start
opengrove update
opengrove --version
```

When `opengrove update` detects a source checkout, it prints the `git pull`, `npm install`, and `npm run build` flow instead of modifying the checkout.

## Design Principles

- Keep kernel-specific behavior in adapters.
- Keep host concepts small, typed, and visible.
- Prefer explicit user context over ambient prompt stuffing.
- Let native kernels use their own tools and skill loaders when possible.
- Store secrets only in local environment files or provider-native config.
- Make risky actions visible through policy, approvals, and event logs.
- Keep the UI quiet: collapsed tool summaries, stable status rows, and no half-wired controls.

## Security Notes

OpenGrove is local-first, but it can still connect to powerful native agents and tools. Treat browser content, remote pages, and inbound instructions as untrusted.

- The local bridge binds to `127.0.0.1` by default.
- Set `OPENGROVE_BRIDGE_TOKEN` before exposing the bridge to any non-local client.
- Restrict CORS with `OPENGROVE_BRIDGE_ALLOWED_ORIGINS`.
- Do not commit `.env`, `.env.local`, provider keys, OAuth tokens, native auth files, or capture logs.
- Run `npm run check:secrets` before committing; it scans tracked and non-ignored untracked files for high-confidence secrets and local absolute paths.
- Keep provider HTTP capture disabled unless you are actively debugging.
- Review approvals for commands, file changes, desktop/browser actions, and durable memory writes.

## Troubleshooting

### No kernel was found

Install a supported kernel or point OpenGrove to its binary:

```bash
OPENGROVE_CODEX_BIN=/absolute/path/to/codex npm run bridge
```

### The UI cannot talk to the bridge

Check that the bridge is running and that the browser origin is allowed:

```bash
curl http://127.0.0.1:37371/health
```

If `OPENGROVE_BRIDGE_TOKEN` is set, make sure the UI or extension is using the same token.

### Provider credentials are not detected

Put secrets in `~/.opengrove/.env.local` or `./.env.local`, then restart the bridge. For provider-native kernels, also check the kernel's own config directory.

### State looks stale

Stop the bridge, back up `data/local-state.json` and `data/bridge-settings.json`, then restart. OpenGrove will recreate missing local state files.

## License

OpenGrove is licensed under the [Apache License 2.0](LICENSE).
