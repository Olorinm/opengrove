import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, Check, ChevronDown, Cpu, Globe2, KeyRound, Palette, PlugZap, Plus, Trash2 } from "lucide-react";
import type { BridgeSettings, KernelKnowledgeSource, KernelPreference, ProviderProfile } from "../../bridge";
import { APP_PRODUCT_NAME } from "../../identity";
import { useI18n, type LanguagePreference, type TranslationFn } from "../../i18n";
import { renderContextRecordCard } from "../system/system-views";

type SettingsSectionId = "kernels" | "providers" | "diagnostics" | "appearance" | "developer";

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; labelKey: "settings.kernels" | "settings.providers" | "settings.diagnostics" | "settings.appearance" | "settings.developer"; icon: typeof Cpu }> = [
  { id: "kernels", labelKey: "settings.kernels", icon: Cpu },
  { id: "providers", labelKey: "settings.providers", icon: PlugZap },
  { id: "diagnostics", labelKey: "settings.diagnostics", icon: Bug },
  { id: "appearance", labelKey: "settings.appearance", icon: Palette },
  { id: "developer", labelKey: "settings.developer", icon: KeyRound },
];

const LANGUAGE_OPTIONS: Array<{
  id: LanguagePreference;
  labelKey: "settings.languageSystem" | "settings.languageChinese" | "settings.languageEnglish";
}> = [
  { id: "system", labelKey: "settings.languageSystem" },
  { id: "zh-CN", labelKey: "settings.languageChinese" },
  { id: "en", labelKey: "settings.languageEnglish" },
];

