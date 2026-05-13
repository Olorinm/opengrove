import { randomUUID } from "node:crypto";
import { WebSocket } from "undici";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
  JsonObject,
  JsonValue,
} from "../core.js";
import { appEnvName } from "../identity.js";
import { AsyncEventQueue } from "./codex/async-event-queue.js";
import {
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "./provider-http-capture.js";
import {
  recentSessionMessages,
  recentSessionPromptBlock,
} from "./session-history.js";

export interface OpenClawGatewayConnection {
  url: string;
  token?: string;
  password?: string;
  sessionKey?: string;
}

export interface OpenClawGatewayRuntimeOptions extends OpenClawGatewayConnection {
  cwd?: string;
  configuredModel?: string;
  runtimeBindingFingerprint?: string;
  env?: NodeJS.ProcessEnv;
  providerHttpCapture?: ProviderHttpCaptureOptions;
  requestTimeoutMs?: number;
}

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  };
};

type PendingGatewayRequest = {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
};

const OPENCLAW_GATEWAY_TIMEOUT_MS = 900_000;
const CONNECT_TIMEOUT_MS = 30_000;
const CONNECT_CHALLENGE_GRACE_MS = 750;
const OPENCLAW_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
];

export class OpenClawGatewayRuntime implements AgentRuntime {
  private readonly client: OpenClawGatewayClient;

  constructor(private readonly options: OpenClawGatewayRuntimeOptions) {
    this.client = new OpenClawGatewayClient({
      url: options.url,
      token: options.token,
      password: options.password,
    });
  }

  close(): void {
    this.client.close();
  }

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const queue = new AsyncEventQueue<AgentEvent>();
    const runId = request.runId ?? `run_${Date.now()}`;
    const producer = this.produceGatewayTurn(request, queue, runId)
      .then(() => queue.close())
      .catch((error) => {
        queue.push({
          type: "error",
          runId,
          message: error instanceof Error ? error.message : String(error),
        });
        queue.close();
      });

