import { resolve } from "node:path";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
  ApprovalRequest,
  JsonObject,
} from "../core.js";
import { AsyncEventQueue } from "./codex/async-event-queue.js";
import {
  AcpSessionProjector,
  defaultAcpToolId,
  readAcpUsage,
  toJsonValue,
} from "./projectors/acp.js";
import { StdioJsonRpcClient } from "./stdio-json-rpc-client.js";
import {
  applyProviderHttpCaptureEnv,
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "./provider-http-capture.js";
import {
  recentSessionMessages,
  recentSessionPromptBlock,
} from "./session-history.js";

export interface AcpCliRuntimeOptions {
  kernelId: string;
  title: string;
  command: string;
  commandArgs?: string[];
  acpArgs?: string[];
  cwd?: string;
  configuredModel?: string;
  runtimeBindingFingerprint?: string;
  promptPayload?: "prompt" | "content-and-prompt";
  resumeSessions?: boolean;
  setModelFailure?: "ignore" | "error";
  toolFailureMessage?: string;
  providerHttpCapture?: ProviderHttpCaptureOptions;
  requestTimeoutMs?: number;
  approvalTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class AcpCliRuntime implements AgentRuntime {
  private acpClient?: StdioJsonRpcClient;
  private acpClientEnvFingerprint = "";
  private readonly acpSessions = new Set<string>();

  constructor(private readonly options: AcpCliRuntimeOptions) {}

  close(): void {
    this.acpClient?.close();
    this.acpClient = undefined;
    this.acpSessions.clear();
  }

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const queue = new AsyncEventQueue<AgentEvent>();
    const runId = request.runId ?? `run_${Date.now()}`;
    const producer = this.produceAcpTurn(request, queue, runId)
      .then(() => queue.close())
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        queue.push({
          type: "error",
          runId,
          message: translateAcpRuntimeError(this.options.kernelId, message),
        });
        queue.close();
      });
    try {
      for await (const event of queue) {
        yield event;
      }
      await producer;
    } finally {
      if (request.signal?.aborted && this.acpClient && !this.acpClient.isClosed()) {
        const nativeSessionId = readRememberedAcpSession(request, this.options.kernelId, this.options.runtimeBindingFingerprint)?.sessionId;
        if (nativeSessionId) {
          this.acpClient.notify("session/cancel", { sessionId: nativeSessionId });
        }
      }
    }
  }

  private async produceAcpTurn(
    request: AgentTurnRequest,
    queue: AsyncEventQueue<AgentEvent>,
    runId: string,
  ): Promise<void> {
    const requestedModel =
      normalizeOptionalString(request.requestedModelId) ??
      normalizeOptionalString(this.options.configuredModel);
    const runtimeEnv = mergeRuntimeEnv(this.options.env, request.runtimeEnv);
    const prompt = buildAcpPrompt(request, this.options.title);
    const providerCapture = resolveProviderHttpCaptureOptions(
      this.options.providerHttpCapture,
      runtimeEnv,
    );
    const client = await this.ensureAcpClient(providerCapture, runtimeEnv);
    const cwd = resolve(this.options.cwd ?? process.cwd());
    const nativeSession = await this.ensureAcpSession(client, request, cwd, requestedModel);
    const priorMessages = recentSessionMessages(request);
    const sessionTrace: AgentSessionTrace = {
      provider: this.options.kernelId,
      sessionId: nativeSession.sessionId,
      persistent: true,
      priorMessageCount: nativeSession.resuming ? priorMessages.length : 0,
      priorMessages: nativeSession.resuming ? priorMessages : [],
    };
    let assistantText = "";
    const projector = new AcpSessionProjector({
      runId,
      kernelId: this.options.kernelId,
      diagnosticPrefix: `${this.options.kernelId}.acp`,
      toolFailureMessage: this.options.toolFailureMessage ?? `${this.options.title} tool failed`,
      onAssistantText(text) {
        assistantText += text;
      },
    });

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
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: `${this.options.kernelId}.acp.session`,
      data: {
        sessionId: nativeSession.sessionId,
        resuming: nativeSession.resuming,
      },
    });
    queue.push({
      type: "model.requested",
      runId,
      request: {
        systemPrompt: `${this.options.title} ACP mode. OpenGrove host context is prepended to the user prompt when present.`,
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

    const cleanupNotifications = client.addNotificationHandler((notification) => {
      if (notification.method !== "session/update" && notification.method !== "session/notification") return;
      const params = asObject(notification.params);
      if (readString(params, "sessionId") !== nativeSession.sessionId) return;
      const update = asObject(params.update);
      for (const event of projector.project(update)) {
        queue.push(event);
      }
    });
    const cleanupRequests = client.addRequestHandler(async (rpcRequest) => {
      if (rpcRequest.method !== "session/request_permission" && rpcRequest.method !== "session/requestPermission") return undefined;
      const params = asObject(rpcRequest.params);
      if (readString(params, "sessionId") !== nativeSession.sessionId) return undefined;
      return await this.handleAcpPermissionRequest(params, {
        request,
        runId,
        queue,
      });
    });
    const abortPrompt = () => client.notify("session/cancel", { sessionId: nativeSession.sessionId });
    if (request.signal?.aborted) abortPrompt();
    request.signal?.addEventListener("abort", abortPrompt, { once: true });

    try {
      const promptBlocks = [{ type: "text", text: prompt }];
      const promptParams: JsonObject = {
        sessionId: nativeSession.sessionId,
        prompt: promptBlocks,
      };
      if (this.options.promptPayload === "content-and-prompt") {
        promptParams.content = promptBlocks;
      }
      const response = await client.request(
        "session/prompt",
        promptParams,
        {
          timeoutMs: this.options.requestTimeoutMs ?? 900_000,
          signal: request.signal,
        },
      );
      const usage = readAcpUsage(response);
      const finalText = assistantText.trimEnd();
      if (!finalText.trim()) {
        const diagnostic = client.stderr().trim();
        if (diagnostic) {
          queue.push({
            type: "runtime.diagnostic",
            runId,
            at: new Date().toISOString(),
            name: `${this.options.kernelId}.acp.empty_response_diagnostic`,
            data: { diagnostic },
          });
        }
        queue.push({
          type: "error",
          runId,
          message: diagnostic || `${this.options.kernelId}_empty_response`,
        });
        queue.push({ type: "turn.finished", runId, at: new Date().toISOString() });
        return;
      }
      queue.push({
        type: "model.response",
        runId,
        response: { text: finalText, ...(usage ? { usage } : {}) },
      });
      queue.push({ type: "turn.finished", runId, at: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rawMessage = client.stderr().trim() || message || `${this.options.kernelId}_acp_failed`;
      queue.push({
        type: "error",
        runId,
        message: translateAcpRuntimeError(this.options.kernelId, rawMessage),
      });
    } finally {
      request.signal?.removeEventListener("abort", abortPrompt);
      cleanupRequests();
      cleanupNotifications();
    }
  }

  private async ensureAcpClient(
    providerCapture: ReturnType<typeof resolveProviderHttpCaptureOptions>,
    runtimeEnv: NodeJS.ProcessEnv | undefined,
  ): Promise<StdioJsonRpcClient> {
    const envKey = envFingerprint(runtimeEnv);
    if (this.acpClient && !this.acpClient.isClosed() && this.acpClientEnvFingerprint === envKey) {
      return this.acpClient;
    }
    if (this.acpClient && !this.acpClient.isClosed()) {
      this.acpClient.close();
    }
    const args = [
      ...(this.options.commandArgs ?? []),
      ...(this.options.acpArgs ?? ["acp"]),
    ];
    const cwd = resolve(this.options.cwd ?? process.cwd());
    const env = applyProviderHttpCaptureEnv({ ...process.env, ...runtimeEnv }, providerCapture);
    const client = StdioJsonRpcClient.start({
      command: this.options.command,
      args,
      cwd,
      env: { ...env, PWD: cwd },
    });
    this.acpClient = client;
    this.acpClientEnvFingerprint = envKey;
    this.acpSessions.clear();
    await client.request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: {
          name: "opengrove",
          title: "OpenGrove",
          version: "0.0.0",
        },
        clientCapabilities: {
          auth: { terminal: false },
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      { timeoutMs: 30_000 },
    );
    return client;
  }

  private async ensureAcpSession(
    client: StdioJsonRpcClient,
    request: AgentTurnRequest,
    cwd: string,
    requestedModel: string | undefined,
  ): Promise<{ sessionId: string; resuming: boolean }> {
    const remembered = readRememberedAcpSession(request, this.options.kernelId, this.options.runtimeBindingFingerprint);
    if (remembered?.sessionId) {
      if (this.acpSessions.has(remembered.sessionId)) {
        await this.maybeSetAcpSessionModel(client, remembered.sessionId, requestedModel);
        return { sessionId: remembered.sessionId, resuming: true };
      }
      if (this.options.resumeSessions !== false) {
        const loaded = await this.loadAcpSession(client, remembered.sessionId, cwd);
        if (loaded) {
          this.acpSessions.add(loaded);
          rememberAcpSession(request, this.options.kernelId, loaded, this.options.runtimeBindingFingerprint);
          await this.maybeSetAcpSessionModel(client, loaded, requestedModel);
          return { sessionId: loaded, resuming: true };
        }
      }
    }

    const created = asObject(await client.request(
      "session/new",
      {
        cwd,
        mcpServers: [],
        ...(requestedModel ? { model: requestedModel } : {}),
      },
      { timeoutMs: 30_000 },
    ));
    const sessionId = readString(created, "sessionId");
    if (!sessionId) {
      throw new Error(`${this.options.kernelId}_acp_session_id_missing`);
    }
    this.acpSessions.add(sessionId);
    rememberAcpSession(request, this.options.kernelId, sessionId, this.options.runtimeBindingFingerprint);
    await this.maybeSetAcpSessionModel(client, sessionId, requestedModel);
    return { sessionId, resuming: false };
  }

  private async loadAcpSession(
    client: StdioJsonRpcClient,
    sessionId: string,
    cwd: string,
  ): Promise<string | undefined> {
    try {
      const loaded = asObject(await client.request(
        "session/load",
        { sessionId, cwd, mcpServers: [] },
        { timeoutMs: 30_000 },
      ));
      return readString(loaded, "sessionId") ?? sessionId;
    } catch {
      return undefined;
    }
  }

  private async maybeSetAcpSessionModel(
    client: StdioJsonRpcClient,
    sessionId: string,
    requestedModel: string | undefined,
  ): Promise<void> {
    if (!requestedModel) return;
    try {
      await client.request(
        "session/set_model",
        { sessionId, modelId: requestedModel },
        { timeoutMs: 15_000 },
      );
    } catch (error) {
      if (this.options.setModelFailure === "error") {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${this.options.title} could not switch to model ${JSON.stringify(requestedModel)}: ${message}`);
      }
    }
  }

  private async handleAcpPermissionRequest(
    params: Record<string, unknown>,
    context: {
      request: AgentTurnRequest;
      runId: string;
      queue: AsyncEventQueue<AgentEvent>;
    },
  ): Promise<JsonObject> {
    const options = Array.isArray(params.options) ? params.options.filter(isRecord) : [];
    const allowOption =
      options.find((option) => readString(option, "kind") === "allow_once") ??
      options.find((option) => readString(option, "kind") === "allow_always") ??
      options.find((option) => readString(option, "optionId")?.startsWith("allow")) ??
      options.find((option) => readString(option, "optionId")?.includes("approve"));
    const allowOptionId = allowOption ? readString(allowOption, "optionId") : undefined;
    const approval = createAcpApproval(this.options.kernelId, this.options.title, params, context.runId, context.request);
    context.queue.push({ type: "approval.requested", runId: context.runId, request: approval });

    if (context.request.accessMode === "full-access" && allowOptionId) {
      const decided = context.request.context.approvals.decide(approval.id, "approved", {
        optionId: allowOptionId,
        autoApproved: true,
      });
      context.queue.push({ type: "approval.resolved", runId: context.runId, request: decided });
      return { outcome: { outcome: "selected", optionId: allowOptionId } };
    }

    let decided: ApprovalRequest | undefined;
    try {
      decided = await context.request.context.approvals.waitForDecision(approval.id, {
        timeoutMs: this.options.approvalTimeoutMs ?? 120_000,
        signal: context.request.signal,
      });
    } catch (error) {
      const current = context.request.context.approvals.get(approval.id);
      decided = current?.status === "pending"
        ? context.request.context.approvals.decide(approval.id, "rejected", {
            error: error instanceof Error ? error.message : String(error),
          })
        : current;
    }
    if (decided) {
      context.queue.push({ type: "approval.resolved", runId: context.runId, request: decided });
    }
    if (decided?.status === "approved" && allowOptionId) {
      return { outcome: { outcome: "selected", optionId: allowOptionId } };
    }
    return { outcome: { outcome: "cancelled" } };
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

function envFingerprint(env: NodeJS.ProcessEnv | undefined): string {
  return Object.entries(env ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function translateAcpRuntimeError(kernelId: string, message: string): string {
  if (kernelId === "copilot" && /authentication required|not authenticated|login required|unauthorized/i.test(message)) {
    return [
      "GitHub Copilot CLI 需要先完成 GitHub 登录。",
      "请到设置 > 内核与知识 > GitHub Copilot CLI 点击“在终端登录”。",
    ].join("\n");
  }
  return message;
}

function buildAcpPrompt(request: AgentTurnRequest, title: string): string {
  const hostContext = request.assembledContext?.promptBlock?.trim();
  const threadHistory = recentSessionPromptBlock(request);
  const skillHint = request.requestedSkillInvocation
    ? [
        `The user invoked OpenGrove skill /${request.requestedSkillInvocation.skillName}.`,
        `${title} should use its native skill mechanism when that skill is available there.`,
      ].join(" ")
    : "";
  const sections = [
    "You are running inside the OpenGrove host.",
    hostContext ? `Host context:\n${hostContext}` : "",
    threadHistory,
    skillHint,
    `User request:\n${request.input}`,
  ].filter(Boolean);
  return sections.join("\n\n");
}

function createAcpApproval(
  kernelId: string,
  title: string,
  params: Record<string, unknown>,
  runId: string,
  request: AgentTurnRequest,
): ApprovalRequest {
  const toolCall = asObject(params.toolCall);
  const kind = readString(toolCall, "kind") === "execute" ? "command" : "tool";
  const toolTitle = readString(toolCall, "title") || readString(toolCall, "name") || `${title} permission request`;
  return request.context.approvals.request({
    kind,
    title: toolTitle,
    reason: `${title} ACP requested permission for ${toolTitle}.`,
    toolId: defaultAcpToolId(kernelId, toolCall),
    input: toJsonValue(params),
    resume: { type: "tool", runId },
  });
}

function readRememberedAcpSession(
  request: AgentTurnRequest,
  kernelId: string,
  runtimeBindingFingerprint: string | undefined,
): { sessionId: string } | undefined {
  if (!request.context.sessions?.get) return undefined;
  const current = request.context.sessions.get(request.context.sessionId);
  const fingerprint = runtimeBindingFingerprint || "native";
  const key = `${kernelId}:${fingerprint}`;
  const sessions = asObject(current?.metadata?.acpSessionIds);
  const sessionId = readString(sessions, key);
  return sessionId ? { sessionId } : undefined;
}

function rememberAcpSession(
  request: AgentTurnRequest,
  kernelId: string,
  nativeSessionId: string,
  runtimeBindingFingerprint: string | undefined,
): void {
  if (!request.context.sessions?.get || !request.context.sessions?.ensureSession) return;
  const current = request.context.sessions.get(request.context.sessionId);
  const fingerprint = runtimeBindingFingerprint || "native";
  const key = `${kernelId}:${fingerprint}`;
  const currentSessionIds = asObject(current?.metadata?.acpSessionIds);
  const acpSessionIds: JsonObject = {};
  for (const [entryKey, value] of Object.entries(currentSessionIds)) {
    if (typeof value === "string") {
      acpSessionIds[entryKey] = value;
    }
  }
  acpSessionIds[key] = nativeSessionId;
  const metadata: JsonObject = {
    ...(current?.metadata ?? {}),
    acpSessionIds,
    acpSessionUpdatedAt: new Date().toISOString(),
  };
  request.context.sessions.ensureSession({
    id: request.context.sessionId,
    activity: request.context.activity,
    metadata,
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
