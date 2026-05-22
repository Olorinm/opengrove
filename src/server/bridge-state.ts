import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { createOpenGrove } from "../app/create-opengrove.js";
import { readAppEnv } from "../identity.js";
import type { JsonObject } from "../core.js";
import type { RoomChannelMember } from "../rooms/channel-store.js";
import {
  DEFAULT_KERNEL_NO_PROXY,
  DEFAULT_KERNEL_PROXY_URL,
  kernelProxySummary,
  resolveKernelProxySettings,
} from "../runtime/kernel-proxy.js";
import { createJsonStateStore } from "../storage/json-state-store.js";
import { normalizeOpenGroveProfile } from "../profiles/profile.js";
import { bridgeDataPath } from "./storage-paths.js";
import type {
  BridgeKernelProxySettings,
  BridgeMountedAppSettings,
  BridgeInviteLandingSettings,
  BridgeMatrixSettings,
  BridgeRemoteRoomBinding,
  BridgeRemoteSettings,
  BridgeSettings,
  BridgeState,
  LocalBridgeServerOptions,
} from "./bridge-types.js";
import {
  DEFAULT_BRIDGE_MODEL_ID,
} from "./bridge-types.js";
import {
  createBridgeKernel,
  getBridgeKernelOptions,
  getProviderHttpCaptureSnapshot,
  isEnabledEnvFlag,
  normalizeBridgeKernelPreference,
} from "./kernel-selection.js";
import {
  getAllBridgeProviderProfiles,
  normalizeCustomProviderProfiles,
  serializeProviderBindings,
} from "./provider-profiles.js";
import {
  applySystemProviderDiscovery,
} from "./system-provider-discovery.js";
import {
  normalizeKernelPathOverrides,
} from "./kernel-paths.js";
import { getBridgeTurnContext } from "./bridge-turn-context.js";
import {
  normalizeWorkspaceRootValue,
  resolveBridgeWorkspaceRoot,
} from "./workspace-root.js";
import {
  defaultBridgeVoiceSettings,
  getBridgeSttProviderCatalog,
  normalizeBridgeVoiceSettings,
} from "./voice/settings.js";

export function createBridgeState(options: LocalBridgeServerOptions): BridgeState {
  const state: BridgeState = {
    app: undefined as unknown as BridgeState["app"],
    store: options.store ?? createJsonStateStore(options.statePath),
    profile: normalizeOpenGroveProfile(options.profile, "local"),
    snapshot: {},
    computerSnapshot: {},
    model: DEFAULT_BRIDGE_MODEL_ID,
    kernel: "codex",
    settings: {
      kernel: "auto",
      workspaceRoot: undefined,
      providerHttpCaptureEnabled: false,
      codexRawEventCaptureEnabled: false,
      mountedApps: [],
      kernelProxy: defaultKernelProxySettings(),
      inviteLanding: defaultInviteLandingSettings(),
      remote: defaultRemoteSettings(),
      voice: defaultBridgeVoiceSettings(),
      kernelPathOverrides: {},
      kernelKnowledgeSourceEnabled: {},
      kernelProviderBindings: {},
      customProviders: [],
    },
    saveCandidateNote: false,
    policyOverrides: [],
  };

  const loadedSettings = loadBridgeSettings(state);
  state.settings = applySystemProviderDiscovery(loadedSettings);
  if (JSON.stringify(state.settings) !== JSON.stringify(loadedSettings)) {
    saveBridgeSettings(state);
  }
  recreateBridgeApp(state);

  return state;
}

