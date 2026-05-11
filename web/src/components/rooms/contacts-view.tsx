import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, Check, Copy, MessageCircle, Pencil, Search, UserPlus, UsersRound, X } from "lucide-react";
import type { KernelOption, ModelId, RuntimeControls } from "../../bridge";
import { modelLabel, modelOptionsForKernel, resolveDefaultModelForKernel, runtimeControlsForKernel } from "../../runtime/kernel-models";
import { ThemedPixelIcon } from "../sidebar/app-navigation";
import { KernelIcon } from "../ui/entity-icons";
import { EmployeeDialog } from "./employee-dialog";
import { clearEmployeeLinkFromLocation, createEmployeeLink, employeeLinkCode, employeeLinkPreview, readEmployeeLinkFromLocation } from "./employee-links";
import { RoomMemberAvatar } from "./member-avatar";
import { RoomInlineSelect } from "./room-inline-select";
import {
  KERNEL_COLORS,
  ROOMS_STATE_EVENT,
  createId,
  directRoomId,
  memberModelLabel,
  nowIso,
  readStoredState,
  roomMemberSourceDetail,
  roomMemberSourceLabel,
  selectableKernelOptions,
  statusLabel,
  writeRoomsState,
  type Room,
  type RoomMember,
  type RoomsState,
} from "./rooms-storage";

type ContactEditDraft = {
  name: string;
  role: string;
  kernel: string;
  model: string;
  avatarDataUrl?: string;
};

