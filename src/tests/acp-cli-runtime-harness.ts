import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalInbox, type AgentContext, type AgentEvent } from "../core.js";
import { AcpCliRuntime } from "../runtime/acp-cli-runtime.js";
import { writeFakeAcpCommand, writeFakeAcpServer } from "./harnesses/fake-acp-server.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-acp-cli-runtime-"));
  mkdirSync(cwd, { recursive: true });
  const fakeCli = join(cwd, "fake-acp-cli.sh");
  const fakeServer = join(cwd, "fake-acp-server.mjs");
  writeFakeAcpServer(fakeServer, {
    sessionId: "fake-generic-acp-session",
    marker: "FAKE_GENERIC_ACP_OK",
  });
  writeFakeAcpCommand(fakeCli, fakeServer, {
    commandName: "fake-acp-cli",
    acpSubcommand: "acp",
  });

  const runtime = new AcpCliRuntime({
    kernelId: "opencode",
    title: "OpenCode",
    command: fakeCli,
    cwd,
    configuredModel: "test-model",
  });

  const events: AgentEvent[] = [];
  for await (const event of runtime.runTurn({
    runId: "run-acp-cli-harness",
    input: "hello\nfrom acp",
    context: createContext("acp-cli-harness-session"),
    tools: [],
    skills: [],
    packs: [],
    capabilities: [],
    assembledContext: {
      id: "ctx-acp-cli",
      createdAt: new Date().toISOString(),
      summary: "fake ACP context",
      items: [],
      budget: {
        maxItems: 10,
        usedItems: 0,
        maxCharacters: 1000,
        usedCharacters: 0,
        truncated: false,
      },
      promptBlock: "Host marker: ACP_CONTEXT_VISIBLE",
    },
  })) {
    events.push(event);
  }
  runtime.close();

  const response = events.find((event) => event.type === "model.response");
  assert.ok(response && response.type === "model.response", "ACP CLI runtime should emit model.response");
  assert.match(response.response.text, /FAKE_GENERIC_ACP_OK/);
  assert.match(response.response.text, /ACP_CONTEXT_VISIBLE/);
  assert.match(response.response.text, /hello\nfrom acp/);
  assert.ok(events.some((event) => event.type === "tool.started" && event.toolId === "opencode.terminal"));
  assert.ok(events.some((event) => event.type === "tool.finished" && event.toolId === "opencode.terminal"));
  assert.ok(events.some((event) => event.type === "runtime.diagnostic" && event.name === "opencode.acp.session"));
}

function createContext(sessionId: string): AgentContext {
  return {
    sessionId,
    activity: undefined as any,
    sessions: undefined as any,
    memory: undefined as any,
    artifacts: undefined as any,
    skills: undefined as any,
    executions: undefined as any,
    workingState: undefined as any,
    approvals: new ApprovalInbox(),
    packs: undefined as any,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
