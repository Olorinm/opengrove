import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Camera, Check, MessageCircle, Pencil, Search, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import type { KernelOption, ModelId, RuntimeControls } from "../../bridge";
import { modelLabel, modelOptionsForKernel, resolveDefaultModelForKernel, runtimeControlsForKernel } from "../../runtime/kernel-models";
import { ThemedPixelIcon } from "../sidebar/app-navigation";
import { KernelIcon } from "../ui/entity-icons";
import { EmployeeDialog } from "./employee-dialog";
import { RoomMemberAvatar } from "./member-avatar";
import { createRemoteRoomInvite, type RemoteRoomInviteResult } from "./room-invites";
import {
  createServerRoom,
  fetchRoomsInit,
  mergeRoomsFromServerSnapshot,
  openServerDirectRoom,
  patchServerRoomMember,
  upsertServerRoomMember,
} from "./rooms-api";
import { RoomInlineSelect } from "./room-inline-select";
import {
  KERNEL_COLORS,
  createId,
  directRoomId,
  memberModelLabel,
  nowIso,
  roomMemberSourceDetail,
  roomMemberSourceLabel,
  roomMemberStatusLabel,
  selectableKernelOptions,
  type Room,
  type RoomMember,
  type RoomsState,
} from "./rooms-model";

type ContactEditDraft = {
  name: string;
  role: string;
  kernel: string;
  model: string;
  avatarDataUrl?: string;
};

const CONTACT_INVITE_ROOM_TITLE = "远程员工邀请";

