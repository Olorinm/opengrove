import type { AgentAttachmentContext, JsonObject } from "../core.js";

export type RoomMemberStatus = "idle" | "running" | "done" | "waiting" | "offline";
export type RoomMessageStatus = "sent" | "running" | "done" | "failed" | "interrupted";
export type RoomKind = "group" | "direct";
export type RoomMemberSource = "local" | "remote" | "human";

export interface RoomChannelMember {
  id: string;
  name: string;
  kernel: string;
  model: string;
  role: string;
  status: RoomMemberStatus;
  color: string;
  lastActive: string;
  source?: RoomMemberSource;
  sourceLabel?: string;
  disabled?: boolean;
}

export interface RoomChannelRoom {
  id: string;
  kind: RoomKind;
  title: string;
  badge: string;
  memberIds: string[];
  directMemberId?: string;
  pinned?: boolean;
  archived?: boolean;
  updatedAt: string;
  unread: number;
}

export interface RoomChannelMessage {
  id: string;
  roomId: string;
  channelSeq: number;
  senderId: string;
  senderName: string;
  senderType: "user" | "agent" | "system";
  text: string;
  targetIds: string[];
  status: RoomMessageStatus;
  createdAt: string;
  updatedAt: string;
  attachments?: AgentAttachmentContext[];
  duration?: string;
  runId?: string;
  parts?: JsonObject[];
  startedAt?: string;
  finishedAt?: string;
}

export type RoomChannelEventType =
  | "room.created"
  | "room.updated"
  | "room.member.added"
  | "room.member.removed"
  | "room.message.created"
  | "room.message.updated";

export interface RoomChannelEvent {
  eventSeq: number;
  type: RoomChannelEventType;
  roomId: string;
  messageId?: string;
  memberId?: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface RoomChannelSnapshot {
  version: 1;
  currentEventSeq: number;
  rooms: RoomChannelRoom[];
  members: RoomChannelMember[];
  messages: RoomChannelMessage[];
  events: RoomChannelEvent[];
}

export interface RoomChannelInit {
  rooms: RoomChannelRoom[];
  members: RoomChannelMember[];
  messages: RoomChannelMessage[];
  currentEventSeq: number;
}

export interface PostRoomMessageResult {
  room: RoomChannelRoom;
  userMessage: RoomChannelMessage;
  assistantMessages: RoomChannelMessage[];
  currentEventSeq: number;
}

const EVENT_RETENTION_LIMIT = 5_000;
const RECENT_MESSAGE_LIMIT = 80;

export class RoomChannelStore {
  private rooms = new Map<string, RoomChannelRoom>();
  private members = new Map<string, RoomChannelMember>();
  private messagesByRoom = new Map<string, RoomChannelMessage[]>();
  private events: RoomChannelEvent[] = [];
  private currentEventSeq = 0;

  restore(snapshot: RoomChannelSnapshot | undefined): void {
    this.rooms.clear();
    this.members.clear();
    this.messagesByRoom.clear();
    this.events = [];
    this.currentEventSeq = 0;

    const normalized = normalizeRoomChannelSnapshot(snapshot);
    this.currentEventSeq = normalized.currentEventSeq;
    for (const member of normalized.members) {
      this.members.set(member.id, member);
    }
    for (const room of normalized.rooms) {
      this.rooms.set(room.id, room);
      this.messagesByRoom.set(room.id, []);
    }
    for (const message of normalized.messages) {
      const bucket = this.messagesByRoom.get(message.roomId) ?? [];
      bucket.push(message);
      this.messagesByRoom.set(message.roomId, bucket);
    }
    for (const [roomId, bucket] of this.messagesByRoom) {
      bucket.sort((left, right) => left.channelSeq - right.channelSeq);
      this.messagesByRoom.set(roomId, bucket);
    }
    this.events = normalized.events
      .slice(-EVENT_RETENTION_LIMIT)
      .sort((left, right) => left.eventSeq - right.eventSeq);
  }

  snapshot(): RoomChannelSnapshot {
    return {
      version: 1,
      currentEventSeq: this.currentEventSeq,
      rooms: this.listRooms(),
      members: this.listMembers(),
      messages: [...this.messagesByRoom.values()].flatMap((messages) => messages.map((message) => ({ ...message }))),
      events: this.events.map((event) => ({ ...event, payload: { ...event.payload } })),
    };
  }

