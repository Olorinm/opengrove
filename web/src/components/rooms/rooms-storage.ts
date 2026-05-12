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
  relayMemberId?: string;
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
  relayEventId?: string;
  relayTurnId?: string;
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
  messages: RoomMessage[];
  updatedAt: string;
  unread: number;
  relay?: RoomRelayBinding;
  matrix?: RoomMatrixBinding;
};

export type RoomRelayBinding = {
  baseUrl: string;
  workspaceId: string;
  roomId: string;
  memberId: string;
  memberToken?: string;
  localMemberId?: string;
  mode: "host" | "guest";
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
};

export const LEGACY_ROOMS_STORAGE_KEY = "opengrove.rooms.v11";
export const ROOMS_STORAGE_KEY_PREFIX = "opengrove.rooms.v12";
export const ROOMS_STATE_EVENT = "opengrove:rooms-state-change";

const LEGACY_PRESET_MEMBER_IDS_BY_KERNEL: Record<string, string[]> = {
  codex: ["codex", "employee-codex"],
  "claude-code": ["claude-code", "employee-claude-code"],
  "gemini-cli": ["gemini", "employee-gemini"],
  browser: ["aide", "employee-aide"],
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
  if (member.sourceLabel?.trim()) return member.sourceLabel.trim();
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
  return `${member.kernel} / ${member.model}`;
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

export function roomsStorageKey(activeWorkspaceRoot: string): string {
  const scope = activeWorkspaceRoot.trim() || "default";
  return `${ROOMS_STORAGE_KEY_PREFIX}:${hashStableId(scope)}`;
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

export function memberModelLabel(member: Pick<RoomMember, "kernel" | "model">): string {
  if (member.kernel === "claude-code" && member.model === "claude-code-default") {
    return "跟随 Claude Code 配置";
  }
  if (member.kernel === "pi" && member.model === "pi-default") {
    return "跟随 Pi 配置";
  }
  return member.model;
}

export function installedKernelOptions(kernelOptions: KernelOption[]): KernelOption[] {
  return kernelOptions.filter((kernel) => kernel.id !== "auto" && (kernel.available || kernel.installed));
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
    model: normalizeMemberModelForKernel(kernel.id, kernel.id === activeKernel ? activeModel : fallback.model || kernel.providerLabel || kernel.version || "native"),
    role: kernel.description || fallback.role || "员工",
    status: kernel.id === activeKernel ? "idle" : "waiting",
    color: fallback.color || KERNEL_COLORS[kernel.id] || "#64748b",
    lastActive: kernel.id === activeKernel ? "刚刚" : "待命",
    source,
    sourceLabel: roomMemberSourceLabel({ source }),
    inviteStatus: "none",
  };
}

export function resolveRoomMembers(activeKernel: string | undefined, activeModel: ModelId, kernelOptions: KernelOption[]): RoomMember[] {
  const installed = installedKernelOptions(kernelOptions);
  if (installed.length) {
    return installed.map((kernel) => roomMemberFromKernel(kernel, activeKernel, activeModel));
  }
  return MEMBER_PRESETS.slice(0, 2).map((member) => (
    member.kernel === "codex"
      ? { ...member, kernel: activeKernel || member.kernel, model: activeModel || member.model }
      : member
  ));
}

export function createInitialState(
  activeKernel: string | undefined,
  activeModel: ModelId,
  activeWorkspaceRoot: string,
  kernelOptions: KernelOption[],
): RoomsState {
  const members = resolveRoomMembers(activeKernel, activeModel, kernelOptions);
  const createdAt = nowIso();
  const rooms: Room[] = [
    {
      id: "room-open-group",
      kind: "group",
      title: "open group",
      badge: "项目",
      memberIds: members.map((member) => member.id),
      pinned: false,
      unread: 0,
      updatedAt: createdAt,
      messages: [
        {
          id: "seed-open-system",
          senderId: "system",
          senderName: "系统",
          senderType: "system",
          text: "open group 已创建。输入 @成员 或 @所有人 后发送，会走 OpenGrove 真实执行流。",
          targetIds: [],
          status: "done",
          createdAt,
        },
      ],
    },
  ];
  if (!activeWorkspaceRoot) {
    rooms[0]!.messages.unshift({
      id: "seed-workspace-empty",
      senderId: "system",
      senderName: "系统",
      senderType: "system",
      text: "当前会使用 OpenGrove 默认工作区。",
      targetIds: [],
      status: "done",
      createdAt,
    });
  }
  return { rooms, members, activeRoomId: rooms[0]?.id ?? "" };
}

export function readStoredState(
  activeKernel: string | undefined,
  activeModel: ModelId,
  activeWorkspaceRoot: string,
  kernelOptions: KernelOption[],
): RoomsState {
  const seeded = createInitialState(activeKernel, activeModel, activeWorkspaceRoot, kernelOptions);
  const storageKey = roomsStorageKey(activeWorkspaceRoot);
  try {
    const raw = window.localStorage.getItem(storageKey) || window.localStorage.getItem(LEGACY_ROOMS_STORAGE_KEY);
    const parsed = JSON.parse(raw || "null") as Partial<RoomsState> | null;
    return normalizeStoredRoomsState(parsed, seeded.members, seeded.activeRoomId) ?? seeded;
  } catch {
    return seeded;
  }
}

export function normalizeStoredRoomsState(
  parsed: Partial<RoomsState> | null,
  seedMembers: RoomMember[],
  fallbackActiveRoomId = "",
): RoomsState | null {
  if (!parsed || !Array.isArray(parsed.rooms) || typeof parsed.activeRoomId !== "string") {
    return null;
  }
  const parsedActiveRoomId = parsed.activeRoomId;
  const memberIdMigrations = createLegacyMemberIdMigration(seedMembers);
  const incomingMembers = Array.isArray(parsed.members)
    ? parsed.members.map((member) => migrateRoomMember(member, memberIdMigrations))
    : [];
  const members = mergeMembersById(seedMembers, incomingMembers);
  const memberIds = new Set(members.map((member) => member.id));
  const rooms = parsed.rooms
    .map((room) => ({
      ...room,
      id: migrateRoomId(String(room.id || ""), memberIdMigrations),
      kind: room.kind ?? (room.directMemberId ? "direct" : "group"),
      directMemberId: room.directMemberId ? migrateMemberId(room.directMemberId, memberIdMigrations) : undefined,
      relay: normalizeRoomRelayBinding(room.relay),
      matrix: normalizeRoomMatrixBinding(room.matrix),
      pinned: Boolean(room.pinned),
      memberIds: Array.isArray(room.memberIds)
        ? room.memberIds.map((memberId) => migrateMemberId(memberId, memberIdMigrations)).filter((memberId) => memberIds.has(memberId))
        : [],
      messages: Array.isArray(room.messages)
        ? dedupeRoomMessages(room.messages.map((message) => migrateRoomMessage(message, memberIdMigrations)))
        : [],
    }))
    .filter((room) => room.memberIds.length > 0);
  if (!rooms.length) return null;
  const activeRoomId = migrateRoomId(parsedActiveRoomId, memberIdMigrations);
  return {
    rooms,
    members,
    activeRoomId: rooms.some((room) => room.id === activeRoomId)
      ? activeRoomId
      : fallbackActiveRoomId && rooms.some((room) => room.id === fallbackActiveRoomId)
        ? fallbackActiveRoomId
        : rooms[0]?.id ?? "",
  };
}

export function mergeRoomsByUpdatedAt(current: Room[], incoming: Room[]): Room[] {
  const incomingById = new Map(incoming.map((room) => [room.id, room]));
  let changed = false;
  const merged = current.map((room) => {
    const nextRoom = incomingById.get(room.id);
    incomingById.delete(room.id);
    if (nextRoom) {
      const mergedRoom = mergeRoomRecords(room, nextRoom);
      if (mergedRoom !== room) {
        changed = true;
      }
      return mergedRoom;
    }
    return room;
  });
  if (incomingById.size > 0) {
    changed = true;
    merged.push(...incomingById.values());
  }
  return changed ? merged : current;
}

function mergeRoomRecords(current: Room, incoming: Room): Room {
  const incomingIsNewer = roomUpdatedTime(incoming) > roomUpdatedTime(current);
  const newer = incomingIsNewer ? incoming : current;
  const older = incomingIsNewer ? current : incoming;
  const messages = mergeRoomMessages(older.messages, newer.messages);
  const memberIds = mergeUnique([...newer.memberIds, ...older.memberIds]);
  if (
    newer === current
    && messages === current.messages
    && memberIds.length === current.memberIds.length
    && memberIds.every((memberId, index) => memberId === current.memberIds[index])
  ) {
    return current;
  }
  return {
    ...newer,
    memberIds,
    messages,
  };
}

function mergeRoomMessages(older: RoomMessage[], newer: RoomMessage[]): RoomMessage[] {
  const byKey = new Map<string, { message: RoomMessage; order: number }>();
  let order = 0;
  for (const message of [...older, ...newer]) {
    const key = roomMessageMergeKey(message);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { message, order: order++ });
      continue;
    }
    existing.message = mergeRoomMessage(existing.message, message);
  }

  const messages = [...byKey.values()]
    .sort((left, right) => {
      const leftTime = roomMessageTime(left.message);
      const rightTime = roomMessageTime(right.message);
      return leftTime === rightTime ? left.order - right.order : leftTime - rightTime;
    })
    .map((entry) => entry.message);
  return roomMessagesEqual(messages, newer) ? newer : messages;
}

