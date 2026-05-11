import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OpenAiHttpRuntime } from "../runtime/openai-http-runtime.js";
import { ApprovalInbox } from "../core.js";
import type { AgentEvent, AgentTurnRequest, JsonObject, ToolDefinition } from "../core.js";

function createMockRequest(input: string, tools: ToolDefinition[] = []): AgentTurnRequest {
  return {
    input,
    runId: "test-run-1",
    context: {
      sessionId: "test-session-1",
      activity: undefined as any,
      sessions: undefined as any,
      memory: undefined as any,
      artifacts: undefined as any,
      skills: undefined as any,
      executions: undefined as any,
      workingState: undefined as any,
      approvals: new ApprovalInbox(),
      packs: undefined as any,
    },
    tools,
  };
}

function handleMockChatCompletion(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const userMsg = parsed.messages?.find((m: any) => m.role === "user")?.content ?? "";

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const chunks = [
      { id: "c1", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { content: " from" }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { content: " mock!" }, finish_reason: null }] },
      { id: "c1", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];

    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
}

function handleMockToolCall(req: IncomingMessage, res: ServerResponse) {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const toolName = parsed.tools?.[0]?.function?.name ?? "opengrove_get_weather";
    const hasToolResult = parsed.messages?.some((message: any) => message.role === "tool");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const chunks = hasToolResult
      ? [
          { id: "c3", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
          { id: "c3", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { content: "Weather checked." }, finish_reason: null }] },
          { id: "c3", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ]
      : [
          { id: "c2", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: toolName, arguments: "" } }] }, finish_reason: null }] },
          { id: "c2", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }, finish_reason: null }] },
          { id: "c2", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Beijing"}' } }] }, finish_reason: null }] },
          { id: "c2", object: "chat.completion.chunk", model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        ];

    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
}

async function collectEvents(
  runtime: OpenAiHttpRuntime,
  request: AgentTurnRequest,
  onEvent?: (event: AgentEvent) => void,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runtime.runTurn(request)) {
    events.push(event);
    onEvent?.(event);
  }
  return events;
}

