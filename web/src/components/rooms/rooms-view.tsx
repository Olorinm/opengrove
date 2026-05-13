import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { MoreHorizontal, UsersRound } from "lucide-react";
import type { AgentEventRecord, AttachmentPayload, KernelOption, ModelId, RunRecord, RuntimeControls } from "../../bridge";
import { applyApprovalResultToMessages } from "../../messages";
import { MAX_COMPOSER_ATTACHMENTS, readComposerAttachment } from "../../runtime/ui-model";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { KernelIcon } from "../ui/entity-icons";
import { EmployeeDialog } from "./employee-dialog";
import { RoomMemberAvatar } from "./member-avatar";
import { RoomComposer, type MentionOption } from "./room-composer";
import { RoomGroupAvatar } from "./room-group-avatar";
import { RemoteInviteDialog } from "./remote-invite-dialog";
import {
  failRoomMessage,
  finalizeRoomMessageFromRun,
  interruptRoomMessage,
  roomMessageFromStored,
  roomMessageToStored,
  roomMessageText,
} from "./room-message-model";
import {
  clearRemoteRoomInviteFromLocation,
  createRemoteRoomInvite,
  readRemoteRoomInviteFromLocation,
  type RemoteRoomInvitePayload,
  type RemoteRoomInviteResult,
} from "./room-invites";
import { RoomMessageStream } from "./room-message-stream";
import { acceptMatrixInvite } from "./room-matrix";
import { RoomSettingsPanel } from "./room-settings-panel";
import { RoomSidebar } from "./room-sidebar";
import {
  addServerRoomMember,
  applyRoomEvents,
  createServerRoom,
  fetchRoomEvents,
  fetchRoomsInit,
  mergeRoomsFromServerSnapshot,
  openServerDirectRoom,
  patchServerRoom,
  postServerRoomMessage,
  removeServerRoomMember,
  sortRoomMessages,
  type RoomEvent,
  upsertServerRoomMember,
} from "./rooms-api";
import {
  ROOM_OWNER_MEMBER,
  createId,
  directRoomId,
  nowIso,
  roomMemberSourceLabel,
  roomMemberStatusLabel,
  type MemberStatus,
  type MessageStatus,
  type Room,
  type RoomMember,
  type RoomMessage,
} from "./rooms-model";

type MentionMenuState = {
  open: boolean;
  query: string;
  start: number;
  end: number;
  activeIndex: number;
};

function runRecordId(run: RunRecord | undefined): string {
  return String(run?.id || run?.runId || "");
}

function runRecordUpdatedAt(run: RunRecord): string {
  return String(run.finishedAt || run.endedAt || run.updatedAt || run.startedAt || run.createdAt || "");
}

function isTerminalRunStatus(status: unknown): boolean {
  return !["", "running", "pending", "queued", "waiting_for_approval"].includes(String(status || "").toLowerCase());
}

function isFailedRunStatus(status: unknown): boolean {
  return ["failed", "error", "cancelled", "canceled"].includes(String(status || "").toLowerCase());
}

function runDurationLabel(run: RunRecord | undefined): string | undefined {
  if (!run) return undefined;
  const started = new Date(String(run.startedAt || run.createdAt || "")).getTime();
  const finished = new Date(runRecordUpdatedAt(run)).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    return undefined;
  }
  return `${Math.max(0.1, (finished - started) / 1000).toFixed(1)}s`;
}

function groupEventsByRunId(events: AgentEventRecord[] | undefined, allowedRunIds: Set<string>): Map<string, AgentEventRecord[]> {
  const grouped = new Map<string, AgentEventRecord[]>();
  if (!events?.length || allowedRunIds.size === 0) return grouped;
  for (const event of events) {
    const runId = typeof event?.runId === "string" ? event.runId : "";
    if (!runId || !allowedRunIds.has(runId)) continue;
    const list = grouped.get(runId);
    if (list) {
      list.push(event);
    } else {
      grouped.set(runId, [event]);
    }
  }
  return grouped;
}

function hasTerminalRoomEvent(events: AgentEventRecord[] | undefined): boolean {
  return Boolean(events?.some((event) => event?.type === "turn.finished" || event?.type === "error" || event?.type === "model.response"));
}

function finalRoomAnswerFromEvents(events: AgentEventRecord[] | undefined): string {
  if (!Array.isArray(events)) return "";
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const text = event?.type === "model.response" ? event.response?.text : "";
    if (typeof text === "string" && text.trim()) {
      return text;
    }
  }
  const deltaText = events
    .filter((event) => event?.type === "assistant.delta" && typeof event.text === "string")
    .map((event) => event.text)
    .join("");
  if (deltaText.trim()) return deltaText;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const text = event?.type === "error" ? event.message : "";
    if (typeof text === "string" && text.trim()) {
      return text;
    }
  }
  return "";
}

function runRecordFinalAnswer(run: RunRecord | undefined): string {
  if (!run || !isTerminalRunStatus(run.status)) return "";
  if (isFailedRunStatus(run.status)) return String(run.error || "").trim();
  const summary = String(run.summary || "").trim();
  const input = String(run.input || "").trim();
  return summary && summary !== input ? summary : "";
}

