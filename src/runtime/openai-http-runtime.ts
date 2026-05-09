import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
  JsonObject,
  JsonValue,
} from "../core.js";
import {
  applyProviderHttpCaptureEnv,
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "./provider-http-capture.js";
import { recentSessionMessages } from "./session-history.js";
import {
  parseOpenAiSseStream,
  type OpenAiStreamChunk,
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

interface ToolCallAccumulator {
  id: string;
  name: string;
  argumentChunks: string[];
  started: boolean;
}

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
    yield {
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: "openai_http.configured",
      data: {
        baseUrl: this.options.baseUrl,
        model,
        sessionMode: this.options.sessionMode ?? "stateless",
        ...providerHttpCaptureSummary(providerCapture),
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
    if (request.signal?.aborted) {
      abortController.abort();
    } else {
      request.signal?.addEventListener("abort", () => abortController.abort(), { once: true });
    }

    const timeoutMs = this.options.timeoutMs ?? 120_000;
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const messages = this.buildMessages(request, priorMessages);
      const body = this.buildRequestBody(messages, model);
      const headers = this.buildHeaders(request);
      const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

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

      let fullText = "";
      const toolAccumulators = new Map<number, ToolCallAccumulator>();

      for await (const chunk of parseOpenAiSseStream(response.body, abortController.signal)) {
        const events = this.processChunk(chunk, runId, toolAccumulators);
        for (const event of events) {
          if (event.type === "assistant.delta") {
            fullText += event.text;
          }
          yield event;
        }
      }

      // Flush any remaining tool calls
      for (const acc of toolAccumulators.values()) {
        if (acc.started) {
          yield this.finishToolCall(acc, runId);
        }
      }

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
      request.signal?.removeEventListener("abort", () => abortController.abort());
    }

    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }

  private buildMessages(
    request: AgentTurnRequest,
    priorMessages: Array<{ role: string; content: string }>,
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (this.options.sessionMode === "server-side") {
      // Server maintains history; only send current user message
      const hostContext = request.assembledContext?.promptBlock?.trim();
      if (hostContext) {
        messages.push({ role: "system", content: `OpenGrove host context:\n${hostContext}` });
      }
      messages.push({ role: "user", content: request.input });
    } else {
      // Stateless: send full history
      const hostContext = request.assembledContext?.promptBlock?.trim();
      if (hostContext) {
        messages.push({ role: "system", content: `OpenGrove host context:\n${hostContext}` });
      }
      for (const msg of priorMessages) {
        messages.push({ role: msg.role, content: msg.content });
      }
      messages.push({ role: "user", content: request.input });
    }

    return messages;
  }

  private buildRequestBody(
    messages: Array<{ role: string; content: string }>,
    model: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
    };
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
      headers["Authorization"] = `Bearer ${apiKey}`;
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

  private processChunk(
    chunk: OpenAiStreamChunk,
    runId: string,
    toolAccumulators: Map<number, ToolCallAccumulator>,
  ): AgentEvent[] {
    const events: AgentEvent[] = [];
    const choice = chunk.choices?.[0];
    if (!choice) return events;

    const { delta, finish_reason } = choice;

    if (delta.content) {
      events.push({ type: "assistant.delta", runId, text: delta.content });
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        this.accumulateToolCall(tc, runId, toolAccumulators, events);
      }
    }

    if (finish_reason === "tool_calls" || finish_reason === "function_call") {
      for (const acc of toolAccumulators.values()) {
        if (acc.started) {
          events.push(this.finishToolCall(acc, runId));
        }
      }
      toolAccumulators.clear();
    }

    return events;
  }

  private accumulateToolCall(
    tc: OpenAiStreamToolCallDelta,
    runId: string,
    accumulators: Map<number, ToolCallAccumulator>,
    events: AgentEvent[],
  ): void {
    let acc = accumulators.get(tc.index);
    if (!acc) {
      acc = {
        id: tc.id ?? `tool_${tc.index}`,
        name: tc.function?.name ?? "unknown",
        argumentChunks: [],
        started: false,
      };
      accumulators.set(tc.index, acc);
    }

    if (tc.id && !acc.started) {
      acc.id = tc.id;
    }
    if (tc.function?.name && !acc.started) {
      acc.name = tc.function.name;
    }
    if (tc.function?.arguments) {
      acc.argumentChunks.push(tc.function.arguments);
    }

    if (!acc.started && acc.name !== "unknown") {
      acc.started = true;
      events.push({
        type: "tool.started",
        runId,
        toolId: acc.name,
        input: acc.argumentChunks.join("") as unknown as JsonValue,
      });
    }
  }

  private finishToolCall(acc: ToolCallAccumulator, runId: string): AgentEvent {
    const rawArgs = acc.argumentChunks.join("");
    let parsedInput: JsonValue = rawArgs;
    try {
      parsedInput = JSON.parse(rawArgs);
    } catch {
      // leave as raw string
    }
    acc.started = false;
    return {
      type: "tool.finished",
      runId,
      toolId: acc.name,
      result: { ok: true, value: parsedInput },
    };
  }
}
