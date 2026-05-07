import { useEffect, useMemo, useState } from "react";
import { Bug, Cpu, KeyRound, Palette } from "lucide-react";
import type { BridgeSettings, KernelKnowledgeSource, KernelPreference } from "../../bridge";
import { APP_PRODUCT_NAME } from "../../identity";
import { renderContextRecordCard } from "../system/system-views";

type SettingsSectionId = "kernels" | "diagnostics" | "appearance" | "developer";

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; icon: typeof Cpu }> = [
  { id: "kernels", label: "内核与知识", icon: Cpu },
  { id: "diagnostics", label: "抓包与诊断", icon: Bug },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "developer", label: "开发者", icon: KeyRound },
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
  }): void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("kernels");
  const [kernel, setKernel] = useState<KernelPreference>("auto");
  const [providerHttpCaptureEnabled, setProviderHttpCaptureEnabled] = useState(false);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    if (!props.settings) {
      return;
    }
    setKernel(props.settings.kernel);
    setProviderHttpCaptureEnabled(Boolean(props.settings.providerHttpCapture?.enabled));
    setSourceEnabled(buildSourceEnabledState(props.settings));
  }, [props.settings]);

  const kernels = useMemo(() => {
    return props.settings?.kernels?.length
      ? props.settings.kernels
      : [
          { id: "auto" as KernelPreference, label: "自动选择", available: true },
          { id: "codex" as KernelPreference, label: "Codex", available: true },
          { id: "claude-code" as KernelPreference, label: "Claude Code", available: true },
          { id: "hermes" as KernelPreference, label: "Hermes", available: true },
          { id: "pi" as KernelPreference, label: "Pi", available: true },
          { id: "scripted" as KernelPreference, label: "Scripted demo", available: true },
        ];
  }, [props.settings]);

  const capture = props.settings?.providerHttpCapture;
  const sourceCount = kernels.reduce((count, item) => count + (item.sources?.length ?? 0), 0);

  const saveSettings = (next: {
    kernel?: KernelPreference;
    providerHttpCaptureEnabled?: boolean;
    kernelKnowledgeSourceEnabled?: Record<string, Record<string, boolean>>;
  }) => {
    props.onSave({
      kernel: next.kernel ?? kernel,
      providerHttpCaptureEnabled: next.providerHttpCaptureEnabled ?? providerHttpCaptureEnabled,
      kernelKnowledgeSourceEnabled: next.kernelKnowledgeSourceEnabled ?? sourceEnabled,
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

  return (
    <div
      className={props.embedded ? "settings-screen embedded" : "settings-screen"}
      role={props.embedded ? undefined : "dialog"}
      aria-modal={props.embedded ? undefined : "true"}
      aria-label="设置"
    >
      <aside className="settings-screen-sidebar">
        {props.embedded ? null : (
          <button className="settings-back-button" type="button" onClick={props.onClose}>
            <span aria-hidden="true">←</span>
            <span>返回应用</span>
          </button>
        )}
        <nav className="settings-nav" aria-label="设置分类">
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
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="settings-screen-main">
        <div className="settings-screen-content">
          <header className="settings-screen-header">
            <span className="settings-screen-kicker">Settings</span>
            <h1>{sectionTitle(activeSection)}</h1>
            <p>{sectionDescription(activeSection)}</p>
          </header>

          {activeSection === "kernels" ? (
            <div className="settings-page-stack">
              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>工作模式</h2>
                    <p>决定新回合默认交给哪个内核。自动模式会按可用性选择。</p>
                  </div>
                  <span className="settings-status-pill">当前 {formatKernelLabel(props.settings?.activeKernel) || "未知"}</span>
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
                          ? `自动解析为 ${formatKernelLabel(option.resolved)}`
                          : option.available
                            ? option.description || "可用"
                            : option.reason || "不可用"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>资料库来源</h2>
                    <p>已识别 {sourceCount} 个本机来源。资料库按来源分组，不再把不同内核的目录揉成一层。</p>
                  </div>
                </div>
                <div className="settings-kernel-list">
                  {kernels.filter((option) => option.id !== "auto").map((option) => (
                    <section className={kernel === option.id ? "settings-kernel-card active" : "settings-kernel-card"} key={option.id}>
                      <div className="settings-panel-heading">
                        <div>
                          <h2>{option.label}</h2>
                          <p>{option.description || "内核适配器"}</p>
                        </div>
                        <span className={option.available ? "settings-status-pill" : "settings-status-pill muted"}>
                          {option.available ? "已检测" : "未安装"}
                        </span>
                      </div>
                      <div className="settings-info-list compact">
                        <InfoRow title="版本" value={option.version || "未知"} />
                        <InfoRow title="配置目录" value={option.configHome || "未提供"} mono />
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
                                  <small>{formatSourceMeta(source)}</small>
                                </span>
                                <code>{source.path || "由内核动态提供"}</code>
                                {source.description ? <span className="settings-source-note">{source.description}</span> : null}
                              </span>
                              <span className={source.exists ? "settings-source-state ok" : "settings-source-state"}>
                                {source.exists ? "存在" : "未创建"}
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="settings-help">暂无可同步来源。</p>
                      )}
                    </section>
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
                    <span className="settings-section-title">HTTPS 抓包模式</span>
                    <span className="settings-section-note">
                      开启后会自动启动 mitmproxy 并重建内核；只有代理服务启动成功且内核支持时，OpenGrove 才把代理和 CA 注入子进程。
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
                  <span>代理</span>
                  <code>{capture?.proxyUrl || "http://127.0.0.1:9080"}</code>
                  <span>CA</span>
                  <code>{capture?.caCertPath || "未找到"}</code>
                  <span>服务</span>
                  <strong>{capture?.running ? "运行中" : "未运行"}</strong>
                  <span>注入</span>
                  <strong>{capture?.injected ? "已注入" : providerHttpCaptureEnabled ? "本内核未注入" : "未开启"}</strong>
                  <span>状态</span>
                  <strong>{capture?.status || "disabled"}</strong>
                </div>
                {capture?.warning ? <p className="settings-warning">{capture.warning}</p> : null}
              </section>

              <section className="settings-panel">
                <div className="settings-panel-heading">
                  <div>
                    <h2>原始上下文记录</h2>
                    <p>这里保留每一轮实际组装给内核的上下文、用户输入、system prompt、tool/skill 统计和抓包摘要。</p>
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
                    <div className="panel-empty">还没有上下文记录</div>
                  )}
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "appearance" ? (
            <section className="settings-panel">
              <div className="settings-empty-state">
                <Palette size={22} />
                <strong>外观设置还没有接入</strong>
                <span>当前先保持系统默认主题。后续这里放主题、字体和编辑器偏好。</span>
              </div>
            </section>
          ) : null}

          {activeSection === "developer" ? (
            <section className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>安装与路径</h2>
                  <p>OpenGrove 只记录安装建议，不自动执行。真正安装内核需要用户确认后再跑命令。</p>
                </div>
              </div>
              <div className="settings-install-list">
                {kernels.filter((option) => option.id !== "auto").map((option) => (
                  <div className="settings-install-card" key={option.id}>
                    <strong>{option.label}</strong>
                    <span>{option.available ? "已可用" : option.reason || "未检测到"}</span>
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
          {props.saving ? <p className="settings-restart-note">正在保存设置...</p> : null}
        </div>
      </main>
    </div>
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

function formatSourceMeta(source: KernelKnowledgeSource): string {
  const parts = [formatSourceKind(source.kind), formatSourceScope(source.scope), source.syncMode || "index"].filter(Boolean);
  return parts.join(" · ");
}

function formatSourceKind(value: string): string {
  const labels: Record<string, string> = {
    skills: "技能",
    commands: "命令",
    agents: "子 Agent",
    memory: "记忆",
    project_instructions: "项目指令",
    settings: "设置",
    config: "配置",
    auth: "凭证",
    sessions: "会话",
    logs: "日志",
    plugins: "插件",
    toolsets: "工具集",
    artifacts: "产物",
    vault: "资料库",
  };
  return labels[value] || value;
}

function formatSourceScope(value: string): string {
  const labels: Record<string, string> = {
    app: APP_PRODUCT_NAME,
    user: "用户",
    project: "项目",
    workspace: "本地",
    system: "系统",
    managed: "托管",
    external: "外部",
  };
  return labels[value] || value;
}

function sectionTitle(value: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((item) => item.id === value)?.label ?? "设置";
}

function sectionDescription(value: SettingsSectionId): string {
  if (value === "kernels") return "选择默认内核，并管理它们暴露给资料库的本机知识来源。";
  if (value === "diagnostics") return "管理 RPC、原生日志、provider HTTPS 抓包和 trajectory。";
  if (value === "developer") return "查看内核二进制、配置路径和安装建议。";
  if (value === "appearance") return "界面外观偏好。";
  return "设置";
}

function formatKernelLabel(value: string | undefined): string {
  if (value === "claude-code") return "Claude Code kernel";
  if (value === "codex") return "Codex kernel";
  if (value === "hermes") return "Hermes kernel";
  if (value === "pi") return "Pi kernel";
  if (value === "scripted") return "Scripted demo kernel";
  return "";
}
