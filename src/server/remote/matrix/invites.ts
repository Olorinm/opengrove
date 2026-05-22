import { saveBridgeSettings } from "../../bridge-state.js";
import type {
  BridgeMatrixSettings,
  BridgeRemoteRoomBinding,
  BridgeState,
} from "../../bridge-types.js";
import {
  createMatrixRoom,
  matrixReady,
  normalizeMatrixHomeserverUrl,
} from "../../../remote/matrix/client.js";

export { matrixReady, normalizeMatrixHomeserverUrl };

export type MatrixInviteForRoomResult = {
  binding: BridgeRemoteRoomBinding;
  invite: {
    provider: "matrix";
    token: string;
    roomId: string;
    matrixRoomId: string;
    matrixHomeserverUrl: string;
    roomTitle: string;
    inviterName: string;
    createdAt: string;
  };
  inviteUrl: string;
};

export async function createMatrixInviteForRoom(
  state: BridgeState,
  matrix: BridgeMatrixSettings,
  localRoomId: string,
  roomTitle: string,
): Promise<MatrixInviteForRoomResult> {
  const homeserverUrl = normalizeMatrixHomeserverUrl(matrix.homeserverUrl);
  if (!matrixReady(matrix)) {
    throw new Error("matrix_not_configured");
  }

  let matrixSettings = { ...matrix, homeserverUrl, bindings: { ...matrix.bindings } };
  const existingBinding = matrixSettings.bindings[localRoomId];
  const binding = existingBinding ?? await createMatrixRoomBinding(matrixSettings, localRoomId, roomTitle);
  if (!existingBinding) {
    matrixSettings.bindings[localRoomId] = binding;
    state.settings = {
      ...state.settings,
      remote: {
        ...state.settings.remote,
        matrix: matrixSettings,
      },
    };
    saveBridgeSettings(state);
  }

  const createdAt = new Date().toISOString();
  const invite = {
    provider: "matrix" as const,
    token: binding.remoteRoomId,
    roomId: localRoomId,
    matrixRoomId: binding.remoteRoomId,
    matrixHomeserverUrl: binding.homeserverUrl,
    roomTitle: binding.title || roomTitle,
    inviterName: "OpenGrove",
    createdAt,
  };
  return {
    binding,
    invite,
    inviteUrl: opengroveInviteUrl(invite, state.settings.inviteLanding.baseUrl),
  };
}

async function createMatrixRoomBinding(
  matrix: BridgeMatrixSettings,
  localRoomId: string,
  roomTitle: string,
): Promise<BridgeRemoteRoomBinding> {
  const createdAt = new Date().toISOString();
  const matrixRoomId = await createMatrixRoom({
    matrix,
    localRoomId,
    roomTitle,
    createdAt,
  });
  return {
    provider: "matrix",
    accountId: "default",
    remoteRoomId: matrixRoomId,
    homeserverUrl: normalizeMatrixHomeserverUrl(matrix.homeserverUrl),
    title: roomTitle || "OpenGrove 群聊",
    createdAt,
    enabled: true,
  };
}

function opengroveInviteUrl(payload: MatrixInviteForRoomResult["invite"], publicLandingBaseUrl: string): string {
  const encoded = encodeInvitePayload(payload);
  const landingBaseUrl = normalizeMatrixHomeserverUrl(publicLandingBaseUrl);
  if (!landingBaseUrl) throw new Error("invite_landing_not_configured");
  const url = new URL("/opengrove/invite", ensureTrailingSlash(landingBaseUrl));
  url.searchParams.set("payload", encoded);
  return url.toString();
}

function encodeInvitePayload(payload: MatrixInviteForRoomResult["invite"]): string {
  return Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
