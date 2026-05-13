<h1 align="center">
  <img src="assets/brand/opengrove-sapling.png" alt="OpenGrove logo" width="34" align="absmiddle" />
  OpenGrove — Local-first Agent Workspace
</h1>

<p align="center">
  <strong>A local-first workspace where people and agents talk, remember, and collaborate across local and shared rooms.</strong>
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

OpenGrove gives people and AI coding or knowledge agents a stable local workspace: Rooms, contacts, durable knowledge files, visible tool activity, approvals, artifacts, settings, and a bridge layer that can host multiple native agent kernels and invite remote employees through Matrix/Tuwunel-backed shared rooms without flattening them into one generic chat loop.

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
npm run test:rooms
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
- Use server-backed Rooms for direct or group kernel conversations, including `@` mentions that route one prompt to one or more installed kernels.
- Let room agents read older channel context through the read-only `room.ledger.read` host tool when the visible delivery window is not enough.
- Invite a remote agent employee into a shared Room through Matrix/Tuwunel, so another OpenGrove node can choose one of its local employees to join and respond.
- Index native knowledge sources such as `AGENTS.md`, `CLAUDE.md`, skills, configs, and local vault files.
- Use a browser extension to send page context and selections into the bridge.
- Track sessions, runs, executions, approvals, memory, artifacts, routines, and provider capture diagnostics.
- Publish OpenGrove skills into kernels that support native skill loading.
- Keep provider credentials out of tracked repository files.

## Rooms, Ledger, and Matrix

Rooms are backed by the server-side `RoomChannelStore`, not browser `localStorage`. The UI fetches the current Rooms snapshot from `/rooms`, polls `/rooms/events` for incremental changes, and posts user messages back to the bridge. Room state is persisted under the `rooms` field in `data/local-state.json`.

The room ledger is the local shared source of truth for rooms, members, messages, target ids, statuses, run ids, Matrix ids, and recent room events. When a message targets local members, the bridge schedules one room agent run per runnable target, builds a per-member prompt with the current message and a recent ledger window, then writes final results back to the same ledger. Kernels that support native sessions still keep stable per-room-member native continuity behind that ledger-backed prompt. If an agent needs older channel context, it can call `room.ledger.read` with `roomId`, optional `query`, `limit`, `beforeSeq`, or `afterSeq`.

Matrix/Tuwunel is the remote transport, not a replacement for the local ledger. The bridge joins and syncs Matrix rooms in the background, maps OpenGrove profile/request/final custom events into the local room ledger, and publishes local final replies back to Matrix. Matrix sync is fully bridge-side; the frontend does not own Matrix state or call Matrix directly.

## Remote Agent Employees

OpenGrove uses Matrix-compatible homeservers for remote Room membership and message delivery. The commercial-friendly default target is Tuwunel; Synapse and other Matrix homeservers are useful reference deployments.

The homeserver is the remote routing and remote persistence boundary. Each OpenGrove node still keeps its own local room ledger, chooses and runs its own employees locally, and keeps model/API credentials on the owner machine.

Typical flow:

1. The Room owner configures Matrix/Tuwunel and a public invite landing page in Settings.
2. The owner opens a Room and creates an employee invite link.
3. The friend opens the invite link in their browser.
4. The friend's OpenGrove opens the Rooms view and asks which local employee should join.
5. The selected employee joins the Matrix Room and publishes an OpenGrove agent profile event.
6. The bridge Matrix sync loop maps remote messages into the local room ledger and publishes final local replies back through Matrix custom events.

Friends accepting an invite need their own Matrix user/access token configured locally. The invite landing page only helps the browser find the friend's local OpenGrove port; it does not carry Room messages.

Configure Matrix and the invite landing page:

```bash
OPENGROVE_MATRIX_ENABLED=1
OPENGROVE_MATRIX_HOMESERVER_URL=https://matrix.example.com
OPENGROVE_MATRIX_USER_ID=@alice:matrix.example.com
OPENGROVE_MATRIX_ACCESS_TOKEN=replace-with-local-matrix-token
OPENGROVE_INVITE_BASE_URL=https://invite.example.com
```

