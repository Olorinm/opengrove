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
  matrixUserId: "@friend:example.com",
  matrixAgentId: "remote-claude",
};

const matrixRoom = store.createRoom({
  id: "room-matrix-shared",
  title: "Matrix shared",
  memberIds: [codex.id],
  badge: "Matrix",
  matrix: {
    homeserverUrl: "https://matrix.example.com",
    roomId: "!room:example.com",
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
  matrixEventId: "$agent-request",
  matrixTurnId: "turn-remote-1",
});
assert.equal(deliveredRemote.matrixEventId, "$agent-request");
store.patchMember(remote.id, { disabled: true, status: "offline", lastActive: "已移除" });
assert.ok(
  store.eventsAfter(matrixPost.currentEventSeq).events.some((event) => event.type === "room.member.updated" && event.memberId === remote.id),
  "member updates should be emitted for room clients",
);

const restoredMatrix = new RoomChannelStore();
restoredMatrix.restore(store.snapshot());
assert.deepEqual(restoredMatrix.getRoom(matrixRoom.id)?.matrix, {
  homeserverUrl: "https://matrix.example.com",
  roomId: "!room:example.com",
  localMemberId: codex.id,
  mode: "host",
});
const restoredRemote = restoredMatrix.listMembers().find((member) => member.id === remote.id);
assert.equal(restoredRemote?.matrixUserId, "@friend:example.com");
assert.equal(restoredRemote?.matrixAgentId, "remote-claude");
assert.equal(restoredRemote?.disabled, true);
assert.ok(restoredMatrix.listDeletedMemberIds().includes(remote.id), "deleted member ids should survive restore");
const restoredRemoteMessage = restoredMatrix.listMessages(matrixRoom.id).find((message) => message.id === remotePlaceholder.id);
assert.equal(restoredRemoteMessage?.matrixEventId, "$agent-request");
assert.equal(restoredRemoteMessage?.matrixTurnId, "turn-remote-1");

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
