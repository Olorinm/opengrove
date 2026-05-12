import assert from "node:assert/strict";
import { RoomChannelStore, type RoomChannelMember } from "../rooms/channel-store.js";

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

const restored = new RoomChannelStore();
restored.restore(store.snapshot());
assert.equal(restored.listMessages(room.id).length, 4);
assert.equal(restored.eventsAfter(0).currentEventSeq, store.snapshot().currentEventSeq);

const paged = restored.listMessages(room.id, { beforeSeq: 4, limit: 2 });
assert.deepEqual(paged.map((message) => message.channelSeq), [2, 3]);

console.log(JSON.stringify({
  ok: true,
  roomId: room.id,
  messages: restored.listMessages(room.id).length,
  currentEventSeq: restored.snapshot().currentEventSeq,
}, null, 2));