export function recreateBridgeApp(state: BridgeState): void {
  const kernel = createBridgeKernel(state);
  const workspaceRoot = resolveBridgeWorkspaceRoot(state.settings);
  state.app = createOpenGrove({
    readPage: () => getBridgeTurnContext()?.snapshot ?? state.snapshot,
    readComputer: () => getBridgeTurnContext()?.computerSnapshot ?? state.computerSnapshot,
    kernel,
    policy: state.policyOverrides,
    sessionId: "browser-bridge",
    userId: "local-user",
    cwd: process.cwd(),
    workspaceRoot,
    includeCodexSkills: state.kernel === "codex",
    mountedApps: state.settings.mountedApps,
  });
  state.store.loadInto(state.app);
  const hadRooms = state.app.rooms.snapshot().rooms.length > 0;
  const existingMembers = new Map(state.app.rooms.listMembers().map((member) => [member.id, member]));
  const deletedMemberIds = new Set(state.app.rooms.listDeletedMemberIds());
  const appSeedMembers = mountedAppDefaultEmployees(state.settings);
  const missingAppSeedMembers = appSeedMembers
    .filter((member) => !existingMembers.has(member.id) && !deletedMemberIds.has(member.id));
  let appSeedSyncChanged = false;
  for (const member of appSeedMembers) {
    const existing = existingMembers.get(member.id);
    if (!existing || existing.disabled) continue;
    const merged = {
      ...existing,
      appId: member.appId || existing.appId,
      workspaceRoot: member.workspaceRoot || existing.workspaceRoot,
      defaultSkillIds: existing.defaultSkillIds?.length ? existing.defaultSkillIds : member.defaultSkillIds,
    };
    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      state.app.rooms.upsertMember(merged, { emitEvent: false });
      appSeedSyncChanged = true;
    }
  }
  // Kernel availability is runtime capability, not employee identity. Mounted
  // Apps may declare concrete default employees, but generic kernels do not.
  const roomSeedChanged = state.app.rooms.ensureOpenGroup(missingAppSeedMembers);
  if (!hadRooms || roomSeedChanged || appSeedSyncChanged) {
    state.store.saveFrom(state.app);
  }
  state.app.skills.list();
}

function mountedAppDefaultEmployees(settings: BridgeSettings): RoomChannelMember[] {
  const members: RoomChannelMember[] = [];
  for (const mountedApp of settings.mountedApps ?? []) {
    if (mountedApp.enabled === false || !mountedApp.path?.trim()) continue;
    const appRoot = resolvePathLike(mountedApp.path);
    if (!existsSync(appRoot)) continue;
    const manifest = readAppManifest(appRoot);
    const appId = stringOrUndefined(manifest.id) ?? stringOrUndefined(manifest.name) ?? mountedApp.id ?? basename(appRoot);
    const title = stringOrUndefined(manifest.title) ?? mountedApp.title ?? appId;
    const haystack = `${appId} ${title} ${stringOrUndefined(manifest.description) ?? ""}`.toLowerCase();
    if (haystack.includes("opengrove-vfs") || /\bvfs\b/i.test(haystack)) {
      members.push(vfsEditingEmployee(appRoot, manifest));
    } else if (haystack.includes("maeve")) {
      members.push(maeveDirectorEmployee(appRoot));
    }
  }
  return dedupeMembers(members);
}

function vfsEditingEmployee(appRoot: string, manifest: JsonObject): RoomChannelMember {
  const skillIds = stringArray(record(record(manifest).capabilities).skills);
  return {
    id: "member-app-opengrove-vfs-editing",
    name: "VFS 素材剪辑",
    kernel: "claude-code",
    model: "claude-code-default",
    role: [
      "VFS App 素材剪辑员工，使用 Claude Code 执行供应查询与自动剪辑工程。",
      `App root: ${appRoot}`,
      "默认流程：先用 supply-drama-query 查询/打包短剧物料，再用 auto-edit-project 初始化、检查或产出剪辑工程预览文件。",
      "所有生成的 Markdown、manifest、预览图、视频片段和工程文件都应写入 VFS App workspace，优先使用 workspace/runs/<run-id>/。",
    ].join("\n"),
    status: "idle",
    color: "#8b5cf6",
    lastActive: "已配置",
    defaultSkillIds: skillIds.length ? skillIds : ["supply-drama-query", "auto-edit-project"],
    appId: "opengrove-vfs",
    workspaceRoot: appRoot,
    source: "local",
    sourceLabel: "VFS App",
  };
}