function dedupeRoomMessages(messages: RoomMessage[]): RoomMessage[] {
  return mergeRoomMessages([], messages);
}

function mergeRoomMessage(left: RoomMessage, right: RoomMessage): RoomMessage {
  const preferred = roomMessageScore(right) >= roomMessageScore(left) ? right : left;
  const fallback = preferred === right ? left : right;
  return {
    ...preferred,
    attachments: preferred.attachments?.length ? preferred.attachments : fallback.attachments,
    parts: (preferred.parts?.length ?? 0) >= (fallback.parts?.length ?? 0) ? preferred.parts : fallback.parts,
    runId: preferred.runId || fallback.runId,
    relayEventId: preferred.relayEventId || fallback.relayEventId,
    relayTurnId: preferred.relayTurnId || fallback.relayTurnId,
    matrixEventId: preferred.matrixEventId || fallback.matrixEventId,
    matrixTurnId: preferred.matrixTurnId || fallback.matrixTurnId,
  };
}

function roomMessageMergeKey(message: RoomMessage): string {
  if (message.relayEventId) return `relay-event:${message.relayEventId}`;
  if (message.matrixEventId) return `matrix-event:${message.matrixEventId}`;
  if (message.relayTurnId) return `relay-turn:${message.senderType}:${message.senderId}:${message.relayTurnId}`;
  if (message.matrixTurnId) return `matrix-turn:${message.senderType}:${message.senderId}:${message.matrixTurnId}`;
  if (message.senderType === "agent" && message.runId) return `run:${message.senderId}:${message.runId}`;
  const text = message.text.trim();
  if (text) return `content:${message.senderType}:${message.senderId}:${message.createdAt}:${text}`;
  return `id:${message.id}`;
}

