import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeState } from "../bridge-types.js";
import { record } from "../http-utils.js";
import type { RoomChannelMember, RoomMessageStatus } from "../../rooms/channel-store.js";
import { scheduleRoomAssistantRuns } from "../room-runs.js";

export async function handleRoomsRoute(input: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson: (response: ServerResponse, status: number, data: unknown) => void;
  readJsonBody: (request: IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const { request, response, url, state, sendJson, readJsonBody } = input;

  if (request.method === "GET" && url.pathname === "/rooms") {
    sendJson(response, 200, { ok: true, ...state.app.rooms.getInit(readPositiveInt(url.searchParams.get("limit"), 80)) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/rooms") {
    const body = record(await readJsonBody(request));
    const room = state.app.rooms.createRoom({
      id: readOptionalString(body.id),
      title: readString(body.title),
      memberIds: readStringArray(body.memberIds),
      badge: readString(body.badge),
    });
    state.store.saveFrom(state.app);
    sendJson(response, 200, { ok: true, room, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/rooms/dm") {
    const body = record(await readJsonBody(request));
    const room = state.app.rooms.openDirect({
      memberId: readString(body.memberId),
      title: readString(body.title),
    });
    state.store.saveFrom(state.app);
    sendJson(response, 200, { ok: true, room, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/rooms/events") {
    const result = state.app.rooms.eventsAfter(
      readPositiveInt(url.searchParams.get("afterEventSeq"), 0),
      readPositiveInt(url.searchParams.get("limit"), 200),
    );
    sendJson(response, 200, { ok: true, ...result });
    return true;
  }

  const roomAction = url.pathname.match(/^\/rooms\/([^/]+)$/);
  if (roomAction && request.method === "PATCH") {
    const [, encodedRoomId] = roomAction;
    const body = record(await readJsonBody(request));
    const room = state.app.rooms.patchRoom(decodeURIComponent(encodedRoomId), {
      title: readOptionalString(body.title),
      pinned: readOptionalBoolean(body.pinned),
      archived: readOptionalBoolean(body.archived),
      badge: readOptionalString(body.badge),
    });
    state.store.saveFrom(state.app);
    sendJson(response, 200, { ok: true, room, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  const membersAction = url.pathname.match(/^\/rooms\/([^/]+)\/members$/);
  if (membersAction && request.method === "POST") {
    const [, encodedRoomId] = membersAction;
    const member = state.app.rooms.addMember(decodeURIComponent(encodedRoomId), normalizeMember(record(await readJsonBody(request))));
    state.store.saveFrom(state.app);
    sendJson(response, 200, { ok: true, member, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  const memberAction = url.pathname.match(/^\/rooms\/([^/]+)\/members\/([^/]+)$/);
  if (memberAction && request.method === "DELETE") {
    const [, encodedRoomId, encodedMemberId] = memberAction;
    const room = state.app.rooms.removeMember(decodeURIComponent(encodedRoomId), decodeURIComponent(encodedMemberId));
    state.store.saveFrom(state.app);
    sendJson(response, 200, { ok: true, room, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  const messagesAction = url.pathname.match(/^\/rooms\/([^/]+)\/messages$/);
  if (messagesAction && request.method === "GET") {
    const [, encodedRoomId] = messagesAction;
    const messages = state.app.rooms.listMessages(decodeURIComponent(encodedRoomId), {
      limit: readPositiveInt(url.searchParams.get("limit"), 80),
      beforeSeq: readOptionalPositiveInt(url.searchParams.get("beforeSeq")),
      afterSeq: readOptionalPositiveInt(url.searchParams.get("afterSeq")),
    });
    sendJson(response, 200, { ok: true, messages, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  if (messagesAction && request.method === "POST") {
    const [, encodedRoomId] = messagesAction;
    const roomId = decodeURIComponent(encodedRoomId);
    const body = record(await readJsonBody(request));
    const text = readString(body.text);
    const targetIds = resolveVisibleRoomTargets(state, roomId, text, readStringArray(body.targetIds));
    const assistantTargets = targetIds
      .map((id) => state.app.rooms.listMembers().find((member) => member.id === id))
      .filter((member): member is RoomChannelMember => Boolean(member));
    const result = state.app.rooms.postUserMessage({
      roomId,
      text,
      targetIds,
      attachments: Array.isArray(body.attachments) ? body.attachments as never : undefined,
      assistantTargets,
      userMessageId: readOptionalString(body.userMessageId),
      assistantMessageIds: readStringArray(body.assistantMessageIds),
    });
    state.store.saveFrom(state.app);
    const scheduledMessages = scheduleRoomAssistantRuns(state, {
      roomId,
      userMessageId: result.userMessage.id,
      prompt: result.userMessage.text,
      targets: assistantTargets,
      assistantMessages: result.assistantMessages,
    });
    if (scheduledMessages.length) {
      result.assistantMessages = scheduledMessages;
      state.store.saveFrom(state.app);
    }
    sendJson(response, 200, { ok: true, ...result });
    return true;
  }

  const messageAction = url.pathname.match(/^\/rooms\/([^/]+)\/messages\/([^/]+)$/);
  if (messageAction && request.method === "PATCH") {
    const [, encodedRoomId, encodedMessageId] = messageAction;
    const body = record(await readJsonBody(request));
    const message = state.app.rooms.updateMessage(decodeURIComponent(encodedRoomId), decodeURIComponent(encodedMessageId), {
      text: readOptionalString(body.text),
      status: readMessageStatus(body.status),
      runId: readOptionalString(body.runId),
      duration: readOptionalString(body.duration),
      startedAt: readOptionalString(body.startedAt),
      finishedAt: readOptionalString(body.finishedAt),
      parts: Array.isArray(body.parts) ? body.parts as never : undefined,
    });
    state.store.saveFrom(state.app);
    sendJson(response, 200, { ok: true, message, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  return false;
}

function normalizeMember(input: Record<string, unknown>): RoomChannelMember {
  const id = readString(input.id);
  if (!id) throw new Error("member_id_required");
  return {
    id,
    name: readString(input.name) || id,
    kernel: readString(input.kernel) || id,
    model: readString(input.model) || "native",
    role: readString(input.role) || "member",
    status: readMemberStatus(input.status),
    color: readString(input.color) || "#64748b",
    lastActive: readString(input.lastActive) || "now",
    source: input.source === "remote" || input.source === "human" ? input.source : "local",
    sourceLabel: readOptionalString(input.sourceLabel),
    disabled: input.disabled === true,
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map((item) => readString(item)).filter(Boolean))] : [];
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readPositiveInt(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : undefined;
}

function readMemberStatus(value: unknown): RoomChannelMember["status"] {
  return value === "running" || value === "done" || value === "waiting" || value === "offline" ? value : "idle";
}

function readMessageStatus(value: unknown): RoomMessageStatus | undefined {
  return value === "sent" || value === "running" || value === "done" || value === "failed" || value === "interrupted"
    ? value
    : undefined;
}

function resolveVisibleRoomTargets(
  state: BridgeState,
  roomId: string,
  text: string,
  requestedTargetIds: string[],
): string[] {
  const room = state.app.rooms.getRoom(roomId);
  if (!room) return [];
  if (room.kind === "direct") {
    return room.directMemberId ? [room.directMemberId] : room.memberIds.slice(0, 1);
  }

  const members = state.app.rooms.listMembers().filter((member) => room.memberIds.includes(member.id));
  const normalized = text.toLowerCase();
  if (/@all\b/i.test(text) || /@(所有人|全部)/.test(text)) {
    return members.filter((member) => member.status !== "offline").map((member) => member.id);
  }

  const requested = new Set(requestedTargetIds);
  return members
    .filter((member) => {
      if (requested.size > 0 && !requested.has(member.id)) return false;
      const aliases = [member.name, member.id, member.kernel]
        .filter(Boolean)
        .map((value) => `@${value.toLowerCase()}`);
      return aliases.some((alias) => normalized.includes(alias));
    })
    .map((member) => member.id);
}
