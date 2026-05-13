import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readAppEnv } from "../identity.js";
import { resolveCommandPath } from "../kernel/discovery.js";
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

export interface HermesRuntimeOptions {
  command: string;
  commandArgs?: string[];
  acpArgs?: string[];
  cwd?: string;
  configuredModel?: string;
  configuredProvider?: string;
  runtimeBindingFingerprint?: string;
  providerConfig?: HermesProviderRuntimeConfig;
  toolsets?: string[];
  nativeSkillDir?: string;
  providerHttpCapture?: ProviderHttpCaptureOptions;
  requestTimeoutMs?: number;
  approvalTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export type HermesProviderApiMode = "chat_completions" | "anthropic_messages";

export interface HermesProviderRuntimeConfig {
  providerKey: string;
  name: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiMode: HermesProviderApiMode;
  model?: string;
  models?: string[];
}

export class HermesRuntime implements AgentRuntime {
  private isolatedHome?: string;
  private acpClient?: StdioJsonRpcClient;
  private readonly acpSessions = new Set<string>();

  constructor(private readonly options: HermesRuntimeOptions) {}

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
        queue.push({
          type: "error",
          runId,
          message: error instanceof Error ? error.message : String(error),
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
        const nativeSessionId = readRememberedHermesAcpSession(request, this.options.runtimeBindingFingerprint)?.sessionId;
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
    const requestedProvider = normalizeOptionalString(this.options.configuredProvider);
    const prompt = buildHermesPrompt(request);
    const providerCapture = resolveProviderHttpCaptureOptions(
      this.options.providerHttpCapture,
      this.options.env,
    );
    const client = await this.ensureAcpClient(providerCapture);
    const cwd = resolve(this.options.cwd ?? process.cwd());
    const nativeSession = await this.ensureAcpSession(client, request, cwd, requestedModel);
    const priorMessages = recentSessionMessages(request);
    const sessionTrace: AgentSessionTrace = {
      provider: "hermes",
      sessionId: nativeSession.sessionId,
      persistent: true,
      priorMessageCount: nativeSession.resuming ? priorMessages.length : 0,
      priorMessages: nativeSession.resuming ? priorMessages : [],
    };
    let assistantText = "";
    const projector = new AcpSessionProjector({
      runId,
      kernelId: "hermes",
      diagnosticPrefix: "hermes.acp",
      toolFailureMessage: "Hermes tool failed",
      onAssistantText(text) {
        assistantText += stripHermesTemplateTokens(text);
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
      name: "hermes.acp.session",
      data: {
        sessionId: nativeSession.sessionId,
        resuming: nativeSession.resuming,
        provider: requestedProvider ?? "",
      },
    });
    queue.push({
      type: "model.requested",
      runId,
      request: {
        systemPrompt: "Hermes ACP mode. OpenGrove host context is prepended to the user prompt when present.",
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
      if (notification.method !== "session/update") return;
      const params = asObject(notification.params);
      if (readString(params, "sessionId") !== nativeSession.sessionId) return;
      const update = asObject(params.update);
      for (const event of projector.project(update)) {
        if (event.type === "assistant.delta") {
          const text = stripHermesTemplateTokens(event.text);
          if (text) queue.push({ ...event, text });
          continue;
        }
        queue.push(event);
      }
    });
    const cleanupRequests = client.addRequestHandler(async (rpcRequest) => {
      if (rpcRequest.method !== "session/request_permission") return undefined;
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
      const response = await client.request(
        "session/prompt",
        {
          sessionId: nativeSession.sessionId,
          messageId: randomUUID(),
          prompt: [{ type: "text", text: prompt }],
        },
        {
          timeoutMs: this.options.requestTimeoutMs ?? 900_000,
          signal: request.signal,
        },
      );
      const usage = readAcpUsage(response);
      const finalText = cleanHermesAssistantText(assistantText);
      if (!finalText.trim()) {
        const diagnostic = this.readHermesFailureDiagnostic() || client.stderr().trim();
        if (diagnostic) {
          queue.push({
            type: "runtime.diagnostic",
            runId,
            at: new Date().toISOString(),
            name: "hermes.acp.empty_response_diagnostic",
            data: { diagnostic },
          });
        }
        queue.push({
          type: "error",
          runId,
          message: diagnostic || "hermes_empty_response",
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
      queue.push({
        type: "error",
        runId,
        message: client.stderr().trim() || message || "hermes_acp_failed",
      });
    } finally {
      request.signal?.removeEventListener("abort", abortPrompt);
      cleanupRequests();
      cleanupNotifications();
    }
  }

  private async ensureAcpClient(
    providerCapture: ReturnType<typeof resolveProviderHttpCaptureOptions>,
  ): Promise<StdioJsonRpcClient> {
    if (this.acpClient && !this.acpClient.isClosed()) {
      return this.acpClient;
    }
    const args = [
      ...(this.options.commandArgs ?? []),
      ...(this.options.acpArgs ?? ["acp", "--accept-hooks"]),
    ];
    const client = StdioJsonRpcClient.start({
      command: this.options.command,
      args,
      cwd: this.options.cwd ?? process.cwd(),
      env: this.prepareEnv(providerCapture),
    });
    this.acpClient = client;
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
    const remembered = readRememberedHermesAcpSession(request, this.options.runtimeBindingFingerprint);
    if (remembered?.sessionId && this.acpSessions.has(remembered.sessionId)) {
      if (requestedModel) {
        await this.setAcpSessionModel(client, remembered.sessionId, requestedModel);
      }
      return { sessionId: remembered.sessionId, resuming: true };
    }

    const created = asObject(await client.request(
      "session/new",
      { cwd, mcpServers: [] },
      { timeoutMs: 30_000 },
    ));
    const sessionId = readString(created, "sessionId");
    if (!sessionId) {
      throw new Error("hermes_acp_session_id_missing");
    }
    this.acpSessions.add(sessionId);
    rememberHermesAcpSession(request, sessionId, this.options.runtimeBindingFingerprint);
    if (requestedModel) {
      await this.setAcpSessionModel(client, sessionId, requestedModel);
    }
    return { sessionId, resuming: false };
  }

  private async setAcpSessionModel(
    client: StdioJsonRpcClient,
    sessionId: string,
    requestedModel: string,
  ): Promise<void> {
    try {
      await client.request(
        "session/set_model",
        { sessionId, modelId: requestedModel },
        { timeoutMs: 15_000 },
      );
    } catch {
      // Model switching is an unstable ACP capability. Hermes can still use the
      // generated config.yaml default model when this request is unavailable.
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
      options.find((option) => readString(option, "optionId")?.startsWith("allow"));
    const allowOptionId = allowOption ? readString(allowOption, "optionId") : undefined;
    const denyResponse: JsonObject = { outcome: { outcome: "cancelled" } };
    const approval = createHermesAcpApproval(params, context.runId, context.request);
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
    return denyResponse;
  }

  private prepareEnv(providerCapture: ReturnType<typeof resolveProviderHttpCaptureOptions>): NodeJS.ProcessEnv {
    const env = applyProviderHttpCaptureEnv({ ...process.env, ...this.options.env }, providerCapture);
    const providerConfig = normalizeHermesProviderConfig(this.options.providerConfig);
    const explicitHome = normalizeOptionalString(readAppEnv("HERMES_HOME"));
    // Provider bindings need a generated config.yaml, so they use an isolated Hermes home.
    if (explicitHome && !providerConfig) {
      env.HERMES_HOME = resolve(explicitHome);
      return env;
    }

    const useIsolatedHome = Boolean(providerConfig) || readAppEnv("HERMES_ISOLATED_HOME") !== "0";
    if (!useIsolatedHome) {
      return env;
    }

    const nativeSkillDir = normalizeOptionalString(this.options.nativeSkillDir);
    const usableNativeSkillDir = nativeSkillDir && existsSync(nativeSkillDir) ? nativeSkillDir : undefined;
    if (!usableNativeSkillDir && !providerConfig) {
      return env;
    }

    const home = this.ensureIsolatedHome(usableNativeSkillDir, providerConfig);
    env.HERMES_HOME = home;
    return env;
  }

  private ensureIsolatedHome(
    nativeSkillDir: string | undefined,
    providerConfig: HermesProviderRuntimeConfig | undefined,
  ): string {
    if (!this.isolatedHome) {
      this.isolatedHome = mkdtempSync(join(tmpdir(), "opengrove-hermes-"));
      writeHermesHomeConfig(this.isolatedHome, nativeSkillDir, providerConfig);
    }
    return this.isolatedHome;
  }

  private readHermesFailureDiagnostic(): string | undefined {
    const sessionsDir = this.isolatedHome ? resolve(this.isolatedHome, "sessions") : undefined;
    if (!sessionsDir || !existsSync(sessionsDir)) return undefined;
    try {
      const latestDump = readdirSync(sessionsDir)
        .filter((name) => name.startsWith("request_dump_") && name.endsWith(".json"))
        .map((name) => {
          const path = resolve(sessionsDir, name);
          return { path, mtimeMs: statSync(path).mtimeMs };
        })
        .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path;
      if (!latestDump) return undefined;
      const parsed = JSON.parse(readFileSync(latestDump, "utf8")) as {
        reason?: unknown;
        error?: {
          message?: unknown;
          status_code?: unknown;
          code?: unknown;
        };
      };
      const reason = typeof parsed.reason === "string" ? parsed.reason : "request_failed";
      const message = typeof parsed.error?.message === "string" ? parsed.error.message : undefined;
      const status = typeof parsed.error?.status_code === "number" ? String(parsed.error.status_code) : undefined;
      const code = typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
      return [reason, status, code, message].filter(Boolean).join(": ");
    } catch {
      return undefined;
    }
  }
}

export function resolveHermesCommandPath(): string | undefined {
  const envPath = readAppEnv("HERMES_BIN")?.trim();
  const resolvedEnvPath = resolveHermesCommandCandidate(envPath);
  if (resolvedEnvPath) {
    return resolvedEnvPath;
  }

  const systemHermes = resolveHermesCommandCandidate("hermes");
  if (systemHermes) {
    return systemHermes;
  }

  for (const candidate of [
    resolve(homedir(), ".local", "bin", "hermes"),
    "/opt/homebrew/bin/hermes",
    "/usr/local/bin/hermes",
    "/usr/bin/hermes",
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function hermesHealth(command: string): { ok: boolean; message: string } {
  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
    if (result.status === 0) {
      const version = (result.stdout || result.stderr || "").trim();
      return { ok: true, message: version || "Hermes CLI is available." };
    }
    return {
      ok: false,
      message: (result.stderr || result.stdout || "").trim() || `Hermes CLI exited with ${result.status}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function buildHermesPrompt(request: AgentTurnRequest): string {
  const hostContext = request.assembledContext?.promptBlock?.trim();
  const threadHistory = recentSessionPromptBlock(request);
  const skillHint = request.requestedSkillInvocation
    ? [
        `The user invoked OpenGrove skill /${request.requestedSkillInvocation.skillName}.`,
        "Hermes should use its native skills_list / skill_view mechanism when the skill is available there.",
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

function writeHermesHomeConfig(
  homeDir: string,
  nativeSkillDir: string | undefined,
  providerConfig: HermesProviderRuntimeConfig | undefined,
): void {
  mkdirSync(homeDir, { recursive: true });
  const sourceEnv = resolve(homedir(), ".hermes", ".env");
  if (existsSync(sourceEnv)) {
    try {
      copyFileSync(sourceEnv, resolve(homeDir, ".env"));
    } catch {
      // Ignore copy failures; Hermes can still use process env credentials.
    }
  }
  writeFileSync(resolve(homeDir, "config.yaml"), buildHermesConfigYaml(nativeSkillDir, providerConfig), "utf8");
}

function buildHermesConfigYaml(
  nativeSkillDir: string | undefined,
  providerConfig: HermesProviderRuntimeConfig | undefined,
): string {
  const lines: string[] = [];
  if (providerConfig) {
    lines.push("model:");
    lines.push(`  provider: ${yamlScalar(providerConfig.providerKey)}`);
    if (providerConfig.model) {
      lines.push(`  default: ${yamlScalar(providerConfig.model)}`);
    }
    lines.push(`  base_url: ${yamlScalar(providerConfig.baseUrl)}`);
    lines.push(`  api_mode: ${yamlScalar(providerConfig.apiMode)}`);
    if (providerConfig.apiKeyEnv) {
      lines.push(`  key_env: ${yamlScalar(providerConfig.apiKeyEnv)}`);
    }
    lines.push("");
    lines.push("providers:");
    lines.push(`  ${yamlScalar(providerConfig.providerKey)}:`);
    lines.push(`    name: ${yamlScalar(providerConfig.name)}`);
    lines.push(`    base_url: ${yamlScalar(providerConfig.baseUrl)}`);
    if (providerConfig.apiKeyEnv) {
      lines.push(`    key_env: ${yamlScalar(providerConfig.apiKeyEnv)}`);
    }
    lines.push(`    transport: ${yamlScalar(providerConfig.apiMode)}`);
    if (providerConfig.model) {
      lines.push(`    default_model: ${yamlScalar(providerConfig.model)}`);
    }
    if (providerConfig.models?.length) {
      lines.push("    models:");
      for (const model of providerConfig.models) {
        lines.push(`      ${yamlScalar(model)}: {}`);
      }
    }
    lines.push("");
  }

  if (nativeSkillDir) {
    const normalizedSkillDir = resolve(nativeSkillDir);
    lines.push("skills:");
    lines.push("  external_dirs:");
    lines.push(`    - ${yamlScalar(normalizedSkillDir)}`);
    lines.push("");
  }

  return lines.join("\n");
}

function normalizeHermesProviderConfig(
  input: HermesProviderRuntimeConfig | undefined,
): HermesProviderRuntimeConfig | undefined {
  const providerKey = normalizeOptionalString(input?.providerKey);
  const name = normalizeOptionalString(input?.name);
  const baseUrl = normalizeOptionalString(input?.baseUrl);
  const apiMode = input?.apiMode === "anthropic_messages" ? "anthropic_messages" : "chat_completions";
  if (!providerKey || !name || !baseUrl) return undefined;
  return {
    providerKey,
    name,
    baseUrl,
    apiMode,
    apiKeyEnv: normalizeOptionalString(input?.apiKeyEnv),
    model: normalizeOptionalString(input?.model),
    models: Array.from(new Set((input?.models ?? []).map((model) => model.trim()).filter(Boolean))),
  };
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function resolveHermesCommandCandidate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return resolveCommandPath(trimmed);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanHermesAssistantText(value: string): string {
  return stripHermesTemplateTokens(value).trimEnd();
}

function stripHermesTemplateTokens(value: string): string {
  return value.replace(/<\|(?:assistant|user|system|observation|tool|end|endoftext)\|>/g, "");
}

function createHermesAcpApproval(
  params: Record<string, unknown>,
  runId: string,
  request: AgentTurnRequest,
): ApprovalRequest {
  const toolCall = asObject(params.toolCall);
  const kind = readString(toolCall, "kind") === "execute" ? "command" : "tool";
  const title = readString(toolCall, "title") || "Hermes permission request";
  return request.context.approvals.request({
    kind,
    title,
    reason: `Hermes ACP requested permission for ${title}.`,
    toolId: defaultAcpToolId("hermes", toolCall),
    input: toJsonValue(params),
    resume: { type: "hermes.native", runId },
  });
}

function readRememberedHermesAcpSession(
  request: AgentTurnRequest,
  runtimeBindingFingerprint: string | undefined,
): { sessionId: string } | undefined {
  if (!request.context.sessions?.get) return undefined;
  const current = request.context.sessions.get(request.context.sessionId);
  const fingerprint = runtimeBindingFingerprint || "native";
  const sessionsByFingerprint = asObject(current?.metadata?.hermesAcpSessionIds);
  const sessionId = readString(sessionsByFingerprint, fingerprint);
  if (sessionId) return { sessionId };
  const legacy = fingerprint === "native" ? readString(asObject(current?.metadata), "hermesAcpSessionId") : undefined;
  return legacy ? { sessionId: legacy } : undefined;
}

function rememberHermesAcpSession(
  request: AgentTurnRequest,
  nativeSessionId: string,
  runtimeBindingFingerprint: string | undefined,
): void {
  if (!request.context.sessions?.get || !request.context.sessions?.ensureSession) return;
  const current = request.context.sessions.get(request.context.sessionId);
  const fingerprint = runtimeBindingFingerprint || "native";
  const currentSessionIds = asObject(current?.metadata?.hermesAcpSessionIds);
  const hermesAcpSessionIds: JsonObject = {};
  for (const [key, value] of Object.entries(currentSessionIds)) {
    if (typeof value === "string") {
      hermesAcpSessionIds[key] = value;
    }
  }
  hermesAcpSessionIds[fingerprint] = nativeSessionId;
  const metadata: JsonObject = {
    ...(current?.metadata ?? {}),
    hermesAcpSessionIds,
  };
  if (fingerprint === "native") {
    metadata.hermesAcpSessionId = nativeSessionId;
    metadata.hermesAcpSessionUpdatedAt = new Date().toISOString();
  }
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
