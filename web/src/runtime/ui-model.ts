import { File as FileIcon, FileText, Image as ImageIcon } from "lucide-react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ApprovalPolicy,
  ArtifactRecord,
  AskFinalPayload,
  AttachmentPayload,
  ComputerStateRecord,
  ContextArtifactPayload,
  ExecutionRecord,
  InventoryResponse,
  RunRecord,
  SandboxPolicy,
  SessionRecord,
  SkillRecord,
  StoredMessage,
  WorkingStateRecord,
} from "../bridge";
import { APP_STORAGE_KEYS } from "../identity";
import { hasRenderableComputerState, normalizeComputerState, sortedArtifacts, sortedExecutions, sortedRuns, summarize, uniqueIds } from "../format";
import { artifactImagePreview, artifactKind, artifactTitle } from "../components/knowledge/knowledge-model";

export const MIN_COMPOSER_HEIGHT = 56;
export const MAX_COMPOSER_HEIGHT = 88;
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_CHARS = 80_000;
export const MAX_COMPOSER_ATTACHMENTS = 8;
export const MAX_COMPOSER_CONTEXT_ARTIFACTS = 6;

export function parseSlashSkillQuery(value: string): { active: boolean; keyword: string } {
  const input = String(value || "").trimStart();
  if (!input.startsWith("/")) {
    return { active: false, keyword: "" };
  }
  const afterSlash = input.slice(1);
  if (!afterSlash) {
    return { active: true, keyword: "" };
  }
  const spaceIndex = afterSlash.search(/\s/);
  if (spaceIndex >= 0) {
    return { active: false, keyword: afterSlash.slice(0, spaceIndex).toLowerCase() };
  }
  return { active: true, keyword: afterSlash.toLowerCase() };
}

export interface ComposerSkillInvocation {
  name: string;
  skill: SkillRecord;
  args: string;
}

export function parseComposerSkillInvocation(value: string, skills: SkillRecord[]): ComposerSkillInvocation | null {
  const match = String(value || "").match(/^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s([\s\S]*))?$/);
  if (!match) {
    return null;
  }
  const name = match[1];
  const skill = (Array.isArray(skills) ? skills : []).find((candidate) => {
    const candidateName = skillInvocationName(candidate);
    const candidateId = String(candidate?.id || "").replace(/^skill\./, "");
    return candidateName === name || candidateId === name;
  });
  if (!skill) {
    return null;
  }
  return {
    name: skillInvocationName(skill),
    skill,
    args: match[2] ?? "",
  };
}

export function composeSkillPrompt(name: string, args: string): string {
  return args ? `/${name} ${args}` : `/${name} `;
}

export function skillInvocationName(skill: SkillRecord): string {
  return String(skill?.name || skill?.id || "skill").replace(/^skill\./, "");
}

export function formatComposerSkillTitle(skill: SkillRecord): string {
  const raw = String(skill?.title || skill?.displayName || skill?.name || skill?.id || "Skill").trim();
  if (raw === "bottle-reference-brief") {
    return "瓶装产品视觉简报";
  }
  if (/[\u4e00-\u9fff]/.test(raw)) {
    return raw;
  }
  return raw
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "api" || lower === "ui" || lower === "vfs" || lower === "pm") {
        return lower.toUpperCase();
      }
      return part.toUpperCase() === part ? part : part.slice(0, 1).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export function getMatchingSkills(skills: SkillRecord[], keyword: string): SkillRecord[] {
  return (Array.isArray(skills) ? skills : [])
    .filter((skill) => skill && skill.userInvocable !== false)
    .map((skill) => ({ skill, score: scoreSkillMatch(skill, keyword) }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return String(left.skill.title || left.skill.name || left.skill.id || "").localeCompare(String(right.skill.title || right.skill.name || right.skill.id || ""));
    })
    .map((entry) => entry.skill);
}

