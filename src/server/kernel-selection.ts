import { getEnvApiKey, type Model } from "@mariozechner/pi-ai";
import { spawnSync } from "node:child_process";
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
import {
  EXTERNAL_CLI_KERNELS,
  createExternalCliKernelAdapter,
  discoverExternalCliKernel,
  externalCliDefinition,
  resolveExternalCliCommand,
} from "../kernel/adapters/external-cli.js";
import { createHermesKernelAdapter, discoverHermesKernel } from "../kernel/adapters/hermes.js";
import { PI_KERNEL_CONTRACT } from "../kernel/adapters/pi.js";
import type { KernelAdapter, KernelDiscovery, KernelKnowledgeSource } from "../kernel/types.js";
import { resolveClaudeCodeCliPath } from "../runtime/claude-code-runtime.js";
import { resolveCodexCommandPath } from "../runtime/codex-runtime.js";
import { resolveHermesCommandPath } from "../runtime/hermes-runtime.js";
import { createNativePiSessionFactory } from "../runtime/native-pi-session.js";
import { PiAgentRuntime } from "../runtime/pi-runtime.js";
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
  BridgeRuntimeControlOption,
  BridgeRuntimeControls,
  BridgeState,
} from "./bridge-types.js";
import {
  BRIDGE_MODEL_IDS,
  BRIDGE_KERNEL_IDS,
  DEFAULT_BRIDGE_MODEL_ID,
} from "./bridge-types.js";
import {
  providerEnvForKernel,
  providerModelsForKernel,
  resolveProviderForKernel,
} from "./provider-profiles.js";

