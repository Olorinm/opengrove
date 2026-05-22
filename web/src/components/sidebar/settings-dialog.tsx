import { useEffect, useMemo, useState } from "react";
import { Activity, Check, ChevronDown, Cpu, Eye, EyeOff, Globe2, Mic, Palette, PlugZap, Plus, Terminal, Trash2 } from "lucide-react";
import { useIconStylePreference, type IconStylePreference } from "../../appearance";
import type { AgentEventRecord, ApprovalRecord, BridgeSettings, ExecutionRecord, MountedAppSettings, InviteLandingSettings, KernelAuthState, KernelOption, KernelPathOverride, KernelPreference, KernelProxySettings, MatrixSettings, ProviderProfile, RunRecord, SkillRecord, DeveloperSession, VoiceSettings, VoiceSttProviderId } from "../../bridge";
import { useI18n, type LanguagePreference, type TranslationFn } from "../../i18n";
import { useThemePreference, type ThemePreference } from "../../theme";
import { AppCreateWizard, type AppBuilderRequest, type AppCreateSourceKind, type AppDraftMode } from "../apps/app-create-wizard";
import { OpsCenterSettingsPanel } from "../system/ops-center-view";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { KernelIcon, ProviderIcon } from "../ui/entity-icons";
import { InlineSelect, type InlineSelectOption } from "./settings-inline-select";
import {
  PROVIDER_PROTOCOL_OPTIONS,
  buildSourceEnabledState,
  copilotAuthLabel,
  copilotAuthStatusClass,
  defaultVoiceProviderOptions,
  effectiveProxyDescription,
  effectiveProxyValue,
  emptyInviteLandingSettings,
  emptyKernelProxySettings,
  emptyMatrixSettings,
  emptyProviderForm,
  emptyVoiceSettings,
  formatKernelLabel,
  formatModelCount,
  isNativeAuthProtocol,
  isNativeAuthStateProvider,
  isProviderEnabled,
  mountedAppId,
  normalizeInviteLandingSettings,
  normalizeKernelProxySettings,
  normalizeMatrixSettings,
  normalizeVoiceSettings,
  primaryBaseUrl,
  providerBindingLabel,
  providerFormFromProfile,
  providerMetaLabel,
  providerProfileFromForm,
  providerSupportsKernel,
  sanitizeProviderBindings,
  sortAvailableKernelsFirst,
  sortEnabledProvidersFirst,
  updateProviderForm,
  type ProviderFormState,
} from "./settings-model";

export type SettingsSectionId = "kernels" | "ops" | "providers" | "apps" | "voice" | "remoteMessaging" | "network" | "appearance";
type SettingsSectionLabelKey =
  | "settings.kernels"
  | "settings.opsCenter"
  | "settings.providers"
  | "settings.mountedApps"
  | "settings.voice"
  | "settings.remoteMessaging"
  | "settings.network"
  | "settings.appearance";

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; labelKey: SettingsSectionLabelKey; icon: typeof Cpu }> = [
  { id: "kernels", labelKey: "settings.kernels", icon: Cpu },
  { id: "ops", labelKey: "settings.opsCenter", icon: Activity },
  { id: "providers", labelKey: "settings.providers", icon: PlugZap },
  { id: "apps", labelKey: "settings.mountedApps", icon: PlugZap },
  { id: "voice", labelKey: "settings.voice", icon: Mic },
  { id: "remoteMessaging", labelKey: "settings.remoteMessaging", icon: Globe2 },
  { id: "network", labelKey: "settings.network", icon: Globe2 },
  { id: "appearance", labelKey: "settings.appearance", icon: Palette },
];

const LANGUAGE_OPTIONS: Array<{
  id: LanguagePreference;
  labelKey: "settings.languageSystem" | "settings.languageChinese" | "settings.languageEnglish";
}> = [
  { id: "system", labelKey: "settings.languageSystem" },
  { id: "zh-CN", labelKey: "settings.languageChinese" },
  { id: "en", labelKey: "settings.languageEnglish" },
];

const THEME_OPTIONS: Array<{
  id: ThemePreference;
  labelKey: "settings.themeSystem" | "settings.themeLight" | "settings.themeDark";
}> = [
  { id: "system", labelKey: "settings.themeSystem" },
  { id: "light", labelKey: "settings.themeLight" },
  { id: "dark", labelKey: "settings.themeDark" },
];

const ICON_STYLE_OPTIONS: Array<{
  id: IconStylePreference;
  labelKey: "settings.iconStyleProfessional" | "settings.iconStylePixel";
}> = [
  { id: "professional", labelKey: "settings.iconStyleProfessional" },
  { id: "pixel", labelKey: "settings.iconStylePixel" },
];

type OpsSettingsPayload = {
  runs: RunRecord[];
  executions: ExecutionRecord[];
  approvals: ApprovalRecord[];
  events: AgentEventRecord[];
  skills: SkillRecord[];
  tools: Record<string, unknown>[];
  developerSessions: DeveloperSession[];
  selectedRunId: string;
  contextRecords?: Record<string, unknown>[];
  onSelectRun(runId: string): void;
  onUpdateDiagnostics?(patch: {
    providerHttpCaptureEnabled?: boolean;
    codexRawEventCaptureEnabled?: boolean;
  }): void;
};

