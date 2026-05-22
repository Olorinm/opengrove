import {
  Agent,
  type AgentMessage as NativeAgentMessage,
  type AgentEvent as NativePiEvent,
  type AgentOptions,
  type AgentTool,
  type StreamFn,
  type ThinkingLevel,
} from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import {
  streamSimple,
  type Context as NativeModelContext,
  type Model,
  type UserMessage,
} from "@mariozechner/pi-ai";
import {
  WorkingStateStore,
} from "../core.js";
import type {
  AgentContext,
  AgentEvent,
  AgentModelRequestTrace,
  AgentSessionTrace,
  ApprovalRequest,
  ContextEnvelope,
  InvokedSkillRecord,
  JsonObject,
  JsonValue,
  ModelMessage,
  ToolDefinition,
  ToolResult,
} from "../core.js";
import { buildSkillSteeringText } from "../skills/runtime.js";
import type {
  PiAgentRuntimeOptions,
  PiSession,
  PiSessionContext,
} from "./pi-runtime.js";

export interface NativePiSessionOptions {
  model: Model<any> | ((requestedModelId?: string) => Model<any>);
  streamFn?: StreamFn;
  getApiKey?: AgentOptions["getApiKey"];
  thinkingLevel?: ThinkingLevel | ((requestedEffort?: string) => ThinkingLevel);
  toolExecution?: AgentOptions["toolExecution"];
  retainedMessageLimit?: number;
}

export function createNativePiSessionFactory(
  options: NativePiSessionOptions,
): PiAgentRuntimeOptions["createSession"] {
  const sessions = new Map<string, NativePiSession>();

  return (context) => {
    const sessionId = context.sessionId || "default";
    let session = sessions.get(sessionId);
    if (!session) {
      session = new NativePiSession(context, options, sessionId);
      sessions.set(sessionId, session);
    } else {
      session.updateRuntimeContext(context);
    }
    return session;
  };
}

class NativePiSession implements PiSession {
  private agent?: Agent;
  private nativeToolNames = new Map<string, string>();
  private pendingSkillOverlay?: InvokedSkillRecord;
  private activeSkillOverlay?: InvokedSkillRecord;

  constructor(
    private runtimeContext: Parameters<PiAgentRuntimeOptions["createSession"]>[0],
    private readonly options: NativePiSessionOptions,
    private readonly sessionId: string,
  ) {}

  updateRuntimeContext(context: Parameters<PiAgentRuntimeOptions["createSession"]>[0]) {
    this.runtimeContext = context;
  }

  trace(): AgentSessionTrace {
    const retainedMessageLimit = this.options.retainedMessageLimit ?? 40;
    const messages = trimAgentMessages(this.agent?.state.messages ?? [], retainedMessageLimit);
    return {
      provider: "pi",
      sessionId: this.sessionId,
      persistent: true,
      priorMessageCount: messages.length,
      retainedMessageLimit,
      priorMessages: toModelMessages(messages),
    };
  }