  ensureOpenGroup(seedMembers: RoomChannelMember[]): void {
    for (const member of seedMembers) {
      this.upsertMember(member, { emitEvent: false });
    }
    if (this.rooms.size > 0) return;
    const createdAt = nowIso();
    const room: RoomChannelRoom = {
      id: "room-open-group",
      kind: "group",
      title: "open group",
      badge: "Project",
      memberIds: seedMembers.map((member) => member.id),
      pinned: false,
      archived: false,
      unread: 0,
      updatedAt: createdAt,
    };
    this.rooms.set(room.id, room);
    this.messagesByRoom.set(room.id, [{
      id: "seed-open-system",
      roomId: room.id,
      channelSeq: 1,
      senderId: "system",
      senderName: "System",
      senderType: "system",
      text: "open group created. Mention a member or @all to route work through OpenGrove.",
      targetIds: [],
      status: "done",
      createdAt,
      updatedAt: createdAt,
    }]);
    this.emit("room.created", room.id, { room });
    this.emit("room.message.created", room.id, { message: this.messagesByRoom.get(room.id)?.[0] }, { messageId: "seed-open-system" });
  }

  getInit(limit = RECENT_MESSAGE_LIMIT): RoomChannelInit {
    const rooms = this.listRooms();
    const messages = rooms.flatMap((room) => this.listMessages(room.id, { limit }));
    return {
      rooms,
      members: this.listMembers(),
      messages,
      currentEventSeq: this.currentEventSeq,
    };
  }