export function pickCodexSkills(skills: SkillRecord[]): SkillRecord[] {
  const allSkills = Array.isArray(skills) ? skills : [];
  const codexSkills = allSkills.filter(isCodexSkill);
  return codexSkills.length ? codexSkills : allSkills;
}

export function isCodexSkill(skill: SkillRecord): boolean {
  const entry = String(skill.entry || skill.skillRoot || "");
  const packId = String(skill.packId || "");
  return /(^|[\\/])\.codex[\\/]/.test(entry) || packId.startsWith("codex.");
}

export function scoreSkillMatch(skill: SkillRecord, keyword: string): number {
  if (!keyword) {
    return 0;
  }
  const name = String(skill.name || skill.id || "").toLowerCase();
  const title = String(skill.title || "").toLowerCase();
  const description = String(skill.description || "").toLowerCase();
  const whenToUse = String(skill.whenToUse || "").toLowerCase();
  if (name === keyword) return 0;
  if (name.startsWith(keyword)) return 1;
  if (title.startsWith(keyword)) return 2;
  if (name.includes(keyword)) return 3;
  if (title.includes(keyword)) return 4;
  if (whenToUse.includes(keyword)) return 5;
  if (description.includes(keyword)) return 6;
  return Number.POSITIVE_INFINITY;
}

export function cloneMessage(message: StoredMessage): StoredMessage {
  return {
    ...message,
    context: message.context ? { ...message.context } : null,
    parts: [...message.parts],
  };
}

export function mergeFinalDataIntoCache(queryClient: QueryClient, finalData: AskFinalPayload): void {
  queryClient.setQueryData(["inventory"], (previous: InventoryResponse | undefined) =>
    previous
      ? {
          ...previous,
          knowledge: finalData.knowledge ?? previous.knowledge,
          knowledgeFolders: finalData.knowledgeFolders ?? previous.knowledgeFolders,
          knowledgeLedgers: finalData.knowledgeLedgers ?? previous.knowledgeLedgers,
          memory: finalData.memory ?? previous.memory,
          artifacts: finalData.artifacts ?? previous.artifacts,
          workingState: finalData.workingState ?? previous.workingState,
          computerState: finalData.computerState ?? previous.computerState,
          sessions: finalData.sessions ?? previous.sessions,
          runs: finalData.runs ?? previous.runs,
          executions: finalData.executions ?? previous.executions,
        }
      : previous,
  );
  if (finalData.approvals) {
    queryClient.setQueryData(["approvals"], { ok: true, approvals: finalData.approvals });
  }
  if (finalData.contextRecords) {
    queryClient.setQueryData(["context-records"], { ok: true, records: finalData.contextRecords });
  }
  if (finalData.events) {
    queryClient.setQueryData(["events"], { ok: true, events: finalData.events });
  }
}

export async function readComposerAttachment(file: File): Promise<AttachmentPayload> {
  const base = {
    id: createAttachmentId(),
    name: file.name || "untitled",
    mimeType: file.type || guessMimeType(file.name),
    size: file.size,
  };

  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      return {
        ...base,
        kind: "file",
        error: `图片超过 ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}，暂未读取内容。`,
      };
    }
    return {
      ...base,
      kind: "image",
      dataUrl: await readFileAsDataUrl(file),
    };
  }

  if (isTextLikeFile(file)) {
    if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
      return {
        ...base,
        kind: "file",
        error: `文本超过 ${formatBytes(MAX_TEXT_ATTACHMENT_BYTES)}，暂未读取内容。`,
      };
    }
    const text = await readFileAsText(file);
    return {
      ...base,
      kind: "text",
      text: text.slice(0, MAX_TEXT_ATTACHMENT_CHARS),
    };
  }

  return {
    ...base,
    kind: "file",
    dataUrl: file.size <= MAX_FILE_ATTACHMENT_BYTES ? await readFileAsDataUrl(file) : undefined,
    error: file.size > MAX_FILE_ATTACHMENT_BYTES
      ? `文件超过 ${formatBytes(MAX_FILE_ATTACHMENT_BYTES)}，暂未读取内容。`
      : undefined,
  };
}

