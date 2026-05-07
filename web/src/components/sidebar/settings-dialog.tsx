import { useEffect, useMemo, useState } from "react";
import { BookOpen, Bug, Cpu, FolderSync, KeyRound, Palette, ShieldCheck } from "lucide-react";
import type { BridgeSettings, KernelKnowledgeSource, KernelOption, KernelPreference } from "../../bridge";
import { APP_PRODUCT_NAME } from "../../identity";
import { Button } from "../ui/button";

type SettingsSectionId = "general" | "kernels" | "knowledge" | "permissions" | "diagnostics" | "appearance" | "developer";

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string; icon: typeof Cpu }> = [
  { id: "general", label: "常规", icon: Cpu },
  { id: "kernels", label: "内核", icon: Cpu },
  { id: "knowledge", label: "知识来源", icon: FolderSync },
  { id: "permissions", label: "权限", icon: ShieldCheck },
  { id: "diagnostics", label: "抓包与诊断", icon: Bug },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "developer", label: "开发者", icon: KeyRound },
];

export function SettingsDialog(props: {
  settings?: BridgeSettings;
  loading: boolean;
  saving: boolean;
  error: string;
  onClose(): void;
  onSave(payload: {
    kernel: KernelPreference;
    providerHttpCaptureEnabled: boolean;
    kernelKnowledgeSourceEnabled: Record<string, Record<string, boolean>>;
  }): void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
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

  const selectedKernel = kernels.find((item) => item.id === kernel);
  const capture = props.settings?.providerHttpCapture;
  const willRestart =
    props.settings &&
    (props.settings.kernel !== kernel ||
      Boolean(props.settings.providerHttpCapture?.enabled) !== providerHttpCaptureEnabled ||
      JSON.stringify(props.settings.kernelKnowledgeSourceEnabled ?? {}) !== JSON.stringify(sourceEnabled));
  const sourceCount = kernels.reduce((count, item) => count + (item.sources?.length ?? 0), 0);

  const toggleSource = (kernelId: string, source: KernelKnowledgeSource, enabled: boolean) => {
    setSourceEnabled((previous) => ({
      ...previous,
      [kernelId]: {
        ...(previous[kernelId] ?? {}),
        [source.id]: enabled,
      },
    }));
  };

  return (
    <div className="settings-screen" role="dialog" aria-modal="true" aria-label="设置">
      <aside className="settings-screen-sidebar">
        <button className="settings-back-button" type="button" onClick={props.onClose}>
          <span aria-hidden="true">←</span>
          <span>返回应用</span>
        </button>
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

          {activeSection === "general" ? (
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
                  {kernels.slice(0, 4).map((option) => (
                    <button
                      key={option.id}
                      className={kernel === option.id ? "settings-choice-card active" : "settings-choice-card"}
                      type="button"
                      disabled={!option.available}
                      onClick={() => setKernel(option.id)}
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
                  <button className="settings-inline-link" type="button" onClick={() => setActiveSection("knowledge")}>
                    管理
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "kernels" ? (
            <div className="settings-kernel-list">
              {kernels.filter((option) => option.id !== "auto").map((option) => (
                <KernelStatusCard
                  key={option.id}
                  option={option}
                  selected={kernel === option.id}
                  onSelect={() => setKernel(option.id)}
                />
              ))}
            </div>
          ) : null}

          {activeSection === "knowledge" ? (
            <div className="settings-page-stack">
              {kernels.filter((option) => option.id !== "auto").map((option) => (
                <section className="settings-panel" key={option.id}>
                  <div className="settings-panel-heading">
                    <div>
                      <h2>{option.label}</h2>
                      <p>{option.sources?.length ? "这些是 adapter 从该内核源码和本机路径里确认出来的关键人工注入物。" : "暂无可同步来源。"}</p>
                    </div>
                    <span className={option.available ? "settings-status-pill" : "settings-status-pill muted"}>
                      {option.available ? "已检测" : "未安装"}
                    </span>
                  </div>
                  <div className="settings-source-list">
                    {(option.sources ?? []).map((source) => (
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
                </section>
              ))}
            </div>
          ) : null}

          {activeSection === "permissions" ? (
            <section className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>权限边界</h2>
                  <p>这里先展示 OpenGrove 与内核的分工：OpenGrove 管 host tool 审批，Codex/Claude/Hermes 继续管自己的原生权限模型。</p>
                </div>
              </div>
              <div className="settings-info-list">
                <InfoRow title="OpenGrove host tools" value="由 OpenGrove policy / approval inbox 控制" />
                <InfoRow title="Codex native tools" value="由 Codex sandboxPolicy / approvalsReviewer 控制，adapter 负责翻译" />
                <InfoRow title="Claude Code tools" value="当前 CLI bridge 使用 bypassPermissions，后续 SDK bridge 才能完整接审批" />
                <InfoRow title="Hermes tools" value="当前 oneshot bridge 只拿最终文本，原生工具事件还不可见" />
              </div>
            </section>
          ) : null}

          {activeSection === "diagnostics" ? (
            <section className="settings-panel">
              <label className="settings-switch-row settings-switch-card">
                <span className="settings-section-copy">
                  <span className="settings-section-title">HTTPS 抓包模式</span>
                  <span className="settings-section-note">
                    保存后会重建内核。只有 mitmproxy 服务运行且内核支持时，OpenGrove 才把代理和 CA 注入子进程。
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={providerHttpCaptureEnabled}
                  disabled={props.loading || props.saving}
                  onChange={(event) => setProviderHttpCaptureEnabled(event.target.checked)}
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
          ) : null}

          {activeSection === "appearance" ? (
            <section className="settings-panel">
              <div className="settings-empty-state">
                <BookOpen size={22} />
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
          {willRestart ? <p className="settings-restart-note">保存后会重建内核，后续新回合使用新设置。</p> : null}
        </div>

        <footer className="settings-screen-footer">
          <Button onClick={props.onClose} disabled={props.saving}>取消</Button>
          <Button
            variant="primary"
            onClick={() => props.onSave({ kernel, providerHttpCaptureEnabled, kernelKnowledgeSourceEnabled: sourceEnabled })}
            disabled={props.saving || props.loading || (selectedKernel ? !selectedKernel.available : false)}
          >
            {props.saving ? "保存中" : "保存设置"}
          </Button>
        </footer>
      </main>
    </div>
  );
}

function KernelStatusCard(props: {
  option: KernelOption;
  selected: boolean;
  onSelect(): void;
}) {
  const option = props.option;
  return (
    <section className={props.selected ? "settings-kernel-card active" : "settings-kernel-card"}>
      <div className="settings-panel-heading">
        <div>
          <h2>{option.label}</h2>
          <p>{option.description || "内核适配器"}</p>
        </div>
        <button
          className="settings-inline-link"
          type="button"
          disabled={!option.available}
          onClick={props.onSelect}
        >
          {props.selected ? "已选择" : option.available ? "启用" : "不可用"}
        </button>
      </div>
      <div className="settings-info-list compact">
        <InfoRow title="安装状态" value={option.available ? "已检测到" : option.reason || "未检测到"} />
        <InfoRow title="版本" value={option.version || "未知"} />
        <InfoRow title="配置目录" value={option.configHome || "未提供"} mono />
        <InfoRow title="关键来源" value={`${option.sources?.length ?? 0} 个`} />
      </div>
      {option.notes?.length ? (
        <p className="settings-help">{option.notes[0]}</p>
      ) : null}
    </section>
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
  if (value === "kernels") return "检测 Codex、Claude Code、Hermes、Pi，并查看 OpenGrove 与它们的衔接边界。";
  if (value === "knowledge") return "按来源管理可以被资料库索引、镜像或发布的本机文件。";
  if (value === "permissions") return "把 OpenGrove host tool 权限和内核原生权限分清楚。";
  if (value === "diagnostics") return "管理 RPC、原生日志、provider HTTPS 抓包和 trajectory。";
  if (value === "developer") return "查看内核二进制、配置路径和安装建议。";
  if (value === "appearance") return "界面外观偏好。";
  return "默认内核、工作模式和全局行为。";
}

function formatKernelLabel(value: string | undefined): string {
  if (value === "claude-code") return "Claude Code kernel";
  if (value === "codex") return "Codex kernel";
  if (value === "hermes") return "Hermes kernel";
  if (value === "pi") return "Pi kernel";
  if (value === "scripted") return "Scripted demo kernel";
  return "";
}