Security boundaries:

- The Matrix homeserver URL and invite landing page URL can be public.
- Matrix access tokens must stay local to each OpenGrove node.
- Invite links should only be sent to the intended person.
- The invite landing page does not carry Room messages; it only forwards the opaque invite payload into a local OpenGrove UI.
- The browser UI does not perform Matrix sync; it only reads and writes the local bridge Room API.
- Use HTTPS for Matrix and the invite landing page across untrusted networks.

## Kernels

OpenGrove selects kernels through `OPENGROVE_KERNEL`. The default is `auto`, which chooses Codex first, then Claude Code, Hermes, deep-protocol kernels such as OpenCode/Copilot/Kimi/Kiro/OpenClaw/Pi/DeepSeek TUI, then structured CLI kernels.

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

| Kernel | Runtime path | Provider/config boundary | Overrides |
| --- | --- | --- | --- |
| Codex | `codex app-server --listen stdio://` JSON-RPC bridge | Native app-server events, approvals, dynamic tools, thread reuse | `OPENGROVE_CODEX_BIN` |
| Claude Code | Claude Code SDK / CLI stream bridge | SDK-managed session and native Claude Code tools | `OPENGROVE_CLAUDE_CLI_PATH` |
| Hermes | ACP over stdio JSON-RPC by default; OpenAI-compatible HTTP gateway when configured | ACP session updates, native permission requests, native skill directory | `OPENGROVE_HERMES_BIN`, `OPENGROVE_HERMES_API_URL` |
| Pi | Pi Agent SDK in-process | OpenGrove passes provider env/model into `NativePiSession` | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, optional `PI_MODEL` |
| OpenClaw | Gateway WebSocket (`chat.send` + `agent.wait`) | OpenClaw owns its provider config; OpenGrove only needs Gateway URL/auth | `OPENGROVE_OPENCLAW_GATEWAY_URL`, `OPENGROVE_OPENCLAW_GATEWAY_TOKEN` |
| OpenCode | ACP over stdio (`opencode acp`) | OpenCode owns native config unless provider binding is explicitly selected | `OPENGROVE_OPENCODE_BIN` |
| GitHub Copilot CLI | ACP over stdio (`copilot --acp --stdio`) | Copilot owns native config unless provider binding is explicitly selected | `OPENGROVE_COPILOT_BIN` |
| Kimi CLI | ACP over stdio (`kimi acp`) | Kimi owns native config | `OPENGROVE_KIMI_BIN` |
| Kiro CLI | ACP over stdio (`kiro-cli acp`) | Kiro owns native config | `OPENGROVE_KIRO_CLI_BIN` |
| DeepSeek TUI | ACP over stdio (`deepseek serve --acp`) | DeepSeek owns native config; provider env can be injected when selected | `OPENGROVE_DEEPSEEK_TUI_BIN` |
| Gemini CLI | structured stream JSON CLI | Gemini CLI config/env | `OPENGROVE_GEMINI_CLI_BIN` |
| Qwen Code | structured stream JSON CLI | Qwen Code config/env | `OPENGROVE_QWEN_CODE_BIN` |
| Cursor Agent | structured stream JSON CLI | Cursor Agent config/env | `OPENGROVE_CURSOR_AGENT_BIN` |

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

OpenClaw Gateway options:

```bash
OPENGROVE_KERNEL=openclaw
OPENGROVE_OPENCLAW_GATEWAY_URL=ws://127.0.0.1:PORT
OPENGROVE_OPENCLAW_GATEWAY_TOKEN=replace-with-gateway-token
npm run bridge
```

OpenAI-compatible gateway options for kernels that expose a `/chat/completions` surface:

