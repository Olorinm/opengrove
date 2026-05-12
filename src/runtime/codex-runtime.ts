import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
  ApprovalRequest,
  JsonObject,
  JsonValue,
} from "../core.js";
import {
  createCodexRpcCaptureRecorder,
} from "./codex-rpc-capture.js";
import {
  applyProviderHttpCaptureEnv,
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ResolvedProviderHttpCaptureOptions,
} from "./provider-http-capture.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { AsyncEventQueue } from "./codex/async-event-queue.js";
import {
  handleCodexApprovalRequest,
  handleCodexElicitationRequest,
  handleCodexUserInputRequest,
  isCodexApprovalRequest,
} from "./codex/approval-bridge.js";
import { readCodexAuthRefreshResponse } from "./codex/auth.js";
import { createCodexDynamicToolBridge, readDynamicToolCallParams } from "./codex/dynamic-tool-bridge.js";
import { CodexEventProjector } from "./codex/event-projector.js";
import {
  buildCodexDeveloperInstructions,
  buildCodexTurnInput,
  buildCodexTurnInputItems,
  imageGenerationTruthCorrection,
  refreshCodexNativeSkillList,
} from "./codex/input.js";
import {
  normalizeCodexModelId,
  resolveCodexApprovalPolicy,
  resolveCodexApprovalsReviewer,
  resolveCodexSandboxMode,
  resolveCodexServiceTier,
} from "./codex/policy.js";
import {
  CODEX_THREAD_CONFIG_OVERRIDES,
  DEFAULT_CODEX_APP_SERVER_ARGS,
  type CodexApprovalPolicy,
  type CodexApprovalsReviewer,
  type CodexDynamicToolSpec,
  type CodexModelProviderRuntimeConfig,
  type CodexRuntimeOptions,
  type CodexSandboxMode,
  type CodexThreadBinding,
  type CodexThreadStartResponse,
  type CodexTurnStartResponse,
} from "./codex/types.js";

export {
  resolveCodexCommandPath,
} from "./codex/command-path.js";
export type {
  CodexApprovalPolicy,
  CodexApprovalsReviewer,
  CodexRuntimeOptions,
  CodexSandboxMode,
} from "./codex/types.js";

export class CodexRuntime implements AgentRuntime {
  private client?: CodexAppServerClient;
  private readonly bindings = new Map<string, CodexThreadBinding>();
  private bindingsLoaded = false;

  constructor(private readonly options: CodexRuntimeOptions = {}) {}

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const runId = request.runId ?? `run_${Date.now()}`;
    const cwd = this.options.cwd ?? process.cwd();
    const model = normalizeCodexModelId(
      request.requestedModelId,
      this.options.configuredModel,
    );
    const modelProvider = this.options.configuredModelProvider?.trim() || undefined;
    const sandbox = resolveCodexSandboxMode(request, this.options.sandbox);
    const approvalPolicy = resolveCodexApprovalPolicy(request.accessMode, this.options.approvalPolicy);
    const approvalsReviewer = resolveCodexApprovalsReviewer(this.options.approvalsReviewer);
    const serviceTier = this.options.allowServiceTier === false
      ? undefined
      : resolveCodexServiceTier(request.responseSpeed, this.options.serviceTier);
    const threadConfig = codexThreadConfig(this.options.providerConfig);
    const developerInstructions = buildCodexDeveloperInstructions();
    const turnInput = buildCodexTurnInput(request);
    const turnInputItems = buildCodexTurnInputItems(request, turnInput);
    const exposeDynamicTools = shouldExposeCodexDynamicTools(request);
    const toolBridge = createCodexDynamicToolBridge(
      exposeDynamicTools ? request : { ...request, tools: [], capabilities: [] },
      runId,
    );
    const providerCapture = resolveProviderHttpCaptureOptions(
      this.options.providerHttpCapture,
      this.options.env,
    );
    const rawEventCapture = Boolean(this.options.rawEventCapture && providerCapture.enabled && providerCapture.injected);

