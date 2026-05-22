import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  query as claudeQuery,
  type EffortLevel,
  type Options as ClaudeAgentSdkOptions,
  type PermissionMode as ClaudePermissionMode,
  type Query as ClaudeAgentQuery,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { APP_PRODUCT_NAME } from "../identity.js";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
  JsonObject,
  JsonValue,
  RuntimeAccessMode,
  ToolResult,
} from "../core.js";
import { AsyncEventQueue } from "./codex/async-event-queue.js";
import { asJsonValue, isJsonObject, readString } from "./codex/json.js";
import {
  createClaudeSdkHostBridge,
  type ClaudeSdkHostBridge,
} from "./claude-agent-sdk-tools.js";
import type { ClaudeCodeRuntimeOptions } from "./claude-code-runtime.js";
import {
  applyProviderHttpCaptureEnv,
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ResolvedProviderHttpCaptureOptions,
} from "./provider-http-capture.js";
import { runWithNativeSessionLock } from "./native-session-lock.js";

export type ClaudeAgentSdkQueryFunction = (params: {
  prompt: string;
  options?: ClaudeAgentSdkOptions;
}) => ClaudeAgentQuery;

export interface ClaudeAgentSdkRuntimeOptions extends Omit<ClaudeCodeRuntimeOptions, "cliPath"> {
  cliPath?: string;
  query?: ClaudeAgentSdkQueryFunction;
}

interface ClaudeSdkMessageState {
  assistantText: string;
  resultText: string;
  resultIsError: boolean;
  stderrText: string;
  sawPartialText: boolean;
  compactionActive: boolean;
  toolCalls: Map<string, { toolId: string; input: JsonValue }>;
}

export class ClaudeAgentSdkRuntime implements AgentRuntime {
  constructor(private readonly options: ClaudeAgentSdkRuntimeOptions) {}

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const queue = new AsyncEventQueue<AgentEvent>();
    const abortController = new AbortController();
    const forwardAbort = () => abortController.abort(request.signal?.reason);
    if (request.signal) {
      if (request.signal.aborted) {
        abortController.abort(request.signal.reason);
      } else {
        request.signal.addEventListener("abort", forwardAbort, { once: true });
      }
    }

    const producer = this.produceTurn(request, queue, abortController)
      .then(() => queue.close())
      .catch((error) => queue.fail(error));

