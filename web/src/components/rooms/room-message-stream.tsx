import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { AgentEventRecord, AttachmentPayload, MessagePart, NotePart, SkillPart, TextPart, ToolPart } from "../../bridge";
import { applyStreamEventToMessage, isRenderableMessagePart } from "../../messages";
import { attachmentIcon } from "../../runtime/ui-model";
import { AssistantProcessBlock, buildActivityItems, choiceFormFromItem } from "../chat/message-activity";
import { ThreadTextBlock } from "../chat/message-markdown";
import { RoomMemberAvatar } from "./member-avatar";
import {
  cloneMessageParts,
  formatShortTime,
  roomActivityParts,
  roomMessageToStored,
  shouldUseRoomActivityEvent,
} from "./room-message-model";
import type { MessageStatus, RoomMember, RoomMessage } from "./rooms-model";

export function RoomMessageStream(props: {
  messages: RoomMessage[];
  members: RoomMember[];
  runtimeEventsByRunId: Map<string, AgentEventRecord[]>;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt(prompt: string): void;
  onSubmitPrompt(prompt: string): void;
}) {
  const activeChoiceFormKey = findActiveRoomChoiceFormKey(props.messages);
  return (
    <div className="room-chat-stream">
      {props.messages.map((message) => (
        <RoomMessageItem
          key={message.id}
          message={message}
          members={props.members}
          runtimeEventsByRunId={props.runtimeEventsByRunId}
          activeChoiceFormKey={activeChoiceFormKey}
          onResolveApproval={props.onResolveApproval}
          onInsertPrompt={props.onInsertPrompt}
          onSubmitPrompt={props.onSubmitPrompt}
        />
      ))}
    </div>
  );
}

function RoomMessageItem(props: {
  message: RoomMessage;
  members: RoomMember[];
  runtimeEventsByRunId: Map<string, AgentEventRecord[]>;
  activeChoiceFormKey?: string;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt(prompt: string): void;
  onSubmitPrompt(prompt: string): void;
}) {
  const { message } = props;
  const member = props.members.find((item) => item.id === message.senderId);
  const isUser = message.senderType === "user";
  const isSystem = message.senderType === "system";
  if (isSystem) {
    return <div className="room-chat-system">{message.text}</div>;
  }

  const statusText = message.status === "running"
    ? "执行中"
    : message.status === "failed"
      ? "失败"
      : message.status === "interrupted"
        ? "已中断"
        : message.duration
          ? `完成 · ${message.duration}`
          : formatShortTime(message.createdAt);
  const parts = roomDisplayParts(message, message.runId ? props.runtimeEventsByRunId.get(message.runId) : undefined);
  const groups = isUser ? [] : groupRoomMessageParts(parts.filter(isRenderableMessagePart), message.id);
  const hasRenderableParts = groups.length > 0;
  const hasTextPart = groups.some((group) => group.type === "text");

  return (
    <article className={isUser ? "room-chat-message from-user" : "room-chat-message from-agent"} data-status={message.status}>
      {!isUser ? (
        <RoomMemberAvatar
          member={member}
          name={message.senderName}
          className="room-chat-avatar"
          status={member?.status ?? "idle"}
          color={member?.color ?? "#64748b"}
        />
      ) : null}
      <div className="room-chat-content">
        {!isUser ? (
          <div className="room-chat-author">
            <strong>{message.senderName}</strong>
            <span>{formatShortTime(message.createdAt)}</span>
          </div>
        ) : null}
        {!isUser ? (
          <RoomAgentMessageBody
            groups={groups}
            fallbackText={message.text}
            hasRenderableParts={hasRenderableParts}
            hasTextPart={hasTextPart}
            isThinking={message.status === "running" && !message.text.trim() && !hasRenderableParts}
            status={message.status}
            statusText={statusText}
            activeChoiceFormKey={props.activeChoiceFormKey}
            onResolveApproval={props.onResolveApproval}
            onInsertPrompt={props.onInsertPrompt}
            onSubmitPrompt={props.onSubmitPrompt}
          />
        ) : (
          <RoomTextBubble text={message.text} isUser={isUser} />
        )}
        {message.attachments?.length ? <RoomMessageAttachments attachments={message.attachments} /> : null}
        {isUser && statusText ? <div className="room-chat-status" data-status={message.status}>{statusText}</div> : null}
      </div>
    </article>
  );
}

