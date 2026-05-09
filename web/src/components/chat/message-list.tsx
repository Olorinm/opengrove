import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Bot,
  LoaderCircle,
  ShieldAlert,
  X,
  UserRound,
} from "lucide-react";
import type { AgentEventRecord, MessagePart, RunRecord, SkillPart, SkillRecord, StoredMessage, ToolPart } from "../../bridge";
import { summarize } from "../../format";
import { hasRenderableMessageParts, isRenderableMessagePart } from "../../messages";
import { AssistantProcessBlock, activityItemStatus, buildActivityItems, choiceFormFromItem } from "./message-activity";
import { ThreadTextBlock } from "./message-markdown";
import type { ChatImagePayload } from "./message-types";

export function MessageList(props: {
  messages: StoredMessage[];
  skills?: SkillRecord[];
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt?(prompt: string): void;
  onSubmitPrompt?(prompt: string): void;
  onTrySkill?(skillName: string): void;
  onEditSkill?(skillName: string): void;
  onSaveImageArtifact?(image: ChatImagePayload): void;
}) {
  const [previewImage, setPreviewImage] = useState<ChatImagePayload | null>(null);
  const visibleMessages = props.messages;
  const activeChoiceFormKey = findActiveChoiceFormKey(visibleMessages);

  return (
    <>
      <div className="thread-stack">
        {visibleMessages.map((message, index) => (
          <ThreadMessage
            key={message.id}
            message={message}
            skills={props.skills}
            runtimeEvents={props.runtimeEvents}
            runs={props.runs}
            precedingUserText={previousUserMessageText(visibleMessages, index)}
            activeChoiceFormKey={activeChoiceFormKey}
            onResolveApproval={props.onResolveApproval}
            onInsertPrompt={props.onInsertPrompt}
            onSubmitPrompt={props.onSubmitPrompt}
            onTrySkill={props.onTrySkill}
            onEditSkill={props.onEditSkill}
            onPreviewImage={setPreviewImage}
            onSaveImageArtifact={props.onSaveImageArtifact}
          />
        ))}
      </div>
      {previewImage ? (
        <div className="thread-image-lightbox" role="dialog" aria-modal="true" aria-label={previewImage.alt || "图片预览"} onClick={() => setPreviewImage(null)}>
          <div className="thread-image-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="thread-image-lightbox-header">
              <div>{previewImage.alt || "图片预览"}</div>
              <button type="button" className="thread-image-icon-button" onClick={() => setPreviewImage(null)} aria-label="关闭预览">
                <X size={16} />
              </button>
            </div>
            <img src={previewImage.src} alt={previewImage.alt || "图片预览"} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function ThreadMessage(props: {
  message: StoredMessage;
  skills?: SkillRecord[];
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  precedingUserText?: string;
  activeChoiceFormKey?: string;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt?(prompt: string): void;
  onSubmitPrompt?(prompt: string): void;
  onTrySkill?(skillName: string): void;
  onEditSkill?(skillName: string): void;
  onPreviewImage?(image: ChatImagePayload): void;
  onSaveImageArtifact?(image: ChatImagePayload): void;
}) {
  const { message } = props;
  const hasParts = hasRenderableMessageParts(message);
  const roleMeta = messageRoleMeta(message.role, message.pending);

  return (
    <article className={clsx("thread-message", `role-${message.role}`)} data-role={message.role}>
      <header className="thread-message-header">
        <div className={clsx("thread-message-avatar", `role-${message.role}`)} aria-hidden="true">
          {roleMeta.icon}
        </div>
        <div className="thread-message-meta">
          <div className="thread-message-role-row">
            <span className="thread-message-role">{roleMeta.title}</span>
            {message.pending ? (
              <span className="thread-inline-status">
                <LoaderCircle size={12} className="spin" />
                working
              </span>
            ) : null}
          </div>
          <div className="thread-message-subtitle">{roleMeta.subtitle}</div>
        </div>
      </header>

      <div className="thread-message-content">
        {message.role === "user" ? (
          <UserMessageBody message={message} />
        ) : message.role === "assistant" && hasParts ? (
          <AssistantMessageBody
            message={message}
            skills={props.skills}
            runtimeEvents={props.runtimeEvents}
            runs={props.runs}
            precedingUserText={props.precedingUserText}
            activeChoiceFormKey={props.activeChoiceFormKey}
            onResolveApproval={props.onResolveApproval}
            onInsertPrompt={props.onInsertPrompt}
            onSubmitPrompt={props.onSubmitPrompt}
            onTrySkill={props.onTrySkill}
            onEditSkill={props.onEditSkill}
            onPreviewImage={props.onPreviewImage}
            onSaveImageArtifact={props.onSaveImageArtifact}
          />
        ) : message.role === "assistant" && message.pending ? (
          <AssistantPendingBody
            message={message}
            runtimeEvents={props.runtimeEvents}
            runs={props.runs}
            precedingUserText={props.precedingUserText}
          />
        ) : message.role === "assistant" ? (
          <AssistantPlainBody
            message={message}
            skills={props.skills}
            runtimeEvents={props.runtimeEvents}
            runs={props.runs}
            precedingUserText={props.precedingUserText}
            onTrySkill={props.onTrySkill}
            onEditSkill={props.onEditSkill}
            onPreviewImage={props.onPreviewImage}
            onSaveImageArtifact={props.onSaveImageArtifact}
          />
        ) : (
          <ThreadTextBlock
            text={message.text}
            skills={props.skills}
            onTrySkill={props.onTrySkill}
            onEditSkill={props.onEditSkill}
            onPreviewImage={props.onPreviewImage}
            onSaveImageArtifact={props.onSaveImageArtifact}
          />
        )}
      </div>
    </article>
  );
}

function UserMessageBody(props: { message: StoredMessage }) {
  const attachments = props.message.context?.attachments ?? [];
  const artifacts = props.message.context?.artifacts ?? [];
  const selectedText = props.message.context?.selectedText?.trim() ?? "";
  const displayText = visibleUserMessageText(props.message.text);
  return (
    <div className="thread-user-stack">
      <div className="thread-user-bubble">{displayText}</div>
      {selectedText ? (
        <div className="thread-context-chip">已选文本片段 · {summarize(selectedText, 180)}</div>
      ) : null}
      {artifacts.length ? (
        <div className="thread-context-files">
          {artifacts.map((artifact) => (
            <span className="thread-context-file" key={artifact.id || artifact.title}>
              产物 · {artifact.title || artifact.id}
            </span>
          ))}
        </div>
      ) : null}
      {attachments.length ? (
        <div className="thread-context-files">
          {attachments.map((attachment) => (
            <span className="thread-context-file" key={attachment.id || attachment.name}>
              {attachment.kind === "image" ? "图片" : attachment.kind === "text" ? "文本" : "文件"} · {attachment.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const CHOICE_CONTINUATION_MARKER = "请基于这些选择继续完成原始任务。";
const TURN_STATUS_DELAY_SECONDS = 15;
const THINKING_IDLE_DELAY_MS = 1200;

function visibleUserMessageText(text: string): string {
  if (!text.includes(CHOICE_CONTINUATION_MARKER)) {
    return text;
  }
  const answerLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\s*.+?[：:]\s*.+/.test(line))
    .map((line) => line.replace(/^\d+\.\s*.+?[：:]\s*/, "").trim())
    .filter(Boolean);
  return answerLines.length ? answerLines.join("；") : text;
}

function previousUserMessageText(messages: StoredMessage[], messageIndex: number): string {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.text || "";
    }
  }
  return "";
}

function messageDurationSeconds(
  message: StoredMessage,
  runtimeEvents: AgentEventRecord[] = [],
  runs: RunRecord[] = [],
  inputHint = "",
  nowMs = Date.now(),
): number {
  const timing = messageTiming(message, runtimeEvents, runs, inputHint);
  const startedAt = Date.parse(timing.startedAt || "");
  const finishedAt = timing.finishedAt ? Date.parse(timing.finishedAt) : message.pending ? nowMs : Number.NaN;
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    return Number.NaN;
  }
  return Math.max(0, Math.round((finishedAt - startedAt) / 1000));
}

function formatDurationSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) {
    return "";
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function messageTiming(
  message: StoredMessage,
  runtimeEvents: AgentEventRecord[] = [],
  runs: RunRecord[] = [],
  inputHint = "",
): { startedAt?: string; finishedAt?: string } {
  const runId = message.runId || runIdFromInput(inputHint, runs);
  const eventTiming = timingFromEvents(runId, runtimeEvents);
  const runTiming = timingFromRuns(runId, runs);
  return {
    startedAt: message.startedAt || eventTiming.startedAt || runTiming.startedAt,
    finishedAt: message.finishedAt || eventTiming.finishedAt || runTiming.finishedAt,
  };
}

function timingFromEvents(runId: string, runtimeEvents: AgentEventRecord[]): { startedAt?: string; finishedAt?: string } {
  if (!runId || !Array.isArray(runtimeEvents)) {
    return {};
  }
  const runEvents = runtimeEvents.filter((event) => event?.runId === runId);
  const started = runEvents.find((event) => event?.type === "turn.started" && typeof event.at === "string");
  const finished = [...runEvents].reverse().find((event) => event?.type === "turn.finished" && typeof event.at === "string");
  return {
    startedAt: started?.at,
    finishedAt: finished?.at,
  };
}

function timingFromRuns(runId: string, runs: RunRecord[]): { startedAt?: string; finishedAt?: string } {
  if (!runId || !Array.isArray(runs)) {
    return {};
  }
  const run = runs.find((item) => item?.id === runId || item?.runId === runId);
  return {
    startedAt: typeof run?.startedAt === "string" ? run.startedAt : undefined,
    finishedAt: typeof run?.endedAt === "string" ? run.endedAt : typeof run?.finishedAt === "string" ? run.finishedAt : undefined,
  };
}

function runIdFromInput(inputHint: string, runs: RunRecord[]): string {
  const normalizedHint = normalizePromptForTiming(inputHint);
  if (!normalizedHint || !Array.isArray(runs)) {
    return "";
  }
  const candidates = runs
    .filter((run) => normalizePromptForTiming(run?.input) === normalizedHint)
    .sort((left, right) => String(right?.startedAt || right?.createdAt || "").localeCompare(String(left?.startedAt || left?.createdAt || "")));
  return candidates[0]?.id || candidates[0]?.runId || "";
}

function normalizePromptForTiming(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function AssistantMessageBody(props: {
  message: StoredMessage;
  skills?: SkillRecord[];
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  precedingUserText?: string;
  activeChoiceFormKey?: string;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt?(prompt: string): void;
  onSubmitPrompt?(prompt: string): void;
  onTrySkill?(skillName: string): void;
  onEditSkill?(skillName: string): void;
  onPreviewImage?(image: ChatImagePayload): void;
  onSaveImageArtifact?(image: ChatImagePayload): void;
}) {
  const parts = props.message.parts.filter(isRenderableMessagePart);
  const groups = groupAssistantParts(parts);

  return (
    <div className="thread-part-stack">
      <AssistantTurnStatus
        message={props.message}
        groups={groups}
        runtimeEvents={props.runtimeEvents}
        runs={props.runs}
        inputHint={props.precedingUserText}
      />
      {groups.map((group) => {
        if (group.type === "activity") {
          const entries = buildActivityItems(group.parts).map((item) => ({
            groupKey: group.key,
            item,
          }));
          return entries.length ? (
            <AssistantProcessBlock
              key={group.key}
              entries={entries}
              activeChoiceFormKey={props.activeChoiceFormKey}
              onResolveApproval={props.onResolveApproval}
              onInsertPrompt={props.onInsertPrompt}
              onSubmitPrompt={props.onSubmitPrompt}
            />
          ) : null;
        }
        if (group.type === "text") {
          return (
            <ThreadTextBlock
              key={group.part.id}
              text={recoverFinalTextForMessage(
                props.message,
                group.part.text,
                props.runtimeEvents,
                props.runs,
                props.precedingUserText,
              )}
              skills={props.skills}
              onTrySkill={props.onTrySkill}
              onEditSkill={props.onEditSkill}
              onPreviewImage={props.onPreviewImage}
              onSaveImageArtifact={props.onSaveImageArtifact}
            />
          );
        }
        if (group.type === "note") {
          if (isCompactionNoteTone(group.part.tone)) {
            return <CompactionDivider key={group.part.id} text={group.part.text} tone={group.part.tone} />;
          }
          return (
            <div key={group.part.id} className={clsx("thread-note-block", `tone-${group.part.tone || "muted"}`)}>
              {group.part.text}
            </div>
          );
        }
        return null;
      })}
      <AssistantTailThinking message={props.message} groups={groups} />
    </div>
  );
}

function isCompactionNoteTone(tone: string | undefined): boolean {
  return tone === "compaction-started" || tone === "compaction-finished";
}

function CompactionDivider(props: { text: string; tone?: string }) {
  return (
    <div className={clsx("thread-compaction-divider", props.tone === "compaction-started" && "is-active")}>
      <span>{props.text}</span>
    </div>
  );
}

function AssistantPendingBody(props: {
  message: StoredMessage;
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  precedingUserText?: string;
}) {
  return (
    <div className="thread-part-stack">
      <AssistantTurnStatus
        message={props.message}
        groups={[]}
        runtimeEvents={props.runtimeEvents}
        runs={props.runs}
        inputHint={props.precedingUserText}
      />
      <AssistantTailThinking message={props.message} groups={[]} />
    </div>
  );
}

function AssistantPlainBody(props: {
  message: StoredMessage;
  skills?: SkillRecord[];
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  precedingUserText?: string;
  onTrySkill?(skillName: string): void;
  onEditSkill?(skillName: string): void;
  onPreviewImage?(image: ChatImagePayload): void;
  onSaveImageArtifact?(image: ChatImagePayload): void;
}) {
  return (
    <div className="thread-part-stack">
      <AssistantTurnStatus
        message={props.message}
        groups={[]}
        runtimeEvents={props.runtimeEvents}
        runs={props.runs}
        inputHint={props.precedingUserText}
      />
      <ThreadTextBlock
        text={props.message.text}
        skills={props.skills}
        onTrySkill={props.onTrySkill}
        onEditSkill={props.onEditSkill}
        onPreviewImage={props.onPreviewImage}
        onSaveImageArtifact={props.onSaveImageArtifact}
      />
    </div>
  );
}

function AssistantTurnStatus(props: {
  message: StoredMessage;
  groups: AssistantPartGroup[];
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  inputHint?: string;
}) {
  const items = props.groups.flatMap((group) => (group.type === "activity" ? buildActivityItems(group.parts) : []));
  const hasPendingApproval = items.some(
    (item) => item.type === "approval" && item.part.approvalStatus === "pending" && item.part.approvalId,
  );
  const hasRunningItem = items.some((item) => activityItemStatus(item) === "running");
  const isActive = props.message.pending || hasRunningItem;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  const durationSeconds = messageDurationSeconds(props.message, props.runtimeEvents, props.runs, props.inputHint, nowMs);
  const shouldShow = hasPendingApproval || (Number.isFinite(durationSeconds) && durationSeconds >= TURN_STATUS_DELAY_SECONDS);
  if (!shouldShow) {
    return null;
  }
  const statusLabel = hasPendingApproval ? "等待确认" : isActive ? "正在处理" : "已处理";
  const duration = formatDurationSeconds(durationSeconds);

  return (
    <div className="thread-turn-status" data-active={isActive ? "true" : "false"}>
      <span className="thread-turn-status-label">
        {isActive ? <LoaderCircle size={14} className="spin" /> : null}
        {[statusLabel, duration].filter(Boolean).join(" ")}
      </span>
    </div>
  );
}

function AssistantTailThinking(props: {
  message: StoredMessage;
  groups: AssistantPartGroup[];
}) {
  const hasRecentTextOutput = useHasRecentAssistantTextOutput(props.message, props.groups);
  const items = props.groups.flatMap((group) => (group.type === "activity" ? buildActivityItems(group.parts) : []));
  const hasRunningItem = items.some((item) => activityItemStatus(item) === "running");
  const hasPendingApproval = items.some(
    (item) => item.type === "approval" && item.part.approvalStatus === "pending" && item.part.approvalId,
  );

  if (!props.message.pending || hasRunningItem || hasPendingApproval || hasRecentTextOutput) {
    return null;
  }

  return (
    <div className="thread-tail-thinking">
      <span className="thinking-shimmer">正在思考</span>
    </div>
  );
}

function useHasRecentAssistantTextOutput(message: StoredMessage, groups: AssistantPartGroup[]): boolean {
  const text = assistantTextSnapshot(message, groups);
  const [textState, setTextState] = useState(() => ({ text, changedAt: Date.now() }));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setTextState((current) => {
      if (current.text === text) {
        return current;
      }
      return { text, changedAt: Date.now() };
    });
  }, [text]);

  useEffect(() => {
    if (!message.pending) {
      return undefined;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 300);
    return () => window.clearInterval(timer);
  }, [message.pending]);

  const changedThisRender = text !== textState.text;
  const changedAt = changedThisRender ? nowMs : textState.changedAt;
  return Boolean(text) && (changedThisRender || nowMs - changedAt < THINKING_IDLE_DELAY_MS);
}

function assistantTextSnapshot(message: StoredMessage, groups: AssistantPartGroup[]): string {
  const textFromGroups = groups
    .filter((group): group is Extract<AssistantPartGroup, { type: "text" }> => group.type === "text")
    .map((group) => group.part.text || "")
    .join("");
  return textFromGroups || message.text || "";
}

type AssistantPartGroup =
  | { type: "text"; part: Extract<MessagePart, { type: "text" }> }
  | { type: "note"; part: Extract<MessagePart, { type: "note" }> }
  | { type: "activity"; key: string; parts: Array<ToolPart | SkillPart> };

function groupAssistantParts(parts: MessagePart[]): AssistantPartGroup[] {
  const groups: AssistantPartGroup[] = [];
  let activityParts: Array<ToolPart | SkillPart> = [];
  let activityGroupIndex = 0;

  const flushActivity = () => {
    if (!activityParts.length) {
      return;
    }
    groups.push({
      type: "activity",
      key: `activity-${activityGroupIndex++}-${activityParts[0]?.id || "group"}`,
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

function recoverFinalTextForMessage(
  message: StoredMessage,
  text: string,
  runtimeEvents: AgentEventRecord[] = [],
  runs: RunRecord[] = [],
  inputHint = "",
): string {
  const current = String(text || "");
  const runId = message.runId || runIdFromInput(inputHint, runs);
  if (!runId || !runtimeEvents.length) {
    return current;
  }
  const finalText = findRuntimeFinalText(runId, runtimeEvents);
  if (!shouldUseRuntimeFinalText(current, finalText)) {
    return current;
  }
  return finalText;
}

function findRuntimeFinalText(runId: string, runtimeEvents: AgentEventRecord[]): string {
  for (let index = runtimeEvents.length - 1; index >= 0; index -= 1) {
    const event = runtimeEvents[index];
    if (event?.runId !== runId || event?.type !== "model.response") {
      continue;
    }
    const text = event?.response?.text;
    if (typeof text === "string" && text.trim()) {
      return text;
    }
  }
  return "";
}

function shouldUseRuntimeFinalText(currentText: string, finalText: string): boolean {
  const current = currentText.trim();
  const final = finalText.trim();
  if (!current || !final || current === final) {
    return false;
  }
  return true;
}

function findActiveChoiceFormKey(messages: StoredMessage[]): string | undefined {
  const lastUserMessageIndex = messages.reduce(
    (latest, message, index) => (message.role === "user" ? index : latest),
    -1,
  );
  for (let index = messages.length - 1; index > lastUserMessageIndex; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const groups = groupAssistantParts((message.parts || []).filter(isRenderableMessagePart));
    for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
      const group = groups[groupIndex];
      if (group.type !== "activity") {
        continue;
      }
      if (buildActivityItems(group.parts).some((item) => Boolean(choiceFormFromItem(item)))) {
        return group.key;
      }
    }
  }
  return undefined;
}

function messageRoleMeta(role: StoredMessage["role"], pending: boolean) {
  if (role === "user") {
    return {
      title: "You",
      subtitle: "Prompt",
      icon: <UserRound size={14} />,
    };
  }
  if (role === "system") {
    return {
      title: "System",
      subtitle: pending ? "Updating" : "State change",
      icon: <ShieldAlert size={14} />,
    };
  }
  return {
    title: "Agent",
    subtitle: pending ? "Streaming response" : "Response",
    icon: <Bot size={14} />,
  };
}
