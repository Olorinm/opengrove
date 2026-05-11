import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
  ApprovalRequest,
  JsonObject,
  JsonValue,
  ToolDefinition,
  ToolResult,
} from "../core.js";
import { evaluateToolPolicy } from "../core.js";
import { ProxyAgent, type Dispatcher } from "undici";
import {
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "./provider-http-capture.js";
import { recentSessionMessages } from "./session-history.js";
import {
  parseOpenAiSseStream,
  type OpenAiStreamToolCallDelta,
} from "./openai-http-sse.js";

export interface OpenAiHttpRuntimeOptions {
  baseUrl: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model: string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  sessionMode?: "stateless" | "server-side";
  sessionHeaderName?: string;
  providerHttpCapture?: ProviderHttpCaptureOptions;
  env?: NodeJS.ProcessEnv;
}

interface OpenAiChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonObject;
  };
}

interface OpenAiChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAiChatToolCall[];
}

interface ToolBinding {
  tool: ToolDefinition;
  capabilityId?: string;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentChunks: string[];
}

interface CompletedToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface CompletionResult {
  text: string;
  toolCalls: CompletedToolCall[];
}

const MAX_TOOL_ROUNDS = 5;
const OPENAI_HTTP_APPROVAL_TIMEOUT_MS = 120_000;
const proxyAgents = new Map<string, Dispatcher>();

export class OpenAiHttpRuntime implements AgentRuntime {
  constructor(private readonly options: OpenAiHttpRuntimeOptions) {}

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const runId = request.runId ?? `run_${Date.now()}`;
    const providerCapture = resolveProviderHttpCaptureOptions(
      this.options.providerHttpCapture,
      this.options.env,
    );
    const priorMessages = recentSessionMessages(request);
    const model = request.requestedModelId ?? this.options.model;
    const session: AgentSessionTrace = {
      provider: "openai-http",
      sessionId: request.context.sessionId,
      persistent: this.options.sessionMode === "server-side",
      priorMessageCount: priorMessages.length,
      priorMessages,
    };

    yield { type: "turn.started", runId, at: new Date().toISOString() };
    if (request.assembledContext) {
      yield { type: "context.assembled", runId, context: request.assembledContext };
    }
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const fetchTransport = resolveFetchTransport(providerCapture, url);
    const captureSummary = providerHttpCaptureSummary(providerCapture);
    yield {
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: "openai_http.configured",
      data: {
        baseUrl: this.options.baseUrl,
        model,
        sessionMode: this.options.sessionMode ?? "stateless",
        ...captureSummary,
        inProcessFetch: true,
        fetchProxyActive: fetchTransport.active,
        fetchProxyBypassed: fetchTransport.bypassed,
        warning: fetchTransport.warning ?? captureSummary.warning ?? "",
      },
    };
    yield {
      type: "model.requested",
      runId,
      request: {
        systemPrompt: "OpenAI-compatible HTTP endpoint.",
        userInput: request.input,
        modelId: model,
        session,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills: request.skills ?? [],
        packs: request.packs ?? [],
        capabilities: request.capabilities ?? [],
      },
    };

    const abortController = new AbortController();
    const abortTurn = () => abortController.abort();
    if (request.signal?.aborted) {
      abortController.abort();
    } else {
      request.signal?.addEventListener("abort", abortTurn, { once: true });
    }

