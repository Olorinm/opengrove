import { postJson } from "../../bridge";
import type { ExtensionInventoryRecord, ExtensionItemRecord, KernelOption, SkillRecord } from "../../bridge";
import type { Room, RoomMember, RoomMessage } from "./rooms-model";

export type ContactEditDraft = {
  name: string;
  role: string;
  kernel: string;
  model: string;
  defaultSkillIds: string[];
  avatarDataUrl?: string;
};

export type ContactSkillOption = {
  id: string;
  itemId?: string;
  deploymentId?: string;
  name: string;
  title: string;
  description: string;
  sourceLabel: string;
  sourcePath?: string;
  publishedKernelIds: string[];
};

export type EmployeeConsoleTab = "activity" | "identity" | "kernel" | "skills";

export type MemberActivitySnapshot = {
  currentWork: string;
  totalRuns: number;
  failedRuns: number;
  successRate: number;
  averageDuration: string;
  recentRuns: Array<{
    id: string;
    title: string;
    createdAt: string;
    duration: string;
    status: RoomMessage["status"];
    statusLabel: string;
  }>;
};

export function buildContactSkillOptions(skills: SkillRecord[], extensions: ExtensionInventoryRecord | undefined): ContactSkillOption[] {
  const byId = new Map<string, ContactSkillOption>();
  for (const item of extensions?.items ?? []) {
    if (item.kind !== "skill") continue;
    mergeSkillOption(byId, skillOptionFromExtensionItem(item));
  }
  for (const skill of skills) {
    const option = skillOptionFromSkillRecord(skill);
    if (option) mergeSkillOption(byId, option);
  }
  return [...byId.values()].sort((left, right) => {
    const leftTitle = (left.title || left.name).toLowerCase();
    const rightTitle = (right.title || right.name).toLowerCase();
    return leftTitle.localeCompare(rightTitle);
  });
}

export function contactKernelSubline(kernel: KernelOption): string {
  if (!kernel.available && !kernel.installed) {
    return kernel.reason ? `未安装 · ${kernel.reason}` : "未安装";
  }
  return kernel.providerLabel || kernel.version || "可用";
}

export function employeeTagLabel(value: string | undefined, fallback: string): string {
  const firstLine = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return shortText(firstLine || fallback, 36);
}

export function effectiveMemberSkillIds(member: RoomMember, skills: ContactSkillOption[]): string[] {
  return member.defaultSkillIds?.length ? normalizeSkillIds(member.defaultSkillIds) : defaultSkillIdsForKernel(member.kernel, skills);
}

export function defaultSkillIdsForKernel(kernelId: string, skills: ContactSkillOption[]): string[] {
  return skills.filter((skill) => skill.publishedKernelIds.includes(kernelId)).map((skill) => skill.id);
}

