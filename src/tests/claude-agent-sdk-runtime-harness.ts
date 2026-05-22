import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenGrove } from "../app/create-opengrove.js";
import type { AgentContext, AgentEvent } from "../core.js";
import {
  ClaudeAgentSdkRuntime,
  type ClaudeAgentSdkQueryFunction,
} from "../runtime/claude-agent-sdk-runtime.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-claude-sdk-"));
  const app = createOpenGrove({
    cwd,
    runtime: {
      async *runTurn() {
        yield* [];
      },
    },
    readPage: () => ({
      title: "Harness Page",
      url: "https://example.com",
      selection: "selected text",
      locator: "harness-selection",
    }),
    sessionId: "claude-sdk-harness",
  });

  let capturedPrompt = "";
  let capturedModel = "";
  let capturedEnvModel = "";
  let capturedEnvOpusModel = "";
  let sawMcpServer = false;
  let sawAskUserQuestion = false;
  const fakeQuery: ClaudeAgentSdkQueryFunction = ((params) => {
    capturedPrompt = params.prompt;
    capturedModel = params.options?.model ?? "";
    capturedEnvModel = params.options?.env?.ANTHROPIC_MODEL ?? "";
    capturedEnvOpusModel = params.options?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "";
    sawMcpServer = Boolean(params.options?.mcpServers?.opengrove);
    async function* messages() {
      yield {
        type: "system",
        subtype: "init",
        apiKeySource: "user",
        claude_code_version: "2.1.fake",
        cwd,
        tools: ["Read", "Bash"],
        mcp_servers: [{ name: "opengrove", status: "connected" }],
        model: "claude-test",
        permissionMode: "default",
        slash_commands: ["/compact", "/model", "/status"],
        output_style: "default",
        skills: ["demo-skill"],
        plugins: [],
        uuid: "00000000-0000-5000-8000-000000000001",
        session_id: "00000000-0000-5000-8000-000000000002",
      };
      const permission = await params.options?.canUseTool?.(
        "AskUserQuestion",
        {
          questions: [{
            question: "Pick one?",
            header: "Choice",
            options: [
              { label: "A", description: "Use A." },
              { label: "B", description: "Use B." },
            ],
            multiSelect: false,
          }],
        },
        {
          signal: params.options?.abortController?.signal ?? new AbortController().signal,
          title: "Claude needs input",
          displayName: "Ask",
          description: "Pick a branch",
          toolUseID: "toolu_question",
        },
      );
      sawAskUserQuestion = Boolean(
        permission?.behavior === "allow" &&
          permission.updatedInput?.answers &&
          (permission.updatedInput.answers as Record<string, string>).Choice === "A",
      );
      yield {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "hello " },
        },
        parent_tool_use_id: null,
        uuid: "00000000-0000-5000-8000-000000000003",
        session_id: "00000000-0000-5000-8000-000000000002",
      };
      yield {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "from sdk" },
        },
        parent_tool_use_id: null,
        uuid: "00000000-0000-5000-8000-000000000004",
        session_id: "00000000-0000-5000-8000-000000000002",
      };
      yield {
        type: "result",
        subtype: "success",
        duration_ms: 10,
        duration_api_ms: 5,
        is_error: false,
        num_turns: 1,
        result: "final sdk result",
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: "00000000-0000-5000-8000-000000000005",
        session_id: "00000000-0000-5000-8000-000000000002",
      };
    }
    const iterator = messages();
    return Object.assign(iterator, {
      close() {},
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      setMaxThinkingTokens: async () => {},
      setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
      reloadPlugins: async () => ({ commands: [], agents: [], plugins: [], mcpServers: [] }),
      getSettings: async () => ({}),
    }) as unknown;
  }) as ClaudeAgentSdkQueryFunction;

  const runtime = new ClaudeAgentSdkRuntime({
    cwd,
    permissionMode: "default",
    configuredModel: "opus",
    modelAliases: { "glm-5.1": "opus" },
    env: {
      ANTHROPIC_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
    },
    query: fakeQuery,
  });

  const events: AgentEvent[] = [];
  const context: AgentContext = {
    sessionId: "claude-sdk-harness",
    activity: "chat",
    memory: app.memory,
    artifacts: app.artifacts,
    skills: app.skills,
    packs: app.packs,
    sessions: app.sessions,
    executions: app.executions,
    workingState: app.workingState,
    approvals: app.approvals,
  };

  for await (const event of runtime.runTurn({
    input: "hello sdk",
    context,
    tools: app.tools.list(),
    requestedModelId: "glm-5.1",
    skills: app.skills.list(),
    packs: app.packs.list(),
    capabilities: app.capabilities.list(),
  })) {
    events.push(event);
    if (event.type === "approval.requested") {
      app.approvals.decide(event.request.id, "approved", { answers: { Choice: "A" } });
    }
  }

  assert.equal(capturedPrompt, "hello sdk");
  assert.equal(capturedModel, "opus", "Claude SDK should receive a Claude Code family alias");
  assert.equal(capturedEnvModel, "glm-5.1", "Provider model should stay in Claude env mapping");
  assert.equal(capturedEnvOpusModel, "glm-5.1", "Provider model should map the Opus family");
  assert.equal(sawMcpServer, true, "OpenGrove MCP server should be exposed to Claude SDK");
  assert.equal(sawAskUserQuestion, true, "AskUserQuestion should round-trip through OpenGrove approval UI");
  assert.ok(events.some((event) => event.type === "runtime.diagnostic" && event.name === "claude.sdk.init"));
  assert.ok(events.some((event) => event.type === "assistant.delta" && event.text === "hello "));
  const response = events.find((event): event is Extract<AgentEvent, { type: "model.response" }> => event.type === "model.response");
  const request = events.find((event): event is Extract<AgentEvent, { type: "model.requested" }> => event.type === "model.requested");
  assert.equal(request?.request.modelId, "opus");
  assert.equal(response?.response.text, "final sdk result");
  assert.deepEqual(
    JSON.parse(app.workingState.get().toolSchemaCache["claude.slashCommands"] || "[]"),
    ["/compact", "/model", "/status"],
  );

  const transcriptCwd = mkdtempSync(join(tmpdir(), "opengrove-claude-sdk-transcript-"));
  const transcriptConfigDir = join(transcriptCwd, "claude-home");
  const transcriptContext = { ...context, sessionId: "claude-sdk-transcript-harness" };
  const transcriptFingerprint = claudeRuntimeBindingFingerprint("native", transcriptCwd);
  const transcriptSessionId = stableClaudeSessionId(`${transcriptContext.sessionId}:${transcriptFingerprint}`);
  mkdirSync(join(transcriptConfigDir, "projects", claudeProjectKey(transcriptCwd)), { recursive: true });
  writeFileSync(
    join(transcriptConfigDir, "projects", claudeProjectKey(transcriptCwd), `${transcriptSessionId}.jsonl`),
    "",
  );
  let capturedResume = "";
  let capturedSessionId = "";
  const transcriptRuntime = new ClaudeAgentSdkRuntime({
    cwd: transcriptCwd,
    permissionMode: "default",
    configuredModel: "opus",
    env: { CLAUDE_CONFIG_DIR: transcriptConfigDir },
    query: ((params) => {
      capturedResume = params.options?.resume ?? "";
      capturedSessionId = params.options?.sessionId ?? "";
      async function* messages() {
        yield {
          type: "system",
          subtype: "init",
          apiKeySource: "user",
          claude_code_version: "2.1.fake",
          cwd: transcriptCwd,
          tools: [],
          mcp_servers: [],
          model: "claude-test",
          permissionMode: "default",
          slash_commands: [],
          output_style: "default",
          skills: [],
          plugins: [],
          uuid: "00000000-0000-5000-8000-000000000301",
          session_id: transcriptSessionId,
        };
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 10,
          duration_api_ms: 5,
          is_error: false,
          num_turns: 1,
          result: "resumed transcript",
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: {},
          modelUsage: {},
          permission_denials: [],
          uuid: "00000000-0000-5000-8000-000000000302",
          session_id: transcriptSessionId,
        };
      }
      const iterator = messages();
      return Object.assign(iterator, {
        close() {},
        interrupt: async () => {},
        setPermissionMode: async () => {},
        setModel: async () => {},
        setMaxThinkingTokens: async () => {},
        setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
        reloadPlugins: async () => ({ commands: [], agents: [], plugins: [], mcpServers: [] }),
        getSettings: async () => ({}),
      }) as unknown;
    }) as ClaudeAgentSdkQueryFunction,
  });
  for await (const event of transcriptRuntime.runTurn({
    input: "hello transcript sdk",
    context: transcriptContext,
    tools: app.tools.list(),
    requestedModelId: "opus",
    skills: app.skills.list(),
    packs: app.packs.list(),
    capabilities: app.capabilities.list(),
  })) {
    events.push(event);
  }
  assert.equal(capturedResume, transcriptSessionId);
  assert.equal(capturedSessionId, "");

  const failingRuntime = new ClaudeAgentSdkRuntime({
    cwd,
    permissionMode: "default",
    configuredModel: "opus",
    query: ((params) => {
      async function* messages() {
        params.options?.stderr?.("Error: Session ID demo-session is already in use.\n");
        throw new Error("Claude Code process exited with code 1");
      }
      const iterator = messages();
      return Object.assign(iterator, {
        close() {},
        interrupt: async () => {},
        setPermissionMode: async () => {},
        setModel: async () => {},
        setMaxThinkingTokens: async () => {},
        setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
        reloadPlugins: async () => ({ commands: [], agents: [], plugins: [], mcpServers: [] }),
        getSettings: async () => ({}),
      }) as unknown;
    }) as ClaudeAgentSdkQueryFunction,
  });
  const failureEvents: AgentEvent[] = [];
  for await (const event of failingRuntime.runTurn({
    input: "hello failing sdk",
    context: { ...context, sessionId: "claude-sdk-failure-harness" },
    tools: app.tools.list(),
    requestedModelId: "opus",
    skills: app.skills.list(),
    packs: app.packs.list(),
    capabilities: app.capabilities.list(),
  })) {
    failureEvents.push(event);
  }
  const failure = failureEvents.find((event): event is Extract<AgentEvent, { type: "error" }> => event.type === "error");
  assert.ok(failure?.message.includes("Claude Code process exited with code 1"));
  assert.ok(failure?.message.includes("Session ID demo-session is already in use"));
  assert.ok(failureEvents.some((event) => event.type === "turn.finished"));

  let activeQueries = 0;
  let maxActiveQueries = 0;
  const lockingRuntime = new ClaudeAgentSdkRuntime({
    cwd,
    permissionMode: "default",
    configuredModel: "opus",
    query: ((params) => {
      async function* messages() {
        activeQueries += 1;
        maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
        await new Promise((resolve) => setTimeout(resolve, 25));
        yield {
          type: "system",
          subtype: "init",
          apiKeySource: "user",
          claude_code_version: "2.1.fake",
          cwd,
          tools: [],
          mcp_servers: [],
          model: "claude-test",
          permissionMode: "default",
          slash_commands: [],
          output_style: "default",
          skills: [],
          plugins: [],
          uuid: `00000000-0000-5000-8000-${params.prompt === "first" ? "000000000101" : "000000000201"}`,
          session_id: "00000000-0000-5000-8000-000000000099",
        };
        yield {
          type: "result",
          subtype: "success",
          duration_ms: 10,
          duration_api_ms: 5,
          is_error: false,
          num_turns: 1,
          result: `done ${params.prompt}`,
          stop_reason: "end_turn",
          total_cost_usd: 0,
          usage: {},
          modelUsage: {},
          permission_denials: [],
          uuid: `00000000-0000-5000-8000-${params.prompt === "first" ? "000000000102" : "000000000202"}`,
          session_id: "00000000-0000-5000-8000-000000000099",
        };
        activeQueries -= 1;
      }
      const iterator = messages();
      return Object.assign(iterator, {
        close() {},
        interrupt: async () => {},
        setPermissionMode: async () => {},
        setModel: async () => {},
        setMaxThinkingTokens: async () => {},
        setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
        reloadPlugins: async () => ({ commands: [], agents: [], plugins: [], mcpServers: [] }),
        getSettings: async () => ({}),
      }) as unknown;
    }) as ClaudeAgentSdkQueryFunction,
  });
  const lockContext = { ...context, sessionId: "claude-sdk-lock-harness" };
  async function collect(input: string): Promise<AgentEvent[]> {
    const collected: AgentEvent[] = [];
    for await (const event of lockingRuntime.runTurn({
      input,
      context: lockContext,
      tools: app.tools.list(),
      skills: app.skills.list(),
      packs: app.packs.list(),
      capabilities: app.capabilities.list(),
    })) {
      collected.push(event);
    }
    return collected;
  }
  await Promise.all([collect("first"), collect("second")]);
  assert.equal(maxActiveQueries, 1, "Claude SDK runs sharing a native session should be serialized");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function stableClaudeSessionId(input: string): string {
  const hash = createHash("sha1").update(input).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function claudeRuntimeBindingFingerprint(base: string | undefined, cwd: string): string {
  return createHash("sha1")
    .update([
      base || "native",
      cwd,
    ].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function claudeProjectKey(cwd: string): string {
  return resolve(cwd || process.cwd())
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._-]/g, "-");
}