function roomMessageScore(message: RoomMessage): number {
  const statusScore = message.status === "running" ? 1 : message.status === "sent" ? 0 : 2;
  return (
    statusScore * 1_000_000
    + (message.text.trim().length * 100)
    + ((message.parts?.length ?? 0) * 10)
    + (message.duration ? 5 : 0)
    + (message.finishedAt ? 5 : 0)
  );
}

function roomMessageTime(message: RoomMessage): number {
  const time = new Date(message.createdAt || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function roomMessagesEqual(left: RoomMessage[], right: RoomMessage[]): boolean {
  return left.length === right.length && left.every((message, index) => message === right[index]);
}

function mergeUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function mergeStateForStorage(nextState: RoomsState, activeWorkspaceRoot: string): RoomsState {
  const storageKey = roomsStorageKey(activeWorkspaceRoot);
  const slimState = slimRoomsStateForStorage(nextState);
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<RoomsState> | null;
    const stored = normalizeStoredRoomsState(parsed, slimState.members, slimState.activeRoomId);
    if (!stored) return slimState;
    const rooms = mergeRoomsByUpdatedAt(slimState.rooms, stored.rooms);
    const members = mergeMembersById(slimState.members, stored.members);
    const focused = typeof document !== "undefined" ? document.hasFocus() : true;
    const activeRoomId = focused ? slimState.activeRoomId : stored.activeRoomId;
    return {
      rooms,
      members,
      activeRoomId: rooms.some((room) => room.id === activeRoomId) ? activeRoomId : rooms[0]?.id ?? "",
    };
  } catch {
    return slimState;
  }
}

export function writeRoomsState(state: RoomsState, activeWorkspaceRoot: string): RoomsState {
  const storageKey = roomsStorageKey(activeWorkspaceRoot);
  const nextState = mergeStateForStorage(state, activeWorkspaceRoot);
  const serialized = JSON.stringify(nextState);
  try {
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    window.localStorage.removeItem(LEGACY_ROOMS_STORAGE_KEY);
    window.localStorage.setItem(storageKey, serialized);
  }
  dispatchRoomsStateChanged(storageKey);
  return nextState;
}

export function dispatchRoomsStateChanged(storageKey?: string) {
  window.dispatchEvent(new CustomEvent(ROOMS_STATE_EVENT, { detail: { storageKey } }));
}

function slimRoomsStateForStorage(state: RoomsState): RoomsState {
  return {
    activeRoomId: state.activeRoomId,
    members: state.members,
    rooms: state.rooms.map((room) => ({
      ...room,
      messages: room.messages.map((message) => ({
        ...message,
        attachments: message.attachments?.map(slimAttachmentForStorage),
      })),
    })),
  };
}

function slimAttachmentForStorage(attachment: AttachmentPayload): AttachmentPayload {
  const slim: AttachmentPayload = {
    id: attachment.id,
    name: attachment.name,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    size: attachment.size,
  };
  if (attachment.error) {
    slim.error = attachment.error;
  }
  return slim;
}

function mergeMembersById(seedMembers: RoomMember[], incomingMembers: Partial<RoomMember>[]): RoomMember[] {
  const byId = new Map(seedMembers.map((member) => [member.id, member]));
  for (const member of incomingMembers) {
    const fallback = typeof member.id === "string" ? byId.get(member.id) : undefined;
    const normalized = normalizeRoomMember(member, fallback);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()];
}

function normalizeRoomMember(input: Partial<RoomMember>, fallback?: RoomMember): RoomMember | null {
  const id = String(input.id || fallback?.id || "").trim();
  if (!id) return null;
  const kernel = String(input.kernel || fallback?.kernel || id).trim();
  const status = normalizeMemberStatus(input.status || fallback?.status || "waiting");
  const model = normalizeMemberModelForKernel(kernel, String(input.model || fallback?.model || "native").trim());
  const role = normalizeMemberRole(String(input.role || fallback?.role || "员工").trim(), fallback);
  const source = normalizeRoomMemberSource(input.source || fallback?.source || "local");
  return {
    id,
    name: String(input.name || fallback?.name || id).trim() || id,
    kernel,
    model,
    role,
    status,
    color: String(input.color || fallback?.color || KERNEL_COLORS[kernel] || "#64748b"),
    lastActive: String(input.lastActive || fallback?.lastActive || "待命"),
    avatarDataUrl: normalizeAvatarDataUrl(input.avatarDataUrl ?? fallback?.avatarDataUrl),
    source,
    sourceLabel: String(input.sourceLabel || fallback?.sourceLabel || roomMemberSourceLabel({ source })).trim(),
    inviteStatus: normalizeInviteStatus(input.inviteStatus || fallback?.inviteStatus || (source === "remote" ? "pending" : "none")),
    homeNodeLabel: stringOrUndefined(input.homeNodeLabel ?? fallback?.homeNodeLabel),
    relayMemberId: stringOrUndefined(input.relayMemberId ?? fallback?.relayMemberId),
    matrixUserId: stringOrUndefined(input.matrixUserId ?? fallback?.matrixUserId),
    matrixAgentId: stringOrUndefined(input.matrixAgentId ?? fallback?.matrixAgentId),
    disabled: Boolean(input.disabled ?? fallback?.disabled ?? false),
  };
}

function normalizeRoomRelayBinding(input: unknown): RoomRelayBinding | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const source = input as Partial<RoomRelayBinding>;
  const baseUrl = stringOrUndefined(source.baseUrl);
  const workspaceId = stringOrUndefined(source.workspaceId);
  const roomId = stringOrUndefined(source.roomId);
  const memberId = stringOrUndefined(source.memberId);
  if (!baseUrl || !workspaceId || !roomId || !memberId) return undefined;
  return {
    baseUrl,
    workspaceId,
    roomId,
    memberId,
    memberToken: stringOrUndefined(source.memberToken),
    localMemberId: stringOrUndefined(source.localMemberId),
    mode: source.mode === "guest" ? "guest" : "host",
  };
}

