import { getJson, postJson, type AgentEventRecord, type AttachmentPayload } from "../../bridge";
import type { RemoteRoomInvitePayload } from "./room-invites";
import { createId, nowIso, roomMemberSourceLabel, type Room, type RoomMember, type RoomMatrixBinding } from "./rooms-storage";

export type MatrixAcceptedInvite = {
  roomId: string;
  profileEventId: string;
};

export type MatrixRoomEvent = {
  event_id?: string;
  type?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: unknown;
};

export type MatrixSyncResult = {
  ok: boolean;
  nextBatch?: string;
  events?: MatrixRoomEvent[];
  error?: string;
  message?: string;
};

export type MatrixAgentProfileContent = {
  version?: number;
  ownerUserId?: string;
  agentId?: string;
  displayName?: string;
  kernel?: string;
  model?: string;
  role?: string;
};

export type MatrixAgentRequestContent = {
  version?: number;
  turnId?: string;
  prompt?: string;
  attachments?: AttachmentPayload[];
  target?: {
    ownerUserId?: string;
    agentId?: string;
  };
};

export type MatrixAgentFinalContent = {
  version?: number;
  turnId?: string;
  agentId?: string;
  displayName?: string;
  answer?: string;
  duration?: string;
  events?: AgentEventRecord[];
};

export async function acceptMatrixInvite(input: {
  invite: RemoteRoomInvitePayload;
  member: RoomMember;
}): Promise<MatrixAcceptedInvite> {
  const roomId = input.invite.matrixRoomId || input.invite.token;
  if (!roomId) throw new Error("matrix_room_missing");
  const response = await postJson<MatrixAcceptedInvite & { ok?: boolean; error?: string; message?: string }>("/rooms/matrix/join", {
    roomId,
    localMember: input.member,
  });
  if (response.ok === false) {
    throw new Error(response.message || response.error || "matrix_join_failed");
  }
  return response;
}

export async function publishMatrixAgentRequest(input: {
  binding: RoomMatrixBinding;
  target: RoomMember;
  turnId: string;
  prompt: string;
  attachments: AttachmentPayload[];
}): Promise<string> {
  const response = await postJson<{ ok?: boolean; eventId?: string; error?: string; message?: string }>("/rooms/matrix/events", {
    roomId: input.binding.roomId,
    type: "org.opengrove.agent.request",
    txnId: `agent-request-${input.turnId}`,
    content: {
      version: 1,
      turnId: input.turnId,
      prompt: input.prompt,
      attachments: input.attachments,
      target: {
        ownerUserId: input.target.matrixUserId,
        agentId: input.target.matrixAgentId,
      },
    },
  });
  if (!response.ok || !response.eventId) {
    throw new Error(response.message || response.error || "matrix_agent_request_failed");
  }
  return response.eventId;
}

export async function publishMatrixAgentFinal(input: {
  binding: RoomMatrixBinding;
  turnId: string;
  agentId: string;
  displayName: string;
  answer: string;
  duration?: string;
  events?: AgentEventRecord[];
}): Promise<string> {
  const response = await postJson<{ ok?: boolean; eventId?: string; error?: string; message?: string }>("/rooms/matrix/events", {
    roomId: input.binding.roomId,
    type: "org.opengrove.agent.final",
    txnId: `agent-final-${input.turnId}`,
    content: {
      version: 1,
      turnId: input.turnId,
      agentId: input.agentId,
      displayName: input.displayName,
      answer: input.answer,
      duration: input.duration,
      events: input.events,
    },
  });
  if (!response.ok || !response.eventId) {
    throw new Error(response.message || response.error || "matrix_agent_final_failed");
  }
  return response.eventId;
}

export async function syncMatrixRoomEvents(input: {
  roomId: string;
  since?: string;
}): Promise<MatrixSyncResult> {
  const params = new URLSearchParams({ roomId: input.roomId });
  if (input.since) params.set("since", input.since);
  return getJson<MatrixSyncResult>(`/rooms/matrix/sync?${params.toString()}`);
}

export function matrixRoomLocalId(homeserverUrl: string, matrixRoomId: string): string {
  return `matrix_${hashStableId(`${normalizedUrl(homeserverUrl)}:${matrixRoomId}`)}`;
}

export function matrixMemberLocalId(ownerUserId: string, agentId: string): string {
  return `matrix_member_${hashStableId(`${ownerUserId}:${agentId}`)}`;
}

export function roomFromAcceptedMatrixInvite(input: {
  invite: RemoteRoomInvitePayload;
  accepted: MatrixAcceptedInvite;
  localMember: RoomMember;
}): Room {
  const homeserverUrl = normalizedUrl(input.invite.matrixHomeserverUrl || "");
  const roomId = matrixRoomLocalId(homeserverUrl, input.accepted.roomId);
  const createdAt = nowIso();
  return {
    id: roomId,
    kind: "group",
    title: input.invite.roomTitle || "OpenGrove 群聊",
    badge: "Matrix",
    memberIds: [input.localMember.id],
    pinned: false,
    unread: 0,
    updatedAt: createdAt,
    matrix: {
      homeserverUrl,
      roomId: input.accepted.roomId,
      localMemberId: input.localMember.id,
      mode: "guest",
    },
    messages: [{
      id: createId("message"),
      senderId: "system",
      senderName: "系统",
      senderType: "system",
      text: `${input.localMember.name} 已通过 Matrix 加入共享群聊。`,
      targetIds: [],
      status: "done",
      createdAt,
    }],
  };
}

export function roomMemberFromMatrixAgentProfile(input: {
  ownerUserId: string;
  agentId: string;
  displayName: string;
  kernel?: string;
  model?: string;
  role?: string;
}): RoomMember {
  return {
    id: matrixMemberLocalId(input.ownerUserId, input.agentId),
    name: input.displayName || "远程员工",
    kernel: input.kernel || "matrix-agent",
    model: input.model || "OpenGrove Matrix",
    role: input.role || "远程员工",
    status: "waiting",
    color: "#14b8a6",
    lastActive: "刚刚",
    source: "remote",
    sourceLabel: roomMemberSourceLabel({ source: "remote" }),
    inviteStatus: "accepted",
    homeNodeLabel: input.ownerUserId,
    matrixUserId: input.ownerUserId,
    matrixAgentId: input.agentId,
  };
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
