import {
  canDeliverRoomEventToMember,
  type RelayEventEnvelope,
  type RelayEventType,
  type RelayInviteStatus,
  type RelayMemberKind,
  type RelayNodeDescriptor,
  type RelayRoom,
  type RelayRoomInvite,
  type RelayRoomMember,
  type RelayRoomMemberAccess,
} from "./protocol.js";

export type RelayWorkspace = {
  id: string;
  name: string;
  createdAt: string;
};

export type CreateInviteInput = {
  workspaceId: string;
  roomId: string;
  createdByMemberId: string;
  targetKind: RelayRoomInvite["targetKind"];
  expiresInMs?: number;
};

export type AcceptInviteInput = {
  token: string;
  displayName: string;
  accountId?: string;
  nodeId?: string;
  agentId?: string;
};

export type PublishRelayEventInput<TPayload> = {
  type: RelayEventType;
  workspaceId: string;
  roomId: string;
  actorMemberId: string;
  targetMemberIds?: string[];
  turnId?: string;
  idempotencyKey?: string;
  payload: TPayload;
};

export type RelaySnapshot = {
  version: 1;
  seq: number;
  workspaces: RelayWorkspace[];
  nodes: RelayNodeDescriptor[];
  rooms: RelayRoom[];
  members: RelayRoomMember[];
  memberAccesses: RelayRoomMemberAccess[];
  invites: RelayRoomInvite[];
  eventsByRoom: Array<{
    roomId: string;
    events: RelayEventEnvelope[];
  }>;
};

export type RelayChangeHandler = (snapshot: RelaySnapshot) => void;

export class InMemoryRelay {
  private readonly workspaces = new Map<string, RelayWorkspace>();
  private readonly nodes = new Map<string, RelayNodeDescriptor>();
  private readonly rooms = new Map<string, RelayRoom>();
  private readonly members = new Map<string, RelayRoomMember>();
  private readonly memberAccessByToken = new Map<string, RelayRoomMemberAccess>();
  private readonly invites = new Map<string, RelayRoomInvite>();
  private readonly eventsByRoom = new Map<string, RelayEventEnvelope[]>();
  private readonly subscribersByRoom = new Map<string, Set<(event: RelayEventEnvelope) => void>>();
  private readonly onChange?: RelayChangeHandler;
  private seq = 0;

  constructor(options: { snapshot?: RelaySnapshot; onChange?: RelayChangeHandler } = {}) {
    this.onChange = options.onChange;
    if (options.snapshot) {
      this.restore(options.snapshot);
    }
  }

  snapshot(): RelaySnapshot {
    return {
      version: 1,
      seq: this.seq,
      workspaces: [...this.workspaces.values()],
      nodes: [...this.nodes.values()],
      rooms: [...this.rooms.values()],
      members: [...this.members.values()],
      memberAccesses: [...this.memberAccessByToken.values()],
      invites: [...this.invites.values()],
      eventsByRoom: [...this.eventsByRoom.entries()].map(([roomId, events]) => ({ roomId, events: [...events] })),
    };
  }

  createWorkspace(name: string): RelayWorkspace {
    const workspace: RelayWorkspace = {
      id: createRelayId("workspace"),
      name: name.trim() || "OpenGrove",
      createdAt: nowIso(),
    };
    this.workspaces.set(workspace.id, workspace);
    this.persist();
    return workspace;
  }

  registerNode(node: RelayNodeDescriptor): RelayNodeDescriptor {
    this.nodes.set(node.id, node);
    this.persist();
    return node;
  }

  getRoom(roomId: string, workspaceId?: string): RelayRoom {
    return this.requireRoom(roomId, workspaceId);
  }

  getInvite(token: string): RelayRoomInvite {
    const invite = this.invites.get(token);
    if (!invite) throw new Error("invite_not_found");
    return invite;
  }

