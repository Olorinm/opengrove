import type {
  BridgeSettings,
  InviteLandingSettings,
  KernelAuthState,
  KernelOption,
  KernelProxySettings,
  MatrixSettings,
  MountedAppSettings,
  ProviderProfile,
  VoiceSttProviderId,
} from "../../bridge";
import type { TranslationFn } from "../../i18n";

export type ProviderFormState = {
  id: string;
  name: string;
  protocol: string;
  description: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  geminiBaseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  models: string;
};

export const PROVIDER_PROTOCOL_OPTIONS = [
  { id: "openai-compatible", label: "OpenAI" },
  { id: "anthropic-compatible", label: "Anthropic" },
  { id: "gemini-compatible", label: "Gemini" },
];

export function emptyProviderForm(): ProviderFormState {
  return {
    id: "",
    name: "",
    protocol: "openai-compatible",
    description: "",
    openaiBaseUrl: "",
    anthropicBaseUrl: "",
    geminiBaseUrl: "",
    apiKey: "",
    apiKeyEnv: "",
    models: "",
  };
}

export function updateProviderForm<K extends keyof ProviderFormState>(
  state: ProviderFormState,
  key: K,
  value: ProviderFormState[K],
): ProviderFormState {
  const next = { ...state, [key]: value };
  if (key === "name" && !state.id.trim()) {
    next.id = slug(String(value));
  }
  return next;
}

export function providerProfileFromForm(form: ProviderFormState): ProviderProfile | undefined {
  const id = slug(form.id || form.name);
  const name = form.name.trim();
  if (!id || !name) return undefined;
  const nativeAuth = isNativeAuthProtocol(form.protocol);
  const apiKey = normalizeProviderApiKey(form.apiKey);
  const apiKeyEnv = form.apiKeyEnv.trim();
  return {
    id,
    name,
    custom: true,
    enabled: true,
    origin: "user",
    protocol: form.protocol,
    description: form.description.trim() || undefined,
    openaiBaseUrl: nativeAuth ? undefined : form.openaiBaseUrl.trim() || undefined,
    anthropicBaseUrl: nativeAuth ? undefined : form.anthropicBaseUrl.trim() || undefined,
    geminiBaseUrl: nativeAuth ? undefined : form.geminiBaseUrl.trim() || undefined,
    apiKey: nativeAuth ? undefined : apiKey || undefined,
    apiKeyEnv: nativeAuth ? undefined : apiKeyEnv || undefined,
    credentialKind: providerCredentialKindFromForm(id, nativeAuth, apiKey, apiKeyEnv),
    models: form.models
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id })),
  };
}

export function providerFormFromProfile(provider: ProviderProfile): ProviderFormState {
  return {
    id: provider.id,
    name: provider.name,
    protocol: editableProviderProtocol(provider),
    description: provider.description || "",
    openaiBaseUrl: provider.openaiBaseUrl || "",
    anthropicBaseUrl: provider.anthropicBaseUrl || "",
    geminiBaseUrl: provider.geminiBaseUrl || "",
    apiKey: provider.apiKey || "",
    apiKeyEnv: provider.apiKeyEnv || "",
    models: (provider.models ?? []).map((model) => model.id).join(", "),
  };
}

export function primaryBaseUrl(form: ProviderFormState): string {
  if (form.protocol === "anthropic-compatible") return form.anthropicBaseUrl;
  if (form.protocol === "gemini-compatible") return form.geminiBaseUrl;
  return form.openaiBaseUrl;
}

export function sortAvailableKernelsFirst(options: KernelOption[]): KernelOption[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) => {
      if (left.option.available !== right.option.available) {
        return left.option.available ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ option }) => option);
}

export function sortEnabledProvidersFirst(
  providers: ProviderProfile[],
  bindings: Record<string, string>,
): ProviderProfile[] {
  return providers
    .map((provider, index) => ({
      provider,
      index,
      enabled: isProviderEnabled(provider, bindings),
    }))
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ provider }) => provider);
}