export function ContactsView(props: {
  activeKernel?: string;
  activeModel: ModelId;
  activeWorkspaceRoot: string;
  kernelOptions: KernelOption[];
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  onOpenRooms(): void;
}) {
  const [state, setState] = useState<RoomsState>({ rooms: [], members: [], activeRoomId: "", deletedMemberIds: [] });
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<"employees" | "groups">("employees");
  const [selectedMemberId, setSelectedMemberId] = useState(state.members[0]?.id || "");
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState("");
  const [editDraft, setEditDraft] = useState<ContactEditDraft | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refreshFromLedger() {
      try {
        const snapshot = await fetchRoomsInit();
        if (cancelled || !snapshot.ok) return;
        setState((current) => {
          const merged = mergeRoomsFromServerSnapshot(current.rooms, current.members, current.deletedMemberIds ?? [], snapshot);
          const activeRoomId = merged.rooms.some((room) => room.id === current.activeRoomId)
            ? current.activeRoomId
            : merged.rooms[0]?.id ?? "";
          return {
            ...merged,
            activeRoomId,
          };
        });
      } catch {
        // Contacts remains editable in-memory until the bridge is available again.
      }
    }
    void refreshFromLedger();
    const interval = window.setInterval(() => void refreshFromLedger(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const deletedMembers = new Set(state.deletedMemberIds ?? []);
    if (selectedMemberId && state.members.some((member) => member.id === selectedMemberId && !deletedMembers.has(member.id) && !member.disabled)) return;
    setSelectedMemberId(state.members.find((member) => !deletedMembers.has(member.id) && !member.disabled)?.id || "");
  }, [selectedMemberId, state.deletedMemberIds, state.members]);

  const contactMembers = useMemo(() => {
    const deletedMembers = new Set(state.deletedMemberIds ?? []);
    return state.members.filter((member) => !deletedMembers.has(member.id) && !member.disabled);
  }, [state.deletedMemberIds, state.members]);

  const filteredMembers = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return contactMembers;
    return contactMembers.filter((member) => (
      member.name.toLowerCase().includes(value)
      || member.role.toLowerCase().includes(value)
      || member.kernel.toLowerCase().includes(value)
      || member.model.toLowerCase().includes(value)
      || roomMemberSourceLabel(member).toLowerCase().includes(value)
      || roomMemberSourceDetail(member).toLowerCase().includes(value)
    ));
  }, [contactMembers, query]);

  const groupRooms = useMemo(() => state.rooms.filter((room) => room.kind === "group"), [state.rooms]);
  const selectedMember = contactMembers.find((member) => member.id === selectedMemberId) ?? filteredMembers[0] ?? contactMembers[0];
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
    setState(nextState);
    return nextState;
  }

  function createEmployee(member: RoomMember) {
    const restoredMember: RoomMember = {
      ...member,
      disabled: false,
      status: member.status === "offline" ? "idle" : member.status,
      lastActive: "刚刚",
    };
    const nextState = persist({
      ...state,
      members: state.members.some((item) => item.id === restoredMember.id)
        ? state.members.map((item) => (item.id === restoredMember.id ? { ...item, ...restoredMember } : item))
        : [...state.members, restoredMember],
      deletedMemberIds: (state.deletedMemberIds ?? []).filter((memberId) => memberId !== restoredMember.id),
    });
    setSelectedMemberId(restoredMember.id);
    void upsertServerRoomMember(restoredMember).catch(() => undefined);
    return nextState;
  }

  async function createRemoteInviteLink(): Promise<RemoteRoomInviteResult | null> {
    const localMember = selectedMember ?? contactMembers[0];
    if (!localMember) {
      throw new Error("请先添加一个本机员工，再邀请外部员工加入。");
    }
    const existingRoom = state.rooms.find((room) => (
      room.kind === "group"
      && room.title === CONTACT_INVITE_ROOM_TITLE
      && room.matrix?.mode === "host"
    ));
    const createdAt = nowIso();
    const roomForInvite: Room = existingRoom ?? {
      id: createId("room"),
      kind: "group",
      title: CONTACT_INVITE_ROOM_TITLE,
      badge: "Matrix",
      memberIds: [localMember.id],
      pinned: false,
      unread: 0,
      updatedAt: createdAt,
      messages: [],
    };
    if (!existingRoom) {
      await createServerRoom(roomForInvite);
    }
    const result = await createRemoteRoomInvite(roomForInvite);
    if (!result.invite.matrixHomeserverUrl || !result.invite.matrixRoomId) {
      throw new Error("matrix_invite_missing_room");
    }
    const nextRoom: Room = {
      ...roomForInvite,
      badge: "Matrix",
      memberIds: roomForInvite.memberIds.includes(localMember.id)
        ? roomForInvite.memberIds
        : [localMember.id, ...roomForInvite.memberIds],
      matrix: {
        homeserverUrl: result.invite.matrixHomeserverUrl,
        roomId: result.invite.matrixRoomId,
        localMemberId: localMember.id,
        mode: "host",
      },
      messages: roomForInvite.messages,
      updatedAt: nowIso(),
    };
    persist({
      ...state,
      rooms: existingRoom
        ? state.rooms.map((room) => (room.id === existingRoom.id ? nextRoom : room))
        : [nextRoom, ...state.rooms],
      activeRoomId: state.activeRoomId || nextRoom.id,
    });
    return result;
  }

  function updateEmployeeDialogOpen(open: boolean) {
    setEmployeeDialogOpen(open);
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
    void upsertServerRoomMember(member).catch(() => undefined);
    setSelectedMemberId(member.id);
    setEditingMemberId("");
    setEditDraft(null);
  }

  function deleteEmployee(member: RoomMember) {
    const nextState: RoomsState = {
      ...state,
      members: state.members.map((item) => (item.id === member.id ? {
        ...item,
        disabled: true,
        status: "offline" as const,
        lastActive: "已移除",
      } : item)),
      deletedMemberIds: Array.from(new Set([...(state.deletedMemberIds ?? []), member.id])),
    };
    const writtenState = persist(nextState);
    void patchServerRoomMember(member.id, {
      disabled: true,
      status: "offline",
      lastActive: "已移除",
    }).catch(() => undefined);
    const nextDeletedMembers = new Set(writtenState.deletedMemberIds ?? []);
    const nextSelectedId = writtenState.members.find((item) => !nextDeletedMembers.has(item.id) && !item.disabled)?.id || "";
    setSelectedMemberId(nextSelectedId);
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
    void openServerDirectRoom(member.id, member.name).catch(() => undefined);
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
            <small>{contactMembers.length} 位员工</small>
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
                          <button className="contacts-message-button danger" type="button" onClick={() => deleteEmployee(selectedMember)}>
                            <Trash2 size={15} />
                            <span>删除</span>
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
                      <dd>{roomMemberStatusLabel(selectedMember)}</dd>
                    </div>
                    <div>
                      <dt>最近活跃</dt>
                      <dd>{selectedMember.lastActive}</dd>
                    </div>
                    <div>
                      <dt>员工 ID</dt>
                      <dd>{selectedMember.id}</dd>
                    </div>
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
        allowRemoteInvite
        onOpenChange={updateEmployeeDialogOpen}
        onCreate={createEmployee}
        onCreateRemoteInvite={createRemoteInviteLink}
      />
    </section>
  );
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
