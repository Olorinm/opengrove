export type RelayMemberKind = "human" | "local-agent" | "remote-agent";
export type RelayInviteStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";
export type RelayPresenceStatus = "online" | "offline" | "running" | "waiting";

export type RelayNodeDescriptor = {
  id: string;
  accountId: string;
  displayName: string;
  version?: string;
  agents: RelayAgentDescriptor[];
};

export type RelayAgentDescriptor = {
  id: string;
  displayName: string;
  description?: string;
};

export type RelayRoom = {
  id: string;
  workspaceId: string;
  title: string;
  createdByMemberId: string;
  createdAt: string;
};

export type RelayRoomMember = {
  id: string;
  workspaceId: string;
  roomId: string;
  kind: RelayMemberKind;
  displayName: string;
  accountId?: string;
  nodeId?: string;
  agentId?: string;
  presence: RelayPresenceStatus;
  createdAt: string;
  updatedAt: string;
};

export type RelayRoomMemberAccess = {
  memberId: string;
  roomId: string;
  token: string;
  createdAt: string;
};

export type RelayRoomInvite = {
  id: string;
  workspaceId: string;
  roomId: string;
  createdByMemberId: string;
  targetKind: Exclude<RelayMemberKind, "local-agent">;
  status: RelayInviteStatus;
  token: string;
  createdAt: string;
  expiresAt: string;
  acceptedMemberId?: string;
};

export type RelayEventType =
  | "invite.created"
  | "invite.accepted"
  | "invite.revoked"
  | "member.joined"
  | "member.updated"
  | "member.removed"
  | "presence.updated"
  | "room.message.created"
  | "room.turn.started"
  | "room.turn.delta"
  | "room.turn.tool.started"
  | "room.turn.tool.finished"
  | "room.turn.approval.requested"
  | "room.turn.approval.resolved"
  | "room.turn.final"
  | "room.turn.failed"
  | "room.turn.cancelled"
  | "attachment.created"
  | "attachment.access.requested"
  | "attachment.access.granted";

export type RelayEventEnvelope<TPayload = unknown> = {
  id: string;
  type: RelayEventType;
  workspaceId: string;
  roomId: string;
  actorMemberId: string;
  targetMemberIds?: string[];
  turnId?: string;
  seq: number;
  createdAt: string;
  traceId: string;
  idempotencyKey?: string;
  signature?: string;
  payload: TPayload;
};

export type RelayMessagePayload = {
  messageId: string;
  text: string;
  attachmentIds?: string[];
};

export type RelayTurnDispatch = {
  turnId: string;
  roomId: string;
  targetMemberId: string;
  prompt: string;
  attachmentIds: string[];
};

export function canDeliverRoomEventToMember(
  event: Pick<RelayEventEnvelope, "actorMemberId" | "targetMemberIds" | "type">,
  member: Pick<RelayRoomMember, "id" | "kind">,
): boolean {
  if (event.actorMemberId === member.id) return true;
  if (event.targetMemberIds?.includes(member.id)) return true;
  if (member.kind === "human" || member.kind === "local-agent") return true;
  return event.type !== "room.message.created" && event.type !== "room.turn.started";
}
