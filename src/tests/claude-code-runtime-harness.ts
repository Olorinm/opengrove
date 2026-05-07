import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentContext } from "../core.js";
import { ClaudeCodeRuntime } from "../runtime/claude-code-runtime.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-claude-runtime-"));
  const captureDir = join(cwd, "captures");
  const fakeClaude = join(cwd, "fake-claude.mjs");
  const argvPath = join(cwd, "argv.json");
  writeFileSync(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      "import { writeFileSync } from 'node:fs';",
      `writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2), null, 2));`,
      "console.log(JSON.stringify({",
      "  type: 'assistant',",
      "  message: { content: [",
      "    { type: 'text', text: 'hello from fake claude' },",
      "    { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } }",
      "  ] }",
      "}));",
      "console.log(JSON.stringify({",
      "  type: 'user',",
      "  message: { content: [",
      "    { type: 'tool_result', tool_use_id: 'toolu_1', content: 'read ok' }",
      "  ] },",
      "  tool_use_result: { text: 'read ok' }",
      "}));",
      "console.log(JSON.stringify({ type: 'result', result: 'final fake claude result', is_error: false }));",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeClaude, 0o755);

  const runtime = new ClaudeCodeRuntime({
    cliPath: fakeClaude,
    cliKind: "node-script",
    cwd,
    configuredModel: "claude-test-model",
    permissionMode: "bypassPermissions",
    streamCapture: {
      enabled: true,
      dir: captureDir,
      includeRawIO: true,
    },
  });

  const events = [];
  for await (const event of runtime.runTurn({
    input: "hello claude",
    context: { sessionId: "claude-runtime-harness" } as AgentContext,
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
      promptBlock: "Host marker: CLAUDE_CONTEXT_VISIBLE",
    },
  })) {
    events.push(event);
  }

  const argv = JSON.parse(readFileSync(argvPath, "utf8")) as string[];
  assert.ok(argv.includes("--output-format"));
  assert.ok(argv.includes("stream-json"));
  assert.ok(argv.includes("--permission-mode"));
  assert.ok(argv.includes("bypassPermissions"));
  assert.ok(argv.includes("--model"));
  assert.ok(argv.includes("claude-test-model"));
  assert.ok(argv.includes("--append-system-prompt"));
  assert.match(argv.join("\n"), /CLAUDE_CONTEXT_VISIBLE/);

  assert.ok(
    events.some((event) => event.type === "assistant.delta" && event.text.includes("fake claude")),
    "assistant text should stream into OpenGrove events",
  );
  assert.ok(
    events.some((event) => event.type === "tool.started" && event.toolId === "claude.Read"),
    "Claude tool_use should map to tool.started",
  );
  assert.ok(
    events.some((event) => event.type === "tool.finished" && event.toolId === "claude.Read"),
    "Claude tool_result should map to tool.finished",
  );
  const response = events.find((event) => event.type === "model.response");
  assert.ok(response && response.type === "model.response");
  assert.equal(response.response.text, "final fake claude result");
  assert.ok(events.some((event) => event.type === "turn.finished"), "turn should finish");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
