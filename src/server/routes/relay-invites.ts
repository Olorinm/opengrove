import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getBridgeSettingsSnapshot,
  saveBridgeSettings,
} from "../bridge-state.js";
import type {
  BridgeRelayRoomBinding,
  BridgeRelaySettings,
  BridgeState,
} from "../bridge-types.js";
import { record, stringValue } from "../http-utils.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

type RelayWorkspaceResponse = {
  ok?: boolean;
  workspace?: {
    id?: string;
  };
};

type RelayRoomResponse = {
  ok?: boolean;
  room?: {
    id?: string;
  };
};

type RelayMemberResponse = {
  ok?: boolean;
  member?: {
    id?: string;
  };
  memberAccessToken?: string;
};

type RelayInviteResponse = {
  ok?: boolean;
  invite?: {
    id?: string;
    token?: string;
    createdAt?: string;
    expiresAt?: string;
  };
  inviteUrl?: string;
};

export async function handleRelayInviteRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
}): Promise<boolean> {
  const { request, response, url, state, sendJson, readJsonBody } = options;
  if (request.method !== "POST" || url.pathname !== "/rooms/relay-invites") {
    return false;
  }

  const relay = state.settings.relay;
  const baseUrl = normalizeRelayBaseUrl(relay.baseUrl);
  if (!relay.enabled || !baseUrl) {
    sendJson(response, 400, {
      ok: false,
      error: "relay_not_configured",
      message: "请先在设置里启用 Relay，并填写公共 Relay 地址。",
      settings: getBridgeSettingsSnapshot(state),
    });
    return true;
  }

  const payload = record(await readJsonBody(request));
  const localRoomId = stringValue(payload.roomId).trim();
  const roomTitle = stringValue(payload.roomTitle).trim() || "群聊";
  if (!localRoomId) {
    sendJson(response, 400, { ok: false, error: "room_id_required" });
    return true;
  }

  try {
    const result = await createRelayInviteForRoom(state, relay, baseUrl, localRoomId, roomTitle);
    sendJson(response, 200, {
      ok: true,
      invite: {
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
        relayBaseUrl: baseUrl,
      },
      inviteUrl: result.inviteUrl,
      settings: getBridgeSettingsSnapshot(state),
    });
  } catch (error) {
    sendJson(response, 502, {
      ok: false,
      error: "relay_invite_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

export async function createRelayInviteForRoom(
  state: BridgeState,
  relay: BridgeRelaySettings,
  baseUrl: string,
  localRoomId: string,
  roomTitle: string,
) {
  let relaySettings = { ...relay, roomBindings: { ...relay.roomBindings } };
  relaySettings = await ensureRelayWorkspace(state, relaySettings, baseUrl);

  const existingBinding = relaySettings.roomBindings[localRoomId];
  if (existingBinding) {
    try {
      const invite = await createInvite(baseUrl, relaySettings, existingBinding);
      return {
        binding: existingBinding,
        invite,
        inviteUrl: absoluteRelayInviteUrl(baseUrl, invite.inviteUrl),
      };
    } catch {
      delete relaySettings.roomBindings[localRoomId];
    }
  }

  try {
    const binding = await createRelayRoomBinding(baseUrl, relaySettings, roomTitle);
    relaySettings.roomBindings[localRoomId] = binding;
    state.settings = {
      ...state.settings,
      relay: relaySettings,
    };
    saveBridgeSettings(state);
    const invite = await createInvite(baseUrl, relaySettings, binding);
    return {
      binding,
      invite,
      inviteUrl: absoluteRelayInviteUrl(baseUrl, invite.inviteUrl),
    };
  } catch (error) {
    if (String(error instanceof Error ? error.message : error).includes("workspace")) {
      relaySettings = {
        ...relaySettings,
        workspaceId: undefined,
        roomBindings: {},
      };
      relaySettings = await ensureRelayWorkspace(state, relaySettings, baseUrl);
      const binding = await createRelayRoomBinding(baseUrl, relaySettings, roomTitle);
      relaySettings.roomBindings[localRoomId] = binding;
      state.settings = {
        ...state.settings,
        relay: relaySettings,
      };
      saveBridgeSettings(state);
      const invite = await createInvite(baseUrl, relaySettings, binding);
      return {
        binding,
        invite,
        inviteUrl: absoluteRelayInviteUrl(baseUrl, invite.inviteUrl),
      };
    }
    throw error;
  }
}

async function ensureRelayWorkspace(
  state: BridgeState,
  relay: BridgeRelaySettings,
  baseUrl: string,
): Promise<BridgeRelaySettings> {
  if (relay.workspaceId) {
    return relay;
  }
  const response = await relayPost<RelayWorkspaceResponse>(baseUrl, relay, "/workspaces", {
    name: "OpenGrove",
  });
  const workspaceId = response.workspace?.id;
  if (!workspaceId) {
    throw new Error("relay_workspace_create_failed");
  }
  const next = {
    ...relay,
    workspaceId,
  };
  state.settings = {
    ...state.settings,
    relay: next,
  };
  saveBridgeSettings(state);
  return next;
}

async function createRelayRoomBinding(
  baseUrl: string,
  relay: BridgeRelaySettings,
  roomTitle: string,
): Promise<BridgeRelayRoomBinding> {
  const workspaceId = relay.workspaceId;
  if (!workspaceId) {
    throw new Error("relay_workspace_missing");
  }
  const room = await relayPost<RelayRoomResponse>(baseUrl, relay, "/rooms", {
    workspaceId,
    title: roomTitle,
    createdByMemberId: "opengrove-local-owner",
  });
  const relayRoomId = room.room?.id;
  if (!relayRoomId) {
    throw new Error("relay_room_create_failed");
  }
  const owner = await relayPost<RelayMemberResponse>(
    baseUrl,
    relay,
    `/rooms/${encodeURIComponent(relayRoomId)}/members`,
    {
      workspaceId,
      kind: "human",
      displayName: "房主",
      accountId: "opengrove-local",
    },
  );
  const ownerMemberId = owner.member?.id;
  if (!ownerMemberId) {
    throw new Error("relay_owner_member_create_failed");
  }
  return {
    relayRoomId,
    ownerMemberId,
    ownerMemberToken: owner.memberAccessToken,
    workspaceId,
    title: roomTitle,
    createdAt: new Date().toISOString(),
  };
}

async function createInvite(
  baseUrl: string,
  relay: BridgeRelaySettings,
  binding: BridgeRelayRoomBinding,
) {
  const workspaceId = relay.workspaceId;
  if (!workspaceId) {
    throw new Error("relay_workspace_missing");
  }
  const response = await relayPost<RelayInviteResponse>(baseUrl, relay, "/invites", {
    workspaceId,
    roomId: binding.relayRoomId,
    createdByMemberId: binding.ownerMemberId,
    targetKind: "remote-agent",
  });
  const token = response.invite?.token;
  if (!token) {
    throw new Error("relay_invite_create_failed");
  }
  return {
    id: response.invite?.id ?? "",
    token,
    createdAt: response.invite?.createdAt ?? new Date().toISOString(),
    expiresAt: response.invite?.expiresAt ?? "",
    inviteUrl: response.inviteUrl ?? `/invites/accept?token=${encodeURIComponent(token)}`,
  };
}

async function relayPost<T>(
  baseUrl: string,
  relay: BridgeRelaySettings,
  path: string,
  payload: unknown,
): Promise<T> {
  const response = await fetch(new URL(path, ensureTrailingSlash(baseUrl)), {
    method: "POST",
    headers: relayHeaders(relay),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(parseRelayError(text) || `relay_request_failed:${response.status}`);
  }
  return (await response.json()) as T;
}

function relayHeaders(relay: BridgeRelaySettings): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (relay.authToken) {
    headers.authorization = `Bearer ${relay.authToken}`;
    headers["x-opengrove-relay-token"] = relay.authToken;
  }
  return headers;
}

export function normalizeRelayBaseUrl(value: string): string {
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

function absoluteRelayInviteUrl(baseUrl: string, inviteUrl: string): string {
  return new URL(inviteUrl, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseRelayError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.message || parsed.error || "";
  } catch {
    return text.trim();
  }
}