export function SettingsDialog(props: {
  settings?: BridgeSettings;
  contextRecords?: Record<string, unknown>[];
  loading: boolean;
  saving: boolean;
  error: string;
  embedded?: boolean;
  onClose(): void;
  onSave(payload: {
    kernel: KernelPreference;
    providerHttpCaptureEnabled: boolean;
    kernelKnowledgeSourceEnabled: Record<string, Record<string, boolean>>;
    kernelProviderBindings: Record<string, string>;
    customProviders: ProviderProfile[];
  }): void;
}) {
  const { t, preference, setLanguagePreference } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("kernels");
  const [kernel, setKernel] = useState<KernelPreference>("auto");
  const [providerHttpCaptureEnabled, setProviderHttpCaptureEnabled] = useState(false);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, Record<string, boolean>>>({});
  const [providerBindings, setProviderBindings] = useState<Record<string, string>>({});
  const [customProviders, setCustomProviders] = useState<ProviderProfile[]>([]);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm());
  const [providerFormError, setProviderFormError] = useState("");

  useEffect(() => {
    if (!props.settings) {
      return;
    }
    setKernel(props.settings.kernel);
    setProviderHttpCaptureEnabled(Boolean(props.settings.providerHttpCapture?.enabled));
    setSourceEnabled(buildSourceEnabledState(props.settings));
    setProviderBindings(props.settings.kernelProviderBindings ?? {});
    setCustomProviders(props.settings.customProviders ?? []);
  }, [props.settings]);

  const kernels = useMemo(() => {
    return props.settings?.kernels?.length
      ? props.settings.kernels
      : [
          { id: "auto" as KernelPreference, label: t("settings.autoMode"), available: true },
          { id: "codex" as KernelPreference, label: "Codex", available: true },
          { id: "claude-code" as KernelPreference, label: "Claude Code", available: true },
          { id: "hermes" as KernelPreference, label: "Hermes", available: true },
          { id: "pi" as KernelPreference, label: "Pi", available: true },
        ];
  }, [props.settings, t]);

  const capture = props.settings?.providerHttpCapture;
  const sourceCount = kernels.reduce((count, item) => count + (item.sources?.length ?? 0), 0);

  const saveSettings = (next: {
    kernel?: KernelPreference;
    providerHttpCaptureEnabled?: boolean;
    kernelKnowledgeSourceEnabled?: Record<string, Record<string, boolean>>;
    kernelProviderBindings?: Record<string, string>;
    customProviders?: ProviderProfile[];
  }) => {
    props.onSave({
      kernel: next.kernel ?? kernel,
      providerHttpCaptureEnabled: next.providerHttpCaptureEnabled ?? providerHttpCaptureEnabled,
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
    saveSettings({ providerHttpCaptureEnabled: enabled });
  };

  const toggleSource = (kernelId: string, source: KernelKnowledgeSource, enabled: boolean) => {
    const next = {
      ...sourceEnabled,
      [kernelId]: {
        ...(sourceEnabled[kernelId] ?? {}),
        [source.id]: enabled,
      },
    };
    setSourceEnabled(next);
    saveSettings({ kernelKnowledgeSourceEnabled: next });
  };

  const bindProvider = (kernelId: string, providerId: string) => {
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
    setProviderFormError("");
    const next = [
      ...customProviders.filter((item) => item.id !== profile.id),
      profile,
    ];
    setCustomProviders(next);
    setProviderForm(emptyProviderForm());
    saveSettings({ customProviders: next });
  };

  const editProviderProfile = (provider: ProviderProfile) => {
    setProviderForm({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol || "openai-compatible",
      description: provider.description || "",
      openaiBaseUrl: provider.openaiBaseUrl || "",
      anthropicBaseUrl: provider.anthropicBaseUrl || "",
      geminiBaseUrl: provider.geminiBaseUrl || "",
      apiKeyEnv: provider.apiKeyEnv || "",
      models: (provider.models ?? []).map((model) => model.id).join(", "),
    });
    setProviderFormError("");
  };

  const deleteProviderProfile = (providerId: string) => {
    const nextProviders = customProviders.filter((item) => item.id !== providerId);
    const nextBindings = Object.fromEntries(
      Object.entries(providerBindings).filter(([, value]) => value !== providerId),
    );
    setCustomProviders(nextProviders);
    setProviderBindings(nextBindings);
    saveSettings({ customProviders: nextProviders, kernelProviderBindings: nextBindings });
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
              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>{t("settings.workMode")}</h2>
                    <p>{t("settings.workModeCopy")}</p>
                  </div>
                  <span className="settings-status-pill">{t("common.current")} {formatKernelLabel(props.settings?.activeKernel) || t("common.unknown")}</span>
                </div>
                <div className="settings-choice-grid">
                  {kernels.map((option) => (
                    <button
                      key={option.id}
                      className={kernel === option.id ? "settings-choice-card active" : "settings-choice-card"}
                      type="button"
                      disabled={!option.available || props.saving || props.loading}
                      onClick={() => selectKernel(option.id)}
                    >
                      <strong>{option.label}</strong>
                      <span>
                        {option.id === "auto" && option.resolved
                          ? t("settings.resolvedAs", { kernel: formatKernelLabel(option.resolved) })
                          : option.available
                            ? option.description || t("common.available")
                            : option.reason || t("common.unavailable")}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>{t("settings.knowledgeSources")}</h2>
                    <p>{t("settings.knowledgeSourcesCopy", { count: sourceCount })}</p>
                  </div>
                </div>
                <div className="settings-kernel-list">
                  {kernels.filter((option) => option.id !== "auto").map((option) => (
                    <section className={kernel === option.id ? "settings-kernel-card active" : "settings-kernel-card"} key={option.id}>
                      <div className="settings-panel-heading">
                        <div>
                          <h2>{option.label}</h2>
                          <p>{option.description || t("settings.adapter")}</p>
                        </div>
                        <span className={option.available ? "settings-status-pill" : "settings-status-pill muted"}>
                          {option.available ? t("settings.detected") : t("settings.notInstalled")}
                        </span>
                      </div>
                      <div className="settings-info-list compact">
                        <InfoRow title={t("settings.version")} value={option.version || t("common.unknown")} />
                        <InfoRow title={t("settings.configDir")} value={option.configHome || t("common.unknown")} mono />
                      </div>
                      {option.notes?.length ? <p className="settings-help">{option.notes[0]}</p> : null}
                      {option.sources?.length ? (
                        <div className="settings-source-list">
                          {option.sources.map((source) => (
                            <label key={source.id} className="settings-source-row">
                              <input
                                type="checkbox"
                                checked={isSourceEnabled(option.id, source, sourceEnabled)}
                                disabled={props.saving || props.loading}
                                onChange={(event) => toggleSource(option.id, source, event.target.checked)}
                              />
                              <span className="settings-source-main">
                                <span className="settings-source-title">
                                  {source.title}
                                  <small>{formatSourceMeta(source, t)}</small>
                                </span>
                                <code>{source.path || t("settings.dynamicSource")}</code>
                                {source.description ? <span className="settings-source-note">{source.description}</span> : null}
                              </span>
                              <span className={source.exists ? "settings-source-state ok" : "settings-source-state"}>
                                {source.exists ? t("common.exists") : t("common.notCreated")}
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="settings-help">{t("settings.noSources")}</p>
                      )}
                    </section>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "providers" ? (
            <div className="settings-page-stack">
              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>{t("settings.providers")}</h2>
                    <p>{t("settings.providersDescription")}</p>
                  </div>
                </div>
                <div className="settings-provider-list">
                  {(props.settings?.providers ?? []).map((provider) => (
                    <div className="settings-provider-row" key={provider.id}>
                      <span>
                        <strong>{provider.name}</strong>
                        <small>{provider.custom ? t("settings.customProvider") : t("settings.builtinProvider")} · {provider.protocol}</small>
                      </span>
                      <code>{provider.openaiBaseUrl || provider.anthropicBaseUrl || provider.geminiBaseUrl || provider.protocol}</code>
                      <span className="settings-provider-models">
                        {(provider.models ?? []).slice(0, 4).map((model) => <small key={model.id}>{model.label}</small>)}
                      </span>
                      <span className="settings-provider-actions">
                        {provider.custom ? (
                          <>
                            <button type="button" onClick={() => editProviderProfile(provider)}>{t("common.edit")}</button>
                            <button type="button" onClick={() => deleteProviderProfile(provider.id)}><Trash2 size={14} /></button>
                          </>
                        ) : (
                          <small>{provider.apiKeyEnv ? `${t("settings.secretEnv")} ${provider.apiKeyEnv}` : ""}</small>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>{t("settings.addProvider")}</h2>
                    <p>{t("settings.addProviderCopy")}</p>
                  </div>
                </div>
                <div className="settings-form-grid">
                  <label>
                    <span>{t("settings.providerName")}</span>
                    <input
                      value={providerForm.name}
                      onChange={(event) => setProviderForm(updateProviderForm(providerForm, "name", event.target.value))}
                      placeholder="Volc Coding Plan"
                    />
                  </label>
                  <label>
                    <span>{t("settings.providerId")}</span>
                    <input
                      value={providerForm.id}
                      onChange={(event) => setProviderForm(updateProviderForm(providerForm, "id", event.target.value))}
                      placeholder="volc-coding-plan"
                    />
                  </label>
                  <div className="settings-form-wide">
                    <span>{t("settings.protocol")}</span>
                    <div className="settings-segmented">
                      {PROVIDER_PROTOCOL_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          className={providerForm.protocol === option.id ? "active" : ""}
                          type="button"
                          onClick={() => setProviderForm(updateProviderForm(providerForm, "protocol", option.id))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label>
                    <span>{t("settings.openaiBaseUrl")}</span>
                    <input
                      value={providerForm.openaiBaseUrl}
                      onChange={(event) => setProviderForm(updateProviderForm(providerForm, "openaiBaseUrl", event.target.value))}
                      placeholder="https://example.com/v1"
                    />
                  </label>
                  <label>
                    <span>{t("settings.anthropicBaseUrl")}</span>
                    <input
                      value={providerForm.anthropicBaseUrl}
                      onChange={(event) => setProviderForm(updateProviderForm(providerForm, "anthropicBaseUrl", event.target.value))}
                      placeholder="https://example.com"
                    />
                  </label>
                  <label>
                    <span>{t("settings.apiKeyEnv")}</span>
                    <input
                      value={providerForm.apiKeyEnv}
                      onChange={(event) => setProviderForm(updateProviderForm(providerForm, "apiKeyEnv", event.target.value))}
                      placeholder="OPENGROVE_VOLC_CODING_API_KEY"
                    />
                  </label>
                  <label>
                    <span>{t("settings.models")}</span>
                    <input
                      value={providerForm.models}
                      onChange={(event) => setProviderForm(updateProviderForm(providerForm, "models", event.target.value))}
                      placeholder="glm-5.1, minimax-m2.7"
                    />
                  </label>
                  <label className="settings-form-wide">
                    <span>{t("settings.description")}</span>
                    <input
                      value={providerForm.description}
                      onChange={(event) => setProviderForm(updateProviderForm(providerForm, "description", event.target.value))}
                      placeholder={t("settings.providerDescriptionPlaceholder")}
                    />
                  </label>
                </div>
                {providerFormError ? <p className="settings-warning">{providerFormError}</p> : null}
                <div className="settings-form-actions">
                  <button type="button" onClick={() => setProviderForm(emptyProviderForm())}>{t("common.cancel")}</button>
                  <button className="primary" type="button" onClick={saveProviderProfile}>
                    <Plus size={15} />
                    {t("settings.saveProvider")}
                  </button>
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>{t("settings.providerBindings")}</h2>
                    <p>{t("settings.providerBindingsCopy")}</p>
                  </div>
                </div>
                <div className="settings-binding-list">
                  {kernels.filter((option) => option.id !== "auto").map((option) => (
                    <div className="settings-binding-row" key={option.id}>
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.available ? t("settings.detected") : option.reason || t("settings.notInstalled")}</small>
                      </span>
                      <InlineSelect
                        value={providerBindings[option.id] ?? ""}
                        disabled={props.loading || props.saving}
                        options={[
                          { id: "", label: t("settings.nativeProvider") },
                          ...(props.settings?.providers ?? [])
                          .filter((provider) => !provider.recommendedFor?.length || provider.recommendedFor.includes(option.id))
                          .map((provider) => ({ id: provider.id, label: provider.name })),
                        ]}
                        onChange={(value) => bindProvider(option.id, value)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "diagnostics" ? (
            <div className="settings-page-stack">
              <section className="settings-panel">
                <label className="settings-switch-row settings-switch-card">
                  <span className="settings-section-copy">
                    <span className="settings-section-title">{t("settings.httpsCapture")}</span>
                    <span className="settings-section-note">
                      {t("settings.httpsCaptureCopy")}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={providerHttpCaptureEnabled}
                    disabled={props.loading || props.saving}
                    onChange={(event) => setCaptureEnabled(event.target.checked)}
                  />
                </label>
                <div className="settings-capture-grid">
                  <span>{t("settings.proxy")}</span>
                  <code>{capture?.proxyUrl || "http://127.0.0.1:9080"}</code>
                  <span>{t("settings.ca")}</span>
                  <code>{capture?.caCertPath || t("common.unknown")}</code>
                  <span>{t("settings.service")}</span>
                  <strong>{capture?.running ? t("settings.running") : t("settings.notRunning")}</strong>
                  <span>{t("settings.injection")}</span>
                  <strong>{capture?.injected ? t("settings.injected") : providerHttpCaptureEnabled ? t("settings.kernelNotInjected") : t("common.disabled")}</strong>
                  <span>{t("settings.status")}</span>
                  <strong>{capture?.status || "disabled"}</strong>
                </div>
                {capture?.warning ? <p className="settings-warning">{capture.warning}</p> : null}
              </section>

              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>{t("settings.rawContext")}</h2>
                    <p>{t("settings.rawContextCopy")}</p>
                  </div>
                  <span className="settings-status-pill muted">{props.contextRecords?.length ?? 0}</span>
                </div>
                <div className="panel-list settings-context-list">
                  {props.contextRecords?.length ? (
                    props.contextRecords.map((record, index) => (
                      <div className="panel-list-row" key={String(record.runId || record.id || index)}>
                        {renderContextRecordCard(record)}
                      </div>
                    ))
                  ) : (
                    <div className="panel-empty">{t("settings.noContextRecords")}</div>
                  )}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "appearance" ? (
            <div className="settings-page-stack">
              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>{t("settings.language")}</h2>
                    <p>{t("settings.languageCopy")}</p>
                  </div>
                </div>
                <div className="settings-choice-grid compact">
                  {LANGUAGE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      className={preference === option.id ? "settings-choice-card active" : "settings-choice-card"}
                      type="button"
                      onClick={() => setLanguagePreference(option.id)}
                    >
                      <Globe2 size={17} />
                      <strong>{t(option.labelKey)}</strong>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-empty-state">
                  <Palette size={22} />
                  <strong>{t("settings.appearanceEmptyTitle")}</strong>
                  <span>{t("settings.appearanceEmptyCopy")}</span>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "developer" ? (
            <section className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>{t("settings.installPaths")}</h2>
                  <p>{t("settings.installPathsCopy")}</p>
                </div>
              </div>
              <div className="settings-install-list">
                {kernels.filter((option) => option.id !== "auto").map((option) => (
                  <div className="settings-install-card" key={option.id}>
                    <strong>{option.label}</strong>
                    <span>{option.available ? t("common.available") : option.reason || t("common.unavailable")}</span>
                    {option.binaryPath ? <code>{option.binaryPath}</code> : null}
                    {(option.installActions ?? []).map((action) => (
                      <div className="settings-install-action" key={action.id}>
                        <span>{action.title}</span>
                        {action.command?.length ? <code>{action.command.join(" ")}</code> : null}
                        {action.description ? <small>{action.description}</small> : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {props.error ? <p className="settings-warning">{props.error}</p> : null}
          {props.saving ? <p className="settings-restart-note">{t("common.saving")}</p> : null}
        </div>
      </main>
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
  { id: "custom-gateway", label: "Gateway" },
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
  return {
    id,
    name,
    custom: true,
    protocol: form.protocol,
    description: form.description.trim() || undefined,
    openaiBaseUrl: form.openaiBaseUrl.trim() || undefined,
    anthropicBaseUrl: form.anthropicBaseUrl.trim() || undefined,
    geminiBaseUrl: form.geminiBaseUrl.trim() || undefined,
    apiKeyEnv: form.apiKeyEnv.trim() || undefined,
    models: form.models
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((id) => ({ id, label: id })),
  };
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function InlineSelect(props: {
  value: string;
  options: Array<{ id: string; label: string }>;
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
        <span>{selected?.label}</span>
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
              <span>{option.label}</span>
              {option.id === props.value ? <Check size={14} /> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function InfoRow(props: { title: string; value: string; mono?: boolean }) {
  return (
    <div className="settings-info-row">
      <span>{props.title}</span>
      {props.mono ? <code>{props.value}</code> : <strong>{props.value}</strong>}
    </div>
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
  source: KernelKnowledgeSource,
  state: Record<string, Record<string, boolean>>,
): boolean {
  const explicit = state[kernelId]?.[source.id];
  return typeof explicit === "boolean" ? explicit : source.enabled ?? source.enabledByDefault ?? true;
}

function formatSourceMeta(source: KernelKnowledgeSource, t: TranslationFn): string {
  const parts = [formatSourceKind(source.kind, t), formatSourceScope(source.scope, t), source.syncMode || "index"].filter(Boolean);
  return parts.join(" · ");
}

function formatSourceKind(value: string, t: TranslationFn): string {
  const keys: Record<string, Parameters<TranslationFn>[0]> = {
    skills: "source.kind.skills",
    commands: "source.kind.commands",
    agents: "source.kind.agents",
    memory: "source.kind.memory",
    project_instructions: "source.kind.project_instructions",
    settings: "source.kind.settings",
    config: "source.kind.config",
    auth: "source.kind.auth",
    sessions: "source.kind.sessions",
    logs: "source.kind.logs",
    plugins: "source.kind.plugins",
    toolsets: "source.kind.toolsets",
    artifacts: "source.kind.artifacts",
    vault: "source.kind.vault",
  };
  return keys[value] ? t(keys[value]!) : value;
}

function formatSourceScope(value: string, t: TranslationFn): string {
  const keys: Record<string, Parameters<TranslationFn>[0]> = {
    user: "source.scope.user",
    project: "source.scope.project",
    workspace: "source.scope.workspace",
    system: "source.scope.system",
    managed: "source.scope.managed",
    external: "source.scope.external",
  };
  if (value === "app") return APP_PRODUCT_NAME;
  return keys[value] ? t(keys[value]!) : value;
}

function sectionTitle(value: SettingsSectionId, t: TranslationFn): string {
  const section = SETTINGS_SECTIONS.find((item) => item.id === value);
  return section ? t(section.labelKey) : t("app.settings");
}

function sectionDescription(value: SettingsSectionId, t: TranslationFn): string {
  if (value === "kernels") return t("settings.kernelsDescription");
  if (value === "providers") return t("settings.providersDescription");
  if (value === "diagnostics") return t("settings.diagnosticsDescription");
  if (value === "developer") return t("settings.developerDescription");
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
