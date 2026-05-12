import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { JsonObject } from "../core.js";
import { packageRoot } from "../package-root.js";
import {
  APP_KNOWLEDGE_SCOPE,
  APP_PRODUCT_NAME,
  APP_PROTOCOL_ID,
  APP_VAULT_DIR,
  APP_VAULT_ROOT_NAME,
  appEnvName,
  readAppEnv,
} from "../identity.js";
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
import { OpenAiHttpKernelAdapter } from "../kernel/adapters/openai-http.js";
import type { KernelAdapter, KernelDiscovery, KernelKnowledgeSource } from "../kernel/types.js";
import { resolveClaudeCodeCliPath } from "../runtime/claude-code-runtime.js";
import { resolveCodexCommandPath } from "../runtime/codex-runtime.js";
import { resolveHermesCommandPath } from "../runtime/hermes-runtime.js";
import { defaultHermesExternalSkillDir } from "../skills/native-publisher.js";
import {
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "../runtime/provider-http-capture.js";
import {
  applyKernelProxyEnv,
  resolveKernelProxySettings,
} from "../runtime/kernel-proxy.js";
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
  codexProviderNeedsResponsesChatProxy,
  hermesProviderConfigForKernel,
  codexProviderConfigForKernel,
  providerEnvForKernel,
  providerModelsForKernel,
  resolveProviderForKernel,
} from "./provider-profiles.js";
import {
  withCodexResponsesChatProxy,
} from "./codex-responses-chat-proxy.js";
import {
  readKernelNativeProviderProfile,
} from "./kernel-native-profiles.js";
import {
  kernelModelAliasesForProvider,
  kernelModelForProviderSelection,
} from "./kernel-model-routing.js";
import {
  providerBindingFingerprint,
  planProviderBinding,
  usesNativeProviderConfig,
} from "./provider-binding.js";
import {
  getBridgeKernelDescriptor,
} from "./kernel-registry.js";
import { resolveOpenAiHttpKernelDefinition } from "./openai-http-kernel-registry.js";
import {
  defaultKernelConfigHome,
  existingPath,
  kernelBinaryPathOverride,
  kernelConfigHome,
  kernelPathEnv,
} from "./kernel-paths.js";
import { resolveBridgeWorkspaceRoot } from "./workspace-root.js";
import { bridgeDataPath } from "./storage-paths.js";

