import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { BridgeKernelId, BridgeProviderProfile, BridgeRuntimeControlOption } from "./bridge-types.js";

interface ClaudeProviderPreset {
  id: string;
  name: string;
  baseUrls: string[];
}

export interface KernelNativeProviderProfile {
  kernel: BridgeKernelId;
  source: string;
  sourcePaths: string[];
  env: Record<string, string>;
  settingsModel?: string;
  providerId: string;
  providerLabel: string;
  protocol?: BridgeProviderProfile["protocol"];
  baseUrl?: string;
  apiKeyEnv?: string;
  authConfigured: boolean;
  models: BridgeRuntimeControlOption[];
  defaultModel?: string;
  reasoningEfforts?: BridgeRuntimeControlOption[];
  defaultReasoningEffort?: string;
  speedTiers?: BridgeRuntimeControlOption[];
  defaultSpeedTier?: string;
}

export interface KernelNativeProfileReadOptions {
  cwd?: string;
  configHome?: string;
}

const CLAUDE_MODEL_FAMILIES = [
  {
    alias: "opus",
    label: "Opus",
    envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL",
    nameKey: "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    descriptionKey: "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION",
  },
  {
    alias: "sonnet",
    label: "Sonnet",
    envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL",
    nameKey: "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    descriptionKey: "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
  },
  {
    alias: "haiku",
    label: "Haiku",
    envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    nameKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    descriptionKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
  },
] as const;

const HERMES_PROVIDER_ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "NOUS_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GLM_API_KEY",
  "KIMI_API_KEY",
  "KIMI_CN_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "HF_TOKEN",
  "NVIDIA_API_KEY",
  "XIAOMI_API_KEY",
  "ARCEEAI_API_KEY",
  "OLLAMA_API_KEY",
  "KILOCODE_API_KEY",
  "AI_GATEWAY_API_KEY",
  "LM_API_KEY",
] as const;

const CLAUDE_PROVIDER_PRESETS: ClaudeProviderPreset[] = [
  { id: "anthropic", name: "Claude Official", baseUrls: ["https://api.anthropic.com"] },
  { id: "aws-bedrock", name: "AWS Bedrock", baseUrls: ["https://bedrock-runtime."] },
  { id: "google-vertex", name: "Google Vertex AI", baseUrls: [] },
  { id: "gemini-native", name: "Gemini Native", baseUrls: ["https://generativelanguage.googleapis.com"] },
  { id: "deepseek", name: "DeepSeek", baseUrls: ["https://api.deepseek.com/anthropic"] },
  { id: "zhipu-glm", name: "Zhipu GLM", baseUrls: ["https://open.bigmodel.cn/api/anthropic", "https://api.z.ai/api/anthropic"] },
  { id: "qianfan", name: "Baidu Qianfan", baseUrls: ["https://qianfan.baidubce.com/anthropic/coding"] },
  { id: "bailian", name: "Bailian", baseUrls: ["https://dashscope.aliyuncs.com/apps/anthropic", "https://coding.dashscope.aliyuncs.com/apps/anthropic"] },
  { id: "kimi", name: "Kimi", baseUrls: ["https://api.moonshot.cn/anthropic", "https://api.kimi.com/coding"] },
  { id: "stepfun", name: "StepFun", baseUrls: ["https://api.stepfun.com/step_plan", "https://api.stepfun.ai/step_plan"] },
  { id: "modelscope", name: "ModelScope", baseUrls: ["https://api-inference.modelscope.cn"] },
  { id: "minimax", name: "MiniMax", baseUrls: ["https://api.minimaxi.com/anthropic", "https://api.minimax.io/anthropic"] },
  { id: "volcengine", name: "Volcengine Ark", baseUrls: ["https://ark.cn-beijing.volces.com/api/coding"] },
  { id: "aihubmix", name: "AiHubMix", baseUrls: ["https://aihubmix.com", "https://api.aihubmix.com"] },
  { id: "siliconflow", name: "SiliconFlow", baseUrls: ["https://api.siliconflow.cn", "https://api.siliconflow.com"] },
  { id: "openrouter", name: "OpenRouter", baseUrls: ["https://openrouter.ai/api"] },
  { id: "therouter", name: "TheRouter", baseUrls: ["https://api.therouter.ai"] },
  { id: "novita", name: "Novita AI", baseUrls: ["https://api.novita.ai/anthropic"] },
  { id: "github-copilot", name: "GitHub Copilot", baseUrls: ["https://api.githubcopilot.com"] },
  { id: "codex-oauth", name: "Codex", baseUrls: ["https://chatgpt.com/backend-api/codex"] },
  { id: "nvidia", name: "Nvidia", baseUrls: ["https://integrate.api.nvidia.com"] },
  { id: "pipellm", name: "PIPELLM", baseUrls: ["https://cc-api.pipellm.ai"] },
  { id: "xiaomi-mimo", name: "Xiaomi MiMo", baseUrls: ["https://api.xiaomimimo.com/anthropic"] },
  { id: "newapi", name: "NewAPI", baseUrls: [] },
  { id: "n1n", name: "n1n.ai", baseUrls: [] },
];