export function artifactToComposerContext(artifact: ArtifactRecord): ContextArtifactPayload {
  const title = artifactTitle(artifact);
  return {
    id: String(artifact?.id || title),
    title,
    type: String(artifact?.type || artifactKind(artifact) || "artifact"),
    summary: summarizeArtifactForContext(artifact),
    imageUri: artifactImagePreview(artifact) || undefined,
  };
}

export function summarizeArtifactForContext(artifact: ArtifactRecord): string {
  return [
    artifact?.preview?.text,
    artifact?.data?.text,
    artifact?.data?.summary,
    artifact?.data?.description,
    artifact?.data?.markdown,
    artifact?.data?.uri,
    artifact?.data?.imageUri,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map(String)
    .map((value) => summarize(value, 500))[0] || "";
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.readAsText(file);
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

export function isTextLikeFile(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    mimeType.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/x-yaml",
      "application/toml",
      "image/svg+xml",
    ].includes(mimeType) ||
    /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html|css|js|jsx|ts|tsx|py|rb|go|rs|java|c|cc|cpp|h|hpp|swift|kt|sh|zsh|bash|yaml|yml|toml|ini|sql|log)$/i.test(name)
  );
}

export function guessMimeType(fileName: string): string {
  if (/\.svg$/i.test(fileName)) return "image/svg+xml";
  if (/\.png$/i.test(fileName)) return "image/png";
  if (/\.jpe?g$/i.test(fileName)) return "image/jpeg";
  if (/\.webp$/i.test(fileName)) return "image/webp";
  if (/\.jsonl?$/i.test(fileName)) return "application/json";
  if (/\.ya?ml$/i.test(fileName)) return "application/x-yaml";
  if (/\.toml$/i.test(fileName)) return "application/toml";
  if (/\.csv$/i.test(fileName)) return "text/csv";
  if (/\.tsx?$/i.test(fileName)) return "text/typescript";
  if (/\.jsx?$/i.test(fileName)) return "text/javascript";
  if (/\.(md|markdown)$/i.test(fileName)) return "text/markdown";
  return "application/octet-stream";
}

export function fileNameFromAssetUri(uri: string): string {
  try {
    const url = new URL(uri, window.location.origin);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    return "";
  }
}

export function mimeTypeFromAssetUri(uri: string): string {
  const value = String(uri || "");
  if (value.startsWith("data:image/")) {
    const mimeType = value.slice(5, value.indexOf(";") > 0 ? value.indexOf(";") : undefined);
    return mimeType || "image/*";
  }
  return guessMimeType(fileNameFromAssetUri(value));
}