  async *run(input: string, context: PiSessionContext): AsyncIterable<AgentEvent> {
    const queue: Array<NativeSessionEvent> = [];
    let done = false;
    let currentAssistantText = "";
    const emittedErrors = new Set<string>();
    let pauseRequested: ApprovalRequest | undefined;
    let wake: (() => void) | undefined;

    const push = (events: NativeSessionEvent[]) => {
      const visibleEvents = events.filter((event) => !pauseRequested || event.type === "approval.requested");
      if (visibleEvents.length === 0) {
        return;
      }
      queue.push(...visibleEvents);
      wake?.();
      wake = undefined;
    };

    const agent = this.configureAgentForTurn(input, context, push, {
      getPauseRequest: () => pauseRequested,
      setPauseRequest: (request) => {
        pauseRequested = request;
      },
    });
    const nativeToolNames = this.nativeToolNames;

    if (context.requestedSkillInvocation?.context === "inline") {
      this.pendingSkillOverlay = undefined;
      this.activeSkillOverlay = context.requestedSkillInvocation;
      agent.steer(createSkillSteeringMessage(context.requestedSkillInvocation));
    }

    const unsubscribe = agent.subscribe((event) => {
      this.handleLoopEvent(event, context, push);
      const mapped = mapNativeEvent(event, context.runId, nativeToolNames);

      if (event.type === "message_start" && event.message.role === "assistant") {
        currentAssistantText = "";
      }

      for (const mappedEvent of mapped) {
        if (mappedEvent.type === "assistant.delta") {
          currentAssistantText += mappedEvent.text;
        }
      }

      if (event.type === "message_end" && event.message.role === "assistant") {
        const finalText = readAssistantText(event.message);
        if (!currentAssistantText && finalText) {
          mapped.push({ type: "assistant.delta", runId: context.runId, text: finalText });
          currentAssistantText = finalText;
        }
        if (event.message.errorMessage) {
          mapped.push({ type: "error", runId: context.runId, message: event.message.errorMessage });
        }
        currentAssistantText = "";
      }

      if (event.type === "agent_end") {
        const lastMessage = event.messages.at(-1);
        if (lastMessage?.role === "assistant" && lastMessage.errorMessage) {
          mapped.push({ type: "error", runId: context.runId, message: lastMessage.errorMessage });
        }
      }

      const uniqueEvents = mapped.filter((mappedEvent) => {
        if (mappedEvent.type !== "error") {
          return true;
        }
        if (emittedErrors.has(mappedEvent.message)) {
          return false;
        }
        emittedErrors.add(mappedEvent.message);
        return true;
      });

      push(uniqueEvents);
    });

    if (context.assembledContext?.promptBlock) {
      agent.steer(createContextSteeringMessage(context.assembledContext));
    }

    const prompt = agent
      .prompt(input)
      .catch((error) => {
        if (pauseRequested) {
          return;
        }
        push([
          {
            type: "error",
            runId: context.runId,
            message: error instanceof Error ? error.message : String(error),
          },
        ]);
      })
      .finally(() => {
        done = true;
        wake?.();
        wake = undefined;
      });

    try {
      while (!done || queue.length > 0) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }

        if (!done) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    } finally {
      unsubscribe();
      await prompt;
    }
  }

  private configureAgentForTurn(
    input: string,
    context: PiSessionContext,
    push: (events: NativeSessionEvent[]) => void,
    options: {
      getPauseRequest(): ApprovalRequest | undefined;
      setPauseRequest(request: ApprovalRequest): void;
    },
  ): Agent {
    this.nativeToolNames = createNativeToolNameMap(this.runtimeContext.tools);
    const model = resolveModel(this.options.model, this.runtimeContext.requestedModelId);
    const thinkingLevel = resolveThinkingLevel(
      this.options.thinkingLevel,
      this.runtimeContext.requestedEffort,
    );
    const tools = toNativeTools(this.runtimeContext.tools, context, this.nativeToolNames, {
      onSkillInvoked: (invocation) => {
        const manifest = context.agent.skills.get(invocation.skillId) ?? context.agent.skills.get(invocation.skillName);
        if (manifest) {
          push([{ type: "skill.invoked", runId: context.runId, skill: manifest, invocation }]);
          push([
            {
              type: "skill.loaded",
              runId: context.runId,
              skillId: invocation.skillId,
              contentPreview: invocation.contentPreview,
              allowedTools: [...invocation.allowedTools],
              model: invocation.model,
              effort: invocation.effort,
              context: invocation.context,
            },
          ]);
        }
        if (invocation.context === "inline") {
          this.pendingSkillOverlay = invocation;
          this.agent?.steer(createSkillSteeringMessage(invocation));
        }
      },
      onSkillCleared: (reason) => {
        const cleared = this.activeSkillOverlay;
        if (!cleared) {
          return;
        }
        this.activeSkillOverlay = undefined;
        push([{ type: "skill.cleared", runId: context.runId, skillId: cleared.skillId, reason }]);
      },
      runForkedSkill: async (invocation) => {
        push([
          {
            type: "skill.forked",
            runId: context.runId,
            skillId: invocation.skillId,
            forkSessionId: `${this.sessionId}:skill:${invocation.skillName}:${Date.now()}`,
            status: "started",
          },
        ]);
        const result = await this.executeForkedSkill(invocation, context);
        push([
          {
            type: "skill.forked",
            runId: context.runId,
            skillId: invocation.skillId,
            forkSessionId: result.forkSessionId,
            status: "finished",
            result: result.text,
          },
        ]);
        return result;
      },
      resolveToolPolicy: async (toolId, capabilityId) => this.resolveToolPolicy(context, toolId, capabilityId),
    });
    const streamFn = this.createTracingStreamFn(input, context, push);

    if (!this.agent) {
      this.agent = new Agent({
        initialState: {
          systemPrompt: this.runtimeContext.system,
          model,
          thinkingLevel,
          tools,
          messages: [],
        },
        streamFn,
        getApiKey: this.options.getApiKey,
        sessionId: this.sessionId,
        transformContext: async (messages) => trimAgentMessages(messages, this.options.retainedMessageLimit ?? 40),
        toolExecution: this.options.toolExecution ?? "parallel",
      });
    }

    this.agent.state.systemPrompt = this.runtimeContext.system;
    this.agent.state.model = model;
    this.agent.state.thinkingLevel = thinkingLevel;
    this.agent.state.tools = tools;
    this.agent.state.messages = trimAgentMessages(this.agent.state.messages, this.options.retainedMessageLimit ?? 40);
    this.agent.streamFn = streamFn;
    this.agent.getApiKey = this.options.getApiKey;
    this.agent.sessionId = this.sessionId;
    this.agent.toolExecution = this.options.toolExecution ?? "parallel";
    this.agent.beforeToolCall = async (nativeContext) => {
      const toolId = toOriginalToolId(this.nativeToolNames, nativeContext.toolCall.name);
      const capabilityId = findCapabilityId(this.runtimeContext.tools, context, toolId);
      const existingPause = options.getPauseRequest();
      if (existingPause) {
        return {
          block: true,
          reason: `Run is paused waiting for approval ${existingPause.id}.`,
        };
      }
      const decision = await context.beforeToolCall({
        toolId,
        capabilityId,
      });

      if (decision.mode !== "allow") {
        if (decision.mode === "ask") {
          const approvalInput = enrichApprovalInput(toolId, nativeContext.args, context.agent);
          const request = context.agent.approvals.request({
            kind: "tool",
            title: toolId,
            reason: decision.reason,
            toolId,
            capabilityId,
            input: approvalInput,
            resume: { type: "tool", runId: context.runId },
          });
          push([{ type: "approval.requested", runId: context.runId, request }]);
          options.setPauseRequest(request);
          this.agent?.abort();
          return { block: true, reason: `${decision.reason} Approval requested: ${request.id}` };
        }
        return { block: true, reason: decision.reason };
      }
      return undefined;
    };

    return this.agent;
  }

  private createTracingStreamFn(
    input: string,
    context: PiSessionContext,
    push: (events: NativeSessionEvent[]) => void,
  ): StreamFn {
    const delegate = this.options.streamFn ?? streamSimple;
    return async (model, llmContext, options) => {
      push([
        {
          type: "model.requested",
          runId: context.runId,
          request: this.createModelRequestTrace(input, context, model, llmContext),
        },
      ]);
      return delegate(model, llmContext, options);
    };
  }

  private createModelRequestTrace(
    input: string,
    context: PiSessionContext,
    model: Model<any>,
    llmContext: NativeModelContext,
  ): AgentModelRequestTrace {
    return {
      systemPrompt: llmContext.systemPrompt ?? this.runtimeContext.system,
      userInput: input,
      modelId: model.id,
      messages: toModelMessages(llmContext.messages as NativeAgentMessage[]),
      context: context.assembledContext,
      tools: this.runtimeContext.tools.map((tool) => tool.spec),
      skills: this.runtimeContext.skills,
      packs: this.runtimeContext.packs,
      capabilities: this.runtimeContext.capabilities,
    };
  }

  private handleLoopEvent(
    event: NativePiEvent,
    context: PiSessionContext,
    push: (events: NativeSessionEvent[]) => void,
  ) {
    if (event.type === "turn_start" && this.pendingSkillOverlay) {
      this.activeSkillOverlay = this.pendingSkillOverlay;
      this.pendingSkillOverlay = undefined;
      return;
    }

    if (event.type === "turn_end" && this.activeSkillOverlay) {
      const cleared = this.activeSkillOverlay;
      this.activeSkillOverlay = undefined;
      push([{ type: "skill.cleared", runId: context.runId, skillId: cleared.skillId, reason: "skill_turn_complete" }]);
    }
  }

  private async resolveToolPolicy(
    context: PiSessionContext,
    toolId: string,
    capabilityId?: string,
  ) {
    return context.beforeToolCall({ toolId, capabilityId });
  }

  private async executeForkedSkill(
    invocation: InvokedSkillRecord,
    context: PiSessionContext,
  ): Promise<{ forkSessionId: string; text: string }> {
    const forkSessionId = `${this.sessionId}:skill:${invocation.skillName}:${Date.now()}`;
    const forkRunId = `${context.runId}:skill:${Date.now()}`;
    const forkSession = new NativePiSession(
      {
        ...this.runtimeContext,
        sessionId: forkSessionId,
        requestedModelId: invocation.model,
        requestedEffort: invocation.effort,
      },
      this.options,
      forkSessionId,
    );
    const forkWorkingState = new WorkingStateStore();
    forkWorkingState.restore({
      ...context.agent.workingState.get(),
      sessionId: forkSessionId,
      activePackId: invocation.packId,
      activeSkillId: invocation.skillId,
      expandedSkillIds: [invocation.skillId],
      invokedSkills: [invocation],
    });
    let text = "";

    for await (const event of forkSession.run(invocation.content, {
      runId: forkRunId,
      agent: {
        ...context.agent,
        sessionId: forkSessionId,
        workingState: forkWorkingState,
      },
      tools: context.tools,
      skills: context.skills,
      packs: context.packs,
      capabilities: context.capabilities,
      assembledContext: undefined,
      beforeToolCall: async (gate) => context.beforeToolCall(gate),
    })) {
      if (event.type === "assistant.delta") {
        text += event.text;
      }
    }

    return {
      forkSessionId,
      text,
    };
  }
}