export function readKernelNativeProviderProfile(
  kernel: BridgeKernelId,
  input: string | KernelNativeProfileReadOptions = {},
): KernelNativeProviderProfile | undefined {
  const options = readOptions(input);
  if (kernel === "claude-code") return readClaudeCodeNativeProfile(options);
  if (kernel === "codex") return readCodexNativeProfile(options.configHome);
  if (kernel === "hermes") return readHermesNativeProfile(options.configHome);
  if (kernel === "deepseek-tui") return readSimpleHomeConfigProfile(kernel, "DeepSeek TUI", resolve(configHome(options.configHome, ".deepseek"), "config.toml"));
  if (kernel === "gemini-cli") return readSimpleHomeConfigProfile(kernel, "Google Gemini", resolve(configHome(options.configHome, ".gemini"), "settings.json"));
  if (kernel === "qwen-code") return readSimpleHomeConfigProfile(kernel, "Qwen Code", resolve(configHome(options.configHome, ".qwen"), "settings.json"));
  if (kernel === "pi") return readSimpleHomeConfigProfile(kernel, "Pi", resolve(configHome(options.configHome, ".pi"), "agent", "auth.json"));
  if (kernel === "openclaw") return readSimpleHomeConfigProfile(kernel, "OpenClaw", resolve(configHome(options.configHome, ".openclaw"), "providers"));
  if (kernel === "opencode") return readSimpleHomeConfigProfile(kernel, "OpenCode", resolve(configHome(options.configHome, ".config/opencode"), "opencode.json"));
  return undefined;
}

export function readKernelNativeBaseUrl(kernel: BridgeKernelId, input: string | KernelNativeProfileReadOptions = {}): string {
  return readKernelNativeProviderProfile(kernel, input)?.baseUrl ?? "";
}

export function readKernelNativeAuthToken(kernel: BridgeKernelId, input: string | KernelNativeProfileReadOptions = {}): string {
  const profile = readKernelNativeProviderProfile(kernel, input);
  if (!profile) return "";
  return (
    stringValue(profile.env.ANTHROPIC_AUTH_TOKEN) ||
    stringValue(profile.env.ANTHROPIC_API_KEY) ||
    stringValue(profile.env.OPENAI_API_KEY) ||
    stringValue(profile.env.GEMINI_API_KEY) ||
    ""
  );
}

export function readKernelNativeConfiguredModel(kernel: BridgeKernelId, input: string | KernelNativeProfileReadOptions = {}): string | undefined {
  return readKernelNativeProviderProfile(kernel, input)?.defaultModel;
}

