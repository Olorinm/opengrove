import type { MessagePart, SkillPart, StoredMessage, ToolPart } from "./bridge";
import { createClientId } from "./bridge";
import { toolStatusFromResult } from "./format";

export function hasRenderableMessageParts(message: StoredMessage): boolean {
  return Array.isArray(message.parts) && message.parts.some((part) => isRenderableMessagePart(part));
}

export function isRenderableMessagePart(part: MessagePart | null | undefined): part is MessagePart {
  if (!part || isQuietToolPart(part)) {
    return false;
  }
  if (part.type === "text" || part.type === "note") {
    return Boolean(part.text);
  }
  return true;
}

export function isQuietToolPart(part: MessagePart): boolean {
  return part.type === "tool" && part.toolId === "codex.reasoning";
}

export function collectMessageText(message: StoredMessage): string {
  const textFromParts = (message.parts || [])
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part?.type === "text")
    .map((part) => part.text)
    .join("");
  return textFromParts || message.text || "";
}

export function appendTextPart(message: StoredMessage, text: string): void {
  if (!text) {
    return;
  }
  const lastPart = message.parts[message.parts.length - 1];
  if (lastPart?.type === "text") {
    lastPart.text = `${lastPart.text || ""}${text}`;
    return;
  }
  message.parts.push({
    id: createClientId("part"),
    type: "text",
    text,
  });
}

export function appendNotePart(message: StoredMessage, text: string, tone = "muted"): void {
  if (!text) {
    return;
  }
  message.parts.push({
    id: createClientId("part"),
    type: "note",
    text,
    tone,
  });
}

function findLatestPart<T extends MessagePart>(
  message: StoredMessage,
  predicate: (part: MessagePart) => part is T,
): T | null {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (predicate(part)) {
      return part;
    }
  }
  return null;
}

export function appendSkillEventPart(message: StoredMessage, event: any, status: string): void {
  const existing = findLatestPart<SkillPart>(
    message,
    (part): part is SkillPart => part.type === "skill" && part.skillId === event.skillId,
  );
  const next =
    existing ||
    ({
      id: createClientId("part"),
      type: "skill",
      skillId: event.skillId || event.skill?.id || "",
      skillName: event.skill?.name || "",
      title: event.skill?.title || event.skillId || "",
      status: "invoked",
      contentPreview: "",
      allowedTools: [],
      model: "",
      effort: "",
      forkSessionId: "",
      result: "",
      description: "",
      whenToUse: "",
      source: "",
      trust: "",
      context: "",
      packId: "",
    } satisfies SkillPart);

  next.skillId = event.skillId || event.skill?.id || next.skillId;
  next.skillName = event.skill?.name || next.skillName;
  next.title = event.skill?.title || next.title || event.skillId || "";
  next.status = status || next.status;
  next.contentPreview = event.contentPreview || next.contentPreview || event.invocation?.contentPreview || "";
  next.allowedTools = Array.isArray(event.allowedTools)
    ? event.allowedTools.slice()
    : Array.isArray(event.invocation?.allowedTools)
      ? event.invocation.allowedTools.slice()
      : next.allowedTools || [];
  next.model = event.model || event.invocation?.model || next.model || "";
  next.effort = event.effort || event.invocation?.effort || next.effort || "";
  next.forkSessionId = event.forkSessionId || next.forkSessionId || "";
  next.result = event.result || next.result || "";
  next.description = event.skill?.description || next.description || "";
  next.whenToUse = event.skill?.whenToUse || next.whenToUse || "";
  next.source = event.skill?.source || next.source || "";
  next.trust = event.skill?.trust || next.trust || "";
  next.context = event.context || event.skill?.context || next.context || "";
  next.packId = event.skill?.packId || next.packId || "";

  if (!existing) {
    message.parts.push(next);
  }
}

export function appendToolEventPart(
  message: StoredMessage,
  part: Partial<ToolPart> & Pick<ToolPart, "phase" | "toolId" | "title" | "status">,
): void {
  message.parts.push({
    id: createClientId("part"),
    type: "tool",
    phase: part.phase || "result",
    toolId: part.toolId || "tool",
    title: part.title || part.toolId || "Tool",
    input: part.input,
    status: part.status || "running",
    result: part.result,
    error: part.error || "",
    approvalId: part.approvalId || "",
    approvalStatus: part.approvalStatus || "",
    approvalReason: part.approvalReason || "",
    approvalInput: part.approvalInput,
  });
}

