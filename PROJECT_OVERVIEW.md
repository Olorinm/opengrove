# OpenGrove Project Overview

OpenGrove is a local-first agent workspace where people and agents talk, remember, and collaborate. It provides a stable workspace around Rooms, contacts, native agent kernels, local knowledge files, tool boundaries, artifacts, settings, approvals, Matrix/Tuwunel-backed remote employees, and diagnostics.

OpenGrove is not a replacement model loop or a generic chat wrapper. The current design keeps native kernels in charge of their own reasoning, tools, session semantics, compaction, and provider behavior where possible. OpenGrove owns the host layer around them.

## Current Product Shape

OpenGrove currently has five visible surfaces:

- **Local UI**: a React workspace for conversation, runtime controls, settings, knowledge files, activity summaries, approvals, and diagnostics.
- **Local bridge**: a Node HTTP bridge on `127.0.0.1:37371` by default, serving the UI and routing requests to the selected kernel.
- **Knowledge vault**: local JSON state plus a file-first vault under `data/opengrove-vault/`.
- **Kernel adapters**: Codex, Claude Code, Hermes, Pi, OpenClaw, OpenCode, DeepSeek TUI, Gemini CLI, Qwen Code, and generic external CLI support.
- **Browser adapter**: a thin extension that exposes selected page context without becoming a second agent runtime.

The project is still early and source-checkout based. The package is private, APIs may change, and local data formats are not yet stable release contracts.

## Core Idea

OpenGrove separates responsibilities into three layers.

1. **Kernel**
   The native runtime owns its model loop, native tools, auth, compaction, prompting rules, and provider-specific behavior.

2. **Host**
   OpenGrove owns local state, vault files, settings, approval UI, bridge APIs, event normalization, artifacts, memory, routines, and durable records.

3. **Adapter**
   Each adapter maps native behavior into OpenGrove concepts: start turn, stream events, approvals, user elicitation, artifacts, compaction, runtime controls, knowledge sources, provider config, diagnostics, and session bindings.

This keeps the product extensible without pretending every agent works the same internally.

## Architecture By Area

### Core

`src/core/` defines the stable domain contracts:

- event types
- policy and approval concepts
- registries
- memory, artifact, execution, routine, session, approval, and working-state stores
- shared agent, tool, knowledge, and runtime types

`src/core.ts` remains a thin re-export layer.

### App Composition

`src/app/create-opengrove.ts` wires the runnable host:

- registers host tools and capabilities
- loads skills and packs
- prepares context
- connects stores
- observes compaction and working-state changes
- publishes kernel-compatible skills when supported
- builds the `OpenGroveApp` used by the bridge

`src/app/skill-tree.ts` supports skill organization and discovery.

### Kernel Layer

`src/kernel/` defines the adapter boundary:

- `types.ts`: adapter capabilities, session handles, runtime controls, discovery snapshots, and knowledge source types
- `adapter.ts`: the generic runtime adapter and OpenGrove vault knowledge sources
- `discovery.ts`: local binary/config/source discovery helpers
- `tool-bridge.ts`: mapping host tools into kernel-facing behavior
- `adapters/`: concrete adapters for Codex, Claude Code, Hermes, Pi, and external CLIs

Current kernel ids are:

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

`src/runtime/` contains concrete execution bridges:

- Codex app-server / RPC bridge, approval bridge, dynamic tool bridge, auth refresh, event projection, and thread binding
- Claude Code CLI bridge
- Claude Agent SDK runtime with OpenGrove MCP tools and approval/user-input handling
- Hermes CLI bridge with provider config generation
- Pi native/runtime bridge
- generic external CLI runtime
- kernel proxy environment injection
- provider HTTP capture utilities
- Codex RPC capture utilities
- session history helpers
- scripted session test runtime

The runtime layer should normalize events without hiding the native kernel's real behavior.

### Server Layer

`src/server/` runs the local bridge and owns most host orchestration:

- static UI serving
- `/health`, `/inventory`, `/ask/stream`, `/approvals`, `/memory`, `/artifacts`, `/routines`, `/events`, `/context-records`, and settings routes
- bridge security, CORS, token checks, and local env loading
- bridge state and persisted settings
- kernel selection and runtime control generation
- kernel registry, path overrides, config-home overrides, and kernel model routing
- provider profiles, provider bindings, native provider discovery, and provider env construction
- Codex responses/chat proxy for compatible providers that need wire-format adaptation
- per-turn context via async local storage
- knowledge file sync, vault file serving, artifact/media extraction, approval actions, working-state sync, and trajectory records

The bridge is local-first. It should not store private provider keys in tracked files.

### Knowledge Layer

`src/knowledge/` turns local records and files into useful views:

- memory view
- artifact view
- skill view
- feedback scoring
- organizer helpers
- JSON-backed knowledge store and ledgers

