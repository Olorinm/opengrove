import { File as FileIcon, FileText, Image as ImageIcon } from "lucide-react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AskFinalPayload,
  AttachmentPayload,
  ExecutionRecord,
  InventoryResponse,
  RuntimeAccessMode,
  RunRecord,
  SessionRecord,
  SkillRecord,
  StoredMessage,
  WorkingStateRecord,
} from "../bridge";
import { APP_STORAGE_KEYS } from "../identity";
import { sortedExecutions, sortedRuns, uniqueIds } from "../format";

export const MIN_COMPOSER_HEIGHT = 56;
export const MAX_COMPOSER_HEIGHT = 88;
export const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
export const MAX_TEXT_ATTACHMENT_CHARS = 80_000;
export const MAX_COMPOSER_ATTACHMENTS = 8;

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

export interface KernelSlashCommand {
  id: string;
  name: string;
  title: string;
  description: string;
  source: "kernel-native";
  kernelId?: string;
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

export function getKernelSlashCommands(kernelId?: string, workingState?: WorkingStateRecord): KernelSlashCommand[] {
  const normalizedKernel = String(kernelId || "").trim() || "kernel";
  const common = [
    command(normalizedKernel, "help", "帮助", "显示当前内核可用的命令和用法。"),
    command(normalizedKernel, "status", "状态", "显示会话、上下文、额度或运行状态。"),
  ];

  if (normalizedKernel === "codex") {
    return [
      command(normalizedKernel, "model", "模型", "切换或查看当前模型。"),
      command(normalizedKernel, "branch", "派生", "为此对话创建分支至本地或全新工作树。"),
      command(normalizedKernel, "status", "状态", "显示对话 ID、上下文使用情况及额度限制。"),
      command(normalizedKernel, "plan", "计划模式", "开启计划模式。"),
      command(normalizedKernel, "memory", "记忆", "生成或查看当前对话记忆。"),
      command(normalizedKernel, "compact", "压缩", "压缩当前上下文。"),
      command(normalizedKernel, "help", "帮助", "显示 Codex 命令。"),
    ];
  }

  if (normalizedKernel === "claude-code") {
    const discovered = readClaudeSlashCommands(workingState);
    const fallback = [
      command(normalizedKernel, "compact", "压缩", "压缩当前 Claude Code 上下文。"),
      command(normalizedKernel, "clear", "清空", "开始一个新的 Claude Code 对话上下文。"),
      command(normalizedKernel, "context", "上下文", "查看当前上下文使用情况。"),
      command(normalizedKernel, "cost", "费用", "查看当前会话费用。"),
    ];
    return discovered.length ? mergeDiscoveredSlashCommands(normalizedKernel, discovered, fallback) : fallback;
  }

  return [
    command(normalizedKernel, "model", "模型", "切换或查看当前模型。"),
    ...common,
    command(normalizedKernel, "compact", "压缩", "压缩当前上下文。"),
    command(normalizedKernel, "clear", "清空", "清空当前会话上下文。"),
  ];
}

function readClaudeSlashCommands(workingState?: WorkingStateRecord): string[] {
  const value = workingState?.toolSchemaCache?.["claude.slashCommands"];
  const parsed = typeof value === "string" ? parseJsonArray(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string" && item.trim().startsWith("/"))
    : [];
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeDiscoveredSlashCommands(
  kernelId: string,
  discovered: string[],
  fallback: KernelSlashCommand[],
): KernelSlashCommand[] {
  const fallbackByName = new Map(fallback.map((item) => [item.name, item]));
  const seen = new Set<string>();
  const output: KernelSlashCommand[] = [];
  for (const raw of discovered) {
    const name = raw.trim().replace(/^\/+/, "");
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    output.push(fallbackByName.get(name) ?? command(kernelId, name, name, "Claude Code 原生命令。"));
  }
  return output;
}

export function getMatchingSlashCommands(commands: KernelSlashCommand[], keyword: string): KernelSlashCommand[] {
  return (Array.isArray(commands) ? commands : [])
    .map((item, index) => ({ item, index, score: scoreSlashCommandMatch(item, keyword) }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.item);
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

function command(kernelId: string, name: string, title: string, description: string): KernelSlashCommand {
  return {
    id: `${kernelId}.${name}`,
    name,
    title,
    description,
    source: "kernel-native",
    kernelId,
  };
}

function scoreSlashCommandMatch(command: KernelSlashCommand, keyword: string): number {
  if (!keyword) {
    return 0;
  }
  const name = command.name.toLowerCase();
  const title = command.title.toLowerCase();
  const description = command.description.toLowerCase();
  if (name === keyword) return 0;
  if (name.startsWith(keyword)) return 1;
  if (title.startsWith(keyword)) return 2;
  if (name.includes(keyword)) return 3;
  if (title.includes(keyword)) return 4;
  if (description.includes(keyword)) return 5;
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

  if (base.mimeType.startsWith("image/")) {
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      return {
        ...base,
        kind: "file",
        error: `图片超过 ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}，暂未读取内容。`,
      };
    }
    const dataUrl = await readFileAsDataUrl(file);
    return {
      ...base,
      kind: "image",
      dataUrl,
      thumbnailUrl: await createImageThumbnail(dataUrl),
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

export function createImageThumbnail(dataUrl: string, maxEdge = 180): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      if (!sourceWidth || !sourceHeight) {
        resolve(dataUrl);
        return;
      }
      const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(dataUrl);
        return;
      }
      try {
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/webp", 0.78));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
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
  return {
    codex: "Codex kernel",
    "claude-code": "Claude Code kernel",
    hermes: "Hermes kernel",
    pi: "Pi kernel",
    openclaw: "OpenClaw kernel",
    "gemini-cli": "Gemini CLI kernel",
    "deepseek-tui": "DeepSeek TUI kernel",
    "qwen-code": "Qwen Code kernel",
    opencode: "OpenCode kernel",
    copilot: "GitHub Copilot CLI kernel",
    "cursor-agent": "Cursor Agent kernel",
    kimi: "Kimi CLI kernel",
    "kiro-cli": "Kiro CLI kernel",
  }[value || ""] ?? "";
}

export function readStoredAccessMode(): RuntimeAccessMode {
  const value = typeof window === "undefined" ? "" : window.localStorage.getItem(APP_STORAGE_KEYS.accessMode);
  return value === "default" || value === "auto-review" || value === "full-access"
    ? value
    : "default";
}