function resolveTargets(text: string, members: RoomMember[]): RoomMember[] {
  const normalized = text.toLowerCase();
  if (/@all\b/i.test(text) || /@全部|@所有人/.test(text)) {
    return members.filter((member) => !member.disabled && member.status !== "offline");
  }
  return members.filter((member) => {
    if (member.disabled) return false;
    const aliases = [member.name, member.id, member.kernel].map((value) => `@${value.toLowerCase()}`);
    return aliases.some((alias) => normalized.includes(alias));
  });
}

function canSendRoomDraft(rawText: string, attachmentCount: number): boolean {
  if (attachmentCount > 0) return true;
  const text = rawText.trim();
  if (!text) return false;
  return !/^@\S*$/.test(text);
}

function removedMemberForRoom(member: RoomMember, deletedMemberIds: Set<string>): RoomMember {
  if (!member.disabled && !deletedMemberIds.has(member.id)) return member;
  return {
    ...member,
    disabled: true,
    status: "offline",
    lastActive: "已移除",
  };
}

function findMentionContext(value: string, cursor: number): Pick<MentionMenuState, "query" | "start" | "end"> | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] ?? "";
  return {
    query,
    start: beforeCursor.length - query.length - 1,
    end: cursor,
  };
}

export function RoomsView(props: {
  activeKernel?: string;
  activeModel: ModelId;
  activeWorkspaceRoot: string;
  kernelOptions: KernelOption[];
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  pendingApprovalCount: number;
  onResolveApproval?(approvalId: string, action: "approve" | "reject", response?: unknown): Promise<unknown> | void;
  onOpenSettings(): void;
}) {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const compositionGuardTimerRef = useRef<number | null>(null);
  const isComposingTextRef = useRef(false);
  const suppressNextEnterRef = useRef(false);
  const roomsRef = useRef<Room[]>([]);
  const membersRef = useRef<RoomMember[]>([]);
  const deletedMemberIdsRef = useRef<string[]>([]);
  const serverRoomsEventSeqRef = useRef(0);
  const serverRoomsPollingRef = useRef(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [deletedMemberIds, setDeletedMemberIds] = useState<string[]>([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [roomQuery, setRoomQuery] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberPickerMode, setMemberPickerMode] = useState<"add" | "remove" | null>(null);
  const [memberPickerQuery, setMemberPickerQuery] = useState("");
  const [memberPanelOpen, setMemberPanelOpen] = useState(false);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [remoteInvite, setRemoteInvite] = useState<RemoteRoomInvitePayload | null>(() => readRemoteRoomInviteFromLocation());
  const [remoteInviteError, setRemoteInviteError] = useState("");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDraftTitle, setGroupDraftTitle] = useState("");
  const [groupDraftMemberIds, setGroupDraftMemberIds] = useState<string[]>([]);
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState>({
    open: false,
    query: "",
    start: 0,
    end: 0,
    activeIndex: 0,
  });
  const deletedMemberIdSet = useMemo(() => new Set(deletedMemberIds), [deletedMemberIds]);

  useEffect(() => {
    deletedMemberIdsRef.current = deletedMemberIds;
  }, [deletedMemberIds]);

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? rooms[0],
    [activeRoomId, rooms],
  );

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    membersRef.current = members.map((member) => removedMemberForRoom(member, deletedMemberIdSet));
  }, [deletedMemberIdSet, members]);

  useEffect(() => {
    let cancelled = false;
    void fetchRoomsInit()
      .then((snapshot) => {
        if (cancelled || !snapshot.ok) return;
        const merged = mergeRoomsFromServerSnapshot(roomsRef.current, membersRef.current, deletedMemberIdsRef.current, snapshot);
        if (merged.rooms.length) {
          setRooms(merged.rooms);
          setMembers(merged.members);
          setDeletedMemberIds(merged.deletedMemberIds);
          setActiveRoomId((current) => merged.rooms.some((room) => room.id === current) ? current : merged.rooms[0]?.id ?? "");
        }
        serverRoomsEventSeqRef.current = snapshot.currentEventSeq;
      })
      .catch(() => {
        // Local room state remains usable when the bridge is not available yet.
      });
    return () => {
      cancelled = true;
    };
  }, [setActiveRoomId, setDeletedMemberIds, setMembers, setRooms]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (serverRoomsPollingRef.current) return;
      serverRoomsPollingRef.current = true;
      try {
        let afterEventSeq = serverRoomsEventSeqRef.current;
        let currentEventSeq = afterEventSeq;
        const events: RoomEvent[] = [];
        for (;;) {
          const result = await fetchRoomEvents(afterEventSeq);
          if (!result.ok) break;
          currentEventSeq = result.currentEventSeq;
          events.push(...result.events);
          const lastEvent = result.events[result.events.length - 1];
          const lastEventSeq = lastEvent?.eventSeq;
          if (!result.hasMore || !lastEventSeq || lastEventSeq <= afterEventSeq) break;
          afterEventSeq = lastEventSeq;
        }
        if (!cancelled) {
          serverRoomsEventSeqRef.current = currentEventSeq;
          if (events.length) {
            const applied = applyRoomEvents(roomsRef.current, membersRef.current, events);
            const appliedDeletedMemberIds = Array.from(new Set([
              ...deletedMemberIdsRef.current,
              ...applied.members.filter((member) => member.disabled).map((member) => member.id),
            ]));
            setMembers(applied.members);
            setDeletedMemberIds(appliedDeletedMemberIds);
            setRooms(applied.rooms);
          }
        }
      } catch {
        // Polling is best-effort; the UI should not break if the bridge restarts.
      } finally {
        serverRoomsPollingRef.current = false;
      }
    };
    const timer = window.setInterval(() => {
      void poll();
    }, 1500);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [setDeletedMemberIds, setMembers, setRooms]);

  useEffect(() => {
    function syncRemoteInviteFromLocation() {
      setRemoteInvite(readRemoteRoomInviteFromLocation());
    }
    window.addEventListener("popstate", syncRemoteInviteFromLocation);
    return () => window.removeEventListener("popstate", syncRemoteInviteFromLocation);
  }, []);

  const roomMembers = useMemo(
    () => activeRoom
      ? activeRoom.memberIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member): member is RoomMember => Boolean(member))
        .map((member) => removedMemberForRoom(member, deletedMemberIdSet))
      : [],
    [activeRoom, deletedMemberIdSet, members],
  );
  const contactMembers = useMemo(() => {
    return members.filter((member) => !deletedMemberIdSet.has(member.id) && !member.disabled);
  }, [deletedMemberIdSet, members]);
  const visibleRoomMembers = useMemo(
    () => activeRoom?.kind === "group" ? [ROOM_OWNER_MEMBER, ...roomMembers] : roomMembers,
    [activeRoom?.kind, roomMembers],
  );
  const visibleRoomMemberCount = visibleRoomMembers.length;
  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    if (!query) return visibleRoomMembers;
    return visibleRoomMembers.filter((member) => (
      member.name.toLowerCase().includes(query)
      || member.role.toLowerCase().includes(query)
      || member.kernel.toLowerCase().includes(query)
    ));
  }, [memberQuery, visibleRoomMembers]);
  const availableMembers = useMemo(() => {
    if (activeRoom?.kind !== "group") return [];
    const existingIds = new Set(activeRoom.memberIds);
    return contactMembers.filter((member) => !existingIds.has(member.id));
  }, [activeRoom, contactMembers]);
  const removableMembers = useMemo(() => {
    if (activeRoom?.kind !== "group" || roomMembers.length <= 1) return [];
    return roomMembers;
  }, [activeRoom?.kind, roomMembers]);
  const memberPickerOptions = useMemo(() => {
    const source = memberPickerMode === "add" ? availableMembers : memberPickerMode === "remove" ? removableMembers : [];
    const query = memberPickerQuery.trim().toLowerCase();
    if (!query) return source;
    return source.filter((member) => (
      member.name.toLowerCase().includes(query)
      || member.role.toLowerCase().includes(query)
      || member.kernel.toLowerCase().includes(query)
      || member.model.toLowerCase().includes(query)
    ));
  }, [availableMembers, memberPickerMode, memberPickerQuery, removableMembers]);
  const mentionOptions = useMemo(() => {
    const query = mentionMenu.query.trim().toLowerCase();
    const allOption: MentionOption = { id: "all", kind: "all", label: "所有人", detail: "提示所有成员" };
    const allAliases = ["所有人", "全部", "all"];
    const includeAll = activeRoom?.kind === "group" && (!query || allAliases.some((alias) => alias.toLowerCase().includes(query)));
    const memberOptions: MentionOption[] = roomMembers
      .filter((member) => {
        if (member.disabled) return false;
        if (!query) return true;
        return [member.name, member.role, member.kernel, member.model].some((value) => value.toLowerCase().includes(query));
      })
      .map((member) => ({
        id: member.id,
        kind: "member",
        label: member.name,
        detail: `${roomMemberSourceLabel(member)} · ${member.role} · ${roomMemberStatusLabel(member)}`,
        member,
      }));
    return [...(includeAll ? [allOption] : []), ...memberOptions];
  }, [activeRoom?.kind, mentionMenu.query, roomMembers]);
  const activeRoomRunIds = useMemo(() => {
    const runIds = new Set<string>();
    for (const message of activeRoom?.messages ?? []) {
      if (message.runId) runIds.add(message.runId);
    }
    return runIds;
  }, [activeRoom?.messages]);
  const allRoomRunIds = useMemo(() => {
    const runIds = new Set<string>();
    for (const room of rooms) {
      for (const message of room.messages) {
        if (message.runId) runIds.add(message.runId);
      }
    }
    return runIds;
  }, [rooms]);
  const activeRoomRuntimeEventsByRunId = useMemo(
    () => groupEventsByRunId(props.runtimeEvents, activeRoomRunIds),
    [activeRoomRunIds, props.runtimeEvents],
  );
  const allRoomRuntimeEventsByRunId = useMemo(
    () => groupEventsByRunId(props.runtimeEvents, allRoomRunIds),
    [allRoomRunIds, props.runtimeEvents],
  );
  const runsById = useMemo(() => {
    const runs = new Map<string, RunRecord>();
    for (const run of props.runs ?? []) {
      const runId = runRecordId(run);
      if (runId) runs.set(runId, run);
    }
    return runs;
  }, [props.runs]);
  const runningRoomRunIds = useMemo(() => {
    const runIds = new Set<string>();
    for (const room of rooms) {
      for (const message of room.messages) {
        if (message.status === "running" && message.runId) {
          runIds.add(message.runId);
        }
      }
    }
    return runIds;
  }, [rooms]);
  const runningRoomEventsByRunId = useMemo(
    () => groupEventsByRunId(props.runtimeEvents, runningRoomRunIds),
    [props.runtimeEvents, runningRoomRunIds],
  );
  const activeRunIds = useMemo(() => {
    const runIds = new Set<string>();
    for (const run of props.runs ?? []) {
      const runId = runRecordId(run);
      if (runId && !isTerminalRunStatus(run.status)) {
        runIds.add(runId);
      }
    }
    return runIds;
  }, [props.runs]);
  const messageCount = activeRoom?.messages.length ?? 0;

  useLayoutEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    stream.scrollTop = stream.scrollHeight;
  }, [messageCount, activeRoomId]);

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

  useEffect(() => {
    if (!createMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && createMenuRef.current?.contains(target)) return;
      setCreateMenuOpen(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setCreateMenuOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [createMenuOpen]);

  useEffect(() => {
    if (runningRoomRunIds.size === 0) return;
    const terminalRuns = new Map<string, RunRecord>();
    for (const run of props.runs ?? []) {
      const runId = runRecordId(run);
      if (runId && runningRoomRunIds.has(runId) && isTerminalRunStatus(run.status)) {
        terminalRuns.set(runId, run);
      }
    }

    const terminalRunIds = new Set(terminalRuns.keys());
    for (const [runId, events] of runningRoomEventsByRunId) {
      if (hasTerminalRoomEvent(events)) {
        terminalRunIds.add(runId);
      }
    }
    if (terminalRunIds.size === 0) return;

    const completedMemberIds = new Set<string>();
    for (const room of rooms) {
      for (const message of room.messages) {
        if (message.senderType === "agent" && message.status === "running" && message.runId && terminalRunIds.has(message.runId)) {
          completedMemberIds.add(message.senderId);
        }
      }
    }

    setRooms((current) => {
      let changed = false;
      const nextRooms = current.map((room) => {
        let roomChanged = false;
        const messages = room.messages.map((message) => {
          if (message.senderType !== "agent" || message.status !== "running" || !message.runId || !terminalRunIds.has(message.runId)) {
            return message;
          }
          const run = terminalRuns.get(message.runId);
          const events = runningRoomEventsByRunId.get(message.runId);
          const status: MessageStatus = isFailedRunStatus(run?.status) || events?.some((event) => event?.type === "error") ? "failed" : "done";
          const answer = finalRoomAnswerFromEvents(events) || runRecordFinalAnswer(run);
          roomChanged = true;
          changed = true;
          return finalizeRoomMessageFromRun(message, events, status, runDurationLabel(run), answer);
        });
        return roomChanged ? { ...room, messages, updatedAt: nowIso() } : room;
      });
      return changed ? nextRooms : current;
    });
    if (completedMemberIds.size > 0) {
      setMembers((current) => current.map((member) => (
        completedMemberIds.has(member.id) && member.status === "running"
          ? { ...member, status: "done", lastActive: "刚刚" }
          : member
      )));
    }
  }, [props.runs, rooms, runningRoomEventsByRunId, runningRoomRunIds]);

  useEffect(() => {
    if (allRoomRunIds.size === 0) return;
    setRooms((current) => {
      let changed = false;
      const nextRooms = current.map((room) => {
        let roomChanged = false;
        const messages = room.messages.map((message) => {
          if (
            message.senderType !== "agent"
            || !message.runId
            || message.status === "running"
          ) {
            return message;
          }
          const run = runsById.get(message.runId);
          const events = allRoomRuntimeEventsByRunId.get(message.runId);
          const eventAnswer = finalRoomAnswerFromEvents(events);
          const currentText = roomMessageText(message).trim();
          const answer = eventAnswer || (!currentText ? runRecordFinalAnswer(run) : "");
          if (!answer) {
            return message;
          }
          if (eventAnswer && currentText === eventAnswer.trim()) {
            return message;
          }
          const status: MessageStatus = isFailedRunStatus(run?.status) || events?.some((event) => event?.type === "error")
            ? "failed"
            : "done";
          roomChanged = true;
          changed = true;
          return finalizeRoomMessageFromRun(message, events, status, message.duration || runDurationLabel(run), answer);
        });
        return roomChanged ? { ...room, messages, updatedAt: nowIso() } : room;
      });
      return changed ? nextRooms : current;
    });
  }, [allRoomRunIds, allRoomRuntimeEventsByRunId, runsById]);

  useEffect(() => {
    const now = Date.now();
    const staleMemberIds = new Set<string>();
    for (const room of rooms) {
      for (const message of room.messages) {
        if (message.senderType !== "agent" || message.status !== "running") continue;
        if (message.runId && activeRunIds.has(message.runId)) continue;
        const startedAt = new Date(message.startedAt || message.createdAt || "").getTime();
        if (Number.isFinite(startedAt) && now - startedAt >= 90_000) {
          staleMemberIds.add(message.senderId);
        }
      }
    }
    if (staleMemberIds.size === 0) return;
    setRooms((current) => {
      let changed = false;
      const nextRooms = current.map((room) => {
        let roomChanged = false;
        const messages = room.messages.map((message) => {
          if (message.senderType !== "agent" || message.status !== "running") return message;
          if (message.runId && activeRunIds.has(message.runId)) return message;
          const startedAt = new Date(message.startedAt || message.createdAt || "").getTime();
          if (!Number.isFinite(startedAt) || now - startedAt < 90_000) return message;
          roomChanged = true;
          changed = true;
          return interruptRoomMessage(message);
        });
        return roomChanged ? { ...room, messages, updatedAt: nowIso() } : room;
      });
      return changed ? nextRooms : current;
    });
    if (staleMemberIds.size > 0) {
      setMembers((current) => current.map((member) => (
        staleMemberIds.has(member.id) && member.status === "running"
          ? { ...member, status: "idle", lastActive: "已中断" }
          : member
      )));
    }
  }, [activeRunIds, props.runs, rooms]);

  useEffect(() => () => {
    if (compositionGuardTimerRef.current !== null) {
      window.clearTimeout(compositionGuardTimerRef.current);
    }
  }, []);

  function updateActiveRoom(updater: (room: Room) => Room) {
    if (!activeRoom) return;
    setRooms((current) => current.map((room) => (room.id === activeRoom.id ? updater(room) : room)));
  }

  function updateRoom(roomId: string, updater: (room: Room) => Room) {
    setRooms((current) => current.map((room) => (room.id === roomId ? updater(room) : room)));
  }

  function updateRoomMessage(roomId: string, messageId: string, updater: (message: RoomMessage) => RoomMessage) {
    updateRoom(roomId, (room) => ({
      ...room,
      messages: room.messages.map((message) => (message.id === messageId ? updater(message) : message)),
      updatedAt: nowIso(),
    }));
  }

  function upsertRoomMessages(roomId: string, incomingMessages: RoomMessage[]) {
    if (!incomingMessages.length) return;
    updateRoom(roomId, (room) => {
      const byId = new Map(room.messages.map((message) => [message.id, message]));
      for (const incoming of incomingMessages) {
        const current = byId.get(incoming.id);
        byId.set(incoming.id, current ? { ...current, ...incoming } : incoming);
      }
      return {
        ...room,
        messages: [...byId.values()].sort(sortRoomMessages),
        updatedAt: nowIso(),
      };
    });
  }

  function updateMemberStatus(memberIds: string[], status: MemberStatus) {
    if (!memberIds.length) return;
    const targetIds = new Set(memberIds);
    setMembers((current) => current.map((member) => (
      targetIds.has(member.id) && !member.disabled ? { ...member, status, lastActive: "刚刚" } : member
    )));
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

  async function resolveRoomApproval(approvalId: string, action: "approve" | "reject", response?: unknown) {
    const result = await props.onResolveApproval?.(approvalId, action, response);
    if (!result) return;
    setRooms((current) =>
      current.map((room) => {
        let roomChanged = false;
        const messages = room.messages.map((message) => {
          if (!message.parts?.length) return message;
          const stored = roomMessageToStored(message);
          const updated = applyApprovalResultToMessages([stored], approvalId, result, action);
          if (!updated) return message;
          roomChanged = true;
          return roomMessageFromStored(message, stored, message.status);
        });
        return roomChanged ? { ...room, messages, updatedAt: nowIso() } : room;
      }),
    );
  }

  function openRoom(roomId: string) {
    setActiveRoomId(roomId);
    setMemberPanelOpen(false);
    setMemberPickerMode(null);
    setMemberPickerQuery("");
    setRoomMenuOpen(false);
    setRoomQuery("");
    setDraft("");
    setAttachments([]);
    setMentionMenu((current) => ({ ...current, open: false }));
    setRooms((current) => current.map((room) => (room.id === roomId ? { ...room, unread: 0 } : room)));
  }

  function openCreateGroupDialog() {
    setGroupDraftTitle(`新群聊 ${rooms.filter((room) => room.kind === "group").length + 1}`);
    setGroupDraftMemberIds([]);
    setGroupDialogOpen(true);
    setCreateMenuOpen(false);
  }

  function openRecruitEmployeeDialog() {
    setEmployeeDialogOpen(true);
    setCreateMenuOpen(false);
  }

  function addEmployee(member: RoomMember) {
    const restoredMember: RoomMember = {
      ...member,
      disabled: false,
      status: member.status === "offline" ? "idle" : member.status,
      lastActive: "刚刚",
    };
    setMembers((current) => (
      current.some((item) => item.id === restoredMember.id)
        ? current.map((item) => (item.id === restoredMember.id ? { ...item, ...restoredMember } : item))
        : [...current, restoredMember]
    ));
    setDeletedMemberIds((current) => current.filter((memberId) => memberId !== restoredMember.id));
    void upsertServerRoomMember(restoredMember).catch(() => undefined);
  }

  async function createRemoteInviteLink(): Promise<RemoteRoomInviteResult | null> {
    if (!activeRoom) return null;
    const result = await createRemoteRoomInvite(activeRoom);
    if (result.invite.matrixHomeserverUrl && result.invite.matrixRoomId) {
      updateRoom(activeRoom.id, (room) => ({
        ...room,
        badge: "Matrix",
        matrix: {
          homeserverUrl: result.invite.matrixHomeserverUrl!,
          roomId: result.invite.matrixRoomId!,
          mode: "host",
        },
      }));
    }
    return result;
  }

  function closeRemoteInviteDialog() {
    clearRemoteRoomInviteFromLocation();
    setRemoteInvite(null);
    setRemoteInviteError("");
  }

  function createEmployeeForRemoteInvite() {
    setEmployeeDialogOpen(true);
  }

  async function acceptRemoteInviteWithMember(member: RoomMember) {
    if (!remoteInvite) return;
    setRemoteInviteError("");
    if (remoteInvite.provider === "matrix" || remoteInvite.matrixRoomId || remoteInvite.matrixHomeserverUrl) {
      try {
        const accepted = await acceptMatrixInvite({ invite: remoteInvite, member });
        const snapshot = await fetchRoomsInit();
        if (snapshot.ok) {
          const merged = mergeRoomsFromServerSnapshot(roomsRef.current, membersRef.current, deletedMemberIdsRef.current, snapshot);
          setRooms(merged.rooms);
          setMembers(merged.members);
          setDeletedMemberIds(merged.deletedMemberIds);
          serverRoomsEventSeqRef.current = snapshot.currentEventSeq;
        }
        setActiveRoomId(accepted.room.id);
        closeRemoteInviteDialog();
      } catch (error) {
        setRemoteInviteError(`接受 Matrix 邀请失败：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    setRemoteInviteError("这个远程员工邀请不是 Matrix/Tuwunel 邀请，请重新生成链接。");
  }

  function toggleGroupDraftMember(memberId: string) {
    setGroupDraftMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  }

  function createRoom(memberIds: string[], title: string) {
    if (!memberIds.length) return;
    const createdAt = nowIso();
    const newRoom: Room = {
      id: createId("room"),
      kind: "group",
      title: title.trim() || `新群聊 ${rooms.filter((room) => room.kind === "group").length + 1}`,
      badge: "本地",
      memberIds,
      pinned: false,
      unread: 0,
      updatedAt: createdAt,
      messages: [
        {
          id: createId("message"),
          senderId: "system",
          senderName: "系统",
          senderType: "system",
          text: "新群聊已创建。发消息时用 @成员 或 @所有人 触发成员响应。",
          targetIds: [],
          status: "done",
          createdAt,
        },
      ],
    };
    setRooms((current) => [newRoom, ...current]);
    void createServerRoom(newRoom).catch(() => undefined);
    setActiveRoomId(newRoom.id);
    setMemberPanelOpen(false);
    setMemberPickerMode(null);
    setMemberPickerQuery("");
    setRoomMenuOpen(false);
    setCreateMenuOpen(false);
    setRoomQuery("");
    setDraft("");
    setAttachments([]);
    setMentionMenu((current) => ({ ...current, open: false }));
  }

  function createGroupFromDialog() {
    const contactMemberIds = new Set(contactMembers.map((member) => member.id));
    const selectedMemberIds = groupDraftMemberIds.filter((memberId) => contactMemberIds.has(memberId));
    if (!selectedMemberIds.length) return;
    createRoom(selectedMemberIds, groupDraftTitle);
    setGroupDialogOpen(false);
  }

  function openDirectMember(member: RoomMember) {
    const roomId = directRoomId(member.id);
    const existing = rooms.find((room) => room.id === roomId);
    if (!existing) {
      const createdAt = nowIso();
      const newRoom: Room = {
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
      };
      setRooms((current) => [newRoom, ...current]);
      void openServerDirectRoom(member.id, member.name).catch(() => undefined);
    }
    setActiveRoomId(roomId);
    setMemberPanelOpen(false);
    setMemberPickerMode(null);
    setMemberPickerQuery("");
    setRoomMenuOpen(false);
    setRoomQuery("");
    setDraft("");
    setAttachments([]);
    setMentionMenu((current) => ({ ...current, open: false }));
  }

  function toggleActiveRoomPinned() {
    if (activeRoom) {
      void patchServerRoom(activeRoom.id, { pinned: !activeRoom.pinned }).catch(() => undefined);
    }
    updateActiveRoom((room) => ({
      ...room,
      pinned: !room.pinned,
      updatedAt: nowIso(),
    }));
    setRoomMenuOpen(false);
  }

  function openMemberManager() {
    setMemberPanelOpen(true);
    setRoomMenuOpen(false);
  }

  function openMemberPicker(mode: "add" | "remove") {
    setMemberPanelOpen(true);
    setRoomMenuOpen(false);
    setMemberPickerMode((current) => (current === mode ? null : mode));
    setMemberPickerQuery("");
  }

  function closeMemberPicker() {
    setMemberPickerMode(null);
    setMemberPickerQuery("");
  }

  function renameActiveRoom() {
    if (!activeRoom || activeRoom.kind !== "group") return;
    const nextTitle = window.prompt("群名称", activeRoom.title)?.trim();
    if (!nextTitle || nextTitle === activeRoom.title) return;
    updateActiveRoom((room) => ({
      ...room,
      title: nextTitle,
      updatedAt: nowIso(),
    }));
    void patchServerRoom(activeRoom.id, { title: nextTitle }).catch(() => undefined);
  }

  function addMemberToActiveRoom(member: RoomMember) {
    if (!activeRoom || activeRoom.kind !== "group" || activeRoom.memberIds.includes(member.id)) {
      setMemberPanelOpen(true);
      return;
    }
    updateActiveRoom((room) => ({
      ...room,
      memberIds: [...room.memberIds, member.id],
      updatedAt: nowIso(),
    }));
    void addServerRoomMember(activeRoom.id, member).catch(() => undefined);
    setMemberPanelOpen(true);
    setMemberQuery("");
    closeMemberPicker();
  }

  function removeMemberFromActiveRoom(member: RoomMember) {
    if (!activeRoom || activeRoom.kind !== "group" || activeRoom.memberIds.length <= 1) {
      setMemberPanelOpen(true);
      return;
    }
    updateActiveRoom((room) => {
      const nextMemberIds = room.memberIds.filter((memberId) => memberId !== member.id);
      if (nextMemberIds.length === room.memberIds.length || nextMemberIds.length === 0) return room;
      return {
        ...room,
        memberIds: nextMemberIds,
        updatedAt: nowIso(),
      };
    });
    void removeServerRoomMember(activeRoom.id, member.id).catch(() => undefined);
    setMemberPanelOpen(true);
    setMemberQuery("");
    closeMemberPicker();
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
      end: mentionContext.end,
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
    if (!activeRoom) return false;
    const text = rawText.trim() || (outgoingAttachments.length ? "发送了附件" : "");
    if (!canSendRoomDraft(text, outgoingAttachments.length)) return false;
    const createdAt = nowIso();
    const explicitTargets = resolveTargets(text, roomMembers);
    const directTarget = activeRoom.kind === "direct"
      ? roomMembers.find((member) => member.id === activeRoom.directMemberId && !member.disabled) ?? roomMembers.find((member) => !member.disabled)
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
    const assistantMessages = targets.map((target) => ({
      id: createId("message"),
      senderId: target.id,
      senderName: target.name,
      senderType: "agent" as const,
      text: "",
      targetIds: [target.id],
      status: "running" as const,
      createdAt,
      startedAt: createdAt,
    }));
    updateRoom(activeRoom.id, (room) => ({
      ...room,
      messages: [...room.messages, userMessage, ...assistantMessages],
      updatedAt: createdAt,
      unread: 0,
    }));
    updateMemberStatus(targets.map((target) => target.id), "running");
    void postServerRoomMessage({
      roomId: activeRoom.id,
      text,
      targetIds: targets.map((member) => member.id),
      attachments: outgoingAttachments,
      userMessageId: userMessage.id,
      assistantMessageIds: assistantMessages.map((message) => message.id),
    })
      .then((result) => {
        if (result.ok) {
          serverRoomsEventSeqRef.current = Math.max(serverRoomsEventSeqRef.current, result.currentEventSeq);
          upsertRoomMessages(activeRoom.id, [result.userMessage, ...result.assistantMessages]);
        }
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        targets.forEach((target, index) => {
          const assistantMessage = assistantMessages[index];
          if (!assistantMessage) return;
          updateRoomMessage(activeRoom.id, assistantMessage.id, (message) => failRoomMessage(message, messageText));
          updateMemberStatus([target.id], "idle");
        });
      });
    return true;
  }

  if (!activeRoom) {
    return null;
  }

  const activeDirectMember = activeRoom.directMemberId ? roomMembers.find((member) => member.id === activeRoom.directMemberId) : undefined;
  const runningRoomMembers = roomMembers.filter((member) => !member.disabled && member.status === "running");

  return (
    <section className="rooms-view" data-members-open={memberPanelOpen ? "true" : "false"} aria-label="消息">
      <RoomSidebar
        activeRoom={activeRoom}
        rooms={rooms}
        members={members}
        roomQuery={roomQuery}
        createMenuRef={createMenuRef}
        createMenuOpen={createMenuOpen}
        onToggleCreateMenu={() => setCreateMenuOpen((open) => !open)}
        onCreateGroup={openCreateGroupDialog}
        onRecruitEmployee={openRecruitEmployeeDialog}
        onRoomQueryChange={setRoomQuery}
        onOpenRoom={openRoom}
        onOpenDirectMember={openDirectMember}
      />

      <section className="room-main-panel">
        <header className="room-header">
          <div className="room-header-main">
            {activeDirectMember ? (
              <span className="room-header-avatar" aria-hidden="true">
                <KernelIcon kernelId={activeDirectMember.kernel} size={20} />
              </span>
            ) : (
              <RoomGroupAvatar title={activeRoom.title} className="room-header-avatar" />
            )}
            <div className="room-header-copy">
              <div className="room-title-row">
                <h2>{activeRoom.title}</h2>
                <button
                  className="room-member-count-button"
                  type="button"
                  onClick={openMemberManager}
                  aria-expanded={memberPanelOpen}
                  title={activeRoom.kind === "group" ? "查看群成员" : "查看成员"}
                >
                  <UsersRound size={14} />
                  <span>{visibleRoomMemberCount}</span>
                </button>
                {runningRoomMembers.length ? (
                  <span className="room-running-pill">{runningRoomMembers.map((member) => member.name).join("、")} 执行中</span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="room-header-actions">
            <div className="rooms-room-menu-wrap">
              <button
                className="rooms-icon-button"
                type="button"
                onClick={() => setRoomMenuOpen((open) => !open)}
                aria-expanded={roomMenuOpen}
                aria-label="更多设置"
                title="更多"
              >
                <MoreHorizontal size={19} />
              </button>
              {roomMenuOpen ? (
                <div className="rooms-room-menu" role="menu">
                  <button type="button" role="menuitem" onClick={toggleActiveRoomPinned}>
                    {activeRoom.pinned ? "取消置顶" : "设为置顶"}
                  </button>
                  <button type="button" role="menuitem" onClick={openMemberManager}>
                    {activeRoom.kind === "group" ? "管理群成员" : "查看成员"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <section ref={streamRef} className="room-message-stream chat-thread-scroll" aria-live="polite">
          <RoomMessageStream
            messages={activeRoom.messages}
            members={members}
            runtimeEventsByRunId={activeRoomRuntimeEventsByRunId}
            onResolveApproval={(approvalId, action, response) => {
              void resolveRoomApproval(approvalId, action, response);
            }}
            onInsertPrompt={insertPrompt}
            onSubmitPrompt={submitPromptFromActivity}
          />
        </section>

        <RoomComposer
          inputRef={composerInputRef}
          fileInputRef={fileInputRef}
          roomTitle={activeRoom.title}
          draft={draft}
          attachments={attachments}
          canSend={canSendRoomDraft(draft, attachments.length)}
          mentionOpen={mentionMenu.open}
          mentionOptions={mentionOptions}
          activeMentionIndex={mentionMenu.activeIndex}
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
      </section>

      <RoomSettingsPanel
        activeRoom={activeRoom}
        activeDirectMember={activeDirectMember}
        activeModel={props.activeModel}
        pendingApprovalCount={props.pendingApprovalCount}
        memberPanelOpen={memberPanelOpen}
        memberQuery={memberQuery}
        memberPickerMode={memberPickerMode}
        memberPickerQuery={memberPickerQuery}
        memberPickerOptions={memberPickerOptions}
        visibleRoomMembers={visibleRoomMembers}
        filteredMembers={filteredMembers}
        removableMembers={removableMembers}
        visibleRoomMemberCount={visibleRoomMemberCount}
        onClose={() => setMemberPanelOpen(false)}
        onRenameRoom={renameActiveRoom}
        onMemberQueryChange={setMemberQuery}
        onOpenMemberPicker={openMemberPicker}
        onCloseMemberPicker={closeMemberPicker}
        onMemberPickerQueryChange={setMemberPickerQuery}
        onAddMember={addMemberToActiveRoom}
        onRemoveMember={removeMemberFromActiveRoom}
      />
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="rooms-create-group-dialog" aria-label="创建群聊">
          <DialogTitle>创建群聊</DialogTitle>
          <label className="employee-dialog-field">
            <span>群名称</span>
            <input value={groupDraftTitle} onChange={(event) => setGroupDraftTitle(event.target.value)} />
          </label>
          <section className="rooms-create-group-members">
            <div className="rooms-create-group-title">
              <strong>选择员工</strong>
              <span>{groupDraftMemberIds.length} / {contactMembers.length}</span>
            </div>
            <div className="rooms-create-group-list">
              {contactMembers.length ? contactMembers.map((member) => (
                <label className="rooms-create-group-member" key={member.id}>
                  <input
                    type="checkbox"
                    checked={groupDraftMemberIds.includes(member.id)}
                    onChange={() => toggleGroupDraftMember(member.id)}
                  />
                  <RoomMemberAvatar member={member} />
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.role} · {member.kernel}</small>
                  </span>
                </label>
              )) : (
                <div className="rooms-empty-row">还没有员工，先招聘一个员工。</div>
              )}
            </div>
          </section>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => setGroupDialogOpen(false)}>
              取消
            </button>
            <button className="primary-button" type="button" onClick={createGroupFromDialog} disabled={!groupDraftMemberIds.length}>
              创建
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <EmployeeDialog
        open={employeeDialogOpen}
        activeKernel={props.activeKernel}
        activeModel={props.activeModel}
        runtimeControls={props.runtimeControls}
        runtimeControlsByKernel={props.runtimeControlsByKernel}
        kernelOptions={props.kernelOptions}
        allowRemoteInvite
        onOpenChange={setEmployeeDialogOpen}
        onCreate={addEmployee}
        onCreateRemoteInvite={createRemoteInviteLink}
      />
      <RemoteInviteDialog
        invite={remoteInvite}
        errorMessage={remoteInviteError}
        members={contactMembers}
        onAccept={acceptRemoteInviteWithMember}
        onClose={closeRemoteInviteDialog}
        onCreateEmployee={createEmployeeForRemoteInvite}
      />
    </section>
  );
}
