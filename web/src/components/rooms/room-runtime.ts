export type RoomContextMessage = {
  id: string;
  seq: number;
  senderName: string;
  senderType: "user" | "agent" | "system";
  text: string;
  targetNames: string[];
  status: string;
  createdAt: string;
};

export type RoomDeliveryContext = {
  room: {
    id: string;
    kind: "group" | "direct";
    title: string;
  };
  target: {
    id: string;
    name: string;
    kernel: string;
    model: string;
  };
  currentMessageId: string;
  messages: RoomContextMessage[];
};

export function roomAgentThreadId(roomId: string, targetId: string, targetKernel: string): string {
  const safeTarget = `${roomId || "room"}-${targetId || "member"}-${targetKernel || "kernel"}`
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  return `room-agent-${safeTarget}`;
}

export function buildRoomMemberContext(input: {
  targetName: string;
  targetKernel: string;
  targetModel: string;
  targetRole: string;
  roomContext?: RoomDeliveryContext;
}): string {
  const role = input.targetRole.trim();
  const roomContext = input.roomContext ? renderRoomDeliveryContext(input.roomContext) : "";
  const sections = [
    "OpenGrove room member instructions:",
    `You are participating in this room as "${input.targetName}".`,
    `Runtime binding: kernel=${input.targetKernel || "kernel"}, model=${input.targetModel || "default"}.`,
    role ? `Role and persona:\n${role}` : "",
    roomContext,
    [
      "Behavior:",
      "- Stay in this employee role for this turn.",
      "- Treat the current delivery event as the user task; do not repeat these hidden routing instructions.",
      "- Treat the room/channel as the collaboration boundary. Do not use other rooms unless the user explicitly asks.",
      "- Use the room ledger window for shared facts. If the visible window is insufficient, say what context you need instead of guessing.",
      "- Use the kernel's normal tools and project context when the task requires real work.",
      "- Keep the final reply useful in a group chat: explain the result, blockers, and next action briefly.",
    ].join("\n"),
  ].filter(Boolean);
  return sections.join("\n\n");
}

function renderRoomDeliveryContext(context: RoomDeliveryContext, limit = 50): string {
  const currentMessage = context.messages.find((message) => message.id === context.currentMessageId);
  const visibleMessages = context.messages
    .filter((message) => message.senderType !== "system" && message.text.trim())
    .slice(-limit);
  const lines = [
    "<opengrove_room_delivery>",
    `  <room id="${escapeXml(context.room.id)}" kind="${escapeXml(context.room.kind)}" title="${escapeXml(context.room.title)}" />`,
    `  <target_member id="${escapeXml(context.target.id)}" name="${escapeXml(context.target.name)}" kernel="${escapeXml(context.target.kernel)}" model="${escapeXml(context.target.model)}" />`,
    currentMessage
      ? `  <current_message id="${escapeXml(currentMessage.id)}" seq="${currentMessage.seq}" sender="${escapeXml(currentMessage.senderName)}">${escapeXml(currentMessage.text)}</current_message>`
      : "",
    "  <channel_messages>",
    ...visibleMessages.map((message) => {
      const targets = message.targetNames.length ? ` target="${escapeXml(message.targetNames.join(", "))}"` : "";
      return `    <message id="${escapeXml(message.id)}" seq="${message.seq}" sender="${escapeXml(message.senderName)}" status="${escapeXml(message.status)}"${targets}>${escapeXml(`${message.senderName}: ${message.text}`)}</message>`;
    }),
    "  </channel_messages>",
    "  <note>This is a shared room ledger window for this delivery. Older messages may be omitted.</note>",
    "</opengrove_room_delivery>",
  ];
  return lines.filter(Boolean).join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
