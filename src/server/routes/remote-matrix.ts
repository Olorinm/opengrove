import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomChannelMember } from "../../rooms/channel-store.js";
import { acceptMatrixInviteIntoLedger } from "../remote/matrix/ledger-sync.js";
import type { BridgeState } from "../bridge-types.js";
import { record, stringValue } from "../http-utils.js";
import { matrixReady } from "../remote/matrix/invites.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

export async function handleRemoteMatrixRoute(options: {
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

  if (!matrixReady(state.settings.remote.matrix)) {
    sendJson(response, 400, { ok: false, error: "matrix_not_configured" });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/rooms/matrix/join") {
    const body = record(await readJsonBody(request));
    const roomId = stringValue(body.roomId).trim();
    const roomTitle = stringValue(body.roomTitle).trim();
    const localMember = record(body.localMember);
    const localMemberId = stringValue(localMember.id).trim();
    if (!roomId || !localMemberId) {
      sendJson(response, 400, { ok: false, error: "matrix_room_and_member_required" });
      return true;
    }

    try {
      const result = await acceptMatrixInviteIntoLedger(state, {
        matrixRoomId: roomId,
        roomTitle,
        localMember: normalizeLocalMember(localMember),
      });
      sendJson(response, 200, {
        ok: true,
        roomId: result.room.remote?.remoteRoomId,
        profileEventId: result.profileEventId,
        room: result.room,
        member: result.member,
        currentEventSeq: state.app.rooms.snapshot().currentEventSeq,
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

  return false;
}

function normalizeLocalMember(input: Record<string, unknown>): RoomChannelMember {
  const id = stringValue(input.id);
  return {
    id,
    name: stringValue(input.name) || id || "OpenGrove Agent",
    kernel: stringValue(input.kernel) || id || "agent",
    model: stringValue(input.model) || "native",
    role: stringValue(input.role) || "Agent",
    status: "idle",
    color: stringValue(input.color) || "#2563eb",
    lastActive: "now",
    avatarDataUrl: stringValue(input.avatarDataUrl) || undefined,
    source: "local",
    sourceLabel: "本机",
    inviteStatus: "accepted",
  };
}
