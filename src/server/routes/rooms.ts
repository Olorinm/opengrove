import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentAttachmentContext, JsonObject } from "../../core.js";
import type { BridgeState } from "../bridge-types.js";
import { record } from "../http-utils.js";
import type { RoomChannelMatrixBinding, RoomChannelMember, RoomChannelMessage, RoomMessageStatus } from "../../rooms/channel-store.js";
import { isRunnableRoomAssistantTarget, scheduleRoomAssistantRuns } from "../room-runs.js";
import { matrixReady, publishMatrixRoomEvent } from "./matrix-invites.js";

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
      matrix: readMatrixBinding(body.matrix),
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
      matrix: Object.prototype.hasOwnProperty.call(body, "matrix") ? readMatrixBinding(body.matrix) ?? null : undefined,
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

  if (request.method === "POST" && url.pathname === "/rooms/members") {
    const member = state.app.rooms.upsertMember(normalizeMember(record(await readJsonBody(request))), { emitEvent: true });
    state.store.saveFrom(state.app);
    sendJson(response, 200, { ok: true, member, currentEventSeq: state.app.rooms.snapshot().currentEventSeq });
    return true;
  }

  const globalMemberAction = url.pathname.match(/^\/rooms\/members\/([^/]+)$/);
  if (globalMemberAction && request.method === "PATCH") {
    const [, encodedMemberId] = globalMemberAction;
    const member = state.app.rooms.patchMember(decodeURIComponent(encodedMemberId), normalizeMemberPatch(record(await readJsonBody(request))));
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
      attachments: readAttachments(body.attachments),
      assistantTargets,
      userMessageId: readOptionalString(body.userMessageId),
      assistantMessageIds: readStringArray(body.assistantMessageIds),
    });
    state.store.saveFrom(state.app);
    const runnablePairs = result.assistantMessages
      .map((message, index) => ({ message, target: assistantTargets[index] }))
      .filter((pair): pair is { message: RoomChannelMessage; target: RoomChannelMember } => (
        Boolean(pair.target && isRunnableRoomAssistantTarget(pair.target))
      ));
    const scheduledMessages = scheduleRoomAssistantRuns(state, {
      roomId,
      userMessageId: result.userMessage.id,
      prompt: result.userMessage.text,
      targets: runnablePairs.map((pair) => pair.target),
      assistantMessages: runnablePairs.map((pair) => pair.message),
    });
    const updatedMessages = new Map(scheduledMessages.map((message) => [message.id, message]));
    for (const [index, message] of result.assistantMessages.entries()) {
      const target = assistantTargets[index];
      if (!target || updatedMessages.has(message.id)) continue;
      const fallback = await deliverNonLocalRoomTarget(state, {
        roomId,
        prompt: result.userMessage.text,
        attachments: readAttachments(body.attachments) ?? [],
        target,
        assistantMessage: message,
      });
      updatedMessages.set(fallback.id, fallback);
    }
    if (updatedMessages.size) {
      result.assistantMessages = result.assistantMessages.map((message) => updatedMessages.get(message.id) ?? message);
      result.currentEventSeq = state.app.rooms.snapshot().currentEventSeq;
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
      matrixEventId: readOptionalString(body.matrixEventId),
      matrixTurnId: readOptionalString(body.matrixTurnId),
      parts: readJsonObjects(body.parts),
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
    avatarDataUrl: readOptionalString(input.avatarDataUrl),
    source: readMemberSource(input.source) ?? "local",
    sourceLabel: readOptionalString(input.sourceLabel),
    inviteStatus: readInviteStatus(input.inviteStatus),
    homeNodeLabel: readOptionalString(input.homeNodeLabel),
    matrixUserId: readOptionalString(input.matrixUserId),
    matrixAgentId: readOptionalString(input.matrixAgentId),
    disabled: input.disabled === true,
  };
}

function normalizeMemberPatch(input: Record<string, unknown>): Partial<Omit<RoomChannelMember, "id">> {
  const patch: Partial<Omit<RoomChannelMember, "id">> = {};
  if (Object.prototype.hasOwnProperty.call(input, "name")) patch.name = readString(input.name);
  if (Object.prototype.hasOwnProperty.call(input, "kernel")) patch.kernel = readString(input.kernel);
  if (Object.prototype.hasOwnProperty.call(input, "model")) patch.model = readString(input.model);
  if (Object.prototype.hasOwnProperty.call(input, "role")) patch.role = readString(input.role);
  if (Object.prototype.hasOwnProperty.call(input, "status")) patch.status = readMemberStatus(input.status);
  if (Object.prototype.hasOwnProperty.call(input, "color")) patch.color = readString(input.color);
  if (Object.prototype.hasOwnProperty.call(input, "lastActive")) patch.lastActive = readString(input.lastActive);
  if (Object.prototype.hasOwnProperty.call(input, "avatarDataUrl")) patch.avatarDataUrl = readOptionalString(input.avatarDataUrl);
  if (Object.prototype.hasOwnProperty.call(input, "source")) patch.source = readMemberSource(input.source);
  if (Object.prototype.hasOwnProperty.call(input, "sourceLabel")) patch.sourceLabel = readOptionalString(input.sourceLabel);
  if (Object.prototype.hasOwnProperty.call(input, "inviteStatus")) patch.inviteStatus = readInviteStatus(input.inviteStatus);
  if (Object.prototype.hasOwnProperty.call(input, "homeNodeLabel")) patch.homeNodeLabel = readOptionalString(input.homeNodeLabel);
  if (Object.prototype.hasOwnProperty.call(input, "matrixUserId")) patch.matrixUserId = readOptionalString(input.matrixUserId);
  if (Object.prototype.hasOwnProperty.call(input, "matrixAgentId")) patch.matrixAgentId = readOptionalString(input.matrixAgentId);
  if (Object.prototype.hasOwnProperty.call(input, "disabled")) patch.disabled = input.disabled === true;
  return patch;
}

