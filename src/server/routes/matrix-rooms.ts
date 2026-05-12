import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeState } from "../bridge-types.js";
import { record, stringValue } from "../http-utils.js";
import {
  joinMatrixRoom,
  matrixReady,
  publishMatrixRoomEvent,
  syncMatrixRoom,
} from "./matrix-invites.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

export async function handleMatrixRoomRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
}): Promise<boolean> {
  const { request, response, url, state, sendJson, readJsonBody } = options;
  if (!url.pathname.startsWith("/rooms/matrix/")) {
    return false;
  }

  if (!matrixReady(state.settings.matrix)) {
    sendJson(response, 400, { ok: false, error: "matrix_not_configured" });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/rooms/matrix/join") {
    const body = record(await readJsonBody(request));
    const roomId = stringValue(body.roomId).trim();
    const localMember = record(body.localMember);
    const localMemberId = stringValue(localMember.id).trim();
    const localMemberName = stringValue(localMember.name).trim() || "OpenGrove Agent";
    if (!roomId || !localMemberId) {
      sendJson(response, 400, { ok: false, error: "matrix_room_and_member_required" });
      return true;
    }

    try {
      const joinedRoomId = await joinMatrixRoom(state.settings.matrix, roomId);
      const eventId = await publishMatrixRoomEvent(
        state.settings.matrix,
        joinedRoomId,
        "org.opengrove.agent.profile",
        {
          version: 1,
          ownerUserId: state.settings.matrix.userId,
          agentId: localMemberId,
          displayName: localMemberName,
          kernel: stringValue(localMember.kernel).trim(),
          model: stringValue(localMember.model).trim(),
          role: stringValue(localMember.role).trim(),
        },
      );
      sendJson(response, 200, {
        ok: true,
        roomId: joinedRoomId,
        profileEventId: eventId,
      });
    } catch (error) {
      sendJson(response, 502, {
        ok: false,
        error: "matrix_join_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/rooms/matrix/events") {
    const body = record(await readJsonBody(request));
    const roomId = stringValue(body.roomId).trim();
    const type = stringValue(body.type).trim();
    if (!roomId || !type) {
      sendJson(response, 400, { ok: false, error: "matrix_room_and_type_required" });
      return true;
    }
    try {
      const eventId = await publishMatrixRoomEvent(
        state.settings.matrix,
        roomId,
        type,
        body.content ?? {},
        stringValue(body.txnId).trim() || undefined,
      );
      sendJson(response, 200, { ok: true, eventId });
    } catch (error) {
      sendJson(response, 502, {
        ok: false,
        error: "matrix_event_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/rooms/matrix/sync") {
    const roomId = stringValue(url.searchParams.get("roomId")).trim();
    const since = stringValue(url.searchParams.get("since")).trim() || undefined;
    if (!roomId) {
      sendJson(response, 400, { ok: false, error: "matrix_room_required" });
      return true;
    }
    try {
      const result = await syncMatrixRoom(state.settings.matrix, roomId, since);
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 502, {
        ok: false,
        error: "matrix_sync_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;
}
