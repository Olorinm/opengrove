import assert from "node:assert/strict";
import { RoomChannelStore, type RoomChannelMember } from "../rooms/channel-store.js";
import { isRunnableRoomAssistantTarget } from "../server/room-runs.js";

const codex: RoomChannelMember = {
  id: "employee-codex",
  name: "Codex",
  kernel: "codex",
  model: "gpt-5.5",
  role: "agent",
  status: "idle",
  color: "#2563eb",
  lastActive: "now",
  source: "local",
};

const claude: RoomChannelMember = {
  id: "employee-claude",
  name: "Claude Code",
  kernel: "claude-code",
  model: "default",
  role: "agent",
  status: "idle",
  color: "#f59e0b",
  lastActive: "now",
  source: "local",
};

const store = new RoomChannelStore();
store.ensureOpenGroup([codex, claude]);

const openGroup = store.getRoom("room-open-group");
assert.ok(openGroup, "open group should be created");
assert.deepEqual(openGroup.memberIds, [codex.id, claude.id]);

const room = store.createRoom({ title: "Slock parity", memberIds: [codex.id] });
store.addMember(room.id, claude);

const first = store.postUserMessage({
  roomId: room.id,
  text: "@Codex give the codeword",
  targetIds: [codex.id],
  assistantTargets: [codex],
});
assert.equal(first.userMessage.channelSeq, 1);
assert.equal(first.assistantMessages[0]?.channelSeq, 2);

const second = store.postUserMessage({
  roomId: room.id,
  text: "@Claude Code repeat the codeword",
  targetIds: [claude.id],
  assistantTargets: [claude],
});
assert.equal(second.userMessage.channelSeq, 3);
assert.equal(second.assistantMessages[0]?.channelSeq, 4);
assert.ok(second.currentEventSeq > first.currentEventSeq, "eventSeq should be global and increasing");

const afterFirst = store.eventsAfter(first.currentEventSeq);
assert.ok(afterFirst.events.some((event) => event.type === "room.message.created" && event.messageId === second.userMessage.id));
const existingMemberEventSeq = store.snapshot().currentEventSeq;
store.upsertMember({ ...codex, lastActive: "later" }, { emitEvent: true });
assert.ok(
  store.eventsAfter(existingMemberEventSeq).events.some((event) => event.type === "room.member.updated" && event.memberId === codex.id),
  "upserting an existing member should emit member.updated",
);

const restored = new RoomChannelStore();
restored.restore(store.snapshot());
assert.equal(restored.listMessages(room.id).length, 4);
assert.equal(restored.eventsAfter(0).currentEventSeq, store.snapshot().currentEventSeq);

const paged = restored.listMessages(room.id, { beforeSeq: 4, limit: 2 });
assert.deepEqual(paged.map((message) => message.channelSeq), [2, 3]);

const remote: RoomChannelMember = {
  id: "employee-remote",
  name: "Remote Claude",
  kernel: "claude-code",
  model: "remote-default",
  role: "remote collaborator",
  status: "idle",
  color: "#7c3aed",
  lastActive: "now",
  source: "remote",
  sourceLabel: "远程",
  inviteStatus: "accepted",
  homeNodeLabel: "Friend Node",
  remote: {
    provider: "matrix",
    accountId: "default",
    ownerId: "@friend:example.com",
    agentId: "remote-claude",
  },
};

const matrixRoom = store.createRoom({
  id: "room-matrix-shared",
  title: "Matrix shared",
  memberIds: [codex.id],
  badge: "Matrix",
  remote: {
    provider: "matrix",
    accountId: "default",
    remoteRoomId: "!room:example.com",
    localMemberId: codex.id,
    mode: "host",
  },
});
store.addMember(matrixRoom.id, remote);
const matrixPost = store.postUserMessage({
  roomId: matrixRoom.id,
  text: "@Remote Claude please check the handoff",
  targetIds: [remote.id],
  assistantTargets: [remote],
});
const remotePlaceholder = matrixPost.assistantMessages[0];
assert.ok(remotePlaceholder, "remote target should still get a ledger placeholder");
const deliveredRemote = store.updateMessage(matrixRoom.id, remotePlaceholder.id, {
  remote: {
    provider: "matrix",
    accountId: "default",
    remoteRoomId: "!room:example.com",
    eventId: "$agent-request",
    turnId: "turn-remote-1",
  },
});
assert.equal(deliveredRemote.remote?.eventId, "$agent-request");
store.patchMember(remote.id, { disabled: true, status: "offline", lastActive: "已移除" });
assert.ok(
  store.eventsAfter(matrixPost.currentEventSeq).events.some((event) => event.type === "room.member.updated" && event.memberId === remote.id),
  "member updates should be emitted for room clients",
);