export function emptyKernelProxySettings(): KernelProxySettings {
  return {
    enabled: false,
    injected: false,
    proxyUrl: "http://127.0.0.1:7890",
    noProxy: "127.0.0.1,localhost,::1",
    nodeUseEnvProxy: false,
    environmentProxyUrl: "",
    source: "none",
  };
}

export function normalizeKernelProxySettings(input: Partial<KernelProxySettings> | undefined): KernelProxySettings {
  const defaults = emptyKernelProxySettings();
  return {
    ...defaults,
    ...input,
    enabled: Boolean(input?.enabled),
    proxyUrl: input?.proxyUrl?.trim() || defaults.proxyUrl,
    noProxy: input?.noProxy?.trim() || defaults.noProxy,
    nodeUseEnvProxy: Boolean(input?.nodeUseEnvProxy),
  };
}

export function emptyInviteLandingSettings(): InviteLandingSettings {
  return {
    baseUrl: "",
  };
}

export function normalizeInviteLandingSettings(input: Partial<InviteLandingSettings> | undefined): InviteLandingSettings {
  const defaults = emptyInviteLandingSettings();
  const baseUrl = input?.baseUrl?.trim() || "";
  return {
    ...defaults,
    ...input,
    baseUrl,
  };
}

export function emptyMatrixSettings(): MatrixSettings {
  return {
    enabled: false,
    homeserverUrl: "",
    userId: "",
    accessToken: "",
    bindings: {},
  };
}

export function normalizeMatrixSettings(input: Partial<MatrixSettings> | undefined): MatrixSettings {
  const defaults = emptyMatrixSettings();
  return {
    ...defaults,
    ...input,
    enabled: Boolean(input?.enabled),
    homeserverUrl: input?.homeserverUrl?.trim() || "",
    userId: input?.userId?.trim() || "",
    accessToken: input?.accessToken?.trim() || undefined,
    bindings: input?.bindings ?? {},
  };
}

export function emptyVoiceSettings(): NonNullable<BridgeSettings["voice"]> {
  return {
    stt: {
      provider: "openai",
      language: "auto",
      openai: {
        model: "gpt-4o-mini-transcribe",
        baseUrl: "https://api.openai.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
      },
      groq: {
        model: "whisper-large-v3-turbo",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKeyEnv: "GROQ_API_KEY",
      },
      localWhisper: {
        model: "base",
        command: "",
        language: "auto",
      },
      browser: {
        language: "auto",
      },
    },
    sttProviders: [
      { id: "openai", label: "OpenAI", mode: "recorded-upload", configured: false, defaultModel: "gpt-4o-mini-transcribe" },
      { id: "groq", label: "Groq", mode: "recorded-upload", configured: false, defaultModel: "whisper-large-v3-turbo" },
      { id: "local-whisper", label: "Local Whisper", mode: "local-command", configured: false, defaultModel: "base" },
      { id: "browser", label: "Browser", mode: "browser", configured: true },
    ],
  };
}

export function normalizeVoiceSettings(input: Partial<NonNullable<BridgeSettings["voice"]>> | undefined): NonNullable<BridgeSettings["voice"]> {
  const defaults = emptyVoiceSettings();
  const stt = input?.stt ?? defaults.stt;
  const provider = normalizeVoiceProviderId(stt.provider, defaults.stt.provider);
  const language = stt.language?.trim() || defaults.stt.language;
  return {
    ...defaults,
    ...input,
    stt: {
      provider,
      language,
      openai: {
        ...defaults.stt.openai,
        ...stt.openai,
        model: stt.openai?.model?.trim() || defaults.stt.openai.model,
        baseUrl: stt.openai?.baseUrl?.trim() || defaults.stt.openai.baseUrl,
        apiKeyEnv: stt.openai?.apiKeyEnv?.trim() || defaults.stt.openai.apiKeyEnv,
      },
      groq: {
        ...defaults.stt.groq,
        ...stt.groq,
        model: stt.groq?.model?.trim() || defaults.stt.groq.model,
        baseUrl: stt.groq?.baseUrl?.trim() || defaults.stt.groq.baseUrl,
        apiKeyEnv: stt.groq?.apiKeyEnv?.trim() || defaults.stt.groq.apiKeyEnv,
      },
      localWhisper: {
        ...defaults.stt.localWhisper,
        ...stt.localWhisper,
        model: stt.localWhisper?.model?.trim() || defaults.stt.localWhisper.model,
        command: stt.localWhisper?.command?.trim() || "",
        language,
      },
      browser: {
        ...defaults.stt.browser,
        ...stt.browser,
        language,
      },
    },
    sttProviders: input?.sttProviders?.length ? input.sttProviders : defaults.sttProviders,
  };
}