export function createAttachmentId(): string {
  return `attachment_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

export function attachmentIcon(attachment: AttachmentPayload) {
  if (attachment.kind === "image") return ImageIcon;
  if (attachment.kind === "text") return FileText;
  return FileIcon;
}

export function formatAttachmentMeta(attachment: AttachmentPayload): string {
  if (attachment.error) {
    return ` · ${attachment.error}`;
  }
  if (attachment.kind === "image") {
    return ` · 图片 · ${formatBytes(attachment.size)}`;
  }
  if (attachment.kind === "text") {
    return ` · 文本 · ${formatBytes(attachment.size)}`;
  }
  return ` · 文件 · ${formatBytes(attachment.size)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function computeRuntimeCount(session: SessionRecord | undefined, runs: RunRecord[], executions: ExecutionRecord[], sessionId: string): number {
  const sessionRuns = sortedRuns(runs.filter((item) => !sessionId || item?.sessionId === sessionId)).slice(0, 3);
  const executionItems = sortedExecutions(executions.filter((item) => !sessionId || item?.sessionId === sessionId)).slice(0, 5);
  return (session ? 1 : 0) + sessionRuns.length + executionItems.length;
}

export function resolveDisplayedComputerState(liveComputerState: ComputerStateRecord, artifacts: ArtifactRecord[]) {
  if (hasRenderableComputerState(liveComputerState)) {
    return liveComputerState;
  }
  const fallback = sortedArtifacts(artifacts).find((artifact) => artifact.type === "computer_snapshot" && artifact.data);
  return fallback ? normalizeComputerState(fallback.data) : liveComputerState;
}

export function collectMessageRunIds(messages: StoredMessage[]): string[] {
  return uniqueIds(
    messages
      .map((message) => message.runId)
      .filter((runId): runId is string => typeof runId === "string" && runId.length > 0),
  );
}

export function resolveCurrentSession(
  sessions: SessionRecord[],
  workingState: WorkingStateRecord,
  threadId: string,
  latestRun: RunRecord | undefined,
  hasThreadActivity: boolean,
): SessionRecord | undefined {
  if (!hasThreadActivity) {
    return undefined;
  }
  if (latestRun?.sessionId) {
    return sessions.find((item) => item?.id === latestRun.sessionId);
  }
  if (workingState.sessionId && workingState.sessionId === threadId) {
    return sessions.find((item) => item?.id === workingState.sessionId);
  }
  return undefined;
}

export function resolveLatestRun(runs: RunRecord[], sessionId: string, runIds: string[], hasThreadActivity: boolean): RunRecord | undefined {
  if (!hasThreadActivity) {
    return undefined;
  }
  if (runIds.length) {
    const runIdSet = new Set(runIds);
    return sortedRuns(runs).find((item) => runIdSet.has(item?.id) || runIdSet.has(item?.runId));
  }
  return sortedRuns(runs).find((item) => sessionId && item?.sessionId === sessionId);
}

export function resolveLatestRuntimeBlocker(executions: ExecutionRecord[], sessionId: string): ExecutionRecord | undefined {
  return sortedExecutions(executions).find((item) => {
    if (sessionId && item?.sessionId !== sessionId) {
      return false;
    }
    return Boolean(item?.data?.needsReobserve || item?.status === "environment_blocked" || item?.eventType === "error");
  });
}

export function buildApprovalResolutionMessage(result: Record<string, unknown>, action: string): string {
  if (action !== "approve") {
    return "已拒绝动作。";
  }
  if (result?.alreadyResolved) {
    return "这个动作已经处理过了，没有重复执行。";
  }
  const toolResult = result.toolResult && typeof result.toolResult === "object" ? result.toolResult as Record<string, unknown> : {};
  const toolValue = toolResult.value && typeof toolResult.value === "object" ? toolResult.value as Record<string, unknown> : {};
  if (toolValue?.needsReobserve) {
    return "已确认动作，但界面快照已变化，系统已拦下执行；请先重新观察，再决定下一步。";
  }
  if (toolValue?.status === "staged") {
    return "已确认动作，当前阶段已记录为 staged；下一步应先重新观察。";
  }
  return "已确认动作。";
}

export function formatKernelLabel(value: string | undefined): string {
  if (value === "claude-code") {
    return "Claude Code kernel";
  }
  if (value === "codex") {
    return "Codex kernel";
  }
  if (value === "pi") {
    return "Pi kernel";
  }
  if (value === "scripted") {
    return "Scripted demo kernel";
  }
  return "";
}

export function readStoredSandboxPolicy(): SandboxPolicy {
  const value = typeof window === "undefined" ? "" : window.localStorage.getItem(APP_STORAGE_KEYS.sandbox);
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
    ? value
    : "workspace-write";
}

export function readStoredApprovalPolicy(): ApprovalPolicy {
  const value = typeof window === "undefined" ? "" : window.localStorage.getItem(APP_STORAGE_KEYS.approvalPolicy);
  return value === "never" || value === "on-request" || value === "on-failure" || value === "untrusted"
    ? value
    : "on-request";
}
