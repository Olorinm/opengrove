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
  applyAgentEventToRoomMessage,
  failRoomMessage,
  finalizeRoomMessage,
  finalizeRoomMessageFromRun,
  interruptRoomMessage,
  roomMessageFromStored,
  roomMessageToStored,
  roomMessageText,
  type RoomRunPromptResult,
} from "./room-message-model";
import {
  clearRemoteRoomInviteFromLocation,
  createRemoteRoomInvite,
  readRemoteRoomInviteFromLocation,
  type RemoteRoomInvitePayload,
  type RemoteRoomInviteResult,
} from "./room-invites";
import { RoomMessageStream } from "./room-message-stream";
import {
  acceptRelayInvite,
  connectRelayRoom,
  publishRelayMessage,
  publishRelayTurnFinal,
  roomFromAcceptedRelayInvite,
  roomMemberFromRelayJoin,
  type RelayEventEnvelope,
  type RelayMessagePayload,
  type RelayTurnFinalPayload,
} from "./room-relay";
import { runRemoteRoomAgent } from "./room-remote-agent";
import { roomThreadId } from "./room-runtime";
import { RoomSettingsPanel } from "./room-settings-panel";
import { RoomSidebar } from "./room-sidebar";
import { useRoomsStorage } from "./use-rooms-storage";
import {
  ROOM_OWNER_MEMBER,
  createId,
  directRoomId,
  nowIso,
  roomMemberSourceLabel,
  statusLabel,
  type MemberStatus,
  type MessageStatus,
  type Room,
  type RoomMember,
  type RoomMessage,
} from "./rooms-storage";

type MentionMenuState = {
  open: boolean;
  query: string;
  start: number;
  end: number;
  activeIndex: number;
};

type RoomRunPromptInput = {
  roomId: string;
  targetId: string;
  targetName: string;
  targetKernel: string;
  targetModel: string;
  targetRole: string;
  prompt: string;
  attachments: AttachmentPayload[];
  onAgentEvent?(event: AgentEventRecord): void;
  onRunId?(runId: string): void;
};

type RoomAttachRunInput = {
  roomId: string;
  targetId: string;
  targetKernel: string;
  runId: string;
  onAgentEvent?(event: AgentEventRecord): void;
  onRunId?(runId: string): void;
};

function isRecoverableRoomRunError(error: unknown): boolean {
  return error instanceof Error && error.name === "RecoverableRoomStreamDisconnect";
}

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
  return events
    .filter((event) => event?.type === "assistant.delta" && typeof event.text === "string")
    .map((event) => event.text)
    .join("");
}

function runRecordFinalAnswer(run: RunRecord | undefined): string {
  if (!run || isFailedRunStatus(run.status) || !isTerminalRunStatus(run.status)) return "";
  const summary = String(run.summary || "").trim();
  const input = String(run.input || "").trim();
  return summary && summary !== input ? summary : "";
}

