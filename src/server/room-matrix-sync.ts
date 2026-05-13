import type { AgentAttachmentContext } from "../core.js";
import type { RoomChannelMember, RoomChannelRoom } from "../rooms/channel-store.js";
import type { BridgeState } from "./bridge-types.js";
import { isRunnableRoomAssistantTarget, scheduleRoomAssistantRuns } from "./room-runs.js";
import { saveBridgeSettings } from "./bridge-state.js";
import {
  joinMatrixRoom,
  matrixReady,
  normalizeMatrixHomeserverUrl,
  publishMatrixRoomEvent,
  syncMatrixRoom,
  type MatrixRoomEvent,
} from "./routes/matrix-invites.js";

const MATRIX_SYNC_INTERVAL_MS = 2_500;

type MatrixAgentProfileContent = {
  ownerUserId?: string;
  agentId?: string;
  displayName?: string;
  kernel?: string;
  model?: string;
  role?: string;
};

type MatrixAgentRequestContent = {
  turnId?: string;
  prompt?: string;
  attachments?: AgentAttachmentContext[];
  target?: {
    ownerUserId?: string;
    agentId?: string;
  };
};

type MatrixAgentFinalContent = {
  turnId?: string;
  agentId?: string;
  displayName?: string;
  answer?: string;
  duration?: string;
};

export function startRoomMatrixSync(state: BridgeState, intervalMs = MATRIX_SYNC_INTERVAL_MS): () => void {
  let running = false;
  let closed = false;
  const sync = async () => {
    if (closed || running) return;
    running = true;
    try {
      await syncRoomMatrixOnce(state);
    } finally {
      running = false;
    }
  };
  void sync();
  const timer = setInterval(() => void sync(), intervalMs);
  return () => {
    closed = true;
    clearInterval(timer);
  };
}

const matrixSyncTokens = new WeakMap<BridgeState, Map<string, string>>();

export async function syncRoomMatrixOnce(state: BridgeState): Promise<void> {
  if (!matrixReady(state.settings.matrix)) return;
  const tokens = matrixSyncTokens.get(state) ?? new Map<string, string>();
  matrixSyncTokens.set(state, tokens);
  let changed = false;
  let settingsChanged = false;

  for (const room of state.app.rooms.listRooms()) {
    if (!room.matrix?.roomId) continue;
    const syncKey = `${room.id}:${room.matrix.roomId}`;
    const persistedBinding = state.settings.matrix.roomBindings[room.id];
    const persistedToken = persistedBinding?.matrixRoomId === room.matrix.roomId ? persistedBinding.syncToken : undefined;
    try {
      const result = await syncMatrixRoom(state.settings.matrix, room.matrix.roomId, tokens.get(syncKey) || persistedToken);
      if (result.nextBatch && result.nextBatch !== tokens.get(syncKey)) {
        tokens.set(syncKey, result.nextBatch);
        const binding = state.settings.matrix.roomBindings[room.id];
        if (binding?.matrixRoomId === room.matrix.roomId && binding.syncToken !== result.nextBatch) {
          state.settings.matrix = {
            ...state.settings.matrix,
            roomBindings: {
              ...state.settings.matrix.roomBindings,
              [room.id]: {
                ...binding,
                syncToken: result.nextBatch,
              },
            },
          };
          settingsChanged = true;
        }
      }
      for (const event of result.events) {
        changed = await applyMatrixRoomEvent(state, room.id, event) || changed;
      }
    } catch {
      // Matrix sync is best-effort. The next interval will retry with the last successful token.
    }
  }

  if (changed) {
    state.store.saveFrom(state.app);
  }
  if (settingsChanged) {
    saveBridgeSettings(state);
  }
}

