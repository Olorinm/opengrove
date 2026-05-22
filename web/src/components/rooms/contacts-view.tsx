import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import {
  Activity,
  BookOpen,
  Camera,
  Check,
  Cpu,
  FileText,
  MessageCircle,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import type { ExtensionInventoryRecord, KernelOption, ModelId, RuntimeControls, SkillRecord } from "../../bridge";
import { modelLabel, modelOptionsForKernel, resolveDefaultModelForKernel, runtimeControlsForKernel } from "../../runtime/kernel-models";
import { MarkdownCodeEditor } from "../knowledge/markdown-code-editor";
import { MarkdownPreview } from "../knowledge/markdown-preview";
import { ThemedPixelIcon } from "../sidebar/app-navigation";
import { KernelIcon } from "../ui/entity-icons";
import { EmployeeDialog } from "./employee-dialog";
import { RoomMemberAvatar } from "./member-avatar";
import { RoomInlineSelect } from "./room-inline-select";
import { createRemoteRoomInvite, type RemoteRoomInviteResult } from "./room-invites";
import {
  buildContactSkillOptions,
  buildMemberActivitySnapshot,
  contactKernelSubline,
  defaultSkillIdsForKernel,
  effectiveMemberSkillIds,
  employeeTagLabel,
  emptyMemberActivitySnapshot,
  formatSkillPublishStatus,
  normalizeSkillIds,
  publishSelectedSkillsToKernel,
  type ContactEditDraft,
  type ContactSkillOption,
  type EmployeeConsoleTab,
} from "./contacts-model";
import {
  createServerRoom,
  fetchRoomsInit,
  mergeRoomsFromServerSnapshot,
  openServerDirectRoom,
  patchServerRoomMember,
  upsertServerRoomMember,
} from "./rooms-api";
import {
  KERNEL_COLORS,
  createId,
  directRoomId,
  memberModelLabel,
  normalizeRoomMemberModelForKernel,
  nowIso,
  roomMemberSourceDetail,
  roomMemberSourceLabel,
  roomMemberStatusLabel,
  selectableKernelOptions,
  type Room,
  type RoomMember,
  type RoomsState,
} from "./rooms-model";

const CONTACT_INVITE_ROOM_TITLE = "远程员工邀请";

export function ContactsView(props: {
  activeKernel?: string;
  activeModel: ModelId;
  activeWorkspaceRoot: string;
  extensions?: ExtensionInventoryRecord;
  kernelOptions: KernelOption[];
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  skills?: SkillRecord[];
  onOpenMessages(roomId?: string): void;
}) {
  const [state, setState] = useState<RoomsState>({ rooms: [], members: [], activeRoomId: "", deletedMemberIds: [] });
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<"employees" | "groups">("employees");
  const [selectedMemberId, setSelectedMemberId] = useState(state.members[0]?.id || "");
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState("");
  const [editDraft, setEditDraft] = useState<ContactEditDraft | null>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillPublishStatus, setSkillPublishStatus] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [employeeTab, setEmployeeTab] = useState<EmployeeConsoleTab>("activity");
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
  const canEditSelectedRuntime = Boolean(selectedMember && (!selectedMember.source || selectedMember.source === "local"));
  const availableKernels = useMemo(() => selectableKernelOptions(props.kernelOptions, props.activeKernel), [props.activeKernel, props.kernelOptions]);
  const draftKernelId = editingSelectedMember && editDraft ? editDraft.kernel : selectedMember?.kernel ?? "";
  const selectedKernelOption = availableKernels.find((kernel) => kernel.id === draftKernelId);
  const selectedRuntimeControls = runtimeControlsForKernel(draftKernelId, props.runtimeControls, props.runtimeControlsByKernel);
  const kernelModelOptions = useMemo(
    () => modelOptionsForKernel(draftKernelId, selectedRuntimeControls),
    [draftKernelId, selectedRuntimeControls],
  );
  const skillOptions = useMemo(
    () => buildContactSkillOptions(props.skills ?? [], props.extensions),
    [props.extensions, props.skills],
  );
  const skillOptionsById = useMemo(
    () => new Map(skillOptions.map((skill) => [skill.id, skill])),
    [skillOptions],
  );
  const selectedEffectiveSkillIds = useMemo(
    () => selectedMember ? effectiveMemberSkillIds(selectedMember, skillOptions) : [],
    [selectedMember, skillOptions],
  );
  const selectedEffectiveSkills = useMemo(
    () => selectedEffectiveSkillIds.map((skillId) => skillOptionsById.get(skillId)).filter((skill): skill is ContactSkillOption => Boolean(skill)),
    [selectedEffectiveSkillIds, skillOptionsById],
  );
  const selectedActivity = useMemo(
    () => selectedMember ? buildMemberActivitySnapshot(selectedMember, state.rooms) : emptyMemberActivitySnapshot(),
    [selectedMember, state.rooms],
  );
  const employeeTabs: Array<{ id: EmployeeConsoleTab; label: string; icon: typeof Activity }> = [
    { id: "activity", label: "动态", icon: Activity },
    { id: "identity", label: "身份", icon: FileText },
    { id: "kernel", label: "内核", icon: Cpu },
    { id: "skills", label: "skill", icon: BookOpen },
  ];
  const filteredSkillOptions = useMemo(() => {
    const value = skillQuery.trim().toLowerCase();
    if (!value) return skillOptions;
    return skillOptions.filter((skill) => (
      skill.name.toLowerCase().includes(value)
      || skill.title.toLowerCase().includes(value)
      || skill.description.toLowerCase().includes(value)
      || skill.sourceLabel.toLowerCase().includes(value)
    ));
  }, [skillOptions, skillQuery]);

  function persist(nextState: RoomsState) {
    setState(nextState);
    return nextState;
  }

  function createEmployee(member: RoomMember) {
    const restoredMember: RoomMember = {
      ...member,
      defaultSkillIds: member.defaultSkillIds?.length ? member.defaultSkillIds : defaultSkillIdsForKernel(member.kernel, skillOptions),
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
      && room.remote?.provider === "matrix"
      && room.remote.mode === "host"
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
      remote: {
        provider: "matrix",
        accountId: "default",
        remoteRoomId: result.invite.matrixRoomId,
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
    setActiveSection("employees");
    setEditingMemberId("");
    setEditDraft(null);
    setSkillQuery("");
    setSkillPublishStatus("");
  }

  function startEditing(member: RoomMember, tab: EmployeeConsoleTab = "identity") {
    setSelectedMemberId(member.id);
    setEditingMemberId(member.id);
    setSkillQuery("");
    setSkillPublishStatus("");
    setEmployeeTab(tab);
    setEditDraft({
      name: member.name,
      role: member.role,
      kernel: member.kernel,
      model: normalizeRoomMemberModelForKernel(member.kernel, member.model),
      defaultSkillIds: effectiveMemberSkillIds(member, skillOptions),
      avatarDataUrl: member.avatarDataUrl,
    });
  }

  function beginEditingSelected(tab: EmployeeConsoleTab) {
    if (!selectedMember) return;
    if (editingSelectedMember) {
      setEmployeeTab(tab);
      return;
    }
    startEditing(selectedMember, tab);
  }

  function handleEditableKey(event: KeyboardEvent<HTMLElement>, tab: EmployeeConsoleTab) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    beginEditingSelected(tab);
  }

  function cancelEditing() {
    setEditingMemberId("");
    setEditDraft(null);
  }

  function setDraftSkillIds(defaultSkillIds: string[]) {
    setEditDraft((current) => current ? { ...current, defaultSkillIds: normalizeSkillIds(defaultSkillIds) } : current);
  }

  function updateDraftKernel(kernelId: string) {
    const kernel = availableKernels.find((item) => item.id === kernelId);
    setEditDraft((current) => current ? {
      ...current,
      kernel: kernelId,
      model: resolveDefaultModelForKernel({
        kernelId,
        activeKernel: props.activeKernel,
        activeModel: props.activeModel,
        runtimeControls: props.runtimeControls,
        runtimeControlsByKernel: props.runtimeControlsByKernel,
      }),
      role: current.role.trim() ? current.role : kernel?.description || current.role,
    } : current);
  }

  function toggleDraftSkill(skillId: string) {
    setEditDraft((current) => {
      if (!current) return current;
      const next = current.defaultSkillIds.includes(skillId)
        ? current.defaultSkillIds.filter((id) => id !== skillId)
        : [...current.defaultSkillIds, skillId];
      return { ...current, defaultSkillIds: normalizeSkillIds(next) };
    });
  }

  function removeDefaultSkill(member: RoomMember, skillId: string) {
    if (savingProfile || (member.source && member.source !== "local")) return;
    const nextSkillIds = effectiveMemberSkillIds(member, skillOptions).filter((id) => id !== skillId);
    const nextMember: RoomMember = {
      ...member,
      defaultSkillIds: normalizeSkillIds(nextSkillIds),
    };
    saveEmployee(nextMember);
    setEmployeeTab("skills");
    setSkillPublishStatus("已从该员工默认 skill 中移除");
  }

  async function saveInlineEmployee() {
    if (!selectedMember || !editDraft || savingProfile) return;
    const canEditRuntime = !selectedMember.source || selectedMember.source === "local";
    const nextMember: RoomMember = {
      ...selectedMember,
      name: editDraft.name.trim() || selectedMember.name,
      role: editDraft.role.trim() || "员工",
      kernel: canEditRuntime ? editDraft.kernel : selectedMember.kernel,
      model: canEditRuntime
        ? normalizeRoomMemberModelForKernel(editDraft.kernel, editDraft.model || selectedMember.model)
        : selectedMember.model,
      color: canEditRuntime ? KERNEL_COLORS[editDraft.kernel] || selectedMember.color : selectedMember.color,
      defaultSkillIds: canEditRuntime ? normalizeSkillIds(editDraft.defaultSkillIds) : selectedMember.defaultSkillIds,
      avatarDataUrl: editDraft.avatarDataUrl,
    };
    setSavingProfile(true);
    setSkillPublishStatus("");
    try {
      saveEmployee(nextMember);
      if (canEditRuntime) {
        const result = await publishSelectedSkillsToKernel(nextMember, skillOptions, availableKernels.map((kernel) => kernel.id));
        setSkillPublishStatus(formatSkillPublishStatus(result));
      } else {
        setSkillPublishStatus("已保存");
      }
    } catch (error) {
      setSkillPublishStatus(`资料已保存，Skill 发布失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingProfile(false);
    }
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
    props.onOpenMessages(roomId);
  }

  return (
    <section className="contacts-view" aria-label="通讯录">
      <aside className="contacts-nav-panel">
        <header className="contacts-nav-header">
          <h1>消息</h1>
          <button className="rooms-icon-button" type="button" onClick={() => setEmployeeDialogOpen(true)} aria-label="添加员工" title="添加员工">
            <ThemedPixelIcon pixelIcon="plus" professionalIcon={UserPlus} professionalSize={16} pixelSize={17} />
          </button>
        </header>
        <nav className="collaboration-switch" aria-label="消息视图">
          <button type="button" onClick={() => props.onOpenMessages()}>
            对话
          </button>
          <button type="button" data-active="true">
            通讯录
          </button>
        </nav>
        <div className="rooms-search-wrap contacts-nav-search-wrap" data-open={query.trim() ? "true" : "false"}>
          <label className="rooms-search contacts-nav-search">
            <ThemedPixelIcon pixelIcon="search" professionalIcon={Search} professionalSize={14} pixelSize={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索员工或 kernel" />
            {query.trim() ? (
              <button className="rooms-search-clear" type="button" onClick={() => setQuery("")} aria-label="清空搜索" title="清空搜索">
                <X size={15} />
              </button>
            ) : null}
          </label>
        </div>
        <section className="contacts-sidebar-directory" aria-label="员工列表">
          <div className="rooms-section-label contacts-nav-section-label">
            <span>员工</span>
            <small>{contactMembers.length} 个员工</small>
          </div>
          <div className="contacts-list contacts-sidebar-member-list">
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
      </aside>

      <main className="contacts-main-panel">
        {activeSection === "employees" ? (
          <div className="contacts-detail-layout">
            <section className="contacts-detail-panel contacts-employee-detail" aria-label="员工资料">
              {selectedMember ? (
                <>
                  <div className="contacts-employee-body">
                    <section className="contacts-employee-summary" aria-label="员工概览">
                      <div className={editingSelectedMember ? "contacts-avatar-editor contacts-employee-avatar" : "contacts-employee-avatar"}>
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
                      <div className="contacts-employee-title">
                        <h3>{editingSelectedMember && editDraft ? editDraft.name || selectedMember.name : selectedMember.name}</h3>
                        <div className="contacts-employee-tags">
                          <span className="contacts-employee-tag">{roomMemberSourceLabel(selectedMember)}</span>
                          <span className="contacts-employee-tag">{employeeTagLabel(editingSelectedMember && editDraft ? editDraft.role : selectedMember.role, "暂无身份")}</span>
                          <span className="contacts-status-pill" data-status={selectedMember.status}>
                            <i aria-hidden="true" />
                            {roomMemberStatusLabel(selectedMember)}
                          </span>
                          <span className="contacts-employee-tag muted">ID {selectedMember.id}</span>
                        </div>
                      </div>
                      <div className="contacts-detail-actions contacts-summary-actions">
                        {editingSelectedMember ? (
                          <>
                            <button className="contacts-message-button" type="button" onClick={cancelEditing} disabled={savingProfile}>
                              <X size={15} />
                              <span>取消</span>
                            </button>
                            <button className="contacts-message-button primary" type="button" onClick={() => void saveInlineEmployee()} disabled={savingProfile}>
                              <Check size={15} />
                              <span>{savingProfile ? "保存中" : "保存"}</span>
                            </button>
                          </>
                        ) : (
                          <>
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
                      {skillPublishStatus ? <div className="contacts-save-status">{skillPublishStatus}</div> : null}
                    </section>

                    <div className="contacts-employee-console">
                      <nav className="contacts-console-tabs" aria-label="员工配置">
                        {employeeTabs.map((tab) => {
                          const Icon = tab.icon;
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              data-active={employeeTab === tab.id ? "true" : "false"}
                              onClick={() => setEmployeeTab(tab.id)}
                            >
                              <Icon size={17} />
                              <span>{tab.label}</span>
                            </button>
                          );
                        })}
                      </nav>

                      <div className="contacts-console-body">
                        {employeeTab === "activity" ? (
                          <section className="contacts-console-section" aria-label="员工动态">
                            <div className="contacts-activity-card quiet">
                              <strong>当前</strong>
                              <span>{selectedActivity.currentWork || "无进行中的工作"}</span>
                              <p>{selectedMember.status === "running" ? "这个员工正在处理任务。" : "这个员工当前没有进行中的工作。"}</p>
                            </div>
                            <div className="contacts-activity-card metric">
                              <span>近 30 天表现</span>
                              <strong>{selectedActivity.totalRuns}</strong>
                              <p>{selectedActivity.successRate}% 成功 · 平均 {selectedActivity.averageDuration || "-"} · {selectedActivity.failedRuns} 次失败</p>
                            </div>
                            <div className="contacts-activity-card">
                              <strong>最近活动</strong>
                              {selectedActivity.recentRuns.length ? (
                                <div className="contacts-recent-run-list">
                                  {selectedActivity.recentRuns.map((run) => (
                                    <div key={run.id} className="contacts-recent-run" data-status={run.status}>
                                      <span>{run.status === "failed" ? "×" : "✓"}</span>
                                      <div>
                                        <strong>{run.title}</strong>
                                        <small>{run.createdAt} · {run.duration || "未知耗时"} · {run.statusLabel}</small>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p>还没有这个员工的运行记录。</p>
                              )}
                            </div>
                          </section>
                        ) : null}

                        {employeeTab === "identity" ? (
                          <section className="contacts-console-section contacts-persona-section" aria-label="员工身份">
                            <div className="contacts-section-heading">
                              <div>
                                <h3>身份</h3>
                                <p>定义这个员工的人设、职责边界、工作风格和默认判断标准。支持 Markdown。</p>
                              </div>
                              {editingSelectedMember ? <span>Markdown</span> : null}
                            </div>
                            {editingSelectedMember && editDraft ? (
                              <div className="contacts-persona-editor console">
                                <MarkdownCodeEditor
                                  value={editDraft.role}
                                  format="markdown"
                                  onChange={(role) => setEditDraft((current) => current ? { ...current, role } : current)}
                                  placeholder="写下这个员工的职责、边界、判断标准和回复风格"
                                />
                              </div>
                            ) : selectedMember.role.trim() ? (
                              <div
                                className="contacts-persona-preview contacts-editable-panel console"
                                role="button"
                                tabIndex={0}
                                onClick={() => beginEditingSelected("identity")}
                                onKeyDown={(event) => handleEditableKey(event, "identity")}
                              >
                                <MarkdownPreview text={selectedMember.role} format="markdown" />
                              </div>
                            ) : (
                              <div
                                className="contacts-empty-console contacts-editable-panel"
                                role="button"
                                tabIndex={0}
                                onClick={() => beginEditingSelected("identity")}
                                onKeyDown={(event) => handleEditableKey(event, "identity")}
                              >
                                暂无身份。点击这里写入 Markdown 人设。
                              </div>
                            )}
                          </section>
                        ) : null}

                        {employeeTab === "kernel" ? (
                          <section className="contacts-console-section contacts-kernel-section" aria-label="员工内核">
                            <div className="contacts-console-action-row">
                              <div>
                                <h3>内核</h3>
                                <p>设置这个员工默认使用的执行内核和模型。保存后会同步默认 skill 到新内核。</p>
                              </div>
                              {!editingSelectedMember && canEditSelectedRuntime ? (
                                <button type="button" onClick={() => startEditing(selectedMember, "kernel")}>
                                  <Cpu size={16} />
                                  编辑内核
                                </button>
                              ) : null}
                            </div>
                            {editingSelectedMember && editDraft && canEditSelectedRuntime ? (
                              <div className="contacts-kernel-editor">
                                <div className="contacts-kernel-option-grid" aria-label="选择内核">
                                  {availableKernels.map((kernel) => (
                                    <button
                                      key={kernel.id}
                                      className="contacts-kernel-option"
                                      data-active={kernel.id === editDraft.kernel ? "true" : "false"}
                                      data-ready={kernel.available || kernel.installed ? "true" : "false"}
                                      type="button"
                                      onClick={() => updateDraftKernel(kernel.id)}
                                      title={kernel.reason || kernel.providerLabel || kernel.version || kernel.id}
                                    >
                                      <span className="contacts-kernel-option-icon" aria-hidden="true">
                                        <KernelIcon kernelId={kernel.id} size={17} />
                                      </span>
                                      <span>
                                        <strong>{kernel.label || kernel.id}</strong>
                                        <small>{contactKernelSubline(kernel)}</small>
                                      </span>
                                    </button>
                                  ))}
                                  {!availableKernels.length ? <div className="rooms-empty-row">没有可选内核</div> : null}
                                </div>
                                <label className="contacts-kernel-model-field">
                                  <span>模型</span>
                                  <RoomInlineSelect
                                    value={editDraft.model}
                                    options={kernelModelOptions.map((option) => ({ id: option.id, label: modelLabel(option) }))}
                                    onChange={(model) => setEditDraft((current) => current ? { ...current, model } : current)}
                                  />
                                </label>
                              </div>
                            ) : canEditSelectedRuntime ? (
                              <button
                                className="contacts-kernel-readout contacts-editable-panel"
                                type="button"
                                onClick={() => beginEditingSelected("kernel")}
                              >
                                <KernelIcon kernelId={selectedMember.kernel} size={20} />
                                <span>
                                  <strong>{selectedKernelOption?.label || selectedMember.kernel}</strong>
                                  <small>{memberModelLabel(selectedMember)}</small>
                                </span>
                              </button>
                            ) : (
                              <div className="contacts-kernel-readout">
                                <KernelIcon kernelId={selectedMember.kernel} size={20} />
                                <span>
                                  <strong>{selectedKernelOption?.label || selectedMember.kernel}</strong>
                                  <small>{memberModelLabel(selectedMember)}</small>
                                </span>
                              </div>
                            )}
                          </section>
                        ) : null}

                        {employeeTab === "skills" ? (
                          <section className="contacts-console-section contacts-skill-section" aria-label="员工 skill">
                            <div className="contacts-console-action-row">
                              <div>
                                <h3>Skill</h3>
                                <p>分配给该员工的默认 skill。保存后会发布到这个员工使用的内核。</p>
                              </div>
                              {!editingSelectedMember ? (
                                <button type="button" onClick={() => startEditing(selectedMember, "skills")}>
                                  <UserPlus size={16} />
                                  管理 skill
                                </button>
                              ) : null}
                            </div>
                            {editingSelectedMember && editDraft && canEditSelectedRuntime ? (
                              <>
                                <div className="contacts-skill-toolbar">
                                  <label className="contacts-skill-search">
                                    <Search size={14} />
                                    <input
                                      value={skillQuery}
                                      onChange={(event) => setSkillQuery(event.target.value)}
                                      placeholder="搜索 skill"
                                    />
                                  </label>
                                  <button type="button" onClick={() => setDraftSkillIds(defaultSkillIdsForKernel(editDraft.kernel, skillOptions))}>
                                    <RotateCcw size={14} />
                                    <span>当前内核</span>
                                  </button>
                                  <button type="button" onClick={() => setDraftSkillIds(skillOptions.map((skill) => skill.id))}>
                                    <Check size={14} />
                                    <span>全选</span>
                                  </button>
                                  <button type="button" onClick={() => setDraftSkillIds([])}>
                                    <X size={14} />
                                    <span>清空</span>
                                  </button>
                                </div>
                                <div className="contacts-skill-picker" role="listbox" aria-label="选择默认 skill">
                                  {filteredSkillOptions.map((skill) => {
                                    const checked = editDraft.defaultSkillIds.includes(skill.id);
                                    const published = skill.publishedKernelIds.includes(editDraft.kernel);
                                    return (
                                      <label className="contacts-skill-option" data-selected={checked ? "true" : "false"} key={skill.id}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => toggleDraftSkill(skill.id)}
                                        />
                                        <span className="contacts-skill-check" aria-hidden="true">
                                          {checked ? <Check size={12} /> : null}
                                        </span>
                                        <span className="contacts-skill-copy">
                                          <strong>{skill.title || skill.name}</strong>
                                          <small>{skill.description || `/${skill.name}`}</small>
                                        </span>
                                        <span className="contacts-skill-tags">
                                          <em>{skill.sourceLabel}</em>
                                          <em data-published={published ? "true" : "false"}>{published ? "已发布" : "待发布"}</em>
                                        </span>
                                      </label>
                                    );
                                  })}
                                  {!filteredSkillOptions.length ? <div className="rooms-empty-row">没有可选 skill</div> : null}
                                </div>
                              </>
                            ) : selectedEffectiveSkills.length ? (
                              <div className="contacts-skill-card-list">
                                {selectedEffectiveSkills.map((skill) => (
                                  <div className="contacts-skill-card" key={skill.id}>
                                    <BookOpen size={18} />
                                    <div>
                                      <strong>{skill.title || skill.name}</strong>
                                      <small>{skill.description || `/${skill.name}`}</small>
                                    </div>
                                    {canEditSelectedRuntime ? (
                                      <button
                                        className="contacts-skill-card-remove"
                                        type="button"
                                        onClick={() => removeDefaultSkill(selectedMember, skill.id)}
                                        aria-label={`移除 ${skill.title || skill.name}`}
                                        title="从默认 skill 中移除"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div
                                className="contacts-empty-console contacts-editable-panel"
                                role="button"
                                tabIndex={0}
                                onClick={() => beginEditingSelected("skills")}
                                onKeyDown={(event) => handleEditableKey(event, "skills")}
                              >
                                这个员工暂未绑定默认 skill。点击这里选择。
                              </div>
                            )}
                          </section>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rooms-empty-row">选择一个员工查看资料</div>
              )}
            </section>
          </div>
        ) : (
          <section className="contacts-group-list" aria-label="群聊">
            {groupRooms.map((room) => (
              <button className="contacts-group-row" key={room.id} type="button" onClick={() => props.onOpenMessages(room.id)}>
                <span className="contacts-group-icon" aria-hidden="true">
                  <ThemedPixelIcon pixelIcon="rooms" professionalIcon={UsersRound} professionalSize={18} pixelSize={18} />
                </span>
                <div>
                  <strong>{room.title}</strong>
                  <small>{room.memberIds.length} 位员工 · {room.badge}</small>
                </div>
              </button>
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