type NativeSessionEvent =
  | Extract<AgentEvent, { type: "model.requested" }>
  | { type: "assistant.delta"; runId: string; text: string }
  | Extract<AgentEvent, { type: "skill.invoked" | "skill.loaded" | "skill.forked" | "skill.cleared" }>
  | { type: "tool.started"; runId: string; toolId: string; input: JsonValue }
  | { type: "tool.finished"; runId: string; toolId: string; result: ToolResult }
  | { type: "approval.requested"; runId: string; request: ApprovalRequest }
  | { type: "error"; runId: string; message: string };

function toNativeTools(
  tools: ToolDefinition[],
  context: PiSessionContext,
  nativeToolNames: Map<string, string>,
  hooks: {
    onSkillInvoked(invocation: InvokedSkillRecord): void;
    onSkillCleared(reason: string): void;
    runForkedSkill(invocation: InvokedSkillRecord): Promise<{ forkSessionId: string; text: string }>;
    resolveToolPolicy(toolId: string, capabilityId?: string): Promise<{ mode: "allow" | "ask" | "deny"; reason: string }>;
  },
): AgentTool[] {
  return tools.map((tool): AgentTool => {
    const capabilityId = findCapabilityId(tools, context, tool.spec.id);

    return {
      name: toNativeToolName(nativeToolNames, tool.spec.id),
      label: tool.spec.title,
      description: tool.spec.description,
      parameters: tool.spec.input.schema as unknown as TSchema,
      async execute(_toolCallId, params) {
        const policy = await hooks.resolveToolPolicy(tool.spec.id, capabilityId);
        if (policy.mode !== "allow") {
          throw new Error(policy.reason);
        }

        const result = await tool.execute(params as JsonObject, {
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

        if (!result.ok) {
          throw new Error(result.error ?? "Tool failed");
        }

        if (tool.spec.id === "skill.invoke") {
          const invocation = readInvokedSkillFromWorkingState(
            context.agent.workingState.get().invokedSkills,
            params,
          );
          if (invocation) {
            hooks.onSkillInvoked(invocation);
            if (invocation.context === "fork") {
              const forked = await hooks.runForkedSkill(invocation);
              return {
                content: [{ type: "text", text: forked.text || `Forked skill /${invocation.skillName} completed.` }],
                details: {
                  ...(isJsonObject(result.value) ? result.value : {}),
                  forkSessionId: forked.forkSessionId,
                  forkedResult: forked.text,
                },
              };
            }

            return {
              content: [{ type: "text", text: `Loaded skill /${invocation.skillName}. Continue using the injected skill instructions.` }],
              details: result.value,
            };
          }
        }

        return {
          content: [{ type: "text", text: stringifyToolResult(result) }],
          details: result,
        };
      },
    };
  });
}

function mapNativeEvent(
  event: NativePiEvent,
  runId: string,
  nativeToolNames: Map<string, string>,
): NativeSessionEvent[] {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return [{ type: "assistant.delta", runId, text: event.assistantMessageEvent.delta }];
      }
      return [];
    case "tool_execution_start":
      return [
        {
          type: "tool.started",
          runId,
          toolId: toOriginalToolId(nativeToolNames, event.toolName),
          input: asJsonValue(event.args),
        },
      ];
    case "tool_execution_end":
      return [
        {
          type: "tool.finished",
          runId,
          toolId: toOriginalToolId(nativeToolNames, event.toolName),
          result: normalizeNativeToolResult(event.result, event.isError),
        },
      ];
    default:
      return [];
  }
}