export async function acceptMatrixInviteIntoLedger(
  state: BridgeState,
  input: {
    matrixRoomId: string;
    roomTitle?: string;
    localMember: RoomChannelMember;
  },
): Promise<{ room: RoomChannelRoom; member: RoomChannelMember; profileEventId: string }> {
  if (!matrixReady(state.settings.matrix)) {
    throw new Error("matrix_not_configured");
  }
  const joinedRoomId = await joinMatrixRoom(state.settings.matrix, input.matrixRoomId);
  const homeserverUrl = normalizeMatrixHomeserverUrl(state.settings.matrix.homeserverUrl);
  const member = state.app.rooms.upsertMember({
    ...input.localMember,
    source: "local",
    sourceLabel: input.localMember.sourceLabel || "本机",
    inviteStatus: "accepted",
    disabled: false,
  }, { emitEvent: true });

  const localRoomId = matrixRoomLocalId(homeserverUrl, joinedRoomId);
  const title = input.roomTitle?.trim() || "OpenGrove 群聊";
  const existing = state.app.rooms.getRoom(localRoomId);
  const matrix = {
    homeserverUrl,
    roomId: joinedRoomId,
    localMemberId: member.id,
    mode: "guest" as const,
  };
  const room = existing
    ? state.app.rooms.patchRoom(localRoomId, { title, badge: "Matrix", matrix })
    : state.app.rooms.createRoom({
      id: localRoomId,
      title,
      badge: "Matrix",
      memberIds: [member.id],
      matrix,
    });
  if (!room.memberIds.includes(member.id)) {
    state.app.rooms.addMember(localRoomId, member);
  }

  const profileEventId = await publishMatrixRoomEvent(
    state.settings.matrix,
    joinedRoomId,
    "org.opengrove.agent.profile",
    {
      version: 1,
      ownerUserId: state.settings.matrix.userId,
      agentId: member.id,
      displayName: member.name,
      kernel: member.kernel,
      model: member.model,
      role: member.role,
    },
  );

  if (!roomHasMatrixEvent(state, localRoomId, profileEventId)) {
    state.app.rooms.postSystemMessage({
      roomId: localRoomId,
      id: stableMatrixMessageId("matrix_join", member.id, profileEventId),
      text: `${member.name} 已通过 Matrix 加入共享群聊。`,
      matrixEventId: profileEventId,
    });
  }

  state.settings.matrix = {
    ...state.settings.matrix,
    roomBindings: {
      ...state.settings.matrix.roomBindings,
      [localRoomId]: {
        matrixRoomId: joinedRoomId,
        homeserverUrl,
        title,
        createdAt: new Date().toISOString(),
        syncToken: state.settings.matrix.roomBindings[localRoomId]?.matrixRoomId === joinedRoomId
          ? state.settings.matrix.roomBindings[localRoomId]?.syncToken
          : undefined,
      },
    },
  };
  saveBridgeSettings(state);
  state.store.saveFrom(state.app);
  return { room: state.app.rooms.getRoom(localRoomId) ?? room, member, profileEventId };
}

async function applyMatrixRoomEvent(state: BridgeState, localRoomId: string, event: MatrixRoomEvent): Promise<boolean> {
  const eventId = event.event_id?.trim();
  if (!eventId || roomHasMatrixEvent(state, localRoomId, eventId)) return false;
  const room = state.app.rooms.getRoom(localRoomId);
  if (!room?.matrix) return false;

  if (event.type === "org.opengrove.agent.profile") {
    return applyMatrixProfileEvent(state, room, event);
  }
  if (event.type === "org.opengrove.agent.request") {
    return applyMatrixRequestEvent(state, room, event);
  }
  if (event.type === "org.opengrove.agent.final") {
    return applyMatrixFinalEvent(state, room, event);
  }
  return false;
}

