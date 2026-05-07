import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_PROTOCOL_ID, appEnvName } from "../identity.js";
import { createBridgeState } from "../server/bridge-state.js";
import { createBridgeKernel, getBridgeKernelOptions, normalizeBridgeKernelPreference, resolveBridgeKernel } from "../server/kernel-selection.js";
import { filterEnabledKnowledgeDocuments } from "../server/knowledge-files.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-bridge-kernel-"));
  const fakeHermes = join(cwd, "fake-hermes.sh");
  writeFileSync(
    fakeHermes,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"hermes-fake 0.0.0\"",
      "  exit 0",
      "fi",
      "echo \"bridge hermes ok\"",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeHermes, 0o755);

  process.env[appEnvName("HERMES_BIN")] = fakeHermes;
  process.env[appEnvName("BRIDGE_SETTINGS_PATH")] = join(cwd, "bridge-settings.json");

  assert.equal(normalizeBridgeKernelPreference("hermes", "auto"), "hermes");
  assert.equal(resolveBridgeKernel("hermes"), "hermes");

  const state = createBridgeState({ statePath: join(cwd, "state.json") });
  state.settings.kernel = "hermes";
  const options = getBridgeKernelOptions(state);
  const hermesOption = options.find((option) => option.id === "hermes");
  assert.ok(hermesOption, "settings should expose Hermes");
  assert.equal(hermesOption?.available, true);
  assert.ok(Array.isArray(hermesOption?.sources), "settings should expose Hermes knowledge sources");
  assert.ok(
    (hermesOption?.sources as any[]).some((source) => source.id === "hermes.soul"),
    "Hermes sources should include the global SOUL.md file",
  );
  assert.ok(
    !(hermesOption?.sources as any[]).some((source) => source.id === `hermes.${APP_PROTOCOL_ID}-external-skills`),
    "Hermes settings sources should hide OpenGrove external publication internals",
  );
  const codexOption = options.find((option) => option.id === "codex");
  assert.ok(
    Array.isArray(codexOption?.sources) &&
      (codexOption?.sources as any[]).some((source) => source.id === "codex.user-agents-md"),
    "Codex sources should include the global AGENTS.md file",
  );
  assert.ok(
    !(codexOption?.sources as any[]).some((source) => String(source.id).includes("project")),
    "Codex settings sources should not expose project-bound files before OpenGrove has workspace binding",
  );

  state.app.knowledge.upsert({
    id: "test.project-claude-skill",
    type: "skill",
    title: "Project-only Claude skill",
    body: "project skill",
    tags: ["skill"],
    sourceRefs: [{ title: "project", locator: join(cwd, ".claude", "skills", "demo", "SKILL.md") }],
    scope: "project",
    metadata: {
      source: "project",
      skillRoot: join(cwd, ".claude", "skills", "demo"),
      entry: join(cwd, ".claude", "skills", "demo", "SKILL.md"),
    },
  });
  state.app.knowledge.upsert({
    id: "test.global-claude-md",
    type: "project_doc",
    title: "CLAUDE.md",
    body: "global rule",
    tags: ["claude", "instructions"],
    sourceRefs: [],
    scope: "user",
    metadata: {
      nativeGlobalKnowledge: true,
      kernelId: "claude-code",
      sourceId: "claude.user-claude-md",
      vaultPath: "Claude/CLAUDE.md",
    },
  });
  const libraryDocuments = filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 100 }));
  assert.ok(
    libraryDocuments.some((document) => document.id === "test.global-claude-md"),
    "library should show global kernel files",
  );
  assert.ok(
    !libraryDocuments.some((document) => document.id === "test.project-claude-skill"),
    "library should hide project-bound Claude files until OpenGrove has explicit workspace binding",
  );

  const adapter = createBridgeKernel(state);
  assert.equal(adapter.id, "hermes");
  const health = await adapter.healthCheck();
  assert.equal(health.status, "ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