export function createBridgeKernel(state: BridgeState): KernelAdapter {
  const kernel = resolveBridgeKernel(state.settings.kernel, state);
  const workspaceRoot = resolveBridgeWorkspaceRoot(state.settings);
  state.kernel = kernel;
  const providerHttpCapture = readProviderHttpCaptureOptions(state, kernel);
  const provider = resolveProviderForKernel(kernel, state.settings.kernelProviderBindings, state.settings.customProviders);
  const providerModelOptions = providerModelsForKernel(kernel, provider);
  const providerDefaultModel = providerModelOptions.some((item) => item.id === state.model)
    ? state.model
    : providerModelOptions[0]?.id;
  const selectedModel = providerDefaultModel || state.model;
  const kernelSelectedModel = kernelModelForProviderSelection(kernel, provider, selectedModel);
  const modelAliases = kernelModelAliasesForProvider(kernel, provider);
  const providerEnv = resolveKernelEnv(state, kernel, provider, selectedModel);
  const nativeProviderBinding = usesNativeProviderConfig(kernel, provider);
  const runtimeEnv = { ...process.env, ...providerEnv };
  const descriptor = getBridgeKernelDescriptor(kernel);
  const runtimeBindingFingerprint = providerBindingFingerprint({
    kernelId: kernel,
    provider,
    providerModel: descriptor.thread.reuseAcrossModelChanges ? undefined : selectedModel,
    kernelModel: descriptor.thread.reuseAcrossModelChanges ? undefined : kernelSelectedModel,
    cwd: workspaceRoot,
  });

  if (kernel === "claude-code") {
    const cliPath = resolveKernelCommandPath(state, "claude-code");
    return createClaudeCodeKernelAdapter({
      cliPath,
      cwd: workspaceRoot,
      configuredModel: provider && !nativeProviderBinding ? kernelSelectedModel : undefined,
      runtimeBindingFingerprint,
      modelAliases,
      permissionMode: "bypassPermissions",
      providerHttpCapture,
      env: providerEnv,
    });
  }

  if (kernel === "codex") {
    const command = resolveKernelCommandPath(state, "codex");
    if (!command) {
      throw new Error(`Codex CLI was not found. Set ${appEnvName("CODEX_BIN")}.`);
    }
    const baseCodexProviderConfig = codexProviderConfigForKernel(provider);
    const codexProviderConfig = baseCodexProviderConfig && codexProviderNeedsResponsesChatProxy(provider)
      ? withCodexResponsesChatProxy(baseCodexProviderConfig, {
          upstreamBaseUrl: provider?.openaiBaseUrl,
          apiKey: providerEnv?.[baseCodexProviderConfig.envKey],
        })
      : baseCodexProviderConfig;
    return createCodexKernelAdapter({
      command,
      cwd: workspaceRoot,
      configuredModel: provider ? (kernelSelectedModel || readCodexConfiguredModel()) : readCodexConfiguredModel(),
      configuredModelProvider: codexProviderConfig?.providerKey,
      providerConfig: codexProviderConfig,
      approvalPolicy: readCodexApprovalPolicy(),
      sandbox: readCodexSandbox(),
      allowServiceTier: !codexProviderConfig,
      runtimeBindingFingerprint,
      statePath: bridgeDataPath(state, "codex-threads.json"),
      providerHttpCapture,
      rawEventCapture: state.settings.providerHttpCaptureEnabled && state.settings.codexRawEventCaptureEnabled,
      env: providerEnv,
    });
  }

  if (kernel === "hermes") {
    const hermesHttp = resolveOpenAiHttpKernelDefinition("hermes", {
      env: runtimeEnv,
      providerHttpCapture,
    });
    if (hermesHttp) {
      return new OpenAiHttpKernelAdapter(hermesHttp);
    }
    const command = resolveKernelCommandPath(state, "hermes");
    if (!command) {
      throw new Error(`Hermes CLI was not found. Set ${appEnvName("HERMES_BIN")}.`);
    }
    const hermesProviderConfig = hermesProviderConfigForKernel(provider, selectedModel);
    return createHermesKernelAdapter({
      command,
      cwd: workspaceRoot,
      configuredModel: hermesProviderConfig ? (kernelSelectedModel || readHermesConfiguredModel()) : readHermesConfiguredModel(),
      configuredProvider: hermesProviderConfig?.providerKey ?? readHermesConfiguredProvider(),
      runtimeBindingFingerprint,
      providerConfig: hermesProviderConfig,
      toolsets: readHermesToolsets(),
      nativeSkillDir: defaultHermesExternalSkillDir(workspaceRoot),
      providerHttpCapture,
      env: providerEnv,
    });
  }

  const httpDefinition = resolveOpenAiHttpKernelDefinition(kernel, {
    env: runtimeEnv,
    providerHttpCapture,
  });
  if (httpDefinition) {
    return new OpenAiHttpKernelAdapter(httpDefinition);
  }

  const external = externalCliDefinition(kernel);
  if (external) {
    const command = resolveKernelCommandPath(state, kernel);
    return createExternalCliKernelAdapter(external, {
      command,
      cwd: workspaceRoot,
      env: providerEnv,
      providerHttpCapture,
    });
  }

  throw new Error(`Unsupported kernel: ${kernel}`);
}

