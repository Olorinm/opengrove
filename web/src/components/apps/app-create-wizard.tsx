import { Archive, Folder, GitBranch, Globe2, Plus, Terminal } from "lucide-react";

export type AppCreateSourceKind = "local" | "git" | "archive" | "project";
export type AppDraftMode = "choice" | "import" | "describe";
export type AppBuilderRequest = {
  mode: "import" | "describe";
  sourceKind?: AppCreateSourceKind;
  title?: string;
  source?: string;
  description?: string;
};

export function AppCreateWizard(props: {
  mode: AppDraftMode;
  title: string;
  source: string;
  sourceKind: AppCreateSourceKind;
  description: string;
  loading?: boolean;
  saving?: boolean;
  canRequestAgent?: boolean;
  onModeChange(mode: AppDraftMode): void;
  onTitleChange(value: string): void;
  onSourceChange(value: string): void;
  onSourceKindChange(value: AppCreateSourceKind): void;
  onDescriptionChange(value: string): void;
  onCancel(): void;
  onDirectMount(): void;
  onRequestAgent(request: AppBuilderRequest): void;
}) {
  const disabled = Boolean(props.loading || props.saving);
  const canImport = Boolean(props.source.trim());
  const canDescribe = Boolean(props.description.trim());
  return (
    <div className="app-create-wizard">
      <div className="settings-app-builder-modes">
        <button
          type="button"
          data-active={props.mode === "import" ? "true" : "false"}
          onClick={() => props.onModeChange("import")}
        >
          <strong>导入已有 App</strong>
          <small>本地项目、Git/GitHub URL、压缩包 URL，或还没按 OpenGrove 规范组织的项目。</small>
        </button>
        <button
          type="button"
          data-active={props.mode === "describe" ? "true" : "false"}
          onClick={() => props.onModeChange("describe")}
        >
          <strong>描述创建</strong>
          <small>描述工作台目标，让 Agent 生成 app 目录、manifest、UI、skill、CLI wrapper 和 smoke。</small>
        </button>
      </div>

      {props.mode === "import" ? (
        <>
          <div className="app-create-source-kind" aria-label="导入来源类型">
            {sourceOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  type="button"
                  key={option.id}
                  data-active={props.sourceKind === option.id ? "true" : "false"}
                  disabled={disabled}
                  onClick={() => props.onSourceKindChange(option.id)}
                >
                  <Icon size={14} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          <div className="settings-form-grid compact">
            <label>
              <span>App 名称</span>
              <input
                value={props.title}
                disabled={disabled}
                placeholder="VFS"
                onChange={(event) => props.onTitleChange(event.target.value)}
              />
            </label>
            <label>
              <span>{sourceLabel(props.sourceKind)}</span>
              <input
                value={props.source}
                disabled={disabled}
                placeholder={sourcePlaceholder(props.sourceKind)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canImport) {
                    props.onRequestAgent(buildRequest(props, "import"));
                  }
                }}
                onChange={(event) => props.onSourceChange(event.target.value)}
              />
            </label>
          </div>
          <div className="settings-form-actions">
            <button type="button" disabled={disabled} onClick={props.onCancel}>取消</button>
            <button
              type="button"
              disabled={disabled || !canImport || props.sourceKind !== "local"}
              title={props.sourceKind !== "local" ? "非本地目录需要先交给 Agent 拉取到托管 App 目录" : undefined}
              onClick={props.onDirectMount}
            >
              <Plus size={15} />
              本地目录直接挂载
            </button>
            <button
              className="primary"
              type="button"
              disabled={disabled || !canImport || !props.canRequestAgent}
              onClick={() => props.onRequestAgent(buildRequest(props, "import"))}
            >
              <Terminal size={15} />
              交给 Agent 导入
            </button>
          </div>
        </>
      ) : null}

      {props.mode === "describe" ? (
        <>
          <div className="settings-form-grid compact">
            <label>
              <span>App 名称</span>
              <input
                value={props.title}
                disabled={disabled}
                placeholder="素材整理台"
                onChange={(event) => props.onTitleChange(event.target.value)}
              />
            </label>
            <label className="settings-form-wide">
              <span>应用描述</span>
              <textarea
                value={props.description}
                disabled={disabled}
                placeholder="它要处理什么文件、展示什么信息、需要哪些按钮/流程、最后产物是什么。"
                onChange={(event) => props.onDescriptionChange(event.target.value)}
              />
            </label>
          </div>
          <div className="settings-form-actions">
            <button type="button" disabled={disabled} onClick={props.onCancel}>取消</button>
            <button
              className="primary"
              type="button"
              disabled={disabled || !canDescribe || !props.canRequestAgent}
              onClick={() => props.onRequestAgent(buildRequest(props, "describe"))}
            >
              <Terminal size={15} />
              交给 Agent 创建
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

const sourceOptions: Array<{ id: AppCreateSourceKind; label: string; icon: typeof Folder }> = [
  { id: "local", label: "本地文件夹", icon: Folder },
  { id: "git", label: "Git/GitHub URL", icon: GitBranch },
  { id: "archive", label: "压缩包 URL", icon: Archive },
  { id: "project", label: "普通项目", icon: Globe2 },
];

function buildRequest(props: Parameters<typeof AppCreateWizard>[0], mode: "import" | "describe"): AppBuilderRequest {
  return {
    mode,
    sourceKind: props.sourceKind,
    title: props.title.trim() || undefined,
    source: props.source.trim() || undefined,
    description: props.description.trim() || undefined,
  };
}

function sourceLabel(kind: AppCreateSourceKind): string {
  if (kind === "git") return "Git / GitHub URL";
  if (kind === "archive") return "压缩包 URL";
  if (kind === "project") return "项目地址或 URL";
  return "本地文件夹";
}

function sourcePlaceholder(kind: AppCreateSourceKind): string {
  if (kind === "git") return "https://github.com/org/repo.git";
  if (kind === "archive") return "https://example.com/app.zip";
  if (kind === "project") return "/Users/me/projects/toolkit 或 https://...";
  return "/Users/me/projects/opengrove-vfs";
}
