import type { AttachmentPayload, KernelOption, MessagePart, ModelId } from "../../bridge";

export type MemberStatus = "idle" | "running" | "done" | "waiting" | "offline";
export type MessageStatus = "sent" | "running" | "done" | "failed" | "interrupted";
export type RoomMemberSource = "local" | "remote" | "human";
export type RoomInviteStatus = "none" | "pending" | "accepted" | "revoked" | "expired";

export type RoomMember = {
  id: string;
  name: string;
  kernel: string;
  model: string;
  role: string;
  status: MemberStatus;
  color: string;
  lastActive: string;
  avatarDataUrl?: string;
  source?: RoomMemberSource;
  sourceLabel?: string;
  inviteStatus?: RoomInviteStatus;
  homeNodeLabel?: string;
  matrixUserId?: string;
  matrixAgentId?: string;
  disabled?: boolean;
};

export type RoomMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderType: "user" | "agent" | "system";
  text: string;
  targetIds: string[];
  status: MessageStatus;
  createdAt: string;
  attachments?: AttachmentPayload[];
  duration?: string;
  runId?: string;
  parts?: MessagePart[];
  startedAt?: string;
  finishedAt?: string;
  matrixEventId?: string;
  matrixTurnId?: string;
};

export type Room = {
  id: string;
  kind: "group" | "direct";
  title: string;
  badge: string;
  memberIds: string[];
  directMemberId?: string;
  pinned?: boolean;
  archived?: boolean;
  messages: RoomMessage[];
  updatedAt: string;
  unread: number;
  matrix?: RoomMatrixBinding;
};

export type RoomMatrixBinding = {
  homeserverUrl: string;
  roomId: string;
  localMemberId?: string;
  mode: "host" | "guest";
};

export type RoomsState = {
  rooms: Room[];
  members: RoomMember[];
  activeRoomId: string;
  deletedMemberIds?: string[];
};

export const MEMBER_PRESETS: RoomMember[] = [
  {
    id: defaultMemberIdForKernel("codex"),
    name: "Codex",
    kernel: "codex",
    model: "gpt-5.5",
    role: "SDK 接入",
    status: "idle",
    color: "#2563eb",
    lastActive: "刚刚",
  },
  {
    id: defaultMemberIdForKernel("claude-code"),
    name: "Claude Code",
    kernel: "claude-code",
    model: "claude-code-default",
    role: "SDK 接入",
    status: "idle",
    color: "#f59e0b",
    lastActive: "5 分钟前",
  },
  {
    id: defaultMemberIdForKernel("gemini"),
    name: "Gemini",
    kernel: "gemini-cli",
    model: "gemini-2.5-pro",
    role: "Gemini CLI",
    status: "waiting",
    color: "#10b981",
    lastActive: "12 分钟前",
  },
  {
    id: defaultMemberIdForKernel("aide"),
    name: "Aide",
    kernel: "browser",
    model: "ui-review",
    role: "浏览器辅助",
    status: "idle",
    color: "#ef4444",
    lastActive: "20 分钟前",
  },
];

export const KERNEL_COLORS: Record<string, string> = {
  codex: "#2563eb",
  "claude-code": "#f59e0b",
  "gemini-cli": "#10b981",
  hermes: "#7c3aed",
  pi: "#0f766e",
  openclaw: "#ef4444",
  "deepseek-tui": "#475569",
  "qwen-code": "#0284c7",
  opencode: "#111827",
  copilot: "#24292f",
  "cursor-agent": "#0f172a",
  kimi: "#00a5ff",
  "kiro-cli": "#7c3aed",
};

export const ROOM_OWNER_MEMBER: RoomMember = {
  id: "room-owner",
  name: "我",
  kernel: "user",
  model: "本机",
  role: "本机用户",
  status: "idle",
  color: "#64748b",
  lastActive: "当前",
  source: "human",
  sourceLabel: "人类",
  inviteStatus: "none",
};

const KERNEL_MEMBER_FALLBACKS: Record<string, Partial<RoomMember>> = Object.fromEntries(
  MEMBER_PRESETS.map((member) => [member.kernel, member]),
);

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

