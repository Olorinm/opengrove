import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenGrove } from "../app/create-opengrove.js";
import type { AgentEvent } from "../core.js";
import { APP_CONFIG_DIR, APP_ENV_PREFIX } from "../identity.js";
import { createScriptedCompanionSession } from "../runtime/scripted-session.js";
import { createSkillCatalog } from "../skills/catalog.js";
import { createJsonStateStore } from "../storage/json-state-store.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-skill-"));
  const projectSkillDir = join(cwd, APP_CONFIG_DIR, "skills", "demo-inline");
  mkdirSync(projectSkillDir, { recursive: true });
  writeFileSync(
    join(projectSkillDir, "SKILL.md"),
    [
      "---",
      "title: Demo Inline",
      "description: Demo inline skill for harness verification.",
      "when_to_use: When validating the harness.",
      "allowed-tools:",
      "  - browser.readSelection",
      "arguments:",
      "  - topic",
      "user-invocable: true",
      "---",
      "# Demo Inline",
      "",
      "Demo unique marker: KEEP_OUT_OF_SYSTEM_PROMPT",
      "",
      "Topic argument: ${topic}",
      `Session value: \${${APP_ENV_PREFIX}_SESSION_ID}`,
    ].join("\n"),
    "utf8",
  );

  const catalog = createSkillCatalog({ cwd });
  const manifest = catalog.resolve("demo-inline");
  assert.ok(manifest, "project skill should be discovered");
  assert.equal(manifest?.name, "demo-inline");
  assert.deepEqual(manifest?.allowedTools, ["browser.readSelection"]);

  const loaded = catalog.load("demo-inline", "packaging", "session_test");
  assert.ok(loaded.content.includes("Base directory for this skill"));
  assert.ok(loaded.content.includes("KEEP_OUT_OF_SYSTEM_PROMPT"));
  assert.ok(loaded.content.includes("packaging"));
  assert.ok(loaded.content.includes("session_test"));

  const app = createOpenGrove({
    cwd,
    readPage: () => ({
      title: "Harness Page",
      url: "https://example.com/harness",
      selection: "A selected paragraph used for harness validation.",
      locator: "demo-selection",
      visibleText: "A selected paragraph used for harness validation.",
    }),
    createSession: () => createScriptedCompanionSession(),
    sessionId: "skill-harness",
    userId: "local-user",
  });

  const plainSlashEvents: AgentEvent[] = [];
  for await (const event of app.runTurn("/demo-inline explain")) {
    plainSlashEvents.push(event);
  }
  assert.ok(
    !plainSlashEvents.some((event) => event.type === "skill.invoked"),
    "plain slash input should pass through to the kernel instead of implicitly invoking a skill",
  );

  const events: AgentEvent[] = [];
  for await (const event of app.runTurn("explain", {
    requestedSkillName: "demo-inline",
    requestedSkillArgs: "explain",
  })) {
    events.push(event);
  }

  assert.ok(events.some((event) => event.type === "skill.invoked"), "selected skill should emit skill.invoked");
  assert.ok(events.some((event) => event.type === "skill.loaded"), "selected skill should emit skill.loaded");

  const request = events.find((event): event is Extract<AgentEvent, { type: "model.requested" }> => event.type === "model.requested");
  assert.ok(request, "model.requested should be emitted");
  assert.ok(!request.request.systemPrompt.includes("KEEP_OUT_OF_SYSTEM_PROMPT"), "skill body must not be embedded into the system prompt");
  assert.ok(
    !request.request.context?.promptBlock.includes("KEEP_OUT_OF_SYSTEM_PROMPT"),
    "skill body should not be expanded into the assembled context for every turn",
  );
  assert.ok(
    app.knowledge.listDeliveries().some((delivery) =>
      delivery.knowledgeId === `skill.${manifest.id.replace(/^skill\./, "")}` &&
      delivery.mode === "loaded_skill" &&
      !delivery.includeInPrompt
    ),
    "selected skill should be recorded as loaded through the skill channel, not duplicated in prompt context",
  );

  const workingState = app.workingState.get();
  assert.equal(workingState.activeSkillId, undefined);
  assert.ok(workingState.invokedSkills.some((item) => item.skillName === "demo-inline"));

  const statePath = join(cwd, "state.json");
  const store = createJsonStateStore(statePath);
  store.saveFrom(app);

  const restored = createOpenGrove({
    cwd,
    readPage: () => ({
      title: "Harness Page",
      url: "https://example.com/harness",
      selection: "",
      locator: "demo-selection",
    }),
    createSession: () => createScriptedCompanionSession(),
    sessionId: "skill-harness",
    userId: "local-user",
  });
  store.loadInto(restored);
  assert.ok(
    restored.workingState.get().invokedSkills.some((item) => item.skillName === "demo-inline"),
    "invoked skill state should survive persistence and restore",
  );

  console.log(JSON.stringify({ ok: true, eventTypes: events.map((event) => event.type) }, null, 2));
}

await main();