export function markAssistantMessageError(message: StoredMessage, errorMessage: string): StoredMessage {
  message.pending = false;
  appendNotePart(message, `模型调用出错：${errorMessage}`, "error");
  if (!hasRenderableMessageParts(message)) {
    message.text = `模型调用出错：${errorMessage}`;
  }
  return message;
}

export function finalizeAssistantMessage(message: StoredMessage, data: { answer?: string; events?: any[] }): StoredMessage {
  message.pending = false;
  const timing = messageTimingFromEvents(data?.events);
  message.startedAt = message.startedAt || timing.startedAt;
  message.finishedAt = message.finishedAt || timing.finishedAt;
  const finalResponseText = finalModelResponseTextFromEvents(data?.events);
  const answer = finalResponseText || (typeof data?.answer === "string" ? data.answer : "");
  if (hasRenderableMessageParts(message) && shouldReplaceStreamedText(collectMessageText(message), answer, Boolean(finalResponseText))) {
    replaceTextPartsWithFinalAnswer(message, answer);
  } else if (!hasRenderableMessageParts(message) && answer) {
    appendTextPart(message, answer);
  }
  if (!hasRenderableMessageParts(message) && !String(message.text || "").trim()) {
    appendNotePart(message, renderEventError(data?.events) || "没有返回文本。", "muted");
  }
  message.text = collectMessageText(message);
  return message;
}

function shouldReplaceStreamedText(existingText: string, finalText: string, authoritativeFinal = false): boolean {
  const existing = String(existingText || "").trim();
  const final = String(finalText || "").trim();
  if (!existing || !final || existing === final) {
    return false;
  }
  if (authoritativeFinal) {
    return true;
  }
  if (final.length < existing.length) {
    return false;
  }
  if (final.startsWith(existing)) {
    return true;
  }
  return countRenderableImageMarkdown(final) > countRenderableImageMarkdown(existing);
}

function finalModelResponseTextFromEvents(events: any[] | undefined): string {
  if (!Array.isArray(events)) {
    return "";
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const text = event?.type === "model.response" ? event?.response?.text : "";
    if (typeof text === "string" && text.trim()) {
      return text;
    }
  }
  return "";
}

function replaceTextPartsWithFinalAnswer(message: StoredMessage, answer: string): void {
  message.parts = (message.parts || []).filter((part) => part.type !== "text");
  appendTextPart(message, answer);
}

function countRenderableImageMarkdown(text: string): number {
  return [
    ...String(text || "").matchAll(
      /!\[[^\]]*]\((?:\/generated\/|data:image\/|https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/)[^)]+\)/g,
    ),
  ].length;
}

export function renderEventError(events: any[] | undefined): string {
  if (!Array.isArray(events)) {
    return "";
  }
  const error = events.find((event) => event?.type === "error" && event.message);
  return error ? `模型调用出错：${error.message}` : "";
}

export function applyStreamEventToMessage(message: StoredMessage, event: any): { approvalRequest?: any } {
  message.pending = true;
  message.parts = Array.isArray(message.parts) ? message.parts : [];
  if (event?.runId) {
    message.runId = event.runId;
  }

  switch (event?.type) {
    case "turn.started":
      message.startedAt = event.at || message.startedAt || new Date().toISOString();
      break;
    case "assistant.delta":
      appendTextPart(message, event.text || "");
      break;
    case "skill.invoked":
      appendSkillEventPart(message, event, "invoked");
      break;
    case "skill.loaded":
      appendSkillEventPart(message, event, "loaded");
      break;
    case "skill.forked":
      appendSkillEventPart(message, event, event.status || "finished");
      break;
    case "skill.cleared":
      appendNotePart(message, event.reason || "当前 skill turn 已结束。", "muted");
      break;
    case "compaction.started":
      appendNotePart(message, "正在自动压缩上下文", "compaction-started");
      break;
    case "compaction.finished":
      appendNotePart(message, "上下文已自动压缩", "compaction-finished");
      break;
    case "tool.started":
      if (isQuietToolEvent(event.toolId)) {
        break;
      }
      appendToolEventPart(message, {
        phase: "call",
        toolId: event.toolId,
        title: event.toolId || "Tool call",
        input: event.input,
        status: "running",
      });
      break;
    case "tool.finished":
      if (isQuietToolEvent(event.toolId)) {
        break;
      }
      appendToolEventPart(message, {
        phase: "result",
        toolId: event.toolId,
        title: event.toolId || "Tool result",
        result: event.result?.value,
        error: event.result?.error || "",
        status: toolStatusFromResult(event.result),
      });
      break;
    case "approval.requested": {
      const request = event.request || {};
      appendToolEventPart(message, {
        phase: "approval",
        toolId: request.toolId || request.kind || request.title || "approval",
        title: request.title || request.toolId || "Approval",
        input: request.input,
        status: "requires-action",
        approvalId: request.id || "",
        approvalStatus: request.status || "pending",
        approvalReason: request.reason || "",
        approvalInput: request.input,
      });
      message.text = collectMessageText(message);
      return { approvalRequest: request };
    }
    case "approval.resolved":
      updateApprovalMessagePart(message, event.request, { fromStream: true });
      break;
    case "error":
      appendNotePart(message, event.message || "模型调用出错。", "error");
      message.pending = false;
      message.finishedAt = message.finishedAt || new Date().toISOString();
      break;
    case "turn.finished":
      message.pending = false;
      message.finishedAt = event.at || message.finishedAt || new Date().toISOString();
      break;
    default:
      break;
  }

  message.text = collectMessageText(message);
  return {};
}