function createNativeToolNameMap(tools: ToolDefinition[]): Map<string, string> {
  return new Map(tools.map((tool, index) => [toSafeNativeToolName(tool.spec.id, index), tool.spec.id]));
}

function toNativeToolName(nativeToolNames: Map<string, string>, toolId: string): string {
  for (const [nativeName, originalId] of nativeToolNames) {
    if (originalId === toolId) {
      return nativeName;
    }
  }
  return toolId.replace(/[^A-Za-z0-9_-]/g, "_");
}

function toSafeNativeToolName(toolId: string, index: number): string {
  const prefix = `opengrove_${index}_`;
  const slug = toolId.replace(/[^A-Za-z0-9_-]/g, "_") || "tool";
  return `${prefix}${slug}`.slice(0, 64);
}

function toOriginalToolId(nativeToolNames: Map<string, string>, nativeName: string): string {
  return nativeToolNames.get(nativeName) ?? nativeName;
}

function readAssistantText(message: { content?: unknown }): string {
  const content = message.content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) =>
      item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item
        ? String(item.text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("");
}

function normalizeNativeToolResult(result: unknown, isError: boolean): ToolResult {
  const value = asJsonValue(readDetails(result) ?? result);
  return {
    ok: !isError,
    value,
    error: isError ? readTextContent(result) || "Tool failed" : undefined,
  };
}