export function ContactsView(props: {
  activeKernel?: string;
  activeModel: ModelId;
  activeWorkspaceRoot: string;
  kernelOptions: KernelOption[];
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  onOpenRooms(): void;
}) {
  const [state, setState] = useState<RoomsState>(() => readStoredState(props.activeKernel, props.activeModel, props.activeWorkspaceRoot, props.kernelOptions));
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<"employees" | "groups">("employees");
  const [selectedMemberId, setSelectedMemberId] = useState(state.members[0]?.id || "");
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [incomingEmployeeLink, setIncomingEmployeeLink] = useState(() => readEmployeeLinkFromLocation() || "");
  const [editingMemberId, setEditingMemberId] = useState("");
  const [editDraft, setEditDraft] = useState<ContactEditDraft | null>(null);
  const [employeeLinkCopyState, setEmployeeLinkCopyState] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setState(readStoredState(props.activeKernel, props.activeModel, props.activeWorkspaceRoot, props.kernelOptions));
  }, [props.activeKernel, props.activeModel, props.activeWorkspaceRoot, props.kernelOptions]);

  useEffect(() => {
    function syncFromStorage() {
      setState(readStoredState(props.activeKernel, props.activeModel, props.activeWorkspaceRoot, props.kernelOptions));
    }
    window.addEventListener("storage", syncFromStorage);
    window.addEventListener(ROOMS_STATE_EVENT, syncFromStorage);
    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener(ROOMS_STATE_EVENT, syncFromStorage);
    };
  }, [props.activeKernel, props.activeModel, props.activeWorkspaceRoot, props.kernelOptions]);

  useEffect(() => {
    if (selectedMemberId && state.members.some((member) => member.id === selectedMemberId)) return;
    setSelectedMemberId(state.members[0]?.id || "");
  }, [selectedMemberId, state.members]);

  useEffect(() => {
    setEmployeeLinkCopyState("");
  }, [selectedMemberId]);

  useEffect(() => {
    if (incomingEmployeeLink) setEmployeeDialogOpen(true);
  }, [incomingEmployeeLink]);

  const filteredMembers = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return state.members;
    return state.members.filter((member) => (
      member.name.toLowerCase().includes(value)
      || member.role.toLowerCase().includes(value)
      || member.kernel.toLowerCase().includes(value)
      || member.model.toLowerCase().includes(value)
      || roomMemberSourceLabel(member).toLowerCase().includes(value)
      || roomMemberSourceDetail(member).toLowerCase().includes(value)
    ));
  }, [query, state.members]);

  const groupRooms = useMemo(() => state.rooms.filter((room) => room.kind === "group"), [state.rooms]);
  const selectedMember = state.members.find((member) => member.id === selectedMemberId) ?? filteredMembers[0] ?? state.members[0];
  const selectedEmployeeLinkCode = selectedMember && selectedMember.source !== "human"
    ? employeeLinkCode(createEmployeeLink(selectedMember))
    : "";
  const editingSelectedMember = Boolean(selectedMember && editingMemberId === selectedMember.id && editDraft);
  const availableKernels = useMemo(() => selectableKernelOptions(props.kernelOptions, props.activeKernel), [props.activeKernel, props.kernelOptions]);
  const selectedDraftRuntimeControls = runtimeControlsForKernel(editDraft?.kernel || selectedMember?.kernel || "", props.runtimeControls, props.runtimeControlsByKernel);
  const selectedDraftModelOptions = useMemo(
    () => {
      const options = modelOptionsForKernel(editDraft?.kernel || selectedMember?.kernel || "", selectedDraftRuntimeControls);
      if (!editDraft?.model || options.some((option) => option.id === editDraft.model)) return options;
      return [{ id: editDraft.model, label: editDraft.model }, ...options];
    },
    [editDraft?.kernel, editDraft?.model, selectedDraftRuntimeControls, selectedMember?.kernel],
  );

  function persist(nextState: RoomsState) {
    const written = writeRoomsState(nextState, props.activeWorkspaceRoot);
    setState(written);
    return written;
  }

  function createEmployee(member: RoomMember) {
    const nextState = persist({
      ...state,
      members: state.members.some((item) => item.id === member.id) ? state.members : [...state.members, member],
    });
    setSelectedMemberId(member.id);
    clearIncomingEmployeeLink();
    return nextState;
  }

  function updateEmployeeDialogOpen(open: boolean) {
    setEmployeeDialogOpen(open);
    if (!open) clearIncomingEmployeeLink();
  }

  function clearIncomingEmployeeLink() {
    if (!incomingEmployeeLink) return;
    setIncomingEmployeeLink("");
    clearEmployeeLinkFromLocation();
  }

  function saveEmployee(member: RoomMember) {
    const nextRooms = state.rooms.map((room) => {
      const roomMessages = room.messages.map((message) => (
        message.senderId === member.id ? { ...message, senderName: member.name } : message
      ));
      return {
        ...room,
        title: room.directMemberId === member.id ? member.name : room.title,
        messages: roomMessages,
      };
    });
    persist({
      ...state,
      members: state.members.map((item) => (item.id === member.id ? member : item)),
      rooms: nextRooms,
    });
    setSelectedMemberId(member.id);
    setEditingMemberId("");
    setEditDraft(null);
  }

  function selectMember(memberId: string) {
    setSelectedMemberId(memberId);
    setEditingMemberId("");
    setEditDraft(null);
  }

  function startEditing(member: RoomMember) {
    setSelectedMemberId(member.id);
    setEditingMemberId(member.id);
    setEditDraft({
      name: member.name,
      role: member.role,
      kernel: member.kernel,
      model: member.model,
      avatarDataUrl: member.avatarDataUrl,
    });
  }

  function cancelEditing() {
    setEditingMemberId("");
    setEditDraft(null);
  }

  function updateDraftKernel(kernelId: string) {
    const options = modelOptionsForKernel(kernelId, runtimeControlsForKernel(kernelId, props.runtimeControls, props.runtimeControlsByKernel));
    setEditDraft((current) => current ? {
      ...current,
      kernel: kernelId,
      model: resolveDefaultModel(kernelId, props.activeKernel, props.activeModel, props.runtimeControls, props.runtimeControlsByKernel, options),
    } : current);
  }

  function saveInlineEmployee() {
    if (!selectedMember || !editDraft) return;
    const canEditRuntime = !selectedMember.source || selectedMember.source === "local";
    const nextMember: RoomMember = {
      ...selectedMember,
      name: editDraft.name.trim() || selectedMember.name,
      role: editDraft.role.trim() || "员工",
      kernel: canEditRuntime ? editDraft.kernel : selectedMember.kernel,
      model: canEditRuntime ? editDraft.model || selectedMember.model : selectedMember.model,
      color: canEditRuntime ? KERNEL_COLORS[editDraft.kernel] || selectedMember.color : selectedMember.color,
      avatarDataUrl: editDraft.avatarDataUrl,
    };
    saveEmployee(nextMember);
  }

  async function copyEmployeeLink(member: RoomMember) {
    const link = employeeLinkCode(createEmployeeLink(member));
    if (await writeClipboardText(link)) {
      setEmployeeLinkCopyState("已复制");
      return;
    }
    setEmployeeLinkCopyState("复制失败");
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setEditDraft((current) => current ? { ...current, avatarDataUrl: reader.result as string } : current);
      }
    };
    reader.readAsDataURL(file);
  }

  function openDirectMember(member: RoomMember) {
    const roomId = directRoomId(member.id);
    const existing = state.rooms.find((room) => room.id === roomId);
    const createdAt = nowIso();
    const nextRooms: Room[] = existing ? state.rooms : [
      {
        id: roomId,
        kind: "direct",
        title: member.name,
        badge: "私聊",
        memberIds: [member.id],
        directMemberId: member.id,
        pinned: false,
        unread: 0,
        updatedAt: createdAt,
        messages: [
          {
            id: createId("message"),
            senderId: "system",
            senderName: "系统",
            senderType: "system",
            text: `已进入和 ${member.name} 的私聊。这里发出的消息会默认交给这个 kernel。`,
            targetIds: [],
            status: "done",
            createdAt,
          },
        ],
      },
      ...state.rooms,
    ];
    persist({
      ...state,
      rooms: nextRooms.map((room) => room.id === roomId ? { ...room, updatedAt: room.updatedAt || createdAt } : room),
      activeRoomId: roomId,
    });
    props.onOpenRooms();
  }

  return (
    <section className="contacts-view" aria-label="通讯录">
      <aside className="contacts-nav-panel">
        <header className="contacts-nav-header">
          <h1>通讯录</h1>
          <button className="rooms-icon-button" type="button" onClick={() => setEmployeeDialogOpen(true)} aria-label="添加员工" title="添加员工">
            <ThemedPixelIcon pixelIcon="plus" professionalIcon={UserPlus} professionalSize={16} pixelSize={17} />
          </button>
        </header>
        <div className="contacts-org-card">
          <span className="contacts-org-icon" aria-hidden="true">#</span>
          <div>
            <strong>OpenGrove</strong>
            <small>{state.members.length} 位员工</small>
          </div>
        </div>
        <nav className="contacts-section-list" aria-label="通讯录分类">
          <button type="button" data-active={activeSection === "employees" ? "true" : "false"} onClick={() => setActiveSection("employees")}>
            <ThemedPixelIcon pixelIcon="user" professionalIcon={UserPlus} professionalSize={16} pixelSize={17} />
            <span>员工</span>
          </button>
          <button type="button" data-active={activeSection === "groups" ? "true" : "false"} onClick={() => setActiveSection("groups")}>
            <ThemedPixelIcon pixelIcon="rooms" professionalIcon={UsersRound} professionalSize={16} pixelSize={17} />
            <span>群聊</span>
          </button>
        </nav>
      </aside>

      <main className="contacts-main-panel">
        <header className="contacts-main-header">
          <div>
            <h2>{activeSection === "employees" ? "员工" : "群聊"}</h2>
            <p>{activeSection === "employees" ? "所有可以加入群聊、被 @ 调用的员工" : "当前已创建的群聊"}</p>
          </div>
        </header>

        {activeSection === "employees" ? (
          <div className="contacts-directory-layout">
            <section className="contacts-list-panel" aria-label="员工列表">
              <label className="contacts-search">
                <ThemedPixelIcon pixelIcon="search" professionalIcon={Search} professionalSize={15} pixelSize={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索员工、kernel 或人设" />
              </label>
              <div className="contacts-list">
                {filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    className="contacts-person-row"
                    data-active={selectedMember?.id === member.id ? "true" : "false"}
                    type="button"
                    onClick={() => selectMember(member.id)}
                  >
                    <RoomMemberAvatar member={member} />
                    <span>
                      <strong>{member.name}</strong>
                      <small>{roomMemberSourceLabel(member)} · {member.role}</small>
                    </span>
                  </button>
                ))}
                {!filteredMembers.length ? <div className="rooms-empty-row">没有匹配员工</div> : null}
              </div>
            </section>

            <aside className="contacts-detail-panel" aria-label="员工资料">
              {selectedMember ? (
                <>
                  <div className="contacts-detail-hero">
                    <div className={editingSelectedMember ? "contacts-avatar-editor" : undefined}>
                      <RoomMemberAvatar
                        member={editingSelectedMember && editDraft ? { ...selectedMember, ...editDraft } : selectedMember}
                      />
                      {editingSelectedMember ? (
                        <>
                          <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} aria-label="选择员工头像" />
                          <button type="button" onClick={() => avatarInputRef.current?.click()} aria-label="更新员工头像" title="更新员工头像">
                            <Camera size={14} />
                          </button>
                        </>
                      ) : null}
                    </div>
                    <div>
                      <h3>{editingSelectedMember && editDraft ? editDraft.name || selectedMember.name : selectedMember.name}</h3>
                      <p>{roomMemberSourceLabel(selectedMember)} · {editingSelectedMember && editDraft ? editDraft.role || "员工" : selectedMember.role}</p>
                    </div>
                    <div className="contacts-detail-actions">
                      {editingSelectedMember ? (
                        <>
                          <button className="contacts-message-button" type="button" onClick={cancelEditing}>
                            <X size={15} />
                            <span>取消</span>
                          </button>
                          <button className="contacts-message-button primary" type="button" onClick={saveInlineEmployee}>
                            <Check size={15} />
                            <span>保存</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="contacts-message-button" type="button" onClick={() => startEditing(selectedMember)}>
                            <ThemedPixelIcon pixelIcon="settings" professionalIcon={Pencil} professionalSize={16} pixelSize={17} />
                            <span>编辑资料</span>
                          </button>
                          <button className="contacts-message-button" type="button" onClick={() => openDirectMember(selectedMember)}>
                            <ThemedPixelIcon pixelIcon="chat" professionalIcon={MessageCircle} professionalSize={16} pixelSize={17} />
                            <span>发消息</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <dl className="contacts-detail-list">
                    <div>
                      <dt>来源</dt>
                      <dd>{roomMemberSourceLabel(selectedMember)} · {roomMemberSourceDetail(selectedMember)}</dd>
                    </div>
                    <div>
                      <dt>显示名称</dt>
                      <dd>{editingSelectedMember && editDraft ? (
                        <input
                          className="contacts-detail-control"
                          value={editDraft.name}
                          onChange={(event) => setEditDraft((current) => current ? { ...current, name: event.target.value } : current)}
                        />
                      ) : selectedMember.name}</dd>
                    </div>
                    <div>
                      <dt>人设 / 描述</dt>
                      <dd>{editingSelectedMember && editDraft ? (
                        <textarea
                          className="contacts-detail-control contacts-detail-textarea"
                          value={editDraft.role}
                          onChange={(event) => setEditDraft((current) => current ? { ...current, role: event.target.value } : current)}
                          rows={3}
                        />
                      ) : selectedMember.role}</dd>
                    </div>
                    <div>
                      <dt>Kernel</dt>
                      <dd>{editingSelectedMember && editDraft && (!selectedMember.source || selectedMember.source === "local") ? (
                        <RoomInlineSelect
                          value={editDraft.kernel}
                          options={availableKernels.map((kernel) => ({
                            id: kernel.id,
                            label: kernel.label || kernel.id,
                            icon: <KernelIcon kernelId={kernel.id} size={18} />,
                          }))}
                          onChange={updateDraftKernel}
                        />
                      ) : (
                        <>
                          <KernelIcon kernelId={selectedMember.kernel} size={18} />
                          <span>{selectedMember.kernel}</span>
                        </>
                      )}</dd>
                    </div>
                    <div>
                      <dt>模型 / 版本</dt>
                      <dd>{editingSelectedMember && editDraft && (!selectedMember.source || selectedMember.source === "local") ? (
                        <RoomInlineSelect
                          value={editDraft.model}
                          options={selectedDraftModelOptions.map((option) => ({ id: option.id, label: modelLabel(option) }))}
                          onChange={(model) => setEditDraft((current) => current ? { ...current, model } : current)}
                        />
                      ) : memberModelLabel(selectedMember)}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>{statusLabel(selectedMember.status)}</dd>
                    </div>
                    <div>
                      <dt>最近活跃</dt>
                      <dd>{selectedMember.lastActive}</dd>
                    </div>
                    <div>
                      <dt>员工 ID</dt>
                      <dd>{selectedMember.id}</dd>
                    </div>
                    {selectedMember.source !== "human" ? (
                      <div>
                        <dt>员工链接</dt>
                        <dd>
                          <button
                            className="contacts-message-button"
                            type="button"
                            onClick={() => void copyEmployeeLink(selectedMember)}
                            title={selectedEmployeeLinkCode}
                          >
                            <Copy size={15} />
                            <span>{employeeLinkCopyState || employeeLinkPreview(selectedEmployeeLinkCode)}</span>
                          </button>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              ) : (
                <div className="rooms-empty-row">选择一个员工查看资料</div>
              )}
            </aside>
          </div>
        ) : (
          <section className="contacts-group-list" aria-label="群聊">
            {groupRooms.map((room) => (
              <div className="contacts-group-row" key={room.id}>
                <span className="contacts-group-icon" aria-hidden="true">
                  <ThemedPixelIcon pixelIcon="rooms" professionalIcon={UsersRound} professionalSize={18} pixelSize={18} />
                </span>
                <div>
                  <strong>{room.title}</strong>
                  <small>{room.memberIds.length} 位员工 · {room.badge}</small>
                </div>
              </div>
            ))}
            {!groupRooms.length ? <div className="rooms-empty-row">还没有群聊</div> : null}
          </section>
        )}
      </main>

      <EmployeeDialog
        open={employeeDialogOpen}
        activeKernel={props.activeKernel}
        activeModel={props.activeModel}
        runtimeControls={props.runtimeControls}
        runtimeControlsByKernel={props.runtimeControlsByKernel}
        kernelOptions={props.kernelOptions}
        initialEmployeeLink={incomingEmployeeLink}
        onOpenChange={updateEmployeeDialogOpen}
        onCreate={createEmployee}
      />
    </section>
  );
}

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function resolveDefaultModel(
  kernelId: string,
  activeKernel: string | undefined,
  activeModel: ModelId,
  runtimeControls: RuntimeControls | undefined,
  runtimeControlsByKernel: Record<string, RuntimeControls> | undefined,
  options = modelOptionsForKernel(kernelId, runtimeControlsForKernel(kernelId, runtimeControls, runtimeControlsByKernel)),
): string {
  return resolveDefaultModelForKernel({
    kernelId,
    activeKernel,
    activeModel,
    runtimeControls,
    runtimeControlsByKernel,
    options,
  });
}
