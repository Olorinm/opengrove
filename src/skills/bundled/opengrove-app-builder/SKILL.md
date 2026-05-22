---
name: opengrove-app-builder
description: Use when importing an existing app into OpenGrove or creating an OpenGrove App from a user description. Guides agents to package portable workbench apps, write opengrove.app.json, reuse OpenGrove UI components, define workspace/output boundaries, add skills/CLI/MCP hooks only when useful, and verify the app end to end.
metadata:
  short-description: Import or create OpenGrove workbench apps
---

# OpenGrove App Builder

Use this skill when the user asks to import an existing app, create an app/workbench from a description, package a workflow as an OpenGrove App, or fix an App so it feels native inside OpenGrove.

## Mental Model

An OpenGrove App is a portable workbench package. It may include UI, skills, local commands, MCP config, hooks, assets, docs, and a workspace. The goal is not just to mount files; the goal is that another OpenGrove user can receive the folder, enable it, and understand how to run the workflow.

There are two entry paths:

1. Existing app import: inspect the source first. If it already has a complete UI, preserve and bridge it. If it has no UI or only scripts, design a native OpenGrove workbench around its real workflow.
2. Description-to-app: infer the workflow, create the package structure, choose the smallest useful UI, and document the required runtime/model/API dependencies.

## Required Workflow

1. Inspect the source or request carefully:
   - Identify user inputs, workspace files, commands, outputs, previews, and model/API requirements.
   - Locate any existing frontend. Do not rewrite a complete UI just to make it look native.
   - Locate scripts/CLI entrypoints. Prefer reusing them over inventing a parallel path.
   - For URL sources, run `opengrove app stage <source> --apps-dir <managed-apps-dir> --id <id>` first.
   - For local sources, run `opengrove app inspect <source>`; use `opengrove app stage <source> --target <target> --copy` only when a managed copy is needed.

2. Decide the UI strategy:
   - Existing complete UI: expose it through the App manifest and bridge only what OpenGrove needs.
   - File/workspace app: use `ui.kind: "file-workbench"` and provide clear workspace roots and previewable outputs.
   - Native generated UI: reuse existing OpenGrove components first, especially shared directory trees, Markdown/media preview, settings forms, chat/composer surfaces, status rows, and list panels.
   - Custom components are allowed only when the existing component cannot express the workflow with an adapter.

3. Write or update `opengrove.app.json`:
   - Include stable `id`/`name`, user-facing `title`, concise `description`, `version`, and `ui`.
   - Declare `workspace.path` or `ui.workspace` when the app writes user-visible files.
   - Declare commands only when there is a real CLI/script contract to expose.
   - Mention skills, MCP, or hooks only when those files exist and are part of the workflow.
   - Run `opengrove app validate <app-root>` before reporting the app as mounted-ready.
   - Run `opengrove app report <app-root>` to produce the final readiness summary.

4. Keep boundaries explicit:
   - App file reads/writes stay inside the App root or declared workspace.
   - Generated runs should go to `workspace/runs/<task-or-command>-<timestamp>/` unless the app already has a better established convention.
   - Never copy user secrets, credentials, large caches, or unrelated source folders into the package.
   - Network/API keys and local model paths must be documented as configuration, not hardcoded.

5. Add agent-facing instructions:
   - If the app needs domain behavior, add a focused skill under `skills/<name>/SKILL.md`.
   - State the full workflow in human terms: inputs, processing steps, outputs, failure modes, and verification.
   - If CLI commands are expected, include exact commands and explain where outputs land.

6. Verify end to end:
   - Run typecheck/build/tests for changed OpenGrove code when frontend/server integration changes.
   - Validate the manifest can be discovered by OpenGrove.
   - Register the completed App with `opengrove app mount <app-root>` or the Settings UI after validation.
   - Smoke-test file browsing, preview, create/rename/move/delete when the app uses a workspace.
   - Smoke-test at least one real app command or documented dry run.
   - Report anything that still requires user-provided API keys, models, or external services.

## Source Handling Protocol

- Local folder: inspect in place, but write only inside the App root or a generated staging directory.
- Git/GitHub URL: clone into an OpenGrove-managed App staging directory with `opengrove app stage`.
- Archive URL: download and unpack into staging with `opengrove app stage`; do not edit the user's original archive.
- Ordinary project URL or path: classify it with `opengrove app inspect`; if it is not already an App, either wrap the existing UI or scaffold the missing App contract.

Use `opengrove app scaffold <target> --id <id> --title <title>` when creating from description or when an imported project has useful code but no App package boundary yet. The scaffold is a starting contract, not the final app.

Use `opengrove app mount <app-root> --settings <settings-path>` when the current task explicitly needs to register the App in a known OpenGrove settings file. Otherwise report the mount command instead of silently changing user settings.

## Reuse Rule

When a feature resembles an existing OpenGrove surface, create an adapter over the shared component instead of forking UI logic. The common failure to avoid is copying a directory tree or preview panel and then letting the two versions drift. If a component is too tied to one business domain, split the generic behavior out first, then reconnect the original feature through an adapter.

## Done Criteria

The app is done only when a user can answer these questions without reading source code:

- Where do I open it in OpenGrove?
- What inputs does it expect?
- Where do results appear?
- Which model/API/local dependency do I need to configure?
- Which commands can the agent run, and what do they produce?
- What was actually tested?
