import type { AgentAttachmentContext } from "../../../core.js";
import type { RoomChannelMember, RoomChannelRemoteProvenance, RoomChannelRoom } from "../../../rooms/channel-store.js";
import type { BridgeState } from "../../bridge-types.js";
import { isRunnableRoomAssistantTarget, scheduleRoomAssistantRuns } from "../../room-runs.js";
import { saveBridgeSettings } from "../../bridge-state.js";
import {
  joinMatrixRoom,
  publishMatrixRoomEvent,
  syncMatrixRoom,
  type MatrixRoomEvent,
} from "../../../remote/matrix/client.js";
import {
  matrixReady,
  normalizeMatrixHomeserverUrl,
} from "./invites.js";

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

type MatrixSyncController = {
  intervalMs: number;
  running: boolean;
  closed: boolean;
  timer?: ReturnType<typeof setInterval>;
};

const matrixSyncControllers = new WeakMap<BridgeState, MatrixSyncController>();

export function startRoomMatrixSync(state: BridgeState, intervalMs = MATRIX_SYNC_INTERVAL_MS): () => void {
  const controller: MatrixSyncController = {
    intervalMs,
    running: false,
    closed: false,
  };
  matrixSyncControllers.set(state, controller);
  refreshRoomMatrixSync(state);
  return () => {
    controller.closed = true;
    stopMatrixSyncTimer(controller);
    matrixSyncControllers.delete(state);
  };
}

export function refreshRoomMatrixSync(state: BridgeState): void {
  const controller = matrixSyncControllers.get(state);
  if (!controller || controller.closed) return;
  if (!matrixReady(state.settings.remote.matrix)) {
    stopMatrixSyncTimer(controller);
    return;
  }
  if (controller.timer) return;
  const sync = async () => {
    if (controller.closed || controller.running || !matrixReady(state.settings.remote.matrix)) {
      if (!matrixReady(state.settings.remote.matrix)) stopMatrixSyncTimer(controller);
      return;
    }
    controller.running = true;
    try {
      await syncRoomMatrixOnce(state);
    } finally {
      controller.running = false;
    }
  };
  void sync();
  controller.timer = setInterval(() => void sync(), controller.intervalMs);
}

function stopMatrixSyncTimer(controller: MatrixSyncController): void {
  if (controller.timer) {
    clearInterval(controller.timer);
    controller.timer = undefined;
  }
}

const matrixSyncTokens = new WeakMap<BridgeState, Map<string, string>>();