    yield { type: "turn.started", runId, at: new Date().toISOString() };
    if (request.assembledContext) {
      yield { type: "context.assembled", runId, context: request.assembledContext };
    }
    yield {
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: "provider_http_capture.configured",
      data: providerHttpCaptureSummary(providerCapture),
    };

    const client = await this.ensureClient(providerCapture);
    await refreshCodexNativeSkillList(client, cwd, request);
    const thread = await this.startOrResumeThread(client, request, {
      cwd,
      model,
      modelProvider,
      runtimeBindingFingerprint: codexRuntimeBindingFingerprint({
        base: this.options.runtimeBindingFingerprint,
        model,
        modelProvider,
        dynamicToolsFingerprint: toolBridge.fingerprint,
        cwd,
        rawEventCapture,
      }),
      sandbox,
      developerInstructions,
      dynamicTools: toolBridge.specs,
      dynamicToolsFingerprint: toolBridge.fingerprint,
      approvalPolicy,
      approvalsReviewer,
      serviceTier,
      config: threadConfig,
      rawEventCapture,
    });
    const sessionTrace: AgentSessionTrace = {
      provider: "codex",
      sessionId: thread.threadId,
      persistent: true,
      priorMessageCount: 0,
      priorMessages: [],
    };

    yield {
      type: "model.requested",
      runId,
      request: {
        systemPrompt: developerInstructions,
        userInput: request.input,
        modelId: model,
        session: sessionTrace,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills: request.skills ?? [],
        packs: request.packs ?? [],
        capabilities: request.capabilities ?? [],
      },
    };

    const queue = new AsyncEventQueue<AgentEvent>();
    const projector = new CodexEventProjector(runId, thread.threadId, queue);
    let activeTurnId = "";
    let pauseRequest: ApprovalRequest | undefined;
    let turnCompleted = false;
    const pendingNotifications: Array<{ method: string; params?: JsonValue }> = [];
    const abortTurn = () => {
      if (activeTurnId) {
        void client
          .request("turn/interrupt", { threadId: thread.threadId, turnId: activeTurnId })
          .catch(() => undefined);
      }
      queue.push({ type: "error", runId, message: "run_cancelled" });
      queue.close();
    };
    if (request.signal?.aborted) {
      abortTurn();
    }
    request.signal?.addEventListener("abort", abortTurn, { once: true });

    const replayPendingNotifications = async () => {
      for (const notification of pendingNotifications.splice(0)) {
        await handleNotification(notification);
      }
    };
    const handleNotification = async (notification: { method: string; params?: JsonValue }) => {
      if (!activeTurnId) {
        pendingNotifications.push(notification);
        return;
      }
      const completed = projector.handleNotification(notification, activeTurnId);
      if (completed) {
        turnCompleted = true;
        queue.close();
      }
    };
    const notificationCleanup = client.addNotificationHandler(handleNotification);
    const requestCleanup = client.addRequestHandler(async (serverRequest) => {
      if (serverRequest.method === "account/chatgptAuthTokens/refresh") {
        return readCodexAuthRefreshResponse(this.options.env);
      }
      if (isCodexApprovalRequest(serverRequest.method)) {
        return await handleCodexApprovalRequest(serverRequest, {
          threadId: thread.threadId,
          turnId: activeTurnId,
          runId,
          request,
          queue,
        });
      }
      if (serverRequest.method === "item/tool/requestUserInput") {
        return await handleCodexUserInputRequest(serverRequest, {
          runId,
          request,
          queue,
        });
      }
      if (serverRequest.method === "mcpServer/elicitation/request") {
        return await handleCodexElicitationRequest(serverRequest, {
          runId,
          request,
          queue,
        });
      }
      if (serverRequest.method === "item/tool/call") {
        const call = readDynamicToolCallParams(serverRequest.params);
        if (!call || call.threadId !== thread.threadId) {
          return undefined;
        }
        const result = await toolBridge.handleToolCall(call, {
          queue,
          onPause(requestedApproval) {
            pauseRequest = requestedApproval;
          },
        });
        return result as unknown as JsonValue;
      }
      return undefined;
    });

