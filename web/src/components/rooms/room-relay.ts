import type { AgentEventRecord, AttachmentPayload } from "../../bridge";
import type { RemoteRoomInvitePayload } from "./room-invites";
import { createId, nowIso, roomMemberSourceLabel, type Room, type RoomMember, type RoomRelayBinding } from "./rooms-storage";

export type RelayEventEnvelope<TPayload = unknown> = {
  id: string;
  type: string;
  workspaceId: string;
  roomId: string;
  actorMemberId: string;
  targetMemberIds?: string[];
  turnId?: string;
  seq: number;
  createdAt: string;
  payload: TPayload;
};

export type RelayMessagePayload = {
  messageId?: string;
  text?: string;
  senderName?: string;
  targetMemberIds?: string[];
  attachments?: AttachmentPayload[];
};

export type RelayTurnFinalPayload = {
  answer?: string;
  duration?: string;
  events?: AgentEventRecord[];
  memberName?: string;
};

export type RelayAcceptedInvite = {
  invite: {
    workspaceId: string;
    roomId: string;
  };
  room: {
    id: string;
    title: string;
  };
  member: {
    id: string;
    displayName: string;
  };
  memberAccessToken?: string;
};

export type RelayRoomMemberRecord = {
  id: string;
  kind?: string;
  displayName: string;
};

export async function acceptRelayInvite(input: {
  invite: RemoteRoomInvitePayload;
  member: RoomMember;
}): Promise<RelayAcceptedInvite> {
  const baseUrl = normalizedRelayBaseUrl(input.invite.relayBaseUrl || "");
  if (!baseUrl) throw new Error("relay_base_url_missing");
  const response = await fetch(new URL("/invites/accept", ensureTrailingSlash(baseUrl)), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: input.invite.token,
      displayName: input.member.name,
      agentId: input.member.id,
      nodeId: "opengrove-browser",
    }),
  });
  const data = await response.json() as RelayAcceptedInvite & { error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.message || data.error || `relay_accept_failed:${response.status}`);
  }
  return data;
}

export async function listRelayRoomMembers(binding: RoomRelayBinding): Promise<RelayRoomMemberRecord[]> {
  if (!binding.baseUrl || !binding.roomId || !binding.memberId) return [];
  const url = new URL(`/rooms/${encodeURIComponent(binding.roomId)}/members`, ensureTrailingSlash(binding.baseUrl));
  url.searchParams.set("memberId", binding.memberId);
  if (binding.memberToken) url.searchParams.set("memberToken", binding.memberToken);
  const response = await fetch(url.toString(), {
    headers: {
      ...(binding.memberToken ? { "x-opengrove-member-token": binding.memberToken } : {}),
    },
  });
  const data = await response.json() as { ok?: boolean; members?: RelayRoomMemberRecord[]; error?: string; message?: string };
  if (!response.ok || !Array.isArray(data.members)) {
    throw new Error(data.message || data.error || `relay_members_failed:${response.status}`);
  }
  return data.members;
}

export async function publishRelayMessage(input: {
  binding: RoomRelayBinding;
  targetMemberId: string;
  turnId: string;
  text: string;
  attachments: AttachmentPayload[];
}): Promise<RelayEventEnvelope> {
  return publishRelayEvent<RelayMessagePayload>({
    binding: input.binding,
    type: "room.message.created",
    targetMemberIds: [input.targetMemberId],
    turnId: input.turnId,
    payload: {
      messageId: input.turnId,
      text: input.text,
      senderName: "我",
      targetMemberIds: [input.targetMemberId],
      attachments: input.attachments,
    },
  });
}

export async function publishRelayTurnFinal(input: {
  binding: RoomRelayBinding;
  turnId: string;
  targetMemberIds?: string[];
  answer: string;
  duration?: string;
  events?: AgentEventRecord[];
  memberName: string;
}): Promise<RelayEventEnvelope> {
  return publishRelayEvent<RelayTurnFinalPayload>({
    binding: input.binding,
    type: "room.turn.final",
    targetMemberIds: input.targetMemberIds,
    turnId: input.turnId,
    payload: {
      answer: input.answer,
      duration: input.duration,
      events: input.events,
      memberName: input.memberName,
    },
  });
}

export function relayRoomLocalId(baseUrl: string, relayRoomId: string): string {
  return `relay_${hashStableId(`${normalizedRelayBaseUrl(baseUrl)}:${relayRoomId}`)}`;
}

