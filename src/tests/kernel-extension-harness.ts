import assert from "node:assert/strict";
import { HERMES_KERNEL_MANIFEST } from "../kernel/adapters/hermes.js";
import { externalCliDefinition } from "../kernel/adapters/external-cli.js";
import { AcpSessionProjector } from "../runtime/projectors/acp.js";
import { kernelTransportDescriptor } from "../runtime/transports/types.js";

function main() {
  assert.equal(kernelTransportDescriptor("acp").structuredToolEvents, true);
  assert.equal(kernelTransportDescriptor("oneshot-cli").structuredToolEvents, false);

  let assistantText = "";
  const projector = new AcpSessionProjector({
    runId: "run-extension",
    kernelId: "opencode",
    onAssistantText(text) {
      assistantText += text;
    },
  });
  const events = [
    ...projector.project({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hidden" } }),
    ...projector.project({ sessionUpdate: "tool_call", toolCallId: "tool-1", title: "bash: pwd", rawInput: { command: "pwd" } }),
    ...projector.project({ sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: "/tmp" }),
    ...projector.project({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } }),
    ...projector.project({ sessionUpdate: "usage_update", inputTokens: 4, outputTokens: 2, totalTokens: 6 }),
  ];

  assert.equal(assistantText, "done");
  assert.ok(events.some((event) => event.type === "tool.started" && event.toolId === "opencode.bash"));
  assert.ok(events.some((event) => event.type === "tool.finished" && event.toolId === "opencode.bash"));
  assert.ok(events.some((event) => event.type === "assistant.delta" && event.text === "done"));
  assert.ok(events.some((event) => event.type === "runtime.diagnostic" && event.name === "opencode.acp.usage"));
  assert.equal(events.some((event) => event.type === "assistant.delta" && event.text === "hidden"), false);

  assert.equal(HERMES_KERNEL_MANIFEST.transport.primary, "acp");
  assert.equal(HERMES_KERNEL_MANIFEST.harness.fakeServer, "acp");
  assert.equal(HERMES_KERNEL_MANIFEST.rollout?.status, "implemented");

  assert.equal(externalCliDefinition("opencode")?.preferredTransport, "acp");
  assert.equal(externalCliDefinition("copilot")?.preferredTransport, "acp");
  assert.equal(externalCliDefinition("kimi")?.preferredTransport, "acp");
  assert.equal(externalCliDefinition("kiro-cli")?.preferredTransport, "acp");
  assert.equal(externalCliDefinition("cursor-agent")?.preferredTransport, "oneshot-cli");
  assert.equal(externalCliDefinition("cursor-agent")?.outputFormat, "agent-jsonl");
  assert.equal(externalCliDefinition("pi")?.preferredTransport, "sdk-inprocess");
  assert.equal(externalCliDefinition("deepseek-tui")?.preferredTransport, "acp");
  assert.equal(externalCliDefinition("openclaw")?.preferredTransport, "websocket-gateway");
}

main();
