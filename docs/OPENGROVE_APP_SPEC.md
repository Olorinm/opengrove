# OpenGrove App Directory Spec

An OpenGrove App is a local directory mounted from Settings -> Apps. It is the
top-level unit for business or product-specific capabilities: UI, skills,
tools, MCP config, hooks, scripts, and assets can live together under one root.

OpenGrove stores only the app root path, enabled state, and optional display
name in user settings.

For the system-wide meaning of App, skill, CLI, tool, MCP, and plugin, see
[OpenGrove Core Product and Technical Decisions](./CORE_DECISIONS.md).

In this spec, an App is the top-level product/business package that organizes
those capabilities into a mounted workspace.

## App platform entry points

Creating an app in OpenGrove is not just saving a path. It creates or imports a
portable workbench package. Settings -> Apps exposes two entry paths:

- **Import an existing App**: the user provides a local directory or URL.
  OpenGrove sends the source, optional name, and integration boundaries to the
  default kernel/agent. The agent first decides whether the source already has
  a complete UI. If it does, preserve and bridge it. If it does not, design a
  native OpenGrove workbench around the app's capabilities.
- **Create from description**: the user describes the desired workbench in
  natural language. The agent creates the manifest, UI/workspace, required
  skill/CLI docs, and smoke data.

Import and creation tasks should trigger the `opengrove-app-builder` skill. The
skill is the agent guardrail for app integration: app root, workspace
boundaries, UI reuse, command contracts, model/API dependencies, and validation
results must be explicit.

Import sources are classified before editing:

- Local folders can be inspected in place.
- Git/GitHub URLs are cloned into an OpenGrove-managed staging directory.
- Archive URLs are downloaded and unpacked into staging.
- Ordinary project paths or URLs are classified as web projects, CLI toolkits,
  script collections, knowledge directories, or mixed projects before the agent
  chooses whether to wrap, scaffold, or generate UI.

OpenGrove exposes deterministic helper commands for agents:

```bash
opengrove app inspect <source>
opengrove app import <source> --target <app-dir> --id <id>
opengrove app stage <source> --apps-dir <managed-apps-dir> --id <id>
opengrove app scaffold <target> --id <id> --title <title>
opengrove app validate <app-root>
opengrove app report <app-root>
opengrove app mount <app-root> --settings <settings-path>
```

These commands do not replace the agent's judgment. They make the App boundary,
manifest contract, and validation result explicit and repeatable.

`stage` is the deterministic landing step for imports: Git sources are cloned,
archives are downloaded and unpacked, and local directories can either be
referenced in place or copied with `--copy`. `report` combines source
classification, manifest validation, and the recommended mount entry. `mount`
updates a known bridge settings file only after the app is ready to mount.

## UI strategy

Choose the UI in this order:

1. Existing complete frontend: keep it and integrate it through the manifest
   and minimal bridge code.
2. File/artifact workflow: use `ui.kind: "file-workbench"` so OpenGrove's
   native file tree, preview, and App chat panel provide the experience.
3. No UI but clear workflow: design a native workbench from the app's function,
   reusing existing OpenGrove components first.

Generic behavior should be extracted into shared components and reconnected
through business adapters. Directory trees, Markdown/media previews, settings
forms, status lists, and chat panels should not be forked per App. If an
existing component is too bound to one business domain, split out the generic
layer first.

## Workspace write experience

Apps that produce user-visible files should write to:

```text
workspace/runs/<task-or-command>-<timestamp>/
```

File workbenches must provide operations a user can understand: browse,
preview, create file/folder, rename, move, delete, and refresh. Every write must
stay inside the manifest-declared workspace or the App root.

## Required root

Each app should provide a manifest at:

```text
opengrove.app.json
```

Minimal manifest:

```json
{
  "id": "sample-workbench",
  "title": "Sample Workbench",
  "description": "Portable workflow package for OpenGrove.",
  "version": "0.1.0"
}
```

`id` must be stable and URL-safe. `title`, `description`, and `version` are
used for display and inventory only.

## Capability layout

OpenGrove scans these paths relative to the app root:

```text
opengrove.app.json
skills/<skill-name>/SKILL.md
skills/<group>/<skill-name>/SKILL.md
bin/<local-cli>
tools/
mcp.json
hooks.json
ui/
assets/
workspace/
```

Current runtime behavior:

- `skills/` is loaded into the skill catalog when the app is enabled. Apps may
  place skills directly under `skills/<skill-name>/SKILL.md`, let OpenGrove
  discover grouped skill roots recursively, or declare exact roots with
  `skills.roots`.
- CLIs declared in `capabilities.cli` are added to the extension inventory.
  They remain business-level atomic commands that agents can run through Bash;
  OpenGrove does not turn them into tools by default.
- `mcp.json` and `hooks.json` are exposed as external app-owned configuration
  roots for kernels that support those concepts.
