import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentContext } from "../core.js";
import { APP_CONFIG_DIR, appEnvName } from "../identity.js";
import { HermesRuntime, hermesHealth } from "../runtime/hermes-runtime.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-hermes-runtime-"));
  const nativeSkillDir = join(cwd, APP_CONFIG_DIR, "native-skills", "hermes");
  mkdirSync(nativeSkillDir, { recursive: true });
  const fakeHermes = join(cwd, "fake-hermes.sh");
  writeFileSync(
    fakeHermes,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"hermes-fake 0.0.0\"",
      "  exit 0",
      "fi",
      "echo \"FAKE_HERMES_OK\"",
      "echo \"ARGS:$*\"",
      "echo \"HERMES_HOME:$HERMES_HOME\"",
      "if [ -n \"$HERMES_HOME\" ] && [ -f \"$HERMES_HOME/config.yaml\" ]; then",
      "  echo \"CONFIG_BEGIN\"",
      "  cat \"$HERMES_HOME/config.yaml\"",
      "  echo \"CONFIG_END\"",
      "fi",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeHermes, 0o755);

  assert.deepEqual(hermesHealth(fakeHermes), {
    ok: true,
    message: "hermes-fake 0.0.0",
  });

  const runtime = new HermesRuntime({
    command: fakeHermes,
    cwd,
    configuredModel: "test-model",
    configuredProvider: "opengrove-test-provider",
    providerConfig: {
      providerKey: "opengrove-test-provider",
      name: "Test Provider",
      baseUrl: "https://example.test/anthropic",
      apiKeyEnv: appEnvName("TEST_API_KEY"),
      apiMode: "anthropic_messages",
      model: "test-model",
      models: ["test-model", "other-model"],
    },
    toolsets: ["skills"],
    nativeSkillDir,
    env: {
      [appEnvName("HERMES_ISOLATED_HOME")]: "1",
      [appEnvName("TEST_API_KEY")]: "test-key",
    },
  });

  const events = [];
  for await (const event of runtime.runTurn({
    input: "hello hermes",
    context: { sessionId: "hermes-runtime-harness" } as AgentContext,
    tools: [],
    skills: [],
    packs: [],
    capabilities: [],
    assembledContext: {
      id: "ctx",
      createdAt: new Date().toISOString(),
      summary: "test context",
      items: [],
      budget: {
        maxItems: 10,
        usedItems: 0,
        maxCharacters: 1000,
        usedCharacters: 0,
        truncated: false,
      },
      promptBlock: "Host marker: APP_CONTEXT_VISIBLE",
    },
  })) {
    events.push(event);
  }

  const response = events.find((event) => event.type === "model.response");
  assert.ok(response && response.type === "model.response", "Hermes runtime should emit model.response");
  assert.match(response.response.text, /FAKE_HERMES_OK/);
  assert.match(response.response.text, /--model test-model/);
  assert.match(response.response.text, /--provider opengrove-test-provider/);
  assert.match(response.response.text, /--toolsets skills/);
  assert.match(response.response.text, /APP_CONTEXT_VISIBLE/);
  assert.match(response.response.text, /provider: "opengrove-test-provider"/);
  assert.match(response.response.text, /base_url: "https:\/\/example\.test\/anthropic"/);
  assert.match(response.response.text, /api_mode: "anthropic_messages"/);
  assert.match(response.response.text, new RegExp(`key_env: "${escapeRegExp(appEnvName("TEST_API_KEY"))}"`));
  assert.match(response.response.text, /providers:/);
  assert.match(response.response.text, /"test-model": \{\}/);
  assert.match(response.response.text, /external_dirs/);
  assert.match(response.response.text, new RegExp(`${escapeRegExp(APP_CONFIG_DIR)}/native-skills/hermes`));
  assert.ok(events.some((event) => event.type === "turn.finished"), "turn should finish");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