  listRooms(): RoomChannelRoom[] {
    return [...this.rooms.values()]
      .map((room) => ({ ...room, memberIds: [...room.memberIds] }))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  listMembers(): RoomChannelMember[] {
    return [...this.members.values()].map((member) => ({ ...member }));
  }

  getRoom(roomId: string): RoomChannelRoom | undefined {
    const room = this.rooms.get(roomId);
    return room ? { ...room, memberIds: [...room.memberIds] } : undefined;
  }

  listMessages(roomId: string, options: { limit?: number; beforeSeq?: number; afterSeq?: number } = {}): RoomChannelMessage[] {
    let messages = [...(this.messagesByRoom.get(roomId) ?? [])];
    if (typeof options.beforeSeq === "number") {
      messages = messages.filter((message) => message.channelSeq < options.beforeSeq!);
    }
    if (typeof options.afterSeq === "number") {
      messages = messages.filter((message) => message.channelSeq > options.afterSeq!);
    }
    const limit = Math.max(0, Math.min(options.limit ?? RECENT_MESSAGE_LIMIT, 500));
    if (limit > 0) {
      messages = messages.slice(-limit);
    }
    return messages.map(cloneMessage);
  }

  eventsAfter(afterEventSeq: number, limit = 200): { events: RoomChannelEvent[]; currentEventSeq: number; hasMore: boolean } {
    const normalizedLimit = Math.max(1, Math.min(limit, 1_000));
    const matches = this.events.filter((event) => event.eventSeq > afterEventSeq);
    return {
      events: matches.slice(0, normalizedLimit).map(cloneEvent),
      currentEventSeq: this.currentEventSeq,
      hasMore: matches.length > normalizedLimit,
    };
  }

  createRoom(input: { id?: string; title?: string; memberIds?: string[]; badge?: string }): RoomChannelRoom {
    const createdAt = nowIso();
    const room: RoomChannelRoom = {
      id: input.id?.trim() || createId("room"),
      kind: "group",
      title: input.title?.trim() || "new group",
      badge: input.badge?.trim() || "Group",
      memberIds: uniqueIds(input.memberIds ?? []).filter((id) => this.members.has(id)),
      pinned: false,
      archived: false,
      unread: 0,
      updatedAt: createdAt,
    };
    this.rooms.set(room.id, room);
    this.messagesByRoom.set(room.id, []);
    this.emit("room.created", room.id, { room });
    return { ...room, memberIds: [...room.memberIds] };
  }

  openDirect(input: { memberId: string; title?: string }): RoomChannelRoom {
    const memberId = input.memberId.trim();
    if (!memberId) throw new Error("member_id_required");
    const existing = [...this.rooms.values()].find((room) => room.kind === "direct" && room.directMemberId === memberId);
    if (existing) return { ...existing, memberIds: [...existing.memberIds] };
    const member = this.members.get(memberId);
    if (!member) throw new Error("member_not_found");
    const createdAt = nowIso();
    const room: RoomChannelRoom = {
      id: `direct-${memberId}`,
      kind: "direct",
      title: input.title?.trim() || member.name,
      badge: "DM",
      memberIds: [memberId],
      directMemberId: memberId,
      pinned: false,
      archived: false,
      unread: 0,
      updatedAt: createdAt,
    };
    this.rooms.set(room.id, room);
    this.messagesByRoom.set(room.id, []);
    this.emit("room.created", room.id, { room });
    return { ...room, memberIds: [...room.memberIds] };
  }

  patchRoom(roomId: string, patch: { title?: string; pinned?: boolean; archived?: boolean; badge?: string }): RoomChannelRoom {
    const room = this.requireRoom(roomId);
    const updated: RoomChannelRoom = {
      ...room,
      title: patch.title === undefined ? room.title : patch.title.trim() || room.title,
      pinned: patch.pinned === undefined ? room.pinned : patch.pinned,
      archived: patch.archived === undefined ? room.archived : patch.archived,
      badge: patch.badge === undefined ? room.badge : patch.badge.trim(),
      updatedAt: nowIso(),
    };
    this.rooms.set(roomId, updated);
    this.emit("room.updated", roomId, { room: updated });
    return { ...updated, memberIds: [...updated.memberIds] };
  }

  upsertMember(member: RoomChannelMember, options: { emitEvent?: boolean } = {}): RoomChannelMember {
    const normalized = normalizeMember(member);
    this.members.set(normalized.id, normalized);
    if (options.emitEvent) {
      this.emit("room.member.added", "", { member: normalized }, { memberId: normalized.id });
    }
    return { ...normalized };
  }

  addMember(roomId: string, member: RoomChannelMember): RoomChannelMember {
    const normalized = this.upsertMember(member);
    const room = this.requireRoom(roomId);
    if (!room.memberIds.includes(normalized.id)) {
      const updated = { ...room, memberIds: [...room.memberIds, normalized.id], updatedAt: nowIso() };
      this.rooms.set(roomId, updated);
    }
    this.emit("room.member.added", roomId, { member: normalized }, { memberId: normalized.id });
    return normalized;
  }

  removeMember(roomId: string, memberId: string): RoomChannelRoom {
    const room = this.requireRoom(roomId);
    const updated = {
      ...room,
      memberIds: room.memberIds.filter((id) => id !== memberId),
      updatedAt: nowIso(),
    };
    this.rooms.set(roomId, updated);
    this.emit("room.member.removed", roomId, { memberId }, { memberId });
    return { ...updated, memberIds: [...updated.memberIds] };
  }

  postUserMessage(input: {
    roomId: string;
    text: string;
    targetIds?: string[];
    attachments?: AgentAttachmentContext[];
    assistantTargets?: RoomChannelMember[];
    userMessageId?: string;
    assistantMessageIds?: string[];
  }): PostRoomMessageResult {
    const room = this.requireRoom(input.roomId);
    const targetIds = uniqueIds(input.targetIds ?? []);
    const userMessage = this.createMessage({
      roomId: room.id,
      senderId: "user",
      senderName: "You",
      senderType: "user",
      text: input.text,
      targetIds,
      status: "sent",
      attachments: input.attachments,
      id: input.userMessageId,
    });
    const assistantMessages = (input.assistantTargets ?? [])
      .filter((target) => target.id && targetIds.includes(target.id))
      .map((target, index) => this.createMessage({
        roomId: room.id,
        senderId: target.id,
        senderName: target.name,
        senderType: "agent",
        text: "",
        targetIds: [],
        status: "running",
        startedAt: nowIso(),
        id: input.assistantMessageIds?.[index],
      }));
    const updatedRoom = this.touchRoom(room.id);
    return {
      room: updatedRoom,
      userMessage,
      assistantMessages,
      currentEventSeq: this.currentEventSeq,
    };
  }

  createAssistantPlaceholder(input: {
    roomId: string;
    target: RoomChannelMember;
    runId?: string;
  }): RoomChannelMessage {
    return this.createMessage({
      roomId: input.roomId,
      senderId: input.target.id,
      senderName: input.target.name,
      senderType: "agent",
      text: "",
      targetIds: [],
      status: "running",
      runId: input.runId,
      startedAt: nowIso(),
    });
  }

  updateMessage(roomId: string, messageId: string, patch: Partial<Omit<RoomChannelMessage, "id" | "roomId" | "channelSeq" | "createdAt">>): RoomChannelMessage {
    const bucket = this.messagesByRoom.get(roomId);
    if (!bucket) throw new Error("room_not_found");
    const index = bucket.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error("message_not_found");
    const updated: RoomChannelMessage = {
      ...bucket[index]!,
      ...patch,
      updatedAt: nowIso(),
    };
    bucket[index] = updated;
    this.touchRoom(roomId);
    this.emit("room.message.updated", roomId, { message: updated }, { messageId });
    return cloneMessage(updated);
  }

  private createMessage(input: Omit<RoomChannelMessage, "id" | "channelSeq" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string }): RoomChannelMessage {
    const room = this.requireRoom(input.roomId);
    const bucket = this.messagesByRoom.get(room.id) ?? [];
    const createdAt = input.createdAt ?? nowIso();
    const message: RoomChannelMessage = {
      ...input,
      id: input.id ?? createId("msg"),
      channelSeq: nextChannelSeq(bucket),
      createdAt,
      updatedAt: createdAt,
      targetIds: uniqueIds(input.targetIds ?? []),
    };
    bucket.push(message);
    this.messagesByRoom.set(room.id, bucket);
    this.emit("room.message.created", room.id, { message }, { messageId: message.id });
    return cloneMessage(message);
  }

