# Changelog

Notable user-facing changes are collected here before release. During development,
add concise entries under `Unreleased`; when cutting a release, use this section
to draft `docs/releases/vX.Y.Z.md`.

## Unreleased

No unreleased changes yet.

## v0.3.1 - 2026-05-22

- Remove private App example identifiers from the published package, tests, docs, and UI placeholders.
- Replace hard-coded mounted-App employee detection with generic manifest-declared employees under `employees`, `rooms.employees`, or `capabilities.employees`.
- Republish the v0.3 line as a sanitized patch after unpublishing the original v0.3.0 package artifact.

## v0.3.0 - 2026-05-22

- Add the workspace/app shell: mounted Apps, App workspace files, visual preview workbench, developer sessions, preview annotations, and voice input.
- Expand settings for kernels, providers, mounted Apps, voice, remote Matrix/Tuwunel messaging, proxy, appearance, and diagnostics.
- Add extension inventory and native skill publishing flows for mounted skills, CLIs, MCP config, hooks, plugins, and tool roots.
- Split local Rooms/Ledger state from optional Matrix/Tuwunel projection; remote metadata is now generic `remote` provenance on bridge-owned room records.
- Make room employees explicit contact entities instead of auto-creating employees from newly detected kernels.
- Add GitHub Copilot CLI terminal login and improve OpenCode provider binding through generated inline provider config.
- Refresh the app shell visual system, sidebar overflow behavior, settings surfaces, contacts UI, and room/member management states.
- Smooth mounted App chat composer chrome and remove the unused visual-developer voice tool from the floating annotation toolbar.
- Add release-note preflight checks and document the current release process.
- Audit and trim code: stricter server unused-code checks, dead shared UI removal, extracted contacts model helpers, and extracted reusable settings inline select.
- Refresh public docs to keep product boundaries, repository layout, App spec, technical reference, design guide, and release notes concise and current.
