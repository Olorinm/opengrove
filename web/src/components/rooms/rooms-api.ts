import { bridgeHeaders, fetchJson, postJson } from "../../bridge";
import type { Room, RoomMember, RoomMessage } from "./rooms-storage";

export type ServerRoomMessage = RoomMessage & {
  roomId: string;
  channelSeq: number;
  updatedAt?: string;
};

export type RoomsInitResponse = {
  ok: true;
  rooms: Array<Omit<Room, "messages">>;
  members: RoomMember[];
  messages: ServerRoomMessage[];
  currentEventSeq: number;
};

export type RoomEvent = {
  eventSeq: number;
  type: "room.created" | "room.updated" | "room.member.added" | "room.member.removed" | "room.message.created" | "room.message.updated";
  roomId: string;
  messageId?: string;
  memberId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type RoomsEventsResponse = {
  ok: true;
  events: RoomEvent[];
  currentEventSeq: number;
  hasMore: boolean;
};

export type PostRoomMessageResponse = {
  ok: true;
  room: Omit<Room, "messages">;
  userMessage: ServerRoomMessage;
  assistantMessages: ServerRoomMessage[];
  currentEventSeq: number;
};

export async function fetchRoomsInit(limit = 80): Promise<RoomsInitResponse> {
  return fetchJson<RoomsInitResponse>(`/rooms?limit=${limit}`, { headers: bridgeHeaders(false) });
}

export async function fetchRoomEvents(afterEventSeq: number): Promise<RoomsEventsResponse> {
  return fetchJson<RoomsEventsResponse>(`/rooms/events?afterEventSeq=${afterEventSeq}`, { headers: bridgeHeaders(false) });
}

export async function postServerRoomMessage(input: {
  roomId: string;
  text: string;
  targetIds: string[];
  attachments: unknown[];
  userMessageId?: string;
  assistantMessageIds?: string[];
}): Promise<PostRoomMessageResponse> {
  return postJson<PostRoomMessageResponse>(`/rooms/${encodeURIComponent(input.roomId)}/messages`, {
    text: input.text,
    targetIds: input.targetIds,
    attachments: input.attachments,
    userMessageId: input.userMessageId,
    assistantMessageIds: input.assistantMessageIds,
  });
}

export async function createServerRoom(room: Room): Promise<void> {
  await postJson("/rooms", {
    id: room.id,
    title: room.title,
    memberIds: room.memberIds,
    badge: room.badge,
  });
}

export async function openServerDirectRoom(memberId: string, title?: string): Promise<void> {
  await postJson("/rooms/dm", { memberId, title });
}

export async function patchServerRoom(roomId: string, patch: Partial<Pick<Room, "title" | "pinned" | "badge">> & { archived?: boolean }): Promise<void> {
  await fetchJson(`/rooms/${encodeURIComponent(roomId)}`, {
    method: "PATCH",
    headers: bridgeHeaders(),
    body: JSON.stringify(patch),
  });
}

export async function addServerRoomMember(roomId: string, member: RoomMember): Promise<void> {
  await postJson(`/rooms/${encodeURIComponent(roomId)}/members`, member);
}

export async function removeServerRoomMember(roomId: string, memberId: string): Promise<void> {
  await fetchJson(`/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(memberId)}`, {
    method: "DELETE",
    headers: bridgeHeaders(false),
  });
}

export async function patchServerRoomMessage(roomId: string, messageId: string, patch: Partial<RoomMessage>): Promise<void> {
  await fetchJson(`/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`, {
    method: "PATCH",
    headers: bridgeHeaders(),
    body: JSON.stringify(patch),
  });
}

export function roomsFromServerSnapshot(snapshot: RoomsInitResponse): Room[] {
  const messagesByRoom = new Map<string, RoomMessage[]>();
  for (const message of snapshot.messages) {
    const messages = messagesByRoom.get(message.roomId) ?? [];
    messages.push(message);
    messagesByRoom.set(message.roomId, messages);
  }
  return snapshot.rooms.map((room) => ({
    ...room,
    messages: (messagesByRoom.get(room.id) ?? []).sort(messageSort),
  })).filter((room) => !room.archived);
}

export function applyRoomEvents(
  rooms: Room[],
  members: RoomMember[],
  events: RoomEvent[],
): { rooms: Room[]; members: RoomMember[] } {
  let nextRooms = rooms;
  let nextMembers = members;
  for (const event of events) {
    const room = readRoom(event.payload.room);
    const member = readMember(event.payload.member);
    const message = readMessage(event.payload.message);
    if (event.type === "room.created" && room) {
      nextRooms = room.archived ? nextRooms : upsertRoom(nextRooms, { ...room, messages: [] });
    } else if (event.type === "room.updated" && room) {
      nextRooms = room.archived
        ? nextRooms.filter((item) => item.id !== room.id)
        : nextRooms.map((item) => item.id === room.id ? { ...item, ...room, messages: item.messages } : item);
    } else if (event.type === "room.member.added" && member) {
      nextMembers = upsertMember(nextMembers, member);
      if (event.roomId) {
        nextRooms = nextRooms.map((item) => item.id === event.roomId && !item.memberIds.includes(member.id)
          ? { ...item, memberIds: [...item.memberIds, member.id] }
          : item);
      }
    } else if (event.type === "room.member.removed" && event.memberId) {
      nextRooms = nextRooms.map((item) => item.id === event.roomId
        ? { ...item, memberIds: item.memberIds.filter((id) => id !== event.memberId) }
        : item);
    } else if (event.type === "room.message.created" && message) {
      nextRooms = upsertRoomMessage(nextRooms, message.roomId, message);
      nextMembers = applyMessageMemberStatus(nextMembers, message);
    } else if (event.type === "room.message.updated" && message) {
      nextRooms = upsertRoomMessage(nextRooms, message.roomId, message);
      nextMembers = applyMessageMemberStatus(nextMembers, message);
    }
  }
  return { rooms: nextRooms, members: nextMembers };
}

function upsertRoom(rooms: Room[], room: Room): Room[] {
  const index = rooms.findIndex((item) => item.id === room.id);
  if (index < 0) return [room, ...rooms];
  return rooms.map((item) => item.id === room.id ? { ...room, messages: item.messages } : item);
}

function upsertMember(members: RoomMember[], member: RoomMember): RoomMember[] {
  return members.some((item) => item.id === member.id)
    ? members.map((item) => item.id === member.id ? { ...item, ...member } : item)
    : [...members, member];
}

function upsertRoomMessage(rooms: Room[], roomId: string, message: ServerRoomMessage): Room[] {
  return rooms.map((room) => {
    if (room.id !== roomId) return room;
    const existing = room.messages.some((item) => item.id === message.id);
    const messages = existing
      ? room.messages.map((item) => item.id === message.id ? { ...item, ...message } : item)
      : [...room.messages, message];
    return {
      ...room,
      updatedAt: message.updatedAt || message.createdAt || room.updatedAt,
      messages: messages.sort(messageSort),
    };
  });
}

function applyMessageMemberStatus(members: RoomMember[], message: ServerRoomMessage): RoomMember[] {
  if (message.senderType !== "agent") return members;
  const status = message.status === "running"
    ? "running"
    : message.status === "done"
      ? "done"
      : message.status === "failed" || message.status === "interrupted"
        ? "idle"
        : undefined;
  if (!status) return members;
  return members.map((member) => member.id === message.senderId ? { ...member, status, lastActive: "just now" } : member);
}

function messageSort(left: RoomMessage, right: RoomMessage): number {
  const leftSeq = typeof (left as ServerRoomMessage).channelSeq === "number" ? (left as ServerRoomMessage).channelSeq : 0;
  const rightSeq = typeof (right as ServerRoomMessage).channelSeq === "number" ? (right as ServerRoomMessage).channelSeq : 0;
  return leftSeq - rightSeq || left.createdAt.localeCompare(right.createdAt);
}

function readRoom(value: unknown): Omit<Room, "messages"> | null {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"
    ? value as Omit<Room, "messages">
    : null;
}

function readMember(value: unknown): RoomMember | null {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"
    ? value as RoomMember
    : null;
}

function readMessage(value: unknown): ServerRoomMessage | null {
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string"
    ? value as ServerRoomMessage
    : null;
}