export function defaultVoiceProviderOptions(): Array<{ id: string; label: string }> {
  return emptyVoiceSettings().sttProviders?.map((provider) => ({ id: provider.id, label: provider.label })) ?? [];
}

export function effectiveProxyValue(proxy: KernelProxySettings, t: TranslationFn): string {
  if (proxy.enabled) return proxy.proxyUrl || t("settings.proxySourceNone");
  return proxy.environmentProxyUrl || t("settings.proxySourceNone");
}

export function effectiveProxyDescription(proxy: KernelProxySettings, t: TranslationFn): string {
  if (proxy.enabled) return t("settings.effectiveProxyOpenGrove");
  if (proxy.environmentProxyUrl) return t("settings.effectiveProxyEnvironment");
  return t("settings.effectiveProxyNone");
}

export function sanitizeProviderBindings(bindings: Record<string, string>, providers: ProviderProfile[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [kernelId, providerId] of Object.entries(bindings)) {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (provider && providerSupportsKernel(provider, kernelId)) {
      next[kernelId] = providerId;
    }
  }
  return next;
}

export function providerSupportsKernel(provider: ProviderProfile, kernelId: string): boolean {
  return Boolean(providerProtocolForKernel(provider, kernelId));
}

export function providerBindingLabel(provider: ProviderProfile, kernelId: string, t: TranslationFn): string {
  const protocol = providerProtocolForKernel(provider, kernelId);
  const protocolLabel = isAwsBedrockProvider(provider)
    ? "AWS Bedrock"
    : isGoogleVertexProvider(provider)
      ? "Google Vertex"
      : protocol === "native-oauth"
        ? t("settings.accountLogin")
        : protocol === "anthropic-compatible"
          ? "Anthropic"
          : protocol === "gemini-compatible"
            ? "Gemini"
            : "OpenAI";
  return `${provider.name} · ${protocolLabel}`;
}

export function providerMetaLabel(provider: ProviderProfile, t: TranslationFn): string {
  if (isNativeAuthStateProvider(provider)) return t("settings.nativeOnlyProvider");
  if (isNativeAuthProtocol(provider.protocol)) return t("settings.accountLogin");
  if (provider.apiKey) return t("settings.apiKeyConfigured");
  if (provider.apiKeyEnv) return provider.apiKeyEnv;
  if (provider.origin === "discovered" || provider.sourceKernel) return t("settings.nativeProvider");
  return provider.apiKeyEnv || provider.protocol;
}

export function formatModelCount(count: number, t: TranslationFn): string {
  return t("settings.modelsCount", { count });
}

export function buildSourceEnabledState(settings: BridgeSettings): Record<string, Record<string, boolean>> {
  const next: Record<string, Record<string, boolean>> = {};
  for (const kernel of settings.kernels ?? []) {
    for (const source of kernel.sources ?? []) {
      if (!next[kernel.id]) next[kernel.id] = {};
      next[kernel.id]![source.id] = isSourceEnabled(kernel.id, source, settings.kernelKnowledgeSourceEnabled ?? {});
    }
  }
  return next;
}