    const timeoutMs = this.options.timeoutMs ?? 120_000;
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const messages = this.buildMessages(request, priorMessages);
      const toolBindings = this.buildToolBindings(request);
      const openAiTools = this.buildOpenAiTools(toolBindings);
      const headers = this.buildHeaders(request);
      let fullText = "";

      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const body = this.buildRequestBody(messages, model, openAiTools);
        const fetchOptions: RequestInit & { dispatcher?: Dispatcher } = {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: abortController.signal,
        };
        if (fetchTransport.dispatcher) {
          fetchOptions.dispatcher = fetchTransport.dispatcher;
        }
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          yield {
            type: "error",
            runId,
            message: `HTTP ${response.status}: ${errorText.slice(0, 200) || response.statusText}`,
          };
          yield { type: "turn.finished", runId, at: new Date().toISOString() };
          return;
        }

        if (!response.body) {
          yield { type: "error", runId, message: "Response body is empty." };
          yield { type: "turn.finished", runId, at: new Date().toISOString() };
          return;
        }

        let completionText = "";
        const toolAccumulators = new Map<number, ToolCallAccumulator>();
        for await (const chunk of parseOpenAiSseStream(response.body, abortController.signal)) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) {
            completionText += delta.content;
            fullText += delta.content;
            yield { type: "assistant.delta", runId, text: delta.content };
          }
          if (delta.tool_calls) {
            for (const call of delta.tool_calls) {
              this.accumulateToolCall(call, toolAccumulators);
            }
          }
        }
        const completion: CompletionResult = {
          text: completionText,
          toolCalls: this.finalizeToolCalls(toolAccumulators),
        };

        if (!completion.toolCalls.length) {
          yield { type: "model.response", runId, response: { text: fullText } };
          yield { type: "turn.finished", runId, at: new Date().toISOString() };
          return;
        }

        messages.push({
          role: "assistant",
          content: completion.text || null,
          tool_calls: completion.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: call.arguments,
            },
          })),
        });

        for (const call of completion.toolCalls) {
          const execution = this.executeToolCall(call, toolBindings, request, runId, abortController.signal);
          let next = await execution.next();
          while (!next.done) {
            yield next.value;
            next = await execution.next();
          }
          messages.push(next.value);
        }
      }

      yield { type: "error", runId, message: "openai_http_tool_round_limit_exceeded" };
      yield { type: "model.response", runId, response: { text: fullText } };
    } catch (err) {
      if (abortController.signal.aborted) {
        yield { type: "error", runId, message: "openai_http_aborted" };
      } else {
        yield {
          type: "error",
          runId,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abortTurn);
    }

    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }

  private buildMessages(
    request: AgentTurnRequest,
    priorMessages: Array<{ role: string; content: string }>,
  ): OpenAiChatMessage[] {
    const messages: OpenAiChatMessage[] = [];
    const hostContext = request.assembledContext?.promptBlock?.trim();
    if (hostContext) {
      messages.push({ role: "system", content: `OpenGrove host context:\n${hostContext}` });
    }

    if (this.options.sessionMode !== "server-side") {
      for (const msg of priorMessages) {
        const role = toOpenAiRole(msg.role);
        if (role) {
          messages.push({ role, content: msg.content });
        }
      }
    }

    messages.push({ role: "user", content: request.input });
    return messages;
  }

  private buildRequestBody(
    messages: OpenAiChatMessage[],
    model: string,
    tools: OpenAiChatTool[],
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    if (this.options.maxTokens) {
      body.max_tokens = this.options.maxTokens;
    }
    if (this.options.temperature !== undefined) {
      body.temperature = this.options.temperature;
    }
    return body;
  }

  private buildHeaders(request: AgentTurnRequest): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };

    const apiKey = this.resolveApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    if (this.options.sessionHeaderName && this.options.sessionMode === "server-side") {
      headers[this.options.sessionHeaderName] = request.context.sessionId;
    }

    if (this.options.customHeaders) {
      Object.assign(headers, this.options.customHeaders);
    }

    return headers;
  }

  private resolveApiKey(): string | undefined {
    if (this.options.apiKeyEnv) {
      const env = this.options.env ?? process.env;
      const key = env[this.options.apiKeyEnv]?.trim();
      if (key) return key;
    }
    return this.options.apiKey?.trim() || undefined;
  }

  private buildToolBindings(request: AgentTurnRequest): Map<string, ToolBinding> {
    const capabilityByToolId = new Map<string, string>();
    for (const capability of request.capabilities ?? []) {
      for (const tool of capability.tools) {
        capabilityByToolId.set(tool.id, capability.id);
      }
    }

    const usedNames = new Set<string>();
    const bindings = new Map<string, ToolBinding>();
    for (const tool of request.tools) {
      const name = toOpenAiToolName(tool.spec.id, usedNames);
      bindings.set(name, {
        tool,
        capabilityId: capabilityByToolId.get(tool.spec.id),
      });
    }
    return bindings;
  }

  private buildOpenAiTools(bindings: Map<string, ToolBinding>): OpenAiChatTool[] {
    return Array.from(bindings.entries()).map(([name, binding]) => ({
      type: "function",
      function: {
        name,
        description: `${binding.tool.spec.title}: ${binding.tool.spec.description}`,
        parameters: binding.tool.spec.input.schema,
      },
    }));
  }

  private accumulateToolCall(
    tc: OpenAiStreamToolCallDelta,
    accumulators: Map<number, ToolCallAccumulator>,
  ): void {
    let acc = accumulators.get(tc.index);
    if (!acc) {
      acc = {
        id: tc.id ?? `call_${tc.index}`,
        name: tc.function?.name ?? "unknown",
        argumentChunks: [],
      };
      accumulators.set(tc.index, acc);
    }
    if (tc.id) {
      acc.id = tc.id;
    }
    if (tc.function?.name) {
      acc.name = tc.function.name;
    }
    if (tc.function?.arguments) {
      acc.argumentChunks.push(tc.function.arguments);
    }
  }

  private finalizeToolCalls(accumulators: Map<number, ToolCallAccumulator>): CompletedToolCall[] {
    return Array.from(accumulators.entries())
      .sort(([left], [right]) => left - right)
      .map(([, acc]) => ({
        id: acc.id,
        name: acc.name,
        arguments: acc.argumentChunks.join(""),
      }))
      .filter((call) => call.name && call.name !== "unknown");
  }

  private async *executeToolCall(
    call: CompletedToolCall,
    bindings: Map<string, ToolBinding>,
    request: AgentTurnRequest,
    runId: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent, OpenAiChatMessage, void> {
    const binding = bindings.get(call.name);
    const input = parseToolInput(call.arguments);
    if (!binding) {
      const result: ToolResult = {
        ok: false,
        error: `Unknown OpenGrove tool: ${call.name}`,
      };
      yield { type: "tool.started", runId, toolId: call.name, input };
      yield { type: "tool.finished", runId, toolId: call.name, result };
      return toolResultMessage(call.id, result);
    }

    const toolId = binding.tool.spec.id;
    yield { type: "tool.started", runId, toolId, input };
    let decision = evaluateToolPolicy(binding.tool.spec, request.policy, binding.capabilityId);
    let result: ToolResult;
    if (decision.mode !== "allow") {
      if (decision.mode === "deny") {
        result = {
          ok: false,
          error: "permission_denied",
          value: {
            status: decision.mode,
            reason: decision.reason,
          },
        };
        yield { type: "tool.finished", runId, toolId, result };
        return toolResultMessage(call.id, result);
      }

      const approval = request.context.approvals.request({
        kind: "tool",
        title: binding.tool.spec.title || toolId,
        reason: decision.reason,
        toolId,
        capabilityId: binding.capabilityId,
        input,
        resume: { type: "tool", runId },
      });
      yield { type: "approval.requested", runId, request: approval };
      yield {
        type: "run.paused",
        runId,
        at: new Date().toISOString(),
        reason: decision.reason,
        approvalId: approval.id,
      };
      const decided = await waitForOpenAiHttpApproval(request, approval, signal);
      yield { type: "approval.resolved", runId, request: decided };
      if (decided.status !== "approved") {
        result = {
          ok: false,
          error: "approval_rejected",
          value: {
            status: decided.status,
            reason: decision.reason,
          },
        };
        yield { type: "tool.finished", runId, toolId, result };
        return toolResultMessage(call.id, result);
      }
      yield {
        type: "run.resumed",
        runId,
        at: new Date().toISOString(),
        reason: "Approved by user through the OpenGrove bridge.",
        approvalId: approval.id,
      };
      decision = { mode: "allow", reason: "Approved by user through the OpenGrove bridge." };
    }

    try {
      result = await binding.tool.execute(input, {
        runId,
        capabilityId: binding.capabilityId,
        skillId: request.requestedSkillInvocation?.skillId,
        memory: request.context.memory,
        artifacts: request.context.artifacts,
        workingState: request.context.workingState,
        approvals: request.context.approvals,
        skills: request.context.skills,
        packs: request.context.packs,
        policy: decision,
      });
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    yield { type: "tool.finished", runId, toolId, result };
    return toolResultMessage(call.id, result);
  }
}

async function waitForOpenAiHttpApproval(
  request: AgentTurnRequest,
  approval: ApprovalRequest,
  signal?: AbortSignal,
): Promise<ApprovalRequest> {
  try {
    return await request.context.approvals.waitForDecision(approval.id, {
      timeoutMs: OPENAI_HTTP_APPROVAL_TIMEOUT_MS,
      signal,
    });
  } catch (error) {
    const current = request.context.approvals.get(approval.id);
    if (current?.status === "pending") {
      return request.context.approvals.decide(approval.id, "rejected", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (current) return current;
    throw error;
  }
}

interface FetchTransport {
  dispatcher?: Dispatcher;
  active: boolean;
  bypassed: boolean;
  warning?: string;
}

function resolveFetchTransport(
  capture: ReturnType<typeof resolveProviderHttpCaptureOptions>,
  url: string,
): FetchTransport {
  if (!capture.enabled || !capture.injected) {
    return { active: false, bypassed: false };
  }
  if (!capture.proxyUrl) {
    return {
      active: false,
      bypassed: false,
      warning: "Provider HTTP capture is enabled but no proxy URL is configured.",
    };
  }
  if (shouldBypassProxy(url, capture.noProxy)) {
    return {
      active: false,
      bypassed: true,
      warning: "Provider HTTP capture is enabled but this endpoint matches NO_PROXY.",
    };
  }
  let dispatcher = proxyAgents.get(capture.proxyUrl);
  if (!dispatcher) {
    dispatcher = new ProxyAgent(capture.proxyUrl);
    proxyAgents.set(capture.proxyUrl, dispatcher);
  }
  return { dispatcher, active: true, bypassed: false };
}

function shouldBypassProxy(url: string, noProxy: string): boolean {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!hostname || !noProxy.trim()) return false;
  for (const rawEntry of noProxy.split(",")) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "*") return true;
    const withoutPort = entry.startsWith("[")
      ? entry.replace(/^\[|\](?::\d+)?$/g, "")
      : entry.split(":")[0];
    const normalized = withoutPort.startsWith(".") ? withoutPort.slice(1) : withoutPort;
    if (!normalized) continue;
    if (hostname === normalized || hostname.endsWith(`.${normalized}`)) return true;
  }
  return false;
}

function toolResultMessage(toolCallId: string, result: ToolResult): OpenAiChatMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: stringifyToolResult(result),
  };
}

function stringifyToolResult(result: ToolResult): string {
  try {
    return JSON.stringify(result);
  } catch {
    return JSON.stringify({ ok: false, error: "tool_result_not_serializable" });
  }
}

function parseToolInput(raw: string): JsonObject {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    return isJsonObject(parsed) ? parsed : { value: parsed };
  } catch {
    return { value: raw };
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toOpenAiRole(role: string): OpenAiChatMessage["role"] | undefined {
  if (role === "system" || role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return undefined;
}

function toOpenAiToolName(toolId: string, usedNames: Set<string>): string {
  const raw = `opengrove_${toolId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  const base = /^[A-Za-z_]/.test(raw) ? raw : `opengrove_${raw}`;
  let candidate = base.slice(0, 64);
  let index = 2;
  while (usedNames.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    index += 1;
  }
  usedNames.add(candidate);
  return candidate;
}
