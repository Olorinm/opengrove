import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getBridgeSettingsSnapshot,
} from "../bridge-state.js";
import type { BridgeState } from "../bridge-types.js";
import { record, stringValue } from "../http-utils.js";
import {
  createMatrixInviteForRoom,
  matrixReady,
} from "./matrix-invites.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

export async function handleRemoteInviteRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
}): Promise<boolean> {
  const { request, response, url, state, sendJson, readJsonBody } = options;
  if (request.method !== "POST" || url.pathname !== "/rooms/remote-invites") {
    return false;
  }

  const payload = record(await readJsonBody(request));
  const localRoomId = stringValue(payload.roomId).trim();
  const roomTitle = stringValue(payload.roomTitle).trim() || "群聊";
  if (!localRoomId) {
    sendJson(response, 400, { ok: false, error: "room_id_required" });
    return true;
  }

  if (matrixReady(state.settings.matrix)) {
    if (!normalizePublicLandingBaseUrl(state.settings.inviteLanding.baseUrl)) {
      sendJson(response, 400, {
        ok: false,
        provider: "matrix",
        error: "invite_landing_not_configured",
        message: "请先在设置里的远程通信填写公开邀请落地页地址。",
        settings: getBridgeSettingsSnapshot(state),
      });
      return true;
    }
    try {
      const result = await createMatrixInviteForRoom(state, state.settings.matrix, localRoomId, roomTitle);
      sendJson(response, 200, {
        ok: true,
        provider: "matrix",
        invite: result.invite,
        inviteUrl: result.inviteUrl,
        settings: getBridgeSettingsSnapshot(state),
      });
    } catch (error) {
      sendJson(response, 502, {
        ok: false,
        provider: "matrix",
        error: "matrix_invite_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  sendJson(response, 400, {
    ok: false,
    error: "matrix_not_configured",
    message: "请先在设置里启用 Matrix/Tuwunel。",
    settings: getBridgeSettingsSnapshot(state),
  });
  return true;
}

function normalizePublicLandingBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}