    try {
      for await (const event of queue) {
        yield event;
      }
      await producer;
    } finally {
      request.signal?.removeEventListener("abort", forwardAbort);
      abortController.abort();
    }
  }

  private async produceTurn(
    request: AgentTurnRequest,
    queue: AsyncEventQueue<AgentEvent>,
    abortController: AbortController,
  ): Promise<void> {
    const runId = request.runId ?? `run_${Date.now()}`;
    const requestedModel =
      resolveClaudeRuntimeModel(
        request.requestedModelId,
        this.options.configuredModel,
        this.options.modelAliases,
      );
    const cwd = this.options.cwd ?? process.cwd();
    const permissionMode = resolveClaudePermissionMode(request.accessMode, this.options.permissionMode);
    const runtimeEnv = mergeRuntimeEnv(this.options.env, request.runtimeEnv);
    const runtimeBindingFingerprint = claudeRuntimeBindingFingerprint({
      base: this.options.runtimeBindingFingerprint,
      cwd,
    });
    const nativeSession = resolveClaudeNativeSession(request, runtimeBindingFingerprint, {
      configDir: this.options.env?.CLAUDE_CONFIG_DIR,
      cwd,
    });
    rememberClaudeNativeSession(request, nativeSession.sessionId, runtimeBindingFingerprint);
    const systemPrompt = buildClaudeSdkSystemPrompt(request);
    const providerCapture = resolveProviderHttpCaptureOptions(
      this.options.providerHttpCapture,
      runtimeEnv,
    );
    const hostBridge = createClaudeSdkHostBridge(request, runId, queue);
    const sessionTrace: AgentSessionTrace = {
      provider: "claude-code",
      sessionId: nativeSession.sessionId,
      persistent: true,
      priorMessageCount: nativeSession.resuming ? 1 : 0,
      priorMessages: [],
    };

    queue.push({ type: "turn.started", runId, at: new Date().toISOString() });
    if (request.assembledContext) {
      queue.push({ type: "context.assembled", runId, context: request.assembledContext });
    }
    queue.push({
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: "provider_http_capture.configured",
      data: providerHttpCaptureSummary(providerCapture),
    });
    queue.push({
      type: "model.requested",
      runId,
      request: {
        systemPrompt,
        userInput: request.input,
        modelId: requestedModel,
        session: sessionTrace,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills: request.skills ?? [],
        packs: request.packs ?? [],
        capabilities: request.capabilities ?? [],
      },
    });

    const messageState: ClaudeSdkMessageState = {
      assistantText: "",
      resultText: "",
      resultIsError: false,
      stderrText: "",
      sawPartialText: false,
      compactionActive: false,
      toolCalls: new Map(),
    };
    try {
      await runWithNativeSessionLock("claude-code", nativeSession.sessionId, async () => {
        const query = (this.options.query ?? claudeQuery)({
          prompt: request.input,
          options: this.createQueryOptions({
            request,
            cwd,
            requestedModel,
            permissionMode,
            nativeSession,
            systemPrompt,
            providerCapture,
            runtimeEnv,
            hostBridge,
            abortController,
            onStderr: (chunk) => {
              messageState.stderrText = limitDiagnosticText(messageState.stderrText + chunk);
            },
          }),
        });

        try {
          for await (const message of query) {
            for (const event of mapClaudeSdkMessage(message, {
              runId,
              state: messageState,
              hostBridge,
              onInit: (init) => {
                rememberClaudeNativeSession(request, init.session_id, runtimeBindingFingerprint);
                recordClaudeRuntimeInventory(request, init);
              },
            })) {
              queue.push(event);
            }
          }
        } finally {
          query.close();
        }
      });
    } catch (error) {
      queue.push({
        type: "error",
        runId,
        message: claudeSdkProcessErrorMessage(error, messageState.stderrText),
      });
      queue.push({ type: "turn.finished", runId, at: new Date().toISOString() });
      return;
    }

    const finalText = messageState.resultText || messageState.assistantText;
    if (messageState.compactionActive) {
      queue.push({
        type: "compaction.finished",
        runId,
        at: new Date().toISOString(),
        summary: "Claude Code compaction finished.",
      });
    }
    if (messageState.resultIsError) {
      queue.push({
        type: "error",
        runId,
        message: finalText || "claude_agent_sdk_failed",
      });
    } else {
      queue.push({ type: "model.response", runId, response: { text: finalText } });
    }
    queue.push({ type: "turn.finished", runId, at: new Date().toISOString() });
  }

  private createQueryOptions(input: {
    request: AgentTurnRequest;
    cwd: string;
    requestedModel?: string;
    permissionMode: ClaudePermissionMode;
    nativeSession: { sessionId: string; resuming: boolean };
    systemPrompt: string;
    providerCapture: ResolvedProviderHttpCaptureOptions;
    runtimeEnv: NodeJS.ProcessEnv | undefined;
    hostBridge: ClaudeSdkHostBridge;
    abortController: AbortController;
    onStderr(data: string): void;
  }): ClaudeAgentSdkOptions {
    const options: ClaudeAgentSdkOptions = {
      abortController: input.abortController,
      cwd: input.cwd,
      env: this.prepareEnv(input.requestedModel, input.providerCapture, input.runtimeEnv),
      includePartialMessages: true,
      includeHookEvents: true,
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: input.systemPrompt,
      },
      tools: { type: "preset", preset: "claude_code" },
      mcpServers: input.hostBridge.mcpServers,
      canUseTool: input.hostBridge.canUseTool,
      onElicitation: input.hostBridge.onElicitation,
      permissionMode: input.permissionMode,
      skills: input.request.requestedSkillInvocation?.skillName
        ? [input.request.requestedSkillInvocation.skillName]
        : "all",
      model: input.requestedModel,
      effort: normalizeClaudeEffort(input.request.requestedEffort),
      pathToClaudeCodeExecutable: this.options.cliPath,
      stderr: input.onStderr,
      ...(input.nativeSession.resuming
        ? { resume: input.nativeSession.sessionId }
        : { sessionId: input.nativeSession.sessionId }),
    };
    if (input.permissionMode === "bypassPermissions") {
      options.allowDangerouslySkipPermissions = true;
    }
    return options;
  }

  private prepareEnv(
    requestedModel: string | undefined,
    providerCapture: ResolvedProviderHttpCaptureOptions,
    runtimeEnv: NodeJS.ProcessEnv | undefined,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...runtimeEnv,
      CLAUDE_AGENT_SDK_CLIENT_APP: `${APP_PRODUCT_NAME}/0.0.0`,
    };
    const configuredBaseUrl = this.options.configuredBaseUrl?.trim();
    const configuredAuthToken = this.options.configuredAuthToken?.trim();
    const configuredModel = normalizeClaudeModelId(requestedModel ?? this.options.configuredModel);
    if (configuredBaseUrl) {
      env.ANTHROPIC_BASE_URL = configuredBaseUrl;
    }
    if (configuredAuthToken) {
      env.ANTHROPIC_AUTH_TOKEN = configuredAuthToken;
    }
    if (configuredModel && !isClaudeFamilyAlias(configuredModel)) {
      env.ANTHROPIC_MODEL = configuredModel;
    }
    return applyProviderHttpCaptureEnv(env, providerCapture);
  }
}