export function getBridgeKernelOptions(state: BridgeState): JsonObject[] {
  const active = resolveBridgeKernel(state.settings.kernel, state);
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
    const available = canUseBridgeKernel(id, state);
    const discovery = buildKernelDiscoverySnapshot(id, state, available);
    const provider = resolveProviderForKernel(id, state.settings.kernelProviderBindings, state.settings.customProviders);
    const nativeProvider = !provider
      ? readKernelNativeProviderProfile(id, nativeProfileOptions(state, id))
      : undefined;
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
      providerId: provider?.id ?? nativeProvider?.providerId,
      providerLabel: provider?.name ?? nativeProvider?.providerLabel,
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
  const active = resolveBridgeKernel(state.settings.kernel, state);
  return getBridgeRuntimeControlsForKernel(state, active);
}

export function getBridgeRuntimeControlsByKernel(state: BridgeState): JsonObject {
  const controlsByKernel: Record<string, JsonObject> = {};
  for (const id of BRIDGE_KERNEL_IDS) {
    controlsByKernel[id] = getBridgeRuntimeControlsForKernel(state, id);
  }
  return controlsByKernel as JsonObject;
}

export function getBridgeRuntimeControlsForKernel(state: BridgeState, kernel: BridgeKernelId): JsonObject {
  const provider = resolveProviderForKernel(kernel, state.settings.kernelProviderBindings, state.settings.customProviders);
  const providerModels = providerModelsForKernel(kernel, provider);
  const controls =
    kernel === "codex"
      ? mergeProviderRuntimeControls(buildCodexRuntimeControls(state), providerModels, provider)
      : kernel === "claude-code"
        ? providerModels.length
          ? mergeProviderRuntimeControls(buildClaudeCodeRuntimeControls(state), providerModels, provider)
          : buildClaudeCodeRuntimeControls(state)
        : kernel === "hermes"
          ? mergeProviderRuntimeControls(
              buildSingleModelRuntimeControls({
                kernel,
                source: "hermes-config",
                model: readHermesConfiguredModel() ?? "hermes-default",
                label: readHermesConfiguredModel() ?? "Hermes 默认模型",
              }),
              providerModels,
              provider,
            )
          : buildExternalRuntimeControls(kernel, providerModels, provider?.id);
  return stripUndefined(controls as unknown as Record<string, unknown>) as JsonObject;
}

