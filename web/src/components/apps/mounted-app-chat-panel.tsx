import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ChevronDown, MessageCircle, Search, X } from "lucide-react";
import type { AgentEventRecord, AttachmentPayload, ExtensionItemRecord } from "../../bridge";
import { MAX_COMPOSER_ATTACHMENTS, readComposerAttachment } from "../../runtime/ui-model";
import {
  fetchRoomsInit,
  mergeRoomsFromServerSnapshot,
  openServerDirectRoom,
  postServerRoomMessage,
  sortRoomMessages,
} from "../rooms/rooms-api";
import type { MentionOption } from "../rooms/room-composer";
import { canSendRoomDraft, findMentionContext, resolveRoomTargets, type MentionMenuState } from "../rooms/room-chat-utils";
import { RoomChatSurface } from "../rooms/room-chat-surface";
import { RoomGroupAvatar } from "../rooms/room-group-avatar";
import {
  createId,
  directRoomId,
  nowIso,
  roomMemberSourceLabel,
  roomMemberStatusLabel,
  type Room,
  type RoomMember,
  type RoomMessage,
  type RoomsState,
} from "../rooms/rooms-model";
import { RoomMemberAvatar } from "../rooms/member-avatar";

export function MountedAppChatPanel(props: {
  app: ExtensionItemRecord | undefined;
  appContextText: string;
}) {
  const streamRef = useRef<HTMLElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeAppNameRef = useRef("");
  const compositionGuardTimerRef = useRef<number | null>(null);
  const isComposingTextRef = useRef(false);
  const suppressNextEnterRef = useRef(false);
  const [state, setState] = useState<RoomsState>({ rooms: [], members: [], activeRoomId: "", deletedMemberIds: [] });
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState>({
    open: false,
    query: "",
    start: 0,
    end: 0,
    activeIndex: 0,
  });
  const emptyRuntimeEventsByRunId = useMemo(() => new Map<string, AgentEventRecord[]>(), []);

  useEffect(() => {
    let cancelled = false;
    async function refreshRooms() {
      try {
        const snapshot = await fetchRoomsInit();
        if (cancelled || !snapshot.ok) return;
        setState((current) => {
          const merged = mergeRoomsFromServerSnapshot(current.rooms, current.members, current.deletedMemberIds ?? [], snapshot);
          const activeRoomId = current.activeRoomId && merged.rooms.some((room) => room.id === current.activeRoomId)
            ? current.activeRoomId
            : "";
          return { ...merged, activeRoomId };
        });
      } catch {
        // Keep the already-loaded room readable while the bridge reconnects.
      }
    }
    void refreshRooms();
    const interval = window.setInterval(() => void refreshRooms(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const deletedMemberIds = useMemo(() => new Set(state.deletedMemberIds ?? []), [state.deletedMemberIds]);
  const contactMembers = useMemo(
    () => state.members.filter((member) => !deletedMemberIds.has(member.id) && !member.disabled && member.source !== "human"),
    [deletedMemberIds, state.members],
  );
  const groupRooms = useMemo(
    () => state.rooms.filter((room) => room.kind === "group" && !room.archived),
    [state.rooms],
  );
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoomId);
  const activeRoomMembers = useMemo(
    () => activeRoom
      ? activeRoom.memberIds
        .map((memberId) => state.members.find((member) => member.id === memberId))
        .filter((member): member is RoomMember => Boolean(member))
      : [],
    [activeRoom, state.members],
  );
  const defaultMember = useMemo(
    () => resolveDefaultAppMember(props.app, contactMembers),
    [contactMembers, props.app],
  );
  const filteredMembers = useMemo(
    () => filterMembers(contactMembers, query),
    [contactMembers, query],
  );
  const filteredGroupRooms = useMemo(
    () => filterRooms(groupRooms, query),
    [groupRooms, query],
  );
  const mentionOptions = useMemo(() => {
    const value = mentionMenu.query.trim().toLowerCase();
    const allOption: MentionOption = { id: "all", kind: "all", label: "所有人", detail: "提示所有成员" };
    const allAliases = ["所有人", "全部", "all"];
    const includeAll = activeRoom?.kind === "group" && (!value || allAliases.some((alias) => alias.toLowerCase().includes(value)));
    const memberOptions: MentionOption[] = activeRoomMembers
      .filter((member) => {
        if (member.disabled) return false;
        if (!value) return true;
        return [member.name, member.role, member.kernel, member.model].some((item) => item.toLowerCase().includes(value));
      })
      .map((member) => ({
        id: member.id,
        kind: "member",
        label: member.name,
        detail: `${roomMemberSourceLabel(member)} · ${member.role} · ${roomMemberStatusLabel(member)}`,
        member,
      }));
    return [...(includeAll ? [allOption] : []), ...memberOptions];
  }, [activeRoom?.kind, activeRoomMembers, mentionMenu.query]);
  const messageCount = activeRoom?.messages.length ?? 0;

  useEffect(() => {
    const appName = props.app?.name || "";
    if (!appName) return;
    if (activeAppNameRef.current !== appName) {
      activeAppNameRef.current = appName;
      setQuery("");
      setSelectorOpen(false);
      setDraft("");
      setAttachments([]);
      setMentionMenu((current) => ({ ...current, open: false }));
      setState((current) => ({ ...current, activeRoomId: "" }));
    }
  }, [props.app?.name]);

  useEffect(() => {
    if (!props.app || !contactMembers.length) return;
    if (activeRoom && state.rooms.some((room) => room.id === activeRoom.id)) return;
    const stored = readStoredAppRoomSelection(props.app.name);
    if (stored.explicit && stored.roomId && state.rooms.some((room) => room.id === stored.roomId)) {
      selectRoom(stored.roomId, { explicit: true });
      return;
    }
    if (defaultMember) {
      openDirectMember(defaultMember, { explicit: false });
      return;
    }
    if (stored.roomId && state.rooms.some((room) => room.id === stored.roomId)) {
      selectRoom(stored.roomId, { explicit: false });
      return;
    }
    const firstGroupRoom = state.rooms.find((room) => room.kind === "group" && !room.archived);
    if (firstGroupRoom) {
      selectRoom(firstGroupRoom.id, { explicit: false });
    }
  }, [activeRoom, contactMembers.length, defaultMember, props.app, state.rooms]);

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }, [messageCount, state.activeRoomId]);

  useEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 130)}px`;
  }, [draft]);

  useEffect(() => {
    if (!mentionMenu.open || mentionMenu.activeIndex < mentionOptions.length) return;
    setMentionMenu((current) => ({
      ...current,
      activeIndex: Math.max(0, mentionOptions.length - 1),
    }));
  }, [mentionMenu.activeIndex, mentionMenu.open, mentionOptions.length]);

  useEffect(() => () => {
    if (compositionGuardTimerRef.current !== null) {
      window.clearTimeout(compositionGuardTimerRef.current);
    }
  }, []);

  function selectRoom(roomId: string, options: { explicit?: boolean } = {}) {
    setState((current) => ({ ...current, activeRoomId: roomId }));
    if (props.app?.name) {
      writeStoredAppRoomSelection(props.app.name, roomId, options.explicit === true);
    }
    setSelectorOpen(false);
    setQuery("");
    setDraft("");
    setAttachments([]);
    setMentionMenu((current) => ({ ...current, open: false }));
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function openDirectMember(member: RoomMember, options: { explicit?: boolean } = {}) {
    const roomId = directRoomId(member.id);
    const existing = state.rooms.find((room) => room.id === roomId);
    if (existing) {
      selectRoom(existing.id, options);
      return;
    }
    const createdAt = nowIso();
    const room: Room = {
      id: roomId,
      kind: "direct",
      title: member.name,
      badge: "私聊",
      memberIds: [member.id],
      directMemberId: member.id,
      pinned: false,
      unread: 0,
      updatedAt: createdAt,
      messages: [{
        id: createId("message"),
        senderId: "system",
        senderName: "系统",
        senderType: "system",
        text: `已进入和 ${member.name} 的私聊。这里发出的消息会默认交给这个 kernel。`,
        targetIds: [],
        status: "done",
        createdAt,
      }],
    };
    setState((current) => ({ ...current, rooms: [room, ...current.rooms], activeRoomId: roomId }));
    if (props.app?.name) {
      writeStoredAppRoomSelection(props.app.name, roomId, options.explicit === true);
    }
    void openServerDirectRoom(member.id, member.name).catch(() => undefined);
    setSelectorOpen(false);
    setQuery("");
    setDraft("");
    setAttachments([]);
    setMentionMenu((current) => ({ ...current, open: false }));
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function insertPrompt(prompt: string) {
    setDraft(prompt);
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function submitPromptFromActivity(prompt: string) {
    if (!sendText(prompt, [])) {
      insertPrompt(prompt);
    }
  }

  function focusComposer(cursor?: number) {
    window.requestAnimationFrame(() => {
      const input = composerInputRef.current;
      if (!input) return;
      input.focus();
      if (typeof cursor === "number") {
        input.setSelectionRange(cursor, cursor);
      }
    });
  }

  function handleDraftChange(value: string, cursor: number) {
    setDraft(value);
    const mentionContext = findMentionContext(value, cursor);
    if (!mentionContext) {
      setMentionMenu((current) => ({ ...current, open: false }));
      return;
    }
    setMentionMenu({
      open: true,
      query: mentionContext.query,
      start: mentionContext.start,
      end: cursor,
      activeIndex: 0,
    });
  }

  function openMentionMenuFromButton() {
    const input = composerInputRef.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const activeContext = findMentionContext(draft, selectionStart);
    if (activeContext) {
      setMentionMenu({
        open: true,
        query: activeContext.query,
        start: activeContext.start,
        end: activeContext.end,
        activeIndex: 0,
      });
      focusComposer(selectionStart);
      return;
    }

    const before = draft.slice(0, selectionStart);
    const after = draft.slice(selectionEnd);
    const spacer = before.length > 0 && !/\s$/.test(before) ? " " : "";
    const mentionStart = before.length + spacer.length;
    const nextDraft = `${before}${spacer}@${after}`;
    setDraft(nextDraft);
    setMentionMenu({
      open: true,
      query: "",
      start: mentionStart,
      end: mentionStart + 1,
      activeIndex: 0,
    });
    focusComposer(mentionStart + 1);
  }

  function applyMention(option: MentionOption) {
    const token = option.kind === "all" ? "@所有人" : `@${option.member.name}`;
    const before = draft.slice(0, mentionMenu.start);
    const after = draft.slice(mentionMenu.end).replace(/^\s*/, "");
    const spacer = before.length > 0 && !/\s$/.test(before) ? " " : "";
    const nextDraft = `${before}${spacer}${token} ${after}`;
    const cursor = before.length + spacer.length + token.length + 1;
    setDraft(nextDraft);
    setMentionMenu((current) => ({ ...current, open: false, query: "", activeIndex: 0 }));
    focusComposer(cursor);
  }

  function moveMentionSelection(offset: number) {
    setMentionMenu((current) => {
      if (!current.open || mentionOptions.length === 0) return current;
      return {
        ...current,
        activeIndex: (current.activeIndex + offset + mentionOptions.length) % mentionOptions.length,
      };
    });
  }

  function openAttachmentPicker() {
    fileInputRef.current?.click();
  }

  async function handleAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const remainingSlots = Math.max(0, MAX_COMPOSER_ATTACHMENTS - attachments.length);
    if (remainingSlots === 0) return;
    const nextAttachments = await Promise.all(files.slice(0, remainingSlots).map(readComposerAttachment));
    setAttachments((current) => [...current, ...nextAttachments]);
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent;
    const isImeEvent = isComposingTextRef.current || nativeEvent.isComposing || event.key === "Process" || nativeEvent.keyCode === 229;
    if (isImeEvent) {
      return;
    }
    if (event.key === "Enter" && suppressNextEnterRef.current) {
      event.preventDefault();
      suppressNextEnterRef.current = false;
      return;
    }

    if (mentionMenu.open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveMentionSelection(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveMentionSelection(-1);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && mentionOptions[mentionMenu.activeIndex]) {
        event.preventDefault();
        applyMention(mentionOptions[mentionMenu.activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionMenu((current) => ({ ...current, open: false }));
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendDraft();
    }
  }

  function handleComposerCompositionStart() {
    if (compositionGuardTimerRef.current !== null) {
      window.clearTimeout(compositionGuardTimerRef.current);
      compositionGuardTimerRef.current = null;
    }
    isComposingTextRef.current = true;
    suppressNextEnterRef.current = false;
  }

  function handleComposerCompositionEnd() {
    isComposingTextRef.current = false;
    suppressNextEnterRef.current = true;
    compositionGuardTimerRef.current = window.setTimeout(() => {
      suppressNextEnterRef.current = false;
      compositionGuardTimerRef.current = null;
    }, 120);
  }

  function sendDraft() {
    if (!sendText(draft, attachments)) return;
    setDraft("");
    setAttachments([]);
    setMentionMenu((current) => ({ ...current, open: false }));
  }

  function sendText(rawText: string, outgoingAttachments: AttachmentPayload[] = []) {
    if (!activeRoom || sending) return false;
    const text = rawText.trim() || (outgoingAttachments.length ? "发送了附件" : "");
    if (!canSendRoomDraft(text, outgoingAttachments.length)) return false;
    const createdAt = nowIso();
    const explicitTargets = resolveRoomTargets(text, activeRoomMembers);
    const directTarget = activeRoom.kind === "direct"
      ? activeRoomMembers.find((member) => member.id === activeRoom.directMemberId && !member.disabled) ?? activeRoomMembers.find((member) => !member.disabled)
      : undefined;
    const targets = explicitTargets.length ? explicitTargets : directTarget ? [directTarget] : [];
    const userMessage: RoomMessage = {
      id: createId("message"),
      senderId: "user",
      senderName: "我",
      senderType: "user",
      text,
      targetIds: targets.map((member) => member.id),
      status: "sent",
      createdAt,
      attachments: outgoingAttachments,
    };
    const assistantMessages: RoomMessage[] = targets.map((target) => ({
      id: createId("message"),
      senderId: target.id,
      senderName: target.name,
      senderType: "agent",
      text: "",
      targetIds: [target.id],
      status: "running",
      createdAt,
      startedAt: createdAt,
    }));
    setSending(true);
    setState((current) => ({
      ...current,
      rooms: current.rooms.map((room) => room.id === activeRoom.id
        ? { ...room, messages: [...room.messages, userMessage, ...assistantMessages], updatedAt: createdAt, unread: 0 }
        : room),
    }));
    void postServerRoomMessage({
      roomId: activeRoom.id,
      text,
      targetIds: targets.map((member) => member.id),
      attachments: outgoingAttachments,
      appContextText: props.appContextText,
      userMessageId: userMessage.id,
      assistantMessageIds: assistantMessages.map((message) => message.id),
    })
      .then((result) => {
        if (!result.ok) return;
        setState((current) => ({
          ...current,
          rooms: current.rooms.map((room) => room.id === activeRoom.id
            ? mergeRoomMessages(room, [result.userMessage, ...result.assistantMessages])
            : room),
        }));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({
          ...current,
          rooms: current.rooms.map((room) => room.id === activeRoom.id
            ? mergeRoomMessages(room, assistantMessages.map((assistantMessage) => ({
                ...assistantMessage,
                text: message,
                status: "failed",
                finishedAt: new Date().toISOString(),
              })))
            : room),
        }));
      })
      .finally(() => setSending(false));
    return true;
  }

  if (!props.app) {
    return null;
  }

  return (
    <section className="mounted-app-room-chat" aria-label={`${props.app.title} 聊天框`}>
      <header className="mounted-app-room-chat-header">
        <button
          className="mounted-app-room-target"
          type="button"
          onClick={() => setSelectorOpen((open) => !open)}
          aria-expanded={selectorOpen}
        >
          <span className="mounted-app-room-target-icon">
            {activeRoom?.kind === "group" ? (
              <RoomGroupAvatar title={activeRoom.title} className="mounted-app-room-avatar" />
            ) : activeRoomMembers[0] ? (
              <RoomMemberAvatar member={activeRoomMembers[0]} />
            ) : (
              <MessageCircle size={18} />
            )}
          </span>
          <span>
            <strong>{activeRoom?.title || defaultMember?.name || "选择聊天"}</strong>
            <small>{activeRoom?.kind === "group" ? "聊天室" : "私聊"} · {props.app.title}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        {selectorOpen ? (
          <div className="mounted-app-room-picker" role="dialog" aria-label="切换 App 聊天">
            <label className="mounted-app-room-picker-search">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索员工或聊天室" />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="清空">
                  <X size={13} />
                </button>
              ) : null}
            </label>
            <div className="mounted-app-room-picker-section">
              <span>私聊</span>
              {filteredMembers.map((member) => (
                <button key={member.id} type="button" onClick={() => openDirectMember(member, { explicit: true })}>
                  <RoomMemberAvatar member={member} />
                  <span>
                    <strong>{member.name}</strong>
                    <small>{roomMemberSourceLabel(member)} · {member.kernel}</small>
                  </span>
                </button>
              ))}
              {!filteredMembers.length ? <div className="mounted-app-room-picker-empty">没有匹配员工</div> : null}
            </div>
            <div className="mounted-app-room-picker-section">
              <span>聊天室</span>
              {filteredGroupRooms.map((room) => (
                <button key={room.id} type="button" onClick={() => selectRoom(room.id, { explicit: true })}>
                  <RoomGroupAvatar title={room.title} className="mounted-app-room-avatar" />
                  <span>
                    <strong>{room.title}</strong>
                    <small>{room.memberIds.length} 位员工</small>
                  </span>
                </button>
              ))}
              {!filteredGroupRooms.length ? <div className="mounted-app-room-picker-empty">没有匹配聊天室</div> : null}
            </div>
          </div>
        ) : null}
      </header>
      {activeRoom ? (
        <RoomChatSurface
          streamRef={streamRef}
          composerInputRef={composerInputRef}
          fileInputRef={fileInputRef}
          roomTitle={activeRoom.title}
          messages={activeRoom.messages}
          members={state.members}
          runtimeEventsByRunId={emptyRuntimeEventsByRunId}
          draft={draft}
          attachments={attachments}
          canSend={canSendRoomDraft(draft, attachments.length)}
          mentionOpen={mentionMenu.open}
          mentionOptions={mentionOptions}
          activeMentionIndex={mentionMenu.activeIndex}
          onResolveApproval={() => undefined}
          onInsertPrompt={insertPrompt}
          onSubmitPrompt={submitPromptFromActivity}
          onDraftChange={handleDraftChange}
          onAttachmentInputChange={handleAttachmentInputChange}
          onOpenAttachmentPicker={openAttachmentPicker}
          onRemoveAttachment={removeAttachment}
          onKeyDown={handleComposerKeyDown}
          onCompositionStart={handleComposerCompositionStart}
          onCompositionEnd={handleComposerCompositionEnd}
          onOpenMention={openMentionMenuFromButton}
          onSelectMention={applyMention}
          onHoverMention={(index) => setMentionMenu((current) => ({ ...current, activeIndex: index }))}
          onSend={sendDraft}
        />
      ) : (
        <div className="mounted-app-room-empty">
          <MessageCircle size={20} />
          <strong>选择一个聊天</strong>
          <p>从私聊或聊天室开始，让员工在这个 App 上下文里工作。</p>
        </div>
      )}
    </section>
  );
}

function resolveDefaultAppMember(app: ExtensionItemRecord | undefined, members: RoomMember[]): RoomMember | undefined {
  if (!members.length) return undefined;
  const keywords = appKeywords(app);
  const scored = members.map((member) => ({
    member,
    score: memberMatchScore(member, keywords),
  })).sort((left, right) => right.score - left.score);
  return scored[0]?.member;
}

function memberMatchScore(member: RoomMember, keywords: string[]): number {
  const haystack = [
    member.name,
    member.role,
    member.kernel,
    ...(member.defaultSkillIds ?? []),
  ].join(" ").toLowerCase();
  let score = member.source === "local" || !member.source ? 1 : 0;
  for (const keyword of keywords) {
    if (keyword && haystack.includes(keyword)) score += 8;
  }
  return score;
}

function appKeywords(app: ExtensionItemRecord | undefined): string[] {
  if (!app) return [];
  const values = [
    app.name,
    app.title,
    app.description,
    ...app.childIds,
  ];
  return [...new Set(values.flatMap((value) => String(value || "").toLowerCase().split(/[^a-z0-9]+/g)).filter((value) => value.length >= 3))];
}

function filterMembers(members: RoomMember[], query: string): RoomMember[] {
  const value = query.trim().toLowerCase();
  if (!value) return members;
  return members.filter((member) => (
    member.name.toLowerCase().includes(value)
    || member.role.toLowerCase().includes(value)
    || member.kernel.toLowerCase().includes(value)
  ));
}

function filterRooms(rooms: Room[], query: string): Room[] {
  const value = query.trim().toLowerCase();
  if (!value) return rooms;
  return rooms.filter((room) => `${room.title} ${room.badge}`.toLowerCase().includes(value));
}

function mergeRoomMessages(room: Room, messages: RoomMessage[]): Room {
  const byId = new Map(room.messages.map((message) => [message.id, message]));
  for (const message of messages) {
    byId.set(message.id, { ...byId.get(message.id), ...message });
  }
  return {
    ...room,
    messages: [...byId.values()].sort(sortRoomMessages),
    updatedAt: nowIso(),
  };
}

function appChatStorageKey(appName: string): string {
  return `opengrove:mounted-app-chat:${appName}`;
}

function readStoredAppRoomSelection(appName: string): { roomId: string; explicit: boolean } {
  try {
    const raw = window.localStorage.getItem(appChatStorageKey(appName)) || "";
    if (!raw) return { roomId: "", explicit: false };
    if (!raw.startsWith("{")) return { roomId: raw, explicit: false };
    const parsed = JSON.parse(raw) as { roomId?: unknown; explicit?: unknown };
    return {
      roomId: typeof parsed.roomId === "string" ? parsed.roomId : "",
      explicit: parsed.explicit === true,
    };
  } catch {
    return { roomId: "", explicit: false };
  }
}

function writeStoredAppRoomSelection(appName: string, roomId: string, explicit: boolean): void {
  try {
    window.localStorage.setItem(appChatStorageKey(appName), JSON.stringify({ roomId, explicit }));
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}
