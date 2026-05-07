import {
  evaluateToolPolicy,
  type AgentEvent,
  type AgentContext,
  type AgentRuntime,
  type AgentSessionTrace,
  type AgentTurnRequest,
  type CapabilityManifest,
  type ContextEnvelope,
  type InvokedSkillRecord,
  type PackManifest,
  type PolicyDecision,
  type SkillManifest,
  type ToolDefinition,
} from "../core.js";
import { renderSkillIndex } from "../skills/catalog.js";

export interface PiToolCallGate {
  toolId: string;
  capabilityId?: string;
}

export interface PiSessionContext {
  runId: string;
  agent: AgentContext;
  tools: ToolDefinition[];
  skills: SkillManifest[];
  packs: PackManifest[];
  capabilities: CapabilityManifest[];
  requestedSkillInvocation?: InvokedSkillRecord;
  assembledContext?: ContextEnvelope;
  beforeToolCall(gate: PiToolCallGate): Promise<PolicyDecision>;
}

export interface PiSession {
  run(input: string, context: PiSessionContext): AsyncIterable<AgentEvent>;
  trace?(): AgentSessionTrace | undefined;
}

export interface PiAgentRuntimeOptions {
  createSession(context: {
    sessionId: string;
    system: string;
    requestedModelId?: string;
    requestedEffort?: string;
    tools: ToolDefinition[];
    skills: SkillManifest[];
    packs: PackManifest[];
    capabilities: CapabilityManifest[];
  }): PiSession;
  system?: string;
}

const DEFAULT_SYSTEM = [
  "You are OpenGrove, a personal agent.",
  "Keep the core loop simple: observe, reason, use tools only when helpful, and explain uncertainty.",
  "Tools are hands, skills are reusable ways to work, and memory is written only through the ledger.",
].join("\n");

export class PiAgentRuntime implements AgentRuntime {
  constructor(private readonly options: PiAgentRuntimeOptions) {}

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const runId = request.runId ?? `run_${Date.now()}`;
    const skills = request.skills ?? [];
    const packs = request.packs ?? [];
    const capabilities = request.capabilities ?? [];
    const policy = request.policy ?? capabilities.flatMap((capability) => capability.policy);
    const systemPrompt = buildSystemPrompt(
      this.options.system ?? DEFAULT_SYSTEM,
      request.context,
      skills,
      packs,
      capabilities,
    );
    const session = this.options.createSession({
      sessionId: request.context.sessionId,
      system: systemPrompt,
      requestedModelId: request.requestedModelId,
      requestedEffort: request.requestedEffort,
      tools: request.tools,
      skills,
      packs,
      capabilities,
    });
    const sessionTrace = session.trace?.();
    let assistantText = "";
    let pauseRequest:
      | Extract<AgentEvent, { type: "approval.requested" }>
      | undefined;

    yield { type: "turn.started", runId, at: new Date().toISOString() };
    if (request.assembledContext) {
      yield { type: "context.assembled", runId, context: request.assembledContext };
    }
    yield {
      type: "model.requested",
      runId,
      request: {
        systemPrompt,
        userInput: request.input,
        modelId: request.requestedModelId,
        session: sessionTrace,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills,
        packs,
        capabilities,
      },
    };

    try {
      const context: PiSessionContext = {
        runId,
        agent: request.context,
        tools: request.tools,
        skills,
        packs,
        capabilities,
        requestedSkillInvocation: request.requestedSkillInvocation,
        assembledContext: request.assembledContext,
        beforeToolCall: async (gate) => {
          const tool = request.tools.find((candidate) => candidate.spec.id === gate.toolId);
          if (!tool) {
            return { mode: "deny", reason: `Unknown tool: ${gate.toolId}` };
          }
          return evaluateToolPolicy(tool.spec, policy, gate.capabilityId);
        },
      };

      for await (const event of session.run(request.input, context)) {
        if (event.type === "assistant.delta") {
          assistantText += event.text;
        }
        if (event.type === "approval.requested") {
          pauseRequest = event;
        }
        yield event;
      }
    } catch (error) {
      yield {
        type: "error",
        runId,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    yield { type: "model.response", runId, response: { text: assistantText } };
    if (pauseRequest) {
      yield {
        type: "run.paused",
        runId,
        at: new Date().toISOString(),
        reason: pauseRequest.request.reason,
        approvalId: pauseRequest.request.id,
      };
      return;
    }

    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }
}

function buildSystemPrompt(
  base: string,
  context: AgentContext,
  skills: SkillManifest[],
  packs: PackManifest[],
  capabilities: CapabilityManifest[],
): string {
  const skillLines = getCachedPromptSection(context, "skillIndex", () => renderSkillIndex(skills));
  const capabilityLines = capabilities.map(
    (capability) => `- ${capability.id}@${capability.version}: ${capability.description}`,
  );
  const packLines = packs.map((pack) => `- ${pack.id}: ${pack.description}`);

  return [
    base,
    "\nSkill protocol:",
    "- Keep the base prompt small. Skills are indexed here and loaded on demand.",
    "- When a skill matches the user's request, this is a blocking requirement: invoke `skill.invoke` before generating any substantive response about the task.",
    "- Never mention or rely on a skill without actually invoking it first.",
    "- For user slash commands, treat `/<skill-name>` as an explicit skill load request.",
    skillLines ? `\nAvailable skills:\n${skillLines}` : "",
    packLines.length ? `\nAvailable packs:\n${packLines.join("\n")}` : "",
    capabilityLines.length ? `\nAvailable capabilities:\n${capabilityLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getCachedPromptSection(
  context: AgentContext,
  key: string,
  compute: () => string,
): string {
  const workingState = context.workingState.get();
  const nextValue = compute();
  if (workingState.toolSchemaCache[key] === nextValue) {
    return nextValue;
  }
  context.workingState.update({
    toolSchemaCache: {
      ...workingState.toolSchemaCache,
      [key]: nextValue,
    },
  });
  return nextValue;
}