    for await (const event of queue) {
      yield event;
    }
    await producer;
  }

  private async produceGatewayTurn(
    request: AgentTurnRequest,
    queue: AsyncEventQueue<AgentEvent>,
    runId: string,
  ): Promise<void> {
    const requestedModel = request.requestedModelId?.trim() || this.options.configuredModel?.trim();
    const prompt = buildOpenClawPrompt(request);
    const sessionKey = this.options.sessionKey?.trim() || "main";
    const priorMessages = recentSessionMessages(request);
    const capture = resolveProviderHttpCaptureOptions(this.options.providerHttpCapture, this.options.env);
    const acceptedRunIds = new Set([runId]);
    const session: AgentSessionTrace = {
      provider: "openclaw",
      sessionId: sessionKey,
      nativeSessionId: sessionKey,
      persistent: true,
      priorMessageCount: priorMessages.length,
      priorMessages,
    };
    let assistantText = "";
    let sawTerminalError = false;

    queue.push({ type: "turn.started", runId, at: new Date().toISOString() });
    if (request.assembledContext) {
      queue.push({ type: "context.assembled", runId, context: request.assembledContext });
    }
    queue.push({
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: "provider_http_capture.configured",
      data: providerHttpCaptureSummary(capture),
    });
    queue.push({
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: "openclaw.gateway.session",
      data: {
        url: redactGatewayUrl(this.options.url),
        sessionKey,
      },
    });
    queue.push({
      type: "model.requested",
      runId,
      request: {
        systemPrompt: "OpenClaw Gateway mode. OpenGrove host context is prepended to the user prompt when present.",
        userInput: request.input,
        modelId: requestedModel,
        session,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills: request.skills ?? [],
        packs: request.packs ?? [],
        capabilities: request.capabilities ?? [],
      },
    });

    const cleanup = this.client.addEventListener((frame) => {
      if (frame.event !== "agent") return;
      const payload = asObject(frame.payload);
      const payloadRunId = readString(payload, "runId");
      if (payloadRunId && !acceptedRunIds.has(payloadRunId)) return;
      const stream = readString(payload, "stream");
      const data = asObject(payload.data);
      const lifecyclePhase = readString(data, "phase") || readString(payload, "phase");
      if (stream === "assistant") {
        const text = normalizeAssistantText(extractGatewayText(payload) || extractGatewayText(data));
        if (text) {
          assistantText += text;
          queue.push({ type: "assistant.delta", runId, text });
        }
        return;
      }
      if (stream === "lifecycle" && lifecyclePhase === "error") {
        sawTerminalError = true;
        queue.push({
          type: "error",
          runId,
          message: readString(data, "error") || readString(payload, "error") || "openclaw_gateway_run_failed",
        });
      }
    });

    const abort = () => {
      void this.client.request("chat.abort", { sessionKey, runId }, { timeoutMs: 10_000 }).catch(() => undefined);
    };
    request.signal?.addEventListener("abort", abort, { once: true });

    try {
      await this.client.ensureConnected();
      if (request.signal?.aborted) {
        abort();
        throw new Error("openclaw_gateway_aborted");
      }
      const sent = asObject(await this.client.request(
        "chat.send",
        {
          sessionKey,
          sessionId: request.context.sessionId,
          message: prompt,
          deliver: false,
          timeoutMs: this.options.requestTimeoutMs ?? OPENCLAW_GATEWAY_TIMEOUT_MS,
          idempotencyKey: runId,
        },
        { timeoutMs: 30_000, signal: request.signal },
      ));
      const nativeRunId = readString(sent, "runId") || runId;
      acceptedRunIds.add(nativeRunId);
      const wait = asObject(await this.client.request(
        "agent.wait",
        {
          runId: nativeRunId,
          timeoutMs: this.options.requestTimeoutMs ?? OPENCLAW_GATEWAY_TIMEOUT_MS,
        },
        { timeoutMs: this.options.requestTimeoutMs ?? OPENCLAW_GATEWAY_TIMEOUT_MS, signal: request.signal },
      ));
      const waitStatus = readString(wait, "status");
      if (waitStatus && waitStatus !== "ok") {
        sawTerminalError = true;
        queue.push({ type: "error", runId, message: `openclaw_gateway_${waitStatus}` });
      }

      if (!assistantText.trim()) {
        const finalText = await this.readLatestAssistantText(sessionKey);
        if (finalText) {
          assistantText = finalText;
          queue.push({ type: "assistant.delta", runId, text: finalText });
        }
      }
      if (!assistantText.trim() && !sawTerminalError) {
        queue.push({ type: "error", runId, message: "openclaw_gateway_empty_response" });
      }
      queue.push({ type: "model.response", runId, response: { text: assistantText.trimEnd() } });
      queue.push({ type: "turn.finished", runId, at: new Date().toISOString() });
    } finally {
      cleanup();
      request.signal?.removeEventListener("abort", abort);
    }
  }

  private async readLatestAssistantText(sessionKey: string): Promise<string> {
    try {
      const history = asObject(await this.client.request(
        "chat.history",
        { sessionKey, limit: 20 },
        { timeoutMs: 30_000 },
      ));
      const messages = Array.isArray(history.messages) ? history.messages : [];
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = asObject(messages[index]);
        if (readString(message, "role") !== "assistant") continue;
        const text = normalizeAssistantText(extractGatewayText(message));
        if (text) return text;
      }
    } catch {
      return "";
    }
    return "";
  }
}

