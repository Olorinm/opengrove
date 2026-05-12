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
import {
  createRelayInviteForRoom,
  normalizeRelayBaseUrl,
} from "./relay-invites.js";

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

  const relay = state.settings.relay;
  const relayBaseUrl = normalizeRelayBaseUrl(relay.baseUrl);
  if (relay.enabled && relayBaseUrl) {
    try {
      const result = await createRelayInviteForRoom(state, relay, relayBaseUrl, localRoomId, roomTitle);
      sendJson(response, 200, {
        ok: true,
        provider: "relay",
        invite: {
          provider: "relay",
          token: result.invite.token,
          roomId: localRoomId,
          relayRoomId: result.binding.relayRoomId,
          relayWorkspaceId: result.binding.workspaceId,
          ownerMemberId: result.binding.ownerMemberId,
          ownerMemberToken: result.binding.ownerMemberToken,
          roomTitle,
          inviterName: "OpenGrove",
          createdAt: result.invite.createdAt,
          expiresAt: result.invite.expiresAt,
          relayBaseUrl,
        },
        inviteUrl: new URL(result.invite.inviteUrl, ensureTrailingSlash(relayBaseUrl)).toString(),
        settings: getBridgeSettingsSnapshot(state),
      });
    } catch (error) {
      sendJson(response, 502, {
        ok: false,
        provider: "relay",
        error: "relay_invite_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  sendJson(response, 400, {
    ok: false,
    error: "remote_messaging_not_configured",
    message: "请先在设置里启用 Matrix/Tuwunel 或 Relay。",
    settings: getBridgeSettingsSnapshot(state),
  });
  return true;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