async function deliverNonLocalRoomTarget(
  state: BridgeState,
  input: {
    roomId: string;
    prompt: string;
    attachments: AgentAttachmentContext[];
    target: RoomChannelMember;
    assistantMessage: { id: string; matrixTurnId?: string; runId?: string };
  },
) {
  const room = state.app.rooms.getRoom(input.roomId);
  if (input.target.disabled) {
    return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
      text: `${input.target.name} 已被移除，不能参与这次对话。`,
      status: "done",
      finishedAt: new Date().toISOString(),
    });
  }
  if (input.target.source === "human") {
    return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
      text: `${input.target.name} 是人类成员，不会自动执行 agent 回复。`,
      status: "done",
      finishedAt: new Date().toISOString(),
    });
  }

  const turnId = input.assistantMessage.matrixTurnId || input.assistantMessage.runId || input.assistantMessage.id;
  if (
    input.target.source === "remote"
    && room?.matrix
    && input.target.matrixUserId
    && input.target.matrixAgentId
    && matrixReady(state.settings.matrix)
  ) {
    try {
      const eventId = await publishMatrixRoomEvent(
        state.settings.matrix,
        room.matrix.roomId,
        "org.opengrove.agent.request",
        {
          version: 1,
          turnId,
          prompt: input.prompt,
          attachments: input.attachments,
          target: {
            ownerUserId: input.target.matrixUserId,
            agentId: input.target.matrixAgentId,
          },
        },
        `agent-request-${turnId}`,
      );
      return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
        status: "running",
        startedAt: new Date().toISOString(),
        matrixEventId: eventId,
        matrixTurnId: turnId,
      });
    } catch (error) {
      return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
        text: error instanceof Error ? error.message : String(error),
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
    }
  }

  return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
    text: `${input.target.name} 是远端成员，当前没有可用的 Matrix 投递通道。`,
    status: "done",
    finishedAt: new Date().toISOString(),
  });
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

function readMatrixBinding(value: unknown): RoomChannelMatrixBinding | undefined {
  const input = record(value);
  const homeserverUrl = readString(input.homeserverUrl);
  const roomId = readString(input.roomId);
  if (!homeserverUrl || !roomId) return undefined;
  return {
    homeserverUrl,
    roomId,
    localMemberId: readOptionalString(input.localMemberId),
    mode: input.mode === "guest" ? "guest" : "host",
  };
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

function readMemberSource(value: unknown): RoomChannelMember["source"] {
  return value === "remote" || value === "human" || value === "local" ? value : undefined;
}

function readInviteStatus(value: unknown): RoomChannelMember["inviteStatus"] {
  return value === "none" || value === "pending" || value === "accepted" || value === "revoked" || value === "expired"
    ? value
    : undefined;
}

function readMessageStatus(value: unknown): RoomMessageStatus | undefined {
  return value === "sent" || value === "running" || value === "done" || value === "failed" || value === "interrupted"
    ? value
    : undefined;
}

function readAttachments(value: unknown): AgentAttachmentContext[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments: AgentAttachmentContext[] = [];
  for (const item of value) {
    const input = record(item);
    const kind = input.kind === "image" || input.kind === "text" || input.kind === "file" ? input.kind : undefined;
    const name = readString(input.name);
    if (!kind || !name) continue;
    const size = Number(input.size);
    attachments.push({
      id: readOptionalString(input.id),
      name,
      kind,
      mimeType: readOptionalString(input.mimeType),
      size: Number.isFinite(size) && size >= 0 ? size : undefined,
      text: readOptionalString(input.text),
      dataUrl: readOptionalString(input.dataUrl),
      localPath: readOptionalString(input.localPath),
    });
  }
  return attachments.length ? attachments : undefined;
}

function readJsonObjects(value: unknown): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isJsonObject);
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
    const directMemberId = room.directMemberId ?? room.memberIds[0];
    const member = directMemberId ? state.app.rooms.listMembers().find((item) => item.id === directMemberId) : undefined;
    return member && !member.disabled && member.status !== "offline" ? [member.id] : [];
  }

  const members = state.app.rooms.listMembers().filter((member) => (
    room.memberIds.includes(member.id) && !member.disabled && member.status !== "offline"
  ));
  const normalized = text.toLowerCase();
  if (/@all\b/i.test(text) || /@(所有人|全部)/.test(text)) {
    return members.map((member) => member.id);
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