export function resolveOpenClawGatewayConnection(
  env: NodeJS.ProcessEnv = process.env,
): OpenClawGatewayConnection | undefined {
  const url = readEnv(
    env,
    appEnvName("OPENCLAW_GATEWAY_URL"),
    appEnvName("OPENCLAW_WS_URL"),
    "OPENCLAW_GATEWAY_URL",
    "OPENCLAW_WS_URL",
  );
  if (!url) return undefined;
  return {
    url,
    token: readEnv(
      env,
      appEnvName("OPENCLAW_GATEWAY_TOKEN"),
      appEnvName("OPENCLAW_TOKEN"),
      "OPENCLAW_GATEWAY_TOKEN",
      "OPENCLAW_TOKEN",
    ),
    password: readEnv(
      env,
      appEnvName("OPENCLAW_GATEWAY_PASSWORD"),
      "OPENCLAW_GATEWAY_PASSWORD",
    ),
    sessionKey: readEnv(
      env,
      appEnvName("OPENCLAW_SESSION_KEY"),
      "OPENCLAW_SESSION_KEY",
    ),
  };
}

class OpenClawGatewayClient {
  private ws?: WebSocket;
  private connected = false;
  private connectPromise?: Promise<void>;
  private nextId = 1;
  private pending = new Map<string, PendingGatewayRequest>();
  private eventListeners = new Set<(frame: GatewayEventFrame) => void>();

  constructor(private readonly options: Pick<OpenClawGatewayConnection, "url" | "token" | "password">) {}