  private touchRoom(roomId: string): RoomChannelRoom {
    const room = this.requireRoom(roomId);
    const updated = { ...room, updatedAt: nowIso() };
    this.rooms.set(roomId, updated);
    return { ...updated, memberIds: [...updated.memberIds] };
  }

  private requireRoom(roomId: string): RoomChannelRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("room_not_found");
    return room;
  }

  private emit(type: RoomChannelEventType, roomId: string, payload: Record<string, unknown>, refs: { messageId?: string; memberId?: string } = {}): RoomChannelEvent {
    const event: RoomChannelEvent = {
      eventSeq: this.currentEventSeq + 1,
      type,
      roomId,
      messageId: refs.messageId,
      memberId: refs.memberId,
      createdAt: nowIso(),
      payload,
    };
    this.currentEventSeq = event.eventSeq;
    this.events.push(event);
    if (this.events.length > EVENT_RETENTION_LIMIT) {
      this.events = this.events.slice(-EVENT_RETENTION_LIMIT);
    }
    return event;
  }
}

export function normalizeRoomChannelSnapshot(input: unknown): RoomChannelSnapshot {
  const object = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<RoomChannelSnapshot>
    : {};
  const rooms = Array.isArray(object.rooms) ? object.rooms.map(normalizeRoom).filter(isDefined) : [];
  const members = Array.isArray(object.members) ? object.members.map(normalizeMember).filter(isDefined) : [];
  const roomIds = new Set(rooms.map((room) => room.id));
  const messages = Array.isArray(object.messages)
    ? object.messages.map(normalizeMessage).filter((message): message is RoomChannelMessage => Boolean(message && roomIds.has(message.roomId)))
    : [];
  const events = Array.isArray(object.events)
    ? object.events.map(normalizeEvent).filter(isDefined)
    : [];
  const maxEventSeq = events.reduce((max, event) => Math.max(max, event.eventSeq), 0);
  const requestedEventSeq = typeof object.currentEventSeq === "number" ? object.currentEventSeq : 0;
  return {
    version: 1,
    currentEventSeq: Math.max(requestedEventSeq, maxEventSeq),
    rooms,
    members,
    messages,
    events,
  };
}

