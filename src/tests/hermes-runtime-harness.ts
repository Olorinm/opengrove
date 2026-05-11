import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentContext } from "../core.js";
import { APP_CONFIG_DIR, appEnvName } from "../identity.js";
import { HermesRuntime, hermesHealth } from "../runtime/hermes-runtime.js";
import { writeFakeAcpCommand, writeFakeAcpServer } from "./harnesses/fake-acp-server.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-hermes-runtime-"));
  const nativeSkillDir = join(cwd, APP_CONFIG_DIR, "native-skills", "hermes");
  mkdirSync(nativeSkillDir, { recursive: true });
  const fakeHermes = join(cwd, "fake-hermes.sh");
  const fakeAcp = join(cwd, "fake-hermes-acp.mjs");
  writeFakeAcpServer(fakeAcp, {
    sessionId: "fake-hermes-acp-session",
    marker: "FAKE_HERMES_ACP_OK",
    includeConfigEcho: true,
  });
  writeFakeAcpCommand(fakeHermes, fakeAcp, {
    commandName: "hermes-fake",
    version: "hermes-fake 0.0.0",
  });

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
  runtime.close();

  const response = events.find((event) => event.type === "model.response");
  assert.ok(response && response.type === "model.response", "Hermes runtime should emit model.response");
  assert.match(response.response.text, /FAKE_HERMES_ACP_OK/);
  assert.match(response.response.text, /APP_CONTEXT_VISIBLE/);
  assert.match(response.response.text, /provider: "opengrove-test-provider"/);
  assert.match(response.response.text, /base_url: "https:\/\/example\.test\/anthropic"/);
  assert.match(response.response.text, /api_mode: "anthropic_messages"/);
  assert.match(response.response.text, new RegExp(`key_env: "${escapeRegExp(appEnvName("TEST_API_KEY"))}"`));
  assert.match(response.response.text, /providers:/);
  assert.match(response.response.text, /"test-model": \{\}/);
  assert.match(response.response.text, /external_dirs/);
  assert.match(response.response.text, new RegExp(`${escapeRegExp(APP_CONFIG_DIR)}/native-skills/hermes`));
  assert.ok(events.some((event) => event.type === "tool.started" && event.toolId === "hermes.terminal"), "tool start should be mapped from ACP");
  assert.ok(events.some((event) => event.type === "tool.finished" && event.toolId === "hermes.terminal"), "tool finish should be mapped from ACP");
  assert.ok(events.some((event) => event.type === "runtime.diagnostic" && event.name === "hermes.acp.session"), "ACP session diagnostic should be emitted");
  assert.ok(events.some((event) => event.type === "turn.finished"), "turn should finish");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