export function normalizeSkillIds(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function emptyMemberActivitySnapshot(): MemberActivitySnapshot {
  return {
    currentWork: "",
    totalRuns: 0,
    failedRuns: 0,
    successRate: 0,
    averageDuration: "",
    recentRuns: [],
  };
}

export function buildMemberActivitySnapshot(member: RoomMember, rooms: Room[]): MemberActivitySnapshot {
  const relatedMessages = rooms
    .filter((room) => room.directMemberId === member.id || room.memberIds.includes(member.id))
    .flatMap((room) => room.messages.map((message) => ({ ...message, roomTitle: room.title })))
    .filter((message) => (
      message.senderId === member.id
      || message.targetIds.includes(member.id)
      || message.senderType === "user"
    ))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const agentRuns = relatedMessages.filter((message) => message.senderId === member.id);
  const completedRuns = agentRuns.filter((message) => message.status === "done" || message.status === "failed" || message.status === "interrupted");
  const failedRuns = completedRuns.filter((message) => message.status === "failed" || message.status === "interrupted").length;
  const successfulRuns = completedRuns.filter((message) => message.status === "done").length;
  const totalRuns = completedRuns.length;
  const running = agentRuns.find((message) => message.status === "running");
  const durations = completedRuns
    .map((message) => durationSeconds(message.duration))
    .filter((value): value is number => typeof value === "number");
  const average = durations.length
    ? `${(durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1)}s`
    : "";
  return {
    currentWork: running ? shortText(running.text || running.roomTitle || "正在处理任务", 80) : "",
    totalRuns,
    failedRuns,
    successRate: totalRuns ? Math.round((successfulRuns / totalRuns) * 100) : 0,
    averageDuration: average,
    recentRuns: agentRuns.slice(0, 5).map((message) => ({
      id: message.id,
      title: shortText(message.text || message.roomTitle || "员工运行", 88),
      createdAt: relativeTimeLabel(message.createdAt),
      duration: message.duration || "",
      status: message.status,
      statusLabel: roomMessageStatusLabel(message.status),
    })),
  };
}

export async function publishSelectedSkillsToKernel(
  member: RoomMember,
  skills: ContactSkillOption[],
  availableKernelIds: string[],
): Promise<{ published: number; skipped: number; selected: number; warnings: string[] }> {
  const selectedIds = normalizeSkillIds(member.defaultSkillIds);
  if (!availableKernelIds.includes(member.kernel)) {
    return { published: 0, skipped: 0, selected: selectedIds.length, warnings: [`${member.kernel}:kernel_not_available`] };
  }
  const selected = selectedIds
    .map((skillId) => skills.find((skill) => skill.id === skillId))
    .filter((skill): skill is ContactSkillOption => Boolean(skill));
  const warnings: string[] = [];
  let published = 0;
  let skipped = 0;
  for (const skill of selected) {
    if (skill.publishedKernelIds.includes(member.kernel)) {
      skipped += 1;
      continue;
    }
    const payload = publishPayloadForSkill(skill);
    if (!Object.keys(payload).length) {
      warnings.push(`${skill.name}:skill_source_not_found`);
      continue;
    }
    const result = await postJson<{ result?: { warnings?: string[] } }>("/extensions/skills/publish", {
      ...payload,
      targetKernelIds: [member.kernel],
      scope: "user",
      replace: false,
    });
    const resultWarnings = Array.isArray(result?.result?.warnings) ? result.result.warnings : [];
    warnings.push(...resultWarnings.map((warning) => `${skill.name}:${warning}`));
    published += 1;
  }
  return { published, skipped, selected: selectedIds.length, warnings };
}

export function formatSkillPublishStatus(result: { published: number; skipped: number; selected: number; warnings: string[] }): string {
  if (!result.selected) return "已保存；没有默认 skill";
  if (result.warnings.length) return `已保存；${result.published} 个 skill 已发布，${result.warnings.length} 条提示`;
  if (result.published) return `已保存；${result.published} 个 skill 已发布到内核`;
  return "已保存；默认 skill 已在当前内核";
}

function skillOptionFromExtensionItem(item: ExtensionItemRecord): ContactSkillOption {
  const deployments = item.deployments ?? [];
  const primaryDeployment =
    deployments.find((deployment) => deployment.managedByOpenGrove && !deployment.kernelId) ??
    deployments.find((deployment) => deployment.managedByOpenGrove) ??
    deployments[0];
  const managedSourceRoot = typeof primaryDeployment?.metadata?.managedSourceRoot === "string"
    ? primaryDeployment.metadata.managedSourceRoot
    : undefined;
  const publishedKernelIds = normalizeSkillIds(
    deployments
      .filter((deployment) => deployment.kind === "skill" && deployment.enabled && Boolean(deployment.kernelId))
      .map((deployment) => deployment.kernelId ?? ""),
  );
  return {
    id: item.id || `skill.${item.name}`,
    itemId: item.id,
    deploymentId: primaryDeployment?.id,
    name: item.name,
    title: item.title || item.name,
    description: item.description || "",
    sourceLabel: sourceLabelForSkill(item.source?.origin ?? primaryDeployment?.scope ?? "skill"),
    sourcePath: managedSourceRoot ?? primaryDeployment?.sourcePath ?? primaryDeployment?.targetPath,
    publishedKernelIds,
  };
}

function skillOptionFromSkillRecord(skill: SkillRecord): ContactSkillOption | undefined {
  const name = String(skill.name || skill.id || "").replace(/^skill\./, "").trim();
  if (!name) return undefined;
  return {
    id: String(skill.id || `skill.${name}`),
    name,
    title: String(skill.title || skill.displayName || name),
    description: String(skill.description || skill.whenToUse || ""),
    sourceLabel: sourceLabelForSkill(skill.source),
    sourcePath: typeof skill.skillRoot === "string" ? skill.skillRoot : typeof skill.entry === "string" ? skill.entry : undefined,
    publishedKernelIds: [],
  };
}

function mergeSkillOption(options: Map<string, ContactSkillOption>, next: ContactSkillOption) {
  const existing = options.get(next.id);
  if (!existing) {
    options.set(next.id, next);
    return;
  }
  options.set(next.id, {
    ...existing,
    itemId: existing.itemId ?? next.itemId,
    deploymentId: existing.deploymentId ?? next.deploymentId,
    title: existing.title || next.title,
    description: existing.description || next.description,
    sourcePath: existing.sourcePath ?? next.sourcePath,
    publishedKernelIds: normalizeSkillIds([...existing.publishedKernelIds, ...next.publishedKernelIds]),
  });
}

function sourceLabelForSkill(source: unknown): string {
  const value = String(source || "").toLowerCase();
  if (value === "user") return "用户";
  if (value === "project") return "项目";
  if (value === "bundled" || value === "system") return "系统";
  if (value === "managed") return "OpenGrove";
  if (value === "kernel") return "Kernel";
  if (value === "pack") return "Pack";
  return "Skill";
}

function durationSeconds(input: string | undefined): number | undefined {
  const value = input?.trim();
  if (!value) return undefined;
  const seconds = /^([\d.]+)s$/.exec(value);
  if (seconds) return Number(seconds[1]);
  const milliseconds = /^([\d.]+)ms$/.exec(value);
  if (milliseconds) return Number(milliseconds[1]) / 1000;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function shortText(input: string, maxLength: number): string {
  const value = input.replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function relativeTimeLabel(input: string): string {
  const timestamp = new Date(input).getTime();
  if (!Number.isFinite(timestamp)) return input;
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "刚刚";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function roomMessageStatusLabel(status: RoomMessage["status"]): string {
  if (status === "done") return "完成";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中断";
  if (status === "running") return "运行中";
  return "已发送";
}

function publishPayloadForSkill(skill: ContactSkillOption): Record<string, string> {
  if (skill.itemId) return { itemId: skill.itemId };
  if (skill.deploymentId) return { deploymentId: skill.deploymentId };
  if (skill.sourcePath) return { sourcePath: skill.sourcePath };
  if (skill.name) return { name: skill.name };
  return {};
}