    try {
      const turn = await client.request<CodexTurnStartResponse>(
        "turn/start",
        {
          threadId: thread.threadId,
          input: turnInputItems as unknown as JsonValue,
        },
        { timeoutMs: this.options.requestTimeoutMs ?? 60_000, signal: request.signal },
      );
      activeTurnId = turn.turn?.id ?? "";
      if (!activeTurnId) {
        throw new Error("codex_turn_id_missing");
      }
      await replayPendingNotifications();

      for await (const event of queue) {
        if (event.type === "approval.requested" && event.request.resume?.type !== "codex.native") {
          pauseRequest = event.request;
        } else if (event.type === "approval.resolved" && pauseRequest?.id === event.request.id) {
          pauseRequest = undefined;
        }
        yield event;
      }
    } catch (error) {
      yield {
        type: "error",
        runId,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      request.signal?.removeEventListener("abort", abortTurn);
      notificationCleanup();
      requestCleanup();
    }

    if (!turnCompleted && !projector.finalText()) {
      queue.close();
    }
    const baseFinalText = projector.finalText();
    const truthCorrection = imageGenerationTruthCorrection(request, baseFinalText, projector.generatedImageCount());
    const finalText = truthCorrection
      ? [baseFinalText, truthCorrection].filter(Boolean).join("\n\n")
      : baseFinalText;
    if (projector.errorMessage()) {
      yield { type: "error", runId, message: projector.errorMessage() ?? "codex_turn_failed" };
    }
    if (truthCorrection && projector.didStreamAssistantText()) {
      yield { type: "assistant.delta", runId, text: `\n\n${truthCorrection}` };
    } else if (finalText && !projector.didStreamAssistantText()) {
      yield { type: "assistant.delta", runId, text: finalText };
    }
    yield {
      type: "model.response",
      runId,
      response: {
        text: finalText,
        usage: projector.usage(),
      },
    };
    if (pauseRequest) {
      yield {
        type: "run.paused",
        runId,
        at: new Date().toISOString(),
        reason: pauseRequest.reason,
        approvalId: pauseRequest.id,
      };
      return;
    }
    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }

  private async ensureClient(
    providerCapture?: ResolvedProviderHttpCaptureOptions,
  ): Promise<CodexAppServerClient> {
    if (this.client && !this.client.isClosed()) {
      return this.client;
    }
    const rpcCapture = createCodexRpcCaptureRecorder(this.options.rpcCapture, this.options.env);
    const resolvedProviderCapture =
      providerCapture ??
      resolveProviderHttpCaptureOptions(
        this.options.providerHttpCapture,
        this.options.env,
      );
    rpcCapture?.recordLifecycle("provider_http_capture.configured", providerHttpCaptureSummary(resolvedProviderCapture));
    const env = applyProviderHttpCaptureEnv(
      { ...process.env, ...this.options.env },
      resolvedProviderCapture,
    );
    if (!env.TERM) {
      env.TERM = "dumb";
    }
    const client = CodexAppServerClient.start({
      command: this.options.command ?? "codex",
      args: this.options.args ?? DEFAULT_CODEX_APP_SERVER_ARGS,
      env,
      rpcCapture,
    });
    await client.initialize();
    this.client = client;
    return client;
  }