- `ui/` and `tools/` are reserved by the spec so a future App can bundle a
  user interface and structured tool definitions under the same root.
- `workspace/` is the default artifact directory for the App. OpenGrove file
  tree, raw file APIs, and previews read it through `WorkspaceStore`.

## CLI declarations

Apps can explicitly declare business CLIs in the manifest:

```json
{
  "capabilities": {
    "cli": [
      {
        "id": "sample-workflow",
        "title": "Sample Workflow",
        "command": "./bin/sample-workflow",
        "doctor": ["doctor"],
        "smoke": ["smoke"],
        "env": ["SAMPLE_WORKFLOW_ROOT"],
        "artifacts": ["workspace/runs/**"],
        "allowNativeBash": true
      }
    ]
  }
}
```

OpenGrove resolves relative paths, checks whether the command is executable,
and shows the result in the CLI area of the extension manager. `doctor`,
`smoke`, `env`, and `artifacts` are currently inventory declarations; the
future Runner will use them for self-checks and managed runs.

## Skill roots

Apps with grouped skill collections can declare collection roots explicitly:

```json
{
  "skills": {
    "roots": [
      "skills/workflow-tools",
      "skills/document-tools"
    ]
  }
}
```

Each listed root should contain one or more `<skill-name>/SKILL.md`
directories.

## Default employees

Apps can declare default room employees in the manifest. OpenGrove reads these
declarations generically; it does not infer employees from app-specific ids or
titles.

```json
{
  "employees": [
    {
      "id": "asset-editor",
      "name": "Asset Editor",
      "kernel": "claude-code",
      "model": "claude-code-default",
      "role": "Prepare workspace assets and previews.",
      "defaultSkillIds": ["asset-query", "project-render"]
    }
  ]
}
```

The same array may also appear at `capabilities.employees`. Employee ids are
scoped to the App id when OpenGrove creates room members.

## Runtime environment injection

Apps can ask OpenGrove to inject provider keys into that App's agent/runtime
environment. This is for private business CLIs that expect conventional env
vars, while the user configures credentials once in OpenGrove Providers.

```json
{
  "runtimeEnv": {
    "providerKeys": [
      {
        "providerId": "aws-bedrock-api-key",
        "env": {
          "apiKey": "AWS_BEARER_TOKEN_BEDROCK"
        },
        "required": false
      },
      {
        "providerId": "gemini",
        "env": {
          "apiKey": ["GOOGLE_API_KEY", "GEMINI_API_KEY"]
        },
        "required": false
      }
    ]
  }
}
```

OpenGrove resolves the provider from settings, reads the stored key or provider
key environment variable, and injects only the requested env names for turns
started from that mounted App. Secret values are not written into prompts,
events, file previews, inventory records, or App settings.

For Codex, OpenGrove starts an app-server process keyed by the injected runtime
environment, so App-specific env does not bleed into normal chat turns or other
Apps.

## Developer mode state

Developer mode is part of an App workspace, not a separate task product. When a
user enters developer mode, OpenGrove may persist a developer-session context so
the preview, annotations, selected elements, voice notes, run metadata, and
boundary checks survive refreshes and can be audited.

That context should attach to a normal conversation thread and a logical
workspace/app id. It should not require users to create or manage a separate
task type. The local adapter stores it through `/developer/sessions`; backend
implementations should model it as session records, annotation records, run
records, and artifact/blob references instead of one large mutable object.

## Skill-local paths

Skills inside an app may use:

```yaml
shell:
  - ${OPENGROVE_SKILL_DIR}/../../bin/example
paths:
  - ${OPENGROVE_SKILL_DIR}/../..
```

OpenGrove resolves these values relative to the mounted skill directory, so a
private app can be cloned anywhere on a user's machine without rewriting the
skill.

## Environment defaults

For headless launches, apps may be mounted with path-delimited environment
variables:

```bash
OPENGROVE_APP_DIRS="/path/to/app-a:/path/to/app-b"
```

`OPENGROVE_MOUNTED_APPS` is accepted as an equivalent name. Settings UI changes
are written to the normal OpenGrove settings file.

## Done and validation criteria

When an App import or creation task is complete, the agent must report:

- Where OpenGrove discovers it and which directory should be enabled in
  Settings.
- Whether the UI uses an existing frontend, `file-workbench`, or a new native
  workbench.
- Required input files, configuration, model/API dependencies, and local
  dependencies.
- Where user-visible outputs are written.
- Which CLI/skill/MCP/hook surfaces are actually exposed, and which are only
  documented.
- Validation performed: manifest discovery, frontend/server typecheck or build,
  file workbench write operations, CLI doctor/smoke, or a real dry run.

If validation cannot run because a key, model, or external service is missing,
the missing configuration and reproducible command must be stated explicitly.