function maeveDirectorEmployee(appRoot: string): RoomChannelMember {
  const defaultAgent = readOpenCodeDefaultAgent(appRoot) || "director";
  const model = readAgentModel(appRoot, defaultAgent) || "amazon-bedrock/global.anthropic.claude-sonnet-4-6";
  return {
    id: "member-app-maeve-director",
    name: "Maeve Director",
    kernel: "opencode",
    model,
    role: [
      `Maeve App 主控员工，使用 OpenCode 默认 agent: ${defaultAgent}。`,
      `App root: ${appRoot}`,
      "按 Maeve AGENTS.md 的 director 流程接收 drama_id、strategy_id、target_count，准备剧本与镜头分析，生成 todo.md/ad_spec.md，并驱动 composer/critic 产出广告素材 MP4。",
      "默认使用 Maeve app 的 CLI：maeve、script-tool、maeve-doctor、maeve-smoke；产物写入 Maeve App workspace/data。",
    ].join("\n"),
    status: "idle",
    color: "#0f766e",
    lastActive: "已配置",
    defaultSkillIds: defaultMaeveSkillIds(appRoot),
    appId: "maeve",
    workspaceRoot: appRoot,
    source: "local",
    sourceLabel: "Maeve App",
  };
}

function readAppManifest(appRoot: string): JsonObject {
  for (const fileName of ["opengrove.app.json", "opengrove.app.jsonc"]) {
    const path = join(appRoot, fileName);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    } catch {
      return {};
    }
  }
  return {};
}