function mergeRuntimeEnv(
  base: NodeJS.ProcessEnv | undefined,
  override: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv | undefined {
  const merged = { ...(base ?? {}), ...(override ?? {}) };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  return Object.keys(merged).length ? merged : undefined;
}

function mapClaudeSdkMessage(
  message: SDKMessage,
  context: {
    runId: string;
    state: ClaudeSdkMessageState;
    hostBridge: ClaudeSdkHostBridge;
    onInit(init: Extract<SDKMessage, { type: "system"; subtype: "init" }>): void;
  },
): AgentEvent[] {
  if (message.type === "system" && message.subtype === "init") {
    context.onInit(message);
    return [{
      type: "runtime.diagnostic",
      runId: context.runId,
      at: new Date().toISOString(),
      name: "claude.sdk.init",
      data: {
        sessionId: message.session_id,
        claudeCodeVersion: message.claude_code_version,
        model: message.model,
        permissionMode: message.permissionMode,
        slashCommands: message.slash_commands,
        skills: message.skills,
        tools: message.tools,
        mcpServers: message.mcp_servers.map((server) => ({
          name: server.name,
          status: server.status,
        })),
      },
    }];
  }

  if (message.type === "stream_event") {
    const text = readStreamTextDelta(message.event);
    if (!text) {
      return [];
    }
    context.state.sawPartialText = true;
    context.state.assistantText += text;
    return [{ type: "assistant.delta", runId: context.runId, text }];
  }

  if (message.type === "assistant") {
    return mapAssistantMessage(message.message, context);
  }

  if (message.type === "user") {
    return mapUserMessage(message.message, message.tool_use_result, context);
  }

  if (message.type === "result") {
    if (message.subtype === "success") {
      context.state.resultText = message.result || context.state.assistantText;
      context.state.resultIsError = message.is_error === true;
    } else {
      context.state.resultText = message.errors.join("; ");
      context.state.resultIsError = true;
    }
    return [{
      type: "runtime.diagnostic",
      runId: context.runId,
      at: new Date().toISOString(),
      name: "claude.sdk.result",
      data: {
        subtype: message.subtype,
        durationMs: message.duration_ms,
        durationApiMs: message.duration_api_ms,
        turns: message.num_turns,
        totalCostUsd: message.total_cost_usd,
        stopReason: message.stop_reason ?? "",
        terminalReason: message.terminal_reason ?? "",
      },
    }];
  }

  if (message.type === "system" && message.subtype === "status") {
    if (message.status === "compacting" && !context.state.compactionActive) {
      context.state.compactionActive = true;
      return [{
        type: "compaction.started",
        runId: context.runId,
        at: new Date().toISOString(),
        reason: "Claude Code compacting",
      }];
    }
    if (!message.status && context.state.compactionActive) {
      context.state.compactionActive = false;
      return [{
        type: "compaction.finished",
        runId: context.runId,
        at: new Date().toISOString(),
        summary: message.compact_error || message.compact_result || "Claude Code compaction finished.",
      }];
    }
  }

  if (message.type === "system" && message.subtype === "compact_boundary") {
    if (context.state.compactionActive) {
      context.state.compactionActive = false;
      return [{
        type: "compaction.finished",
        runId: context.runId,
        at: new Date().toISOString(),
        summary: "Claude Code compact boundary recorded.",
        item: asJsonValue(message.compact_metadata),
      }];
    }
    return [];
  }

  if (message.type === "system" && (
    message.subtype === "hook_started" ||
    message.subtype === "hook_progress" ||
    message.subtype === "hook_response" ||
    message.subtype === "api_retry" ||
    message.subtype === "plugin_install"
  )) {
    return [{
      type: "runtime.diagnostic",
      runId: context.runId,
      at: new Date().toISOString(),
      name: `claude.sdk.${message.subtype}`,
      data: asJsonValue(message) as JsonObject,
    }];
  }

  if (message.type === "auth_status") {
    return [{
      type: "runtime.diagnostic",
      runId: context.runId,
      at: new Date().toISOString(),
      name: "claude.sdk.auth_status",
      data: asJsonValue(message) as JsonObject,
    }];
  }

  return [];
}

function mapAssistantMessage(
  message: { content: unknown },
  context: {
    runId: string;
    state: ClaudeSdkMessageState;
    hostBridge: ClaudeSdkHostBridge;
  },
): AgentEvent[] {
  const content = Array.isArray(message.content) ? message.content : [];
  const events: AgentEvent[] = [];
  for (const block of content) {
    if (!isJsonObject(block)) {
      continue;
    }
    if (block.type === "text" && typeof block.text === "string" && block.text && !context.state.sawPartialText) {
      context.state.assistantText += block.text;
      events.push({ type: "assistant.delta", runId: context.runId, text: block.text });
    }
    if (block.type === "tool_use") {
      const callId = readString(block, "id") ?? "";
      const toolName = readString(block, "name") ?? "Tool";
      if (context.hostBridge.isOpenGroveMcpToolName(toolName)) {
        continue;
      }
      const toolId = `claude.${toolName}`;
      const input = asJsonValue(block.input);
      if (callId) {
        context.state.toolCalls.set(callId, { toolId, input });
      }
      events.push({ type: "tool.started", runId: context.runId, toolId, input });
    }
  }
  return events;
}

function mapUserMessage(
  message: { content?: unknown },
  toolUseResult: unknown,
  context: {
    runId: string;
    state: ClaudeSdkMessageState;
    hostBridge: ClaudeSdkHostBridge;
  },
): AgentEvent[] {
  const content = Array.isArray(message.content) ? message.content : [];
  const events: AgentEvent[] = [];
  for (const block of content) {
    if (!isJsonObject(block) || block.type !== "tool_result") {
      continue;
    }
    const callId = readString(block, "tool_use_id") ?? "";
    const call = context.state.toolCalls.get(callId);
    if (call && context.hostBridge.isOpenGroveMcpToolName(call.toolId)) {
      continue;
    }
    events.push({
      type: "tool.finished",
      runId: context.runId,
      toolId: call?.toolId ?? "claude.tool",
      result: normalizeClaudeToolResult(block, toolUseResult),
    });
  }
  return events;
}

function normalizeClaudeToolResult(block: JsonObject, toolUseResult: unknown): ToolResult {
  const isError = block.is_error === true;
  const rawValue = toolUseResult ?? block.content;
  const value = asJsonValue(rawValue);
  if (isError) {
    return {
      ok: false,
      error:
        typeof value === "string"
          ? value
          : isJsonObject(value) && typeof value.text === "string"
            ? value.text
            : "claude_tool_error",
      value: value === null ? undefined : value,
    };
  }
  return { ok: true, value: value === null ? undefined : value };
}

function readStreamTextDelta(event: unknown): string | undefined {
  if (!isJsonObject(event) || event.type !== "content_block_delta") {
    return undefined;
  }
  const delta = isJsonObject(event.delta) ? event.delta : undefined;
  return delta?.type === "text_delta" && typeof delta.text === "string" ? delta.text : undefined;
}

function buildClaudeSdkSystemPrompt(request: AgentTurnRequest): string {
  const sections = [
    `You are running inside the ${APP_PRODUCT_NAME} host.`,
    "Use Claude Code's native tools, slash commands, skills, hooks, MCP, permissions, and compaction behavior normally.",
    "OpenGrove host tools are exposed through the opengrove MCP server when you need app/browser/computer/skill bridge capabilities.",
    request.assembledContext?.promptBlock?.trim()
      ? `OpenGrove host context:\n${request.assembledContext.promptBlock.trim()}`
      : "",
    request.requestedSkillInvocation
      ? [
          `The user explicitly selected the Claude-compatible skill "${request.requestedSkillInvocation.skillName}" for this turn.`,
          request.requestedSkillInvocation.args
            ? `Use it for this task. User skill arguments:\n${request.requestedSkillInvocation.args}`
            : "Use it for this task.",
        ].join("\n")
      : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

function resolveClaudeNativeSession(
  request: AgentTurnRequest,
  runtimeBindingFingerprint: string | undefined,
  options: { cwd: string; configDir?: string | undefined },
): { sessionId: string; resuming: boolean } {
  const current = request.context.sessions.get(request.context.sessionId);
  const fingerprint = runtimeBindingFingerprint || "native";
  const sessionByFingerprint = current?.metadata?.claudeCodeSessionIds;
  if (sessionByFingerprint && typeof sessionByFingerprint === "object" && !Array.isArray(sessionByFingerprint)) {
    const sessionId = (sessionByFingerprint as Record<string, unknown>)[fingerprint];
    if (typeof sessionId === "string" && sessionId.trim()) {
      return { sessionId, resuming: true };
    }
  }
  const metadataSession = typeof current?.metadata?.claudeCodeSessionId === "string"
    ? current.metadata.claudeCodeSessionId
    : undefined;
  const stableSessionId = metadataSession && fingerprint === "native"
    ? metadataSession
    : toStableClaudeSessionId(`${request.context.sessionId}:${fingerprint}`);
  return {
    sessionId: stableSessionId,
    resuming: Boolean(metadataSession && fingerprint === "native") ||
      claudeNativeTranscriptExists(stableSessionId, options),
  };
}

function rememberClaudeNativeSession(
  request: AgentTurnRequest,
  nativeSessionId: string,
  runtimeBindingFingerprint: string | undefined,
): void {
  const current = request.context.sessions.get(request.context.sessionId);
  const fingerprint = runtimeBindingFingerprint || "native";
  const metadata: JsonObject = {
    ...(current?.metadata ?? {}),
    claudeCodeSessionIds: {
      ...readObject(current?.metadata?.claudeCodeSessionIds),
      [fingerprint]: nativeSessionId,
    },
  };
  if (fingerprint === "native") {
    metadata.claudeCodeSessionId = nativeSessionId;
    metadata.claudeCodeSessionUpdatedAt = new Date().toISOString();
  }
  request.context.sessions.ensureSession({
    id: request.context.sessionId,
    activity: request.context.activity,
    metadata,
  });
}

function recordClaudeRuntimeInventory(
  request: AgentTurnRequest,
  init: Extract<SDKMessage, { type: "system"; subtype: "init" }>,
): void {
  const current = request.context.workingState.get();
  request.context.workingState.update({
    selectedModel: init.model || current.selectedModel,
    toolSchemaCache: {
      ...current.toolSchemaCache,
      "claude.slashCommands": JSON.stringify(init.slash_commands),
      "claude.skills": JSON.stringify(init.skills),
      "claude.tools": JSON.stringify(init.tools),
      "claude.mcpServers": JSON.stringify(init.mcp_servers.map((server) => ({
        name: server.name,
        status: server.status,
      }))),
      "claude.version": init.claude_code_version,
    },
  });
}

function claudeNativeTranscriptExists(
  sessionId: string,
  options: { cwd: string; configDir?: string | undefined },
): boolean {
  const configDir = options.configDir?.trim() || process.env.CLAUDE_CONFIG_DIR?.trim() || resolve(homedir(), ".claude");
  const projectsDir = join(configDir, "projects");
  const projectPath = join(projectsDir, claudeProjectKey(options.cwd), `${sessionId}.jsonl`);
  if (existsSync(projectPath)) {
    return true;
  }

  try {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(projectsDir, entry.name, `${sessionId}.jsonl`))) {
        return true;
      }
    }
  } catch {
    // Missing or unreadable native transcript directories should not block a fresh session.
  }
  return false;
}

