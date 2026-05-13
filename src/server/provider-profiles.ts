import { appEnvName, readAppEnv } from "../identity.js";
import type {
  BridgeKernelId,
  BridgeKernelProviderBinding,
  BridgeProviderCredentialKind,
  BridgeProviderProfile,
  BridgeRuntimeControlOption,
} from "./bridge-types.js";
import { BRIDGE_KERNEL_IDS } from "./bridge-types.js";
import type {
  HermesProviderApiMode,
  HermesProviderRuntimeConfig,
} from "../runtime/hermes-runtime.js";
import {
  planProviderBinding,
  providerHasTransferableCredential,
  usesNativeProviderConfig,
} from "./provider-binding.js";

export const VOLC_CODING_PROVIDER_ID = "volc-coding-plan";

const VOLC_MODELS: BridgeRuntimeControlOption[] = [
  { id: "glm-5.1", label: "GLM-5.1" },
  { id: "minimax-m2.7", label: "MiniMax-M2.7" },
  { id: "ark-code-latest", label: "Ark Code Latest" },
];

export function getBridgeProviderProfiles(): BridgeProviderProfile[] {
  return [
    {
      id: VOLC_CODING_PROVIDER_ID,
      name: "Volcengine Coding Plan",
      protocol: "openai-compatible",
      description: "火山引擎 Coding Plan，可通过 OpenAI-compatible 或 Anthropic-compatible 协议绑定给不同内核。",
      openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      anthropicBaseUrl: "https://ark.cn-beijing.volces.com/api/coding",
      apiKeyEnv: appEnvName("VOLC_CODING_API_KEY"),
      credentialKind: "env-key",
      codexWireApi: "chat",
      models: VOLC_MODELS,
      recommendedFor: [
        "codex",
        "claude-code",
        "pi",
        "deepseek-tui",
        "opencode",
        "copilot",
        "qwen-code",
      ],
      websiteUrl: "https://console.volcengine.com/ark",
    },
    {
      id: "openai",
      name: "OpenAI",
      protocol: "native-oauth",
      description: "OpenAI / ChatGPT 原生凭证或 OpenAI API key。",
      apiKeyEnv: "OPENAI_API_KEY",
      credentialKind: "native-login",
      models: [
        { id: "gpt-5.5", label: "GPT-5.5" },
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
        { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
        { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
        { id: "gpt-5.2", label: "GPT-5.2" },
      ],
      recommendedFor: ["codex", "pi", "opencode"],
      websiteUrl: "https://platform.openai.com",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic-compatible",
      description: "Anthropic API key 或 Claude Code 原生 Anthropic 兼容配置。",
      anthropicBaseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_AUTH_TOKEN",
      credentialKind: "env-key",
      models: [],
      recommendedFor: ["claude-code", "copilot", "pi"],
      websiteUrl: "https://console.anthropic.com",
    },
    {
      id: "aws-bedrock-api-key",
      name: "AWS Bedrock (API Key)",
      protocol: "anthropic-compatible",
      description: "Claude Code 可通过 Bedrock 原生配置使用。OpenGrove 不保存 AWS 凭证。",
      credentialKind: "aws",
      models: [],
      recommendedFor: ["claude-code"],
      websiteUrl: "https://aws.amazon.com/bedrock/",
    },
    {
      id: "google-vertex",
      name: "Google Vertex AI",
      protocol: "anthropic-compatible",
      description: "Claude Code 可通过 Vertex 原生配置使用。OpenGrove 不保存 Google 凭证。",
      credentialKind: "google-adc",
      models: [],
      recommendedFor: ["claude-code"],
      websiteUrl: "https://cloud.google.com/vertex-ai",
    },
    {
      id: "gemini",
      name: "Google Gemini",
      protocol: "gemini-compatible",
      description: "Gemini API / Gemini CLI 常用提供方。",
      geminiBaseUrl: "https://generativelanguage.googleapis.com",
      apiKeyEnv: "GEMINI_API_KEY",
      credentialKind: "env-key",
      models: [],
      recommendedFor: ["gemini-cli", "pi"],
      websiteUrl: "https://ai.google.dev/",
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai-compatible",
      description: "DeepSeek OpenAI-compatible / Anthropic-compatible API。",
      openaiBaseUrl: "https://api.deepseek.com",
      anthropicBaseUrl: "https://api.deepseek.com/anthropic",
      apiKeyEnv: appEnvName("DEEPSEEK_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "deepseek-tui", "opencode", "qwen-code"],
      websiteUrl: "https://platform.deepseek.com",
    },
    {
      id: "zhipu-glm",
      name: "Zhipu GLM",
      protocol: "openai-compatible",
      description: "智谱 GLM / Z.ai 常用兼容 API。",
      openaiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      anthropicBaseUrl: "https://open.bigmodel.cn/api/anthropic",
      apiKeyEnv: appEnvName("ZHIPU_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://open.bigmodel.cn",
    },
    {
      id: "kimi",
      name: "Kimi",
      protocol: "openai-compatible",
      description: "Moonshot/Kimi OpenAI-compatible / Claude Code 兼容 API。",
      openaiBaseUrl: "https://api.moonshot.cn/v1",
      anthropicBaseUrl: "https://api.moonshot.cn/anthropic",
      apiKeyEnv: appEnvName("KIMI_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://platform.moonshot.cn",
    },
    {
      id: "bailian",
      name: "Alibaba Bailian",
      protocol: "openai-compatible",
      description: "阿里云百炼 / DashScope 兼容 API。",
      openaiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      anthropicBaseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      apiKeyEnv: appEnvName("DASHSCOPE_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://bailian.console.aliyun.com",
    },
    {
      id: "qianfan",
      name: "Baidu Qianfan",
      protocol: "openai-compatible",
      description: "百度千帆兼容 API。",
      anthropicBaseUrl: "https://qianfan.baidubce.com/anthropic/coding",
      apiKeyEnv: appEnvName("QIANFAN_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi"],
      websiteUrl: "https://cloud.baidu.com/product/wenxinworkshop",
    },
    {
      id: "siliconflow",
      name: "SiliconFlow",
      protocol: "openai-compatible",
      description: "硅基流动 OpenAI-compatible API。",
      openaiBaseUrl: "https://api.siliconflow.cn/v1",
      anthropicBaseUrl: "https://api.siliconflow.cn",
      apiKeyEnv: appEnvName("SILICONFLOW_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://siliconflow.cn",
    },
    {
      id: "modelscope",
      name: "ModelScope",
      protocol: "openai-compatible",
      description: "ModelScope 兼容 API。",
      openaiBaseUrl: "https://api-inference.modelscope.cn/v1",
      anthropicBaseUrl: "https://api-inference.modelscope.cn",
      apiKeyEnv: appEnvName("MODELSCOPE_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://modelscope.cn",
    },
    {
      id: "minimax",
      name: "MiniMax",
      protocol: "openai-compatible",
      description: "MiniMax OpenAI-compatible / Anthropic-compatible API。",
      openaiBaseUrl: "https://api.minimax.io/v1",
      anthropicBaseUrl: "https://api.minimax.io/anthropic",
      apiKeyEnv: appEnvName("MINIMAX_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://www.minimaxi.com",
    },
    {
      id: "stepfun",
      name: "StepFun",
      protocol: "openai-compatible",
      description: "阶跃星辰兼容 API。",
      openaiBaseUrl: "https://api.stepfun.com/v1",
      anthropicBaseUrl: "https://api.stepfun.com/step_plan",
      apiKeyEnv: appEnvName("STEPFUN_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://platform.stepfun.com",
    },
    {
      id: "aihubmix",
      name: "AiHubMix",
      protocol: "openai-compatible",
      description: "AiHubMix OpenAI-compatible / Claude Code 兼容 API。",
      openaiBaseUrl: "https://aihubmix.com/v1",
      anthropicBaseUrl: "https://aihubmix.com",
      apiKeyEnv: appEnvName("AIHUBMIX_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://aihubmix.com",
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      protocol: "openai-compatible",
      description: "OpenAI-compatible / Anthropic-compatible 聚合网关。",
      openaiBaseUrl: "https://openrouter.ai/api/v1",
      anthropicBaseUrl: "https://openrouter.ai/api",
      apiKeyEnv: appEnvName("OPENROUTER_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "deepseek-tui", "opencode", "qwen-code"],
      websiteUrl: "https://openrouter.ai",
    },
    {
      id: "therouter",
      name: "TheRouter",
      protocol: "openai-compatible",
      description: "TheRouter 聚合网关。",
      openaiBaseUrl: "https://api.therouter.ai/v1",
      anthropicBaseUrl: "https://api.therouter.ai",
      apiKeyEnv: appEnvName("THEROUTER_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://therouter.ai",
    },
    {
      id: "novita",
      name: "Novita AI",
      protocol: "openai-compatible",
      description: "Novita AI 兼容 API。",
      openaiBaseUrl: "https://api.novita.ai/v3/openai",
      anthropicBaseUrl: "https://api.novita.ai/anthropic",
      apiKeyEnv: appEnvName("NOVITA_API_KEY"),
      models: [],
      recommendedFor: ["claude-code", "hermes", "pi", "opencode", "qwen-code"],
      websiteUrl: "https://novita.ai",
    },
    {
      id: "newapi",
      name: "NewAPI",
      protocol: "openai-compatible",
      description: "自托管 OpenAI-compatible 网关。通过 OPENGROVE_NEWAPI_BASE_URL 和 OPENGROVE_NEWAPI_API_KEY 配置。",
      openaiBaseUrl: readAppEnv("NEWAPI_BASE_URL"),
      apiKeyEnv: appEnvName("NEWAPI_API_KEY"),
      models: [],
      recommendedFor: ["codex", "pi", "deepseek-tui", "opencode", "qwen-code"],
    },
    {
      id: "n1n",
      name: "n1n.ai",
      protocol: "openai-compatible",
      description: "cc-switch 参考项目中的通用网关 preset。",
      openaiBaseUrl: readAppEnv("N1N_BASE_URL"),
      apiKeyEnv: appEnvName("N1N_API_KEY"),
      models: [],
      recommendedFor: ["codex", "claude-code", "pi", "gemini-cli"],
    },
  ];
}

export function getAllBridgeProviderProfiles(
  customProviders: BridgeProviderProfile[] | undefined,
): BridgeProviderProfile[] {
  const presets = getBridgeProviderProfiles();
  const profiles = new Map(presets.map((profile) => [profile.id, profile]));
  const custom = (customProviders ?? [])
    .map(normalizeCustomProviderProfile)
    .filter((profile): profile is BridgeProviderProfile => Boolean(profile));
  for (const profile of custom) {
    if (profile.deleted) {
      profiles.delete(profile.id);
      continue;
    }
    const preset = profiles.get(profile.id);
    profiles.set(profile.id, preset ? { ...preset, ...withoutUndefined(profile), custom: true, deleted: false } : profile);
  }
  return Array.from(profiles.values()).filter((profile) => !profile.deleted);
}

export function resolveProviderForKernel(
  kernelId: BridgeKernelId,
  bindings: Record<string, string> | undefined,
  customProviders?: BridgeProviderProfile[],
): BridgeProviderProfile | undefined {
  const providerId = bindings?.[kernelId];
  if (!providerId) return undefined;
  const provider = getAllBridgeProviderProfiles(customProviders).find((profile) => profile.id === providerId);
  return provider && provider.enabled !== false && providerSupportsKernel(kernelId, provider) ? provider : undefined;
}

export function providerKeyPresent(profile: BridgeProviderProfile): boolean {
  return Boolean(profile.authConfigured || providerApiKey(profile));
}

export function serializeProviderBindings(
  bindings: Record<string, string> | undefined,
  customProviders?: BridgeProviderProfile[],
): BridgeKernelProviderBinding[] {
  const profiles = getAllBridgeProviderProfiles(customProviders);
  const output: BridgeKernelProviderBinding[] = [];
  for (const [kernelId, providerId] of Object.entries(bindings ?? {})) {
    const profile = profiles.find((item) => item.id === providerId);
    if (!profile || !isBridgeKernelId(kernelId)) continue;
    const support = providerSupportForKernel(kernelId, profile);
    const missingKey = requiresEnvironmentKey(kernelId, profile) && !providerKeyPresent(profile);
    output.push({
      kernelId,
      providerId,
      enabled: profile.enabled !== false,
      mode: bindingModeForKernel(kernelId),
      status: !support.supported ? "unsupported" : missingKey ? "missing-key" : "ready",
      notes: !support.supported
        ? [support.reason]
        : missingKey
          ? [profile.apiKeyEnv
              ? `Set ${profile.apiKeyEnv} in the bridge process environment.`
              : "Set an API key or key environment variable for this provider."]
          : [],
    });
  }
  return output;
}

export function normalizeCustomProviderProfiles(input: unknown): BridgeProviderProfile[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(normalizeCustomProviderProfile)
    .filter((profile): profile is BridgeProviderProfile => Boolean(profile));
}

function normalizeCustomProviderProfile(input: unknown): BridgeProviderProfile | undefined {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const id = slug(String(source.id || source.name || "")).slice(0, 48);
  const name = String(source.name || id || "").trim().slice(0, 80);
  if (!id || !name) return undefined;
  const protocol = normalizeProviderProtocol(source.protocol);
  const models = normalizeProviderModels(source.models);
  const deleted = source.deleted === true;
  return {
    id,
    name,
    custom: true,
    deleted,
    enabled: typeof source.enabled === "boolean" ? source.enabled : undefined,
    origin: normalizeProviderOrigin(source.origin),
    sourceKernel: normalizeSourceKernel(source.sourceKernel),
    source: stringOrUndefined(source.source),
    sourcePaths: normalizeStringArray(source.sourcePaths),
    authConfigured: typeof source.authConfigured === "boolean" ? source.authConfigured : undefined,
    protocol,
    description: stringOrUndefined(source.description),
    openaiBaseUrl: stringOrUndefined(source.openaiBaseUrl),
    anthropicBaseUrl: stringOrUndefined(source.anthropicBaseUrl),
    geminiBaseUrl: stringOrUndefined(source.geminiBaseUrl),
    apiKey: normalizeApiKey(source.apiKey, source.apiKeyEnv),
    apiKeyEnv: normalizeApiKeyEnv(source.apiKeyEnv),
    credentialKind: normalizeCredentialKind(source.credentialKind),
    codexWireApi: normalizeCodexWireApi(source.codexWireApi),
    models,
    recommendedFor: normalizeRecommendedKernels(source.recommendedFor),
    websiteUrl: stringOrUndefined(source.websiteUrl),
  };
}

function normalizeProviderProtocol(value: unknown): BridgeProviderProfile["protocol"] {
  return value === "native-oauth" ||
    value === "openai-compatible" ||
    value === "anthropic-compatible" ||
    value === "gemini-compatible" ||
    value === "custom-gateway"
    ? value
    : "openai-compatible";
}

function normalizeProviderOrigin(value: unknown): BridgeProviderProfile["origin"] | undefined {
  return value === "builtin" || value === "discovered" || value === "user" ? value : undefined;
}

function normalizeSourceKernel(value: unknown): BridgeKernelId | undefined {
  return typeof value === "string" && isBridgeKernelId(value) ? value : undefined;
}

function normalizeCredentialKind(value: unknown): BridgeProviderCredentialKind | undefined {
  return value === "none" ||
    value === "native-login" ||
    value === "api-key" ||
    value === "env-key" ||
    value === "aws" ||
    value === "google-adc" ||
    value === "kernel-native"
    ? value
    : undefined;
}

function normalizeStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
  return values.length ? Array.from(new Set(values)) : undefined;
}

function normalizeProviderModels(input: unknown): BridgeRuntimeControlOption[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const models: BridgeRuntimeControlOption[] = [];
  for (const item of input) {
    const source: Record<string, unknown> =
      item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : { id: item };
    const id = String(source.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      label: String(source.label || id).trim(),
      description: stringOrUndefined(source.description),
    });
  }
  return models;
}

function normalizeRecommendedKernels(input: unknown): BridgeKernelId[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const ids = input.filter((item): item is BridgeKernelId => typeof item === "string" && isBridgeKernelId(item));
  return ids.length ? Array.from(new Set(ids)) : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeApiKey(input: unknown, legacyApiKeyEnv: unknown): string | undefined {
  const explicit = stringOrUndefined(input);
  if (explicit) return explicit;
  const legacy = stringOrUndefined(legacyApiKeyEnv);
  return legacy && !isEnvironmentVariableName(legacy) ? legacy : undefined;
}

function normalizeApiKeyEnv(input: unknown): string | undefined {
  const value = stringOrUndefined(input);
  return value && isEnvironmentVariableName(value) ? value : undefined;
}

function normalizeCodexWireApi(input: unknown): "chat" | "responses" | undefined {
  return input === "chat" || input === "responses" ? input : undefined;
}

function isEnvironmentVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function providerEnvForKernel(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile | undefined,
  model: string | undefined,
): NodeJS.ProcessEnv | undefined {
  if (profile?.enabled === false) return undefined;
  if (usesNativeProviderConfig(kernelId, profile)) return undefined;
  if (!profile) return undefined;
  const plan = planProviderBinding(kernelId, profile);
  if (!plan.supported) return undefined;
  const selectedModel = model?.trim() || profile.models[0]?.id;
  if (
    kernelId === "claude-code" &&
    profile.anthropicBaseUrl &&
    (plan.credentialKind === "aws" || plan.credentialKind === "google-adc")
  ) {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_BASE_URL: profile.anthropicBaseUrl,
    };
    if (selectedModel) {
      env.ANTHROPIC_MODEL = selectedModel;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = selectedModel;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = selectedModel;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = selectedModel;
    }
    return env;
  }
  const apiKey = providerApiKey(profile);
  if (!apiKey) return undefined;
  const env: NodeJS.ProcessEnv = {};

  if (kernelId === "codex") {
    env[codexProviderApiKeyEnv(profile.id)] = apiKey;
    return env;
  }

  if (kernelId === "hermes") {
    const apiKeyEnv = profile.apiKey
      ? profile.apiKeyEnv || providerBindingApiKeyEnv(profile.id)
      : providerBindingApiKeyEnv(profile.id);
    env[apiKeyEnv] = apiKey;
    return env;
  }

  if (kernelId === "claude-code") {
    if (!profile.anthropicBaseUrl) return undefined;
    env.ANTHROPIC_BASE_URL = profile.anthropicBaseUrl;
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    if (selectedModel) {
      env.ANTHROPIC_MODEL = selectedModel;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = selectedModel;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = selectedModel;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = selectedModel;
    }
    return env;
  }

  if (kernelId === "copilot") {
    const providerType = profile.anthropicBaseUrl && !profile.openaiBaseUrl ? "anthropic" : "openai";
    const baseUrl = providerType === "anthropic" ? profile.anthropicBaseUrl : profile.openaiBaseUrl;
    if (!baseUrl) return undefined;
    env.COPILOT_PROVIDER_TYPE = providerType;
    env.COPILOT_PROVIDER_BASE_URL = baseUrl;
    env.COPILOT_PROVIDER_API_KEY = apiKey;
    if (selectedModel) env.COPILOT_MODEL = selectedModel;
    return env;
  }

  if (profile.openaiBaseUrl) {
    env.OPENAI_BASE_URL = profile.openaiBaseUrl;
    env.OPENAI_API_KEY = apiKey;
    env.MODEL_BASE_URL = profile.openaiBaseUrl;
    env.MODEL_API_KEY = apiKey;
    if (selectedModel) {
      env.OPENAI_MODEL = selectedModel;
      env.DEFAULT_MODEL = selectedModel;
      env.DEEPSEEK_MODEL = selectedModel;
      env.QWEN_CODE_MODEL = selectedModel;
    }
  }

  if (kernelId === "pi") {
    if (profile.anthropicBaseUrl) {
      env.ANTHROPIC_BASE_URL = profile.anthropicBaseUrl;
      env.ANTHROPIC_API_KEY = apiKey;
      env.ANTHROPIC_AUTH_TOKEN = apiKey;
    }
    if (profile.geminiBaseUrl) {
      env.GEMINI_BASE_URL = profile.geminiBaseUrl;
      env.GEMINI_API_KEY = apiKey;
    }
    if (selectedModel) env.PI_MODEL = selectedModel;
  }

  if (kernelId === "deepseek-tui" && profile.openaiBaseUrl) {
    env.DEEPSEEK_BASE_URL = profile.openaiBaseUrl;
    env.DEEPSEEK_API_KEY = apiKey;
    env.DEEPSEEK_PROVIDER = "custom";
  }
  if (kernelId === "gemini-cli" && profile.geminiBaseUrl) {
    env.GEMINI_BASE_URL = profile.geminiBaseUrl;
    env.GEMINI_API_KEY = apiKey;
    if (selectedModel) env.GEMINI_MODEL = selectedModel;
  }
  return Object.keys(env).length ? env : undefined;
}

export function providerModelsForKernel(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile | undefined,
): BridgeRuntimeControlOption[] {
  if (!profile) return [];
  if (profile.enabled === false) return [];
  if (!providerSupportsKernel(kernelId, profile)) return [];
  return profile.models;
}

export function providerSupportsKernel(kernelId: BridgeKernelId, profile: BridgeProviderProfile): boolean {
  return planProviderBinding(kernelId, profile).supported;
}

export type CodexProviderRuntimeConfig = {
  providerKey: string;
  name: string;
  baseUrl: string;
  envKey: string;
  wireApi: "chat" | "responses";
};

export function codexProviderConfigForKernel(
  profile: BridgeProviderProfile | undefined,
): CodexProviderRuntimeConfig | undefined {
  if (!profile || profile.enabled === false) return undefined;
  if (usesNativeProviderConfig("codex", profile)) return undefined;
  if (!providerSupportsKernel("codex", profile)) return undefined;
  const baseUrl = profile.openaiBaseUrl?.trim();
  if (!baseUrl) return undefined;
  return {
    providerKey: codexProviderKey(profile.id),
    name: profile.name,
    baseUrl,
    envKey: codexProviderApiKeyEnv(profile.id),
    wireApi: profile.codexWireApi === "chat" ? "responses" : profile.codexWireApi ?? "responses",
  };
}

export function codexProviderNeedsResponsesChatProxy(
  profile: BridgeProviderProfile | undefined,
): boolean {
  if (!profile || profile.enabled === false) return false;
  if (usesNativeProviderConfig("codex", profile)) return false;
  if (!providerSupportsKernel("codex", profile)) return false;
  return profile.codexWireApi === "chat" || profile.id === VOLC_CODING_PROVIDER_ID;
}

function providerApiKey(profile: BridgeProviderProfile): string | undefined {
  return profile.apiKey?.trim() || (profile.apiKeyEnv ? process.env[profile.apiKeyEnv]?.trim() : undefined);
}

function codexProviderKey(providerId: string): string {
  const normalized = providerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `opengrove_${normalized || "provider"}`.slice(0, 64);
}

function codexProviderApiKeyEnv(providerId: string): string {
  const normalized = providerId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return appEnvName(`${normalized || "PROVIDER"}_API_KEY`);
}

export function hermesProviderConfigForKernel(
  profile: BridgeProviderProfile | undefined,
  model: string | undefined,
): HermesProviderRuntimeConfig | undefined {
  if (!profile) return undefined;
  if (profile.enabled === false) return undefined;
  const support = providerSupportForKernel("hermes", profile);
  const protocol = support.supported ? hermesProtocolForProvider(profile) : undefined;
  if (!protocol) return undefined;
  const baseUrl = protocol === "anthropic-compatible"
    ? profile.anthropicBaseUrl
    : profile.openaiBaseUrl;
  const trimmedBaseUrl = baseUrl?.trim();
  if (!trimmedBaseUrl) return undefined;
  const apiKeyEnv = profile.apiKeyEnv || providerBindingApiKeyEnv(profile.id);
  const selectedModel = model?.trim() || profile.models[0]?.id;
  return {
    providerKey: hermesProviderKey(profile.id),
    name: profile.name,
    baseUrl: trimmedBaseUrl,
    apiKeyEnv,
    apiMode: hermesApiModeForProtocol(protocol),
    model: selectedModel,
    models: profile.models.map((item) => item.id),
  };
}

export function providerSupportForKernel(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile,
): { supported: boolean; protocol?: BridgeProviderProfile["protocol"]; reason: string } {
  const plan = planProviderBinding(kernelId, profile);
  return {
    supported: plan.supported,
    protocol: plan.protocol,
    reason: plan.reason,
  };
}

function requiresEnvironmentKey(kernelId: string, profile: BridgeProviderProfile): boolean {
  if (profile.sourceKernel === kernelId && profile.authConfigured) return false;
  if (profile.protocol === "native-oauth") return false;
  return providerHasTransferableCredential(profile);
}

function providerBindingApiKeyEnv(providerId: string): string {
  return codexProviderApiKeyEnv(providerId);
}

function hermesProtocolForProvider(profile: BridgeProviderProfile): "openai-compatible" | "anthropic-compatible" | undefined {
  if (profile.protocol === "anthropic-compatible" && profile.anthropicBaseUrl) {
    return "anthropic-compatible";
  }
  if (profile.openaiBaseUrl) {
    return "openai-compatible";
  }
  if (profile.anthropicBaseUrl) {
    return "anthropic-compatible";
  }
  return undefined;
}

function hermesApiModeForProtocol(protocol: "openai-compatible" | "anthropic-compatible"): HermesProviderApiMode {
  return protocol === "anthropic-compatible" ? "anthropic_messages" : "chat_completions";
}

function hermesProviderKey(providerId: string): string {
  return `opengrove-${slug(providerId) || "provider"}`.slice(0, 64);
}

function bindingModeForKernel(kernelId: BridgeKernelId): BridgeKernelProviderBinding["mode"] {
  if (kernelId === "codex" || kernelId === "claude-code" || kernelId === "hermes") return "config-file";
  if (kernelId === "pi") return "native-api";
  if (kernelId === "cursor-agent" || kernelId === "kimi" || kernelId === "kiro-cli") return "native-api";
  return "env";
}

function isBridgeKernelId(value: string): value is BridgeKernelId {
  return (BRIDGE_KERNEL_IDS as readonly string[]).includes(value);
}