function readClaudeCodeNativeProfile(options: KernelNativeProfileReadOptions): KernelNativeProviderProfile {
  const cwd = options.cwd ?? process.cwd();
  const home = claudeConfigHome(options.configHome);
  const { settings, paths } = readMergedClaudeSettings(cwd, home);
  const settingsEnv = readStringMap((settings.env as Record<string, unknown> | undefined) ?? {});
  const env = {
    ...settingsEnv,
    ...readRelevantProcessEnv(),
  };
  const settingsModel = stringValue(env.ANTHROPIC_MODEL) || stringValue(settings.model);
  const baseUrl = readClaudeBaseUrlFromEnv(env);
  const provider = detectClaudeProvider(env, baseUrl);
  const models = buildClaudeModelOptions(settings, env);
  const defaultModel = resolveClaudeDefaultModel(settingsModel, env, models);
  const sourcePaths = paths.length ? paths : [resolve(home, "settings.json")];

  return {
    kernel: "claude-code",
    source: paths.length ? sourcePaths.join(",") : "claude-code-defaults",
    sourcePaths,
    env,
    settingsModel,
    providerId: provider.id,
    providerLabel: provider.name,
    apiKeyEnv: claudeApiKeyEnv(provider.id, env),
    baseUrl,
    authConfigured: hasClaudeAuth(env, settings),
    models,
    defaultModel,
  };
}

function readCodexNativeProfile(configHomeOverride?: string): KernelNativeProviderProfile {
  const codexHome = configHomeOverride?.trim() || process.env.CODEX_HOME?.trim() || resolve(homedir(), ".codex");
  const configPath = resolve(codexHome, "config.toml");
  const authPath = resolve(codexHome, "auth.json");
  const modelsCachePath = resolve(codexHome, "models_cache.json");
  const config = existsSync(configPath) ? readFileText(configPath) : "";
  const modelProvider = readTomlString(config, "model_provider");
  const providerBlock = modelProvider ? readTomlTable(config, `model_providers.${modelProvider}`) : {};
  const baseUrl = stringValue(providerBlock.base_url);
  const apiKeyEnv = stringValue(providerBlock.env_key);
  const model = readTomlString(config, "model");
  const effort = readTomlString(config, "model_reasoning_effort") || "medium";
  const models = readCodexModelsCache(modelsCachePath);
  const auth = readJsonObject(authPath);
  return {
    kernel: "codex",
    source: [configPath, modelsCachePath].filter((path) => existsSync(path)).join(",") || "codex-defaults",
    sourcePaths: [configPath, authPath, modelsCachePath],
    env: {
      OPENAI_BASE_URL: baseUrl ?? "",
      OPENAI_API_KEY: stringValue(auth.OPENAI_API_KEY) ? "<configured>" : "",
    },
    settingsModel: model,
    providerId: modelProvider || (baseUrl ? "openai-compatible" : "openai"),
    providerLabel: stringValue(providerBlock.name) || (baseUrl ? modelProvider || "OpenAI-compatible provider" : "OpenAI Official"),
    baseUrl,
    apiKeyEnv,
    authConfigured: Boolean(auth.OPENAI_API_KEY || auth.tokens || existsSync(authPath)),
    models,
    defaultModel: model || models[0]?.id,
    reasoningEfforts: [
      { id: "low", label: "低" },
      { id: "medium", label: "中" },
      { id: "high", label: "高" },
      { id: "xhigh", label: "超高" },
    ],
    defaultReasoningEffort: effort,
    speedTiers: [{ id: "standard", label: "标准" }],
    defaultSpeedTier: "standard",
  };
}