const restoredMatrix = new RoomChannelStore();
restoredMatrix.restore(store.snapshot());
assert.deepEqual(restoredMatrix.getRoom(matrixRoom.id)?.remote, {
  provider: "matrix",
  accountId: "default",
  remoteRoomId: "!room:example.com",
  localMemberId: codex.id,
  mode: "host",
});
const restoredRemote = restoredMatrix.listMembers().find((member) => member.id === remote.id);
assert.equal(restoredRemote?.remote?.ownerId, "@friend:example.com");
assert.equal(restoredRemote?.remote?.agentId, "remote-claude");
assert.equal(restoredRemote?.disabled, true);
assert.ok(restoredMatrix.listDeletedMemberIds().includes(remote.id), "deleted member ids should survive restore");
const restoredRemoteMessage = restoredMatrix.listMessages(matrixRoom.id).find((message) => message.id === remotePlaceholder.id);
assert.equal(restoredRemoteMessage?.remote?.eventId, "$agent-request");
assert.equal(restoredRemoteMessage?.remote?.turnId, "turn-remote-1");

const legacyStore = new RoomChannelStore();
legacyStore.restore({
  version: 1,
  currentEventSeq: 0,
  rooms: [{
    id: "room-legacy-matrix",
    kind: "group",
    title: "Legacy Matrix",
    badge: "Matrix",
    memberIds: ["employee-legacy-remote"],
    unread: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    matrix: {
      roomId: "!legacy:example.com",
      localMemberId: codex.id,
      mode: "guest",
    },
  }],
  members: [{
    id: "employee-legacy-remote",
    name: "Legacy Remote",
    kernel: "claude-code",
    model: "remote-default",
    role: "remote collaborator",
    status: "idle",
    color: "#7c3aed",
    lastActive: "now",
    source: "remote",
    matrixUserId: "@legacy:example.com",
    matrixAgentId: "legacy-agent",
  }],
  messages: [{
    id: "message-legacy",
    roomId: "room-legacy-matrix",
    channelSeq: 1,
    senderId: "employee-legacy-remote",
    senderName: "Legacy Remote",
    senderType: "agent",
    text: "legacy",
    targetIds: [],
    status: "done",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    matrixEventId: "$legacy-event",
    matrixTurnId: "legacy-turn",
  }],
  events: [],
} as any);
const legacyRoom = legacyStore.getRoom("room-legacy-matrix");
const legacyMember = legacyStore.listMembers().find((member) => member.id === "employee-legacy-remote");
const legacyMessage = legacyStore.listMessages("room-legacy-matrix")[0];
assert.equal(legacyRoom?.remote?.remoteRoomId, "!legacy:example.com");
assert.equal((legacyRoom as any)?.matrix, undefined);
assert.equal(legacyMember?.remote?.ownerId, "@legacy:example.com");
assert.equal((legacyMember as any)?.matrixUserId, undefined);
assert.equal(legacyMessage?.remote?.eventId, "$legacy-event");
assert.equal((legacyMessage as any)?.matrixEventId, undefined);

const firstEventPage = restoredMatrix.eventsAfter(0, 1);
assert.equal(firstEventPage.events.length, 1);
assert.equal(firstEventPage.hasMore, true);
const secondEventPage = restoredMatrix.eventsAfter(firstEventPage.events[0]!.eventSeq, 1);
assert.equal(secondEventPage.events.length, 1);
assert.ok(secondEventPage.events[0]!.eventSeq > firstEventPage.events[0]!.eventSeq);

assert.equal(isRunnableRoomAssistantTarget(codex), true);
assert.equal(isRunnableRoomAssistantTarget(remote), false);
assert.equal(isRunnableRoomAssistantTarget({ ...codex, source: "human", kernel: "user" }), false);
assert.equal(isRunnableRoomAssistantTarget({ ...codex, disabled: true }), false);
assert.equal(isRunnableRoomAssistantTarget({ ...codex, kernel: "browser" }), false);

console.log(JSON.stringify({
  ok: true,
  roomId: room.id,
  messages: restoredMatrix.listMessages(room.id).length,
  currentEventSeq: restoredMatrix.snapshot().currentEventSeq,
}, null, 2));