function normalizeRoomMatrixBinding(input: unknown): RoomMatrixBinding | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const source = input as Partial<RoomMatrixBinding>;
  const homeserverUrl = stringOrUndefined(source.homeserverUrl);
  const roomId = stringOrUndefined(source.roomId);
  if (!homeserverUrl || !roomId) return undefined;
  return {
    homeserverUrl,
    roomId,
    localMemberId: stringOrUndefined(source.localMemberId),
    mode: source.mode === "guest" ? "guest" : "host",
  };
}

function createLegacyMemberIdMigration(seedMembers: RoomMember[]): Map<string, string> {
  const migrations = new Map<string, string>();
  for (const member of seedMembers) {
    if (member.kernel && member.kernel !== member.id) {
      migrations.set(member.kernel, member.id);
    }
    const legacyPresetIds = LEGACY_PRESET_MEMBER_IDS_BY_KERNEL[member.kernel] ?? [];
    for (const legacyPresetId of legacyPresetIds) {
      if (legacyPresetId !== member.id) {
        migrations.set(legacyPresetId, member.id);
      }
    }
  }
  return migrations;
}

function hashStableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function migrateMemberId(memberId: string, migrations: Map<string, string>): string {
  return migrations.get(memberId) ?? memberId;
}

function migrateRoomId(roomId: string, migrations: Map<string, string>): string {
  for (const [legacyId, nextId] of migrations) {
    const legacyRoomId = directRoomId(legacyId);
    if (roomId === legacyRoomId) return directRoomId(nextId);
  }
  return roomId;
}

