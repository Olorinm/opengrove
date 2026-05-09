import { createHash } from "node:crypto";
import {
  createSdkMcpServer,
  tool as sdkTool,
  type CanUseTool,
  type ElicitationRequest,
  type ElicitationResult,
  type McpServerConfig,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  evaluateToolPolicy,
  type AgentEvent,
  type AgentTurnRequest,
  type ApprovalKind,
  type JsonObject,
  type JsonValue,
  type ToolDefinition,
  type ToolResult,
} from "../core.js";
import type { AsyncEventQueue } from "./codex/async-event-queue.js";
import { asJsonValue, isJsonObject, readString, truncateText } from "./codex/json.js";

export const CLAUDE_OPENGROVE_MCP_SERVER = "opengrove";
export const CLAUDE_NATIVE_APPROVAL_TIMEOUT_MS = 120_000;

type ZodSchema = z.ZodType<unknown>;
type ZodShape = Record<string, ZodSchema>;

export interface ClaudeSdkHostBridge {
  mcpServers: Record<string, McpServerConfig>;
  canUseTool: CanUseTool;
  onElicitation(request: ElicitationRequest, options: { signal: AbortSignal }): Promise<ElicitationResult>;
  isOpenGroveMcpToolName(toolName: string): boolean;
  fingerprint: string;
  exposedToolIds: string[];
}

export function createClaudeSdkHostBridge(
  request: AgentTurnRequest,
  runId: string,
  queue: AsyncEventQueue<AgentEvent>,
): ClaudeSdkHostBridge {
  const usedNames = new Set<string>();
  const sdkToolNames = new Set<string>();
  const capabilityByToolId = capabilityMap(request);
  const sdkTools = request.tools.map((definition) => {
    const sdkName = toClaudeSdkToolName(definition.spec.id, usedNames);
    sdkToolNames.add(sdkName);
    return sdkTool(
      sdkName,
      `${definition.spec.title}: ${definition.spec.description}`.trim(),
      jsonSchemaToZodShape(definition.spec.input.schema),
      async (args) => executeHostTool(definition, args, {
        request,
        runId,
        queue,
        capabilityId: capabilityByToolId.get(definition.spec.id),
      }),
      { annotations: toolAnnotations(definition) },
    );
  });
  const mcpServers: Record<string, McpServerConfig> = {
    [CLAUDE_OPENGROVE_MCP_SERVER]: createSdkMcpServer({
      name: CLAUDE_OPENGROVE_MCP_SERVER,
      version: "0.0.0",
      tools: sdkTools,
    }),
  };

  const bridge: ClaudeSdkHostBridge = {
    mcpServers,
    canUseTool: async (toolName, input, options) => {
      if (bridge.isOpenGroveMcpToolName(toolName)) {
        return { behavior: "allow", toolUseID: options.toolUseID };
      }
      return handleClaudeNativeToolPermission(toolName, input, {
        request,
        runId,
        queue,
        signal: options.signal,
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        decisionReason: options.decisionReason,
        blockedPath: options.blockedPath,
        suggestions: options.suggestions,
        toolUseID: options.toolUseID,
        agentID: options.agentID,
      });
    },
    onElicitation: (elicitation, options) => handleClaudeElicitation(elicitation, {
      request,
      runId,
      queue,
      signal: options.signal,
    }),
    isOpenGroveMcpToolName(toolName) {
      const normalized = String(toolName || "");
      return sdkToolNames.has(normalized) ||
        normalized.startsWith(`mcp__${CLAUDE_OPENGROVE_MCP_SERVER}__`) ||
        normalized.startsWith(`${CLAUDE_OPENGROVE_MCP_SERVER}__`);
    },
    fingerprint: fingerprintTools(request.tools),
    exposedToolIds: request.tools.map((tool) => tool.spec.id),
  };
  return bridge;
}

