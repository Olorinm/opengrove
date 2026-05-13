import { postJson } from "../../bridge";
import { nowIso, type Room } from "./rooms-model";

export type RemoteRoomInvitePayload = {
  provider?: "matrix";
  token: string;
  roomId: string;
  matrixRoomId?: string;
  matrixHomeserverUrl?: string;
  roomTitle: string;
  inviterName: string;
  createdAt: string;
  expiresAt?: string;
};

export type RemoteRoomInviteResult = {
  invite: RemoteRoomInvitePayload;
  inviteUrl: string;
};

const REMOTE_INVITE_PARAM = "roomInvite";

export async function createRemoteRoomInvite(room: Room): Promise<RemoteRoomInviteResult> {
  const result = await postJson<RemoteRoomInviteBridgeResponse>("/rooms/remote-invites", {
    roomId: room.id,
    roomTitle: room.title,
  });
  if (!result.ok || !result.inviteUrl || !result.invite?.token) {
    throw new Error(result.message || result.error || "remote_invite_failed");
  }
  return {
    invite: {
      provider: result.invite.provider,
      token: result.invite.token,
      roomId: result.invite.roomId || room.id,
      matrixRoomId: result.invite.matrixRoomId,
      matrixHomeserverUrl: result.invite.matrixHomeserverUrl,
      roomTitle: result.invite.roomTitle || room.title,
      inviterName: result.invite.inviterName || "OpenGrove",
      createdAt: result.invite.createdAt || nowIso(),
      expiresAt: result.invite.expiresAt,
    },
    inviteUrl: result.inviteUrl,
  };
}

export function readRemoteRoomInviteFromLocation(): RemoteRoomInvitePayload | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(REMOTE_INVITE_PARAM);
  if (!raw) return null;
  try {
    const parsed = decodeInvitePayload(raw);
    const token = String(parsed.token || "").trim();
    const roomId = String(parsed.roomId || "").trim();
    if (!token || !roomId) return null;
    return {
      token,
      provider: parsed.provider === "matrix" ? "matrix" : undefined,
      roomId,
      matrixRoomId: typeof parsed.matrixRoomId === "string" ? parsed.matrixRoomId : undefined,
      matrixHomeserverUrl: typeof parsed.matrixHomeserverUrl === "string" ? parsed.matrixHomeserverUrl : undefined,
      roomTitle: String(parsed.roomTitle || "OpenGrove 群聊").trim() || "OpenGrove 群聊",
      inviterName: String(parsed.inviterName || "OpenGrove").trim() || "OpenGrove",
      createdAt: String(parsed.createdAt || nowIso()),
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
    };
  } catch {
    return null;
  }
}

function decodeInvitePayload(raw: string): Partial<RemoteRoomInvitePayload> {
  if (raw.trim().startsWith("{")) {
    return JSON.parse(raw) as Partial<RemoteRoomInvitePayload>;
  }
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Partial<RemoteRoomInvitePayload>;
}

export function clearRemoteRoomInviteFromLocation(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(REMOTE_INVITE_PARAM);
  window.history.replaceState({}, "", url.toString());
}

type RemoteRoomInviteBridgeResponse = {
  ok: boolean;
  invite?: Partial<RemoteRoomInvitePayload>;
  inviteUrl?: string;
  error?: string;
  message?: string;
};