export function relayMemberLocalId(relayMemberId: string): string {
  return `relay_member_${hashStableId(relayMemberId)}`;
}

export function roomMemberFromRelayJoin(input: {
  relayMemberId: string;
  displayName: string;
  kind?: string;
  homeNodeLabel?: string;
}): RoomMember {
  const isHuman = input.kind === "human";
  return {
    id: relayMemberLocalId(input.relayMemberId),
    name: normalizeRelayDisplayName(input.displayName, isHuman),
    kernel: "remote-agent",
    model: "OpenGrove Relay",
    role: isHuman ? "远程成员" : "远程员工",
    status: "waiting",
    color: "#14b8a6",
    lastActive: "刚刚",
    source: isHuman ? "human" : "remote",
    sourceLabel: isHuman ? "远程" : roomMemberSourceLabel({ source: "remote" }),
    inviteStatus: "accepted",
    homeNodeLabel: input.homeNodeLabel || "OpenGrove Relay",
    relayMemberId: input.relayMemberId,
  };
}

export function roomFromAcceptedRelayInvite(input: {
  invite: RemoteRoomInvitePayload;
  accepted: RelayAcceptedInvite;
  localMember: RoomMember;
}): Room {
  const baseUrl = normalizedRelayBaseUrl(input.invite.relayBaseUrl || "");
  const roomId = relayRoomLocalId(baseUrl, input.accepted.room.id);
  const createdAt = nowIso();
  return {
    id: roomId,
    kind: "group",
    title: input.accepted.room.title || input.invite.roomTitle || "OpenGrove 群聊",
    badge: "Relay",
    memberIds: [input.localMember.id],
    pinned: false,
    unread: 0,
    updatedAt: createdAt,
    relay: {
      baseUrl,
      workspaceId: input.accepted.invite.workspaceId,
      roomId: input.accepted.room.id,
      memberId: input.accepted.member.id,
      memberToken: input.accepted.memberAccessToken,
      localMemberId: input.localMember.id,
      mode: "guest",
    },
    messages: [{
      id: createId("message"),
      senderId: "system",
      senderName: "系统",
      senderType: "system",
      text: `${input.localMember.name} 已通过 Relay 加入群聊。`,
      targetIds: [],
      status: "done",
      createdAt,
    }],
  };
}

export function connectRelayRoom(
  binding: RoomRelayBinding,
  onEvent: (event: RelayEventEnvelope) => void,
  onError?: () => void,
): EventSource | null {
  if (!binding.baseUrl || !binding.roomId || !binding.memberId) return null;
  const url = new URL(`/rooms/${encodeURIComponent(binding.roomId)}/stream`, ensureTrailingSlash(binding.baseUrl));
  url.searchParams.set("memberId", binding.memberId);
  if (binding.memberToken) url.searchParams.set("memberToken", binding.memberToken);
  const source = new EventSource(url.toString());
  source.addEventListener("room.event", (event) => {
    try {
      onEvent(JSON.parse(event.data) as RelayEventEnvelope);
    } catch {
      // Ignore malformed relay events.
    }
  });
  if (onError) source.addEventListener("error", onError);
  return source;
}

async function publishRelayEvent<TPayload>(input: {
  binding: RoomRelayBinding;
  type: string;
  targetMemberIds?: string[];
  turnId?: string;
  payload: TPayload;
}): Promise<RelayEventEnvelope> {
  const response = await fetch(new URL(`/rooms/${encodeURIComponent(input.binding.roomId)}/events`, ensureTrailingSlash(input.binding.baseUrl)), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.binding.memberToken ? { "x-opengrove-member-token": input.binding.memberToken } : {}),
    },
    body: JSON.stringify({
      workspaceId: input.binding.workspaceId,
      roomId: input.binding.roomId,
      actorMemberId: input.binding.memberId,
      targetMemberIds: input.targetMemberIds,
      turnId: input.turnId,
      type: input.type,
      payload: input.payload,
    }),
  });
  const data = await response.json() as { ok?: boolean; event?: RelayEventEnvelope; error?: string; message?: string };
  if (!response.ok || !data.event) {
    throw new Error(data.message || data.error || `relay_publish_failed:${response.status}`);
  }
  return data.event;
}

function normalizedRelayBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function hashStableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function normalizeRelayDisplayName(value: string, isHuman: boolean): string {
  const name = value.trim();
  if (isHuman && (!name || name === "我")) return "房主";
  return name || (isHuman ? "远程成员" : "远程员工");
}