export function roomMemberSourceLabel(member: Pick<RoomMember, "source" | "sourceLabel">): string {
  const label = member.sourceLabel?.trim();
  if (label === "local") return "本机";
  if (label === "remote") return "远程";
  if (label === "human") return "人类";
  if (label) return label;
  return {
    local: "本机",
    remote: "远程",
    human: "人类",
  }[member.source || "local"];
}

export function roomMemberSourceDetail(member: Pick<RoomMember, "source" | "kernel" | "model" | "homeNodeLabel" | "inviteStatus">): string {
  if (member.source === "remote") {
    const status = member.inviteStatus && member.inviteStatus !== "none" ? inviteStatusLabel(member.inviteStatus) : "已连接";
    return `${member.homeNodeLabel || "OpenGrove Node"} · ${status}`;
  }
  if (member.source === "human") {
    return "人类成员";
  }
  return `${member.kernel} / ${memberModelLabel(member)}`;
}

export function inviteStatusLabel(status: RoomInviteStatus | undefined): string {
  return {
    none: "无需邀请",
    pending: "等待接受",
    accepted: "已接受",
    revoked: "已撤销",
    expired: "已过期",
  }[status || "none"];
}

export function defaultMemberIdForKernel(kernelId: string): string {
  return `employee_${hashStableId(kernelId.trim() || "kernel")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function directRoomId(memberId: string): string {
  return `direct-${memberId}`;
}

export function memberInitial(name: string): string {
  return name.slice(0, 1).toUpperCase();
}

export function statusLabel(status: MemberStatus): string {
  return {
    idle: "空闲",
    running: "执行中",
    done: "已完成",
    waiting: "待命",
    offline: "离线",
  }[status];
}

export function roomMemberStatusLabel(member: Pick<RoomMember, "status" | "disabled">): string {
  return member.disabled ? "已移除" : statusLabel(member.status);
}

export function memberModelLabel(member: Pick<RoomMember, "kernel" | "model">): string {
  const model = normalizeRoomMemberModelForKernel(member.kernel, member.model);
  if (member.kernel === "claude-code" && model === "claude-code-default") {
    return "跟随 Claude Code 配置";
  }
  if (member.kernel === "pi" && model === "pi-default") {
    return "跟随 Pi 配置";
  }
  return model;
}

export function selectableKernelOptions(kernelOptions: KernelOption[], activeKernel: string | undefined): KernelOption[] {
  return kernelOptions
    .filter((kernel) => kernel.id !== "auto")
    .sort((left, right) => kernelSortScore(right, activeKernel) - kernelSortScore(left, activeKernel));
}

export function roomMemberFromKernel(kernel: KernelOption, activeKernel: string | undefined, activeModel: ModelId): RoomMember {
  const fallback = KERNEL_MEMBER_FALLBACKS[kernel.id] ?? {};
  const source: RoomMemberSource = "local";
  return {
    id: fallback.id || defaultMemberIdForKernel(kernel.id),
    name: kernel.label || fallback.name || kernel.id,
    kernel: kernel.id,
    model: normalizeRoomMemberModelForKernel(kernel.id, kernel.id === activeKernel ? activeModel : fallback.model || kernel.providerLabel || kernel.version || "native"),
    role: kernel.description || fallback.role || "员工",
    status: kernel.id === activeKernel ? "idle" : "waiting",
    color: fallback.color || KERNEL_COLORS[kernel.id] || "#64748b",
    lastActive: kernel.id === activeKernel ? "刚刚" : "待命",
    source,
    sourceLabel: roomMemberSourceLabel({ source }),
    inviteStatus: "none",
  };
}

function hashStableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function normalizeRoomMemberModelForKernel(kernel: string, model: string): string {
  const value = model.trim();
  if (kernel === "claude-code" && (!value || value === "Claude Code" || value === "AWS Bedrock (API Key)" || value.endsWith("(Claude Code)"))) {
    return "claude-code-default";
  }
  if (kernel === "pi" && (!value || value === "Pi")) {
    return "pi-default";
  }
  return value || "native";
}

function kernelSortScore(kernel: KernelOption, activeKernel: string | undefined): number {
  return (kernel.id === activeKernel ? 10 : 0) + (kernel.available || kernel.installed ? 4 : 0);
}