function resolveTargets(text: string, members: RoomMember[]): RoomMember[] {
  const normalized = text.toLowerCase();
  if (/@all\b/i.test(text) || /@全部|@所有人/.test(text)) {
    return members.filter((member) => member.status !== "offline");
  }
  return members.filter((member) => {
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRunLocally(member: RoomMember): boolean {
  return !member.source || member.source === "local";
}

function buildPassiveMemberAnswer(member: RoomMember): string {
  if (member.disabled) {
    return `${member.name} 已被禁用，不能参与这次对话。`;
  }
  if (member.source === "human") {
    return `${member.name} 是人类成员，不会自动执行 agent 回复。`;
  }
  return "";
}

function remoteMemberFromInvite(member: RoomMember, invite: RemoteRoomInvitePayload): RoomMember {
  return {
    id: `remote_${invite.token}_${member.id}`.replace(/[^A-Za-z0-9_-]/g, "_"),
    name: member.name,
    kernel: "remote-agent",
    model: "OpenGrove Relay",
    role: member.role,
    status: "waiting",
    color: member.color,
    lastActive: "刚刚",
    avatarDataUrl: member.avatarDataUrl,
    source: "remote",
    sourceLabel: "远程",
    inviteStatus: "accepted",
    homeNodeLabel: member.kernel,
    relayMemberId: invite.relayRoomId ? member.id : undefined,
  };
}

function remoteInviteJoinedMessage(memberName: string, createdAt: string): RoomMessage {
  return {
    id: createId("message"),
    senderId: "system",
    senderName: "系统",
    senderType: "system",
    text: `${memberName} 已通过邀请加入。`,
    targetIds: [],
    status: "done",
    createdAt,
  };
}

function remoteInviteErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("relay_not_configured")) {
    return "还没有配置 Relay，暂时不能生成远程员工邀请链接。请先到设置里填写公共 Relay 地址。";
  }
  return `生成远程员工邀请链接失败：${message}`;
}

function patchRelayFinalMessages(
  messages: RoomMessage[],
  event: RelayEventEnvelope,
  payload: RelayTurnFinalPayload,
  relayMember: RoomMember | undefined,
  answer: string,
): RoomMessage[] {
  let patched = false;
  const next = messages.map((message) => {
    if (message.runId && event.turnId && message.runId === event.turnId) {
      patched = true;
      return finalizeRoomMessage(message, {
        answer,
        duration: payload.duration,
        events: payload.events,
      });
    }
    return message;
  });
  if (patched || !relayMember) return next;
  return [...next, {
    id: createId("message"),
    senderId: relayMember.id,
    senderName: payload.memberName || relayMember.name,
    senderType: "agent",
    text: answer,
    targetIds: [relayMember.id],
    status: "done",
    createdAt: event.createdAt || nowIso(),
    duration: payload.duration,
    parts: [],
  }];
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
  onRunPrompt(input: RoomRunPromptInput): Promise<RoomRunPromptResult>;
  onAttachRun?(input: RoomAttachRunInput): Promise<RoomRunPromptResult>;
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
  const attachedRoomRunIdsRef = useRef(new Set<string>());
  const localRoomRunIdsRef = useRef(new Set<string>());
  const relayEventIdsRef = useRef(new Set<string>());
  const roomsRef = useRef<Room[]>([]);
  const membersRef = useRef<RoomMember[]>([]);
  const { rooms, setRooms, members, setMembers, activeRoomId, setActiveRoomId, storageWarning } = useRoomsStorage({
    activeKernel: props.activeKernel,
    activeModel: props.activeModel,
    activeWorkspaceRoot: props.activeWorkspaceRoot,
    kernelOptions: props.kernelOptions,
  });
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

  const activeRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? rooms[0],
    [activeRoomId, rooms],
  );

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    function syncRemoteInviteFromLocation() {
      setRemoteInvite(readRemoteRoomInviteFromLocation());
    }
    window.addEventListener("popstate", syncRemoteInviteFromLocation);
    return () => window.removeEventListener("popstate", syncRemoteInviteFromLocation);
  }, []);

  const roomMembers = useMemo(
    () => activeRoom ? activeRoom.memberIds.map((id) => members.find((member) => member.id === id)).filter((member): member is RoomMember => Boolean(member)) : [],
    [activeRoom, members],
  );
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
    return members.filter((member) => !existingIds.has(member.id));
  }, [activeRoom, members]);
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
        if (!query) return true;
        return [member.name, member.role, member.kernel, member.model].some((value) => value.toLowerCase().includes(query));
      })
      .map((member) => ({
        id: member.id,
        kind: "member",
        label: member.name,
        detail: `${roomMemberSourceLabel(member)} · ${member.role} · ${statusLabel(member.status)}`,
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
  const relayConnectionKey = useMemo(
    () => rooms
      .filter((room) => room.relay?.baseUrl && room.relay.roomId && room.relay.memberId)
      .map((room) => [
        room.id,
        room.relay?.baseUrl,
        room.relay?.roomId,
        room.relay?.memberId,
        room.relay?.memberToken,
      ].join(":"))
      .sort()
      .join("|"),
    [rooms],
  );

  useEffect(() => {
    const sources: EventSource[] = [];
    for (const room of roomsRef.current) {
      if (!room.relay?.baseUrl || !room.relay.roomId || !room.relay.memberId) continue;
      const source = connectRelayRoom(room.relay, (event) => handleRelayRoomEvent(room.id, event));
      if (source) sources.push(source);
    }
    return () => {
      for (const source of sources) source.close();
    };
  }, [relayConnectionKey]);

  useEffect(() => {
    if (!props.onAttachRun || activeRunIds.size === 0) return;
    for (const room of rooms) {
      for (const message of room.messages) {
        if (message.senderType !== "agent" || message.status !== "running" || !message.runId) continue;
        if (!activeRunIds.has(message.runId)) continue;
        if (localRoomRunIdsRef.current.has(message.runId) || attachedRoomRunIdsRef.current.has(message.runId)) continue;
        const member = members.find((item) => item.id === message.senderId);
        if (!member) continue;
        const run = runsById.get(message.runId);
        const expectedThreadId = roomThreadId(room.id, member.id, member.kernel);
        if (run?.sessionId && run.sessionId !== expectedThreadId) continue;
        const runId = message.runId;
        attachedRoomRunIdsRef.current.add(runId);
        updateRoomMessage(room.id, message.id, (current) => (
          current.runId === runId
            ? { ...current, text: "", parts: [], status: "running" }
            : current
        ));
        void props.onAttachRun({
          roomId: room.id,
          targetId: member.id,
          targetKernel: member.kernel,
          runId,
          onRunId(nextRunId) {
            updateRoomMessage(room.id, message.id, (current) => ({ ...current, runId: nextRunId || current.runId }));
          },
          onAgentEvent(event) {
            updateRoomMessage(room.id, message.id, (current) => applyAgentEventToRoomMessage(current, event));
          },
        }).then((result) => {
          updateRoomMessage(room.id, message.id, (current) => ({
            ...finalizeRoomMessage(current, result),
            duration: result.duration || current.duration,
          }));
          updateMemberStatus([member.id], "done");
        }).catch((error) => {
          if (isRecoverableRoomRunError(error)) return;
          const messageText = error instanceof Error ? error.message : String(error);
          updateRoomMessage(room.id, message.id, (current) => failRoomMessage(current, messageText));
          updateMemberStatus([member.id], "idle");
        });
      }
    }
  }, [activeRunIds, members, props.onAttachRun, rooms, runsById]);

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

  function appendSystemMessageToRoom(roomId: string, text: string) {
    const createdAt = nowIso();
    updateRoom(roomId, (room) => ({
      ...room,
      messages: [
        ...room.messages,
        {
          id: createId("message"),
          senderId: "system",
          senderName: "系统",
          senderType: "system",
          text,
          targetIds: [],
          status: "done",
          createdAt,
        },
      ],
      updatedAt: createdAt,
    }));
  }

  function updateMemberStatus(memberIds: string[], status: MemberStatus) {
    if (!memberIds.length) return;
    const targetIds = new Set(memberIds);
    setMembers((current) => current.map((member) => (targetIds.has(member.id) ? { ...member, status, lastActive: "刚刚" } : member)));
  }

  function handleRelayRoomEvent(localRoomId: string, event: RelayEventEnvelope) {
    if (relayEventIdsRef.current.has(event.id)) return;
    relayEventIdsRef.current.add(event.id);
    const room = roomsRef.current.find((item) => item.id === localRoomId);
    const binding = room?.relay;
    if (!room || !binding) return;
    if (event.actorMemberId === binding.memberId) return;

    if (event.type === "member.joined") {
      const payload = event.payload as { memberId?: string; displayName?: string; kind?: string };
      const relayMemberId = payload.memberId || event.actorMemberId;
      if (relayMemberId === binding.memberId) return;
      const member = roomMemberFromRelayJoin({
        relayMemberId,
        displayName: payload.displayName || "远程员工",
      });
      setMembers((current) => current.some((item) => item.id === member.id) ? current : [...current, member]);
      updateRoom(localRoomId, (currentRoom) => ({
        ...currentRoom,
        memberIds: currentRoom.memberIds.includes(member.id)
          ? currentRoom.memberIds
          : [...currentRoom.memberIds, member.id],
        updatedAt: event.createdAt || nowIso(),
      }));
      return;
    }

    if (event.type === "room.message.created") {
      const payload = event.payload as RelayMessagePayload;
      if (!event.targetMemberIds?.includes(binding.memberId)) return;
      void runRelayLocalReply(localRoomId, event, payload);
      return;
    }

    if (event.type === "room.turn.final") {
      const payload = event.payload as RelayTurnFinalPayload;
      finalizeRelayRemoteReply(localRoomId, event, payload);
    }
  }

  async function runRelayLocalReply(
    localRoomId: string,
    event: RelayEventEnvelope,
    payload: RelayMessagePayload,
  ) {
    const room = roomsRef.current.find((item) => item.id === localRoomId);
    const binding = room?.relay;
    if (!room || !binding?.localMemberId) return;
    const member = membersRef.current.find((item) => item.id === binding.localMemberId);
    if (!member) return;
    const prompt = String(payload.text || "").trim();
    if (!prompt) return;
    const createdAt = event.createdAt || nowIso();
    const userMessage: RoomMessage = {
      id: payload.messageId || event.id,
      senderId: `relay_actor_${event.actorMemberId}`,
      senderName: payload.senderName || "远程成员",
      senderType: "user",
      text: prompt,
      targetIds: [member.id],
      status: "sent",
      createdAt,
      attachments: payload.attachments,
    };
    const assistantMessage: RoomMessage = {
      id: createId("message"),
      senderId: member.id,
      senderName: member.name,
      senderType: "agent",
      text: "",
      targetIds: [member.id],
      status: "running",
      createdAt,
      startedAt: createdAt,
      runId: event.turnId || event.id,
    };
    updateRoom(localRoomId, (currentRoom) => {
      if (currentRoom.messages.some((message) => message.id === userMessage.id)) return currentRoom;
      return {
        ...currentRoom,
        messages: [...currentRoom.messages, userMessage, assistantMessage],
        updatedAt: createdAt,
      };
    });
    updateMemberStatus([member.id], "running");
    try {
      const result = await props.onRunPrompt({
        roomId: localRoomId,
        targetId: member.id,
        targetName: member.name,
        targetKernel: member.kernel,
        targetModel: member.model,
        targetRole: member.role,
        prompt,
        attachments: payload.attachments ?? [],
        onRunId(runId) {
          updateRoomMessage(localRoomId, assistantMessage.id, (message) => ({ ...message, runId }));
        },
        onAgentEvent(agentEvent) {
          updateRoomMessage(localRoomId, assistantMessage.id, (message) => applyAgentEventToRoomMessage(message, agentEvent));
        },
      });
      updateRoomMessage(localRoomId, assistantMessage.id, (message) => ({
        ...finalizeRoomMessage(message, result),
        duration: result.duration,
      }));
      updateMemberStatus([member.id], "done");
      await publishRelayTurnFinal({
        binding,
        turnId: event.turnId || event.id,
        targetMemberIds: [event.actorMemberId],
        answer: result.answer ?? "",
        duration: result.duration,
        events: result.events,
        memberName: member.name,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      updateRoomMessage(localRoomId, assistantMessage.id, (message) => failRoomMessage(message, messageText));
      updateMemberStatus([member.id], "idle");
      await publishRelayTurnFinal({
        binding,
        turnId: event.turnId || event.id,
        targetMemberIds: [event.actorMemberId],
        answer: `执行失败：${messageText}`,
        memberName: member.name,
      }).catch(() => undefined);
    }
  }

  function finalizeRelayRemoteReply(
    localRoomId: string,
    event: RelayEventEnvelope,
    payload: RelayTurnFinalPayload,
  ) {
    const room = roomsRef.current.find((item) => item.id === localRoomId);
    if (!room) return;
    const relayMember = membersRef.current.find((member) => member.relayMemberId === event.actorMemberId);
    const answer = payload.answer || "";
    updateRoom(localRoomId, (currentRoom) => ({
      ...currentRoom,
      messages: patchRelayFinalMessages(currentRoom.messages, event, payload, relayMember, answer),
      updatedAt: event.createdAt || nowIso(),
    }));
    if (relayMember) {
      updateMemberStatus([relayMember.id], "done");
    }
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
    setMembers((current) => current.some((item) => item.id === member.id) ? current : [...current, member]);
  }

  async function createRemoteInviteLink(): Promise<RemoteRoomInviteResult | null> {
    if (!activeRoom) return null;
    try {
      const result = await createRemoteRoomInvite(activeRoom);
      if (
        result.invite.relayBaseUrl &&
        result.invite.relayWorkspaceId &&
        result.invite.relayRoomId &&
        result.invite.ownerMemberId
      ) {
        updateRoom(activeRoom.id, (room) => ({
          ...room,
          relay: {
            baseUrl: result.invite.relayBaseUrl!,
            workspaceId: result.invite.relayWorkspaceId!,
            roomId: result.invite.relayRoomId!,
            memberId: result.invite.ownerMemberId!,
            memberToken: result.invite.ownerMemberToken,
            mode: "host",
          },
        }));
      }
      appendSystemMessageToRoom(activeRoom.id, "群聊邀请链接已通过 Relay 生成。朋友打开链接后会在自己的 OpenGrove 里选择员工加入。");
      return result;
    } catch (error) {
      appendSystemMessageToRoom(activeRoom.id, remoteInviteErrorMessage(error));
      throw error;
    }
  }

  function closeRemoteInviteDialog() {
    clearRemoteRoomInviteFromLocation();
    setRemoteInvite(null);
  }

  function createEmployeeForRemoteInvite() {
    setEmployeeDialogOpen(true);
  }

  async function acceptRemoteInviteWithMember(member: RoomMember) {
    if (!remoteInvite) return;
    if (remoteInvite.relayBaseUrl) {
      try {
        const accepted = await acceptRelayInvite({ invite: remoteInvite, member });
        const relayRoom = roomFromAcceptedRelayInvite({
          invite: remoteInvite,
          accepted,
          localMember: member,
        });
        setRooms((current) => {
          const existing = current.find((room) => room.id === relayRoom.id);
          if (!existing) return [relayRoom, ...current];
          return current.map((room) => room.id === relayRoom.id ? {
            ...room,
            title: relayRoom.title,
            relay: relayRoom.relay,
            memberIds: room.memberIds.includes(member.id) ? room.memberIds : [...room.memberIds, member.id],
            messages: [...room.messages, ...relayRoom.messages],
            updatedAt: nowIso(),
          } : room);
        });
        setActiveRoomId(relayRoom.id);
        closeRemoteInviteDialog();
      } catch (error) {
        appendSystemMessageToRoom(activeRoom?.id || rooms[0]?.id || "room-open-group", `接受 Relay 邀请失败：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    const remoteMember = remoteMemberFromInvite(member, remoteInvite);
    const joinedAt = nowIso();
    setMembers((current) => current.some((item) => item.id === remoteMember.id) ? current : [...current, remoteMember]);
    setRooms((current) => {
      const existing = current.find((room) => room.id === remoteInvite.roomId);
      if (!existing) {
        return [{
          id: remoteInvite.roomId,
          kind: "group",
          title: remoteInvite.roomTitle,
          badge: "远程",
          memberIds: [remoteMember.id],
          pinned: false,
          unread: 0,
          updatedAt: joinedAt,
          messages: [remoteInviteJoinedMessage(member.name, joinedAt)],
        }, ...current];
      }
      return current.map((room) => room.id === remoteInvite.roomId ? {
        ...room,
        memberIds: room.memberIds.includes(remoteMember.id) ? room.memberIds : [...room.memberIds, remoteMember.id],
        messages: [...room.messages, remoteInviteJoinedMessage(member.name, joinedAt)],
        updatedAt: joinedAt,
      } : room);
    });
    setActiveRoomId(remoteInvite.roomId);
    closeRemoteInviteDialog();
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
    if (!groupDraftMemberIds.length) return;
    createRoom(groupDraftMemberIds, groupDraftTitle);
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
      ? roomMembers.find((member) => member.id === activeRoom.directMemberId) ?? roomMembers[0]
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
    targets.forEach((target, index) => {
      const assistantMessage = assistantMessages[index];
      if (!assistantMessage) return;
      void runTargetReply(activeRoom.id, assistantMessage.id, target, text, outgoingAttachments);
    });
    return true;
  }

  async function runTargetReply(
    roomId: string,
    messageId: string,
    target: RoomMember,
    prompt: string,
    outgoingAttachments: AttachmentPayload[],
  ) {
    if (target.source === "remote") {
      await runRemoteTargetReply(roomId, messageId, target, prompt, outgoingAttachments);
      return;
    }

    if (!shouldRunLocally(target)) {
      await runPassiveTargetReply(roomId, messageId, target);
      return;
    }

    let currentRunId = "";
    try {
      const result = await props.onRunPrompt({
        roomId,
        targetId: target.id,
        targetName: target.name,
        targetKernel: target.kernel,
        targetModel: target.model,
        targetRole: target.role,
        prompt,
        attachments: outgoingAttachments,
        onRunId(runId) {
          currentRunId = runId;
          localRoomRunIdsRef.current.add(runId);
          updateRoomMessage(roomId, messageId, (message) => ({ ...message, runId }));
        },
        onAgentEvent(event) {
          updateRoomMessage(roomId, messageId, (message) => applyAgentEventToRoomMessage(message, event));
        },
      });
      updateRoomMessage(roomId, messageId, (message) => ({
        ...finalizeRoomMessage(message, result),
        duration: result.duration,
      }));
      updateMemberStatus([target.id], "done");
    } catch (error) {
      if (isRecoverableRoomRunError(error)) return;
      const messageText = error instanceof Error ? error.message : String(error);
      updateRoomMessage(roomId, messageId, (message) => failRoomMessage(message, messageText));
      updateMemberStatus([target.id], "idle");
    } finally {
      if (currentRunId) {
        localRoomRunIdsRef.current.delete(currentRunId);
      }
    }
  }

  async function runRemoteTargetReply(
    roomId: string,
    messageId: string,
    target: RoomMember,
    prompt: string,
    outgoingAttachments: AttachmentPayload[],
  ) {
    const runId = createId("room_run");
    updateRoomMessage(roomId, messageId, (message) => ({ ...message, runId }));
    const relayRoom = roomsRef.current.find((room) => room.id === roomId);
    if (relayRoom?.relay && target.relayMemberId) {
      try {
        await publishRelayMessage({
          binding: relayRoom.relay,
          targetMemberId: target.relayMemberId,
          turnId: runId,
          text: prompt,
          attachments: outgoingAttachments,
        });
        setMembers((current) => current.map((member) => (
          member.id === target.id
            ? { ...member, inviteStatus: "accepted", status: "running", lastActive: "刚刚" }
            : member
        )));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        updateRoomMessage(roomId, messageId, (message) => failRoomMessage(message, messageText));
        updateMemberStatus([target.id], "idle");
      }
      return;
    }

    try {
      const result = await runRemoteRoomAgent({
        roomId,
        memberId: target.id,
        memberName: target.name,
        prompt,
        attachments: outgoingAttachments,
      });
      if (!result.ok) {
        throw new Error(result.error || "remote_agent_failed");
      }
      updateRoomMessage(roomId, messageId, (message) => ({
        ...finalizeRoomMessage(message, {
          answer: result.answer,
          duration: result.duration,
          events: result.events,
        }),
        duration: result.duration,
      }));
      setMembers((current) => current.map((member) => (
        member.id === target.id
          ? { ...member, inviteStatus: "accepted", status: "done", lastActive: "刚刚" }
          : member
      )));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      updateRoomMessage(roomId, messageId, (message) => failRoomMessage(message, messageText));
      updateMemberStatus([target.id], "idle");
    }
  }

  async function runPassiveTargetReply(
    roomId: string,
    messageId: string,
    target: RoomMember,
  ) {
    const runId = createId("room_run");
    updateRoomMessage(roomId, messageId, (message) => ({ ...message, runId }));
    await wait(160);
    updateRoomMessage(roomId, messageId, (message) => finalizeRoomMessage(message, {
      answer: buildPassiveMemberAnswer(target),
      duration: "0.1s",
    }));
    updateMemberStatus([target.id], "done");
  }

  if (!activeRoom) {
    return null;
  }

  const activeDirectMember = activeRoom.directMemberId ? members.find((member) => member.id === activeRoom.directMemberId) : undefined;
  const runningRoomMembers = roomMembers.filter((member) => member.status === "running");

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
          {storageWarning ? <div className="room-storage-warning">{storageWarning}</div> : null}
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
              <span>{groupDraftMemberIds.length} / {members.length}</span>
            </div>
            <div className="rooms-create-group-list">
              {members.length ? members.map((member) => (
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
        members={members}
        onAccept={acceptRemoteInviteWithMember}
        onClose={closeRemoteInviteDialog}
        onCreateEmployee={createEmployeeForRemoteInvite}
      />
    </section>
  );
}
