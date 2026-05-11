import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { KernelOption, ModelId, RuntimeControls } from "../../bridge";
import { modelLabel, modelOptionsForKernel, resolveDefaultModelForKernel, runtimeControlsForKernel } from "../../runtime/kernel-models";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { KernelIcon } from "../ui/entity-icons";
import { memberFromEmployeeLinkUrl } from "./employee-links";
import { RoomInlineSelect } from "./room-inline-select";
import type { RemoteRoomInviteResult } from "./room-invites";
import {
  KERNEL_COLORS,
  createId,
  memberInitial,
  roomMemberFromKernel,
  roomMemberSourceLabel,
  selectableKernelOptions,
  type RoomMemberSource,
  type RoomMember,
} from "./rooms-storage";

type EmployeeSource = Extract<RoomMemberSource, "local"> | "employee-link" | "room-invite";

type EmployeeDraft = {
  source: EmployeeSource;
  name: string;
  kernel: string;
  model: string;
  role: string;
  employeeLink: string;
};

const EMPLOYEE_SOURCE_OPTIONS: Array<{ id: EmployeeSource; label: string }> = [
  { id: "local", label: "本机员工" },
  { id: "employee-link", label: "从员工链接添加" },
  { id: "room-invite", label: "邀请员工加入" },
];