function readHermesNativeProfile(configHomeOverride?: string): KernelNativeProviderProfile {
  const hermesHome = configHome(configHomeOverride, ".hermes");
  const configPath = resolve(hermesHome, "config.yaml");
  const envPath = resolve(hermesHome, ".env");
  const authPath = resolve(hermesHome, "auth.json");
  const config = existsSync(configPath) ? readFileText(configPath) : "";
  const env = { ...readDotEnvFile(envPath), ...readSelectedProcessEnv(HERMES_PROVIDER_ENV_KEYS) };
  const providerId = readYamlString(config, ["model", "provider"]) || "hermes-native";
  const providerName = readYamlString(config, ["providers", providerId, "name"]);
  const baseUrl =
    readYamlString(config, ["model", "base_url"]) ||
    readYamlString(config, ["providers", providerId, "base_url"]);
  const apiMode =
    readYamlString(config, ["model", "api_mode"]) ||
    readYamlString(config, ["providers", providerId, "transport"]);
  const apiKeyEnv =
    readYamlString(config, ["model", "key_env"]) ||
    readYamlString(config, ["providers", providerId, "key_env"]);
  const resolvedApiKeyEnv = apiKeyEnv || inferHermesApiKeyEnv(providerId, baseUrl, env);
  const defaultModel =
    readYamlString(config, ["model", "default"]) ||
    readYamlString(config, ["providers", providerId, "default_model"]);
  const models = readYamlMapKeys(config, ["providers", providerId, "models"])
    .map((id) => ({ id, label: modelDisplayName(id) }));
  const protocol = apiMode?.includes("anthropic")
    ? "anthropic-compatible"
    : "openai-compatible";

  return {
    kernel: "hermes",
    source: existsSync(configPath) ? configPath : "hermes-defaults",
    sourcePaths: [configPath, envPath],
    env,
    settingsModel: defaultModel,
    providerId,
    providerLabel: providerName || hermesProviderLabel(providerId, baseUrl) || providerId || "Hermes",
    protocol,
    baseUrl,
    apiKeyEnv: resolvedApiKeyEnv,
    authConfigured: isHermesNativeProviderConfigured(providerId, baseUrl, resolvedApiKeyEnv, env, existsSync(authPath)),
    models,
    defaultModel: defaultModel || models[0]?.id,
  };
}

function readSimpleHomeConfigProfile(
  kernel: BridgeKernelId,
  providerLabel: string,
  configPath: string,
): KernelNativeProviderProfile {
  return {
    kernel,
    source: existsSync(configPath) ? configPath : `${kernel}-defaults`,
    sourcePaths: [configPath],
    env: {},
    providerId: `${kernel}-native`,
    providerLabel,
    authConfigured: existsSync(configPath),
    models: [],
  };
}

function readMergedClaudeSettings(cwd: string, claudeHome: string): { settings: Record<string, unknown>; paths: string[] } {
  const paths = claudeSettingsPaths(cwd, claudeHome).filter((path) => existsSync(path));
  const settings: Record<string, unknown> = {};
  for (const path of paths) {
    deepMerge(settings, readJsonObject(path));
  }
  return { settings, paths };
}

function claudeSettingsPaths(cwd: string, configHome: string): string[] {
  return [
    resolve(configHome, "settings.json"),
    resolve(cwd, ".claude", "settings.json"),
    resolve(cwd, ".claude", "settings.local.json"),
    ...managedClaudeSettingsPaths(),
  ];
}

function managedClaudeSettingsPaths(): string[] {
  const roots = [
    "/Library/Application Support/ClaudeCode",
    "/etc/claude-code",
  ];
  const paths: string[] = [];
  for (const root of roots) {
    paths.push(join(root, "managed-settings.json"));
    const dropIn = join(root, "managed-settings.d");
    try {
      for (const file of readdirSync(dropIn).filter((item) => item.endsWith(".json") && !item.startsWith(".")).sort()) {
        paths.push(join(dropIn, file));
      }
    } catch {
      // No managed drop-in directory.
    }
  }
  return paths;
}

function claudeConfigHome(configHomeOverride?: string): string {
  return configHomeOverride?.trim() || process.env.CLAUDE_CONFIG_DIR?.trim() || resolve(homedir(), ".claude");
}

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readOptions(input: string | KernelNativeProfileReadOptions): KernelNativeProfileReadOptions {
  return typeof input === "string" ? { cwd: input } : input;
}

function configHome(configHomeOverride: string | undefined, fallbackHomePath: string): string {
  return configHomeOverride?.trim() || resolve(homedir(), fallbackHomePath);
}

function readFileText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readSelectedProcessEnv(keys: readonly string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) output[key] = value;
  }
  return output;
}

function readDotEnvFile(path: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of readFileText(path).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = dotEnvValue(match[2]);
    if (value) output[match[1]] = value;
  }
  return output;
}

function dotEnvValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function readTomlString(text: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*"(.*?)"\\s*$`, "m"));
  return match?.[1];
}

function readTomlTable(text: string, tableName: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const tableHeader = `[${tableName}]`;
  const output: Record<string, string> = {};
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inTable = trimmed === tableHeader;
      continue;
    }
    if (!inTable || !trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*"(.*?)"\s*$/);
    if (match) output[match[1]] = match[2];
  }
  return output;
}

function readYamlString(text: string, path: string[]): string | undefined {
  return parseYamlEntries(text).find((entry) => samePath(entry.path, path))?.value;
}

function readYamlMapKeys(text: string, path: string[]): string[] {
  return Array.from(new Set(
    parseYamlEntries(text)
      .filter((entry) => entry.path.length === path.length + 1 && samePath(entry.path.slice(0, -1), path))
      .map((entry) => entry.path[entry.path.length - 1])
      .filter((entry) => Boolean(entry.trim())),
  ));
}

function inferHermesApiKeyEnv(providerId: string, baseUrl: string | undefined, env: Record<string, string>): string | undefined {
  const text = `${providerId} ${baseUrl || ""}`.toLowerCase();
  const candidates = hermesApiKeyEnvCandidates(text);
  return candidates.find((key) => Boolean(env[key]?.trim())) ?? candidates[0];
}

function hermesApiKeyEnvCandidates(text: string): string[] {
  if (text.includes("openrouter")) return ["OPENROUTER_API_KEY", "OPENAI_API_KEY"];
  if (text.includes("nous-api")) return ["NOUS_API_KEY"];
  if (text.includes("anthropic")) return ["ANTHROPIC_API_KEY"];
  if (text.includes("gemini") || text.includes("google")) return ["GEMINI_API_KEY", "GOOGLE_API_KEY"];
  if (text.includes("zai") || text.includes("zhipu") || text.includes("glm")) return ["GLM_API_KEY"];
  if (text.includes("kimi") || text.includes("moonshot")) return ["KIMI_API_KEY", "KIMI_CN_API_KEY"];
  if (text.includes("minimax-cn")) return ["MINIMAX_CN_API_KEY"];
  if (text.includes("minimax")) return ["MINIMAX_API_KEY"];
  if (text.includes("huggingface")) return ["HF_TOKEN"];
  if (text.includes("nvidia")) return ["NVIDIA_API_KEY"];
  if (text.includes("xiaomi")) return ["XIAOMI_API_KEY"];
  if (text.includes("arcee")) return ["ARCEEAI_API_KEY"];
  if (text.includes("ollama-cloud")) return ["OLLAMA_API_KEY"];
  if (text.includes("kilocode")) return ["KILOCODE_API_KEY"];
  if (text.includes("ai-gateway")) return ["AI_GATEWAY_API_KEY"];
  if (text.includes("lmstudio")) return ["LM_API_KEY"];
  if (text.includes("openai")) return ["OPENAI_API_KEY"];
  return [];
}

function hermesProviderLabel(providerId: string, baseUrl: string | undefined): string | undefined {
  const text = `${providerId} ${baseUrl || ""}`.toLowerCase();
  if (text.includes("openrouter")) return "OpenRouter";
  if (text.includes("anthropic")) return "Anthropic";
  if (text.includes("gemini") || text.includes("google")) return "Google Gemini";
  if (text.includes("zai") || text.includes("zhipu") || text.includes("glm")) return "Zhipu GLM";
  if (text.includes("kimi") || text.includes("moonshot")) return "Kimi";
  if (text.includes("minimax")) return "MiniMax";
  if (text.includes("xiaomi")) return "Xiaomi MiMo";
  if (text.includes("lmstudio")) return "LM Studio";
  if (text.includes("openai")) return "OpenAI";
  return undefined;
}

function isHermesNativeProviderConfigured(
  providerId: string,
  baseUrl: string | undefined,
  apiKeyEnv: string | undefined,
  env: Record<string, string>,
  hasHermesAuth: boolean,
): boolean {
  const provider = providerId.trim().toLowerCase();
  if ((provider === "nous" || provider === "openai-codex") && hasHermesAuth) return true;
  if (apiKeyEnv && Boolean(env[apiKeyEnv]?.trim())) return true;
  return isLocalNoAuthHermesProvider(provider, baseUrl);
}

function isLocalNoAuthHermesProvider(providerId: string, baseUrl: string | undefined): boolean {
  if (providerId !== "lmstudio" && providerId !== "custom") return false;
  try {
    const url = new URL(baseUrl || "");
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function parseYamlEntries(text: string): Array<{ path: string[]; value?: string }> {
  const stack: Array<{ indent: number; key: string }> = [];
  const entries: Array<{ path: string[]; value?: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^(\s*)(?:"([^"]+)"|'([^']+)'|([^:#]+?))\s*:\s*(.*?)\s*$/);
    if (!match) continue;
    const indent = match[1].length;
    const key = (match[2] || match[3] || match[4] || "").trim();
    if (!key) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const path = [...stack.map((item) => item.key), key];
    const value = yamlScalarValue(match[5]);
    entries.push({ path, value });
    if (value === undefined) {
      stack.push({ indent, key });
    }
  }
  return entries;
}

function yamlScalarValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "{}") return undefined;
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim() || undefined;
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function readCodexModelsCache(path: string): BridgeRuntimeControlOption[] {
  const parsed = readJsonObject(path);
  const models = Array.isArray(parsed.models) ? parsed.models : [];
  return models
    .map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {})
    .map((model) => {
      const id = stringValue(model.slug) || stringValue(model.id);
      const label = stringValue(model.display_name) || stringValue(model.label) || id;
      return id ? { id, label: label || id } : undefined;
    })
    .filter((item): item is BridgeRuntimeControlOption => Boolean(item));
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    target[key] = value;
  }
}

function readStringMap(input: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") output[key] = value;
    if (typeof value === "number" || typeof value === "boolean") output[key] = String(value);
  }
  return output;
}

function readRelevantProcessEnv(): Record<string, string> {
  const keys = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
    "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION",
    "ANTHROPIC_CUSTOM_MODEL_OPTION",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME",
    "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "AWS_REGION",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "GOOGLE_CLOUD_PROJECT",
    "CLOUD_ML_REGION",
  ];
  const output: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) output[key] = value;
  }
  return output;
}

function readClaudeBaseUrlFromEnv(env: Record<string, string>): string | undefined {
  const explicit = stringValue(env.ANTHROPIC_BASE_URL);
  if (explicit) return explicit;
  if (isEnabled(env.CLAUDE_CODE_USE_BEDROCK) && env.AWS_REGION) {
    return `https://bedrock-runtime.${env.AWS_REGION}.amazonaws.com`;
  }
  return undefined;
}

