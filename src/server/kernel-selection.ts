import { getEnvApiKey, type Model } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { JsonObject } from "../core.js";
import {
  APP_KNOWLEDGE_SCOPE,
  APP_PRODUCT_NAME,
  APP_PROTOCOL_ID,
  APP_VAULT_DIR,
  APP_VAULT_ROOT_NAME,
  appEnvName,
  readAppEnv,
} from "../identity.js";
import { createRuntimeKernelAdapter } from "../kernel/adapter.js";
import { createClaudeCodeKernelAdapter, discoverClaudeCodeKernel } from "../kernel/adapters/claude-code.js";
import { createCodexKernelAdapter, discoverCodexKernel } from "../kernel/adapters/codex.js";
import { createHermesKernelAdapter, discoverHermesKernel } from "../kernel/adapters/hermes.js";
import { PI_KERNEL_CONTRACT } from "../kernel/adapters/pi.js";
import type { KernelAdapter, KernelDiscovery, KernelKnowledgeSource } from "../kernel/types.js";
import { resolveClaudeCodeCliPath } from "../runtime/claude-code-runtime.js";
import { resolveCodexCommandPath } from "../runtime/codex-runtime.js";
import { resolveHermesCommandPath } from "../runtime/hermes-runtime.js";
import { createNativePiSessionFactory } from "../runtime/native-pi-session.js";
import { PiAgentRuntime } from "../runtime/pi-runtime.js";
import { createScriptedCompanionSession } from "../runtime/scripted-session.js";
import { defaultHermesExternalSkillDir } from "../skills/native-publisher.js";
import {
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "../runtime/provider-http-capture.js";
import type {
  BridgeKernelId,
  BridgeKernelPreference,
  BridgeModelId,
  BridgeState,
} from "./bridge-types.js";
import {
  BRIDGE_MODEL_IDS,
  BRIDGE_KERNEL_IDS,
  DEFAULT_BRIDGE_MODEL_ID,
} from "./bridge-types.js";

export function createBridgeKernel(state: BridgeState): KernelAdapter {
  const kernel = resolveBridgeKernel(state.settings.kernel);
  state.kernel = kernel;
  const providerHttpCapture = readProviderHttpCaptureOptions(state, kernel);

  if (kernel === "claude-code") {
    const cliPath = resolveClaudeCodeCliPath(process.cwd());
    if (!cliPath) {
      throw new Error(`Claude Code CLI source was not found. Set ${appEnvName("CLAUDE_CLI_PATH")}.`);
    }
    return createClaudeCodeKernelAdapter({
      cliPath,
      cwd: process.cwd(),
      configuredBaseUrl: readClaudeBaseUrl(),
      configuredAuthToken: readClaudeAuthToken(),
      configuredModel: readClaudeConfiguredModel(),
      permissionMode: "bypassPermissions",
      providerHttpCapture,
    });
  }

  if (kernel === "codex") {
    const command = resolveCodexCommandPath();
    if (!command) {
      throw new Error(`Codex CLI was not found. Set ${appEnvName("CODEX_BIN")}.`);
    }
    return createCodexKernelAdapter({
      command,
      cwd: process.cwd(),
      configuredModel: readCodexConfiguredModel(),
      approvalPolicy: readCodexApprovalPolicy(),
      sandbox: readCodexSandbox(),
      statePath: resolve(dirname(state.store.path), "codex-threads.json"),
      providerHttpCapture,
    });
  }

  if (kernel === "hermes") {
    const command = resolveHermesCommandPath();
    if (!command) {
      throw new Error(`Hermes CLI was not found. Set ${appEnvName("HERMES_BIN")}.`);
    }
    return createHermesKernelAdapter({
      command,
      cwd: process.cwd(),
      configuredModel: readHermesConfiguredModel(),
      configuredProvider: readHermesConfiguredProvider(),
      toolsets: readHermesToolsets(),
      nativeSkillDir: defaultHermesExternalSkillDir(process.cwd()),
      providerHttpCapture,
    });
  }

  if (kernel === "pi") {
    return createRuntimeKernelAdapter({
      id: "pi",
      title: "Pi",
      runtime: new PiAgentRuntime({
        createSession: createNativePiSessionFactory({
          model: (requestedModelId) =>
            resolveNativeModel(readBridgeModelOverride(requestedModelId) ?? state.model),
          getApiKey: getBridgeModelApiKey,
          thinkingLevel: (requestedEffort) =>
            resolveRequestedThinkingLevel(requestedEffort) ?? readThinkingLevel(),
          toolExecution: "sequential",
          retainedMessageLimit: 40,
        }),
      }),
      capabilities: {
        streaming: true,
        toolCalls: true,
        hostTools: true,
        approvals: true,
        elicitation: false,
        artifacts: true,
        compaction: false,
        authRefresh: false,
        sandbox: ["danger-full-access"],
        knowledge: {
          nativeSkills: false,
          toolMediatedSkills: true,
          progressiveDisclosure: true,
          nativeArtifacts: false,
          deliveryLedger: true,
        },
      },
      contract: PI_KERNEL_CONTRACT,
    });
  }

  return createRuntimeKernelAdapter({
    id: "scripted",
    title: "Scripted",
    runtime: new PiAgentRuntime({
      createSession: () =>
        createScriptedCompanionSession({
          saveCandidateNote: state.saveCandidateNote,
        }),
    }),
    capabilities: {
      streaming: true,
      toolCalls: true,
      hostTools: true,
      approvals: true,
      elicitation: false,
      artifacts: true,
      compaction: false,
      authRefresh: false,
      sandbox: ["danger-full-access"],
      knowledge: {
        nativeSkills: false,
        toolMediatedSkills: true,
        progressiveDisclosure: true,
        nativeArtifacts: false,
        deliveryLedger: true,
      },
    },
  });
}

export function getBridgeKernelOptions(state: BridgeState): JsonObject[] {
  const active = resolveBridgeKernel(state.settings.kernel);
  const options: JsonObject[] = [
    {
      id: "auto",
      label: "自动选择",
      description: "按 Codex → Claude Code → Hermes → Pi → Scripted 的顺序选择可用内核。",
      available: true,
      active: state.settings.kernel === "auto",
      resolved: active,
    },
  ];

  for (const id of BRIDGE_KERNEL_IDS) {
    const available =
      id === "codex"
        ? canUseCodexKernel()
        : id === "claude-code"
          ? canUseClaudeKernel()
          : id === "hermes"
            ? canUseHermesKernel()
            : id === "pi"
              ? canUsePiKernel()
              : true;
    const discovery = buildKernelDiscoverySnapshot(id, state, available);
    options.push(stripUndefined({
      id,
      label:
        id === "claude-code"
          ? "Claude Code"
          : id === "hermes"
            ? "Hermes"
            : id === "pi"
              ? "Pi"
              : id === "scripted"
                ? "Scripted demo"
                : "Codex",
      description:
        id === "codex"
          ? "使用 Codex CLI / app-server，保留 Codex 原生工具、审批、elicitation、compact 等能力。"
          : id === "claude-code"
            ? "使用 Claude Code CLI。当前桥接仍偏 CLI stream，审批/host tool parity 低于 Codex。"
            : id === "hermes"
            ? `使用 Hermes CLI oneshot。支持 Hermes 原生 skill list/view/external_dirs；当前 ${APP_PRODUCT_NAME} 只能看到最终文本，原生工具细节还不会逐条流回。`
            : id === "pi"
                ? `使用 ${APP_PRODUCT_NAME} 自带的 OpenAI-compatible loop，适合调试 ${APP_PRODUCT_NAME} 自有工具链。`
                : "本地脚本内核，用于无模型依赖的 UI/知识库流程演示。",
      available,
      active: state.settings.kernel === id,
      reason: available
        ? ""
        : id === "codex"
          ? "未找到 Codex CLI。"
          : id === "claude-code"
            ? "未找到 Claude Code CLI。"
            : id === "hermes"
              ? `未找到 Hermes CLI。安装 Hermes 或设置 ${appEnvName("HERMES_BIN")}。`
              : id === "pi"
                ? `缺少 ${appEnvName("MODEL_BASE_URL")} 或 OpenAI-compatible API key。`
            : "",
      installed: discovery.installed,
      binaryPath: discovery.binaryPath,
      version: discovery.version,
      configHome: discovery.configHome,
      sources: discovery.knowledgeSources
        .filter(isPrimarySettingsKnowledgeSource)
        .map((source) => serializeKernelSource(id, source, state)),
      installActions: discovery.installActions ?? [],
      diagnostics: discovery.diagnostics ?? {},
      notes: discovery.notes ?? [],
    }) as JsonObject);
  }

  return options;
}

function isPrimarySettingsKnowledgeSource(source: KernelKnowledgeSource): boolean {
  return source.userVisible !== false && source.knowledgeLike !== false;
}

function buildKernelDiscoverySnapshot(
  id: BridgeKernelId,
  state: BridgeState,
  available: boolean,
): KernelDiscovery {
  const cwd = process.cwd();
  if (id === "codex") {
    const command = resolveCodexCommandPath();
    return {
      ...discoverCodexKernel({ command: command || undefined, cwd }, cwd),
      installed: available,
      available,
    };
  }
  if (id === "claude-code") {
    const cliPath = resolveClaudeCodeCliPath(cwd);
    return {
      ...discoverClaudeCodeKernel(cliPath ? { cliPath, cwd } : {}, cwd),
      installed: available,
      available,
    };
  }
  if (id === "hermes") {
    const command = resolveHermesCommandPath();
    return {
      ...discoverHermesKernel({
        command: command || undefined,
        cwd,
        nativeSkillDir: defaultHermesExternalSkillDir(cwd),
      }, cwd),
      installed: available,
      available,
    };
  }
  const base = createRuntimeKernelDiscovery(id, id === "pi" ? "Pi" : "Scripted demo", available, cwd);
  return base;
}

function createRuntimeKernelDiscovery(
  kernelId: BridgeKernelId,
  title: string,
  available: boolean,
  cwd: string,
): KernelDiscovery {
  const vaultRoot = resolve(cwd, "data", APP_VAULT_DIR);
  const appVaultRoot = resolve(vaultRoot, APP_VAULT_ROOT_NAME);
  return {
    kernelId,
    title,
    installed: available,
    available,
    configHome: vaultRoot,
    diagnostics: kernelId === "pi" ? PI_KERNEL_CONTRACT.diagnostics : undefined,
    knowledgeSources: [
      {
        id: `${kernelId}.${APP_PROTOCOL_ID}-vault`,
        title: `${APP_PRODUCT_NAME} Vault`,
        kind: "vault",
        scope: APP_KNOWLEDGE_SCOPE,
        path: vaultRoot,
        exists: existsSync(vaultRoot),
        readable: true,
        writable: true,
        native: false,
        userVisible: true,
        knowledgeLike: true,
        enabledByDefault: true,
        syncMode: "mirror",
        description: `${APP_PRODUCT_NAME} 自己维护的知识库根目录。`,
      },
      {
        id: `${kernelId}.${APP_PROTOCOL_ID}-skills`,
        title: `${APP_PRODUCT_NAME} skills`,
        kind: "skills",
        scope: APP_KNOWLEDGE_SCOPE,
        path: resolve(appVaultRoot, "skills"),
        exists: existsSync(resolve(appVaultRoot, "skills")),
        readable: true,
        writable: true,
        native: false,
        userVisible: true,
        knowledgeLike: true,
        enabledByDefault: true,
        syncMode: "mirror",
      },
      {
        id: `${kernelId}.${APP_PROTOCOL_ID}-artifacts`,
        title: `${APP_PRODUCT_NAME} artifacts`,
        kind: "artifacts",
        scope: APP_KNOWLEDGE_SCOPE,
        path: resolve(appVaultRoot, "artifacts"),
        exists: existsSync(resolve(appVaultRoot, "artifacts")),
        readable: true,
        writable: true,
        native: false,
        userVisible: true,
        knowledgeLike: true,
        enabledByDefault: true,
        syncMode: "mirror",
      },
    ],
    notes: [
      kernelId === "pi"
        ? `Pi 使用 ${APP_PRODUCT_NAME} 自己的 tool-mediated skill/memory/artifact 机制，没有单独原生目录。`
        : `Scripted demo 只用于本地演示，真实知识来源都在 ${APP_PRODUCT_NAME} Vault。`,
    ],
  };
}

function serializeKernelSource(
  kernelId: BridgeKernelId,
  source: KernelKnowledgeSource,
  state: BridgeState,
): JsonObject {
  const overrides = state.settings.kernelKnowledgeSourceEnabled[kernelId] ?? {};
  const enabled = typeof overrides[source.id] === "boolean"
    ? overrides[source.id]
    : source.enabled ?? source.enabledByDefault ?? true;
  return stripUndefined({
    ...source,
    enabled,
  }) as JsonObject;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      output[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? stripUndefined(item as Record<string, unknown>)
          : item,
      );
      continue;
    }
    if (value && typeof value === "object") {
      output[key] = stripUndefined(value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output;
}

export function readProviderHttpCaptureOptions(
  state: BridgeState,
  kernel: BridgeKernelId = state.kernel,
): ProviderHttpCaptureOptions {
  if (!state.settings.providerHttpCaptureEnabled) {
    return { enabled: false, inject: false, kernelId: kernel, status: "disabled" };
  }
  const serviceState = readProviderHttpCaptureServiceState();
  const serviceRunning = Boolean(serviceState?.pid && isPidAlive(serviceState.pid));
  if (!serviceRunning) {
    return {
      enabled: true,
      inject: false,
      kernelId: kernel,
      status: "service-not-running",
      warning: "抓包开关已开启，但 mitmproxy 服务没有运行；本轮不会向内核注入代理，避免把会话直接打挂。",
    };
  }

  if (kernel === "pi" || kernel === "scripted") {
    return {
      enabled: true,
      inject: false,
      kernelId: kernel,
      status: "unsupported",
      proxyUrl: stringValue(serviceState?.proxyUrl) || undefined,
      caCertPath: stringValue(serviceState?.caCertPath) || undefined,
      startedAt: stringValue(serviceState?.startedAt) || undefined,
      runDir: stringValue(serviceState?.runDir) || undefined,
      summaryPath: stringValue(serviceState?.summaryPath) || undefined,
      webUrl: stringValue(serviceState?.webUrl) || undefined,
      warning: "当前内核不通过外部 CLI 子进程访问 provider，HTTPS 抓包不会注入到该内核。",
    };
  }

  return {
    enabled: true,
    inject: true,
    kernelId: kernel,
    status: "ready",
    proxyUrl: stringValue(serviceState?.proxyUrl) || undefined,
    caCertPath: stringValue(serviceState?.caCertPath) || undefined,
    startedAt: stringValue(serviceState?.startedAt) || undefined,
    runDir: stringValue(serviceState?.runDir) || undefined,
    summaryPath: stringValue(serviceState?.summaryPath) || undefined,
    webUrl: stringValue(serviceState?.webUrl) || undefined,
  };
}

export function getProviderHttpCaptureSnapshot(state: BridgeState): JsonObject {
  const activeKernel = state.kernel || resolveBridgeKernel(state.settings.kernel);
  const capture = resolveProviderHttpCaptureOptions(readProviderHttpCaptureOptions(state, activeKernel), process.env);
  const serviceState = readProviderHttpCaptureServiceState();
  const serviceRunning = Boolean(serviceState?.pid && isPidAlive(serviceState.pid));
  return {
    ...providerHttpCaptureSummary(capture),
    running: serviceRunning,
    startedAt: stringValue(serviceState?.startedAt),
    webUrl: stringValue(serviceState?.webUrl),
    runDir: stringValue(serviceState?.runDir),
    summaryPath: stringValue(serviceState?.summaryPath),
    statePath: providerHttpCaptureServiceStatePath(),
    warning:
      capture.warning ||
      (capture.enabled && !serviceRunning
        ? `抓包开关已开启，但本地 mitmproxy 服务未运行；${APP_PRODUCT_NAME} 不会注入一个不可用代理。`
        : ""),
  };
}

export function resolveBridgeKernel(preferred: BridgeKernelPreference): BridgeKernelId {
  if (preferred !== "auto") {
    if (preferred === "codex" && !canUseCodexKernel()) {
      throw new Error("Codex kernel is not available. Install Codex CLI or choose another kernel.");
    }
    if (preferred === "claude-code" && !canUseClaudeKernel()) {
      throw new Error("Claude Code kernel is not available. Install Claude Code CLI or choose another kernel.");
    }
    if (preferred === "hermes" && !canUseHermesKernel()) {
      throw new Error("Hermes kernel is not available. Install Hermes CLI or choose another kernel.");
    }
    if (preferred === "pi" && !canUsePiKernel()) {
      throw new Error(`Pi kernel is not available. Configure ${appEnvName("MODEL_BASE_URL")} and API key or choose another kernel.`);
    }
    return preferred;
  }
  if (canUseCodexKernel()) return "codex";
  if (canUseClaudeKernel()) return "claude-code";
  if (canUseHermesKernel()) return "hermes";
  if (canUsePiKernel()) return "pi";
  return "scripted";
}

function canUseClaudeKernel() {
  if (!resolveClaudeCodeCliPath(process.cwd())) {
    return false;
  }

  if (readClaudeBaseUrl() && readClaudeAuthToken()) {
    return true;
  }

  return existsSync(resolve(homedir(), ".claude", "settings.json"));
}

function canUseCodexKernel() {
  return Boolean(resolveCodexCommandPath());
}

function canUseHermesKernel() {
  return Boolean(resolveHermesCommandPath());
}

function canUsePiKernel() {
  return Boolean(
    readAppEnv("SESSION") === "native" ||
      (readAppEnv("MODEL_BASE_URL")?.trim() && getBridgeModelApiKey("openai")),
  );
}

function resolveNativeModel(modelId: BridgeModelId): Model<any> {
  const metadata = {
    "MiMo-V2-Pro": {
      apiId: "mimo-v2-pro",
      name: "MiMo-V2-Pro",
      contextWindow: 1_000_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "gpt-5.4": {
      apiId: "gpt-5.4",
      name: "Codex",
      contextWindow: 272_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "claude-opus-4-6": {
      apiId: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: false,
    },
  } satisfies Record<
    BridgeModelId,
    { apiId: string; name: string; contextWindow: number; maxTokens: number; reasoning: boolean }
  >;
  const config = metadata[modelId];

  return {
    id: config.apiId,
    name: config.name,
    api: "openai-completions",
    provider: "openai",
    baseUrl: readModelBaseUrl(),
    reasoning: config.reasoning,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      requiresToolResultName: false,
      requiresAssistantAfterToolResult: false,
      requiresThinkingAsText: true,
      supportsStrictMode: false,
    },
  } as Model<any>;
}

function readModelBaseUrl() {
  const value = readAppEnv("MODEL_BASE_URL");
  if (!value) {
    throw new Error(`${appEnvName("MODEL_BASE_URL")} is required for native model calls.`);
  }
  return normalizeOpenAIBaseUrl(value);
}

function normalizeOpenAIBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error(`${appEnvName("MODEL_BASE_URL")} is required for native model calls.`);
  }
  return /\/v\d+$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

function getBridgeModelApiKey(provider: string) {
  return readAppEnv("MODEL_API_KEY") || getEnvApiKey(provider);
}

function readClaudeBaseUrl() {
  const raw =
    readAppEnv("CLAUDE_BASE_URL")?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim() ||
    "";
  return raw;
}

function readClaudeAuthToken() {
  return (
    readAppEnv("CLAUDE_AUTH_TOKEN")?.trim() ||
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    ""
  );
}

function readClaudeConfiguredModel() {
  const explicit = readAppEnv("CLAUDE_MODEL")?.trim();
  if (explicit) {
    return explicit;
  }
  const selected = readAppEnv("KERNEL") === "claude-code"
    ? readAppEnv("DEFAULT_MODEL")?.trim()
    : "";
  return isClaudeModelId(selected) ? selected : undefined;
}

function isClaudeModelId(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return (
    normalized.startsWith("claude") ||
    normalized.startsWith("anthropic/claude") ||
    normalized.includes(".anthropic.claude") ||
    normalized === "sonnet" ||
    normalized === "opus" ||
    normalized === "haiku"
  );
}

function readCodexConfiguredModel() {
  return (
    readAppEnv("CODEX_MODEL")?.trim() ||
    (readAppEnv("KERNEL") === "codex"
      ? readAppEnv("DEFAULT_MODEL")?.trim()
      : "") ||
    "gpt-5.4"
  );
}

function readCodexApprovalPolicy() {
  const value = readAppEnv("CODEX_APPROVAL_POLICY");
  return value === "never" ||
    value === "on-request" ||
    value === "on-failure" ||
    value === "untrusted"
    ? value
    : "never";
}

function readCodexSandbox() {
  const value = readAppEnv("CODEX_SANDBOX");
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
    ? value
    : "danger-full-access";
}

function readHermesConfiguredModel() {
  return (
    readAppEnv("HERMES_MODEL")?.trim() ||
    (readAppEnv("KERNEL") === "hermes"
      ? readAppEnv("DEFAULT_MODEL")?.trim()
      : "") ||
    undefined
  );
}

function readHermesConfiguredProvider() {
  return readAppEnv("HERMES_PROVIDER")?.trim() || undefined;
}

function readHermesToolsets() {
  const raw = readAppEnv("HERMES_TOOLSETS")?.trim();
  if (!raw) {
    return undefined;
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function readBridgeModelOverride(value: unknown): BridgeModelId | undefined {
  return typeof value === "string" && (BRIDGE_MODEL_IDS as readonly string[]).includes(value)
    ? (value as BridgeModelId)
    : undefined;
}

function resolveRequestedThinkingLevel(value: unknown) {
  return value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : undefined;
}

function readThinkingLevel() {
  const value = readAppEnv("PI_THINKING");
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : "off";
}

function providerHttpCaptureServiceStatePath(): string {
  return resolve(
    process.cwd(),
    readAppEnv("PROVIDER_HTTP_CAPTURE_ROOT") ?? "data/provider-http-captures",
    "capture-state.json",
  );
}

function readProviderHttpCaptureServiceState(): Record<string, unknown> | undefined {
  try {
    const state = JSON.parse(readFileSync(providerHttpCaptureServiceStatePath(), "utf8")) as Record<string, unknown>;
    const running = isPidAlive(state.pid);
    return { ...state, running };
  } catch {
    return undefined;
  }
}

function isPidAlive(value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function isEnabledEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function normalizeBridgeKernelPreference(value: unknown, fallback: BridgeKernelPreference): BridgeKernelPreference {
  if (
    value === "auto" ||
    value === "codex" ||
    value === "claude-code" ||
    value === "hermes" ||
    value === "pi" ||
    value === "scripted"
  ) {
    return value;
  }
  return fallback;
}

export function defaultBridgeKernelPreference(): BridgeKernelPreference {
  return "auto";
}

export function defaultBridgeModelId(): BridgeModelId {
  return DEFAULT_BRIDGE_MODEL_ID;
}