export async function syncRoomMatrixOnce(state: BridgeState): Promise<void> {
  const matrix = state.settings.remote.matrix;
  if (!matrixReady(matrix)) return;
  const tokens = matrixSyncTokens.get(state) ?? new Map<string, string>();
  matrixSyncTokens.set(state, tokens);
  let changed = false;
  let settingsChanged = false;

  for (const room of state.app.rooms.listRooms()) {
    if (room.remote?.provider !== "matrix" || !room.remote.remoteRoomId) continue;
    const syncKey = `${room.id}:${room.remote.remoteRoomId}`;
    const persistedBinding = matrix.bindings[room.id];
    const persistedToken = persistedBinding?.remoteRoomId === room.remote.remoteRoomId ? persistedBinding.syncCursor : undefined;
    try {
      const result = await syncMatrixRoom(matrix, room.remote.remoteRoomId, tokens.get(syncKey) || persistedToken);
      if (result.nextBatch && result.nextBatch !== tokens.get(syncKey)) {
        tokens.set(syncKey, result.nextBatch);
        const binding = state.settings.remote.matrix.bindings[room.id];
        if (binding?.remoteRoomId === room.remote.remoteRoomId && binding.syncCursor !== result.nextBatch) {
          state.settings.remote = {
            ...state.settings.remote,
            matrix: {
              ...state.settings.remote.matrix,
              bindings: {
                ...state.settings.remote.matrix.bindings,
                [room.id]: {
                  ...binding,
                  syncCursor: result.nextBatch,
                },
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
  const matrixSettings = state.settings.remote.matrix;
  if (!matrixReady(matrixSettings)) {
    throw new Error("matrix_not_configured");
  }
  const joinedRoomId = await joinMatrixRoom(matrixSettings, input.matrixRoomId);
  const homeserverUrl = normalizeMatrixHomeserverUrl(matrixSettings.homeserverUrl);
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
  const remote = {
    provider: "matrix" as const,
    accountId: "default",
    remoteRoomId: joinedRoomId,
    localMemberId: member.id,
    mode: "guest" as const,
  };
  const room = existing
    ? state.app.rooms.patchRoom(localRoomId, { title, badge: "Matrix", remote })
    : state.app.rooms.createRoom({
      id: localRoomId,
      title,
      badge: "Matrix",
      memberIds: [member.id],
      remote,
    });
  if (!room.memberIds.includes(member.id)) {
    state.app.rooms.addMember(localRoomId, member);
  }

  const profileEventId = await publishMatrixRoomEvent(
    matrixSettings,
    joinedRoomId,
    "org.opengrove.agent.profile",
    {
      version: 1,
      ownerUserId: matrixSettings.userId,
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
      remote: matrixProvenance(joinedRoomId, profileEventId),
    });
  }

  state.settings.remote = {
    ...state.settings.remote,
    matrix: {
      ...state.settings.remote.matrix,
      bindings: {
        ...state.settings.remote.matrix.bindings,
        [localRoomId]: {
          provider: "matrix",
          accountId: "default",
          remoteRoomId: joinedRoomId,
          homeserverUrl,
          title,
          createdAt: new Date().toISOString(),
          syncCursor: state.settings.remote.matrix.bindings[localRoomId]?.remoteRoomId === joinedRoomId
            ? state.settings.remote.matrix.bindings[localRoomId]?.syncCursor
            : undefined,
          enabled: true,
        },
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
  if (room?.remote?.provider !== "matrix") return false;

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
  const remote = room.remote;
  if (remote?.provider !== "matrix") return false;
  const ownerUserId = stringValue(content.ownerUserId || event.sender);
  const agentId = stringValue(content.agentId);
  if (!ownerUserId || !agentId || agentId === remote.localMemberId) return false;
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
    remote: matrixProvenance(remote.remoteRoomId, event.event_id),
  });
  return true;
}

function applyMatrixRequestEvent(state: BridgeState, room: RoomChannelRoom, event: MatrixRoomEvent): boolean {
  const content = record(event.content) as MatrixAgentRequestContent;
  const remote = room.remote;
  if (remote?.provider !== "matrix") return false;
  const localMemberId = remote.localMemberId;
  if (!localMemberId) return false;
  if (content.target?.ownerUserId && content.target.ownerUserId !== state.settings.remote.matrix.userId) return false;
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
    remote: matrixProvenance(remote.remoteRoomId, event.event_id, turnId),
  });
  const assistantMessage = state.app.rooms.createAssistantPlaceholder({
    roomId: room.id,
    target: member,
    id: stableMatrixMessageId("matrix_reply", member.id, turnId),
    createdAt,
    remote: matrixProvenance(remote.remoteRoomId, undefined, turnId),
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
    item.remote?.provider === "matrix"
    && item.remote.agentId === agentId
    && (!event.sender || item.remote.ownerId === event.sender)
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
    && message.remote?.provider === "matrix"
    && message.remote.turnId === turnId
    && (!member || message.senderId === member.id)
  ));
  if (existing) {
    state.app.rooms.updateMessage(room.id, existing.id, {
      text: stringValue(content.answer),
      status: "done",
      duration: stringValue(content.duration) || existing.duration,
      finishedAt: matrixEventCreatedAt(event),
      remote: matrixProvenance(room.remote?.remoteRoomId, event.event_id, turnId),
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
    remote: matrixProvenance(room.remote?.remoteRoomId, event.event_id, turnId),
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
  const matrix = state.settings.remote.matrix;
  if (room.remote?.provider !== "matrix" || !matrixReady(matrix)) return;
  await publishMatrixRoomEvent(
    matrix,
    room.remote.remoteRoomId,
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
    remote: {
      provider: "matrix",
      accountId: "default",
      ownerId: input.ownerUserId,
      agentId: input.agentId,
    },
  };
}

function roomHasMatrixEvent(state: BridgeState, roomId: string, eventId: string | undefined): boolean {
  if (!eventId) return false;
  return state.app.rooms.listMessages(roomId, { limit: 0 }).some((message) => message.remote?.provider === "matrix" && message.remote.eventId === eventId);
}

function roomHasMatrixTurn(state: BridgeState, roomId: string, turnId: string): boolean {
  return state.app.rooms.listMessages(roomId, { limit: 0 }).some((message) => message.remote?.provider === "matrix" && message.remote.turnId === turnId);
}

function matrixProvenance(remoteRoomId: string | undefined, eventId?: string, turnId?: string): RoomChannelRemoteProvenance {
  const provenance: RoomChannelRemoteProvenance = {
    provider: "matrix" as const,
    accountId: "default",
  };
  if (remoteRoomId) provenance.remoteRoomId = remoteRoomId;
  if (eventId) provenance.eventId = eventId;
  if (turnId) provenance.turnId = turnId;
  return provenance;
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
