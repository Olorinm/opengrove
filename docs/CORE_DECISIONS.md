# OpenGrove Core Product and Technical Decisions

This document records the key product and technical judgments that should stay
stable across OpenGrove. It is the place for concise conclusions that affect the
whole system: product boundaries, kernel responsibility, extension concepts,
mounted apps, workspace behavior, and future backend execution.

It is not a backlog or a long design proposal. Longer experiments can live in
`docs.local/`; decisions that become product direction should be distilled here.

## Product Boundary

OpenGrove is a local-first agent workspace and host layer. It should not replace
native agent runtimes such as Codex or Claude Code. Native kernels keep their
own model loop, native tools, sessions, compaction, provider behavior, and
runtime-specific configuration.

OpenGrove owns the product surface around those kernels: rooms, app/workspace
surfaces, settings, approvals, memory, artifacts, preview, extension inventory,
and normalized run history.

## Capability Model

- **Skill**: agent-facing operating instructions. A skill explains when and how
  to perform a workflow, but it is not the stable execution interface.
- **CLI**: business-level executable capability. Codex, Claude Code, and other
  kernels may run CLIs directly through their native command execution tools. A
  CLI does not need to be wrapped as an OpenGrove tool by default.
- **Tool**: a structured callable action with a schema, policy, and result
  boundary. Wrap a CLI as a tool only when a workflow needs stronger control:
  form-like inputs, permissions, auditability, cross-kernel reuse, or managed
  run/artifact handling.
- **MCP**: a tool server. An MCP server exposes one or more structured tools to
  a kernel through the Model Context Protocol.
- **Plugin**: a kernel ecosystem packaging unit. A Codex or Claude plugin can
  package skills, MCP configuration, assets, and interface metadata. It is a
  distribution format, not OpenGrove's primary business boundary.
- **OpenGrove App**: OpenGrove's product/business package. An App may bundle UI,
  workspace files, skills, CLIs, MCP config, hooks, assets, and future
  structured tools under one mounted root.

In short: skills teach the agent, CLIs do business work, tools provide
structured controlled entrypoints, MCP serves sets of tools, plugins package
kernel-native extensions, and an OpenGrove App organizes them into a product
workspace.

## Kernel and Tool Boundaries

OpenGrove should preserve native kernel behavior instead of pretending every
agent runtime works the same way.

- **Kernel native tools** are owned by the kernel. Codex and Claude Code execute
  their own shell, file, edit, web, MCP, and approval flows in their runtime
  environment. OpenGrove maps those events into its timeline.
- **OpenGrove host tools** are owned by OpenGrove. They are exposed to kernels
  through runtime-specific bridges, such as Codex dynamic tools or Claude Code's
  in-process OpenGrove MCP server, and execute through OpenGrove policy and
  stores.
- **CLI usage can live on either side**. An agent may run a CLI directly through
  native command execution, or OpenGrove may wrap a CLI behind a host tool when
  the product needs stronger structure and control.
- **App runtime env is host-managed**. An App may declare which provider keys
  it needs as environment variables. OpenGrove resolves those keys from Provider
  settings and injects them only into that App's runtime process. Secrets must
  not be copied into prompts, event logs, inventory, or workspace files.
- **Native runtime auth is not always a reusable provider**. If OpenGrove can
  detect that a kernel such as Gemini CLI is already authenticated, but cannot
  access a transferable key, that record should be marked as native-only. It can
  prove that the kernel itself is usable; it must not be used for App env
  injection or provider binding outside that kernel.

This keeps the default path simple while leaving room for managed runs,
artifacts, workspace storage, permissions, and backend workers when a workflow
needs them.

## App and Workspace Direction

An OpenGrove App is the business/product package boundary. It may contain UI,
skills, CLIs, MCP config, hooks, assets, and workspace files under one mounted
root.

Creating an App has two product entry points: import an existing App, or create
one from the user's description. Both paths should be delegated to the default
kernel/agent under the `opengrove-app-builder` boundaries. If a complete
frontend already exists, integrate it instead of rebuilding it. If no frontend
exists, design a native workbench from the workflow and reuse OpenGrove shared
components first.

Developer mode is an App or project state, not a separate user-facing task
system. Preview URL, annotations, selected elements, voice notes, run metadata,
and boundary checks may be persisted as developer-session context attached to a
normal conversation thread, but the user should experience one mode: enter
developer mode for an App, annotate the preview, and keep working in that
conversation.

Workspaces should be treated as logical product storage, not merely local
folders. Local development can use filesystem paths, but the API should be able
to evolve toward server-side storage, object storage, run artifacts, and backend
workers without changing the product model.

## Product Experience and Engineering Hygiene

- Native App visual and interaction design should stay consistent by default.
  When the user does not specify a special style, new Apps, pages, settings,
  and workbenches should follow OpenGrove's existing design language. When the
  user explicitly requests a style, the requested style takes precedence.
- Code should stay simple, readable, and maintainable. Do not leave dead code,
  temporary detours, duplicate implementations, or premature abstractions. Use
  existing project patterns when they fit.
- Documentation should be updated promptly. When product decisions, App specs,
  capability models, installation flows, or runtime boundaries change, update
  the corresponding bilingual docs under `docs/`.

## Documentation Rule

- `docs/` contains tracked, current, public-facing project documentation.
- `docs.local/` contains untracked local drafts, sensitive validation notes, and
  long-form planning material.
- When a local draft becomes a stable product or technical decision, summarize
  the conclusion in this document or another focused file under `docs/`.