function buildCodexRuntimeControls(state: BridgeState): BridgeRuntimeControls {
  const cache = readCodexModelsCache(kernelConfigHome(state.settings, "codex"));
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

function buildClaudeCodeRuntimeControls(state: BridgeState): BridgeRuntimeControls {
  const profile = readKernelNativeProviderProfile("claude-code", nativeProfileOptions(state, "claude-code"));
  const models = profile?.models.length
    ? profile.models
    : [{ id: CLAUDE_CODE_DEFAULT_MODEL_ID, label: "跟随 Claude Code 配置" }];
  return {
    kernel: "claude-code",
    source: profile?.source ?? "claude-code-defaults",
    models,
    defaultModel: profile?.defaultModel ?? models[0]?.id,
    reasoningEfforts: [],
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
  provider: ReturnType<typeof resolveProviderForKernel>,
): BridgeRuntimeControls {
  if (!providerModels.length) return controls;
  const plan = planProviderBinding(controls.kernel, provider);
  const descriptor = getBridgeKernelDescriptor(controls.kernel);
  const preserveReasoning = plan.kind === "native"
    ? descriptor.nativeControls.reasoning
    : descriptor.externalControls.reasoning;
  const preserveSpeed = plan.kind === "native"
    ? descriptor.nativeControls.speed
    : descriptor.externalControls.speed;
  return {
    ...controls,
    source: provider ? `provider:${provider.id}` : controls.source,
    models: providerModels,
    defaultModel: providerModels[0]?.id ?? controls.defaultModel,
    reasoningEfforts: preserveReasoning ? controls.reasoningEfforts : [],
    defaultReasoningEffort: preserveReasoning ? controls.defaultReasoningEffort : undefined,
    speedTiers: preserveSpeed ? controls.speedTiers : [],
    defaultSpeedTier: preserveSpeed ? controls.defaultSpeedTier : undefined,
  };
}

const MODEL_LABELS: Record<string, string> = {
  "claude-code-default": "跟随 Claude Code 配置",
  "MiMo-V2-Pro": "MiMo-V2-Pro",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2": "GPT-5.2",
  "claude-opus-4-6": "Claude Opus 4.6",
};

const CLAUDE_CODE_DEFAULT_MODEL_ID = "claude-code-default";

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

function readCodexModelsCache(codexHome = resolve(homedir(), ".codex")): CodexModelsCache {
  const path = resolve(codexHome, "models_cache.json");
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
  const cwd = resolveBridgeWorkspaceRoot(state.settings);
  if (id === "codex") {
    const command = resolveKernelCommandPath(state, "codex");
    return {
      ...discoverCodexKernel({
        command: command || undefined,
        cwd,
        env: kernelPathEnv(state.settings, "codex"),
      }, cwd),
      installed: available,
      available,
    };
  }
  if (id === "claude-code") {
    const cliPath = resolveKernelCommandPath(state, "claude-code");
    return {
      ...discoverClaudeCodeKernel({
        ...(cliPath ? { cliPath } : {}),
        cwd,
        env: kernelPathEnv(state.settings, "claude-code"),
      }, cwd),
      installed: available,
      available,
    };
  }
  const httpDefinition = resolveOpenAiHttpKernelDefinition(id, {
    env: process.env,
    providerHttpCapture: readProviderHttpCaptureOptions(state, id),
  });
  if (httpDefinition) {
    return {
      ...createRuntimeKernelDiscovery(id, httpDefinition.title, available, cwd),
      installed: available,
      available,
      knowledgeSources: httpDefinition.knowledgeSources ?? [],
      installActions: httpDefinition.installActions ?? [],
      notes: httpDefinition.notes ?? [],
    };
  }
  if (id === "hermes") {
    const command = resolveKernelCommandPath(state, "hermes");
    return {
      ...discoverHermesKernel({
        command: command || undefined,
        cwd,
        nativeSkillDir: defaultHermesExternalSkillDir(cwd),
        env: kernelPathEnv(state.settings, "hermes"),
      }, cwd),
      installed: available,
      available,
    };
  }
  const external = externalCliDefinition(id);
  if (external) {
    const command = resolveKernelCommandPath(state, id);
    const discovery = discoverExternalCliKernel(external, command);
    return rewriteDiscoveryConfigHome(id, state, {
      ...discovery,
      installed: available,
      available,
    });
  }
  const base = createRuntimeKernelDiscovery(id, kernelLabel(id), available, process.cwd());
  return base;
}

function rewriteDiscoveryConfigHome(
  kernel: BridgeKernelId,
  state: BridgeState,
  discovery: KernelDiscovery,
): KernelDiscovery {
  const configHome = kernelConfigHome(state.settings, kernel);
  const defaultHome = defaultKernelConfigHome(kernel);
  if (!state.settings.kernelPathOverrides[kernel]?.configHome || configHome === defaultHome) {
    return discovery;
  }
  return {
    ...discovery,
    configHome,
    knowledgeSources: discovery.knowledgeSources.map((source) => ({
      ...source,
      path: source.path ? replacePathRoot(source.path, defaultHome, configHome) : source.path,
    })),
  };
}

function replacePathRoot(path: string, fromRoot: string, toRoot: string): string {
  const normalizedPath = resolve(path);
  const normalizedFrom = resolve(fromRoot);
  if (normalizedPath === normalizedFrom) return toRoot;
  if (normalizedPath.startsWith(`${normalizedFrom}/`)) {
    return resolve(toRoot, normalizedPath.slice(normalizedFrom.length + 1));
  }
  return path;
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
    notes: [`${title} uses ${APP_PRODUCT_NAME}'s managed vault sources.`],
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

function resolveKernelEnv(
  state: BridgeState,
  kernel: BridgeKernelId,
  provider: ReturnType<typeof resolveProviderForKernel>,
  selectedModel: string | undefined,
): NodeJS.ProcessEnv | undefined {
  const providerEnv = {
    ...kernelPathEnv(state.settings, kernel),
    ...(providerEnvForKernel(kernel, provider, selectedModel) ?? {}),
  };
  const env = applyKernelProxyEnv(
    providerEnv,
    resolveKernelProxySettings(state.settings.kernelProxy, process.env),
  );
  return Object.keys(env).length ? env : undefined;
}

export function readProviderHttpCaptureOptions(
  state: BridgeState,
  kernel: BridgeKernelId = state.kernel,
): ProviderHttpCaptureOptions {
  if (!state.settings.providerHttpCaptureEnabled) {
    return { enabled: false, inject: false, kernelId: kernel, status: "disabled" };
  }
  const { state: serviceState, error: startError } = ensureProviderHttpCaptureServiceRunning(state);
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
  const activeKernel = state.kernel || resolveBridgeKernel(state.settings.kernel, state);
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
    upstreamProxy: stringValue(serviceState?.upstreamProxy),
    statePath: providerHttpCaptureServiceStatePath(),
    warning:
      capture.warning ||
      (capture.enabled && !serviceRunning
        ? `抓包开关已开启，但本地 mitmproxy 服务未运行；${APP_PRODUCT_NAME} 不会注入一个不可用代理。`
        : ""),
  };
}

export function resolveBridgeKernel(preferred: BridgeKernelPreference, state?: BridgeState): BridgeKernelId {
  if (preferred !== "auto") {
    if (!canUseBridgeKernel(preferred, state)) {
      throw new Error(`${kernelLabel(preferred)} is not available. ${unavailableReason(preferred)}`);
    }
    return preferred;
  }
  if (canUseCodexKernel(state)) return "codex";
  if (canUseClaudeKernel(state)) return "claude-code";
  if (canUseOpenAiHttpKernel("openclaw") || canUseExternalCliKernel("openclaw", state)) return "openclaw";
  if (canUseHermesKernel(state)) return "hermes";
  if (canUsePiKernel(state)) return "pi";
  if (canUseExternalCliKernel("deepseek-tui", state)) return "deepseek-tui";
  for (const definition of EXTERNAL_CLI_KERNELS) {
    if (canUseExternalCliKernel(definition.id, state)) return definition.id;
  }
  throw new Error("No available kernel was found. Install Codex, Claude Code, Hermes, Pi, or configure an external CLI kernel.");
}

function canUseBridgeKernel(id: BridgeKernelId, state?: BridgeState): boolean {
  if (id === "codex") return canUseCodexKernel(state);
  if (id === "claude-code") return canUseClaudeKernel(state);
  if (id === "hermes") return canUseHermesKernel(state);
  if (id === "pi") return canUsePiKernel(state);
  if (canUseOpenAiHttpKernel(id)) return true;
  return canUseExternalCliKernel(id, state);
}

function canUseClaudeKernel(state?: BridgeState) {
  if (!resolveKernelCommandPath(state, "claude-code")) {
    return false;
  }
  const profile = readKernelNativeProviderProfile("claude-code", nativeProfileOptions(state, "claude-code"));
  if (profile?.baseUrl && profile.authConfigured) {
    return true;
  }
  const configHome = kernelConfigHomeFromState(state, "claude-code");

  return Boolean(
    readAppEnv("ANTHROPIC_API_KEY")?.trim() ||
      readAppEnv("ANTHROPIC_AUTH_TOKEN")?.trim() ||
      profile?.authConfigured ||
      existsSync(resolve(configHome, "settings.json")) ||
      existsSync(resolve(homedir(), ".claude.json")),
  );
}

function canUseCodexKernel(state?: BridgeState) {
  return Boolean(resolveKernelCommandPath(state, "codex"));
}

function canUseHermesKernel(state?: BridgeState) {
  return canUseOpenAiHttpKernel("hermes") || Boolean(resolveKernelCommandPath(state, "hermes"));
}

function canUseOpenAiHttpKernel(id: BridgeKernelId): boolean {
  return Boolean(resolveOpenAiHttpKernelDefinition(id));
}

function canUsePiKernel(state?: BridgeState) {
  return canUseExternalCliKernel("pi", state);
}

function canUseExternalCliKernel(id: BridgeKernelId, state?: BridgeState): boolean {
  const definition = externalCliDefinition(id);
  return Boolean(definition && resolveKernelCommandPath(state, id));
}

function resolveKernelCommandPath(state: BridgeState | undefined, id: BridgeKernelId): string | undefined {
  const override = state ? kernelBinaryPathOverride(state.settings, id) : undefined;
  if (override) {
    return existingPath(override);
  }
  if (id === "codex") return resolveCodexCommandPath();
  if (id === "claude-code") return resolveClaudeCodeCliPath(state ? resolveBridgeWorkspaceRoot(state.settings) : process.cwd());
  if (id === "hermes") return resolveHermesCommandPath();
  const definition = externalCliDefinition(id);
  return definition ? resolveExternalCliCommand(definition) : undefined;
}

function nativeProfileOptions(state: BridgeState | undefined, id: BridgeKernelId): { cwd: string; configHome: string } {
  return {
    cwd: state ? resolveBridgeWorkspaceRoot(state.settings) : process.cwd(),
    configHome: kernelConfigHomeFromState(state, id),
  };
}

function kernelConfigHomeFromState(state: BridgeState | undefined, id: BridgeKernelId): string {
  return state ? kernelConfigHome(state.settings, id) : defaultKernelConfigHome(id);
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
    return "SDK 接入";
  }
  if (id === "claude-code") {
    return "SDK 接入";
  }
  if (id === "hermes") {
    return "CLI 接入";
  }
  const external = externalCliDefinition(id);
  return external ? "CLI 接入" : id;
}

function unavailableReason(id: BridgeKernelId): string {
  if (id === "codex") return "未找到 Codex";
  if (id === "claude-code") return "未找到 Claude Code";
  if (id === "hermes") return "未找到 Hermes";
  const external = externalCliDefinition(id);
  return external ? `未找到 ${external.title}` : "未找到内核";
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

function providerHttpCaptureServiceStatePath(): string {
  return resolve(
    process.cwd(),
    readAppEnv("PROVIDER_HTTP_CAPTURE_ROOT") ?? "data/provider-http-captures",
    "capture-state.json",
  );
}

function providerHttpCaptureServiceEnv(state: BridgeState): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const proxy = resolveKernelProxySettings(state.settings.kernelProxy, process.env);
  if (proxy.enabled && proxy.proxyUrl) {
    env[appEnvName("PROVIDER_HTTP_UPSTREAM_PROXY")] = proxy.proxyUrl;
  }
  return env;
}

function ensureProviderHttpCaptureServiceRunning(state: BridgeState): { state?: Record<string, unknown>; error?: string } {
  const current = readProviderHttpCaptureServiceState();
  const serviceEnv = providerHttpCaptureServiceEnv(state);
  if (current?.pid && isPidAlive(current.pid)) {
    const desiredUpstream = serviceEnv[appEnvName("PROVIDER_HTTP_UPSTREAM_PROXY")]?.trim();
    const currentUpstream = stringValue(current.upstreamProxy);
    if (desiredUpstream && currentUpstream !== desiredUpstream) {
      try {
        process.kill(current.pid as number, "SIGTERM");
      } catch {
        // Best effort; the next start attempt will report the real service state.
      }
    } else {
      return { state: current };
    }
  }
  const afterStop = readProviderHttpCaptureServiceState();
  if (afterStop?.pid && isPidAlive(afterStop.pid)) {
    return { state: current };
  }
  const scriptPath = resolve(packageRoot(), "scripts", "provider-http-capture.mjs");
  if (!existsSync(scriptPath)) {
    return { state: current, error: `启动脚本不存在：${scriptPath}` };
  }
  const result = spawnSync(process.execPath, [scriptPath, "start"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: serviceEnv,
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
