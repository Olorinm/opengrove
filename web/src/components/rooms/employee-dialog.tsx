import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { KernelOption, ModelId, RuntimeControls } from "../../bridge";
import { modelLabel, modelOptionsForKernel, resolveDefaultModelForKernel, runtimeControlsForKernel } from "../../runtime/kernel-models";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { KernelIcon } from "../ui/entity-icons";
import { RoomInlineSelect } from "./room-inline-select";
import {
  KERNEL_COLORS,
  createId,
  memberInitial,
  roomMemberFromKernel,
  selectableKernelOptions,
  type RoomMember,
} from "./rooms-storage";

type EmployeeDraft = {
  name: string;
  kernel: string;
  model: string;
  role: string;
};

export function EmployeeDialog(props: {
  open: boolean;
  activeKernel?: string;
  activeModel: ModelId;
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  kernelOptions: KernelOption[];
  initialMember?: RoomMember;
  onOpenChange(open: boolean): void;
  onCreate(member: RoomMember): void;
  onSave?(member: RoomMember): void;
}) {
  const editing = Boolean(props.initialMember);
  const availableKernels = useMemo(() => selectableKernelOptions(props.kernelOptions, props.activeKernel), [props.activeKernel, props.kernelOptions]);
  const defaultKernel = useMemo(
    () => availableKernels.find((kernel) => kernel.id === props.activeKernel) ?? availableKernels.find(isKernelReady) ?? availableKernels[0],
    [availableKernels, props.activeKernel],
  );
  const [draft, setDraft] = useState<EmployeeDraft>(() => createDefaultDraft(defaultKernel, props.activeKernel, props.activeModel, props.runtimeControls, props.runtimeControlsByKernel, props.initialMember));

  useEffect(() => {
    if (props.open) {
      setDraft(createDefaultDraft(defaultKernel, props.activeKernel, props.activeModel, props.runtimeControls, props.runtimeControlsByKernel, props.initialMember));
    }
  }, [defaultKernel, props.activeKernel, props.activeModel, props.open, props.runtimeControls, props.runtimeControlsByKernel, props.initialMember]);

  const selectedKernel = availableKernels.find((kernel) => kernel.id === draft.kernel) ?? defaultKernel;
  const selectedRuntimeControls = runtimeControlsForKernel(draft.kernel, props.runtimeControls, props.runtimeControlsByKernel);
  const modelOptions = useMemo(() => modelOptionsForKernel(draft.kernel, selectedRuntimeControls), [draft.kernel, selectedRuntimeControls]);
  const selectedModel = modelOptions.find((option) => option.id === draft.model) ?? modelOptions[0];
  const selectedKernelReady = Boolean(selectedKernel && isKernelReady(selectedKernel));
  const canSubmit = Boolean(draft.name.trim() && draft.kernel && draft.model && selectedKernelReady);

  function updateKernel(kernelId: string) {
    const kernel = availableKernels.find((item) => item.id === kernelId);
    setDraft((current) => ({
      ...current,
      kernel: kernelId,
      model: resolveDefaultModel(kernelId, props.activeKernel, props.activeModel, props.runtimeControls, props.runtimeControlsByKernel),
      role: current.role.trim() ? current.role : kernel?.description || "员工",
    }));
  }

  function submitEmployee() {
    if (!canSubmit) return;
    const base = selectedKernel
      ? roomMemberFromKernel(selectedKernel, props.activeKernel, props.activeModel)
      : undefined;
    const member: RoomMember = {
      id: props.initialMember?.id || createId("employee"),
      name: draft.name.trim(),
      kernel: draft.kernel,
      model: draft.model.trim() || base?.model || "native",
      role: draft.role.trim() || base?.role || "员工",
      status: props.initialMember?.status || "waiting",
      color: base?.color || KERNEL_COLORS[draft.kernel] || "#64748b",
      lastActive: props.initialMember?.lastActive || "待命",
      avatarDataUrl: props.initialMember?.avatarDataUrl,
    };
    if (editing) {
      props.onSave?.(member);
    } else {
      props.onCreate(member);
    }
    props.onOpenChange(false);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="employee-dialog" aria-label={editing ? "编辑员工" : "招聘员工"}>
        <DialogTitle>{editing ? "编辑员工" : "招聘员工"}</DialogTitle>
        <div className="employee-dialog-preview">
          <span className="rooms-avatar" data-status="waiting" style={{ "--room-avatar-color": KERNEL_COLORS[draft.kernel] || "#64748b" } as CSSProperties}>
            {memberInitial(draft.name || "新")}
          </span>
          <div>
            <strong>{draft.name.trim() || "新员工"}</strong>
            <small>{selectedKernel?.label || draft.kernel || "选择 kernel"} / {selectedModel?.label || draft.model || "native"}</small>
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
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={() => props.onOpenChange(false)}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={submitEmployee} disabled={!canSubmit}>
            {editing ? "保存" : "创建"}
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

function createDefaultDraft(
  kernel: KernelOption | undefined,
  activeKernel: string | undefined,
  activeModel: ModelId,
  runtimeControls: RuntimeControls | undefined,
  runtimeControlsByKernel: Record<string, RuntimeControls> | undefined,
  initialMember: RoomMember | undefined,
): EmployeeDraft {
  const kernelId = initialMember?.kernel || kernel?.id || activeKernel || "";
  return {
    name: initialMember?.name || "",
    kernel: kernelId,
    model: initialMember?.model || resolveDefaultModel(kernelId, activeKernel, activeModel, runtimeControls, runtimeControlsByKernel),
    role: initialMember?.role || kernel?.description || "员工",
  };
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
