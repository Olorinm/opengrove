import type { ReasoningEffort, ResponseSpeed, StoredMessage } from "../bridge";
import { clamp } from "../format";
import { APP_STORAGE_KEYS } from "../identity";
import type { UiThread } from "../store";

export const MIN_SIDEBAR_WIDTH = 244;
export const MAX_SIDEBAR_WIDTH = 520;
export const MIN_LIBRARY_AI_PANEL_WIDTH = 300;
export const MAX_LIBRARY_AI_PANEL_WIDTH = 680;
export const LIBRARY_AI_RAIL_BOTTOM_STORAGE_KEY = "opengrove.library.aiRailBottom.v1";
export const MIN_LIBRARY_AI_RAIL_BOTTOM = 18;

const DEFAULT_SIDEBAR_WIDTH = 284;
const DEFAULT_LIBRARY_AI_PANEL_WIDTH = 420;
const DEFAULT_LIBRARY_AI_RAIL_BOTTOM = 72;

export function readStoredSidebarWidth(): number {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.sidebarWidth);
  const value = raw ? Number(raw) : DEFAULT_SIDEBAR_WIDTH;
  return clamp(Number.isFinite(value) ? value : DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

export function readStoredSidebarCollapsed(): boolean {
  return false;
}

export function readStoredRailExpanded(): boolean {
  return window.localStorage.getItem(APP_STORAGE_KEYS.railExpanded) === "true";
}

export function readStoredLibraryAiPanelWidth(): number {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.libraryAiPanelWidth);
  const value = raw ? Number(raw) : DEFAULT_LIBRARY_AI_PANEL_WIDTH;
  return clamp(
    Number.isFinite(value) ? value : DEFAULT_LIBRARY_AI_PANEL_WIDTH,
    MIN_LIBRARY_AI_PANEL_WIDTH,
    MAX_LIBRARY_AI_PANEL_WIDTH,
  );
}

export function readStoredLibraryAiRailBottom(): number {
  const raw = window.localStorage.getItem(LIBRARY_AI_RAIL_BOTTOM_STORAGE_KEY);
  const value = raw ? Number(raw) : DEFAULT_LIBRARY_AI_RAIL_BOTTOM;
  return clamp(
    Number.isFinite(value) ? value : DEFAULT_LIBRARY_AI_RAIL_BOTTOM,
    MIN_LIBRARY_AI_RAIL_BOTTOM,
    720,
  );
}

export function readStoredLibraryLastKnowledgeId(): string {
  return window.localStorage.getItem(APP_STORAGE_KEYS.libraryLastKnowledgeId) || "";
}

export function modelBindingKey(kernel: string | undefined, source: string | undefined): string {
  return `${kernel || "unknown"}:${source || "native"}`;
}

export function readStoredModelBindings(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(APP_STORAGE_KEYS.uiModelByBinding) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

export function writeStoredModelBinding(key: string, modelId: string): void {
  const current = readStoredModelBindings();
  current[key] = modelId;
  window.localStorage.setItem(APP_STORAGE_KEYS.uiModelByBinding, JSON.stringify(current));
}

export function runRecordId(run: { id?: string; runId?: string } | undefined): string {
  return String(run?.id || run?.runId || "");
}

export function isActiveRunRecord(run: { status?: string } | undefined): boolean {
  return run?.status === "running" || run?.status === "waiting_for_approval";
}

export function isFreshRunRecord(run: { startedAt?: string; updatedAt?: string; createdAt?: string } | undefined, maxAgeMs = 60_000): boolean {
  const timestamp = run?.startedAt || run?.updatedAt || run?.createdAt || "";
  const time = timestamp ? new Date(timestamp).getTime() : 0;
  return Number.isFinite(time) && time > 0 && Date.now() - time <= maxAgeMs;
}

export function messagesForUiThread(
  threads: UiThread[],
  activeThreadId: string,
  activeMessages: StoredMessage[],
  targetThreadId: string,
): StoredMessage[] {
  return targetThreadId === activeThreadId
    ? activeMessages
    : threads.find((thread) => thread.id === targetThreadId)?.messages ?? [];
}

export function findAttachableAssistantMessageId(
  messages: StoredMessage[],
  runId: string,
  runInput = "",
): string {
  const normalizedRunInput = normalizeRunInput(runInput);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.pending) {
      continue;
    }
    if (message.runId === runId) {
      return message.id;
    }
    if (!message.runId && normalizedRunInput && previousUserInputForAssistant(messages, index) === normalizedRunInput) {
      return message.id;
    }
  }
  return "";
}

export function latestPendingAssistantMessage(messages: StoredMessage[]): StoredMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.pending) {
      return message;
    }
  }
  return undefined;
}

export function previousUserInputForAssistant(messages: StoredMessage[], assistantIndex: number): string {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return normalizeRunInput(message.text);
    }
  }
  return "";
}

export function normalizeRunInput(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function isRecoverableStreamDisconnect(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || /network error|failed to fetch|load failed|cancelled|canceled|aborted|stream_finished_without_final_payload/i.test(message);
}

export function readStoredReasoningEffort(): ReasoningEffort {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.reasoningEffort);
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") {
    return raw;
  }
  return "high";
}

export function readStoredResponseSpeed(): ResponseSpeed {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.responseSpeed);
  return raw === "fast" ? "fast" : "standard";
}