function messageTimingFromEvents(events: any[] | undefined): { startedAt?: string; finishedAt?: string } {
  if (!Array.isArray(events)) {
    return {};
  }
  const started = events.find((event) => event?.type === "turn.started" && event.at);
  const finished = [...events].reverse().find((event) => event?.type === "turn.finished" && event.at);
  return {
    startedAt: typeof started?.at === "string" ? started.at : undefined,
    finishedAt: typeof finished?.at === "string" ? finished.at : undefined,
  };
}

function isQuietToolEvent(toolId: unknown): boolean {
  return toolId === "codex.reasoning";
}

export function updateApprovalMessagePart(message: StoredMessage, request: any, options: { fromStream?: boolean } = {}): boolean {
  if (!request?.id) {
    return false;
  }
  for (const part of message.parts || []) {
    if (part?.type !== "tool" || part.phase !== "approval" || part.approvalId !== request.id) {
      continue;
    }
    part.approvalStatus = request.status || part.approvalStatus || "";
    if (request.reason) {
      part.approvalReason = request.reason;
    }
    if (request.status === "approved" && part.status === "requires-action") {
      part.status = options.fromStream ? "approved" : part.status;
    }
    if (request.status === "rejected") {
      part.status = "rejected";
    }
    message.pending = false;
    return true;
  }
  return false;
}

export function applyApprovalResultToMessages(messages: StoredMessage[], approvalId: string, result: any, action: string): boolean {
  const request = result?.approval;
  if (!request?.id) {
    return false;
  }

  let updated = false;
  for (const message of messages) {
    updated = updateApprovalMessagePart(message, request) || updated;
    for (const part of message.parts || []) {
      if (part?.type !== "tool" || part.phase !== "approval" || part.approvalId !== approvalId) {
        continue;
      }
      updated = true;
      if (action === "approve" && request.status === "approved") {
        part.status = "approved";
      }
      if (action !== "approve") {
        part.status = "rejected";
      }

      const toolValue = result?.toolResult?.value;
      if (toolValue !== undefined || result?.toolResult?.error) {
        appendToolEventPart(message, {
          phase: "result",
          toolId: part.toolId,
          title: part.title,
          result: toolValue,
          error: result?.toolResult?.error || "",
          status: toolStatusFromResult(result.toolResult),
        });
      }

      if (result?.alreadyResolved) {
        appendNotePart(message, "这个动作已经处理过了，没有重复执行。", "muted");
      } else if (toolValue?.needsReobserve) {
        appendNotePart(message, "界面快照已变化；先重新观察，再决定下一步。", "warn");
      } else if (toolValue?.status === "staged") {
        appendNotePart(message, "动作已记录为 staged；下一步应先重新观察。", "muted");
      } else if (action === "approve") {
        appendNotePart(message, "动作已确认。", "success");
      } else {
        appendNotePart(message, "动作已拒绝。", "muted");
      }
      message.pending = false;
      message.text = collectMessageText(message);
    }
  }

  return updated;
}