function detectClaudeProvider(env: Record<string, string>, baseUrl: string | undefined): { id: string; name: string } {
  if (isEnabled(env.CLAUDE_CODE_USE_BEDROCK) || baseUrl?.includes("bedrock-runtime.")) {
    return {
      id: env.AWS_BEARER_TOKEN_BEDROCK ? "aws-bedrock-api-key" : "aws-bedrock",
      name: env.AWS_BEARER_TOKEN_BEDROCK ? "AWS Bedrock (API Key)" : "AWS Bedrock",
    };
  }
  if (isEnabled(env.CLAUDE_CODE_USE_VERTEX) || env.GOOGLE_CLOUD_PROJECT || env.CLOUD_ML_REGION) {
    return { id: "google-vertex", name: "Google Vertex AI" };
  }

  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized) {
    const preset = CLAUDE_PROVIDER_PRESETS
      .flatMap((preset) => preset.baseUrls.map((url) => ({ preset, url: normalizeBaseUrl(url) })))
      .filter((item) => item.url && normalized.startsWith(item.url))
      .sort((a, b) => b.url.length - a.url.length)[0]?.preset;
    if (preset) return { id: preset.id, name: preset.name };
    return { id: "anthropic-compatible", name: "Anthropic-compatible provider" };
  }

  return { id: "anthropic", name: "Claude Official" };
}