function enrichApprovalInput(_toolId: string, args: unknown, _agent: AgentContext): JsonValue {
  const input = asJsonObject(args);
  return input;
}

function findCapabilityId(
  tools: ToolDefinition[],
  context: PiSessionContext,
  toolId: string,
): string | undefined {
  const tool = tools.find((candidate) => candidate.spec.id === toolId);
  return context.capabilities.find((capability) =>
    capability.tools.some((candidate) => candidate.id === tool?.spec.id),
  )?.id;
}

function stringifyToolResult(result: ToolResult): string {
  if (typeof result.value === "string") {
    return result.value;
  }
  return JSON.stringify(result.value ?? { ok: result.ok, error: result.error });
}

function readDetails(result: unknown): unknown {
  return result && typeof result === "object" && "details" in result
    ? (result as { details?: unknown }).details
    : undefined;
}

function readTextContent(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return "";
  }

  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

function resolveModel(
  model: Model<any> | ((requestedModelId?: string) => Model<any>),
  requestedModelId?: string,
): Model<any> {
  return typeof model === "function" ? model(requestedModelId) : model;
}

function resolveThinkingLevel(
  thinkingLevel: ThinkingLevel | ((requestedEffort?: string) => ThinkingLevel) | undefined,
  requestedEffort?: string,
): ThinkingLevel {
  if (typeof thinkingLevel === "function") {
    return thinkingLevel(requestedEffort);
  }
  return thinkingLevel ?? "off";
}