export function copilotAuthLabel(
  auth: KernelAuthState | undefined,
  checking: boolean,
  t: TranslationFn,
): string {
  if (checking) return t("settings.copilotAuthChecking");
  if (!auth) return t("settings.copilotAuthUnknown");
  if (auth.status === "authenticated") return t("settings.copilotAuthAuthenticated");
  if (auth.status === "missing") return t("settings.copilotAuthMissing");
  if (auth.status === "unconfirmed") return t("settings.copilotAuthUnconfirmed");
  if (auth.status === "error") return auth.message || t("settings.copilotAuthError");
  return t("settings.copilotAuthUnknown");
}

export function copilotAuthStatusClass(
  auth: KernelAuthState | undefined,
  checking: boolean,
): KernelAuthState["status"] {
  if (checking) return "checking";
  return auth?.status ?? "unknown";
}

export function mountedAppId(path: string, title: string, existing: MountedAppSettings[]): string {
  const raw = title || path.split(/[\\/]/).filter(Boolean).pop() || "app";
  const base = slug(raw) || "app";
  const taken = new Set(existing.map((item) => item.id));
  let candidate = base;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

export function formatKernelLabel(value: string | undefined): string {
  return {
    codex: "Codex kernel",
    "claude-code": "Claude Code kernel",
    hermes: "Hermes kernel",
    pi: "Pi kernel",
    openclaw: "OpenClaw kernel",
    "gemini-cli": "Gemini CLI kernel",
    "deepseek-tui": "DeepSeek TUI kernel",
    "qwen-code": "Qwen Code kernel",
    opencode: "OpenCode kernel",
    copilot: "GitHub Copilot CLI kernel",
    "cursor-agent": "Cursor Agent kernel",
    kimi: "Kimi CLI kernel",
    "kiro-cli": "Kiro CLI kernel",
  }[value || ""] ?? "";
}

function normalizeProviderApiKey(value: string): string {
  const trimmed = value.trim();
  const assignment = trimmed.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/);
  return stripShellValue(assignment?.[1] ?? trimmed);
}

