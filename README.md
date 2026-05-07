# OpenGrove

OpenGrove is an open-source personal knowledge agent for calm, organized work.

It keeps your context local, turns useful work into durable knowledge, and gives agents a small set of well-scoped tools for memory, skills, browser context, artifacts, and approvals.

## Quick Start

```bash
npm install
npm run typecheck
npm run bridge
```

Open the local UI at:

```text
http://127.0.0.1:37371/ui/
```

Useful checks:

```bash
npm run build
npm run test:harness
npm run eval
npm run smoke
```

## What It Does

- Knowledge vault: stores memory, artifacts, skills, routines, sessions, and run traces through one local JSON-backed state layer.
- Agent context: assembles page text, selections, memory, artifacts, computer state, and skill metadata into budgeted turn context.
- Tool boundary: routes host tools through policy, approval, and event logging instead of letting skills mutate state directly.
- Native adapters: bridges to Codex, Claude Code, Hermes, and Pi without duplicating their native tool loops.
- Browser adapter: exposes selected page context through a tiny extension protocol.

## Configure

OpenGrove reads environment variables with the `OPENGROVE_` prefix. You can place private config in `~/.opengrove/.env.local`, a project `.env.local`, or point to another file with `OPENGROVE_ENV_FILE`.

Choose a kernel:

```bash
OPENGROVE_KERNEL=codex
OPENGROVE_CODEX_MODEL=gpt-5.4
npm run bridge
```

Codex options:

```bash
OPENGROVE_CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex
OPENGROVE_CODEX_APPROVAL_POLICY=never
OPENGROVE_CODEX_SANDBOX=danger-full-access
```

OpenAI-compatible model endpoint for Pi/native sessions:

```bash
OPENGROVE_SESSION=native
OPENGROVE_MODEL_API_KEY=...
OPENGROVE_MODEL_BASE_URL=https://your-openai-compatible-endpoint.example
```

Optional bridge token:

```bash
OPENGROVE_BRIDGE_TOKEN=dev-secret
OPENGROVE_BRIDGE_ALLOWED_ORIGINS=https://example.com
```

The browser extension reads the same token from `chrome.storage.local.opengroveBridgeToken`.

## Architecture

- `src/identity.ts` and `web/src/identity.ts`: product name, protocol id, env prefix, storage keys, and local directory names.
- `src/core.ts` and `src/core/`: stable agent contracts, registries, policy, stores, and event log.
- `src/app/create-opengrove.ts`: app composition root.
- `src/kernel/`: kernel contracts and adapters for Codex, Claude Code, Hermes, and Pi.
- `src/runtime/`: runtime bridges and native session handling.
- `src/server/`: local bridge, UI API, settings, approvals, and persistence.
- `src/knowledge/`: knowledge store views for memory, artifacts, skills, feedback, and context planning.
- `web/`: local UI source.
- `extension/`: browser context adapter.

## Rename Surface

Brand and protocol names are intentionally centralized. If OpenGrove changes name again, start with `src/identity.ts`, `web/src/identity.ts`, `package.json`, `README.md`, and `extension/`.
