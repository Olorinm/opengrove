import { postJson } from "../../bridge";
import { nowIso, type Room } from "./rooms-storage";

export type RemoteRoomInvitePayload = {
  provider?: "relay" | "matrix";
  token: string;
  roomId: string;
  relayRoomId?: string;
  relayWorkspaceId?: string;
  ownerMemberId?: string;
  ownerMemberToken?: string;
  matrixRoomId?: string;
  matrixHomeserverUrl?: string;
  roomTitle: string;
  inviterName: string;
  createdAt: string;
  expiresAt?: string;
  relayBaseUrl?: string;
};

export type RemoteRoomInviteResult = {
  invite: RemoteRoomInvitePayload;
  inviteUrl: string;
};

const REMOTE_INVITE_PARAM = "roomInvite";
const RELAY_BASE_URL_PARAM = "relayBaseUrl";
const RELAY_INVITE_TOKEN_PARAM = "relayInviteToken";

export async function createRemoteRoomInvite(room: Room): Promise<RemoteRoomInviteResult> {
  const result = await postJson<RemoteRoomInviteBridgeResponse>("/rooms/remote-invites", {
    roomId: room.id,
    roomTitle: room.title,
  });
  if (!result.ok || !result.inviteUrl || !result.invite?.token) {
    throw new Error(result.message || result.error || "relay_invite_failed");
  }
  return {
    invite: {
      provider: result.invite.provider,
      token: result.invite.token,
      roomId: result.invite.roomId || room.id,
      relayRoomId: result.invite.relayRoomId,
      relayWorkspaceId: result.invite.relayWorkspaceId,
      ownerMemberId: result.invite.ownerMemberId,
      ownerMemberToken: result.invite.ownerMemberToken,
      matrixRoomId: result.invite.matrixRoomId,
      matrixHomeserverUrl: result.invite.matrixHomeserverUrl,
      roomTitle: result.invite.roomTitle || room.title,
      inviterName: result.invite.inviterName || "OpenGrove",
      createdAt: result.invite.createdAt || nowIso(),
      expiresAt: result.invite.expiresAt,
      relayBaseUrl: result.invite.relayBaseUrl,
    },
    inviteUrl: result.inviteUrl,
  };
}

export function readRemoteRoomInviteFromLocation(): RemoteRoomInvitePayload | null {
  const params = new URLSearchParams(window.location.search);
  const relayToken = params.get(RELAY_INVITE_TOKEN_PARAM)?.trim();
  const relayBaseUrl = params.get(RELAY_BASE_URL_PARAM)?.trim();
  if (relayToken && relayBaseUrl) {
    return {
      token: relayToken,
      roomId: `relay-${relayToken.slice(0, 12).replace(/[^A-Za-z0-9_-]/g, "_")}`,
      roomTitle: "OpenGrove 群聊",
      inviterName: "OpenGrove",
      createdAt: nowIso(),
      relayBaseUrl,
      provider: "relay",
    };
  }
  const raw = params.get(REMOTE_INVITE_PARAM);
  if (!raw) return null;
  try {
    const parsed = decodeInvitePayload(raw);
    const token = String(parsed.token || "").trim();
    const roomId = String(parsed.roomId || "").trim();
    if (!token || !roomId) return null;
    return {
      token,
      provider: parsed.provider === "matrix" ? "matrix" : parsed.provider === "relay" ? "relay" : undefined,
      roomId,
      relayRoomId: typeof parsed.relayRoomId === "string" ? parsed.relayRoomId : undefined,
      relayWorkspaceId: typeof parsed.relayWorkspaceId === "string" ? parsed.relayWorkspaceId : undefined,
      ownerMemberId: typeof parsed.ownerMemberId === "string" ? parsed.ownerMemberId : undefined,
      ownerMemberToken: typeof parsed.ownerMemberToken === "string" ? parsed.ownerMemberToken : undefined,
      matrixRoomId: typeof parsed.matrixRoomId === "string" ? parsed.matrixRoomId : undefined,
      matrixHomeserverUrl: typeof parsed.matrixHomeserverUrl === "string" ? parsed.matrixHomeserverUrl : undefined,
      roomTitle: String(parsed.roomTitle || "OpenGrove 群聊").trim() || "OpenGrove 群聊",
      inviterName: String(parsed.inviterName || "OpenGrove").trim() || "OpenGrove",
      createdAt: String(parsed.createdAt || nowIso()),
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
      relayBaseUrl: typeof parsed.relayBaseUrl === "string" ? parsed.relayBaseUrl : undefined,
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
  url.searchParams.delete(RELAY_BASE_URL_PARAM);
  url.searchParams.delete(RELAY_INVITE_TOKEN_PARAM);
  window.history.replaceState({}, "", url.toString());
}

type RemoteRoomInviteBridgeResponse = {
  ok: boolean;
  invite?: Partial<RemoteRoomInvitePayload>;
  inviteUrl?: string;
  error?: string;
  message?: string;
};