export function SettingsDialog(props: {
  settings?: BridgeSettings;
  loading: boolean;
  saving: boolean;
  installingKernelId?: string;
  copilotAuth?: KernelAuthState;
  copilotAuthLoading?: boolean;
  copilotLoginPending?: boolean;
  error: string;
  embedded?: boolean;
  initialSection?: SettingsSectionId;
  ops?: OpsSettingsPayload;
  onClose(): void;
  onInstallKernel?(kernelId: string, actionId: string): void;
  onRequestAppBuilder?(request: AppBuilderRequest): void;
  onStartCopilotLogin?(): void;
  onSave(payload: {
    kernel: KernelPreference;
    providerHttpCaptureEnabled: boolean;
    codexRawEventCaptureEnabled: boolean;
    mountedApps: MountedAppSettings[];
    kernelProxy: KernelProxySettings;
    inviteLanding: InviteLandingSettings;
    remote: BridgeSettings["remote"];
    voice: NonNullable<BridgeSettings["voice"]>;
    kernelPathOverrides: Record<string, KernelPathOverride>;
    kernelKnowledgeSourceEnabled: Record<string, Record<string, boolean>>;
    kernelProviderBindings: Record<string, string>;
    customProviders: ProviderProfile[];
  }): void;
}) {
  const { t, language, preference: languagePreference, setLanguagePreference } = useI18n();
  const { preference: themePreference, setThemePreference } = useThemePreference();
  const { preference: iconStylePreference, setIconStylePreference } = useIconStylePreference();
  const themeSelectOptions = THEME_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) }));
  const iconStyleSelectOptions = ICON_STYLE_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) }));
  const languageSelectOptions = LANGUAGE_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) }));
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(props.initialSection ?? "kernels");
  const [kernel, setKernel] = useState<KernelPreference>("auto");
  const [providerHttpCaptureEnabled, setProviderHttpCaptureEnabled] = useState(false);
  const [codexRawEventCaptureEnabled, setCodexRawEventCaptureEnabled] = useState(false);
  const [mountedApps, setMountedApps] = useState<MountedAppSettings[]>([]);
  const [appDraftMode, setAppDraftMode] = useState<AppDraftMode>("choice");
  const [appDraftSourceKind, setAppDraftSourceKind] = useState<AppCreateSourceKind>("local");
  const [appDraftPath, setAppDraftPath] = useState("");
  const [appDraftTitle, setAppDraftTitle] = useState("");
  const [appDraftDescription, setAppDraftDescription] = useState("");
  const [kernelProxy, setKernelProxy] = useState<KernelProxySettings>(emptyKernelProxySettings());
  const [inviteLandingSettings, setInviteLandingSettings] = useState<InviteLandingSettings>(emptyInviteLandingSettings());
  const [matrixSettings, setMatrixSettings] = useState<MatrixSettings>(emptyMatrixSettings());
  const [voiceSettings, setVoiceSettings] = useState<NonNullable<BridgeSettings["voice"]>>(emptyVoiceSettings());
  const [kernelPathOverrides, setKernelPathOverrides] = useState<Record<string, KernelPathOverride>>({});
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, Record<string, boolean>>>({});
  const [providerBindings, setProviderBindings] = useState<Record<string, string>>({});
  const [customProviders, setCustomProviders] = useState<ProviderProfile[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [providerDetailOpen, setProviderDetailOpen] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm());
  const [providerFormError, setProviderFormError] = useState("");
  const [providerDeleteTargetId, setProviderDeleteTargetId] = useState("");
  const [providerSaveState, setProviderSaveState] = useState<"idle" | "saved">("idle");
  const [providerApiKeyVisible, setProviderApiKeyVisible] = useState(false);
  const [expandedKernelId, setExpandedKernelId] = useState("");

  useEffect(() => {
    if (props.initialSection) {
      setActiveSection(props.initialSection);
    }
  }, [props.initialSection]);

  useEffect(() => {
    if (!props.settings) {
      return;
    }
    setKernel(props.settings.kernel);
    setProviderHttpCaptureEnabled(Boolean(props.settings.providerHttpCapture?.enabled));
    setCodexRawEventCaptureEnabled(Boolean(props.settings.codexRawEventCaptureEnabled));
    setMountedApps(props.settings.mountedApps ?? []);
    setKernelProxy(normalizeKernelProxySettings(props.settings.kernelProxy));
    setInviteLandingSettings(normalizeInviteLandingSettings(props.settings.inviteLanding));
    setMatrixSettings(normalizeMatrixSettings(props.settings.remote?.matrix));
    setVoiceSettings(normalizeVoiceSettings(props.settings.voice));
    setKernelPathOverrides(props.settings.kernelPathOverrides ?? {});
    setSourceEnabled(buildSourceEnabledState(props.settings));
    setProviderBindings(sanitizeProviderBindings(props.settings.kernelProviderBindings ?? {}, props.settings.providers ?? []));
    setCustomProviders(props.settings.customProviders ?? []);
    setSelectedProviderId((current) => {
      const providers = props.settings?.providers ?? [];
      if (current && providers.some((provider) => provider.id === current)) return current;
      return "";
    });
  }, [props.settings]);

  useEffect(() => {
    if (providerSaveState !== "saved") return undefined;
    const timeout = window.setTimeout(() => setProviderSaveState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [providerSaveState]);

  useEffect(() => {
    setProviderApiKeyVisible(false);
  }, [selectedProviderId]);

  const kernels = useMemo(() => {
    const options = props.settings?.kernels?.length
      ? props.settings.kernels
      : [
          { id: "auto" as KernelPreference, label: t("settings.autoMode"), available: true },
          { id: "codex" as KernelPreference, label: "Codex", available: true },
          { id: "claude-code" as KernelPreference, label: "Claude Code", available: true },
          { id: "hermes" as KernelPreference, label: "Hermes", available: true },
          { id: "pi" as KernelPreference, label: "Pi", available: true },
        ];
    return sortAvailableKernelsFirst(options);
  }, [props.settings, t]);

  const providers = props.settings?.providers ?? [];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const providerDeleteTarget = providers.find((provider) => provider.id === providerDeleteTargetId);
  const detailForm = providerForm;
  const providerDetailTitle = selectedProvider?.name || t("settings.newProvider");
  const providerDetailEditable = true;
  const editableProviderModels = detailForm.models.length
    ? detailForm.models.split(",").map((item) => item.trim())
    : [];
  const providerModels = editableProviderModels
    .map((item) => item.trim())
    .filter(Boolean);
  const providerSections = useMemo(() => {
    const sorted = sortEnabledProvidersFirst(providers, providerBindings);
    return {
      reusable: sorted.filter((provider) => !isNativeAuthStateProvider(provider)),
      nativeAuth: sorted.filter(isNativeAuthStateProvider),
    };
  }, [providerBindings, providers]);
  const sortedProviders = providerSections.reusable;
  const voiceProviderOptions = useMemo<InlineSelectOption[]>(
    () => voiceSettings.sttProviders?.length
      ? voiceSettings.sttProviders.map((provider) => ({
          id: provider.id,
          label: provider.label,
        }))
      : defaultVoiceProviderOptions(),
    [voiceSettings.sttProviders],
  );
  const selectedVoiceProvider = voiceSettings.sttProviders?.find((provider) => provider.id === voiceSettings.stt.provider);
  const matrixConfigured = Boolean(
    matrixSettings.enabled
    && matrixSettings.homeserverUrl.trim()
    && matrixSettings.userId.trim()
    && matrixSettings.accessToken?.trim(),
  );
  const providerHttpCapture = props.settings?.providerHttpCapture;

  const saveSettings = (next: {
    kernel?: KernelPreference;
    providerHttpCaptureEnabled?: boolean;
    codexRawEventCaptureEnabled?: boolean;
    mountedApps?: MountedAppSettings[];
    kernelProxy?: KernelProxySettings;
    inviteLanding?: InviteLandingSettings;
    remote?: BridgeSettings["remote"];
    voice?: NonNullable<BridgeSettings["voice"]>;
    kernelPathOverrides?: Record<string, KernelPathOverride>;
    kernelKnowledgeSourceEnabled?: Record<string, Record<string, boolean>>;
    kernelProviderBindings?: Record<string, string>;
    customProviders?: ProviderProfile[];
  }) => {
    props.onSave({
      kernel: next.kernel ?? kernel,
      providerHttpCaptureEnabled: next.providerHttpCaptureEnabled ?? providerHttpCaptureEnabled,
      codexRawEventCaptureEnabled: next.codexRawEventCaptureEnabled ?? codexRawEventCaptureEnabled,
      mountedApps: next.mountedApps ?? mountedApps,
      kernelProxy: next.kernelProxy ?? kernelProxy,
      inviteLanding: next.inviteLanding ?? inviteLandingSettings,
      remote: next.remote ?? { matrix: matrixSettings },
      voice: next.voice ?? voiceSettings,
      kernelPathOverrides: next.kernelPathOverrides ?? kernelPathOverrides,
      kernelKnowledgeSourceEnabled: next.kernelKnowledgeSourceEnabled ?? sourceEnabled,
      kernelProviderBindings: next.kernelProviderBindings ?? providerBindings,
      customProviders: next.customProviders ?? customProviders,
    });
  };

  const selectKernel = (nextKernel: KernelPreference) => {
    setKernel(nextKernel);
    saveSettings({ kernel: nextKernel });
  };

  const setKernelProxyDraft = (patch: Partial<KernelProxySettings>) => {
    setKernelProxy((current) => ({ ...current, ...patch }));
  };

  const saveKernelProxy = (patch: Partial<KernelProxySettings> = {}) => {
    const next = normalizeKernelProxySettings({ ...kernelProxy, ...patch });
    setKernelProxy(next);
    saveSettings({ kernelProxy: next });
  };

  const saveProviderHttpCapture = (enabled: boolean) => {
    const nextRawCaptureEnabled = enabled ? codexRawEventCaptureEnabled : false;
    setProviderHttpCaptureEnabled(enabled);
    setCodexRawEventCaptureEnabled(nextRawCaptureEnabled);
    saveSettings({
      providerHttpCaptureEnabled: enabled,
      codexRawEventCaptureEnabled: nextRawCaptureEnabled,
    });
  };

  const saveCodexRawEventCapture = (enabled: boolean) => {
    const nextRawCaptureEnabled = providerHttpCaptureEnabled && enabled;
    setCodexRawEventCaptureEnabled(nextRawCaptureEnabled);
    saveSettings({
      providerHttpCaptureEnabled,
      codexRawEventCaptureEnabled: nextRawCaptureEnabled,
    });
  };

  const saveMountedApps = (next: MountedAppSettings[]) => {
    setMountedApps(next);
    saveSettings({ mountedApps: next });
  };

  const addMountedApp = () => {
    const path = appDraftPath.trim();
    if (!path) return;
    const title = appDraftTitle.trim();
    const nextApp: MountedAppSettings = {
      id: mountedAppId(path, title, mountedApps),
      path,
      enabled: true,
      ...(title ? { title } : {}),
    };
    saveMountedApps([...mountedApps, nextApp]);
    resetAppDraft();
  };

  const resetAppDraft = () => {
    setAppDraftMode("choice");
    setAppDraftSourceKind("local");
    setAppDraftPath("");
    setAppDraftTitle("");
    setAppDraftDescription("");
  };

  const requestAppBuilder = (request: AppBuilderRequest) => {
    props.onRequestAppBuilder?.(request);
    resetAppDraft();
  };

  const updateMountedApp = (appId: string, patch: Partial<MountedAppSettings>) => {
    const next = mountedApps.map((item) =>
      item.id === appId
        ? {
            ...item,
            ...patch,
            path: patch.path !== undefined ? patch.path : item.path,
            title: patch.title !== undefined ? patch.title : item.title,
          }
        : item,
    );
    saveMountedApps(next);
  };

  const removeMountedApp = (appId: string) => {
    saveMountedApps(mountedApps.filter((item) => item.id !== appId));
  };

  const setInviteLandingDraft = (patch: Partial<InviteLandingSettings>) => {
    setInviteLandingSettings((current) => ({ ...current, ...patch }));
  };

  const saveInviteLanding = (patch: Partial<InviteLandingSettings> = {}) => {
    const next = normalizeInviteLandingSettings({
      ...inviteLandingSettings,
      ...patch,
    });
    setInviteLandingSettings(next);
    saveSettings({ inviteLanding: next });
  };

  const setMatrixDraft = (patch: Partial<MatrixSettings>) => {
    setMatrixSettings((current) => ({ ...current, ...patch }));
  };

  const saveMatrix = (patch: Partial<MatrixSettings> = {}) => {
    const next = normalizeMatrixSettings({ ...matrixSettings, ...patch });
    setMatrixSettings(next);
    saveSettings({ remote: { matrix: next } });
  };

  const setVoiceDraft = (patch: Partial<VoiceSettings["stt"]>) => {
    setVoiceSettings((current) => normalizeVoiceSettings({
      ...current,
      stt: {
        ...current.stt,
        ...patch,
      },
    }));
  };

  const saveVoice = (patch: Partial<VoiceSettings["stt"]> = {}) => {
    const next = normalizeVoiceSettings({
      ...voiceSettings,
      stt: {
        ...voiceSettings.stt,
        ...patch,
      },
    });
    setVoiceSettings(next);
    saveSettings({ voice: next });
  };

  const setKernelPathDraft = (kernelId: string, key: keyof KernelPathOverride, value: string) => {
    setKernelPathOverrides((current) => ({
      ...current,
      [kernelId]: {
        ...(current[kernelId] ?? {}),
        [key]: value,
      },
    }));
  };

  const saveKernelPathOverride = (kernelId: string, patch: Partial<KernelPathOverride> = {}) => {
    const current = { ...(kernelPathOverrides[kernelId] ?? {}), ...patch };
    const normalized = {
      binaryPath: current.binaryPath?.trim(),
      configHome: current.configHome?.trim(),
    };
    const next = { ...kernelPathOverrides };
    const compact = Object.fromEntries(
      Object.entries(normalized).filter(([, value]) => Boolean(value)),
    ) as KernelPathOverride;
    if (Object.keys(compact).length) {
      next[kernelId] = compact;
    } else {
      delete next[kernelId];
    }
    setKernelPathOverrides(next);
    saveSettings({ kernelPathOverrides: next });
  };

  const bindProvider = (kernelId: string, providerId: string) => {
    const provider = providers.find((item) => item.id === providerId);
    if (providerId && (!provider || !providerSupportsKernel(provider, kernelId))) {
      return;
    }
    const next = { ...providerBindings };
    if (providerId) {
      next[kernelId] = providerId;
    } else {
      delete next[kernelId];
    }
    setProviderBindings(next);
    saveSettings({ kernelProviderBindings: next });
  };

  const saveProviderProfile = () => {
    const profile = providerProfileFromForm(providerForm);
    if (!profile) {
      setProviderFormError(t("settings.providerFormRequired"));
      return;
    }
    const existing = providers.find((item) => item.id === profile.id);
    const nextProfile = {
      ...profile,
      enabled: existing?.enabled ?? profile.enabled,
    };
    setProviderFormError("");
    const next = [
      ...customProviders.filter((item) => item.id !== nextProfile.id),
      nextProfile,
    ];
    setCustomProviders(next);
    setSelectedProviderId(nextProfile.id);
    setProviderDetailOpen(true);
    setProviderForm(providerFormFromProfile(nextProfile));
    setProviderSaveState("saved");
    saveSettings({ customProviders: next });
  };

  const setProviderEnabled = (providerId: string, enabled: boolean) => {
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) return;
    const nextProvider: ProviderProfile = {
      ...provider,
      custom: true,
      deleted: false,
      enabled,
    };
    const next = [
      ...customProviders.filter((item) => item.id !== providerId),
      nextProvider,
    ];
    setCustomProviders(next);
    saveSettings({ customProviders: next });
  };

  const deleteProviderProfile = (providerId: string) => {
    const provider = providers.find((item) => item.id === providerId);
    const nextProviders = customProviders.filter((item) => item.id !== providerId);
    if (provider && !provider.custom) {
      nextProviders.push({
        ...provider,
        custom: true,
        deleted: true,
      });
    }
    const nextBindings = Object.fromEntries(
      Object.entries(providerBindings).filter(([, value]) => value !== providerId),
    );
    setCustomProviders(nextProviders);
    setProviderBindings(nextBindings);
    setSelectedProviderId((current) => current === providerId ? "" : current);
    setProviderDetailOpen((open) => selectedProviderId === providerId ? false : open);
    saveSettings({ customProviders: nextProviders, kernelProviderBindings: nextBindings });
  };

  const confirmDeleteProvider = () => {
    if (!providerDeleteTargetId) return;
    deleteProviderProfile(providerDeleteTargetId);
    setProviderDeleteTargetId("");
  };

  const selectProvider = (provider: ProviderProfile) => {
    if (providerDetailOpen && selectedProviderId === provider.id) {
      closeProviderDetail();
      return;
    }
    setSelectedProviderId(provider.id);
    setProviderDetailOpen(true);
    setProviderForm(providerFormFromProfile(provider));
    setProviderFormError("");
    setProviderSaveState("idle");
  };

  const startAddProvider = () => {
    setSelectedProviderId("");
    setProviderDetailOpen(true);
    setProviderForm(emptyProviderForm());
    setProviderFormError("");
    setProviderSaveState("idle");
  };

  const closeProviderDetail = () => {
    setProviderDetailOpen(false);
    setSelectedProviderId("");
    setProviderForm(emptyProviderForm());
    setProviderFormError("");
    setProviderSaveState("idle");
  };

  const updateProviderDraft = (next: ProviderFormState) => {
    setProviderSaveState("idle");
    setProviderForm(next);
  };

  const updateProviderField = <K extends keyof ProviderFormState>(key: K, value: ProviderFormState[K]) => {
    updateProviderDraft(updateProviderForm(providerForm, key, value));
  };

  const updatePrimaryBaseUrl = (value: string) => {
    const protocol = detailForm.protocol;
    const next = updateProviderForm(providerForm, protocol === "anthropic-compatible" ? "anthropicBaseUrl" : protocol === "gemini-compatible" ? "geminiBaseUrl" : "openaiBaseUrl", value);
    updateProviderDraft(next);
  };

  const setProviderModels = (models: string[]) => {
    const seen = new Set<string>();
    const normalized = models
      .map((model) => model.trim())
      .filter((model) => {
        if (!model || seen.has(model)) return false;
        seen.add(model);
        return true;
      });
    updateProviderDraft(updateProviderForm(providerForm, "models", normalized.join(", ")));
  };

  const addProviderModel = () => {
    const base = "new-model";
    let candidate = base;
    let index = 2;
    while (providerModels.includes(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    setProviderModels([...providerModels, candidate]);
  };

  const updateProviderModel = (modelIndex: number, value: string) => {
    const next = editableProviderModels.map((model, index) => index === modelIndex ? value.replace(/,/g, "") : model);
    const serialized = next.join(", ");
    updateProviderDraft(updateProviderForm(providerForm, "models", serialized || (next.length ? " " : "")));
  };

  const renderProviderSaveButton = () => {
    const saved = providerSaveState === "saved" && !props.saving;
    return (
      <button className={saved ? "primary saved" : "primary"} type="button" disabled={props.saving} onClick={saveProviderProfile}>
        {saved ? <Check size={15} /> : <Plus size={15} />}
        {props.saving ? t("settings.providerSaving") : saved ? t("settings.providerSaved") : t("settings.saveProvider")}
      </button>
    );
  };

  const renderProviderApiKeyField = (readOnly?: boolean) => {
    const visibilityLabel = providerApiKeyVisible ? t("settings.hideApiKey") : t("settings.showApiKey");
    return (
      <>
        <span className="settings-field-label-row">
          <span>{t("settings.apiKey")}</span>
          <button
            aria-label={visibilityLabel}
            className="settings-secret-visibility-button"
            title={visibilityLabel}
            type="button"
            onClick={() => setProviderApiKeyVisible((visible) => !visible)}
          >
            {providerApiKeyVisible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </span>
        <input
          autoComplete="off"
          type={providerApiKeyVisible ? "text" : "password"}
          value={detailForm.apiKey}
          readOnly={readOnly}
          onChange={(event) => updateProviderField("apiKey", event.target.value)}
          onBlur={saveProviderProfile}
          placeholder={t("settings.apiKeyPlaceholder")}
        />
      </>
    );
  };

  const removeProviderModelAt = (modelIndex: number) => {
    setProviderModels(editableProviderModels.filter((_, index) => index !== modelIndex));
  };

  const renderNativeAuthProviderItem = (provider: ProviderProfile) => {
    const sourceLabel = [provider.sourceKernel, provider.source].filter(Boolean).join(" · ");
    return (
      <div key={provider.id} className="settings-provider-item native-auth-state">
        <div className="settings-provider-row native-auth-row">
          <span className="settings-provider-summary as-static">
            <ProviderIcon provider={provider} className="settings-provider-logo" size={16} />
            <span className="settings-provider-main">
              <strong>{provider.name}</strong>
              <small>{formatModelCount(provider.models?.length ?? 0, t)} · {providerMetaLabel(provider, t)}</small>
              {sourceLabel ? <small className="settings-provider-source-line">{sourceLabel}</small> : null}
            </span>
          </span>
          <span className="settings-provider-row-actions">
            <span className={provider.authConfigured ? "settings-provider-native-badge configured" : "settings-provider-native-badge"}>
              {provider.authConfigured ? t("settings.configured") : t("settings.nativeAuthState")}
            </span>
          </span>
        </div>
      </div>
    );
  };

  const renderProviderItem = (provider: ProviderProfile) => {
    if (isNativeAuthStateProvider(provider)) return renderNativeAuthProviderItem(provider);
    const providerEnabled = isProviderEnabled(provider, providerBindings);
    return (
      <div
        key={provider.id}
        className={[
          "settings-provider-item",
          selectedProviderId === provider.id ? "active" : "",
          providerEnabled ? "enabled" : "disabled",
        ].filter(Boolean).join(" ")}
      >
        <div className="settings-provider-row">
          <button className="settings-provider-summary" type="button" onClick={() => selectProvider(provider)}>
            <ProviderIcon provider={provider} className="settings-provider-logo" size={16} />
            <span className="settings-provider-main">
              <strong>{provider.name}</strong>
              <small>{formatModelCount(provider.models?.length ?? 0, t)} · {providerMetaLabel(provider, t)}</small>
            </span>
          </button>
          <span className="settings-provider-row-actions">
            <button
              className={providerEnabled ? "settings-provider-enable-button enabled" : "settings-provider-enable-button"}
              type="button"
              role="switch"
              aria-checked={providerEnabled}
              aria-label={`${provider.name} ${providerEnabled ? t("settings.providerEnabled") : t("settings.providerDisabled")}`}
              disabled={props.loading || props.saving}
              onClick={() => setProviderEnabled(provider.id, !providerEnabled)}
            >
              <span aria-hidden="true" />
            </button>
            <button className="settings-provider-icon-button" type="button" onClick={() => selectProvider(provider)} aria-label={selectedProviderId === provider.id ? t("common.cancel") : t("settings.baseConfig")}>
              <ChevronDown size={16} />
            </button>
          </span>
        </div>
        {providerDetailOpen && selectedProviderId === provider.id ? (
          <section className="settings-provider-detail inline">
            <div className="settings-detail-section">
              <div className="settings-detail-section-heading">
                <h3>{t("settings.baseConfig")}</h3>
                <button
                  className="settings-provider-heading-delete"
                  type="button"
                  onClick={() => setProviderDeleteTargetId(provider.id)}
                  aria-label={t("settings.removeProvider")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="settings-form-grid compact">
                <label>
                  <span>{t("settings.providerName")}</span>
                  <input
                    value={detailForm.name}
                    readOnly={!providerDetailEditable}
                    onChange={(event) => updateProviderField("name", event.target.value)}
                    placeholder="Volc Coding Plan"
                  />
                </label>
                <label>
                  <span>{t("settings.providerId")}</span>
                  <input
                    value={detailForm.id}
                    readOnly={!providerDetailEditable}
                    onChange={(event) => updateProviderField("id", event.target.value)}
                    placeholder="volc-coding-plan"
                  />
                </label>
                {!isNativeAuthProtocol(detailForm.protocol) ? (
                  <>
                    <div className="settings-form-wide">
                      <span>{t("settings.protocol")}</span>
                      <div className="settings-segmented">
                        {PROVIDER_PROTOCOL_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            className={detailForm.protocol === option.id ? "active" : ""}
                            type="button"
                            disabled={!providerDetailEditable}
                            onClick={() => updateProviderField("protocol", option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label>
                      <span>{t("settings.apiBaseUrl")}</span>
                      <input
                        value={primaryBaseUrl(detailForm)}
                        readOnly={!providerDetailEditable}
                        onChange={(event) => updatePrimaryBaseUrl(event.target.value)}
                        placeholder="https://example.com/v1"
                      />
                    </label>
                    <label>
                      {renderProviderApiKeyField(!providerDetailEditable)}
                    </label>
                    <label>
                      <span>{t("settings.apiKeyEnv")}</span>
                      <input
                        value={detailForm.apiKeyEnv}
                        readOnly={!providerDetailEditable}
                        onChange={(event) => updateProviderField("apiKeyEnv", event.target.value)}
                        onBlur={saveProviderProfile}
                        placeholder="OPENGROVE_VOLC_CODING_API_KEY"
                      />
                    </label>
                  </>
                ) : null}
                <label className="settings-form-wide">
                  <span>{t("settings.description")}</span>
                  <input
                    value={detailForm.description}
                    onChange={(event) => updateProviderField("description", event.target.value)}
                    placeholder={t("settings.providerDescriptionPlaceholder")}
                  />
                </label>
              </div>
            </div>

            <div className="settings-detail-section">
              <div className="settings-detail-section-heading">
                <h3>{t("settings.availableModels")}</h3>
              </div>
              <div className="settings-model-row">
                {editableProviderModels.length ? (
                  <span className="settings-provider-models editable">
                    {editableProviderModels.map((model, index) => (
                      <span className="settings-model-chip" key={`model-${index}`}>
                        <input
                          className="settings-model-chip-input"
                          value={model}
                          size={Math.max(model.length, 6)}
                          onBlur={() => setProviderModels(editableProviderModels)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => updateProviderModel(index, event.target.value)}
                          aria-label={t("settings.models")}
                        />
                        <button type="button" onClick={() => removeProviderModelAt(index)} aria-label={t("settings.removeModel")}>
                          ×
                        </button>
                      </span>
                    ))}
                  </span>
                ) : (
                  <p className="settings-help">{t("settings.noProviderModels")}</p>
                )}
                <button className="settings-model-add-button" type="button" onClick={addProviderModel} aria-label={t("settings.addModel")}>
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {providerFormError ? <p className="settings-warning">{providerFormError}</p> : null}
            <div className="settings-form-actions settings-provider-detail-actions">
              <span />
              <span>
                <button type="button" onClick={closeProviderDetail}>{t("common.cancel")}</button>
                {providerDetailEditable ? renderProviderSaveButton() : null}
              </span>
            </div>
          </section>
        ) : null}
      </div>
    );
  };

  const toggleKernelExpanded = (kernelId: string) => {
    setExpandedKernelId((current) => current === kernelId ? "" : kernelId);
  };

  const renderKernelChoice = (option: KernelOption) => {
    const isActive = kernel === option.id;
    const canExpand = option.id !== "auto";
    const expanded = canExpand && expandedKernelId === option.id;
    const installAction = (option.installActions ?? []).find((action) => action.command?.length);
    const canInstall = !option.available && installAction && props.onInstallKernel;
    const installing = props.installingKernelId === option.id;
    const installInFlight = Boolean(props.installingKernelId);
    const isCopilot = option.id === "copilot";
    const copilotAuth = isCopilot ? props.copilotAuth : undefined;
    const copilotChecking = Boolean(
      props.copilotLoginPending ||
      copilotAuth?.status === "checking" ||
      (!copilotAuth && props.copilotAuthLoading)
    );
    const showCopilotLogin =
      isCopilot &&
      Boolean(props.onStartCopilotLogin) &&
      Boolean(copilotAuth?.loginAvailable) &&
      copilotAuth?.status !== "authenticated";
    const description = option.id === "auto" && option.resolved
      ? t("settings.resolvedAs", { kernel: formatKernelLabel(option.resolved) })
      : option.available
        ? [option.description || t("common.available"), option.providerLabel].filter(Boolean).join(" · ")
        : option.reason || t("common.unavailable");
    const className = [
      "settings-choice-card",
      isActive ? "active" : "",
      option.available ? "" : "unavailable",
      expanded ? "expanded" : "",
    ].filter(Boolean).join(" ");
    const nativeProvider = providers.find((provider) => provider.sourceKernel === option.id && provider.authConfigured);
    const providerOptions: InlineSelectOption[] = [
      ...(nativeProvider ? [{
        id: "",
        label: nativeProvider.name
          ? `${t("settings.nativeProvider")} · ${nativeProvider.name}`
          : t("settings.nativeProvider"),
        icon: <ProviderIcon provider={nativeProvider} providerId={nativeProvider.id || "native"} providerName={nativeProvider.name || option.label} size={13} />,
      }] : []),
      ...providers
        .filter((provider) =>
          isProviderEnabled(provider, providerBindings) &&
          providerSupportsKernel(provider, option.id) &&
          !(provider.sourceKernel === option.id && provider.authConfigured)
        )
        .map((provider) => ({
          id: provider.id,
          label: providerBindingLabel(provider, option.id, t),
          icon: <ProviderIcon provider={provider} size={13} />,
        })),
    ];
    const mainContent = (
      <span className="settings-choice-card-main-content">
        <KernelIcon kernelId={option.id} className="settings-choice-card-icon" size={17} />
        <span className="settings-choice-card-copy">
          <span className="settings-choice-card-head">
            <strong>{option.label}</strong>
          </span>
          <span className="settings-choice-card-description">
            {description}
            {isCopilot ? (
              <span
                className="settings-kernel-auth-status"
                data-status={copilotAuthStatusClass(copilotAuth, copilotChecking)}
              >
                <span className="settings-kernel-auth-separator" aria-hidden="true"> · </span>
                <span className="settings-kernel-auth-dot" aria-hidden="true" />
                {copilotAuthLabel(copilotAuth, copilotChecking, t)}
              </span>
            ) : null}
          </span>
        </span>
        <span className="settings-choice-card-action">
          {showCopilotLogin ? (
            <button
              className="settings-kernel-install-button with-icon"
              type="button"
              disabled={props.saving || props.loading || copilotChecking}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onStartCopilotLogin?.();
              }}
            >
              <Terminal size={13} />
              {copilotChecking
                ? t("settings.copilotAuthWaiting")
                : copilotAuth?.status === "unconfirmed"
                  ? t("settings.copilotLoginAgain")
                  : t("settings.copilotLoginTerminal")}
            </button>
          ) : null}
          {canInstall ? (
            <button
              className="settings-kernel-install-button"
              type="button"
              disabled={installInFlight || props.saving || props.loading}
              onClick={(event) => {
                event.stopPropagation();
                props.onInstallKernel?.(option.id, installAction.id);
              }}
            >
              {installing ? t("common.installing") : t("common.install")}
            </button>
          ) : null}
          {canExpand ? (
            <button
              className={expanded ? "settings-kernel-expand-button expanded" : "settings-kernel-expand-button"}
              type="button"
              aria-label={expanded ? t("settings.collapseKernel") : t("settings.expandKernel")}
              aria-expanded={expanded}
              disabled={props.saving || props.loading}
              onClick={(event) => {
                event.stopPropagation();
                toggleKernelExpanded(option.id);
              }}
            >
              <ChevronDown size={15} />
            </button>
          ) : null}
        </span>
      </span>
    );
    const details = expanded ? (
      <div className="settings-kernel-expanded-panel">
        {option.available ? (
          <label className="settings-kernel-detail-row">
            <span>{t("settings.providers")}</span>
            <InlineSelect
              value={providerBindings[option.id] ?? ""}
              disabled={props.loading || props.saving}
              options={providerOptions}
              onChange={(value) => bindProvider(option.id, value)}
            />
          </label>
        ) : null}
        <label className="settings-kernel-detail-row">
          <span>{t("settings.rootPath")}</span>
          <input
            value={kernelPathOverrides[option.id]?.configHome ?? option.configHome ?? ""}
            disabled={props.loading || props.saving}
            placeholder={option.configHome || "~/.config"}
            onBlur={(event) => saveKernelPathOverride(option.id, { configHome: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            onChange={(event) => setKernelPathDraft(option.id, "configHome", event.target.value)}
          />
        </label>
      </div>
    ) : null;

    if (!option.available) {
      return (
        <div key={option.id} className={className} aria-disabled="true">
          <div className="settings-choice-card-main as-static">
            {mainContent}
          </div>
          {details}
        </div>
      );
    }

    return (
      <div key={option.id} className={className}>
        <button
          className="settings-choice-card-main"
          type="button"
          disabled={props.saving || props.loading}
          onClick={() => selectKernel(option.id)}
        >
          {mainContent}
        </button>
        {details}
      </div>
    );
  };

  return (
    <div
      className={props.embedded ? "settings-screen embedded" : "settings-screen"}
      role={props.embedded ? undefined : "dialog"}
      aria-modal={props.embedded ? undefined : "true"}
      aria-label={t("app.settings")}
    >
      <aside className="settings-screen-sidebar">
        {props.embedded ? null : (
          <button className="settings-back-button" type="button" onClick={props.onClose}>
            <span aria-hidden="true">←</span>
            <span>{t("common.backToApp")}</span>
          </button>
        )}
        <nav className="settings-nav" aria-label={t("settings.nav")}>
          {SETTINGS_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeSection === item.id ? "settings-nav-item active" : "settings-nav-item"}
                type="button"
                onClick={() => setActiveSection(item.id)}
              >
                <Icon size={18} />
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="settings-screen-main">
        <div className={activeSection === "ops" ? "settings-screen-content ops-settings-screen-content" : "settings-screen-content"}>
          <header className="settings-screen-header">
            <span className="settings-screen-kicker">{t("settings.kicker")}</span>
            <h1>{sectionTitle(activeSection, t)}</h1>
            <p>{sectionDescription(activeSection, t)}</p>
          </header>

          {activeSection === "kernels" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.workMode")}</h2>
                  <span className="settings-status-pill with-icon">
                    <KernelIcon kernelId={props.settings?.activeKernel} size={12} />
                    {t("common.current")} {formatKernelLabel(props.settings?.activeKernel) || t("common.unknown")}
                  </span>
                </div>
                <div className="settings-choice-grid settings-kernel-choice-grid">
                  {kernels.map(renderKernelChoice)}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "ops" && props.ops ? (
            <OpsCenterSettingsPanel
              {...props.ops}
              settings={props.settings}
              saving={props.saving}
              language={language}
            />
          ) : null}

          {activeSection === "providers" ? (
            <div className="settings-providers-workspace">
              <section className="settings-provider-block">
                <div className="settings-provider-block-heading">
                  <h2>{t("settings.reusableProviders")}</h2>
                  <p>{t("settings.reusableProvidersCopy")}</p>
                </div>
                <div className="settings-provider-list">
                  {providerDetailOpen && !selectedProvider ? (
                    <div className="settings-provider-item active new">
                      <div className="settings-provider-row">
                        <span className="settings-provider-summary as-static">
                          <span className="settings-provider-avatar" aria-hidden="true">+</span>
                          <span className="settings-provider-main">
                            <strong>{providerDetailTitle}</strong>
                            <small>{t("settings.addProviderCopy")}</small>
                          </span>
                        </span>
                        <button className="settings-provider-icon-button" type="button" onClick={closeProviderDetail} aria-label={t("common.cancel")}>
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    <section className="settings-provider-detail inline">
                      <div className="settings-detail-section">
                        <div className="settings-detail-section-heading">
                          <h3>{t("settings.baseConfig")}</h3>
                        </div>
                        <div className="settings-form-grid compact">
                          <label>
                            <span>{t("settings.providerName")}</span>
                            <input
                              value={detailForm.name}
                              onChange={(event) => updateProviderField("name", event.target.value)}
                              placeholder="Volc Coding Plan"
                            />
                          </label>
                          <label>
                            <span>{t("settings.providerId")}</span>
                            <input
                              value={detailForm.id}
                              onChange={(event) => updateProviderField("id", event.target.value)}
                              placeholder="volc-coding-plan"
                            />
                          </label>
                          {!isNativeAuthProtocol(detailForm.protocol) ? (
                            <>
                              <div className="settings-form-wide">
                                <span>{t("settings.protocol")}</span>
                                <div className="settings-segmented">
                                  {PROVIDER_PROTOCOL_OPTIONS.map((option) => (
                                    <button
                                      key={option.id}
                                      className={detailForm.protocol === option.id ? "active" : ""}
                                      type="button"
                                      onClick={() => updateProviderField("protocol", option.id)}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <label>
                                <span>{t("settings.apiBaseUrl")}</span>
                                <input
                                  value={primaryBaseUrl(detailForm)}
                                  onChange={(event) => updatePrimaryBaseUrl(event.target.value)}
                                  placeholder="https://example.com/v1"
                                />
                              </label>
                              <label>
                                {renderProviderApiKeyField()}
                              </label>
                              <label>
                                <span>{t("settings.apiKeyEnv")}</span>
                                <input
                                  value={detailForm.apiKeyEnv}
                                  onChange={(event) => updateProviderField("apiKeyEnv", event.target.value)}
                                  onBlur={saveProviderProfile}
                                  placeholder="OPENGROVE_VOLC_CODING_API_KEY"
                                />
                              </label>
                            </>
                          ) : null}
                          <label className="settings-form-wide">
                            <span>{t("settings.description")}</span>
                            <input
                              value={detailForm.description}
                              onChange={(event) => updateProviderField("description", event.target.value)}
                              placeholder={t("settings.providerDescriptionPlaceholder")}
                            />
                          </label>
                        </div>
                      </div>
                      <div className="settings-detail-section">
                        <div className="settings-detail-section-heading">
                          <h3>{t("settings.availableModels")}</h3>
                        </div>
                        <div className="settings-model-row">
                          {editableProviderModels.length ? (
                            <span className="settings-provider-models editable">
                              {editableProviderModels.map((model, index) => (
                                <span className="settings-model-chip" key={`new-model-${index}`}>
                                  <input
                                    className="settings-model-chip-input"
                                    value={model}
                                    size={Math.max(model.length, 6)}
                                    onBlur={() => setProviderModels(editableProviderModels)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                      }
                                    }}
                                    onChange={(event) => updateProviderModel(index, event.target.value)}
                                    aria-label={t("settings.models")}
                                  />
                                  <button type="button" onClick={() => removeProviderModelAt(index)} aria-label={t("settings.removeModel")}>
                                    ×
                                  </button>
                                </span>
                              ))}
                            </span>
                          ) : (
                            <p className="settings-help">{t("settings.noProviderModels")}</p>
                          )}
                          <button className="settings-model-add-button" type="button" onClick={addProviderModel} aria-label={t("settings.addModel")}>
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                      {providerFormError ? <p className="settings-warning">{providerFormError}</p> : null}
                      <div className="settings-form-actions settings-provider-detail-actions">
                        <span />
                        <span>
                          <button type="button" onClick={closeProviderDetail}>{t("common.cancel")}</button>
                          {renderProviderSaveButton()}
                        </span>
                      </div>
                    </section>
                    </div>
                  ) : null}
                  {sortedProviders.map(renderProviderItem)}
                  {!providerDetailOpen || selectedProvider ? (
                    <button className="settings-provider-add-row" type="button" onClick={startAddProvider}>
                      <Plus size={15} />
                      <span>{t("settings.addProvider")}</span>
                    </button>
                  ) : null}
                </div>
              </section>
              {providerSections.nativeAuth.length ? (
                <section className="settings-provider-block">
                  <div className="settings-provider-block-heading">
                    <h2>{t("settings.nativeAuthStates")}</h2>
                    <p>{t("settings.nativeAuthStatesCopy")}</p>
                  </div>
                  <div className="settings-provider-list native-auth-list">
                    {providerSections.nativeAuth.map(renderNativeAuthProviderItem)}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {activeSection === "apps" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section settings-mounted-apps-section">
                <div className="settings-mounted-apps-toolbar">
                  <span className={mountedApps.length ? "settings-status-pill" : "settings-status-pill muted"}>
                    {t("settings.mountedAppsCount", { count: mountedApps.length })}
                  </span>
                </div>
                <div className="settings-list settings-mounted-apps-list">
                  {mountedApps.map((item) => (
                    <div className="settings-list-row settings-list-row-field settings-mounted-app-row" key={item.id}>
                      <span className="settings-list-row-main">
                        <strong>{item.title || item.id}</strong>
                        <small>{item.path}</small>
                      </span>
                      <span className="settings-list-row-control settings-mounted-app-controls">
                        <input
                          className="settings-mounted-app-title-input"
                          value={item.title ?? ""}
                          disabled={props.loading || props.saving}
                          placeholder={t("settings.appName")}
                          onBlur={(event) => updateMountedApp(item.id, { title: event.currentTarget.value.trim() || undefined })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                          onChange={(event) => {
                            const title = event.target.value;
                            setMountedApps((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, title } : candidate));
                          }}
                        />
                        <input
                          className="settings-mounted-app-path-input"
                          value={item.path}
                          disabled={props.loading || props.saving}
                          placeholder="/path/to/opengrove-vfs"
                          onBlur={(event) => updateMountedApp(item.id, { path: event.currentTarget.value.trim() })}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                          onChange={(event) => {
                            const path = event.target.value;
                            setMountedApps((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, path } : candidate));
                          }}
                        />
                        <button
                          className={item.enabled ? "settings-provider-enable-button enabled" : "settings-provider-enable-button"}
                          type="button"
                          role="switch"
                          aria-checked={item.enabled}
                          aria-label={t("settings.appEnabled")}
                          disabled={props.loading || props.saving}
                          onClick={() => updateMountedApp(item.id, { enabled: !item.enabled })}
                        >
                          <span aria-hidden="true" />
                        </button>
                        <button
                          className="settings-provider-icon-button"
                          type="button"
                          aria-label={t("common.remove")}
                          disabled={props.loading || props.saving}
                          onClick={() => removeMountedApp(item.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </div>
                  ))}
                  {!mountedApps.length ? (
                    <div className="settings-list-row">
                      <span className="settings-list-row-main">
                        <strong>{t("settings.noMountedApps")}</strong>
                        <small>{t("settings.noMountedAppsCopy")}</small>
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>新建应用</h2>
                </div>
                <AppCreateWizard
                  mode={appDraftMode}
                  title={appDraftTitle}
                  source={appDraftPath}
                  sourceKind={appDraftSourceKind}
                  description={appDraftDescription}
                  loading={props.loading}
                  saving={props.saving}
                  canRequestAgent={Boolean(props.onRequestAppBuilder)}
                  onModeChange={setAppDraftMode}
                  onTitleChange={setAppDraftTitle}
                  onSourceChange={setAppDraftPath}
                  onSourceKindChange={setAppDraftSourceKind}
                  onDescriptionChange={setAppDraftDescription}
                  onCancel={resetAppDraft}
                  onDirectMount={addMountedApp}
                  onRequestAgent={requestAppBuilder}
                />
              </section>
            </div>
          ) : null}

          {activeSection === "voice" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.speechToText")}</h2>
                  <span className={selectedVoiceProvider?.configured ? "settings-status-pill" : "settings-status-pill muted"}>
                    {selectedVoiceProvider?.configured ? t("settings.configured") : t("settings.notConfigured")}
                  </span>
                </div>
                <div className="settings-list">
                  <div className="settings-list-row settings-preference-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.sttProvider")}</strong>
                      <small>{t("settings.sttProviderCopy")}</small>
                    </span>
                    <span className="settings-list-row-control wide">
                      <InlineSelect
                        value={voiceSettings.stt.provider}
                        options={voiceProviderOptions}
                        disabled={props.loading || props.saving}
                        onChange={(value) => saveVoice({ provider: value as VoiceSttProviderId })}
                      />
                    </span>
                  </div>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.sttLanguage")}</strong>
                      <small>{t("settings.sttLanguageCopy")}</small>
                    </span>
                    <input
                      value={voiceSettings.stt.language}
                      disabled={props.loading || props.saving}
                      placeholder="auto"
                      onBlur={(event) => saveVoice({ language: event.currentTarget.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setVoiceDraft({ language: event.target.value })}
                    />
                  </label>

                  {voiceSettings.stt.provider === "openai" ? (
                    <>
                      <label className="settings-list-row settings-list-row-field">
                        <span className="settings-list-row-main">
                          <strong>{t("settings.sttModel")}</strong>
                          <small>OpenAI</small>
                        </span>
                        <input
                          value={voiceSettings.stt.openai.model}
                          disabled={props.loading || props.saving}
                          placeholder="gpt-4o-mini-transcribe"
                          onBlur={() => saveVoice()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => setVoiceDraft({ openai: { ...voiceSettings.stt.openai, model: event.target.value } })}
                        />
                      </label>
                      <label className="settings-list-row settings-list-row-field">
                        <span className="settings-list-row-main">
                          <strong>{t("settings.apiKeyEnv")}</strong>
                          <small>{t("settings.requiresEnvKey")}</small>
                        </span>
                        <input
                          value={voiceSettings.stt.openai.apiKeyEnv}
                          disabled={props.loading || props.saving}
                          placeholder="OPENAI_API_KEY"
                          onBlur={() => saveVoice()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => setVoiceDraft({ openai: { ...voiceSettings.stt.openai, apiKeyEnv: event.target.value } })}
                        />
                      </label>
                    </>
                  ) : null}

                  {voiceSettings.stt.provider === "groq" ? (
                    <>
                      <label className="settings-list-row settings-list-row-field">
                        <span className="settings-list-row-main">
                          <strong>{t("settings.sttModel")}</strong>
                          <small>Groq</small>
                        </span>
                        <input
                          value={voiceSettings.stt.groq.model}
                          disabled={props.loading || props.saving}
                          placeholder="whisper-large-v3-turbo"
                          onBlur={() => saveVoice()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => setVoiceDraft({ groq: { ...voiceSettings.stt.groq, model: event.target.value } })}
                        />
                      </label>
                      <label className="settings-list-row settings-list-row-field">
                        <span className="settings-list-row-main">
                          <strong>{t("settings.apiKeyEnv")}</strong>
                          <small>{t("settings.requiresEnvKey")}</small>
                        </span>
                        <input
                          value={voiceSettings.stt.groq.apiKeyEnv}
                          disabled={props.loading || props.saving}
                          placeholder="GROQ_API_KEY"
                          onBlur={() => saveVoice()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => setVoiceDraft({ groq: { ...voiceSettings.stt.groq, apiKeyEnv: event.target.value } })}
                        />
                      </label>
                    </>
                  ) : null}

                  {voiceSettings.stt.provider === "local-whisper" ? (
                    <>
                      <label className="settings-list-row settings-list-row-field">
                        <span className="settings-list-row-main">
                          <strong>{t("settings.sttModel")}</strong>
                          <small>Whisper</small>
                        </span>
                        <input
                          value={voiceSettings.stt.localWhisper.model}
                          disabled={props.loading || props.saving}
                          placeholder="base"
                          onBlur={() => saveVoice()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => setVoiceDraft({ localWhisper: { ...voiceSettings.stt.localWhisper, model: event.target.value } })}
                        />
                      </label>
                      <label className="settings-list-row settings-list-row-field">
                        <span className="settings-list-row-main">
                          <strong>{t("settings.localCommand")}</strong>
                          <small>{t("settings.localCommandCopy")}</small>
                        </span>
                        <input
                          value={voiceSettings.stt.localWhisper.command ?? ""}
                          disabled={props.loading || props.saving}
                          placeholder="whisper {input} --model {model} --output_format txt --output_dir {outputDir}"
                          onBlur={() => saveVoice()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                          }}
                          onChange={(event) => setVoiceDraft({ localWhisper: { ...voiceSettings.stt.localWhisper, command: event.target.value } })}
                        />
                      </label>
                    </>
                  ) : null}

                  {voiceSettings.stt.provider === "browser" ? (
                    <div className="settings-list-row">
                      <span className="settings-list-row-main">
                        <strong>{t("settings.browserOnly")}</strong>
                        <small>{t("settings.browserOnlyCopy")}</small>
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "remoteMessaging" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.matrixServer")}</h2>
                  <span className={matrixConfigured ? "settings-status-pill" : "settings-status-pill muted"}>
                    {matrixConfigured ? t("settings.configured") : t("settings.notConfigured")}
                  </span>
                </div>
                <p className="settings-help">{t("settings.matrixServerCopy")}</p>
                <div className="settings-list">
                  <label className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.matrixEnabled")}</strong>
                      <small>{t("settings.matrixEnabledCopy")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={matrixSettings.enabled}
                      disabled={props.loading || props.saving}
                      onChange={(event) => saveMatrix({ enabled: event.target.checked })}
                    />
                  </label>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.matrixHomeserverUrl")}</strong>
                      <small>{t("settings.matrixHomeserverUrlCopy")}</small>
                    </span>
                    <input
                      value={matrixSettings.homeserverUrl}
                      disabled={props.loading || props.saving || !matrixSettings.enabled}
                      placeholder="https://matrix.example.com"
                      onBlur={(event) => saveMatrix({ homeserverUrl: event.currentTarget.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setMatrixDraft({ homeserverUrl: event.target.value })}
                    />
                  </label>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.matrixUserId")}</strong>
                      <small>{t("settings.matrixUserIdCopy")}</small>
                    </span>
                    <input
                      value={matrixSettings.userId}
                      disabled={props.loading || props.saving || !matrixSettings.enabled}
                      placeholder="@alice:matrix.example.com"
                      onBlur={(event) => saveMatrix({ userId: event.currentTarget.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setMatrixDraft({ userId: event.target.value })}
                    />
                  </label>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.matrixAccessToken")}</strong>
                      <small>{t("settings.matrixAccessTokenCopy")}</small>
                    </span>
                    <input
                      type="password"
                      value={matrixSettings.accessToken ?? ""}
                      disabled={props.loading || props.saving || !matrixSettings.enabled}
                      placeholder={t("settings.optionalSecretPlaceholder")}
                      onBlur={(event) => saveMatrix({ accessToken: event.currentTarget.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setMatrixDraft({ accessToken: event.target.value })}
                    />
                  </label>
                </div>
              </section>
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.inviteLanding")}</h2>
                  <span className={inviteLandingSettings.baseUrl ? "settings-status-pill" : "settings-status-pill muted"}>
                    {inviteLandingSettings.baseUrl ? t("settings.configured") : t("settings.notConfigured")}
                  </span>
                </div>
                <div className="settings-list">
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.inviteLandingUrl")}</strong>
                      <small>{t("settings.inviteLandingUrlCopy")}</small>
                    </span>
                    <input
                      value={inviteLandingSettings.baseUrl}
                      disabled={props.loading || props.saving || !matrixSettings.enabled}
                      placeholder="https://invite.opengrove.example"
                      onBlur={(event) => saveInviteLanding({ baseUrl: event.currentTarget.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setInviteLandingDraft({ baseUrl: event.target.value })}
                    />
                  </label>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "network" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.proxy")}</h2>
                </div>
                <div className="settings-list">
                  <label className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.kernelProxy")}</strong>
                      <small>{t("settings.kernelProxyCopy")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={kernelProxy.enabled}
                      disabled={props.loading || props.saving}
                      onChange={(event) => saveKernelProxy({ enabled: event.target.checked })}
                    />
                  </label>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.proxyUrl")}</strong>
                    </span>
                    <input
                      value={kernelProxy.proxyUrl}
                      disabled={props.loading || props.saving}
                      placeholder="http://127.0.0.1:7890"
                      onBlur={() => saveKernelProxy()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setKernelProxyDraft({ proxyUrl: event.target.value })}
                    />
                  </label>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.noProxy")}</strong>
                    </span>
                    <input
                      value={kernelProxy.noProxy}
                      disabled={props.loading || props.saving}
                      placeholder="127.0.0.1,localhost,::1"
                      onBlur={() => saveKernelProxy()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setKernelProxyDraft({ noProxy: event.target.value })}
                    />
                  </label>
                  <label className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.nodeUseEnvProxy")}</strong>
                      <small>{t("settings.nodeUseEnvProxyCopy")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={kernelProxy.nodeUseEnvProxy}
                      disabled={props.loading || props.saving}
                      onChange={(event) => saveKernelProxy({ nodeUseEnvProxy: event.target.checked })}
                    />
                  </label>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.effectiveProxy")}</strong>
                      <small>{effectiveProxyDescription(kernelProxy, t)}</small>
                    </span>
                    <code>{effectiveProxyValue(kernelProxy, t)}</code>
                  </div>
                </div>
              </section>
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.httpsCapture")}</h2>
                  <span className={providerHttpCaptureEnabled ? "settings-status-pill" : "settings-status-pill muted"}>
                    {providerHttpCaptureEnabled ? t("common.enabled") : t("common.disabled")}
                  </span>
                </div>
                <p className="settings-help">{t("settings.httpsCaptureCopy")}</p>
                <div className="settings-list">
                  <label className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.httpsCapture")}</strong>
                      <small>{providerHttpCapture?.running ? t("settings.running") : t("settings.httpsCaptureCopy")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={providerHttpCaptureEnabled}
                      disabled={props.loading || props.saving}
                      onChange={(event) => saveProviderHttpCapture(event.target.checked)}
                    />
                  </label>
                  <label className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.codexRawCapture")}</strong>
                      <small>{t("settings.codexRawCaptureCopy")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={providerHttpCaptureEnabled && codexRawEventCaptureEnabled}
                      disabled={props.loading || props.saving || !providerHttpCaptureEnabled}
                      onChange={(event) => saveCodexRawEventCapture(event.target.checked)}
                    />
                  </label>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.proxyUrl")}</strong>
                      <small>{providerHttpCapture?.proxyUrl || "http://127.0.0.1:9080"}</small>
                    </span>
                  </div>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.service")}</strong>
                      <small>{providerHttpCapture?.running ? t("settings.running") : t("settings.notRunning")}</small>
                    </span>
                  </div>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.injection")}</strong>
                      <small>{providerHttpCapture?.injected ? t("settings.injected") : t("settings.notInjected")}</small>
                    </span>
                  </div>
                  {providerHttpCapture?.warning ? (
                    <div className="settings-list-row">
                      <span className="settings-list-row-main">
                        <strong>{t("settings.status")}</strong>
                        <small>{providerHttpCapture.warning}</small>
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "appearance" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section settings-appearance-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.general")}</h2>
                </div>
                <div className="settings-list settings-preference-list">
                  <div className="settings-list-row settings-preference-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.theme")}</strong>
                      <small>{t("settings.themeCopy")}</small>
                    </span>
                    <span className="settings-list-row-control wide">
                      <InlineSelect
                        value={themePreference}
                        options={themeSelectOptions}
                        onChange={(value) => setThemePreference(value as ThemePreference)}
                      />
                    </span>
                  </div>
                  <div className="settings-list-row settings-preference-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.iconStyle")}</strong>
                      <small>{t("settings.iconStyleCopy")}</small>
                    </span>
                    <span className="settings-list-row-control wide">
                      <InlineSelect
                        value={iconStylePreference}
                        options={iconStyleSelectOptions}
                        onChange={(value) => setIconStylePreference(value as IconStylePreference)}
                      />
                    </span>
                  </div>
                  <div className="settings-list-row settings-preference-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.language")}</strong>
                      <small>{t("settings.languageCopy")}</small>
                    </span>
                    <span className="settings-list-row-control wide">
                      <InlineSelect
                        value={languagePreference}
                        options={languageSelectOptions}
                        onChange={(value) => setLanguagePreference(value as LanguagePreference)}
                      />
                    </span>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {props.error ? <p className="settings-warning">{props.error}</p> : null}
          {props.saving ? <p className="settings-restart-note">{t("common.saving")}</p> : null}
        </div>
      </main>
      {providerDeleteTarget ? (
        <Dialog open onOpenChange={(open) => (!open ? setProviderDeleteTargetId("") : undefined)}>
          <DialogContent className="settings-confirm-dialog" aria-label={t("settings.removeProvider")}>
            <DialogTitle>{t("settings.removeProvider")}</DialogTitle>
            <p className="settings-confirm-copy">
              {t("settings.removeProviderConfirm", { name: providerDeleteTarget.name })}
            </p>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setProviderDeleteTargetId("")}>
                {t("common.cancel")}
              </button>
              <button className="danger-button" type="button" onClick={confirmDeleteProvider}>
                {t("common.delete")}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
function sectionTitle(value: SettingsSectionId, t: TranslationFn): string {
  const section = SETTINGS_SECTIONS.find((item) => item.id === value);
  return section ? t(section.labelKey) : t("app.settings");
}

function sectionDescription(value: SettingsSectionId, t: TranslationFn): string {
  if (value === "kernels") return t("settings.kernelsDescription");
  if (value === "ops") return t("settings.opsCenterDescription");
  if (value === "providers") return t("settings.providersDescription");
  if (value === "apps") return t("settings.mountedAppsDescription");
  if (value === "voice") return t("settings.voiceDescription");
  if (value === "remoteMessaging") return t("settings.remoteMessagingDescription");
  if (value === "network") return t("settings.networkDescription");
  if (value === "appearance") return t("settings.appearanceDescription");
  return t("app.settings");
}
