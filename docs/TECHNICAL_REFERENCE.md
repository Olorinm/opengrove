# OpenGrove Technical Reference

This document covers kernel configuration, provider setup, Bridge API, data paths, repository layout, and troubleshooting. For an introduction, see the [README](../README.md).

## Status

OpenGrove is an early local development project.

- The package has a CLI entrypoint for npm installation; source checkout development is still supported.
- APIs, state files, and adapter contracts may change.
- The bridge is local-first and binds to `127.0.0.1` by default.
- Node.js `>=20` is required.

---

## Kernels

OpenGrove selects kernels through `OPENGROVE_KERNEL`. The default is `auto`, which chooses the first available healthy kernel in this order: Codex, Claude Code, Hermes, then configured external kernels such as OpenCode, Copilot, Kimi, Kiro, Gemini, Qwen, Cursor, OpenClaw, Pi, and DeepSeek TUI.

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

### Kernel Details

| Kernel | Runtime path | Provider/config boundary | Overrides |
| --- | --- | --- | --- |
| Codex | `codex app-server --listen stdio://` JSON-RPC bridge | Native app-server events, approvals, dynamic tools, thread reuse | `OPENGROVE_CODEX_BIN` |
| Claude Code | Claude Code SDK / CLI stream bridge | SDK-managed session and native Claude Code tools | `OPENGROVE_CLAUDE_CLI_PATH` |
| Hermes | ACP over stdio JSON-RPC by default; OpenAI-compatible HTTP gateway when configured | ACP session updates, native permission requests, native skill directory | `OPENGROVE_HERMES_BIN`, `OPENGROVE_HERMES_API_URL` |
| Pi | Pi Agent SDK in-process | OpenGrove passes provider env/model into `NativePiSession` | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`, optional `PI_MODEL` |
| OpenClaw | Gateway WebSocket (`chat.send` + `agent.wait`) | OpenClaw owns provider config; OpenGrove only needs Gateway URL/auth | `OPENGROVE_OPENCLAW_GATEWAY_URL`, `OPENGROVE_OPENCLAW_GATEWAY_TOKEN` |
| OpenCode | ACP over stdio (`opencode acp`) | OpenCode owns native config unless provider binding is explicitly selected | `OPENGROVE_OPENCODE_BIN` |
| GitHub Copilot CLI | ACP over stdio (`copilot --acp --stdio`) | Copilot owns native config unless provider binding is explicitly selected | `OPENGROVE_COPILOT_BIN` |
| Kimi CLI | ACP over stdio (`kimi acp`) | Kimi owns native config | `OPENGROVE_KIMI_BIN` |
| Kiro CLI | ACP over stdio (`kiro-cli acp`) | Kiro owns native config | `OPENGROVE_KIRO_CLI_BIN` |
| DeepSeek TUI | ACP over stdio (`deepseek serve --acp`) | DeepSeek owns native config; provider env can be injected when selected | `OPENGROVE_DEEPSEEK_TUI_BIN` |
| Gemini CLI | structured stream JSON CLI | Gemini CLI config/env | `OPENGROVE_GEMINI_CLI_BIN` |
| Qwen Code | structured stream JSON CLI | Qwen Code config/env | `OPENGROVE_QWEN_CODE_BIN` |
| Cursor Agent | structured stream JSON CLI | Cursor Agent config/env | `OPENGROVE_CURSOR_AGENT_BIN` |

### Codex-specific Options

```bash
OPENGROVE_KERNEL=codex
OPENGROVE_CODEX_MODEL=gpt-5.4
OPENGROVE_CODEX_APPROVAL_POLICY=never
OPENGROVE_CODEX_SANDBOX=danger-full-access
npm run bridge
```

### Hermes-specific Options

```bash
OPENGROVE_KERNEL=hermes
OPENGROVE_HERMES_MODEL=your-model
OPENGROVE_HERMES_PROVIDER=your-provider
OPENGROVE_HERMES_TOOLSETS=shell,edit
npm run bridge
```

### OpenClaw Gateway Options

OpenClaw is treated as a Gateway-backed kernel. OpenGrove does not bind OpenClaw directly to an OpenAI-compatible provider URL.

```bash
OPENGROVE_KERNEL=openclaw
OPENGROVE_OPENCLAW_GATEWAY_URL=ws://127.0.0.1:PORT
OPENGROVE_OPENCLAW_GATEWAY_TOKEN=replace-with-gateway-token
npm run bridge
```

### OpenAI-compatible Gateway Options

Hermes can also be reached through an OpenAI-compatible `/chat/completions` gateway when that gateway is explicitly configured:

```bash
OPENGROVE_KERNEL=hermes
OPENGROVE_HERMES_API_URL=http://127.0.0.1:8000/v1
OPENGROVE_HERMES_API_KEY=replace-with-your-key
OPENGROVE_HERMES_MODEL=your-model
npm run bridge
```

---

## Kernel Integration Layers

Kernel integrations are split into four layers:

| Layer | Purpose |
| --- | --- |
| Transport | Owns the wire boundary: `acp`, `stdio-jsonrpc`, `http-sse`, `websocket-gateway`, `pty-terminal`, structured stream JSON CLI, or `sdk-inprocess`. |
| Event projector | Converts native events into OpenGrove events such as `assistant.delta`, `tool.started`, `tool.finished`, and `approval.requested`. |
| Kernel manifest | Records launch command, session strategy, provider binding, approval policy, event mapping, capabilities, and rollout status. |
| Harness template | Gives each protocol a fake-server test shape so new kernels can be added without guessing at runtime behavior. |

Implemented runtime paths include Codex app-server JSON-RPC, Claude Code SDK/CLI streaming, Hermes ACP, generic ACP CLI sessions, Pi SDK in-process sessions, OpenClaw Gateway WebSocket, OpenAI-compatible HTTP/SSE with host tool loops, and structured stream JSON CLI runtimes for kernels whose deepest stable headless interface is still CLI output.

---

## Providers

Provider setup can be managed in the settings UI or through environment variables. OpenGrove supports native provider profiles and compatible API providers, including OpenAI, Anthropic, Gemini, DeepSeek, Zhipu GLM, Kimi, DashScope, Qianfan, SiliconFlow, ModelScope, MiniMax, Stepfun, OpenRouter, NewAPI, and others defined in `src/server/provider-profiles.ts`.

### Environment File Load Order

1. `OPENGROVE_ENV_FILE`
2. `~/.opengrove/.env.local`
3. `./.env.local`
4. `./.env`

### Minimal Config

```bash
OPENGROVE_KERNEL=auto
OPENAI_API_KEY=replace-with-your-key

