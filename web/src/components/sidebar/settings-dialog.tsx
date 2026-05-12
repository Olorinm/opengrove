import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bug, Check, ChevronDown, Cpu, Globe2, Palette, PlugZap, Plus, Trash2 } from "lucide-react";
import { useIconStylePreference, type IconStylePreference } from "../../appearance";
import type { BridgeSettings, KernelOption, KernelPathOverride, KernelPreference, KernelProxySettings, MatrixSettings, ProviderProfile, RelaySettings } from "../../bridge";
import { useI18n, type LanguagePreference, type TranslationFn } from "../../i18n";
import { useThemePreference, type ThemePreference } from "../../theme";
import { renderContextRecordCard } from "../system/system-views";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { KernelIcon, ProviderIcon } from "../ui/entity-icons";

type SettingsSectionId = "kernels" | "providers" | "relay" | "network" | "diagnostics" | "appearance";
type SettingsSectionLabelKey =
  | "settings.kernels"
  | "settings.providers"
  | "settings.relay"
  | "settings.network"
  | "settings.diagnostics"
  | "settings.appearance";

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; labelKey: SettingsSectionLabelKey; icon: typeof Cpu }> = [
  { id: "kernels", labelKey: "settings.kernels", icon: Cpu },
  { id: "providers", labelKey: "settings.providers", icon: PlugZap },
  { id: "relay", labelKey: "settings.relay", icon: Globe2 },
  { id: "network", labelKey: "settings.network", icon: Globe2 },
  { id: "diagnostics", labelKey: "settings.diagnostics", icon: Bug },
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

export function SettingsDialog(props: {
  settings?: BridgeSettings;
  contextRecords?: Record<string, unknown>[];
  loading: boolean;
  saving: boolean;
  installingKernelId?: string;
  error: string;
  embedded?: boolean;
  onClose(): void;
  onInstallKernel?(kernelId: string, actionId: string): void;
  onSave(payload: {
    kernel: KernelPreference;
    providerHttpCaptureEnabled: boolean;
    codexRawEventCaptureEnabled: boolean;
    kernelProxy: KernelProxySettings;
    relay: RelaySettings;
    matrix: MatrixSettings;
    kernelPathOverrides: Record<string, KernelPathOverride>;
    kernelKnowledgeSourceEnabled: Record<string, Record<string, boolean>>;
    kernelProviderBindings: Record<string, string>;
    customProviders: ProviderProfile[];
  }): void;
}) {
  const { t, preference: languagePreference, setLanguagePreference } = useI18n();
  const { preference: themePreference, setThemePreference } = useThemePreference();
  const { preference: iconStylePreference, setIconStylePreference } = useIconStylePreference();
  const themeSelectOptions = THEME_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) }));
  const iconStyleSelectOptions = ICON_STYLE_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) }));
  const languageSelectOptions = LANGUAGE_OPTIONS.map((option) => ({ id: option.id, label: t(option.labelKey) }));
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("kernels");
  const [kernel, setKernel] = useState<KernelPreference>("auto");
  const [providerHttpCaptureEnabled, setProviderHttpCaptureEnabled] = useState(false);
  const [codexRawEventCaptureEnabled, setCodexRawEventCaptureEnabled] = useState(false);
  const [kernelProxy, setKernelProxy] = useState<KernelProxySettings>(emptyKernelProxySettings());
  const [relaySettings, setRelaySettings] = useState<RelaySettings>(emptyRelaySettings());
  const [matrixSettings, setMatrixSettings] = useState<MatrixSettings>(emptyMatrixSettings());
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
  const [expandedKernelId, setExpandedKernelId] = useState("");

  useEffect(() => {
    if (!props.settings) {
      return;
    }
    setKernel(props.settings.kernel);
    setProviderHttpCaptureEnabled(Boolean(props.settings.providerHttpCapture?.enabled));
    setCodexRawEventCaptureEnabled(Boolean(props.settings.codexRawEventCaptureEnabled));
    setKernelProxy(normalizeKernelProxySettings(props.settings.kernelProxy));
    setRelaySettings(normalizeRelaySettings(props.settings.relay));
    setMatrixSettings(normalizeMatrixSettings(props.settings.matrix));
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

  const capture = props.settings?.providerHttpCapture;
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
  const sortedProviders = useMemo(
    () => sortEnabledProvidersFirst(providers, providerBindings),
    [providerBindings, providers],
  );

  const saveSettings = (next: {
    kernel?: KernelPreference;
    providerHttpCaptureEnabled?: boolean;
    codexRawEventCaptureEnabled?: boolean;
    kernelProxy?: KernelProxySettings;
    relay?: RelaySettings;
    matrix?: MatrixSettings;
    kernelPathOverrides?: Record<string, KernelPathOverride>;
    kernelKnowledgeSourceEnabled?: Record<string, Record<string, boolean>>;
    kernelProviderBindings?: Record<string, string>;
    customProviders?: ProviderProfile[];
  }) => {
    props.onSave({
      kernel: next.kernel ?? kernel,
      providerHttpCaptureEnabled: next.providerHttpCaptureEnabled ?? providerHttpCaptureEnabled,
      codexRawEventCaptureEnabled: next.codexRawEventCaptureEnabled ?? codexRawEventCaptureEnabled,
      kernelProxy: next.kernelProxy ?? kernelProxy,
      relay: next.relay ?? relaySettings,
      matrix: next.matrix ?? matrixSettings,
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

  const setCaptureEnabled = (enabled: boolean) => {
    setProviderHttpCaptureEnabled(enabled);
    const rawEnabled = enabled ? codexRawEventCaptureEnabled : false;
    if (!enabled) {
      setCodexRawEventCaptureEnabled(false);
    }
    saveSettings({ providerHttpCaptureEnabled: enabled, codexRawEventCaptureEnabled: rawEnabled });
  };

  const setCodexRawCaptureEnabled = (enabled: boolean) => {
    const nextEnabled = providerHttpCaptureEnabled && enabled;
    setCodexRawEventCaptureEnabled(nextEnabled);
    saveSettings({ codexRawEventCaptureEnabled: nextEnabled });
  };

  const setKernelProxyDraft = (patch: Partial<KernelProxySettings>) => {
    setKernelProxy((current) => ({ ...current, ...patch }));
  };

  const saveKernelProxy = (patch: Partial<KernelProxySettings> = {}) => {
    const next = normalizeKernelProxySettings({ ...kernelProxy, ...patch });
    setKernelProxy(next);
    saveSettings({ kernelProxy: next });
  };

  const setRelayDraft = (patch: Partial<RelaySettings>) => {
    setRelaySettings((current) => ({ ...current, ...patch }));
  };

  const saveRelay = (patch: Partial<RelaySettings> = {}) => {
    const next = normalizeRelaySettings({ ...relaySettings, ...patch });
    setRelaySettings(next);
    saveSettings({ relay: next });
  };

  const setMatrixDraft = (patch: Partial<MatrixSettings>) => {
    setMatrixSettings((current) => ({ ...current, ...patch }));
  };

  const saveMatrix = (patch: Partial<MatrixSettings> = {}) => {
    const next = normalizeMatrixSettings({ ...matrixSettings, ...patch });
    setMatrixSettings(next);
    saveSettings({ matrix: next });
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

  const removeProviderModelAt = (modelIndex: number) => {
    setProviderModels(editableProviderModels.filter((_, index) => index !== modelIndex));
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
          <span className="settings-choice-card-description">{description}</span>
        </span>
        <span className="settings-choice-card-action">
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
        <div className="settings-screen-content">
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

          {activeSection === "providers" ? (
            <div className="settings-providers-workspace">
              <section className="settings-provider-browser">
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
                                <span>{t("settings.apiKeyEnv")}</span>
                                <input
                                  value={detailForm.apiKeyEnv}
                                  onChange={(event) => updateProviderField("apiKeyEnv", event.target.value)}
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
                  {sortedProviders.map((provider) => {
                    const providerEnabled = isProviderEnabled(provider, providerBindings);
                    return (
                    <div
                      className={[
                        "settings-provider-item",
                        selectedProviderId === provider.id ? "active" : "",
                        providerEnabled ? "enabled" : "disabled",
                      ].filter(Boolean).join(" ")}
                      key={provider.id}
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
                                    <span>{t("settings.apiKeyEnv")}</span>
                                    <input
                                      value={detailForm.apiKeyEnv}
                                      readOnly={!providerDetailEditable}
                                      onChange={(event) => updateProviderField("apiKeyEnv", event.target.value)}
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
                  })}
                  {!providerDetailOpen || selectedProvider ? (
                    <button className="settings-provider-add-row" type="button" onClick={startAddProvider}>
                      <Plus size={15} />
                      <span>{t("settings.addProvider")}</span>
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "relay" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.matrixServer")}</h2>
                  <span className={matrixSettings.enabled && matrixSettings.homeserverUrl && matrixSettings.userId && matrixSettings.accessToken ? "settings-status-pill" : "settings-status-pill muted"}>
                    {matrixSettings.enabled && matrixSettings.homeserverUrl && matrixSettings.userId && matrixSettings.accessToken ? t("settings.relayReady") : t("settings.relayMissing")}
                  </span>
                </div>
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
                      disabled={props.loading || props.saving}
                      placeholder="https://matrix.example.com"
                      onBlur={() => saveMatrix()}
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
                      disabled={props.loading || props.saving}
                      placeholder="@alice:matrix.example.com"
                      onBlur={() => saveMatrix()}
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
                      disabled={props.loading || props.saving}
                      placeholder={t("settings.relayTokenPlaceholder")}
                      onBlur={() => saveMatrix()}
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
                  <h2>{t("settings.relayServer")}</h2>
                  <span className={relaySettings.enabled && relaySettings.baseUrl ? "settings-status-pill" : "settings-status-pill muted"}>
                    {relaySettings.enabled && relaySettings.baseUrl ? t("settings.relayReady") : t("settings.relayMissing")}
                  </span>
                </div>
                <div className="settings-list">
                  <label className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.relayEnabled")}</strong>
                      <small>{t("settings.relayEnabledCopy")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={relaySettings.enabled}
                      disabled={props.loading || props.saving}
                      onChange={(event) => saveRelay({ enabled: event.target.checked })}
                    />
                  </label>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.relayBaseUrl")}</strong>
                      <small>{t("settings.relayBaseUrlCopy")}</small>
                    </span>
                    <input
                      value={relaySettings.baseUrl}
                      disabled={props.loading || props.saving}
                      placeholder="https://relay.example.com"
                      onBlur={() => saveRelay()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setRelayDraft({ baseUrl: event.target.value })}
                    />
                  </label>
                  <label className="settings-list-row settings-list-row-field">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.relayToken")}</strong>
                      <small>{t("settings.relayTokenCopy")}</small>
                    </span>
                    <input
                      type="password"
                      value={relaySettings.authToken ?? ""}
                      disabled={props.loading || props.saving}
                      placeholder={t("settings.relayTokenPlaceholder")}
                      onBlur={() => saveRelay()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                      }}
                      onChange={(event) => setRelayDraft({ authToken: event.target.value })}
                    />
                  </label>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.relayWorkspace")}</strong>
                      <small>{t("settings.relayWorkspaceCopy")}</small>
                    </span>
                    <code>{relaySettings.workspaceId || t("settings.relayWorkspacePending")}</code>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "network" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.kernelProxy")}</h2>
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
            </div>
          ) : null}

          {activeSection === "diagnostics" ? (
            <div className="settings-page-stack">
              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.httpsCapture")}</h2>
                </div>
                <div className="settings-list">
                  <label className="settings-list-row">
                    <span className="settings-list-row-main">
                      <strong>{t("settings.httpsCapture")}</strong>
                      <small>{t("settings.httpsCaptureCopy")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={providerHttpCaptureEnabled}
                      disabled={props.loading || props.saving}
                      onChange={(event) => setCaptureEnabled(event.target.checked)}
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
                      onChange={(event) => setCodexRawCaptureEnabled(event.target.checked)}
                    />
                  </label>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main"><strong>{t("settings.proxy")}</strong></span>
                    <code>{capture?.proxyUrl || "http://127.0.0.1:9080"}</code>
                  </div>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main"><strong>{t("settings.upstreamProxy")}</strong></span>
                    <code>{capture?.upstreamProxy || t("settings.proxySourceNone")}</code>
                  </div>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main"><strong>{t("settings.ca")}</strong></span>
                    <code>{capture?.caCertPath || t("common.unknown")}</code>
                  </div>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main"><strong>{t("settings.service")}</strong></span>
                    <strong>{capture?.running ? t("settings.running") : t("settings.notRunning")}</strong>
                  </div>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main"><strong>{t("settings.injection")}</strong></span>
                    <strong>{capture?.injected ? t("settings.injected") : providerHttpCaptureEnabled ? t("settings.kernelNotInjected") : t("common.disabled")}</strong>
                  </div>
                  <div className="settings-list-row">
                    <span className="settings-list-row-main"><strong>{t("settings.status")}</strong></span>
                    <strong>{capture?.status || "disabled"}</strong>
                  </div>
                </div>
                {capture?.warning ? <p className="settings-warning">{capture.warning}</p> : null}
              </section>

              <section className="settings-list-section">
                <div className="settings-list-section-heading">
                  <h2>{t("settings.rawContext")}</h2>
                  <span className="settings-status-pill muted">{props.contextRecords?.length ?? 0}</span>
                </div>
                <div className="settings-list settings-context-list">
                  {props.contextRecords?.length ? (
                    props.contextRecords.map((record, index) => (
                      <div className="settings-list-row context" key={String(record.runId || record.id || index)}>
                        {renderContextRecordCard(record)}
                      </div>
                    ))
                  ) : (
                    <div className="settings-list-row muted">
                      <span className="settings-list-row-main"><small>{t("settings.noContextRecords")}</small></span>
                    </div>
                  )}
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

type ProviderFormState = {
  id: string;
  name: string;
  protocol: string;
  description: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  geminiBaseUrl: string;
  apiKeyEnv: string;
  models: string;
};

const PROVIDER_PROTOCOL_OPTIONS = [
  { id: "openai-compatible", label: "OpenAI" },
  { id: "anthropic-compatible", label: "Anthropic" },
];

function emptyProviderForm(): ProviderFormState {
  return {
    id: "",
    name: "",
    protocol: "openai-compatible",
    description: "",
    openaiBaseUrl: "",
    anthropicBaseUrl: "",
    geminiBaseUrl: "",
    apiKeyEnv: "",
    models: "",
  };
}

function updateProviderForm<K extends keyof ProviderFormState>(
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

function providerProfileFromForm(form: ProviderFormState): ProviderProfile | undefined {
  const id = slug(form.id || form.name);
  const name = form.name.trim();
  if (!id || !name) return undefined;
  const nativeAuth = isNativeAuthProtocol(form.protocol);
  const keyInput = form.apiKeyEnv.trim();
  const keyIsEnv = isEnvironmentVariableName(keyInput);
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
    apiKey: nativeAuth || keyIsEnv ? undefined : keyInput || undefined,
    apiKeyEnv: nativeAuth || !keyIsEnv ? undefined : keyInput || undefined,
    credentialKind: nativeAuth ? "native-login" : keyInput ? (keyIsEnv ? "env-key" : "api-key") : "none",
    models: form.models
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id })),
  };
}

function providerFormFromProfile(provider: ProviderProfile): ProviderFormState {
  return {
    id: provider.id,
    name: provider.name,
    protocol: editableProviderProtocol(provider),
    description: provider.description || "",
    openaiBaseUrl: provider.openaiBaseUrl || "",
    anthropicBaseUrl: provider.anthropicBaseUrl || "",
    geminiBaseUrl: provider.geminiBaseUrl || "",
    apiKeyEnv: provider.apiKey || provider.apiKeyEnv || "",
    models: (provider.models ?? []).map((model) => model.id).join(", "),
  };
}

function primaryBaseUrl(form: ProviderFormState): string {
  if (form.protocol === "anthropic-compatible") return form.anthropicBaseUrl;
  return form.openaiBaseUrl;
}

function isNativeAuthProtocol(value: string | undefined): boolean {
  return value === "native-oauth";
}

function editableProviderProtocol(provider: ProviderProfile): string {
  if (provider.protocol === "native-oauth") return "native-oauth";
  if (provider.protocol === "anthropic-compatible") return "anthropic-compatible";
  if (provider.protocol === "openai-compatible") return "openai-compatible";
  if (provider.anthropicBaseUrl && !provider.openaiBaseUrl) return "anthropic-compatible";
  return "openai-compatible";
}

function sortAvailableKernelsFirst(options: KernelOption[]): KernelOption[] {
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

function sortEnabledProvidersFirst(
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

function isProviderEnabled(provider: ProviderProfile, bindings: Record<string, string>): boolean {
  if (typeof provider.enabled === "boolean") {
    return provider.enabled;
  }
  return Boolean(provider.authConfigured || Object.values(bindings).includes(provider.id));
}

function emptyKernelProxySettings(): KernelProxySettings {
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

function normalizeKernelProxySettings(input: Partial<KernelProxySettings> | undefined): KernelProxySettings {
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

function emptyRelaySettings(): RelaySettings {
  return {
    enabled: false,
    baseUrl: "",
    authToken: "",
    workspaceId: "",
    roomBindings: {},
  };
}

function normalizeRelaySettings(input: Partial<RelaySettings> | undefined): RelaySettings {
  const defaults = emptyRelaySettings();
  return {
    ...defaults,
    ...input,
    enabled: Boolean(input?.enabled),
    baseUrl: input?.baseUrl?.trim() || "",
    authToken: input?.authToken?.trim() || undefined,
    workspaceId: input?.workspaceId?.trim() || undefined,
    roomBindings: input?.roomBindings ?? {},
  };
}

function emptyMatrixSettings(): MatrixSettings {
  return {
    enabled: false,
    homeserverUrl: "",
    userId: "",
    accessToken: "",
    roomBindings: {},
  };
}

function normalizeMatrixSettings(input: Partial<MatrixSettings> | undefined): MatrixSettings {
  const defaults = emptyMatrixSettings();
  return {
    ...defaults,
    ...input,
    enabled: Boolean(input?.enabled),
    homeserverUrl: input?.homeserverUrl?.trim() || "",
    userId: input?.userId?.trim() || "",
    accessToken: input?.accessToken?.trim() || undefined,
    roomBindings: input?.roomBindings ?? {},
  };
}

function effectiveProxyValue(proxy: KernelProxySettings, t: TranslationFn): string {
  if (proxy.enabled) return proxy.proxyUrl || t("settings.proxySourceNone");
  return proxy.environmentProxyUrl || t("settings.proxySourceNone");
}

function effectiveProxyDescription(proxy: KernelProxySettings, t: TranslationFn): string {
  if (proxy.enabled) return t("settings.effectiveProxyOpenGrove");
  if (proxy.environmentProxyUrl) return t("settings.effectiveProxyEnvironment");
  return t("settings.effectiveProxyNone");
}

function sanitizeProviderBindings(bindings: Record<string, string>, providers: ProviderProfile[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [kernelId, providerId] of Object.entries(bindings)) {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (provider && providerSupportsKernel(provider, kernelId)) {
      next[kernelId] = providerId;
    }
  }
  return next;
}

function providerSupportsKernel(provider: ProviderProfile, kernelId: string): boolean {
  return Boolean(providerProtocolForKernel(provider, kernelId));
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
  return provider.openaiBaseUrl && providerCredentialIsSupported(provider, ["api-key", "env-key"]) ? "openai-compatible" : undefined;
}

function providerCredentialIsSupported(provider: ProviderProfile, allowed: string[]): boolean {
  return allowed.includes(providerCredentialKind(provider));
}

function providerCredentialKind(provider: ProviderProfile): string {
  if (provider.credentialKind) return provider.credentialKind;
  if (provider.protocol === "native-oauth") return "native-login";
  if (provider.apiKey) return "api-key";
  if (provider.apiKeyEnv) return "env-key";
  const text = `${provider.id} ${provider.name}`.toLowerCase();
  if (text.includes("bedrock")) return "aws";
  if (text.includes("vertex")) return "google-adc";
  return provider.authConfigured && provider.sourceKernel ? "kernel-native" : "none";
}

function providerBindingLabel(provider: ProviderProfile, kernelId: string, t: TranslationFn): string {
  const protocol = providerProtocolForKernel(provider, kernelId);
  const protocolLabel = protocol === "native-oauth"
    ? t("settings.accountLogin")
    : protocol === "anthropic-compatible"
      ? "Anthropic"
      : protocol === "gemini-compatible"
        ? "Gemini"
      : "OpenAI";
  return `${provider.name} · ${protocolLabel}`;
}

function providerMetaLabel(provider: ProviderProfile, t: TranslationFn): string {
  if (provider.origin === "discovered" || provider.sourceKernel) return t("settings.nativeProvider");
  if (isNativeAuthProtocol(provider.protocol)) return t("settings.accountLogin");
  if (provider.apiKey) return t("settings.apiKeyConfigured");
  return provider.apiKeyEnv || provider.protocol;
}

function formatModelCount(count: number, t: TranslationFn): string {
  return t("settings.modelsCount", { count });
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isEnvironmentVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

type InlineSelectOption = { id: string; label: string; icon?: ReactNode };

function InlineSelect(props: {
  value: string;
  options: InlineSelectOption[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const selected = props.options.find((option) => option.id === props.value) ?? props.options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span className="settings-inline-select" ref={rootRef}>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="settings-inline-select-value">
          {selected?.icon ? <span className="settings-inline-select-icon">{selected.icon}</span> : null}
          <span>{selected?.label}</span>
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <span className="settings-inline-menu">
          {props.options.map((option) => (
            <button
              key={option.id || "native"}
              type="button"
              onClick={() => {
                props.onChange(option.id);
                setOpen(false);
              }}
            >
              <span className="settings-inline-select-value">
                {option.icon ? <span className="settings-inline-select-icon">{option.icon}</span> : null}
                <span>{option.label}</span>
              </span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function buildSourceEnabledState(settings: BridgeSettings): Record<string, Record<string, boolean>> {
  const next: Record<string, Record<string, boolean>> = {};
  for (const kernel of settings.kernels ?? []) {
    for (const source of kernel.sources ?? []) {
      if (!next[kernel.id]) next[kernel.id] = {};
      next[kernel.id]![source.id] = isSourceEnabled(kernel.id, source, settings.kernelKnowledgeSourceEnabled ?? {});
    }
  }
  return next;
}

function isSourceEnabled(
  kernelId: string,
  source: NonNullable<KernelOption["sources"]>[number],
  state: Record<string, Record<string, boolean>>,
): boolean {
  const explicit = state[kernelId]?.[source.id];
  return typeof explicit === "boolean" ? explicit : source.enabled ?? source.enabledByDefault ?? true;
}

function sectionTitle(value: SettingsSectionId, t: TranslationFn): string {
  const section = SETTINGS_SECTIONS.find((item) => item.id === value);
  return section ? t(section.labelKey) : t("app.settings");
}

function sectionDescription(value: SettingsSectionId, t: TranslationFn): string {
  if (value === "kernels") return t("settings.kernelsDescription");
  if (value === "providers") return t("settings.providersDescription");
  if (value === "relay") return t("settings.relayDescription");
  if (value === "network") return t("settings.networkDescription");
  if (value === "diagnostics") return t("settings.diagnosticsDescription");
  if (value === "appearance") return t("settings.appearanceDescription");
  return t("app.settings");
}

function formatKernelLabel(value: string | undefined): string {
  if (value === "claude-code") return "Claude Code kernel";
  if (value === "codex") return "Codex kernel";
  if (value === "hermes") return "Hermes kernel";
  if (value === "pi") return "Pi kernel";
  return "";
}