export function EmployeeDialog(props: {
  open: boolean;
  activeKernel?: string;
  activeModel: ModelId;
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  kernelOptions: KernelOption[];
  initialMember?: RoomMember;
  initialEmployeeLink?: string;
  allowRemoteInvite?: boolean;
  onOpenChange(open: boolean): void;
  onCreate(member: RoomMember): void;
  onCreateRemoteInvite?(): Promise<RemoteRoomInviteResult | null> | RemoteRoomInviteResult | null;
  onSave?(member: RoomMember): void;
}) {
  const editing = Boolean(props.initialMember);
  const sourceOptions = useMemo(
    () => EMPLOYEE_SOURCE_OPTIONS.filter((option) => {
      if (editing) return option.id === "local";
      if (option.id === "room-invite") return Boolean(props.allowRemoteInvite && props.onCreateRemoteInvite);
      return true;
    }),
    [editing, props.allowRemoteInvite, props.onCreateRemoteInvite],
  );
  const availableKernels = useMemo(() => selectableKernelOptions(props.kernelOptions, props.activeKernel), [props.activeKernel, props.kernelOptions]);
  const defaultKernel = useMemo(
    () => availableKernels.find((kernel) => kernel.id === props.activeKernel) ?? availableKernels.find(isKernelReady) ?? availableKernels[0],
    [availableKernels, props.activeKernel],
  );
  const [draft, setDraft] = useState<EmployeeDraft>(() => createDefaultDraft(defaultKernel, props.activeKernel, props.activeModel, props.runtimeControls, props.runtimeControlsByKernel, props.initialMember));
  const [inviteResult, setInviteResult] = useState<RemoteRoomInviteResult | null>(null);
  const [invitePending, setInvitePending] = useState(false);
  const [copyState, setCopyState] = useState("");

  useEffect(() => {
    if (props.open) {
      setDraft(createDefaultDraft(
        defaultKernel,
        props.activeKernel,
        props.activeModel,
        props.runtimeControls,
        props.runtimeControlsByKernel,
        props.initialMember,
        props.initialEmployeeLink,
      ));
      setInviteResult(null);
      setInvitePending(false);
      setCopyState("");
    }
  }, [defaultKernel, props.activeKernel, props.activeModel, props.open, props.runtimeControls, props.runtimeControlsByKernel, props.initialMember, props.initialEmployeeLink]);

  const selectedKernel = availableKernels.find((kernel) => kernel.id === draft.kernel) ?? defaultKernel;
  const selectedRuntimeControls = runtimeControlsForKernel(draft.kernel, props.runtimeControls, props.runtimeControlsByKernel);
  const modelOptions = useMemo(() => modelOptionsForKernel(draft.kernel, selectedRuntimeControls), [draft.kernel, selectedRuntimeControls]);
  const selectedModel = modelOptions.find((option) => option.id === draft.model) ?? modelOptions[0];
  const selectedKernelReady = Boolean(selectedKernel && isKernelReady(selectedKernel));
  const canSubmit = canSubmitDraft(draft, selectedKernelReady, props.onCreateRemoteInvite) && !invitePending;

  function updateKernel(kernelId: string) {
    const kernel = availableKernels.find((item) => item.id === kernelId);
    setDraft((current) => ({
      ...current,
      kernel: kernelId,
      model: resolveDefaultModel(kernelId, props.activeKernel, props.activeModel, props.runtimeControls, props.runtimeControlsByKernel),
      role: current.role.trim() ? current.role : kernel?.description || "员工",
    }));
  }

  async function submitEmployee() {
    if (!canSubmit) return;
    if (draft.source === "room-invite") {
      setCopyState("");
      setInvitePending(true);
      try {
        const result = await (props.onCreateRemoteInvite?.() ?? null);
        setInviteResult(result);
        setCopyState(result ? "" : "需要先在设置里配置 Relay");
      } catch (error) {
        setInviteResult(null);
        setCopyState(formatInviteError(error));
      } finally {
        setInvitePending(false);
      }
      return;
    }
    if (draft.source === "employee-link") {
      try {
        props.onCreate(memberFromEmployeeLinkUrl(draft.employeeLink));
        props.onOpenChange(false);
      } catch {
        setCopyState("员工链接无效");
      }
      return;
    }
    const base = selectedKernel
      ? roomMemberFromKernel(selectedKernel, props.activeKernel, props.activeModel)
      : undefined;
    const member = createMemberFromDraft(draft, {
      base,
      initialMember: props.initialMember,
    });
    if (editing) {
      props.onSave?.(member);
    } else {
      props.onCreate(member);
    }
    props.onOpenChange(false);
  }

  async function copyInviteLink() {
    if (!inviteResult?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteResult.inviteUrl);
      setCopyState("已复制");
    } catch {
      setCopyState("复制失败，可以手动复制");
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="employee-dialog" aria-label={editing ? "编辑员工" : "添加员工"}>
        <DialogTitle>{editing ? "编辑员工" : "添加员工"}</DialogTitle>
        {!editing && sourceOptions.length > 1 ? (
          <label className="employee-dialog-field">
            <span>员工来源</span>
            <RoomInlineSelect
              value={draft.source}
              options={sourceOptions}
              onChange={(source) => {
                setCopyState("");
                setInviteResult(null);
                setDraft((current) => createDraftForSource(
                  current,
                  normalizeEmployeeSource(source),
                  defaultKernel,
                  props.activeKernel,
                  props.activeModel,
                  props.runtimeControls,
                  props.runtimeControlsByKernel,
                ));
              }}
            />
          </label>
        ) : null}
        {draft.source === "local" ? (
          <>
            <div className="employee-dialog-preview">
              <span className="rooms-avatar" data-status="waiting" style={{ "--room-avatar-color": KERNEL_COLORS[draft.kernel] || "#64748b" } as CSSProperties}>
                {memberInitial(draft.name || "新")}
              </span>
              <div>
                <strong>{draft.name.trim() || "新员工"}</strong>
                <small>{previewSubtitle(draft, selectedKernel?.label, selectedModel?.label)}</small>
              </div>
            </div>
            <label className="employee-dialog-field">
              <span>员工名称</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="例如：复核员"
              />
            </label>
            <div className="employee-dialog-runtime" aria-label="选择执行内核和模型">
              <div className="employee-dialog-runtime-title">Kernel</div>
              <div className="employee-dialog-kernel-list">
                {availableKernels.map((kernel) => (
                  <button
                    key={kernel.id}
                    className="employee-dialog-kernel-option"
                    data-active={kernel.id === draft.kernel ? "true" : "false"}
                    data-ready={isKernelReady(kernel) ? "true" : "false"}
                    type="button"
                    onClick={() => updateKernel(kernel.id)}
                    title={kernel.reason || kernel.providerLabel || kernel.version || kernel.id}
                  >
                    <span className="employee-dialog-kernel-icon" aria-hidden="true">
                      <KernelIcon kernelId={kernel.id} size={17} />
                    </span>
                    <span>
                      <strong>{kernel.label || kernel.id}</strong>
                      <small>{kernelSubline(kernel)}</small>
                    </span>
                  </button>
                ))}
                {!availableKernels.length ? <div className="rooms-empty-row">没有可选 kernel</div> : null}
              </div>
            </div>
            <label className="employee-dialog-field">
              <span>模型</span>
              <RoomInlineSelect
                value={draft.model}
                options={modelOptions.map((option) => ({ id: option.id, label: modelLabel(option) }))}
                onChange={(model) => setDraft((current) => ({ ...current, model }))}
              />
            </label>
            {!selectedKernelReady && selectedKernel ? (
              <div className="employee-dialog-warning">
                {selectedKernel.reason || "这个 kernel 还没有安装，暂时不能创建可执行员工。"}
              </div>
            ) : null}
            <label className="employee-dialog-field">
              <span>人设 / 职责</span>
              <textarea
                value={draft.role}
                onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
                placeholder="写清它负责什么、该怎么判断、最终回复应该是什么风格"
                rows={4}
              />
            </label>
          </>
        ) : draft.source === "employee-link" ? (
          <div className="employee-dialog-runtime">
            <div className="employee-dialog-runtime-title">员工链接</div>
            <div className="employee-dialog-warning">
              粘贴朋友发来的员工链接，会把这个员工添加到你的通讯录。
            </div>
            <label className="employee-dialog-field">
              <span>员工链接</span>
              <textarea
                value={draft.employeeLink}
                onChange={(event) => {
                  setCopyState("");
                  setDraft((current) => ({ ...current, employeeLink: event.target.value }));
                }}
                placeholder="粘贴员工链接"
                rows={3}
              />
            </label>
            {copyState ? <div className="employee-dialog-warning">{copyState}</div> : null}
          </div>
        ) : (
          <div className="employee-dialog-runtime">
            <div className="employee-dialog-runtime-title">邀请链接</div>
            <div className="employee-dialog-warning">
              朋友打开 Relay 链接后，会在自己的 OpenGrove 里选择一个员工加入这个聊天室。
            </div>
            {inviteResult ? (
              <label className="employee-dialog-field">
                <span>邀请链接</span>
                <input value={inviteResult.inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
              </label>
            ) : null}
            {copyState && !inviteResult ? <div className="employee-dialog-warning">{copyState}</div> : null}
          </div>
        )}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={() => props.onOpenChange(false)}>
            {inviteResult ? "关闭" : "取消"}
          </button>
          {inviteResult ? (
            <button className="ghost-button" type="button" onClick={() => void copyInviteLink()}>
              {copyState || "复制链接"}
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={() => void submitEmployee()} disabled={!canSubmit}>
            {invitePending ? "生成中..." : submitLabel(editing, draft.source)}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function isKernelReady(kernel: KernelOption | undefined): boolean {
  return Boolean(kernel && (kernel.available || kernel.installed));
}

function kernelSubline(kernel: KernelOption): string {
  if (!isKernelReady(kernel)) {
    return kernel.reason ? `未安装 · ${kernel.reason}` : "未安装";
  }
  return kernel.providerLabel || kernel.version || "可用";
}

function normalizeEmployeeSource(value: string): EmployeeSource {
  if (value === "employee-link" || value === "room-invite") return value;
  return "local";
}

function canSubmitDraft(
  draft: EmployeeDraft,
  selectedKernelReady: boolean,
  createRemoteInvite: (() => Promise<RemoteRoomInviteResult | null> | RemoteRoomInviteResult | null) | undefined,
): boolean {
  if (draft.source === "employee-link") return Boolean(draft.employeeLink.trim());
  if (draft.source === "room-invite") return Boolean(createRemoteInvite);
  return Boolean(draft.name.trim() && draft.kernel && draft.model && selectedKernelReady);
}

function formatInviteError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("relay_not_configured")) {
    return "请先到设置里启用 Relay，并填写公共 Relay 地址。";
  }
  if (message.includes("relay_invite_failed")) {
    return "Relay 暂时无法创建邀请，请检查 Relay 地址和访问 token。";
  }
  return `生成邀请失败：${message}`;
}

function submitLabel(editing: boolean, source: EmployeeSource): string {
  if (editing) return "保存";
  if (source === "employee-link") return "添加";
  if (source === "room-invite") return "生成邀请链接";
  return "创建";
}

function createDefaultDraft(
  kernel: KernelOption | undefined,
  activeKernel: string | undefined,
  activeModel: ModelId,
  runtimeControls: RuntimeControls | undefined,
  runtimeControlsByKernel: Record<string, RuntimeControls> | undefined,
  initialMember: RoomMember | undefined,
  initialEmployeeLink?: string,
): EmployeeDraft {
  const kernelId = initialMember?.kernel || kernel?.id || activeKernel || "";
  if (initialEmployeeLink?.trim()) {
    return {
      source: "employee-link",
      name: "",
      kernel: kernelId,
      model: resolveDefaultModel(kernelId, activeKernel, activeModel, runtimeControls, runtimeControlsByKernel),
      role: "",
      employeeLink: initialEmployeeLink,
    };
  }
  return {
    source: "local",
    name: initialMember?.name || "",
    kernel: kernelId,
    model: initialMember?.model || resolveDefaultModel(kernelId, activeKernel, activeModel, runtimeControls, runtimeControlsByKernel),
    role: initialMember?.role || kernel?.description || "员工",
    employeeLink: "",
  };
}

function createDraftForSource(
  current: EmployeeDraft,
  source: EmployeeDraft["source"],
  kernel: KernelOption | undefined,
  activeKernel: string | undefined,
  activeModel: ModelId,
  runtimeControls: RuntimeControls | undefined,
  runtimeControlsByKernel: Record<string, RuntimeControls> | undefined,
): EmployeeDraft {
  if (source === "local") {
    const kernelId = kernel?.id || activeKernel || "";
    return {
      ...current,
      source,
      kernel: kernelId,
      model: resolveDefaultModel(kernelId, activeKernel, activeModel, runtimeControls, runtimeControlsByKernel),
      role: current.role.trim() ? current.role : kernel?.description || "员工",
    };
  }
  if (source === "employee-link") {
    return {
      ...current,
      source,
      name: "",
      role: "",
      employeeLink: "",
    };
  }
  if (source === "room-invite") {
    return {
      ...current,
      source,
      name: "",
      role: "",
      employeeLink: "",
    };
  }
  return current;
}

function createMemberFromDraft(
  draft: EmployeeDraft,
  params: { base?: RoomMember; initialMember?: RoomMember },
): RoomMember {
  const base = params.base;
  return {
    id: params.initialMember?.id || createId("employee"),
    name: draft.name.trim(),
    kernel: draft.kernel,
    model: draft.model.trim() || base?.model || "native",
    role: draft.role.trim() || base?.role || "员工",
    status: params.initialMember?.status || "waiting",
    color: base?.color || KERNEL_COLORS[draft.kernel] || "#64748b",
    lastActive: params.initialMember?.lastActive || "待命",
    avatarDataUrl: params.initialMember?.avatarDataUrl,
    source: "local",
    sourceLabel: roomMemberSourceLabel({ source: "local" }),
    inviteStatus: "none",
  };
}

function previewSubtitle(draft: EmployeeDraft, kernelLabel?: string, modelLabelText?: string): string {
  return `${kernelLabel || draft.kernel || "选择 kernel"} / ${modelLabelText || draft.model || "native"}`;
}

function resolveDefaultModel(
  kernelId: string,
  activeKernel: string | undefined,
  activeModel: ModelId,
  runtimeControls: RuntimeControls | undefined,
  runtimeControlsByKernel: Record<string, RuntimeControls> | undefined,
): string {
  return resolveDefaultModelForKernel({
    kernelId,
    activeKernel,
    activeModel,
    runtimeControls,
    runtimeControlsByKernel,
  });
}