export function createBridgeKernel(state: BridgeState): KernelAdapter {
  const kernel = resolveBridgeKernel(state.settings.kernel);
  state.kernel = kernel;
  const providerHttpCapture = readProviderHttpCaptureOptions(state, kernel);
  const provider = resolveProviderForKernel(kernel, state.settings.kernelProviderBindings, state.settings.customProviders);
  const providerModelOptions = providerModelsForKernel(kernel, provider);
  const providerDefaultModel = providerModelOptions.some((item) => item.id === state.model)
    ? state.model
    : providerModelOptions[0]?.id;
  const selectedModel = providerDefaultModel || state.model;
  const providerEnv = providerEnvForKernel(kernel, provider, selectedModel);

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
      configuredModel: provider ? (selectedModel || readClaudeConfiguredModel()) : readClaudeConfiguredModel(),
      permissionMode: "bypassPermissions",
      providerHttpCapture,
      env: providerEnv,
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
      configuredModel: provider ? (selectedModel || readCodexConfiguredModel()) : readCodexConfiguredModel(),
      approvalPolicy: readCodexApprovalPolicy(),
      sandbox: readCodexSandbox(),
      statePath: resolve(dirname(state.store.path), "codex-threads.json"),
      providerHttpCapture,
      env: providerEnv,
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
      env: providerEnv,
    });
  }

  if (kernel === "pi") {
    return createRuntimeKernelAdapter({
      id: "pi",
      title: "Pi",
      runtime: new PiAgentRuntime({
        createSession: createNativePiSessionFactory({
          model: (requestedModelId) =>
            resolveNativeModel(readBridgeModelOverride(requestedModelId) ?? state.model, providerEnv),
          getApiKey: (providerName) => providerEnv?.MODEL_API_KEY || getBridgeModelApiKey(providerName),
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

  const external = externalCliDefinition(kernel);
  if (external) {
    const command = resolveExternalCliCommand(external);
    return createExternalCliKernelAdapter(external, {
      command,
      cwd: process.cwd(),
      env: providerEnv,
      providerHttpCapture,
    });
  }

  throw new Error(`Unsupported kernel: ${kernel}`);
}

export function getBridgeKernelOptions(state: BridgeState): JsonObject[] {
  const active = resolveBridgeKernel(state.settings.kernel);
  const options: JsonObject[] = [
    {
      id: "auto",
      label: "自动选择",
      description: "按 Codex → Claude Code → OpenClaw → Hermes → Pi → DeepSeek TUI → 其他可用内核的顺序选择。",
      available: true,
      active: state.settings.kernel === "auto",
      resolved: active,
    },
  ];

  for (const id of BRIDGE_KERNEL_IDS) {
    const available = canUseBridgeKernel(id);
    const discovery = buildKernelDiscoverySnapshot(id, state, available);
    const provider = resolveProviderForKernel(id, state.settings.kernelProviderBindings, state.settings.customProviders);
    options.push(stripUndefined({
      id,
      label: kernelLabel(id),
      description: kernelDescription(id),
      available,
      active: state.settings.kernel === id,
      reason: available ? "" : unavailableReason(id),
      installed: discovery.installed,
      binaryPath: discovery.binaryPath,
      version: discovery.version,
      configHome: discovery.configHome,
      providerId: provider?.id,
      providerLabel: provider?.name,
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

export function getBridgeRuntimeControls(state: BridgeState): JsonObject {
  const active = resolveBridgeKernel(state.settings.kernel);
  const provider = resolveProviderForKernel(active, state.settings.kernelProviderBindings, state.settings.customProviders);
  const providerModels = providerModelsForKernel(active, provider);
  const controls =
    active === "codex"
      ? mergeProviderRuntimeControls(buildCodexRuntimeControls(), providerModels, provider?.id)
      : active === "claude-code"
        ? mergeProviderRuntimeControls(buildSingleModelRuntimeControls({
            kernel: active,
            source: "claude-code-config",
            model: readClaudeConfiguredModel() ?? providerModels[0]?.id ?? "claude-opus-4-6",
            label: providerModels[0]?.label ?? "Claude Opus 4.6",
          }), providerModels, provider?.id)
        : active === "hermes"
          ? buildSingleModelRuntimeControls({
              kernel: active,
              source: "hermes-config",
              model: readHermesConfiguredModel() ?? "hermes-default",
              label: readHermesConfiguredModel() ?? "Hermes 默认模型",
            })
          : active === "pi"
            ? mergeProviderRuntimeControls(buildPiRuntimeControls(), providerModels, provider?.id)
            : externalCliDefinition(active)
              ? buildExternalRuntimeControls(active, providerModels, provider?.id)
              : buildPiRuntimeControls();
  return stripUndefined(controls as unknown as Record<string, unknown>) as JsonObject;
}

function buildCodexRuntimeControls(): BridgeRuntimeControls {
  const cache = readCodexModelsCache();
  const cacheModels = cache.models
    .map((model) => ({
      id: stringValue(model.slug),
      label: stringValue(model.display_name) || stringValue(model.slug),
      priority: numberValue(model.priority),
      reasoning: normalizeReasoningOptions(model.supported_reasoning_levels),
      defaultReasoning: normalizeReasoningEffort(model.default_reasoning_level),
      speed: normalizeSpeedTiers(model.additional_speed_tiers),
    }))
    .filter((model): model is {
      id: BridgeModelId;
      label: string;
      priority: number | undefined;
      reasoning: BridgeRuntimeControlOption[];
      defaultReasoning: string | undefined;
      speed: BridgeRuntimeControlOption[];
    } => Boolean(model.id && (BRIDGE_MODEL_IDS as readonly string[]).includes(model.id)));

  const models = cacheModels.length
    ? cacheModels
        .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
        .map((model) => ({ id: model.id, label: model.label }))
    : CODEX_FALLBACK_MODELS;
  const current = cacheModels.find((model) => model.id === readCodexConfiguredModel()) ?? cacheModels[0];
  return {
    kernel: "codex",
    source: cache.source,
    models,
    defaultModel: readCodexConfiguredModel(),
    reasoningEfforts: current?.reasoning?.length ? current.reasoning : DEFAULT_REASONING_OPTIONS,
    defaultReasoningEffort: current?.defaultReasoning ?? "medium",
    speedTiers: [{ id: "standard", label: "标准", description: "默认速度，常规用量" }, ...(current?.speed ?? [])],
    defaultSpeedTier: "standard",
  };
}

function buildPiRuntimeControls(): BridgeRuntimeControls {
  return {
    kernel: "pi",
    source: "opengrove-native",
    models: BRIDGE_MODEL_IDS
      .filter((id) => id !== "gpt-5.3-codex-spark")
      .map((id) => ({ id, label: MODEL_LABELS[id] ?? id })),
    defaultModel: DEFAULT_BRIDGE_MODEL_ID,
    reasoningEfforts: DEFAULT_REASONING_OPTIONS,
    defaultReasoningEffort: readThinkingLevel() === "off" ? "medium" : readThinkingLevel(),
    speedTiers: [],
  };
}

function buildSingleModelRuntimeControls(input: {
  kernel: BridgeKernelId;
  source: string;
  model: string;
  label: string;
}): BridgeRuntimeControls {
  return {
    kernel: input.kernel,
    source: input.source,
    models: [{ id: input.model, label: input.label }],
    defaultModel: input.model,
    reasoningEfforts: [],
    speedTiers: [],
  };
}

function buildExternalRuntimeControls(
  kernel: BridgeKernelId,
  providerModels: BridgeRuntimeControlOption[],
  providerId: string | undefined,
): BridgeRuntimeControls {
  return {
    kernel,
    source: providerId ? `provider:${providerId}` : "external-cli",
    models: providerModels.length ? providerModels : [{ id: `${kernel}-default`, label: "Default" }],
    defaultModel: providerModels[0]?.id,
    reasoningEfforts: [],
    speedTiers: [],
  };
}

function mergeProviderRuntimeControls(
  controls: BridgeRuntimeControls,
  providerModels: BridgeRuntimeControlOption[],
  providerId: string | undefined,
): BridgeRuntimeControls {
  if (!providerModels.length) return controls;
  return {
    ...controls,
    source: providerId ? `provider:${providerId}` : controls.source,
    models: providerModels,
    defaultModel: providerModels[0]?.id ?? controls.defaultModel,
  };
}

const MODEL_LABELS: Record<string, string> = {
  "MiMo-V2-Pro": "MiMo-V2-Pro",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2": "GPT-5.2",
  "claude-opus-4-6": "Claude Opus 4.6",
};

const CODEX_FALLBACK_MODELS: BridgeRuntimeControlOption[] = BRIDGE_MODEL_IDS
  .filter((id) => id.startsWith("gpt-"))
  .map((id) => ({ id, label: MODEL_LABELS[id] ?? id }));

const DEFAULT_REASONING_OPTIONS: BridgeRuntimeControlOption[] = [
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "超高" },
];

interface CodexModelsCache {
  source: string;
  models: Array<Record<string, unknown>>;
}

function readCodexModelsCache(): CodexModelsCache {
  const path = resolve(homedir(), ".codex", "models_cache.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: unknown };
    return {
      source: path,
      models: Array.isArray(parsed.models)
        ? parsed.models.filter((model): model is Record<string, unknown> =>
            Boolean(model && typeof model === "object" && !Array.isArray(model)),
          )
        : [],
    };
  } catch {
    return { source: "codex-fallback", models: [] };
  }
}

function normalizeReasoningOptions(value: unknown): BridgeRuntimeControlOption[] {
  if (!Array.isArray(value)) return DEFAULT_REASONING_OPTIONS;
  const options = value
    .map((item) => {
      if (typeof item === "string") {
        const effort = normalizeReasoningEffort(item);
        return effort ? { id: effort, label: reasoningEffortLabel(effort) } : undefined;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const record = item as Record<string, unknown>;
      const effort = normalizeReasoningEffort(record.effort);
      return effort
        ? {
            id: effort,
            label: reasoningEffortLabel(effort),
            description: stringValue(record.description),
          }
        : undefined;
    })
    .filter((item): item is BridgeRuntimeControlOption => Boolean(item));
  return options.length ? options : DEFAULT_REASONING_OPTIONS;
}

function normalizeReasoningEffort(value: unknown): string | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

function reasoningEffortLabel(value: string): string {
  return value === "low" ? "低" : value === "medium" ? "中" : value === "xhigh" ? "超高" : "高";
}

function normalizeSpeedTiers(value: unknown): BridgeRuntimeControlOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      item === "fast"
        ? { id: "fast", label: "快速", description: "1.5 倍速，用量增加" }
        : typeof item === "string"
          ? { id: item, label: item }
          : undefined,
    )
    .filter((item): item is BridgeRuntimeControlOption => Boolean(item));
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
  const external = externalCliDefinition(id);
  if (external) {
    return {
      ...discoverExternalCliKernel(external),
      installed: available,
      available,
    };
  }
  const base = createRuntimeKernelDiscovery(id, "Pi", available, cwd);
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
    notes: [`Pi 使用 ${APP_PRODUCT_NAME} 自己的 tool-mediated skill/memory/artifact 机制，没有单独原生目录。`],
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
  const { state: serviceState, error: startError } = ensureProviderHttpCaptureServiceRunning();
  const serviceRunning = Boolean(serviceState?.pid && isPidAlive(serviceState.pid));
  if (!serviceRunning) {
    return {
      enabled: true,
      inject: false,
      kernelId: kernel,
      status: startError ? "service-start-failed" : "service-not-running",
      warning: startError
        ? `抓包开关已开启，但自动启动 mitmproxy 失败：${startError}。本轮不会向内核注入代理，避免把会话直接打挂。`
        : "抓包开关已开启，但 mitmproxy 服务没有运行；本轮不会向内核注入代理，避免把会话直接打挂。",
    };
  }

  if (kernel === "pi") {
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
    if (!canUseBridgeKernel(preferred)) {
      throw new Error(`${kernelLabel(preferred)} is not available. ${unavailableReason(preferred)}`);
    }
    return preferred;
  }
  if (canUseCodexKernel()) return "codex";
  if (canUseClaudeKernel()) return "claude-code";
  if (canUseExternalCliKernel("openclaw")) return "openclaw";
  if (canUseHermesKernel()) return "hermes";
  if (canUsePiKernel()) return "pi";
  if (canUseExternalCliKernel("deepseek-tui")) return "deepseek-tui";
  for (const definition of EXTERNAL_CLI_KERNELS) {
    if (canUseExternalCliKernel(definition.id)) return definition.id;
  }
  throw new Error("No available kernel was found. Install Codex, Claude Code, Hermes, Pi, or configure an external CLI kernel.");
}

function canUseBridgeKernel(id: BridgeKernelId): boolean {
  if (id === "codex") return canUseCodexKernel();
  if (id === "claude-code") return canUseClaudeKernel();
  if (id === "hermes") return canUseHermesKernel();
  if (id === "pi") return canUsePiKernel();
  return canUseExternalCliKernel(id);
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

function canUseExternalCliKernel(id: BridgeKernelId): boolean {
  const definition = externalCliDefinition(id);
  return Boolean(definition && resolveExternalCliCommand(definition));
}

function kernelLabel(id: BridgeKernelId): string {
  const external = externalCliDefinition(id);
  if (external) return external.title;
  if (id === "claude-code") return "Claude Code";
  if (id === "codex") return "Codex";
  if (id === "hermes") return "Hermes";
  if (id === "pi") return "Pi";
  return id;
}

function kernelDescription(id: BridgeKernelId): string {
  if (id === "codex") {
    return "使用 Codex CLI / app-server，保留 Codex 原生工具、审批、elicitation、compact 等能力。";
  }
  if (id === "claude-code") {
    return "使用 Claude Code CLI。当前桥接仍偏 CLI stream，审批/host tool parity 低于 Codex。";
  }
  if (id === "hermes") {
    return `使用 Hermes CLI oneshot。支持 Hermes 原生 skill list/view/external_dirs；当前 ${APP_PRODUCT_NAME} 只能看到最终文本，原生工具细节还不会逐条流回。`;
  }
  if (id === "pi") {
    return `使用 ${APP_PRODUCT_NAME} 自带的 OpenAI-compatible loop，适合调试 ${APP_PRODUCT_NAME} 自有工具链。`;
  }
  const external = externalCliDefinition(id);
  return external
    ? `${external.title} 外部 CLI 适配器。OpenGrove 负责发现、provider 环境注入和输出归一化。`
    : id;
}

function unavailableReason(id: BridgeKernelId): string {
  if (id === "codex") return "未找到 Codex CLI。";
  if (id === "claude-code") return "未找到 Claude Code CLI。";
  if (id === "hermes") return `未找到 Hermes CLI。安装 Hermes 或设置 ${appEnvName("HERMES_BIN")}。`;
  if (id === "pi") return `缺少 ${appEnvName("MODEL_BASE_URL")} 或 OpenAI-compatible API key。`;
  const external = externalCliDefinition(id);
  return external
    ? `未找到 ${external.title} CLI。安装它或设置 ${appEnvName(external.envName)}。`
    : "未找到内核。";
}

function resolveNativeModel(modelId: BridgeModelId, providerEnv?: NodeJS.ProcessEnv): Model<any> {
  const metadata: Record<
    string,
    { apiId: string; name: string; contextWindow: number; maxTokens: number; reasoning: boolean }
  > = {
    "MiMo-V2-Pro": {
      apiId: "mimo-v2-pro",
      name: "MiMo-V2-Pro",
      contextWindow: 1_000_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "gpt-5.5": {
      apiId: "gpt-5.5",
      name: "GPT-5.5",
      contextWindow: 272_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "gpt-5.4": {
      apiId: "gpt-5.4",
      name: "GPT-5.4",
      contextWindow: 272_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "gpt-5.4-mini": {
      apiId: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      contextWindow: 272_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "gpt-5.3-codex": {
      apiId: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      contextWindow: 272_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "gpt-5.3-codex-spark": {
      apiId: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      contextWindow: 272_000,
      maxTokens: 64_000,
      reasoning: true,
    },
    "gpt-5.2": {
      apiId: "gpt-5.2",
      name: "GPT-5.2",
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
  };
  const config = metadata[modelId] ?? {
    apiId: modelId,
    name: MODEL_LABELS[modelId] ?? modelId,
    contextWindow: 200_000,
    maxTokens: 32_000,
    reasoning: true,
  };

  return {
    id: config.apiId,
    name: config.name,
    api: "openai-completions",
    provider: "openai",
    baseUrl: providerEnv?.MODEL_BASE_URL || readModelBaseUrl(),
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
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function ensureProviderHttpCaptureServiceRunning(): { state?: Record<string, unknown>; error?: string } {
  const current = readProviderHttpCaptureServiceState();
  if (current?.pid && isPidAlive(current.pid)) {
    return { state: current };
  }
  const scriptPath = resolve(process.cwd(), "scripts", "provider-http-capture.mjs");
  if (!existsSync(scriptPath)) {
    return { state: current, error: `启动脚本不存在：${scriptPath}` };
  }
  const result = spawnSync(process.execPath, [scriptPath, "start"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
    timeout: 15_000,
  });
  const next = readProviderHttpCaptureServiceState();
  if (next?.pid && isPidAlive(next.pid)) {
    return { state: next };
  }
  const output = [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .trim()
    .split("\n")
    .slice(-4)
    .join(" ");
  if (result.error) {
    return { state: next ?? current, error: result.error.message };
  }
  return {
    state: next ?? current,
    error: output || `启动命令退出码 ${result.status ?? "unknown"}`,
  };
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isEnabledEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function normalizeBridgeKernelPreference(value: unknown, fallback: BridgeKernelPreference): BridgeKernelPreference {
  if (value === "auto" || (typeof value === "string" && (BRIDGE_KERNEL_IDS as readonly string[]).includes(value))) {
    return value as BridgeKernelPreference;
  }
  return fallback;
}

export function defaultBridgeKernelPreference(): BridgeKernelPreference {
  return "auto";
}

export function defaultBridgeModelId(): BridgeModelId {
  return DEFAULT_BRIDGE_MODEL_ID;
}