```bash
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
| Transport | Owns the wire boundary: ACP, stdio JSON-RPC, HTTP/SSE, Gateway WebSocket, PTY terminal, structured stream JSON CLI, or SDK in-process. |
| Event projector | Converts native events into OpenGrove events such as `assistant.delta`, `tool.started`, `tool.finished`, and `approval.requested`. |
| Kernel manifest | Records launch command, session strategy, provider binding, approval policy, event mapping, capabilities, and rollout status. |
| Harness template | Gives each protocol a fake-server test shape so new kernels can be added without guessing at runtime behavior. |

Implemented runtime paths include Codex app-server JSON-RPC, Claude Code SDK/CLI streaming, Hermes ACP, Pi SDK in-process, OpenClaw Gateway WebSocket, OpenCode/Copilot/Kimi/Kiro/DeepSeek ACP, OpenAI-compatible HTTP/SSE for supported HTTP kernels, and structured stream JSON CLI paths for CLIs whose deepest public headless surface is a structured CLI protocol.

## Providers

Provider setup can be managed in the settings UI or through environment variables. OpenGrove supports native provider profiles and compatible API providers, including OpenAI, Anthropic, Gemini, DeepSeek, Zhipu GLM, Kimi, DashScope, Qianfan, SiliconFlow, ModelScope, MiniMax, Stepfun, OpenRouter, NewAPI, and others defined in `src/server/provider-profiles.ts`.

The settings UI writes local bridge preferences to `data/bridge-settings.json`. That file is ignored by git and may contain pasted provider API keys, Matrix access tokens, custom provider definitions, kernel/provider bindings, invite landing settings, and Matrix room sync cursors. Treat it as a local secret file; prefer environment variables for shared or reproducible setups.

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
| `data/local-state.json` | persisted memory, artifacts, sessions, runs, approvals, routines, events, and the server-backed room ledger |
| `data/bridge-settings.json` | ignored local bridge settings, including kernel/provider bindings, custom providers, optional API keys, Matrix settings, and sync cursors |
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
| `/rooms` | `GET` / `POST` | read the room ledger snapshot or create a room |
| `/rooms/events` | `GET` | poll room ledger events after `afterEventSeq` |
| `/rooms/dm` | `POST` | open or create a direct room with one member |
| `/rooms/:roomId` | `PATCH` | update room title, pin/archive state, badge, or Matrix binding |
| `/rooms/members` | `POST` | upsert a global room member |
| `/rooms/:roomId/members` | `POST` | add a member to a room |
| `/rooms/:roomId/members/:memberId` | `DELETE` | remove a member from a room |
| `/rooms/:roomId/messages` | `GET` / `POST` | read room messages or post a user message and schedule room runs |
| `/rooms/:roomId/messages/:messageId` | `PATCH` | update message status, run metadata, Matrix ids, or rendered parts |
| `/rooms/remote-invites` | `POST` | create a Matrix/Tuwunel shared Room invite |
| `/rooms/matrix/join` | `POST` | join a Matrix shared Room and publish the selected employee profile |

Matrix timeline sync is handled by a bridge-side background loop, not a public frontend endpoint.

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
  - server-backed room ledger, contacts, and Matrix sync
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
src/rooms/             Server-backed room ledger, members, messages, Matrix bindings, and room events
src/invite/            Public invite landing page server
src/knowledge/         Knowledge store views, organizer helpers, feedback, and vault logic
src/skills/            Skill catalog, runtime, and native publication helpers
src/tests/             Harness tests for skills, kernels, runtimes, and bridge selection
src/evals/             Evaluation runner
web/                   React local UI
web/src/components/rooms/
                       Rooms, contacts, member targeting, mentions, and room API integration
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
npm run test:rooms
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
- Store secrets only in ignored local files, environment variables, or provider-native config.
- Make risky actions visible through policy, approvals, and event logs.
- Keep the UI quiet: collapsed tool summaries, stable status rows, and no half-wired controls.

## Security Notes

OpenGrove is local-first, but it can still connect to powerful native agents and tools. Treat browser content, remote pages, and inbound instructions as untrusted.

- The local bridge binds to `127.0.0.1` by default.
- Set `OPENGROVE_BRIDGE_TOKEN` before exposing the bridge to any non-local client.
- Restrict CORS with `OPENGROVE_BRIDGE_ALLOWED_ORIGINS`.
- Do not commit `.env`, `.env.local`, `data/bridge-settings.json`, provider keys, Matrix access tokens, OAuth tokens, native auth files, or capture logs.
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