async function executeHostTool(
  definition: ToolDefinition,
  args: unknown,
  context: {
    request: AgentTurnRequest;
    runId: string;
    queue: AsyncEventQueue<AgentEvent>;
    capabilityId?: string;
  },
): Promise<CallToolResult> {
  const input = normalizeToolInput(args, definition.spec.input.schema);
  context.queue.push({
    type: "tool.started",
    runId: context.runId,
    toolId: definition.spec.id,
    input,
  });

  const policy = evaluateToolPolicy(definition.spec, context.request.policy, context.capabilityId);
  if (policy.mode !== "allow") {
    const approved = policy.mode === "ask"
      ? await requestInlineApproval({
          kind: "tool",
          title: definition.spec.title || definition.spec.id,
          reason: policy.reason,
          request: context.request,
          runId: context.runId,
          queue: context.queue,
          toolId: definition.spec.id,
          capabilityId: context.capabilityId,
          input,
        })
      : undefined;
    if (!approved) {
      const result: ToolResult = {
        ok: false,
        error: policy.mode === "deny" ? "permission_denied" : "approval_rejected",
        value: { status: policy.mode, reason: policy.reason },
      };
      context.queue.push({
        type: "tool.finished",
        runId: context.runId,
        toolId: definition.spec.id,
        result,
      });
      return toCallToolResult(result);
    }
  }

  try {
    const result = await definition.execute(input as JsonObject, {
      runId: context.runId,
      capabilityId: context.capabilityId,
      skillId: context.request.requestedSkillInvocation?.skillId,
      memory: context.request.context.memory,
      artifacts: context.request.context.artifacts,
      workingState: context.request.context.workingState,
      approvals: context.request.context.approvals,
      skills: context.request.context.skills,
      packs: context.request.context.packs,
      policy: policy.mode === "allow"
        ? policy
        : { mode: "allow", reason: "Approved by user through the OpenGrove bridge." },
    });
    context.queue.push({
      type: "tool.finished",
      runId: context.runId,
      toolId: definition.spec.id,
      result,
    });
    return toCallToolResult(result);
  } catch (error) {
    const result: ToolResult = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    context.queue.push({
      type: "tool.finished",
      runId: context.runId,
      toolId: definition.spec.id,
      result,
    });
    return toCallToolResult(result);
  }
}

async function handleClaudeNativeToolPermission(
  toolName: string,
  input: Record<string, unknown>,
  context: {
    request: AgentTurnRequest;
    runId: string;
    queue: AsyncEventQueue<AgentEvent>;
    signal: AbortSignal;
    title?: string;
    displayName?: string;
    description?: string;
    decisionReason?: string;
    blockedPath?: string;
    suggestions?: unknown;
    toolUseID: string;
    agentID?: string;
  },
): Promise<PermissionResult> {
  const isQuestion = toolName === "AskUserQuestion";
  const inputValue = asJsonValue(input);
  const approval = context.request.context.approvals.request({
    kind: isQuestion ? "user_input" : approvalKindForClaudeTool(toolName),
    title: context.title || context.displayName || (isQuestion ? "Claude asks for input" : `Claude wants to use ${toolName}`),
    reason: context.decisionReason || context.description || `Claude Code requested ${toolName}.`,
    toolId: `claude.${toolName}`,
    input: {
      toolName,
      toolUseID: context.toolUseID,
      input: inputValue,
      displayName: context.displayName ?? "",
      description: context.description ?? "",
      blockedPath: context.blockedPath ?? "",
      agentID: context.agentID ?? "",
      suggestions: asJsonValue(context.suggestions),
    },
    resume: { type: "claude.native", runId: context.runId },
  });
  context.queue.push({ type: "approval.requested", runId: context.runId, request: approval });

  const decided = await waitForInlineDecision(context.request, approval.id, context.signal);
  context.queue.push({ type: "approval.resolved", runId: context.runId, request: decided });
  if (decided.status !== "approved") {
    return {
      behavior: "deny",
      message: "Rejected by user through OpenGrove.",
      toolUseID: context.toolUseID,
      decisionClassification: "user_reject",
    };
  }

  if (isQuestion) {
    return {
      behavior: "allow",
      toolUseID: context.toolUseID,
      updatedInput: {
        ...input,
        answers: normalizeAskUserQuestionAnswers(decided.response, input),
      },
      decisionClassification: "user_temporary",
    };
  }

  const updatedInput = readUpdatedInput(decided.response);
  return {
    behavior: "allow",
    toolUseID: context.toolUseID,
    ...(updatedInput ? { updatedInput } : {}),
    decisionClassification: "user_temporary",
  };
}