  createRoom(input: { workspaceId: string; title: string; createdByMemberId: string }): RelayRoom {
    this.requireWorkspace(input.workspaceId);
    const room: RelayRoom = {
      id: createRelayId("room"),
      workspaceId: input.workspaceId,
      title: input.title.trim() || "群聊",
      createdByMemberId: input.createdByMemberId,
      createdAt: nowIso(),
    };
    this.rooms.set(room.id, room);
    this.eventsByRoom.set(room.id, []);
    this.persist();
    return room;
  }

  addMember(input: {
    workspaceId: string;
    roomId: string;
    kind: RelayMemberKind;
    displayName: string;
    accountId?: string;
    nodeId?: string;
    agentId?: string;
  }): RelayRoomMember {
    this.requireRoom(input.roomId, input.workspaceId);
    const now = nowIso();
    const member: RelayRoomMember = {
      id: createRelayId("member"),
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      kind: input.kind,
      displayName: input.displayName.trim() || "员工",
      accountId: input.accountId,
      nodeId: input.nodeId,
      agentId: input.agentId,
      presence: input.kind === "human" ? "online" : "waiting",
      createdAt: now,
      updatedAt: now,
    };
    this.members.set(member.id, member);
    this.publishEvent({
      type: "member.joined",
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      actorMemberId: member.id,
      payload: { memberId: member.id, kind: member.kind, displayName: member.displayName },
    });
    return member;
  }

  createMemberAccess(memberId: string, roomId: string): RelayRoomMemberAccess {
    this.requireMember(memberId, roomId);
    const access: RelayRoomMemberAccess = {
      memberId,
      roomId,
      token: createRelayToken(),
      createdAt: nowIso(),
    };
    this.memberAccessByToken.set(access.token, access);
    this.persist();
    return access;
  }

  verifyMemberAccess(roomId: string, memberId: string, token: string | undefined): boolean {
    if (!token) return false;
    const access = this.memberAccessByToken.get(token);
    return Boolean(access && access.roomId === roomId && access.memberId === memberId);
  }

  createInvite(input: CreateInviteInput): RelayRoomInvite {
    this.requireRoom(input.roomId, input.workspaceId);
    this.requireMember(input.createdByMemberId, input.roomId);
    const now = Date.now();
    const invite: RelayRoomInvite = {
      id: createRelayId("invite"),
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      createdByMemberId: input.createdByMemberId,
      targetKind: input.targetKind,
      status: "pending",
      token: createRelayToken(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (input.expiresInMs ?? 7 * 24 * 60 * 60 * 1000)).toISOString(),
    };
    this.invites.set(invite.token, invite);
    this.publishEvent({
      type: "invite.created",
      workspaceId: invite.workspaceId,
      roomId: invite.roomId,
      actorMemberId: invite.createdByMemberId,
      payload: { inviteId: invite.id, targetKind: invite.targetKind },
    });
    return invite;
  }

  acceptInvite(input: AcceptInviteInput): { invite: RelayRoomInvite; member: RelayRoomMember } {
    const invite = this.invites.get(input.token);
    if (!invite) throw new Error("invite_not_found");
    if (invite.status !== "pending") throw new Error(`invite_${invite.status}`);
    if (new Date(invite.expiresAt).getTime() < Date.now()) {
      this.updateInviteStatus(invite, "expired");
      throw new Error("invite_expired");
    }

    const member = this.addMember({
      workspaceId: invite.workspaceId,
      roomId: invite.roomId,
      kind: invite.targetKind,
      displayName: input.displayName,
      accountId: input.accountId,
      nodeId: input.nodeId,
      agentId: input.agentId,
    });
    const accepted = {
      ...invite,
      status: "accepted" as const,
      acceptedMemberId: member.id,
    };
    this.invites.set(accepted.token, accepted);
    this.publishEvent({
      type: "invite.accepted",
      workspaceId: accepted.workspaceId,
      roomId: accepted.roomId,
      actorMemberId: member.id,
      payload: { inviteId: accepted.id, memberId: member.id },
    });
    return { invite: accepted, member };
  }

