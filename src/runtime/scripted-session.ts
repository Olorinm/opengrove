import type {
  AgentEvent,
  JsonObject,
  JsonValue,
  PolicyDecision,
  ToolDefinition,
  ToolResult,
} from "../core.js";
import type { PiSession, PiSessionContext } from "./pi-runtime.js";

export interface ScriptedCompanionSessionOptions {
  capabilityId?: string;
  saveCandidateNote?: boolean;
}

export function createScriptedCompanionSession(
  options: ScriptedCompanionSessionOptions = {},
): PiSession {
  const capabilityId = options.capabilityId ?? "cap.weread-companion";

  return {
    async *run(input, context) {
      const read = await callTool(context, "browser.readSelection", {}, capabilityId);
      yield* read.events;

      if (!read.result.ok) {
        yield {
          type: "assistant.delta",
          runId: context.runId,
          text: `我现在读不到选区：${read.result.error ?? "unknown error"}`,
        };
        return;
      }

      const page = objectValue(read.result.value);
      const selection = stringValue(page.selection);
      const title = stringValue(page.title);
      const url = stringValue(page.url);

      yield {
        type: "assistant.delta",
        runId: context.runId,
        text: buildCompanionReply(input, selection, title),
      };

      if (!options.saveCandidateNote) {
        return;
      }

      const note = await callTool(
        context,
        "memory.proposeReadingNote",
        {
          kind: "reading.note",
          text: selection ? `关于《${title || "当前页面"}》选区的讨论：${selection}` : input,
          tags: ["reading", "weread"],
          title,
          url,
          quote: selection,
        },
        capabilityId,
      );
      yield* note.events;
    },
  };
}

async function callTool(
  context: PiSessionContext,
  toolId: string,
  input: JsonObject,
  capabilityId: string,
): Promise<{ events: AgentEvent[]; result: ToolResult }> {
  const tool = requireTool(context.tools, toolId);
  const policy = await context.beforeToolCall({ toolId, capabilityId });
  const events: AgentEvent[] = [
    { type: "tool.started", runId: context.runId, toolId, input },
  ];

  if (policy.mode !== "allow") {
    const approval =
      policy.mode === "ask"
        ? context.agent.approvals.request({
            kind: "tool",
            title: tool.spec.title,
            reason: policy.reason,
            toolId,
            capabilityId,
            input,
            resume: { type: "tool", runId: context.runId },
          })
        : undefined;
    const blocked: ToolResult = {
      ok: false,
      error: policy.mode === "deny" ? "permission_denied" : "approval_required",
      value: { reason: policy.reason, approvalId: approval?.id ?? "" },
    };
    events.push({ type: "tool.finished", runId: context.runId, toolId, result: blocked });
    if (approval) {
      events.push({ type: "approval.requested", runId: context.runId, request: approval });
    }
    return { events, result: blocked };
  }

  try {
    const result = await tool.execute(input, {
      runId: context.runId,
      capabilityId,
      memory: context.agent.memory,
      artifacts: context.agent.artifacts,
      workingState: context.agent.workingState,
      approvals: context.agent.approvals,
      skills: context.agent.skills,
      packs: context.agent.packs,
      policy,
    });
    events.push({ type: "tool.finished", runId: context.runId, toolId, result });
    for (const request of context.agent.approvals.list("pending")) {
      events.push({ type: "approval.requested", runId: context.runId, request });
    }
    return { events, result };
  } catch (error) {
    const result: ToolResult = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    events.push({ type: "tool.finished", runId: context.runId, toolId, result });
    return { events, result };
  }
}

function requireTool(tools: ToolDefinition[], toolId: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.spec.id === toolId);
  if (!tool) {
    throw new Error(`Tool not available: ${toolId}`);
  }
  return tool;
}

function buildCompanionReply(input: string, selection: string, title: string): string {
  if (!selection) {
    return "我没有读到当前选区。你可以先划出一句或一段，我再贴着原文和你讨论。";
  }

  const where = title ? `《${title}》这段` : "这段";
  return [
    `${where}我先抓住一个核心：${selection}`,
    `你问的是“${input}”。我会先按原文解释，再给一个可以继续追问的角度：这段值得看的不是结论本身，而是它如何把概念、经验和你的问题接起来。`,
  ].join("\n");
}

function objectValue(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}