function claudeProjectKey(cwd: string): string {
  return resolve(cwd || process.cwd())
    .normalize("NFC")
    .replace(/[^A-Za-z0-9._-]/g, "-");
}

function claudeSdkProcessErrorMessage(error: unknown, stderrText: string): string {
  const base = error instanceof Error ? error.message : String(error || "claude_agent_sdk_failed");
  const stderr = sanitizeDiagnosticText(stderrText).trim();
  if (!stderr) {
    return base || "claude_agent_sdk_failed";
  }
  return base.includes(stderr) ? base : `${base}: ${stderr}`;
}

function limitDiagnosticText(value: string): string {
  const limit = 4_000;
  return value.length > limit ? value.slice(value.length - limit) : value;
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/(AWS_BEARER_TOKEN_BEDROCK|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|authorization|api[_-]?key|token|secret|bearer)([=:\s"]+)[^\s"]+/gi, "$1$2<redacted>")
    .replace(/(sk|ark|ABSK)[A-Za-z0-9_.=+/-]{12,}/g, "<redacted>");
}

function resolveClaudePermissionMode(
  accessMode: RuntimeAccessMode | undefined,
  configured: ClaudeAgentSdkRuntimeOptions["permissionMode"],
): ClaudePermissionMode {
  switch (accessMode) {
    case "default":
      return "default";
    case "auto-review":
      return "acceptEdits";
    case "full-access":
      return "bypassPermissions";
    default:
      return configured ?? "bypassPermissions";
  }
}