function stripShellValue(value: string): string {
  let next = value.trim();
  if (next.endsWith(";")) next = next.slice(0, -1).trim();
  if ((next.startsWith("\"") && next.endsWith("\"")) || (next.startsWith("'") && next.endsWith("'"))) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function providerCredentialKindFromForm(
  id: string,
  nativeAuth: boolean,
  apiKey: string,
  apiKeyEnv: string,
): NonNullable<ProviderProfile["credentialKind"]> {
  if (nativeAuth) return "native-login";
  if (isAwsBedrockProviderId(id)) return "aws";
  if (apiKey) return "api-key";
  if (apiKeyEnv) return "env-key";
  return "none";
}

export function isNativeAuthProtocol(value: string | undefined): boolean {
  return value === "native-oauth";
}

function editableProviderProtocol(provider: ProviderProfile): string {
  if (provider.protocol === "native-oauth") return "native-oauth";
  if (provider.protocol === "anthropic-compatible") return "anthropic-compatible";
  if (provider.protocol === "openai-compatible") return "openai-compatible";
  if (provider.anthropicBaseUrl && !provider.openaiBaseUrl) return "anthropic-compatible";
  return "openai-compatible";
}

export function isProviderEnabled(provider: ProviderProfile, bindings: Record<string, string>): boolean {
  if (typeof provider.enabled === "boolean") {
    return provider.enabled;
  }
  return Boolean(provider.authConfigured || Object.values(bindings).includes(provider.id));
}

function normalizeVoiceProviderId(value: string | undefined, fallback: VoiceSttProviderId): VoiceSttProviderId {
  return value === "openai" || value === "groq" || value === "local-whisper" || value === "browser"
    ? value
    : fallback;
}

function providerProtocolForKernel(provider: ProviderProfile, kernelId: string): "native-oauth" | "openai-compatible" | "anthropic-compatible" | "gemini-compatible" | undefined {
  if (provider.sourceKernel === kernelId && provider.authConfigured) {
    if (provider.protocol === "native-oauth") return "native-oauth";
    if (provider.protocol === "anthropic-compatible") return "anthropic-compatible";
    if (provider.protocol === "gemini-compatible") return "gemini-compatible";
    return "openai-compatible";
  }
  if (kernelId === "claude-code") {
    return provider.anthropicBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key", "aws", "google-adc"])
      ? "anthropic-compatible"
      : undefined;
  }
  if (kernelId === "codex") {
    if (provider.protocol === "native-oauth") {
      return !provider.sourceKernel || provider.sourceKernel === "codex" ? "native-oauth" : undefined;
    }
    return provider.openaiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"]) ? "openai-compatible" : undefined;
  }
  if (kernelId === "pi") {
    if (provider.protocol === "native-oauth") return undefined;
    if (provider.openaiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"])) return "openai-compatible";
    if (provider.anthropicBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"])) return "anthropic-compatible";
    return provider.geminiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"]) ? "gemini-compatible" : undefined;
  }
  if (kernelId === "hermes") {
    if (!providerCredentialIsSupported(provider, ["api-key", "env-key"])) return undefined;
    if (provider.protocol === "anthropic-compatible" && provider.anthropicBaseUrl) return "anthropic-compatible";
    if (provider.openaiBaseUrl) return "openai-compatible";
    return provider.anthropicBaseUrl ? "anthropic-compatible" : undefined;
  }
  if (kernelId === "gemini-cli") {
    return provider.geminiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"]) ? "gemini-compatible" : undefined;
  }
  if (kernelId === "copilot") {
    if (provider.openaiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"])) return "openai-compatible";
    return provider.anthropicBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"]) ? "anthropic-compatible" : undefined;
  }
  if (kernelId === "opencode") {
    if (provider.openaiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"])) return "openai-compatible";
    return isAwsBedrockProvider(provider) && provider.anthropicBaseUrl ? "anthropic-compatible" : undefined;
  }
  return provider.openaiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"]) ? "openai-compatible" : undefined;
}

function providerCredentialIsSupported(provider: ProviderProfile, allowed: string[]): boolean {
  return allowed.includes(providerCredentialKind(provider));
}

function providerCredentialKind(provider: ProviderProfile): string {
  if (isAwsBedrockProvider(provider)) return "aws";
  if (provider.credentialKind) return provider.credentialKind;
  if (provider.protocol === "native-oauth") return "native-login";
  if (provider.apiKey) return "api-key";
  if (provider.apiKeyEnv) return "env-key";
  const text = `${provider.id} ${provider.name}`.toLowerCase();
  if (text.includes("bedrock")) return "aws";
  if (text.includes("vertex")) return "google-adc";
  return provider.authConfigured && provider.sourceKernel ? "kernel-native" : "none";
}

function isAwsBedrockProvider(provider: ProviderProfile): boolean {
  return isAwsBedrockProviderId(provider.id);
}

function isAwsBedrockProviderId(providerId: string | undefined): boolean {
  return providerId === "aws-bedrock" ||
    providerId === "aws-bedrock-api-key" ||
    providerId === "amazon-bedrock";
}

function isGoogleVertexProvider(provider: ProviderProfile): boolean {
  const text = `${provider.id} ${provider.name}`.toLowerCase();
  return text.includes("vertex");
}

export function isNativeAuthStateProvider(provider: ProviderProfile): boolean {
  if (!provider.sourceKernel || !provider.authConfigured || provider.apiKey) return false;
  const credentialKind = providerCredentialKind(provider);
  return credentialKind === "native-login" || credentialKind === "kernel-native" || provider.protocol === "native-oauth";
}

function isSourceEnabled(
  kernelId: string,
  source: NonNullable<KernelOption["sources"]>[number],
  state: Record<string, Record<string, boolean>>,
): boolean {
  const explicit = state[kernelId]?.[source.id];
  return typeof explicit === "boolean" ? explicit : source.enabled ?? source.enabledByDefault ?? true;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
