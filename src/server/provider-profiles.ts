import { appEnvName, readAppEnv } from "../identity.js";
import type {
  BridgeKernelId,
  BridgeKernelProviderBinding,
  BridgeProviderProfile,
  BridgeRuntimeControlOption,
} from "./bridge-types.js";

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
      protocol: "custom-gateway",
      description: "火山引擎 Coding Plan，可通过 OpenAI-compatible 或 Anthropic-compatible 协议绑定给不同内核。",
      openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      anthropicBaseUrl: "https://ark.cn-beijing.volces.com/api/coding",
      apiKeyEnv: appEnvName("VOLC_CODING_API_KEY"),
      models: VOLC_MODELS,
      recommendedFor: [
        "codex",
        "claude-code",
        "pi",
        "deepseek-tui",
        "openclaw",
        "opencode",
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
      models: [
        { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
        { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      ],
      recommendedFor: ["claude-code", "pi"],
      websiteUrl: "https://console.anthropic.com",
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      protocol: "openai-compatible",
      description: "OpenAI-compatible 聚合网关。",
      openaiBaseUrl: "https://openrouter.ai/api/v1",
      apiKeyEnv: appEnvName("OPENROUTER_API_KEY"),
      models: [],
      recommendedFor: ["pi", "deepseek-tui", "opencode", "qwen-code"],
      websiteUrl: "https://openrouter.ai",
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
  const presetIds = new Set(presets.map((profile) => profile.id));
  const custom = (customProviders ?? [])
    .map(normalizeCustomProviderProfile)
    .filter((profile): profile is BridgeProviderProfile => Boolean(profile && !presetIds.has(profile.id)));
  return [...presets, ...custom];
}

export function resolveProviderForKernel(
  kernelId: BridgeKernelId,
  bindings: Record<string, string> | undefined,
  customProviders?: BridgeProviderProfile[],
): BridgeProviderProfile | undefined {
  const providerId = bindings?.[kernelId];
  if (!providerId) return undefined;
  return getAllBridgeProviderProfiles(customProviders).find((profile) => profile.id === providerId);
}

export function providerKeyPresent(profile: BridgeProviderProfile): boolean {
  return Boolean(profile.apiKeyEnv && process.env[profile.apiKeyEnv]?.trim());
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
    output.push({
      kernelId,
      providerId,
      enabled: true,
      mode: bindingModeForKernel(kernelId),
      status: profile.apiKeyEnv && !providerKeyPresent(profile) ? "missing-key" : "ready",
      notes: profile.apiKeyEnv && !providerKeyPresent(profile)
        ? [`Set ${profile.apiKeyEnv} in the bridge process environment. The key is never persisted by OpenGrove.`]
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
  return {
    id,
    name,
    custom: true,
    protocol,
    description: stringOrUndefined(source.description),
    openaiBaseUrl: stringOrUndefined(source.openaiBaseUrl),
    anthropicBaseUrl: stringOrUndefined(source.anthropicBaseUrl),
    geminiBaseUrl: stringOrUndefined(source.geminiBaseUrl),
    apiKeyEnv: stringOrUndefined(source.apiKeyEnv),
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
  if (!profile || !profile.apiKeyEnv) return undefined;
  const apiKey = process.env[profile.apiKeyEnv]?.trim();
  if (!apiKey) return undefined;
  const env: NodeJS.ProcessEnv = {};
  const selectedModel = model?.trim() || profile.models[0]?.id;

  if (kernelId === "claude-code") {
    if (!profile.anthropicBaseUrl) return undefined;
    env.ANTHROPIC_BASE_URL = profile.anthropicBaseUrl;
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
    if (selectedModel) env.ANTHROPIC_MODEL = selectedModel;
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

  if (kernelId === "deepseek-tui" && profile.openaiBaseUrl) {
    env.DEEPSEEK_BASE_URL = profile.openaiBaseUrl;
    env.DEEPSEEK_API_KEY = apiKey;
    env.DEEPSEEK_PROVIDER = "custom";
  }
  return Object.keys(env).length ? env : undefined;
}

export function providerModelsForKernel(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile | undefined,
): BridgeRuntimeControlOption[] {
  if (!profile) return [];
  if (kernelId === "claude-code" && !profile.anthropicBaseUrl) return [];
  if (kernelId !== "claude-code" && !profile.openaiBaseUrl && profile.protocol !== "native-oauth") return [];
  return profile.models;
}

function bindingModeForKernel(kernelId: BridgeKernelId): BridgeKernelProviderBinding["mode"] {
  if (kernelId === "codex" || kernelId === "claude-code" || kernelId === "hermes") return "config-file";
  if (kernelId === "pi" || kernelId === "openclaw") return "native-api";
  return "env";
}

function isBridgeKernelId(value: string): value is BridgeKernelId {
  return [
    "codex",
    "claude-code",
    "hermes",
    "pi",
    "openclaw",
    "deepseek-tui",
    "gemini-cli",
    "qwen-code",
    "opencode",
  ].includes(value);
}