function normalizeClaudeEffort(value: string | undefined): EffortLevel | undefined {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
    ? value
    : undefined;
}

function normalizeClaudeModelId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.toLowerCase();
  if (
    normalized === "mimo-v2-pro" ||
    normalized === "claude-code-default" ||
    normalized === "claude-opus-4-6" ||
    normalized === "claude-sonnet-4-6" ||
    normalized.startsWith("gpt-")
  ) {
    return undefined;
  }
  return trimmed;
}

function resolveClaudeRuntimeModel(
  requestedModel: string | undefined,
  configuredModel: string | undefined,
  aliases: Record<string, string> | undefined,
): string | undefined {
  return (
    normalizeClaudeModelId(resolveModelAlias(requestedModel, aliases)) ??
    normalizeClaudeModelId(resolveModelAlias(configuredModel, aliases))
  );
}

function resolveModelAlias(
  value: string | undefined,
  aliases: Record<string, string> | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const direct = aliases?.[trimmed]?.trim();
  if (direct) return direct;
  const normalized = trimmed.toLowerCase();
  const insensitive = Object.entries(aliases ?? {})
    .find(([key]) => key.toLowerCase() === normalized)?.[1]
    ?.trim();
  return insensitive || trimmed;
}

function isClaudeFamilyAlias(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\[1m\]$/, "");
  return normalized === "opus" || normalized === "sonnet" || normalized === "haiku";
}

function claudeRuntimeBindingFingerprint(input: {
  base?: string;
  cwd: string;
}): string {
  return createHash("sha1")
    .update([
      input.base || "native",
      input.cwd,
    ].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function readObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function toStableClaudeSessionId(input: string): string {
  const hash = createHash("sha1").update(input).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}