function roomDisplayParts(message: RoomMessage, runtimeEventsForRun: AgentEventRecord[] | undefined): MessagePart[] {
  const messageParts = cloneMessageParts(message.parts).filter((part) => !isDuplicateFinalErrorNote(message, part));
  const hasActivityParts = roomActivityParts(messageParts).length > 0;
  if (hasActivityParts || !runtimeEventsForRun?.length) {
    return messageParts;
  }

  const activityEvents = runtimeEventsForRun.filter((event) => shouldUseRoomActivityEvent(event, message.status, message.text));
  if (!activityEvents.length) {
    return messageParts;
  }

  const stored = roomMessageToStored({ ...message, text: "", parts: [] });
  for (const event of activityEvents) {
    applyStreamEventToMessage(stored, event);
  }
  return [...stored.parts, ...messageParts];
}

function isDuplicateFinalErrorNote(message: RoomMessage, part: MessagePart): boolean {
  if (message.status === "running" || part.type !== "note" || part.tone !== "error") {
    return false;
  }
  const noteText = part.text.trim();
  const messageText = message.text.trim();
  return Boolean(
    messageText &&
    (noteText === messageText || noteText === `模型调用出错：${messageText}` || messageText === `模型调用出错：${noteText}`),
  );
}

type RoomPartGroup =
  | { type: "text"; part: TextPart }
  | { type: "note"; part: NotePart }
  | { type: "activity"; key: string; parts: Array<ToolPart | SkillPart> };

function groupRoomMessageParts(parts: MessagePart[], messageId: string): RoomPartGroup[] {
  const groups: RoomPartGroup[] = [];
  let activityParts: Array<ToolPart | SkillPart> = [];
  let activityIndex = 0;

  const flushActivity = () => {
    if (!activityParts.length) return;
    groups.push({
      type: "activity",
      key: `${messageId}:activity-${activityIndex++}-${activityParts[0]?.id || "group"}`,
      parts: activityParts,
    });
    activityParts = [];
  };

  for (const part of parts) {
    if (part.type === "tool" || part.type === "skill") {
      activityParts.push(part);
      continue;
    }
    flushActivity();
    if (part.type === "text") {
      groups.push({ type: "text", part });
    } else if (part.type === "note") {
      groups.push({ type: "note", part });
    }
  }

  flushActivity();
  return groups;
}

function findActiveRoomChoiceFormKey(messages: RoomMessage[]): string | undefined {
  const lastUserIndex = messages.reduce((latest, message, index) => (message.senderType === "user" ? index : latest), -1);
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const message = messages[index];
    if (!message || message.senderType !== "agent") continue;
    const groups = groupRoomMessageParts((message.parts || []).filter(isRenderableMessagePart), message.id);
    for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
      const group = groups[groupIndex];
      if (group.type !== "activity") continue;
      if (buildActivityItems(group.parts).some((item) => Boolean(choiceFormFromItem(item)))) {
        return group.key;
      }
    }
  }
  return undefined;
}

function RoomTextBubble(props: { text: string; isUser: boolean; measureRef?: RefObject<HTMLDivElement | null> }) {
  if (!props.text.trim()) return null;
  return (
    <div className="room-chat-bubble" ref={props.measureRef}>
      <RoomTextContent text={props.text} isUser={props.isUser} />
    </div>
  );
}

function RoomTextContent(props: { text: string; isUser: boolean }) {
  return props.isUser ? <>{props.text}</> : <ThreadTextBlock text={props.text} />;
}