# Optional bridge protection for non-browser clients.
OPENGROVE_BRIDGE_TOKEN=dev-secret
OPENGROVE_BRIDGE_ALLOWED_ORIGINS=http://127.0.0.1:37371
```

The browser extension reads the same bridge token from `chrome.storage.local.opengroveBridgeToken`.

---

## Remote Agent Employees

OpenGrove uses Matrix-compatible homeservers for remote Room membership and message delivery. The commercial-friendly default target is Tuwunel; Synapse and other Matrix homeservers are useful reference deployments.

The homeserver is the routing and persistence boundary. Local OpenGrove nodes still choose and run their own employees locally, and model/API credentials stay on each owner machine.

### Typical Flow

1. The Room owner configures Matrix/Tuwunel and a public invite landing page in Settings.
2. The owner opens a Room and creates an employee invite link.
3. The friend opens the invite link in their browser.
4. The friend's OpenGrove opens the Rooms view and asks which local employee should join.
5. The selected employee joins the Matrix Room and publishes an OpenGrove agent profile event.
6. The bridge Matrix sync loop maps remote messages into the local room ledger and publishes final local replies back through Matrix custom events.

### Matrix Configuration

```bash
OPENGROVE_MATRIX_ENABLED=1
OPENGROVE_MATRIX_HOMESERVER_URL=https://matrix.example.com
OPENGROVE_MATRIX_USER_ID=@alice:matrix.example.com
OPENGROVE_MATRIX_ACCESS_TOKEN=replace-with-local-matrix-token
OPENGROVE_INVITE_BASE_URL=https://invite.example.com
```

### Security Boundaries

- The Matrix homeserver URL and invite landing page URL can be public.
- Matrix access tokens must stay local to each OpenGrove node.
- Invite links should only be sent to the intended person.
- The invite landing page does not carry Room messages; it only forwards the opaque invite payload into a local OpenGrove UI.
- The browser UI does not perform Matrix sync; it only reads and writes the local bridge Room API.
- Use HTTPS for Matrix and the invite landing page across untrusted networks.

---

## Bridge API

The local bridge is the boundary between UI, state, tools, and kernels.

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
| `/rooms` | `GET` | current server-backed Room snapshot |
| `/rooms/events` | `GET` | incremental Room ledger events |
| `/rooms/remote-invites` | `POST` | create a Matrix/Tuwunel shared Room invite |
| `/rooms/matrix/join` | `POST` | join a Matrix shared Room and publish the selected employee profile |
| `/rooms/matrix/events` | `POST` | publish OpenGrove Matrix room events |
| `/rooms/matrix/sync` | `GET` | sync Matrix room state and timeline events |

When `OPENGROVE_BRIDGE_TOKEN` is set, non-health endpoints require the `x-opengrove-token` header.

---

## Local Data

By default, OpenGrove writes runtime state under `data/`:

| Path | Purpose |
| --- | --- |
| `data/local-state.json` | persisted memory, artifacts, sessions, runs, approvals, routines, events, and Rooms ledger state |
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

---

## Browser Extension

OpenGrove includes a small browser extension in `extension/` for page context.

1. Open Chrome or Edge extension management.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this repository's `extension/` directory.

The extension sends selected page context to OpenGrove, but it does not call the local bridge directly, does not persist page content, does not read password inputs, and skips browser-internal or sensitive URL surfaces.

---

## Repository Layout

```text
src/core/              Stable event, policy, registry, store, and shared type contracts
src/app/               OpenGrove composition root and app wiring
src/kernel/            Kernel contracts, discovery, tool bridge, and adapters
src/runtime/           Codex, Claude Code, Hermes, Pi, ACP CLI, OpenClaw Gateway, HTTP, structured CLI, proxy, capture, transports, and projectors
src/server/            Local bridge, settings, kernel selection, routes, approvals, artifacts
src/invite/            Public invite landing page server
src/knowledge/         Knowledge store views, organizer helpers, feedback, and vault logic
src/skills/            Skill catalog, runtime, and native publication helpers
src/tests/             Harness tests for skills, kernels, runtimes, and bridge selection
src/evals/             Evaluation runner
web/                   React local UI
web/src/components/rooms/
                       Rooms, contacts, member targeting, mentions, and server-backed Room UI