function trimAgentMessages(messages: NativeAgentMessage[], limit: number): NativeAgentMessage[] {
  if (!Number.isFinite(limit) || limit <= 0 || messages.length <= limit) {
    return messages;
  }
  return messages.slice(-limit);
}

function toModelMessages(messages: NativeAgentMessage[]): ModelMessage[] {
  return messages
    .map((message) => toModelMessage(message))
    .filter((message): message is ModelMessage => Boolean(message));
}

function toModelMessage(message: NativeAgentMessage): ModelMessage | undefined {
  const role = readMessageRole(message);
  if (role === "user") {
    return {
      role: "user",
      content: stringifyMessageContent((message as { content?: unknown }).content),
    };
  }

  if (role === "assistant") {
    return {
      role: "assistant",
      content: stringifyMessageContent((message as { content?: unknown }).content),
    };
  }

  if (role === "toolResult") {
    return {
      role: "tool",
      name: readMessageToolName(message),
      content: stringifyMessageContent((message as { content?: unknown }).content),
    };
  }

  return undefined;
}

function readMessageRole(message: NativeAgentMessage): string {
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role : "";
}

function readMessageToolName(message: NativeAgentMessage): string | undefined {
  const name = (message as { toolName?: unknown }).toolName;
  return typeof name === "string" ? name : undefined;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return content === undefined ? "" : safeJson(content);
  }

  return content
    .map((part) => stringifyContentPart(part))
    .filter(Boolean)
    .join("\n");
}

function stringifyContentPart(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }

  if (!part || typeof part !== "object") {
    return part === undefined ? "" : String(part);
  }

  if ("text" in part && typeof part.text === "string") {
    return part.text;
  }

  return safeJson(part);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function createSkillSteeringMessage(invocation: InvokedSkillRecord): UserMessage {
  return {
    role: "user",
    content: [{ type: "text", text: buildSkillSteeringText(invocation) }],
    timestamp: Date.now(),
  };
}

function createContextSteeringMessage(context: ContextEnvelope): UserMessage {
  return {
    role: "user",
    content: [{ type: "text", text: context.promptBlock }],
    timestamp: Date.now(),
  };
}

function readInvokedSkillFromWorkingState(
  invokedSkills: InvokedSkillRecord[],
  params: unknown,
): InvokedSkillRecord | undefined {
  const requestedSkill =
    params && typeof params === "object" && "skill" in params && typeof params.skill === "string"
      ? params.skill.trim().replace(/^\//, "").replace(/^skill\./, "")
      : "";
  return invokedSkills.find(
    (item) =>
      item.skillName === requestedSkill ||
      item.skillId === requestedSkill ||
      item.skillId === `skill.${requestedSkill}`,
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