function RoomAgentMessageBody(props: {
  groups: RoomPartGroup[];
  fallbackText: string;
  hasRenderableParts: boolean;
  hasTextPart: boolean;
  isThinking: boolean;
  status: MessageStatus;
  statusText: string;
  activeChoiceFormKey?: string;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt(prompt: string): void;
  onSubmitPrompt(prompt: string): void;
}) {
  const shouldRenderFallbackText = props.fallbackText.trim() && (!props.hasRenderableParts || !props.hasTextPart);
  const bubbleMeasureRef = useRef<HTMLDivElement | null>(null);
  const [bubbleWidth, setBubbleWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = bubbleMeasureRef.current;
    if (!element) {
      setBubbleWidth(null);
      return;
    }

    const updateWidth = () => {
      const width = Math.ceil(element.getBoundingClientRect().width);
      setBubbleWidth((current) => (current === width ? current : width));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.fallbackText, props.groups, props.hasRenderableParts, props.hasTextPart, props.isThinking]);

  let measureRefUsed = false;
  const takeMeasureRef = () => {
    if (measureRefUsed) return undefined;
    measureRefUsed = true;
    return bubbleMeasureRef;
  };
  const stackStyle = bubbleWidth ? { "--room-agent-bubble-width": `${bubbleWidth}px` } as CSSProperties : undefined;

  return (
    <div className="room-chat-agent-stack" style={stackStyle}>
      {props.hasRenderableParts ? (
        props.groups.map((group) => {
          if (group.type === "activity") {
            return (
              <RoomActivityBlock
                key={group.key}
                group={group}
                activeChoiceFormKey={props.activeChoiceFormKey}
                onResolveApproval={props.onResolveApproval}
                onInsertPrompt={props.onInsertPrompt}
                onSubmitPrompt={props.onSubmitPrompt}
              />
            );
          }
          if (group.type === "note") {
            return <RoomNoteBlock key={group.part.id} part={group.part} />;
          }
          return <RoomTextBubble key={group.part.id} text={group.part.text} isUser={false} measureRef={takeMeasureRef()} />;
        })
      ) : null}
      {shouldRenderFallbackText ? (
        <RoomTextBubble text={props.fallbackText} isUser={false} measureRef={takeMeasureRef()} />
      ) : null}
      {props.isThinking ? <div className="room-chat-thinking" ref={takeMeasureRef()}>正在思考</div> : null}
      {props.statusText ? <div className="room-chat-status" data-status={props.status}>{props.statusText}</div> : null}
    </div>
  );
}

function RoomNoteBlock(props: { part: NotePart }) {
  return <div className={`room-chat-note tone-${props.part.tone || "muted"}`}>{props.part.text}</div>;
}

function RoomActivityBlock(props: {
  group: Extract<RoomPartGroup, { type: "activity" }>;
  activeChoiceFormKey?: string;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt(prompt: string): void;
  onSubmitPrompt(prompt: string): void;
}) {
  const entries = buildActivityItems(props.group.parts).map((item) => ({
    groupKey: props.group.key,
    item,
  }));
  if (!entries.length) return null;
  return (
    <div className="room-chat-tools">
      <AssistantProcessBlock
        entries={entries}
        activeChoiceFormKey={props.activeChoiceFormKey}
        onResolveApproval={props.onResolveApproval}
        onInsertPrompt={props.onInsertPrompt}
        onSubmitPrompt={props.onSubmitPrompt}
      />
    </div>
  );
}

function RoomMessageAttachments(props: { attachments: AttachmentPayload[] }) {
  return (
    <div className="room-message-attachments">
      {props.attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment);
        if (attachment.kind === "image") {
          const previewUrl = attachment.thumbnailUrl || attachment.dataUrl;
          return (
            <div className="room-message-attachment image" key={attachment.id || attachment.name} title={attachment.name}>
              {previewUrl ? <img src={previewUrl} alt="" /> : <ImageIcon size={18} />}
            </div>
          );
        }
        return (
          <div className="room-message-attachment" key={attachment.id || attachment.name} title={attachment.name}>
            <Icon size={14} />
            <span>{attachment.name}</span>
          </div>
        );
      })}
    </div>
  );
}