extension/             Browser context adapter
assets/brand/          Wordmark, sapling mark, and visual system assets
```

---

## Design Principles

- Keep kernel-specific behavior in adapters.
- Keep host concepts small, typed, and visible.
- Prefer explicit user context over ambient prompt stuffing.
- Let native kernels use their own tools and skill loaders when possible.
- Store secrets only in local environment files or provider-native config.
- Make risky actions visible through policy, approvals, and event logs.
- Keep the UI quiet: collapsed tool summaries, stable status rows, and no half-wired controls.

---

## Security Notes

OpenGrove is local-first, but it can still connect to powerful native agents and tools. Treat browser content, remote pages, and inbound instructions as untrusted.

- The local bridge binds to `127.0.0.1` by default.
- Set `OPENGROVE_BRIDGE_TOKEN` before exposing the bridge to any non-local client.
- Restrict CORS with `OPENGROVE_BRIDGE_ALLOWED_ORIGINS`.
- Do not commit `.env`, `.env.local`, provider keys, OAuth tokens, native auth files, or capture logs.
- Run `npm run check:secrets` before committing; it scans tracked and non-ignored untracked files for high-confidence secrets and local absolute paths.
- Keep provider HTTP capture disabled unless you are actively debugging.
- Review approvals for commands, file changes, desktop/browser actions, and durable memory writes.

---

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