function normalizeRoom(input: Partial<RoomChannelRoom>): RoomChannelRoom | undefined {
  const id = readString(input.id);
  if (!id) return undefined;
  return {
    id,
    kind: input.kind === "direct" ? "direct" : "group",
    title: readString(input.title) || "room",
    badge: readString(input.badge),
    memberIds: uniqueIds(Array.isArray(input.memberIds) ? input.memberIds : []),
    directMemberId: readOptionalString(input.directMemberId),
    pinned: Boolean(input.pinned),
    archived: Boolean(input.archived),
    updatedAt: readString(input.updatedAt) || nowIso(),
    unread: Number.isFinite(input.unread) ? Number(input.unread) : 0,
  };
}

function normalizeMember(input: Partial<RoomChannelMember>): RoomChannelMember {
  const id = readString(input.id) || createId("member");
  return {
    id,
    name: readString(input.name) || id,
    kernel: readString(input.kernel) || id,
    model: readString(input.model) || "native",
    role: readString(input.role) || "member",
    status: normalizeMemberStatus(input.status),
    color: readString(input.color) || "#64748b",
    lastActive: readString(input.lastActive) || "idle",
    source: normalizeMemberSource(input.source),
    sourceLabel: readOptionalString(input.sourceLabel),
    disabled: Boolean(input.disabled),
  };
}

function normalizeMessage(input: Partial<RoomChannelMessage>): RoomChannelMessage | undefined {
  const id = readString(input.id);
  const roomId = readString(input.roomId);
  if (!id || !roomId) return undefined;
  const createdAt = readString(input.createdAt) || nowIso();
  return {
    id,
    roomId,
    channelSeq: Number.isFinite(input.channelSeq) ? Number(input.channelSeq) : 0,
    senderId: readString(input.senderId) || "system",
    senderName: readString(input.senderName) || "System",
    senderType: input.senderType === "agent" || input.senderType === "user" ? input.senderType : "system",
    text: readString(input.text),
    targetIds: uniqueIds(Array.isArray(input.targetIds) ? input.targetIds : []),
    status: normalizeMessageStatus(input.status),
    createdAt,
    updatedAt: readString(input.updatedAt) || createdAt,
    attachments: Array.isArray(input.attachments) ? input.attachments : undefined,
    duration: readOptionalString(input.duration),
    runId: readOptionalString(input.runId),
    parts: Array.isArray(input.parts) ? input.parts : undefined,
    startedAt: readOptionalString(input.startedAt),
    finishedAt: readOptionalString(input.finishedAt),
  };
}

function normalizeEvent(input: Partial<RoomChannelEvent>): RoomChannelEvent | undefined {
  const eventSeq = Number(input.eventSeq);
  const type = readString(input.type);
  const roomId = readString(input.roomId);
  if (!Number.isFinite(eventSeq) || eventSeq <= 0 || !isEventType(type) || !roomId) return undefined;
  return {
    eventSeq,
    type,
    roomId,
    messageId: readOptionalString(input.messageId),
    memberId: readOptionalString(input.memberId),
    createdAt: readString(input.createdAt) || nowIso(),
    payload: input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? input.payload as Record<string, unknown>
      : {},
  };
}

function cloneMessage(message: RoomChannelMessage): RoomChannelMessage {
  return {
    ...message,
    targetIds: [...message.targetIds],
    attachments: message.attachments ? [...message.attachments] : undefined,
    parts: message.parts ? [...message.parts] : undefined,
  };
}

function cloneEvent(event: RoomChannelEvent): RoomChannelEvent {
  return { ...event, payload: { ...event.payload } };
}

function nextChannelSeq(messages: RoomChannelMessage[]): number {
  return messages.reduce((max, message) => Math.max(max, message.channelSeq), 0) + 1;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
  const text = readString(value);
  return text || undefined;
}

function normalizeMemberStatus(value: unknown): RoomMemberStatus {
  return value === "running" || value === "done" || value === "waiting" || value === "offline" ? value : "idle";
}

function normalizeMemberSource(value: unknown): RoomMemberSource | undefined {
  return value === "remote" || value === "human" || value === "local" ? value : undefined;
}

function normalizeMessageStatus(value: unknown): RoomMessageStatus {
  return value === "running" || value === "done" || value === "failed" || value === "interrupted" ? value : "sent";
}

function isEventType(value: string): value is RoomChannelEventType {
  return [
    "room.created",
    "room.updated",
    "room.member.added",
    "room.member.removed",
    "room.message.created",
    "room.message.updated",
  ].includes(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