async function handleClaudeElicitation(
  elicitation: ElicitationRequest,
  context: {
    request: AgentTurnRequest;
    runId: string;
    queue: AsyncEventQueue<AgentEvent>;
    signal: AbortSignal;
  },
): Promise<ElicitationResult> {
  const approval = context.request.context.approvals.request({
    kind: "user_input",
    title: elicitation.title || elicitation.displayName || "Claude asks for input",
    reason: elicitation.message || elicitation.description || "Claude Code requested user input.",
    input: asJsonValue({
      serverName: elicitation.serverName,
      message: elicitation.message,
      mode: elicitation.mode,
      url: elicitation.url,
      elicitationId: elicitation.elicitationId,
      requestedSchema: elicitation.requestedSchema,
      displayName: elicitation.displayName,
      description: elicitation.description,
    }),
    resume: { type: "claude.native", runId: context.runId },
  });
  context.queue.push({ type: "approval.requested", runId: context.runId, request: approval });
  const decided = await waitForInlineDecision(context.request, approval.id, context.signal);
  context.queue.push({ type: "approval.resolved", runId: context.runId, request: decided });

  if (decided.status !== "approved") {
    return { action: "decline" };
  }
  return {
    action: "accept",
    content: normalizeElicitationContent(decided.response),
  };
}

async function requestInlineApproval(input: {
  kind: ApprovalKind;
  title: string;
  reason: string;
  request: AgentTurnRequest;
  runId: string;
  queue: AsyncEventQueue<AgentEvent>;
  toolId?: string;
  capabilityId?: string;
  input?: JsonValue;
}): Promise<boolean> {
  const approval = input.request.context.approvals.request({
    kind: input.kind,
    title: input.title,
    reason: input.reason,
    toolId: input.toolId,
    capabilityId: input.capabilityId,
    input: input.input,
    resume: { type: "claude.native", runId: input.runId },
  });
  input.queue.push({ type: "approval.requested", runId: input.runId, request: approval });
  const decided = await waitForInlineDecision(input.request, approval.id);
  input.queue.push({ type: "approval.resolved", runId: input.runId, request: decided });
  return decided.status === "approved";
}

