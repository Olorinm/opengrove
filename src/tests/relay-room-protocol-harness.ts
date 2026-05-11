import assert from "node:assert/strict";
import { InMemoryRelay } from "../relay/in-memory-relay.js";

const relay = new InMemoryRelay();
const workspace = relay.createWorkspace("Relay Harness");
const room = relay.createRoom({
  workspaceId: workspace.id,
  title: "open group",
  createdByMemberId: "bootstrap",
});
const owner = relay.addMember({
  workspaceId: workspace.id,
  roomId: room.id,
  kind: "human",
  displayName: "我",
});

const invite = relay.createInvite({
  workspaceId: workspace.id,
  roomId: room.id,
  createdByMemberId: owner.id,
  targetKind: "remote-agent",
});
assert.equal(invite.status, "pending");

const accepted = relay.acceptInvite({
  token: invite.token,
  displayName: "ReviewBot",
  nodeId: "node-cindy",
  agentId: "review-bot",
});
assert.equal(accepted.invite.status, "accepted");
assert.equal(accepted.member.kind, "remote-agent");

const delivered: string[] = [];
const unsubscribe = relay.subscribeRoom(room.id, accepted.member.id, (event) => {
  delivered.push(event.type);
});

relay.publishEvent({
  type: "room.message.created",
  workspaceId: workspace.id,
  roomId: room.id,
  actorMemberId: owner.id,
  targetMemberIds: [accepted.member.id],
  payload: { text: "@ReviewBot 看一下" },
});
assert.deepEqual(delivered, ["room.message.created"]);

relay.publishEvent({
  type: "room.message.created",
  workspaceId: workspace.id,
  roomId: room.id,
  actorMemberId: owner.id,
  payload: { text: "没有 @ 的普通消息" },
});
assert.deepEqual(delivered, ["room.message.created"]);

unsubscribe();
assert.equal(relay.listMembers(room.id).length, 2);
assert.equal(relay.listEvents(room.id).some((event) => event.type === "invite.accepted"), true);

console.log("relay-room-protocol-harness ok");