  private async startOrResumeThread(
    client: CodexAppServerClient,
    request: AgentTurnRequest,
    options: {
      cwd: string;
      model: string;
      modelProvider?: string;
      runtimeBindingFingerprint: string;
      developerInstructions: string;
      dynamicTools: CodexDynamicToolSpec[];
      dynamicToolsFingerprint: string;
      sandbox: CodexSandboxMode;
      approvalPolicy: CodexApprovalPolicy;
      approvalsReviewer: CodexApprovalsReviewer;
      serviceTier?: string;
      config: JsonObject;
      rawEventCapture: boolean;
    },
  ): Promise<CodexThreadBinding> {
    this.loadBindings();
    const sessionId = request.context.sessionId || "local";
    const bindingKey = `${sessionId}:${options.runtimeBindingFingerprint}`;
    const existing =
      this.bindings.get(bindingKey) ??
      this.findCompatibleLegacyBinding(sessionId, bindingKey, options);
    const modelProviderKey = options.modelProvider ?? "";
    if (
      existing?.threadId &&
      existing.dynamicToolsFingerprint === options.dynamicToolsFingerprint &&
      codexModelProviderMatches(existing.modelProvider, modelProviderKey) &&
      existing.runtimeBindingFingerprint === options.runtimeBindingFingerprint
    ) {
      try {
        const response = await client.request<CodexThreadStartResponse>("thread/resume", {
          threadId: existing.threadId,
          model: options.model,
          ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
          approvalPolicy: options.approvalPolicy,
          approvalsReviewer: options.approvalsReviewer,
          sandbox: options.sandbox,
          config: options.config,
          persistExtendedHistory: options.rawEventCapture,
          ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
        });
        const threadId = response.thread?.id ?? existing.threadId;
        const binding = {
          ...existing,
          threadId,
          model: response.model ?? options.model,
          modelProvider: codexStoredModelProvider(response.modelProvider, options.modelProvider),
          runtimeBindingFingerprint: options.runtimeBindingFingerprint,
          cwd: options.cwd,
          updatedAt: new Date().toISOString(),
        };
        this.bindings.set(bindingKey, binding);
        this.saveBindings();
        return binding;
      } catch {
        this.bindings.delete(bindingKey);
        this.saveBindings();
      }
    }

    const response = await client.request<CodexThreadStartResponse>("thread/start", {
      model: options.model,
      ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
      cwd: options.cwd,
      approvalPolicy: options.approvalPolicy,
      approvalsReviewer: options.approvalsReviewer,
      sandbox: options.sandbox,
      serviceName: "OpenGrove",
      developerInstructions: options.developerInstructions,
      dynamicTools: options.dynamicTools,
      config: options.config,
      experimentalRawEvents: options.rawEventCapture,
      persistExtendedHistory: options.rawEventCapture,
      ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
    });
    const threadId = response.thread?.id;
    if (!threadId) {
      throw new Error("codex_thread_id_missing");
    }
    const createdAt = new Date().toISOString();
    const binding: CodexThreadBinding = {
      threadId,
      dynamicToolsFingerprint: options.dynamicToolsFingerprint,
      runtimeBindingFingerprint: options.runtimeBindingFingerprint,
      model: response.model ?? options.model,
      modelProvider: codexStoredModelProvider(response.modelProvider, options.modelProvider),
      cwd: options.cwd,
      createdAt,
      updatedAt: createdAt,
    };
    this.bindings.set(bindingKey, binding);
    this.saveBindings();
    return binding;
  }