The product direction is file-first. The vault should behave like an inspectable local workspace first, while higher-level wiki, graph, and reference views can be built on top later.

### Skills, Packs, And Capabilities

`src/skills/` owns skill catalog loading, runtime behavior, and native publishing helpers. Skills are knowledge objects, not permission bypasses.

`src/packs/` and `src/capabilities/` contain bundled capability surfaces such as:

- browser action support
- computer use support
- Weread companion support

When a kernel has native skill loading, OpenGrove should publish or reference skills in that kernel's expected location instead of dumping full skill bodies into prompts.

### Tools

`src/tools/` defines host tools:

- browser context
- browser actions
- computer state
- memory
- skills
- host UI actions

Risky actions should remain visible through policy, approvals, event logs, and UI feedback.

### Web UI

`web/src/` is the local UI:

- conversation thread runtime
- chat composer and skill command menu
- message activity summaries
- conversation sidebar
- settings dialog for kernels, providers, paths, proxy, and knowledge sources
- knowledge file/editor views
- runtime UI model and bridge queries
- localized UI strings

The UI should only expose controls with a complete interaction path. Hidden or half-wired features should not be visible.

### Browser Extension

`extension/` is a small browser context adapter:

- selection snapshots
- page snapshot messages
- sidebar toggle event
- host-requested snapshots

It does not call the local bridge directly, does not persist page content, does not read password inputs, and skips sensitive browser surfaces.

## Context Strategy

OpenGrove should not dump everything into every prompt.

Default conversation context is intentionally small:

- user input
- explicit attachments
- explicit context chips
- current runtime controls
- narrow browser/computer/vault hints when relevant

Vault AI context is narrower:

- current file path
- current file type
- selected text or a small preview when useful
- instructions that the model may use native read/search tools for full content

The rule is simple: explicit user context can be included; ambient context should be lightweight; full files should be read by tools when needed.

## Provider Strategy

Provider configuration is kernel-neutral at the host level but kernel-specific at the adapter boundary.

The current bridge supports:

- provider profiles
- OpenAI-compatible, Anthropic-compatible, Gemini-compatible, native OAuth, and custom gateway protocols
- provider-to-kernel bindings
- per-kernel env/config-file/native-api binding modes
- model aliasing and kernel model routing
- native provider discovery for kernels such as Codex and Claude Code
- optional proxy injection for kernel subprocesses
- optional provider HTTP capture for diagnostics

Secrets should live in local environment files or native provider config, never in tracked repository files.

## Approval And Safety

OpenGrove treats risky actions as host-visible events:

- command execution
- file changes
- permission scope changes
- browser actions
- desktop actions
- durable memory writes
- provider/capture settings changes

The approval layer should be typed, visible, and kernel-aware. The UI should render different approval kinds clearly instead of treating every request as generic text.

## Local Data And Sensitive Content

Default local runtime paths:

- `data/local-state.json`
- `data/bridge-settings.json`
- `data/opengrove-vault/`
- `data/codex-threads.json`
- `data/provider-http-captures/`
- `data/trajectories/`

The repository ignores `data/`, `dist/`, `web-dist/`, `.env*`, native agent config folders, caches, and dependency folders.

Environment files are loaded from:

1. `OPENGROVE_ENV_FILE`
2. `~/.opengrove/.env.local`
3. `./.env.local`
4. `./.env`

Before committing, run:

```bash
npm run check:secrets
```

The current checker scans tracked and untracked non-ignored files for high-confidence secrets and local absolute paths.

## Development Rules

- Read the real code before claiming how a kernel works.
- Put kernel-specific behavior in adapters or runtimes.
- Keep host concepts small, explicit, and typed.
- Keep provider credentials out of tracked files.
- Do not expose settings UI controls without a complete interaction path.
- Test UI changes in the browser, not only with typecheck.
- Run at least `npm run check:secrets` and `npm run typecheck` before meaningful commits.
- For runtime or adapter changes, also run `npm run build`, `npm run smoke`, and `npm run test:harness` when feasible.

## Current Technical Stack

- TypeScript
- Node local bridge server
- React 19
- Vite / custom web build script
- CodeMirror for Markdown editing
- Zustand and React Query on the frontend
- JSON-backed local state stores
- Codex, Claude Code, Hermes, Pi, and generic CLI runtime adapters
- Claude Agent SDK
- OpenGrove browser extension

## Useful Commands

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

The local UI runs at:

```text
http://127.0.0.1:37371/ui/
```

## One-Sentence Summary

OpenGrove is a local-first agent workspace: it lets people, local agents, and invited remote employees work inside one calm workspace with explicit context, visible tools, durable knowledge, first-class artifacts, provider-aware routing, and inspectable local state.