  publishEvent<TPayload>(input: PublishRelayEventInput<TPayload>): RelayEventEnvelope<TPayload> {
    this.requireRoom(input.roomId, input.workspaceId);
    this.requireMember(input.actorMemberId, input.roomId);
    const event: RelayEventEnvelope<TPayload> = {
      id: createRelayId("event"),
      type: input.type,
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      actorMemberId: input.actorMemberId,
      targetMemberIds: input.targetMemberIds,
      turnId: input.turnId,
      seq: ++this.seq,
      createdAt: nowIso(),
      traceId: createRelayId("trace"),
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
    };
    const roomEvents = this.eventsByRoom.get(input.roomId) ?? [];
    roomEvents.push(event);
    this.eventsByRoom.set(input.roomId, roomEvents);
    this.persist();
    for (const listener of this.subscribersByRoom.get(input.roomId) ?? []) {
      listener(event);
    }
    return event;
  }

  subscribeRoom(roomId: string, memberId: string, listener: (event: RelayEventEnvelope) => void): () => void {
    const member = this.requireMember(memberId, roomId);
    const wrapped = (event: RelayEventEnvelope) => {
      if (canDeliverRoomEventToMember(event, member)) {
        listener(event);
      }
    };
    const subscribers = this.subscribersByRoom.get(roomId) ?? new Set();
    subscribers.add(wrapped);
    this.subscribersByRoom.set(roomId, subscribers);
    return () => subscribers.delete(wrapped);
  }

  listEvents(roomId: string): RelayEventEnvelope[] {
    return [...(this.eventsByRoom.get(roomId) ?? [])];
  }

  listEventsForMember(roomId: string, memberId: string): RelayEventEnvelope[] {
    const member = this.requireMember(memberId, roomId);
    return this.listEvents(roomId).filter((event) => canDeliverRoomEventToMember(event, member));
  }

  listMembers(roomId: string): RelayRoomMember[] {
    return [...this.members.values()].filter((member) => member.roomId === roomId);
  }

  private updateInviteStatus(invite: RelayRoomInvite, status: RelayInviteStatus) {
    this.invites.set(invite.token, { ...invite, status });
    this.persist();
  }

  private requireWorkspace(workspaceId: string) {
    if (!this.workspaces.has(workspaceId)) throw new Error("workspace_not_found");
  }

  private requireRoom(roomId: string, workspaceId?: string): RelayRoom {
    const room = this.rooms.get(roomId);
    if (!room || (workspaceId && room.workspaceId !== workspaceId)) throw new Error("room_not_found");
    return room;
  }

  private requireMember(memberId: string, roomId: string): RelayRoomMember {
    const member = this.members.get(memberId);
    if (!member || member.roomId !== roomId) throw new Error("member_not_found");
    return member;
  }

  private restore(snapshot: RelaySnapshot) {
    for (const workspace of snapshot.workspaces ?? []) {
      this.workspaces.set(workspace.id, workspace);
    }
    for (const node of snapshot.nodes ?? []) {
      this.nodes.set(node.id, node);
    }
    for (const room of snapshot.rooms ?? []) {
      this.rooms.set(room.id, room);
    }
    for (const member of snapshot.members ?? []) {
      this.members.set(member.id, member);
    }
    for (const access of snapshot.memberAccesses ?? []) {
      this.memberAccessByToken.set(access.token, access);
    }
    for (const invite of snapshot.invites ?? []) {
      this.invites.set(invite.token, invite);
    }
    for (const entry of snapshot.eventsByRoom ?? []) {
      this.eventsByRoom.set(entry.roomId, [...entry.events]);
    }
    const maxEventSeq = [...this.eventsByRoom.values()]
      .flat()
      .reduce((max, event) => Math.max(max, event.seq), 0);
    this.seq = Math.max(snapshot.seq ?? 0, maxEventSeq);
  }

  private persist() {
    this.onChange?.(this.snapshot());
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function createRelayId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function createRelayToken(): string {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
