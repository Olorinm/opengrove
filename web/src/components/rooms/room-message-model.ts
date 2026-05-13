import type { AgentEventRecord, MessagePart, SkillPart, StoredMessage, TextPart, ToolPart } from "../../bridge";
import { applyStreamEventToMessage, closeDanglingMessageActivity, finalizeAssistantMessage, markAssistantMessageError } from "../../messages";
import { activityItemStatus, buildActivityItems, choiceFormFromItem, summarizeActivityItems } from "../chat/message-activity";
import type { MessageStatus, RoomMember, RoomMessage } from "./rooms-model";

export function cloneMessageParts(parts: MessagePart[] | undefined): MessagePart[] {
  return Array.isArray(parts) ? parts.map((part) => ({ ...part })) : [];
}

export function roomMessageToStored(message: RoomMessage): StoredMessage {
  return {
    id: message.id,
    role: message.senderType === "agent" ? "assistant" : message.senderType,
    text: message.text,
    context: message.attachments?.length ? { text: "", attachments: message.attachments } : null,
    parts: cloneMessageParts(message.parts),
    pending: message.status === "running",
    runId: message.runId || "",
    startedAt: message.startedAt,
    finishedAt: message.finishedAt,
  };
}

export function roomMessageFromStored(message: RoomMessage, stored: StoredMessage, status: MessageStatus = message.status): RoomMessage {
  return {
    ...message,
    text: stored.text,
    status,
    runId: stored.runId || message.runId,
    startedAt: stored.startedAt || message.startedAt,
    finishedAt: stored.finishedAt || message.finishedAt,
    parts: stored.parts,
  };
}

export function isRoomActivityEvent(event: AgentEventRecord | undefined): event is AgentEventRecord {
  return [
    "turn.started",
    "turn.finished",
    "tool.started",
    "tool.finished",
    "approval.requested",
    "approval.resolved",
    "skill.invoked",
    "skill.loaded",
    "skill.forked",
    "skill.cleared",
    "compaction.started",
    "compaction.finished",
    "error",
  ].includes(String(event?.type || ""));
}

export function shouldUseRoomActivityEvent(
  event: AgentEventRecord | undefined,
  status: MessageStatus,
  text: string,
): event is AgentEventRecord {
  if (!isRoomActivityEvent(event)) return false;
  return !(event.type === "error" && status !== "running" && text.trim());
}

export function failRoomMessage(message: RoomMessage, errorMessage: string): RoomMessage {
  const stored = roomMessageToStored(message);
  markAssistantMessageError(stored, errorMessage);
  return roomMessageFromStored(message, stored, "failed");
}

export function formatShortTime(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "";
  return time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatRoomPreview(message: RoomMessage | undefined): string {
  if (!message) return "还没有消息";
  if (message.senderType === "system") return message.text;
  const prefix = `${message.senderName}: `;
  const summary = roomActivitySummary(message);
  if (message.status === "running") {
    return `${prefix}${summary || "执行中"}`;
  }
  if (message.status === "failed") {
    return `${prefix}失败`;
  }
  if (message.status === "interrupted") {
    return `${prefix}已中断`;
  }
  if (message.text.trim()) {
    return `${prefix}${message.text.trim()}`;
  }
  if (summary) {
    return `${prefix}${summary}`;
  }
  if (message.attachments?.length) {
    return `${prefix}[附件]`;
  }
  return `${prefix}已完成`;
}

export function roomActivityParts(parts: MessagePart[] | undefined): Array<ToolPart | SkillPart> {
  return (parts || []).filter((part): part is ToolPart | SkillPart => part.type === "tool" || part.type === "skill");
}

export function roomActivitySummary(message: RoomMessage): string {
  const items = buildActivityItems(roomActivityParts(message.parts));
  if (!items.length) return "";
  const active = message.status === "running" || items.some((item) => activityItemStatus(item) === "running");
  return summarizeActivityItems(items, {
    active,
    pendingApproval: items.some((item) => item.type === "approval" && item.part.approvalStatus === "pending"),
    activeChoiceForm: items.some((item) => Boolean(choiceFormFromItem(item))),
  });
}

export function roomMessageText(message: RoomMessage): string {
  const textFromParts = (message.parts || [])
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
  return textFromParts || message.text || "";
}

export function finalizeRoomMessageFromRun(
  message: RoomMessage,
  events: AgentEventRecord[] | undefined,
  status: MessageStatus,
  duration?: string,
  answer?: string,
): RoomMessage {
  const stored = roomMessageToStored(message);
  const activityEvents = events?.filter((event) => shouldUseRoomActivityEvent(event, status, answer || message.text)) ?? [];
  if (!roomActivityParts(stored.parts).length && activityEvents.length) {
    for (const event of activityEvents) {
      applyStreamEventToMessage(stored, event);
    }
  }
  finalizeAssistantMessage(stored, { answer, events });
  return {
    ...roomMessageFromStored(message, stored, status),
    duration: duration || message.duration,
  };
}

export function interruptRoomMessage(message: RoomMessage): RoomMessage {
  const stored = roomMessageToStored(message);
  closeDanglingMessageActivity(stored, { status: "failed", errorMessage: "执行流已中断" });
  stored.pending = false;
  stored.finishedAt = stored.finishedAt || new Date().toISOString();
  return roomMessageFromStored(message, stored, "interrupted");
}

export function roomMemberNames(members: RoomMember[]): string {
  return members.map((member) => member.name).join("、");
}