function readOpenCodeDefaultAgent(appRoot: string): string | undefined {
  const path = join(appRoot, "opencode.jsonc");
  if (!existsSync(path)) return undefined;
  const match = readFileSync(path, "utf8").match(/["']default_agent["']\s*:\s*["']([^"']+)["']/);
  return match?.[1]?.trim() || undefined;
}

function readAgentModel(appRoot: string, agentName: string): string | undefined {
  const path = join(appRoot, "agents", `${agentName}.md`);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
  const model = frontmatter?.[1]?.match(/^model:\s*(.+)$/m)?.[1]?.trim();
  return model || undefined;
}

function defaultMaeveSkillIds(appRoot: string): string[] {
  const documented = ["document-skills-docx", "document-skills-pdf", "hyperframes", "hyperframes-cli", "gsap"];
  const discovered = new Set(discoverSkillIds(appRoot));
  const availableDocumented = documented.filter((skillId) => discovered.has(skillId));
  return availableDocumented.length ? availableDocumented : documented;
}

function discoverSkillIds(appRoot: string): string[] {
  const skillRoot = join(appRoot, "skills");
  if (!existsSync(skillRoot)) return [];
  const output = new Set<string>();
  walkForSkillManifests(skillRoot, 0, output);
  return [...output];
}

function walkForSkillManifests(dir: string, depth: number, output: Set<string>): void {
  if (depth > 3) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  if (entries.includes("SKILL.md")) {
    const skillId = readSkillName(join(dir, "SKILL.md")) || basename(dir);
    if (skillId) output.add(skillId);
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "workspace") continue;
    const path = join(dir, entry);
    try {
      if (statSync(path).isDirectory()) walkForSkillManifests(path, depth + 1, output);
    } catch {
      // Ignore unreadable app-private folders.
    }
  }
}

function readSkillName(path: string): string | undefined {
  try {
    const text = readFileSync(path, "utf8");
    return text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function dedupeMembers(members: RoomChannelMember[]): RoomChannelMember[] {
  const seen = new Set<string>();
  const output: RoomChannelMember[] = [];
  for (const member of members) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    output.push(member);
  }
  return output;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

export function getBridgeSettingsSnapshot(state: BridgeState): JsonObject {
  return {
    kernel: state.settings.kernel,
    workspaceRoot: resolveBridgeWorkspaceRoot(state.settings),
    workspaceRootConfigured: Boolean(state.settings.workspaceRoot),
    providerSetupVersion: state.settings.providerSetupVersion ?? 0,
    activeKernel: state.kernel,
    kernels: getBridgeKernelOptions(state),
    providers: getAllBridgeProviderProfiles(state.settings.customProviders) as unknown as JsonObject[],
    kernelProviderBindings: state.settings.kernelProviderBindings,
    customProviders: state.settings.customProviders as unknown as JsonObject[],
    kernelPathOverrides: state.settings.kernelPathOverrides as unknown as JsonObject,
    providerBindings: serializeProviderBindings(
      state.settings.kernelProviderBindings,
      state.settings.customProviders,
    ) as unknown as JsonObject[],
    kernelKnowledgeSourceEnabled: state.settings.kernelKnowledgeSourceEnabled,
    kernelProxy: kernelProxySummary(resolveKernelProxySettings(state.settings.kernelProxy, process.env)),
    inviteLanding: state.settings.inviteLanding as unknown as JsonObject,
    remote: state.settings.remote as unknown as JsonObject,
    voice: {
      ...state.settings.voice,
      sttProviders: getBridgeSttProviderCatalog(state.settings.voice),
    } as unknown as JsonObject,
    providerHttpCapture: getProviderHttpCaptureSnapshot(state),
    codexRawEventCaptureEnabled: state.settings.providerHttpCaptureEnabled && state.settings.codexRawEventCaptureEnabled,
    mountedApps: state.settings.mountedApps as unknown as JsonObject[],
    settingsPath: bridgeSettingsPath(state),
  };
}

export function normalizeBridgeSettingsPatch(input: unknown, base: BridgeSettings): BridgeSettings {
  const object = record(input);
  const source = Object.keys(record(object.settings)).length > 0 ? record(object.settings) : object;
  const providerHttpCapture = record(source.providerHttpCapture);
  return {
    kernel: normalizeBridgeKernelPreference(source.kernel, base.kernel),
    workspaceRoot: normalizeWorkspaceRootValue(source.workspaceRoot, base.workspaceRoot),
    providerSetupVersion: numberOrUndefined(source.providerSetupVersion) ?? base.providerSetupVersion,
    providerHttpCaptureEnabled:
      typeof source.providerHttpCaptureEnabled === "boolean"
        ? source.providerHttpCaptureEnabled
        : Object.keys(providerHttpCapture).length > 0
          ? providerHttpCapture.enabled === true
          : base.providerHttpCaptureEnabled,
    codexRawEventCaptureEnabled: Boolean(
      typeof source.codexRawEventCaptureEnabled === "boolean"
        ? source.codexRawEventCaptureEnabled
        : base.codexRawEventCaptureEnabled,
    ),
    mountedApps: normalizeMountedApps(source.mountedApps, base.mountedApps),
    kernelProxy: normalizeKernelProxySettings(source.kernelProxy, base.kernelProxy),
    inviteLanding: normalizeInviteLandingSettings(source.inviteLanding, base.inviteLanding),
    remote: normalizeRemoteSettings(source.remote ?? { matrix: source.matrix }, base.remote),
    voice: normalizeBridgeVoiceSettings(source.voice, base.voice),
    kernelPathOverrides: normalizeKernelPathOverrides(
      source.kernelPathOverrides,
      base.kernelPathOverrides,
    ),
    kernelKnowledgeSourceEnabled: normalizeKernelSourceSettings(
      source.kernelKnowledgeSourceEnabled,
      base.kernelKnowledgeSourceEnabled,
    ),
    kernelProviderBindings: normalizeKernelProviderBindings(
      source.kernelProviderBindings,
      base.kernelProviderBindings,
    ),
    customProviders: normalizeCustomProviderProfiles(source.customProviders ?? base.customProviders),
  };
}

export function loadBridgeSettings(state: BridgeState): BridgeSettings {
  const defaults = defaultBridgeSettings();
  try {
    const parsed = JSON.parse(readFileSync(bridgeSettingsPath(state), "utf8")) as Record<string, unknown>;
    return {
      kernel: normalizeBridgeKernelPreference(parsed.kernel, defaults.kernel),
      workspaceRoot: normalizeWorkspaceRootValue(parsed.workspaceRoot, defaults.workspaceRoot),
      providerSetupVersion: numberOrUndefined(parsed.providerSetupVersion) ?? defaults.providerSetupVersion,
      providerHttpCaptureEnabled:
        typeof parsed.providerHttpCaptureEnabled === "boolean"
          ? parsed.providerHttpCaptureEnabled
          : defaults.providerHttpCaptureEnabled,
      codexRawEventCaptureEnabled:
        typeof parsed.codexRawEventCaptureEnabled === "boolean"
          ? parsed.codexRawEventCaptureEnabled
          : defaults.codexRawEventCaptureEnabled,
      mountedApps: normalizeMountedApps(parsed.mountedApps, defaults.mountedApps),
      kernelProxy: normalizeKernelProxySettings(parsed.kernelProxy, defaults.kernelProxy),
      inviteLanding: normalizeInviteLandingSettings(parsed.inviteLanding, defaults.inviteLanding),
      remote: normalizeRemoteSettings(parsed.remote ?? { matrix: parsed.matrix }, defaults.remote),
      voice: normalizeBridgeVoiceSettings(parsed.voice, defaults.voice),
      kernelPathOverrides: normalizeKernelPathOverrides(
        parsed.kernelPathOverrides,
        defaults.kernelPathOverrides,
      ),
      kernelKnowledgeSourceEnabled: normalizeKernelSourceSettings(
        parsed.kernelKnowledgeSourceEnabled,
        defaults.kernelKnowledgeSourceEnabled,
      ),
      kernelProviderBindings: normalizeKernelProviderBindings(
        parsed.kernelProviderBindings,
        defaults.kernelProviderBindings,
      ),
      customProviders: normalizeCustomProviderProfiles(parsed.customProviders ?? defaults.customProviders),
    };
  } catch {
    return defaults;
  }
}

export function saveBridgeSettings(state: BridgeState): void {
  const path = bridgeSettingsPath(state);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state.settings, null, 2)}\n`, "utf8");
}

function defaultBridgeSettings(): BridgeSettings {
  return {
    kernel: normalizeBridgeKernelPreference(readAppEnv("KERNEL"), "auto"),
    workspaceRoot: normalizeWorkspaceRootValue(readAppEnv("WORKSPACE_ROOT"), undefined),
    providerSetupVersion: 0,
    providerHttpCaptureEnabled: isEnabledEnvFlag(
      readAppEnv("PROVIDER_CAPTURE_ENABLED") ?? readAppEnv("PROVIDER_HTTP_CAPTURE"),
    ),
    codexRawEventCaptureEnabled: isEnabledEnvFlag(readAppEnv("CODEX_RAW_EVENT_CAPTURE")),
    mountedApps: defaultMountedApps(),
    kernelProxy: defaultKernelProxySettings(),
    inviteLanding: defaultInviteLandingSettings(),
    remote: defaultRemoteSettings(),
    voice: defaultBridgeVoiceSettings(),
    kernelPathOverrides: {},
    kernelKnowledgeSourceEnabled: {},
    kernelProviderBindings: {},
    customProviders: [],
  };
}

function defaultMountedApps(): BridgeMountedAppSettings[] {
  const raw = readAppEnv("APP_DIRS") || readAppEnv("MOUNTED_APPS") || "";
  if (!raw.trim()) return [];
  return normalizeMountedApps(
    raw.split(delimiter).map((path) => ({ path })),
    [],
  );
}

function normalizeMountedApps(
  input: unknown,
  fallback: BridgeMountedAppSettings[],
): BridgeMountedAppSettings[] {
  if (input === undefined || input === null) {
    return fallback.map((item) => ({ ...item }));
  }
  const rawItems = Array.isArray(input) ? input : typeof input === "string" ? input.split(delimiter) : [];
  const output: BridgeMountedAppSettings[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();

  for (const rawItem of rawItems) {
    const item = typeof rawItem === "string" ? { path: rawItem } : record(rawItem);
    const path = stringOrUndefined(item.path);
    if (!path) continue;

    const normalizedPath = resolvePathLike(path);
    if (seenPaths.has(normalizedPath)) continue;
    seenPaths.add(normalizedPath);

    const title = stringOrUndefined(item.title) ?? stringOrUndefined(item.name);
    let id = slug(stringOrUndefined(item.id) ?? title ?? basename(normalizedPath) ?? "app");
    if (!id) id = "app";
    const baseId = id;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);

    output.push({
      id,
      path: normalizedPath,
      enabled: item.enabled === false ? false : true,
      ...(title ? { title } : {}),
    });
  }

  return output;
}

function resolvePathLike(path: string): string {
  if (path === "~") return resolve(process.env.HOME || "");
  if (path.startsWith("~/")) return resolve(process.env.HOME || "", path.slice(2));
  return resolve(path);
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultKernelProxySettings(): BridgeKernelProxySettings {
  return {
    enabled: isEnabledEnvFlag(readAppEnv("KERNEL_PROXY")),
    proxyUrl: readAppEnv("KERNEL_PROXY_URL") || DEFAULT_KERNEL_PROXY_URL,
    noProxy: readAppEnv("KERNEL_PROXY_NO_PROXY") || DEFAULT_KERNEL_NO_PROXY,
    nodeUseEnvProxy: isEnabledEnvFlag(readAppEnv("KERNEL_PROXY_NODE_USE_ENV_PROXY")),
  };
}

function defaultInviteLandingSettings(): BridgeInviteLandingSettings {
  const baseUrl = readAppEnv("INVITE_BASE_URL")
    || readAppEnv("INVITE_URL")
    || "";
  return {
    baseUrl,
  };
}

function defaultRemoteSettings(): BridgeRemoteSettings {
  return {
    matrix: defaultMatrixSettings(),
  };
}

function defaultMatrixSettings(): BridgeMatrixSettings {
  const homeserverUrl = readAppEnv("OPENGROVE_MATRIX_HOMESERVER_URL") || readAppEnv("MATRIX_HOMESERVER_URL") || "";
  const accessToken = readAppEnv("OPENGROVE_MATRIX_ACCESS_TOKEN") || readAppEnv("MATRIX_ACCESS_TOKEN") || undefined;
  return {
    enabled: isEnabledEnvFlag(readAppEnv("OPENGROVE_MATRIX_ENABLED")) || Boolean(homeserverUrl && accessToken),
    homeserverUrl,
    userId: readAppEnv("OPENGROVE_MATRIX_USER_ID") || readAppEnv("MATRIX_USER_ID") || "",
    accessToken,
    bindings: {},
  };
}

function bridgeSettingsPath(state: BridgeState): string {
  const explicit = readAppEnv("BRIDGE_SETTINGS_PATH");
  if (explicit) return resolve(explicit);
  return bridgeDataPath(state, "bridge-settings.json");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeInviteLandingSettings(
  input: unknown,
  fallback: BridgeInviteLandingSettings,
): BridgeInviteLandingSettings {
  const source = record(input);
  const baseUrl = typeof source.baseUrl === "string" ? source.baseUrl.trim() : fallback.baseUrl;
  return {
    baseUrl,
  };
}

function normalizeRemoteSettings(
  input: unknown,
  fallback: BridgeRemoteSettings,
): BridgeRemoteSettings {
  const source = record(input);
  return {
    matrix: normalizeMatrixSettings(source.matrix, fallback.matrix),
  };
}

function normalizeMatrixSettings(
  input: unknown,
  fallback: BridgeMatrixSettings,
): BridgeMatrixSettings {
  const source = record(input);
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    homeserverUrl: typeof source.homeserverUrl === "string" ? source.homeserverUrl.trim() : fallback.homeserverUrl,
    userId: typeof source.userId === "string" ? source.userId.trim() : fallback.userId,
    accessToken: Object.prototype.hasOwnProperty.call(source, "accessToken")
      ? stringOrUndefined(source.accessToken)
      : fallback.accessToken,
    bindings: normalizeRemoteRoomBindings(source.bindings ?? source.roomBindings, fallback.bindings),
  };
}

function normalizeRemoteRoomBindings(
  input: unknown,
  fallback: Record<string, BridgeRemoteRoomBinding>,
): Record<string, BridgeRemoteRoomBinding> {
  if (input === undefined || input === null) {
    return { ...fallback };
  }
  const source = record(input);
  const bindings: Record<string, BridgeRemoteRoomBinding> = {};
  for (const [localRoomId, value] of Object.entries(source)) {
    const item = record(value);
    const remoteRoomId = stringOrUndefined(item.remoteRoomId) ?? stringOrUndefined(item.matrixRoomId);
    const homeserverUrl = stringOrUndefined(item.homeserverUrl);
    if (!localRoomId.trim() || !remoteRoomId || !homeserverUrl) {
      continue;
    }
    bindings[localRoomId] = {
      provider: "matrix",
      accountId: stringOrUndefined(item.accountId) ?? "default",
      remoteRoomId,
      homeserverUrl,
      title: stringOrUndefined(item.title) ?? "群聊",
      createdAt: stringOrUndefined(item.createdAt) ?? new Date(0).toISOString(),
      syncCursor: stringOrUndefined(item.syncCursor) ?? stringOrUndefined(item.syncToken),
      enabled: item.enabled === false ? false : true,
    };
  }
  return bindings;
}

function normalizeKernelSourceSettings(
  input: unknown,
  fallback: Record<string, Record<string, boolean>>,
): Record<string, Record<string, boolean>> {
  if (input === undefined || input === null) {
    return { ...fallback };
  }
  const source = record(input);
  const normalized: Record<string, Record<string, boolean>> = {};
  for (const [kernelId, value] of Object.entries(source)) {
    const sourceRecord = record(value);
    const entries: Record<string, boolean> = {};
    for (const [sourceId, enabled] of Object.entries(sourceRecord)) {
      if (typeof enabled === "boolean") {
        entries[sourceId] = enabled;
      }
    }
    if (Object.keys(entries).length) {
      normalized[kernelId] = entries;
    }
  }
  return normalized;
}

function normalizeKernelProviderBindings(
  input: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  if (input === undefined || input === null) {
    return { ...fallback };
  }
  const source = record(input);
  const normalized: Record<string, string> = {};
  for (const [kernelId, providerId] of Object.entries(source)) {
    if (typeof providerId === "string" && providerId.trim()) {
      normalized[kernelId] = providerId.trim();
    }
  }
  return normalized;
}

function normalizeKernelProxySettings(
  input: unknown,
  fallback: BridgeKernelProxySettings,
): BridgeKernelProxySettings {
  const source = record(input);
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    proxyUrl: nonEmptyString(source.proxyUrl) ?? fallback.proxyUrl,
    noProxy: nonEmptyString(source.noProxy) ?? fallback.noProxy,
    nodeUseEnvProxy:
      typeof source.nodeUseEnvProxy === "boolean"
        ? source.nodeUseEnvProxy
        : fallback.nodeUseEnvProxy,
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function bridgeSettingsFileExists(state: BridgeState): boolean {
  return existsSync(bridgeSettingsPath(state));
}