function migrateRoomMember(member: Partial<RoomMember>, migrations: Map<string, string>): Partial<RoomMember> {
  const id = typeof member.id === "string" ? migrateMemberId(member.id, migrations) : member.id;
  return { ...member, id };
}

function migrateRoomMessage(message: RoomMessage, migrations: Map<string, string>): RoomMessage {
  return {
    ...message,
    senderId: migrateMemberId(message.senderId, migrations),
    targetIds: Array.isArray(message.targetIds)
      ? message.targetIds.map((targetId) => migrateMemberId(targetId, migrations))
      : [],
  };
}

function normalizeAvatarDataUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("data:image/") ? value : undefined;
}

function normalizeRoomMemberSource(source: unknown): RoomMemberSource {
  return ["local", "remote", "human"].includes(String(source))
    ? String(source) as RoomMemberSource
    : "local";
}

function normalizeInviteStatus(status: unknown): RoomInviteStatus {
  return ["none", "pending", "accepted", "revoked", "expired"].includes(String(status))
    ? String(status) as RoomInviteStatus
    : "none";
}

function stringOrUndefined(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function normalizeMemberRole(role: string, fallback?: RoomMember): string {
  if (role === "实现 / 调试" || role === "方案 / 取舍" || role === "复核 / 风险" || role === "界面 / 体验") {
    return fallback?.role || "员工";
  }
  return role || fallback?.role || "员工";
}

function normalizeMemberModelForKernel(kernel: string, model: string): string {
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

function normalizeMemberStatus(status: unknown): MemberStatus {
  return ["idle", "running", "done", "waiting", "offline"].includes(String(status))
    ? String(status) as MemberStatus
    : "waiting";
}

function roomUpdatedTime(room: Room | undefined): number {
  const time = room?.updatedAt ? new Date(room.updatedAt).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}