function applyMatrixProfileEvent(state: BridgeState, room: RoomChannelRoom, event: MatrixRoomEvent): boolean {
  const content = record(event.content) as MatrixAgentProfileContent;
  const ownerUserId = stringValue(content.ownerUserId || event.sender);
  const agentId = stringValue(content.agentId);
  if (!ownerUserId || !agentId || agentId === room.matrix?.localMemberId) return false;
  const member = roomMemberFromMatrixAgentProfile({
    ownerUserId,
    agentId,
    displayName: stringValue(content.displayName) || "远程员工",
    kernel: stringValue(content.kernel) || "matrix-agent",
    model: stringValue(content.model) || "OpenGrove Matrix",
    role: stringValue(content.role) || "远程员工",
  });
  if (room.memberIds.includes(member.id)) {
    state.app.rooms.upsertMember(member, { emitEvent: true });
  } else {
    state.app.rooms.addMember(room.id, member);
  }
  state.app.rooms.postSystemMessage({
    roomId: room.id,
    id: stableMatrixMessageId("matrix_profile", member.id, event.event_id || ""),
    text: `${member.name} 已通过 Matrix 加入共享群聊。`,
    createdAt: matrixEventCreatedAt(event),
    matrixEventId: event.event_id,
  });
  return true;
}

function applyMatrixRequestEvent(state: BridgeState, room: RoomChannelRoom, event: MatrixRoomEvent): boolean {
  const content = record(event.content) as MatrixAgentRequestContent;
  const localMemberId = room.matrix?.localMemberId;
  if (!localMemberId) return false;
  if (content.target?.ownerUserId && content.target.ownerUserId !== state.settings.matrix.userId) return false;
  if (content.target?.agentId && content.target.agentId !== localMemberId) return false;
  const member = state.app.rooms.listMembers().find((item) => item.id === localMemberId);
  if (!member || !isRunnableRoomAssistantTarget(member)) return false;
  const prompt = stringValue(content.prompt);
  if (!prompt) return false;

  const turnId = matrixTurnKey(event, content);
  if (roomHasMatrixTurn(state, room.id, turnId)) return false;
  const createdAt = matrixEventCreatedAt(event);
  const sender = stringValue(event.sender) || "matrix";
  const userMessage = state.app.rooms.postExternalUserMessage({
    roomId: room.id,
    id: stableMatrixMessageId("matrix_prompt", sender, turnId),
    senderId: `matrix_actor_${sender}`,
    senderName: sender,
    text: prompt,
    targetIds: [member.id],
    attachments: Array.isArray(content.attachments) ? content.attachments : undefined,
    createdAt,
    matrixEventId: event.event_id,
    matrixTurnId: turnId,
  });
  const assistantMessage = state.app.rooms.createAssistantPlaceholder({
    roomId: room.id,
    target: member,
    id: stableMatrixMessageId("matrix_reply", member.id, turnId),
    createdAt,
    matrixTurnId: turnId,
  });
  scheduleRoomAssistantRuns(state, {
    roomId: room.id,
    userMessageId: userMessage.id,
    prompt,
    targets: [member],
    assistantMessages: [assistantMessage],
    onMessageFinalized: ({ message, error }) => {
      void publishMatrixFinalForMessage(state, room, member, turnId, message, error).catch(() => undefined);
    },
  });
  return true;
}

