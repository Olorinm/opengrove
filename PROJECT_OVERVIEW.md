# OpenGrove Project Overview

OpenGrove is a local-first workspace for native coding agents. It gives Codex,
Claude Code, Hermes, OpenCode, Copilot, Pi, and related kernels a shared host
for rooms, contacts, knowledge files, approvals, artifacts, mounted apps,
developer preview sessions, diagnostics, and optional Matrix/Tuwunel remote
collaboration.

OpenGrove does not replace a kernel's model loop. Native kernels keep their own
tools, sessions, auth, compaction, provider behavior, and configuration.
OpenGrove owns the product layer around them.

## Current Product Surface

- **Local UI**: React workspace for chat, rooms, contacts, knowledge, settings,
  apps, visual preview/developer mode, voice input, approvals, and diagnostics.
- **Local bridge**: Node HTTP server on `127.0.0.1:37371` by default. It serves
  the UI, persists host state, and routes turns to the selected kernel.
- **Room ledger**: server-backed local room state for members, messages,
  mentions, run status, and generic remote provenance.
- **Knowledge vault**: file-first local knowledge under `data/opengrove-vault/`
  plus JSON-backed ledgers for feedback, evidence, revisions, and delivery.
- **Kernel adapters**: protocol-native bridges for Codex, Claude Code, Hermes,
  Pi, OpenClaw, OpenCode, Copilot, Kimi, Kiro, DeepSeek, Gemini CLI, Qwen Code,
  Cursor Agent, and compatible external CLIs.
- **OpenGrove Apps**: mounted local app roots that can bundle skills, CLIs,
  workspace files, provider env requirements, previews, and developer sessions.
- **Browser extension**: a small page-context adapter. It does not persist page
  content or call the bridge directly.

## Architecture

OpenGrove has three responsibility layers.

| Layer | Owns |
| --- | --- |
| Kernel | Native reasoning loop, native tools, auth, session semantics, provider config, compaction, and runtime-specific permissions |
| Host | Local state, bridge APIs, rooms, knowledge files, approvals, artifacts, settings, provider bindings, extension inventory, diagnostics, and event history |
| Adapter | Mapping native transport/events/tools into OpenGrove events, runtime controls, knowledge sources, approvals, and session handles |

The rule is simple: preserve native power at the kernel boundary, normalize only
what the host and UI need to understand.

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/core/` | Domain contracts: events, policy, registries, stores, shared runtime and knowledge types |
| `src/app/` | Composition root that wires stores, tools, skills, packs, context, and kernels |
| `src/kernel/` | Adapter contracts, discovery, manifests, tool bridge, and kernel-specific adapters |
| `src/runtime/` | Concrete protocol bridges: Codex RPC, Claude SDK/CLI, ACP, HTTP/SSE, Gateway WebSocket, Pi, generic CLI, captures, projectors |
| `src/server/` | Local bridge, routes, settings, kernel selection, provider binding, approvals, rooms, apps, voice, preview, and knowledge file orchestration |
| `src/server/remote/` | Optional Matrix/Tuwunel runtime, invites, delivery, and ledger projection |
| `src/rooms/` | Server-backed room ledger and event model |
| `src/knowledge/` | Knowledge store views, organizer helpers, feedback, and vault-facing records |
| `src/skills/` | Skill catalog, invocation state, and native skill publication helpers |
| `web/src/` | Local React UI and browser-side bridge client |
| `extension/` | Browser page-context adapter |

## Context And Safety

OpenGrove should not dump the whole workspace into every prompt. Default turn
context is small: user input, explicit attachments, explicit context chips,
runtime controls, and narrow hints. Full files should be read through native
tools when needed.

Secrets belong in ignored local files, environment variables, or native provider
config. They must not be copied into prompts, event logs, workspace files, or
tracked docs.

Risky actions should stay visible through typed approvals, event logs, and UI
feedback. The bridge is local-first and binds to `127.0.0.1` by default; set
`OPENGROVE_BRIDGE_TOKEN` before exposing it to anything non-local.

## Documentation

- `README.md`: install, quickstart, feature summary, and support matrix.
- `docs/TECHNICAL_REFERENCE.md`: kernel/provider setup, Bridge API, data paths,
  repository layout, security notes, and troubleshooting.
- `docs/CORE_DECISIONS.md`: stable product and technical decisions.
- `docs/OPENGROVE_APP_SPEC.md`: mounted app manifest and capability layout.
- `docs/RELEASE_PROCESS.md`: version, release-note, GitHub Release, and npm
  publish checklist.

Long drafts, experiments, and sensitive local notes should live outside tracked
public docs, for example under `docs.local/`.