  async ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.connected) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.openSocket();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    await this.ensureConnected();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("openclaw gateway is not connected");
    }
    return await this.requestOnSocket<T>(this.ws, method, params, options);
  }

  addEventListener(listener: (frame: GatewayEventFrame) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  close(): void {
    this.connected = false;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Error("openclaw gateway closed"));
    }
    this.pending.clear();
    this.ws?.close();
    this.ws = undefined;
  }

  private openSocket(): Promise<void> {
    this.close();
    const ws = new WebSocket(this.options.url);
    this.ws = ws;
    let connectSent = false;
    let connectNonce: string | undefined;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    return new Promise<void>((resolve, reject) => {
      const cleanupConnect = () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = undefined;
        }
        ws.removeEventListener("open", onOpen);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupConnect();
        this.connected = false;
        reject(error);
      };
      const sendConnect = () => {
        if (connectSent || ws.readyState !== WebSocket.OPEN) return;
        connectSent = true;
        void this.requestOnSocket(ws, "connect", this.connectParams(connectNonce), { timeoutMs: CONNECT_TIMEOUT_MS })
          .then(() => {
            if (settled) return;
            settled = true;
            cleanupConnect();
            this.connected = true;
            resolve();
          })
          .catch(fail);
      };
      const onOpen = () => {
        connectTimer = setTimeout(sendConnect, CONNECT_CHALLENGE_GRACE_MS);
        connectTimer.unref?.();
      };
      const onMessage = (event: { data: unknown }) => {
        if (this.ws !== ws) return;
        const frame = parseGatewayFrame(event.data);
        if (!frame) return;
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const payload = asObject(frame.payload);
          connectNonce = readString(payload, "nonce");
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = undefined;
          }
          sendConnect();
          return;
        }
        this.handleFrame(frame);
      };
      const onClose = () => {
        if (this.ws !== ws) return;
        cleanupConnect();
        this.connected = false;
        for (const pending of this.pending.values()) {
          pending.cleanup();
          pending.reject(new Error("openclaw gateway closed"));
        }
        this.pending.clear();
        if (!settled) {
          fail(new Error("openclaw gateway closed during connect"));
        }
      };
      const onError = () => {
        if (this.ws !== ws) return;
        this.connected = false;
        if (!settled) {
          fail(new Error("openclaw gateway socket error"));
        }
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", onClose);
      ws.addEventListener("error", onError);
    });
  }

  private requestOnSocket<T>(
    ws: WebSocket,
    method: string,
    params?: unknown,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (options.signal?.aborted) {
      return Promise.reject(new Error(`${method} aborted`));
    }
    const id = `${Date.now()}-${this.nextId++}-${randomUUID()}`;
    return new Promise<T>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let cleanupAbort: (() => void) | undefined;
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        cleanupAbort?.();
        cleanupAbort = undefined;
      };
      const rejectPending = (error: Error) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        cleanup();
        reject(error);
      };
      if (options.timeoutMs && options.timeoutMs > 0) {
        timeout = setTimeout(() => rejectPending(new Error(`${method} timed out`)), options.timeoutMs);
        timeout.unref?.();
      }
      if (options.signal) {
        const abortListener = () => rejectPending(new Error(`${method} aborted`));
        options.signal.addEventListener("abort", abortListener, { once: true });
        cleanupAbort = () => options.signal?.removeEventListener("abort", abortListener);
      }
      this.pending.set(id, {
        method,
        resolve(value) {
          cleanup();
          resolve(value as T);
        },
        reject(error) {
          cleanup();
          reject(error);
        },
        cleanup,
      });
      try {
        ws.send(JSON.stringify({ type: "req", id, method, params }));
      } catch (error) {
        rejectPending(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private connectParams(_nonce?: string): JsonObject {
    return stripUndefined({
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "gateway-client",
        version: "opengrove",
        platform: process.platform,
        mode: "backend",
        instanceId: `opengrove-${process.pid}`,
      },
      role: "operator",
      scopes: OPENCLAW_OPERATOR_SCOPES,
      caps: ["tool-events"],
      auth: stripUndefined({
        token: this.options.token,
        password: this.options.password,
      }),
      device: undefined,
      userAgent: "OpenGrove",
      locale: "en-US",
    }) as JsonObject;
  }

  private handleFrame(frame: GatewayEventFrame | GatewayResponseFrame): void {
    if (frame.type === "event") {
      for (const listener of this.eventListeners) {
        listener(frame);
      }
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    if (frame.ok) {
      pending.resolve(frame.payload);
      return;
    }
    const details = frame.error?.details === undefined ? "" : `: ${JSON.stringify(frame.error.details)}`;
    pending.reject(new Error(frame.error?.message || `${pending.method} failed${details}`));
  }
}

function buildOpenClawPrompt(request: AgentTurnRequest): string {
  const hostContext = request.assembledContext?.promptBlock?.trim();
  const threadHistory = recentSessionPromptBlock(request);
  const sections = [
    "You are running inside the OpenGrove host.",
    hostContext ? `Host context:\n${hostContext}` : "",
    threadHistory,
    `User request:\n${request.input}`,
  ].filter(Boolean);
  return sections.join("\n\n");
}

function parseGatewayFrame(data: unknown): GatewayEventFrame | GatewayResponseFrame | undefined {
  const raw = typeof data === "string"
    ? data
    : data instanceof ArrayBuffer
      ? Buffer.from(data).toString("utf8")
      : Buffer.isBuffer(data)
        ? data.toString("utf8")
        : "";
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (parsed.type === "event" || parsed.type === "res") {
      return parsed as GatewayEventFrame | GatewayResponseFrame;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractGatewayText(value: unknown): string {
  const record = asObject(value);
  const direct = readString(record, "text") || readString(record, "delta") || readString(record, "content");
  if (direct) return direct;
  const message = asObject(record.message);
  const messageText = readString(message, "text") || readString(message, "content");
  if (messageText) return messageText;
  const content = Array.isArray(record.content)
    ? record.content
    : Array.isArray(message.content)
      ? message.content
      : [];
  return content
    .map((item) => {
      const block = asObject(item);
      return readString(block, "text") || readString(block, "content") || "";
    })
    .filter(Boolean)
    .join("");
}

function normalizeAssistantText(value: string | undefined): string {
  const text = value?.trimEnd() ?? "";
  if (!text.trim()) return "";
  if (text.trim() === "NO_REPLY") return "";
  if (text.includes("\"payloads\"") && text.includes("\"runId\"")) return "";
  return text;
}

function redactGatewayUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "[redacted]");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function readEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stripUndefined(input: Record<string, unknown>): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      output[key] = value.filter((item): item is JsonValue => item !== undefined) as JsonValue;
      continue;
    }
    if (value && typeof value === "object") {
      output[key] = stripUndefined(value as Record<string, unknown>);
      continue;
    }
    output[key] = value as JsonValue;
  }
  return output;
}