function claudeApiKeyEnv(providerId: string, env: Record<string, string>): string | undefined {
  if (providerId === "aws-bedrock" || providerId === "aws-bedrock-api-key" || providerId === "google-vertex") {
    return undefined;
  }
  if (env.ANTHROPIC_AUTH_TOKEN) return "ANTHROPIC_AUTH_TOKEN";
  if (env.ANTHROPIC_API_KEY) return "ANTHROPIC_API_KEY";
  return undefined;
}

function buildClaudeModelOptions(
  settings: Record<string, unknown>,
  env: Record<string, string>,
): BridgeRuntimeControlOption[] {
  const models: BridgeRuntimeControlOption[] = [];
  const add = (id: string | undefined, label: string | undefined, description?: string) => {
    const normalized = id?.trim();
    if (!normalized || models.some((item) => item.id === normalized)) return;
    models.push({ id: normalized, label: label?.trim() || normalized, description });
  };

  const explicitModel = stringValue(env.ANTHROPIC_MODEL);
  if (explicitModel && !isClaudeFamilyAlias(explicitModel)) {
    add(explicitModel, modelDisplayName(explicitModel));
  }

  const allowedAliases = readAvailableModelAliases(settings);
  for (const family of CLAUDE_MODEL_FAMILIES) {
    if (allowedAliases && !allowedAliases.has(family.alias)) continue;
    const pinned = stringValue(env[family.envKey]);
    const name = stringValue(env[family.nameKey]);
    const description = stringValue(env[family.descriptionKey]);
    add(
      family.alias,
      pinned ? (name || `${family.label} · ${pinned}`) : family.label,
      [description, pinned ? `provider model: ${pinned}` : ""].filter(Boolean).join(" · ") || undefined,
    );
  }

  const customModel = stringValue(env.ANTHROPIC_CUSTOM_MODEL_OPTION);
  if (customModel) {
    add(
      customModel,
      stringValue(env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME) || modelDisplayName(customModel),
      stringValue(env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION),
    );
  }

  const overrides = settings.modelOverrides && typeof settings.modelOverrides === "object" && !Array.isArray(settings.modelOverrides)
    ? settings.modelOverrides as Record<string, unknown>
    : {};
  for (const [model, mapped] of Object.entries(overrides)) {
    add(model, modelDisplayName(model), stringValue(mapped) ? `provider model: ${stringValue(mapped)}` : undefined);
  }

  return models;
}

function resolveClaudeDefaultModel(
  requested: string | undefined,
  env: Record<string, string>,
  models: BridgeRuntimeControlOption[],
): string | undefined {
  const model = requested?.trim();
  if (!model) return models[0]?.id;
  const suffix = model.endsWith("[1m]") ? "[1m]" : "";
  const alias = suffix ? model.slice(0, -4) : model;
  if (isClaudeFamilyAlias(alias)) return `${alias}${suffix}`;
  return model;
}

function readAvailableModelAliases(settings: Record<string, unknown>): Set<string> | undefined {
  const value = settings.availableModels;
  if (!Array.isArray(value)) return undefined;
  const aliases = value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter((item) => item === "opus" || item === "sonnet" || item === "haiku");
  return aliases.length ? new Set(aliases) : undefined;
}

function hasClaudeAuth(env: Record<string, string>, settings: Record<string, unknown>): boolean {
  return Boolean(
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_API_KEY ||
    env.AWS_BEARER_TOKEN_BEDROCK ||
    env.AWS_ACCESS_KEY_ID ||
    env.GOOGLE_CLOUD_PROJECT ||
    settings.apiKeyHelper ||
    existsSync(resolve(homedir(), ".claude.json")),
  );
}

function modelDisplayName(model: string): string {
  return model
    .replace(/^global\.anthropic\./, "")
    .replace(/^us\.anthropic\./, "")
    .replace(/^anthropic\//, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isClaudeFamilyAlias(value: string): boolean {
  const normalized = value.trim().replace(/\[1m\]$/, "");
  return normalized === "opus" || normalized === "sonnet" || normalized === "haiku";
}

function isEnabled(value: unknown): boolean {
  return value === true || value === "1" || value === "true";
}