function applyMatrixFinalEvent(state: BridgeState, room: RoomChannelRoom, event: MatrixRoomEvent): boolean {
  const content = record(event.content) as MatrixAgentFinalContent;
  const turnId = matrixTurnKey(event, content);
  const agentId = stringValue(content.agentId);
  const member = state.app.rooms.listMembers().find((item) => (
    item.matrixAgentId === agentId && (!event.sender || item.matrixUserId === event.sender)
  )) ?? (agentId && event.sender ? roomMemberFromMatrixAgentProfile({
    ownerUserId: event.sender,
    agentId,
    displayName: stringValue(content.displayName) || "远程员工",
  }) : undefined);

  if (member && !room.memberIds.includes(member.id)) {
    state.app.rooms.addMember(room.id, member);
  }
  const existing = state.app.rooms.listMessages(room.id, { limit: 0 }).find((message) => (
    message.senderType === "agent"
    && message.matrixTurnId === turnId
    && (!member || message.senderId === member.id)
  ));
  if (existing) {
    state.app.rooms.updateMessage(room.id, existing.id, {
      text: stringValue(content.answer),
      status: "done",
      duration: stringValue(content.duration) || existing.duration,
      finishedAt: matrixEventCreatedAt(event),
      matrixEventId: event.event_id,
      matrixTurnId: turnId,
    });
    if (member) {
      state.app.rooms.patchMember(member.id, { status: "done", lastActive: "now" });
    }
    return true;
  }
  if (!member) return false;
  const message = state.app.rooms.createAssistantPlaceholder({
    roomId: room.id,
    target: member,
    id: stableMatrixMessageId("matrix_final", member.id, turnId),
    createdAt: matrixEventCreatedAt(event),
    matrixEventId: event.event_id,
    matrixTurnId: turnId,
  });
  state.app.rooms.updateMessage(room.id, message.id, {
    text: stringValue(content.answer),
    status: "done",
    duration: stringValue(content.duration),
    finishedAt: matrixEventCreatedAt(event),
  });
  state.app.rooms.patchMember(member.id, { status: "done", lastActive: "now" });
  return true;
}

async function publishMatrixFinalForMessage(
  state: BridgeState,
  room: RoomChannelRoom,
  member: RoomChannelMember,
  turnId: string,
  message: { text: string; duration?: string },
  error?: string,
): Promise<void> {
  if (!room.matrix?.roomId || !matrixReady(state.settings.matrix)) return;
  await publishMatrixRoomEvent(
    state.settings.matrix,
    room.matrix.roomId,
    "org.opengrove.agent.final",
    {
      version: 1,
      turnId,
      agentId: member.id,
      displayName: member.name,
      answer: error ? `执行失败：${error}` : message.text,
      duration: message.duration,
    },
    `agent-final-${turnId}`,
  );
}

function roomMemberFromMatrixAgentProfile(input: {
  ownerUserId: string;
  agentId: string;
  displayName: string;
  kernel?: string;
  model?: string;
  role?: string;
}): RoomChannelMember {
  return {
    id: matrixMemberLocalId(input.ownerUserId, input.agentId),
    name: input.displayName || "远程员工",
    kernel: input.kernel || "matrix-agent",
    model: input.model || "OpenGrove Matrix",
    role: input.role || "远程员工",
    status: "waiting",
    color: "#14b8a6",
    lastActive: "now",
    source: "remote",
    sourceLabel: "Matrix",
    inviteStatus: "accepted",
    homeNodeLabel: input.ownerUserId,
    matrixUserId: input.ownerUserId,
    matrixAgentId: input.agentId,
  };
}

function roomHasMatrixEvent(state: BridgeState, roomId: string, eventId: string | undefined): boolean {
  if (!eventId) return false;
  return state.app.rooms.listMessages(roomId, { limit: 0 }).some((message) => message.matrixEventId === eventId);
}

function roomHasMatrixTurn(state: BridgeState, roomId: string, turnId: string): boolean {
  return state.app.rooms.listMessages(roomId, { limit: 0 }).some((message) => message.matrixTurnId === turnId);
}

export function matrixRoomLocalId(homeserverUrl: string, matrixRoomId: string): string {
  return `matrix_${hashStableId(`${normalizedUrl(homeserverUrl)}:${matrixRoomId}`)}`;
}

function matrixMemberLocalId(ownerUserId: string, agentId: string): string {
  return `matrix_member_${hashStableId(`${ownerUserId}:${agentId}`)}`;
}

function matrixEventCreatedAt(event: MatrixRoomEvent): string {
  return event.origin_server_ts ? new Date(event.origin_server_ts).toISOString() : new Date().toISOString();
}

function matrixTurnKey(event: MatrixRoomEvent, content: { turnId?: string }): string {
  return stringValue(content.turnId) || event.event_id || `matrix_${Date.now().toString(36)}`;
}

function stableMatrixMessageId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${hashStableId(parts.join(":"))}`;
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function hashStableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