  private loadBindings(): void {
    if (this.bindingsLoaded) {
      return;
    }
    this.bindingsLoaded = true;
    const path = this.options.statePath;
    if (!path || !existsSync(path)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return;
      }
      for (const [sessionId, binding] of Object.entries(parsed)) {
        if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
          continue;
        }
        const object = binding as Record<string, unknown>;
        if (typeof object.threadId !== "string") {
          continue;
        }
        this.bindings.set(sessionId, {
          threadId: object.threadId,
          dynamicToolsFingerprint:
            typeof object.dynamicToolsFingerprint === "string"
              ? object.dynamicToolsFingerprint
              : "",
          model: typeof object.model === "string" ? object.model : undefined,
          modelProvider: typeof object.modelProvider === "string" ? object.modelProvider : undefined,
          runtimeBindingFingerprint: typeof object.runtimeBindingFingerprint === "string" ? object.runtimeBindingFingerprint : undefined,
          cwd: typeof object.cwd === "string" ? object.cwd : undefined,
          createdAt: typeof object.createdAt === "string" ? object.createdAt : new Date().toISOString(),
          updatedAt: typeof object.updatedAt === "string" ? object.updatedAt : new Date().toISOString(),
        });
      }
    } catch {
      // A corrupt binding file should not prevent the host from starting a fresh Codex thread.
    }
  }

  private findCompatibleLegacyBinding(
    sessionId: string,
    currentBindingKey: string,
    options: {
      cwd: string;
      model: string;
      modelProvider?: string;
      dynamicToolsFingerprint: string;
    },
  ): CodexThreadBinding | undefined {
    const prefix = `${sessionId}:`;
    const candidates = Array.from(this.bindings.entries())
      .filter(([key, binding]) =>
        key !== currentBindingKey &&
        key.startsWith(prefix) &&
        binding.threadId &&
        binding.dynamicToolsFingerprint === options.dynamicToolsFingerprint &&
        codexModelProviderMatches(binding.modelProvider, options.modelProvider) &&
        (!binding.cwd || binding.cwd === options.cwd)
      )
      .map(([, binding]) => binding)
      .sort((left, right) => {
        const modelScore = Number(right.model === options.model) - Number(left.model === options.model);
        return modelScore || right.updatedAt.localeCompare(left.updatedAt);
      });
    return candidates[0];
  }

  private saveBindings(): void {
    const path = this.options.statePath;
    if (!path) {
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify(Object.fromEntries(this.bindings.entries()), null, 2)}\n`,
      "utf8",
    );
  }
}

function codexThreadConfig(provider: CodexModelProviderRuntimeConfig | undefined): JsonObject {
  if (!provider) return CODEX_THREAD_CONFIG_OVERRIDES;
  return {
    ...CODEX_THREAD_CONFIG_OVERRIDES,
    model_provider: provider.providerKey,
    [`model_providers.${provider.providerKey}.name`]: provider.name,
    [`model_providers.${provider.providerKey}.base_url`]: provider.baseUrl,
    [`model_providers.${provider.providerKey}.env_key`]: provider.envKey,
    [`model_providers.${provider.providerKey}.wire_api`]: provider.wireApi,
  };
}

function codexRuntimeBindingFingerprint(input: {
  base?: string;
  model: string;
  modelProvider?: string;
  dynamicToolsFingerprint: string;
  cwd: string;
  rawEventCapture: boolean;
}): string {
  return [
    input.base || "native",
    input.modelProvider || "native",
    input.dynamicToolsFingerprint,
    input.cwd,
    input.rawEventCapture ? "raw" : "normal",
  ].join(":");
}

function codexModelProviderMatches(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = codexComparableModelProvider(left);
  const normalizedRight = codexComparableModelProvider(right);
  return normalizedLeft === normalizedRight;
}

function codexStoredModelProvider(
  responseModelProvider: string | null | undefined,
  requestedModelProvider: string | undefined,
): string | undefined {
  const value = responseModelProvider ?? requestedModelProvider;
  if (!requestedModelProvider && codexComparableModelProvider(value) === "") {
    return undefined;
  }
  return value ?? requestedModelProvider;
}

function codexComparableModelProvider(value: string | null | undefined): string {
  const normalized = value?.trim() ?? "";
  return normalized === "openai" ? "" : normalized;
}

function shouldExposeCodexDynamicTools(request: AgentTurnRequest): boolean {
  if (request.requestedSkillInvocation) {
    return true;
  }
  return /browser|computer|memory|selection|网页|浏览器|页面|选中|桌面|窗口|点击|保存笔记|记住|记忆/.test(
    request.input,
  );
}