async function runTests() {
  let testMode: "text" | "tool" = "text";

  const server = createServer((req, res) => {
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      if (testMode === "tool") {
        handleMockToolCall(req, res);
      } else {
        handleMockChatCompletion(req, res);
      }
    } else if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/v1`;

  console.log(`Mock server on ${baseUrl}`);

  const runtime = new OpenAiHttpRuntime({
    baseUrl,
    model: "test-model",
    sessionMode: "stateless",
  });

  // Test 1: Basic streaming text
  console.log("\n--- Test 1: Streaming text ---");
  testMode = "text";
  const textEvents = await collectEvents(runtime, createMockRequest("Hi"));
  const textTypes = textEvents.map((e) => e.type);
  console.log("Event types:", textTypes);

  const deltas = textEvents.filter((e) => e.type === "assistant.delta").map((e: any) => e.text);
  console.log("Deltas:", deltas);
  const finalResponse = textEvents.find((e) => e.type === "model.response") as any;
  console.log("Final text:", finalResponse?.response?.text);

  const textPass =
    textTypes.includes("turn.started") &&
    textTypes.includes("assistant.delta") &&
    textTypes.includes("model.response") &&
    textTypes.includes("turn.finished") &&
    deltas.join("") === "Hello from mock!" &&
    finalResponse?.response?.text === "Hello from mock!";
  console.log(textPass ? "✓ PASS" : "✗ FAIL");

  // Test 2: Tool calls
  console.log("\n--- Test 2: Tool calls ---");
  testMode = "tool";
  const weatherTool: ToolDefinition<JsonObject, JsonObject> = {
    spec: {
      id: "get_weather",
      title: "Get weather",
      description: "Return mock weather for a city.",
      activity: "api",
      risk: "read",
      input: {
        type: "json-schema",
        schema: {
          type: "object",
          required: ["city"],
          properties: {
            city: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      permission: {
        mode: "allow",
        reason: "Read-only mock weather lookup.",
      },
    },
    async execute(input) {
      return { ok: true, value: { city: String(input.city ?? ""), tempC: 21 } };
    },
  };
  const toolEvents = await collectEvents(runtime, createMockRequest("weather", [weatherTool]));
  const toolTypes = toolEvents.map((e) => e.type);
  console.log("Event types:", toolTypes);

  const toolStarted = toolEvents.find((e) => e.type === "tool.started") as any;
  const toolFinished = toolEvents.find((e) => e.type === "tool.finished") as any;
  console.log("Tool started:", toolStarted?.toolId);
  console.log("Tool finished:", toolFinished?.toolId, toolFinished?.result);

  const toolPass =
    toolTypes.includes("tool.started") &&
    toolTypes.includes("tool.finished") &&
    toolStarted?.toolId === "get_weather" &&
    toolFinished?.toolId === "get_weather" &&
    (toolFinished?.result as any)?.value?.city === "Beijing" &&
    (toolEvents.find((e) => e.type === "model.response") as any)?.response?.text === "Weather checked.";
  console.log(toolPass ? "✓ PASS" : "✗ FAIL");

  // Test 3: Approval-gated tool calls pause, resume, and continue the OpenAI tool loop
  console.log("\n--- Test 3: Approval-gated tool calls ---");
  testMode = "tool";
  const writeTool: ToolDefinition<JsonObject, JsonObject> = {
    spec: {
      id: "write_note",
      title: "Write note",
      description: "Write a mock note.",
      activity: "local",
      risk: "write",
      input: {
        type: "json-schema",
        schema: {
          type: "object",
          required: ["city"],
          properties: {
            city: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      permission: {
        mode: "allow",
        reason: "Writes are approved by policy.",
      },
    },
    async execute(input) {
      return { ok: true, value: { wrote: String(input.city ?? "") } };
    },
  };
  const approvalRequest = createMockRequest("write", [writeTool]);
  const approvalEvents = await collectEvents(runtime, approvalRequest, (event) => {
    if (event.type === "approval.requested") {
      setTimeout(() => {
        approvalRequest.context.approvals.decide(event.request.id, "approved");
      }, 0);
    }
  });
  const approvalTypes = approvalEvents.map((e) => e.type);
  console.log("Event types:", approvalTypes);
  const approvalToolFinished = approvalEvents.find((e) => e.type === "tool.finished") as any;
  const approvalPass =
    approvalTypes.includes("approval.requested") &&
    approvalTypes.includes("run.paused") &&
    approvalTypes.includes("approval.resolved") &&
    approvalTypes.includes("run.resumed") &&
    approvalToolFinished?.toolId === "write_note" &&
    approvalToolFinished?.result?.ok === true &&
    (approvalEvents.find((e) => e.type === "model.response") as any)?.response?.text === "Weather checked.";
  console.log(approvalPass ? "✓ PASS" : "✗ FAIL");

  // Test 4: Health check via adapter
  console.log("\n--- Test 4: Adapter health check ---");
  const { OpenAiHttpKernelAdapter } = await import("../kernel/adapters/openai-http.js");
  const adapter = new OpenAiHttpKernelAdapter({
    id: "test-kernel",
    title: "Test Kernel",
    baseUrl,
    model: "test-model",
    healthPath: "/models",
  });
  const health = await adapter.healthCheck();
  console.log("Health:", health);
  const healthPass = health.status === "ok";
  console.log(healthPass ? "✓ PASS" : "✗ FAIL");

  // Summary
  console.log("\n=== Summary ===");
  const allPass = textPass && toolPass && approvalPass && healthPass;
  console.log(allPass ? "All tests PASSED ✓" : "Some tests FAILED ✗");

  server.close();
  process.exit(allPass ? 0 : 1);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