async function waitForInlineDecision(
  request: AgentTurnRequest,
  approvalId: string,
  signal?: AbortSignal,
) {
  try {
    return await request.context.approvals.waitForDecision(approvalId, {
      timeoutMs: CLAUDE_NATIVE_APPROVAL_TIMEOUT_MS,
      signal,
    });
  } catch (error) {
    const current = request.context.approvals.get(approvalId);
    if (current?.status === "pending") {
      return request.context.approvals.decide(approvalId, "rejected", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (current) {
      return current;
    }
    throw error;
  }
}

function jsonSchemaToZodShape(schema: JsonObject): ZodShape {
  const rootType = schema.type;
  if (rootType !== "object" && !isJsonObject(schema.properties)) {
    return { value: jsonSchemaToZod(schema) };
  }

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  const shape: ZodShape = {};
  for (const [key, value] of Object.entries(properties)) {
    const childSchema = isJsonObject(value) ? value : {};
    const child = jsonSchemaToZod(childSchema);
    shape[key] = required.has(key) ? child : child.optional();
  }
  return shape;
}

function jsonSchemaToZod(schema: JsonObject): ZodSchema {
  let parsed: ZodSchema;
  const enumValues = Array.isArray(schema.enum)
    ? schema.enum.filter((item): item is string => typeof item === "string")
    : [];
  if (enumValues.length > 0) {
    parsed = z.enum(enumValues as [string, ...string[]]);
  } else if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    parsed = unionSchema([...(schema.anyOf as JsonValue[] | undefined ?? []), ...(schema.oneOf as JsonValue[] | undefined ?? [])]);
  } else {
    const type = schema.type;
    if (type === "string") {
      parsed = z.string();
    } else if (type === "number") {
      parsed = z.number();
    } else if (type === "integer") {
      parsed = z.number().int();
    } else if (type === "boolean") {
      parsed = z.boolean();
    } else if (type === "array") {
      parsed = z.array(isJsonObject(schema.items) ? jsonSchemaToZod(schema.items) : z.unknown());
    } else if (type === "object" || isJsonObject(schema.properties)) {
      parsed = z.object(jsonSchemaToZodShape(schema)).catchall(schema.additionalProperties === false ? z.never() : z.unknown());
    } else if (type === "null") {
      parsed = z.null();
    } else {
      parsed = z.unknown();
    }
  }

  const description = readString(schema, "description");
  return description ? parsed.describe(description) : parsed;
}

function unionSchema(values: JsonValue[]): ZodSchema {
  const schemas = values.filter(isJsonObject).map(jsonSchemaToZod);
  if (schemas.length === 0) {
    return z.unknown();
  }
  if (schemas.length === 1) {
    return schemas[0];
  }
  return z.union(schemas as [ZodSchema, ZodSchema, ...ZodSchema[]]);
}

function normalizeToolInput(args: unknown, schema: JsonObject): JsonValue {
  const value = asJsonValue(args);
  if (schema.type !== "object" && isJsonObject(value) && "value" in value) {
    return value.value;
  }
  return value;
}

function toCallToolResult(result: ToolResult): CallToolResult {
  const response: CallToolResult = {
    content: [{ type: "text", text: formatToolResult(result) }],
    isError: !result.ok,
  };
  if (isJsonObject(result.value)) {
    response.structuredContent = result.value;
  }
  return response;
}

function formatToolResult(result: ToolResult): string {
  return JSON.stringify(result, null, 2);
}

function toolAnnotations(definition: ToolDefinition): ToolAnnotations {
  const readOnly = definition.spec.risk === "read";
  return {
    title: definition.spec.title,
    readOnlyHint: readOnly,
    destructiveHint: definition.spec.risk === "delete",
    openWorldHint: definition.spec.activity === "browser" || definition.spec.activity === "computer",
  };
}

function capabilityMap(request: AgentTurnRequest): Map<string, string> {
  const output = new Map<string, string>();
  for (const capability of request.capabilities ?? []) {
    for (const tool of capability.tools) {
      output.set(tool.id, capability.id);
    }
  }
  return output;
}

function toClaudeSdkToolName(toolId: string, usedNames: Set<string>): string {
  const raw = `opengrove_${toolId}`.replace(/[^A-Za-z0-9._-]/g, "_");
  const base = /^[A-Za-z]/.test(raw) ? raw : `opengrove_${raw}`;
  let candidate = base.slice(0, 120);
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base.slice(0, 112)}_${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function fingerprintTools(tools: ToolDefinition[]): string {
  return createHash("sha256")
    .update(JSON.stringify(tools.map((item) => ({
      id: item.spec.id,
      schema: item.spec.input.schema,
      risk: item.spec.risk,
      permission: item.spec.permission,
    }))))
    .digest("hex");
}

function approvalKindForClaudeTool(toolName: string): ApprovalKind {
  if (toolName === "Bash") return "command";
  if (["Edit", "MultiEdit", "Write", "NotebookEdit"].includes(toolName)) return "file_change";
  if (["WebFetch", "WebSearch"].includes(toolName)) return "browser_action";
  return "permission_scope";
}

function normalizeAskUserQuestionAnswers(
  response: JsonValue | undefined,
  input: Record<string, unknown>,
): Record<string, string> {
  const object = isJsonObject(response) ? response : undefined;
  if (isJsonObject(object?.answers)) {
    return stringRecord(object.answers);
  }
  const text = typeof response === "string"
    ? response.trim()
    : readString(object ?? {}, "text") ?? readString(object ?? {}, "answer") ?? "";
  const firstKey = readFirstQuestionKey(input);
  return text ? { [firstKey]: text } : {};
}

function normalizeElicitationContent(response: JsonValue | undefined): Record<string, string | number | boolean | string[]> {
  const object = isJsonObject(response) ? response : undefined;
  if (isJsonObject(object?.content)) {
    return scalarRecord(object.content);
  }
  if (isJsonObject(object?.answers)) {
    return stringRecord(object.answers);
  }
  const text = typeof response === "string"
    ? response.trim()
    : readString(object ?? {}, "text") ?? readString(object ?? {}, "answer") ?? "";
  return text ? { answer: text, text } : {};
}

function readUpdatedInput(response: JsonValue | undefined): Record<string, unknown> | undefined {
  const object = isJsonObject(response) ? response : undefined;
  return isJsonObject(object?.updatedInput) ? object.updatedInput : undefined;
}

function stringRecord(input: JsonObject): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value.filter((item): item is string => typeof item === "string").join(", ");
    } else if (isJsonObject(value)) {
      output[key] = readString(value, "text") ?? readString(value, "answer") ?? truncateText(JSON.stringify(value), 500);
    }
  }
  return output;
}

function scalarRecord(input: JsonObject): Record<string, string | number | boolean | string[]> {
  const output: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    } else if (Array.isArray(value)) {
      output[key] = value.filter((item): item is string => typeof item === "string");
    } else if (isJsonObject(value)) {
      output[key] = readString(value, "text") ?? readString(value, "answer") ?? truncateText(JSON.stringify(value), 500);
    }
  }
  return output;
}

function readFirstQuestionKey(input: Record<string, unknown>): string {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const first = questions.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
  const explicit = typeof first?.id === "string"
    ? first.id
    : typeof first?.header === "string"
      ? first.header
      : typeof first?.question === "string"
        ? first.question
        : undefined;
  return explicit || "answer";
}
