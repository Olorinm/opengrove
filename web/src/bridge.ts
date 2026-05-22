import type { BridgeStreamChunk } from "./runtime/agent-events";
import { apiUrl } from "./api-base";
import { APP_BRIDGE_TOKEN_HEADER, APP_STORAGE_KEYS } from "./identity";

export const MODEL_OPTIONS = [
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3 Codex Spark" },
  { id: "gpt-5.2", label: "GPT-5.2" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "MiMo-V2-Pro", label: "MiMo-V2-Pro" },
] as const;

export type KnownModelId = (typeof MODEL_OPTIONS)[number]["id"];
export type ModelId = string;
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type RuntimeAccessMode = "default" | "auto-review" | "full-access";
export type ResponseSpeed = "standard" | "fast";
export type KernelPreference =
  | "auto"
  | "codex"
  | "claude-code"
  | "hermes"
  | "pi"
  | "openclaw"
  | "deepseek-tui"
  | "gemini-cli"
  | "qwen-code"
  | "opencode"
  | "copilot"
  | "cursor-agent"
  | "kimi"
  | "kiro-cli";
export interface RuntimeControlOption {
  id: string;
  label: string;
  description?: string;
}
export interface RuntimeControls {
  kernel: Exclude<KernelPreference, "auto">;
  source: string;
  models: RuntimeControlOption[];
  defaultModel?: string;
  reasoningEfforts: RuntimeControlOption[];
  defaultReasoningEffort?: string;
  speedTiers: RuntimeControlOption[];
  defaultSpeedTier?: string;
}
export type ViewId =
  | "chat"
  | "app"
  | "ops"
  | "extensions"
  | "rooms"
  | "contacts"
  | "library"
  | "settings";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface TextPart {
  id: string;
  type: "text";
  text: string;
}

export interface NotePart {
  id: string;
  type: "note";
  text: string;
  tone: string;
}

export interface ToolPart {
  id: string;
  type: "tool";
  phase: string;
  toolId: string;
  title: string;
  input?: JsonValue | undefined;
  status: string;
  result?: JsonValue | undefined;
  error: string;
  approvalId: string;
  approvalStatus: string;
  approvalReason: string;
  approvalInput?: JsonValue | undefined;
}

export interface SkillPart {
  id: string;
  type: "skill";
  skillId: string;
  skillName: string;
  title: string;
  status: string;
  contentPreview: string;
  allowedTools: string[];
  model: string;
  effort: string;
  forkSessionId: string;
  result: string;
  description: string;
  whenToUse: string;
  source: string;
  trust: string;
  context: string;
  packId: string;
}

export type MessagePart = TextPart | NotePart | ToolPart | SkillPart;

export interface AttachmentPayload {
  id: string;
  name: string;
  kind: "image" | "text" | "file";
  mimeType: string;
  size: number;
  text?: string;
  dataUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface ContextArtifactPayload {
  id: string;
  title: string;
  type: string;
  summary: string;
  imageUri?: string;
}

export interface MessageContext {
  text: string;
  selectedText?: string;
  attachments?: AttachmentPayload[];
  artifacts?: ContextArtifactPayload[];
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  context: MessageContext | null;
  parts: MessagePart[];
  pending: boolean;
  runId: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkingStateRecord {
  sessionId: string;
  taskSummary: string;
  activeGoal: string;
  selectedModel: string;
  activePackId: string;
  activeSkillId: string;
  pinnedArtifactIds: string[];
  workingArtifactIds: string[];
  pendingApprovalIds: string[];
  activeToolCallIds: string[];
  discoveredSkillIds: string[];
  discoveredSkillNames: string[];
  expandedSkillIds: string[];
  invokedSkills: unknown[];
  loadedNestedMemoryPaths: string[];
  toolSchemaCache: Record<string, unknown>;
  updatedAt: string;
}

export interface ComputerElementRecord {
  id: string;
  role: string;
  name: string;
  value: string;
  description: string;
}

export interface ComputerStateRecord {
  app: string;
  windowTitle: string;
  url: string;
  focusedElement: string;
  observation: string;
  accessibilityTree: string;
  screenshotArtifactId: string;
  observedAt: string;
  elements: ComputerElementRecord[];
}

export interface AgentEventRecord {
  type?: string;
  runId?: string;
  at?: string;
  response?: {
    text?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RunRecord {
  id?: string;
  runId?: string;
  sessionId?: string;
  input?: string;
  status?: string;
  startedAt?: string;
  createdAt?: string;
  endedAt?: string;
  finishedAt?: string;
  [key: string]: unknown;
}

export interface SessionRecord {
  id?: string;
  sessionId?: string;
  title?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ArtifactRecord {
  id?: string;
  title?: string;
  type?: string;
  summary?: string;
  imageUri?: string;
  preview?: {
    text?: string;
    [key: string]: unknown;
  };
  data?: Record<string, unknown>;
  assets?: Array<Record<string, unknown>>;
  tags?: string[];
  [key: string]: unknown;
}

export interface KnowledgeDocumentRecord {
  id?: string;
  title?: string;
  type?: string;
  kind?: string;
  body?: string;
  summary?: string;
  tags?: string[];
  links?: Array<Record<string, unknown>>;
  sourceRefs?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SkillRecord {
  id?: string;
  name?: string;
  title?: string;
  displayName?: string;
  description?: string;
  whenToUse?: string;
  entry?: string;
  skillRoot?: string;
  source?: string;
  packId?: string;
  userInvocable?: boolean;
  [key: string]: unknown;
}

export interface ApprovalRecord {
  id?: string;
  title?: string;
  status?: string;
  toolId?: string;
  input?: unknown;
  approvalInput?: unknown;
  [key: string]: unknown;
}

export interface ExecutionRecord {
  id?: string;
  runId?: string;
  sessionId?: string;
  kind?: string;
  title?: string;
  status?: string;
  eventType?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface KnowledgeFolderRecord {
  path: string;
  backing?: "vault" | "native";
  originPath?: string;
  [key: string]: unknown;
}

export interface InventoryResponse {
  ok: boolean;
  kernel?: string;
  knowledge: KnowledgeDocumentRecord[];
  knowledgeFolders?: KnowledgeFolderRecord[];
  knowledgeLedgers?: Record<string, unknown>;
  memory: KnowledgeDocumentRecord[];
  artifacts: ArtifactRecord[];
  workingState: WorkingStateRecord;
  computerState: ComputerStateRecord;
  sessions: SessionRecord[];
  runs: RunRecord[];
  executions: ExecutionRecord[];
  skills: SkillRecord[];
  packs: Record<string, unknown>[];
  tools: Record<string, unknown>[];
  extensions?: ExtensionInventoryRecord;
  capabilities: Record<string, unknown>[];
}

export interface ExtensionInventoryRecord {
  scannedAt: string;
  workspaceRoot: string;
  items: ExtensionItemRecord[];
  deployments: ExtensionDeploymentRecord[];
  commandUsages: Record<string, unknown>[];
  summary: {
    itemCount?: number;
    deploymentCount?: number;
    enabledDeploymentCount?: number;
    byKind?: Record<string, number>;
    byKernel?: Record<string, number>;
    [key: string]: unknown;
  };
}

export interface ExtensionItemRecord {
  id: string;
  kind: string;
  name: string;
  title: string;
  description: string;
  enabled: boolean;
  managedByOpenGrove: boolean;
  readonly: boolean;
  system: boolean;
  source?: Record<string, unknown>;
  deployments: ExtensionDeploymentRecord[];
  permissions: Record<string, unknown>[];
  commandUsages: Record<string, unknown>[];
  childIds: string[];
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface ExtensionDeploymentRecord {
  id: string;
  itemId: string;
  kind: string;
  kernelId?: string;
  scope: string;
  status: string;
  enabled: boolean;
  managedByOpenGrove: boolean;
  readonly: boolean;
  system: boolean;
  sourcePath?: string;
  targetPath?: string;
  configPath?: string;
  configFormat?: string;
  markerPath?: string;
  reason?: string;
  command?: string;
  args?: string[];
  envKeys?: string[];
  metadata?: Record<string, unknown>;
}

export interface MountedAppFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  mimeType?: string;
  updatedAt?: string;
  children?: MountedAppFileEntry[];
}

export interface MountedAppRouteInfo {
  id: string;
  title: string;
  appRoot: string;
  workspaceRoot: string;
  workspaceKind?: string;
}

export interface MountedAppFilesResponse {
  ok: boolean;
  app: MountedAppRouteInfo;
  path: string;
  entries: MountedAppFileEntry[];
  truncated?: boolean;
  error?: string;
}

export interface MountedAppFileResponse {
  ok: boolean;
  app: MountedAppRouteInfo;
  file?: MountedAppFileEntry & {
    content?: string;
    contentTruncated?: boolean;
  };
  error?: string;
}

export interface MountedAppFileSystemResponse {
  ok: boolean;
  app: MountedAppRouteInfo;
  entry?: MountedAppFileEntry;
  deletedPath?: string;
  entries: MountedAppFileEntry[];
  truncated?: boolean;
  error?: string;
}

export interface ApprovalsResponse {
  ok: boolean;
  approvals: ApprovalRecord[];
}

export interface EventsResponse {
  ok: boolean;
  events: AgentEventRecord[];
}

export interface ContextRecordsResponse {
  ok: boolean;
  records: Record<string, unknown>[];
}

export interface KernelOption {
  id: KernelPreference;
  label: string;
  description?: string;
  available: boolean;
  active?: boolean;
  resolved?: string;
  reason?: string;
  installed?: boolean;
  binaryPath?: string;
  version?: string;
  configHome?: string;
  providerId?: string;
  providerLabel?: string;
  sources?: KernelKnowledgeSource[];
  installActions?: KernelInstallAction[];
  diagnostics?: Record<string, unknown>;
  notes?: string[];
}

export interface KernelKnowledgeSource {
  id: string;
  title: string;
  kind: string;
  scope: string;
  path?: string;
  exists?: boolean;
  readable?: boolean;
  writable?: boolean;
  native?: boolean;
  userVisible?: boolean;
  knowledgeLike?: boolean;
  enabledByDefault?: boolean;
  enabled?: boolean;
  syncMode?: string;
  description?: string;
  notes?: string[];
}

export interface KernelInstallAction {
  id: string;
  title: string;
  status?: string;
  command?: string[];
  cwd?: string;
  description?: string;
  requiresConfirmation?: boolean;
}

export interface ProviderHttpCaptureSettings {
  enabled: boolean;
  injected?: boolean;
  kernelId?: string;
  status?: string;
  proxyUrl: string;
  caCertPath: string;
  caCertExists: boolean;
  noProxy: string;
  nodeUseEnvProxy: boolean;
  running?: boolean;
  startedAt?: string;
  webUrl?: string;
  runDir?: string;
  summaryPath?: string;
  statePath?: string;
  upstreamProxy?: string;
  warning?: string;
}

export interface KernelProxySettings {
  enabled: boolean;
  injected?: boolean;
  proxyUrl: string;
  noProxy: string;
  nodeUseEnvProxy: boolean;
  environmentProxyUrl?: string;
  source?: string;
}

export interface InviteLandingSettings {
  baseUrl: string;
}

export interface MatrixSettings {
  enabled: boolean;
  homeserverUrl: string;
  userId: string;
  accessToken?: string;
  bindings?: Record<string, RemoteRoomBinding>;
}

export interface RemoteSettings {
  matrix: MatrixSettings;
}

export interface RemoteRoomBinding {
  provider: "matrix";
  accountId: string;
  remoteRoomId: string;
  homeserverUrl: string;
  title: string;
  createdAt: string;
  syncCursor?: string;
  enabled: boolean;
}

export type VoiceSttProviderId = "openai" | "groq" | "local-whisper" | "browser";

export interface VoiceSettings {
  stt: VoiceSttSettings;
  sttProviders?: VoiceSttProviderInfo[];
}

export interface VoiceSttSettings {
  provider: VoiceSttProviderId;
  language: string;
  openai: VoiceCloudSttProviderSettings;
  groq: VoiceCloudSttProviderSettings;
  localWhisper: VoiceLocalWhisperSettings;
  browser: VoiceBrowserSttSettings;
}

export interface VoiceCloudSttProviderSettings {
  model: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv: string;
}

export interface VoiceLocalWhisperSettings {
  model: string;
  command?: string;
  language: string;
}

export interface VoiceBrowserSttSettings {
  language: string;
}

export interface VoiceSttProviderInfo {
  id: VoiceSttProviderId;
  label: string;
  mode: "browser" | "recorded-upload" | "local-command";
  configured: boolean;
  defaultModel?: string;
  notes?: string[];
}

export interface VoiceTranscriptionResponse {
  ok: boolean;
  transcript?: string;
  language?: string;
  durationMs?: number;
  provider?: VoiceSttProviderId;
  model?: string;
  error?: string;
}

export type DeveloperSessionStatus =
  | "draft"
  | "context_ready"
  | "running"
  | "ready"
  | "accepted"
  | "reverted"
  | "blocked";

export type VisualAnnotationKind = "element" | "box" | "stroke" | "note" | "voice";
export type VisualAnnotationStatus = "pending" | "acknowledged" | "replied" | "resolved" | "dismissed";

export interface VisualAnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualAnnotationPoint {
  x: number;
  y: number;
}

export interface VisualAnnotationTarget {
  capture?: Record<string, unknown>;
  selector?: string;
  elementPath?: string;
  fullPath?: string;
  tagName?: string;
  text?: string;
  className?: string;
  cssClasses?: string[];
  ariaLabel?: string;
  role?: string;
  boundingBox?: VisualAnnotationRect;
  selectionRect?: VisualAnnotationRect;
  selectedText?: string;
  nearbyText?: string;
  nearbyElements?: Array<Record<string, unknown>>;
  computedStyles?: Record<string, unknown>;
  accessibility?: Record<string, unknown>;
  isFixed?: boolean;
  reactPath?: string;
  reactComponents?: string[];
  sourceHint?: string;
  sourceFile?: string;
  elementBoundingBoxes?: Array<Record<string, unknown>>;
}

export interface VisualAnnotation {
  id: string;
  kind: VisualAnnotationKind;
  status?: VisualAnnotationStatus;
  comment: string;
  transcript?: string;
  url: string;
  viewport: { width: number; height: number };
  rect?: VisualAnnotationRect;
  points?: VisualAnnotationPoint[];
  target?: VisualAnnotationTarget;
  thread?: VisualAnnotationThreadMessage[];
  resolvedAt?: string;
  resolvedBy?: "user" | "agent";
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualAnnotationThreadMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  createdAt: string;
}

export interface DeveloperSessionBoundaryCheck {
  status: "clean" | "warning" | "blocked";
  targetRoot: string;
  touchedFiles: Array<{
    path: string;
    insideTargetRoot: boolean;
    changeKind: "added" | "modified" | "deleted" | "renamed" | "unknown";
  }>;
  message?: string;
}

export interface DeveloperSessionRun {
  id: string;
  sessionId: string;
  threadId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";
  inputContextId: string;
  touchedFiles: string[];
  diffSummary?: string;
  boundaryCheck?: DeveloperSessionBoundaryCheck;
  startedAt: string;
  finishedAt?: string;
}

export interface DeveloperSessionCore {
  coreId: string;
  name: string;
  kernel: string;
  model: string;
}

export interface DeveloperSession {
  id: string;
  kind: "developer_session";
  title: string;
  description: string;
  threadId: string;
  targetRoot: string;
  targetUrl: string;
  core?: DeveloperSessionCore;
  status: DeveloperSessionStatus;
  preview: {
    status: "idle" | "loading" | "ready" | "error";
    lastLoadedAt?: string;
    error?: string;
  };
  annotations: VisualAnnotation[];
  runs: DeveloperSessionRun[];
  baseline?: Record<string, unknown>;
  latestRunId?: string;
  riskLevel?: "none" | "warning" | "blocked";
  createdAt: string;
  updatedAt: string;
}

export interface DeveloperSessionContextPacket {
  sessionId: string;
  kind: "developer_session";
  userIntent: string;
  target: {
    workspaceRoot: string;
    url: string;
    viewport?: { width: number; height: number };
  };
  core?: DeveloperSessionCore;
  inputs: Array<Record<string, unknown>>;
  constraints: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export interface DeveloperSessionsResponse {
  ok: boolean;
  sessions: DeveloperSession[];
  error?: string;
}

export interface DeveloperPreviewServiceResult {
  status: "restarted" | "unsupported" | "failed";
  message?: string;
  command?: string;
  args?: string[];
  ready?: boolean;
  pid?: number;
}

export interface DeveloperSessionResponse {
  ok: boolean;
  session?: DeveloperSession;
  context?: DeveloperSessionContextPacket;
  previewService?: DeveloperPreviewServiceResult;
  diffSummary?: string;
  boundaryCheck?: DeveloperSessionBoundaryCheck;
  error?: string;
}

export interface BridgeSettings {
  kernel: KernelPreference;
  workspaceRoot?: string;
  workspaceRootConfigured?: boolean;
  providerSetupVersion?: number;
  activeKernel: string;
  kernels: KernelOption[];
  providers?: ProviderProfile[];
  customProviders?: ProviderProfile[];
  mountedApps?: MountedAppSettings[];
  kernelProviderBindings?: Record<string, string>;
  providerBindings?: ProviderBinding[];
  kernelPathOverrides?: Record<string, KernelPathOverride>;
  kernelKnowledgeSourceEnabled?: Record<string, Record<string, boolean>>;
  kernelProxy: KernelProxySettings;
  inviteLanding?: InviteLandingSettings;
  remote?: RemoteSettings;
  voice?: VoiceSettings;
  providerHttpCapture: ProviderHttpCaptureSettings;
  codexRawEventCaptureEnabled?: boolean;
  settingsPath?: string;
}

export interface MountedAppSettings {
  id: string;
  path: string;
  enabled: boolean;
  title?: string;
}

export interface KernelPathOverride {
  binaryPath?: string;
  configHome?: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: string;
  custom?: boolean;
  deleted?: boolean;
  enabled?: boolean;
  origin?: string;
  sourceKernel?: string;
  source?: string;
  sourcePaths?: string[];
  authConfigured?: boolean;
  description?: string;
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  geminiBaseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  credentialKind?: "none" | "native-login" | "api-key" | "env-key" | "aws" | "google-adc" | "kernel-native";
  codexWireApi?: "chat" | "responses";
  models?: RuntimeControlOption[];
  recommendedFor?: string[];
  websiteUrl?: string;
}

export interface ProviderBinding {
  kernelId: string;
  providerId: string;
  enabled: boolean;
  mode: string;
  status?: string;
  notes?: string[];
}

export interface BridgeSettingsResponse {
  ok: boolean;
  restarted?: boolean;
  settings: BridgeSettings;
  error?: string;
}

export interface KernelInstallResponse {
  ok: boolean;
  kernelId?: string;
  actionId?: string;
  command?: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  settings?: BridgeSettings;
  error?: string;
}

export type KernelAuthStatus =
  | "authenticated"
  | "missing"
  | "checking"
  | "unconfirmed"
  | "unknown"
  | "error";

export interface KernelAuthState {
  kernelId: string;
  status: KernelAuthStatus;
  method: "env-token" | "stored-credential" | "terminal" | "none" | "unknown";
  loginAvailable: boolean;
  message?: string;
  startedAt?: string;
  deadlineAt?: string;
  lastCheckedAt?: string;
}

export interface KernelAuthResponse {
  ok: boolean;
  auth: KernelAuthState;
  error?: string;
}

export interface KernelAuthLoginResponse extends KernelAuthResponse {}

export interface WorkspaceDirectoryResponse {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface HealthResponse {
  ok: boolean;
  name: string;
  time: string;
  kernel?: string;
  settings?: BridgeSettings;
  capabilities?: BridgeCapabilities;
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  tokenRequired: boolean;
  error?: string;
}

export interface BridgeCapabilities {
  profile: "local" | "server" | "test";
  auth: string;
  multiUser: boolean;
  storage: string;
  blobStorage: string;
  kernelRuntime: string;
  workspaceScoped: boolean;
  approvals: boolean;
  api?: Record<string, unknown>;
  desktop?: Record<string, unknown>;
  features?: Record<string, unknown>;
}

export interface CapabilitiesResponse {
  ok: boolean;
  capabilities: BridgeCapabilities;
}

export interface AskFinalPayload {
  answer?: string;
  approvals?: ApprovalRecord[];
  knowledge?: KnowledgeDocumentRecord[];
  knowledgeFolders?: KnowledgeFolderRecord[];
  knowledgeLedgers?: Record<string, unknown>;
  memory?: KnowledgeDocumentRecord[];
  artifacts?: ArtifactRecord[];
  workingState?: WorkingStateRecord;
  computerState?: ComputerStateRecord;
  sessions?: SessionRecord[];
  runs?: RunRecord[];
  executions?: ExecutionRecord[];
  contextRecords?: Record<string, unknown>[];
  events?: AgentEventRecord[];
}

export function createClientId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function supportedModel(value: string): ModelId {
  return value?.trim() || MODEL_OPTIONS[0].id;
}

export function modelLabel(modelId: string): string {
  return MODEL_OPTIONS.find((model) => model.id === modelId)?.label ?? modelId;
}

export function supportedView(value: string): ViewId {
  if (value === "app" || value === "apps" || value === "mounted-app" || value === "user-app") {
    return "app";
  }
  if (value === "ops" || value === "ops-center" || value === "sessions" || value === "runs" || value === "activity" || value === "automation") {
    return "ops";
  }
  if (value === "extensions" || value === "extension-manager" || value === "skills" || value === "tools" || value === "mcp") {
    return "extensions";
  }
  if (
    value === "rooms"
    || value === "team"
    || value === "team-chat"
    || value === "collaboration"
    || value === "contacts"
    || value === "address-book"
    || value === "people"
  ) {
    return "rooms";
  }
  if (value === "library" || value === "object-studio" || value === "objects" || value === "inbox" || value === "artifacts") {
    return "library";
  }
  if (value === "settings" || value === "capability-settings" || value === "context" || value === "memory") {
    return "settings";
  }
  return "chat";
}

export function bridgeHeaders(includeContentType = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (includeContentType) {
    headers["content-type"] = "application/json";
  }
  const token = localStorage.getItem(APP_STORAGE_KEYS.bridgeToken);
  if (token) {
    headers[APP_BRIDGE_TOKEN_HEADER] = token;
  }
  return headers;
}

export async function readBridgeError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error ?? `request_failed:${response.status}`;
  } catch {
    return text || `request_failed:${response.status}`;
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    throw new Error(await readBridgeError(response));
  }
  return (await response.json()) as T;
}

export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function getJson<T>(path: string): Promise<T> {
  return fetchJson<T>(path, {
    method: "GET",
    headers: bridgeHeaders(false),
  });
}

export async function patchJson<T>(path: string, payload: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "PATCH",
    headers: bridgeHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function deleteJson<T>(path: string): Promise<T> {
  return fetchJson<T>(path, {
    method: "DELETE",
    headers: bridgeHeaders(false),
  });
}

export async function listDeveloperSessions(): Promise<DeveloperSessionsResponse> {
  return getJson<DeveloperSessionsResponse>("/developer/sessions");
}

export async function listMountedAppFiles(appId: string): Promise<MountedAppFilesResponse> {
  return getJson<MountedAppFilesResponse>(`/apps/${encodeURIComponent(appId)}/files`);
}

export async function getMountedAppFile(appId: string, path: string): Promise<MountedAppFileResponse> {
  const params = new URLSearchParams({ path });
  return getJson<MountedAppFileResponse>(`/apps/${encodeURIComponent(appId)}/file?${params.toString()}`);
}

export async function createMountedAppFileSystemEntry(appId: string, payload: {
  kind: "file" | "folder";
  parentPath: string;
  name: string;
  content?: string;
}): Promise<MountedAppFileSystemResponse> {
  return postJson<MountedAppFileSystemResponse>(`/apps/${encodeURIComponent(appId)}/file-system`, payload);
}

export async function moveMountedAppFileSystemEntry(appId: string, payload: {
  sourcePath: string;
  targetParentPath: string;
}): Promise<MountedAppFileSystemResponse> {
  return postJson<MountedAppFileSystemResponse>(`/apps/${encodeURIComponent(appId)}/file-system/move`, payload);
}

export async function renameMountedAppFileSystemEntry(appId: string, payload: {
  sourcePath: string;
  name: string;
}): Promise<MountedAppFileSystemResponse> {
  return postJson<MountedAppFileSystemResponse>(`/apps/${encodeURIComponent(appId)}/file-system/rename`, payload);
}

export async function deleteMountedAppFileSystemEntry(appId: string, payload: {
  sourcePath: string;
}): Promise<MountedAppFileSystemResponse> {
  return postJson<MountedAppFileSystemResponse>(`/apps/${encodeURIComponent(appId)}/file-system/delete`, payload);
}

export async function createDeveloperSession(payload: {
  title?: string;
  description: string;
  targetRoot: string;
  targetUrl: string;
  core?: DeveloperSessionCore;
  threadId?: string;
}): Promise<DeveloperSessionResponse> {
  return postJson<DeveloperSessionResponse>("/developer/sessions", payload);
}

export async function patchDeveloperSession(sessionId: string, payload: Partial<Pick<DeveloperSession,
  "title" | "description" | "targetRoot" | "targetUrl" | "core" | "status" | "preview" | "riskLevel"
>>): Promise<DeveloperSessionResponse> {
  return patchJson<DeveloperSessionResponse>(`/developer/sessions/${encodeURIComponent(sessionId)}`, payload);
}

export async function addDeveloperSessionAnnotation(sessionId: string, payload: {
  kind: VisualAnnotationKind;
  status?: VisualAnnotationStatus;
  comment?: string;
  transcript?: string;
  url?: string;
  viewport?: { width: number; height: number };
  rect?: VisualAnnotationRect;
  points?: VisualAnnotationPoint[];
  target?: VisualAnnotationTarget;
}): Promise<DeveloperSessionResponse> {
  return postJson<DeveloperSessionResponse>(`/developer/sessions/${encodeURIComponent(sessionId)}/annotations`, payload);
}

export async function patchDeveloperSessionAnnotation(sessionId: string, annotationId: string, payload: {
  comment?: string;
  status?: VisualAnnotationStatus;
  resolvedBy?: "user" | "agent";
}): Promise<DeveloperSessionResponse> {
  return patchJson<DeveloperSessionResponse>(
    `/developer/sessions/${encodeURIComponent(sessionId)}/annotations/${encodeURIComponent(annotationId)}`,
    payload,
  );
}

export async function addDeveloperSessionAnnotationThread(sessionId: string, annotationId: string, payload: {
  role?: "user" | "agent";
  content: string;
}): Promise<DeveloperSessionResponse> {
  return postJson<DeveloperSessionResponse>(
    `/developer/sessions/${encodeURIComponent(sessionId)}/annotations/${encodeURIComponent(annotationId)}/thread`,
    payload,
  );
}

export async function deleteDeveloperSessionAnnotation(sessionId: string, annotationId: string): Promise<DeveloperSessionResponse> {
  return deleteJson<DeveloperSessionResponse>(
    `/developer/sessions/${encodeURIComponent(sessionId)}/annotations/${encodeURIComponent(annotationId)}`,
  );
}

export async function restartDeveloperPreviewService(sessionId: string): Promise<DeveloperSessionResponse> {
  return postJson<DeveloperSessionResponse>(`/developer/sessions/${encodeURIComponent(sessionId)}/preview/restart`, {});
}

export async function transcribeVoiceAudio(payload: {
  audioBase64: string;
  mimeType?: string;
  filename?: string;
  language?: string;
  provider?: VoiceSttProviderId;
  sessionId?: string;
}): Promise<VoiceTranscriptionResponse> {
  return postJson<VoiceTranscriptionResponse>("/voice/transcriptions", payload);
}

export async function runAskStream(
  payload: {
    question: string;
    model: string;
    kernel?: string;
    effort?: ReasoningEffort;
    responseSpeed?: ResponseSpeed;
    accessMode?: RuntimeAccessMode;
    threadId: string;
    appId?: string;
    snapshot: unknown;
    computerSnapshot: unknown;
    allowMemory: boolean;
    saveCandidateNote: boolean;
    requestedSkill?: {
      name: string;
      args?: string;
    };
  },
  onChunk: (chunk: BridgeStreamChunk) => void,
  options: { signal?: AbortSignal } = {},
): Promise<AskFinalPayload> {
  const response = await fetch(apiUrl("/ask/stream"), {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  return readAskStreamResponse(response, onChunk);
}

export async function attachAskStream(
  query: { runId?: string; threadId?: string },
  onChunk: (chunk: BridgeStreamChunk) => void,
  options: { signal?: AbortSignal } = {},
): Promise<AskFinalPayload> {
  const params = new URLSearchParams();
  if (query.runId) params.set("runId", query.runId);
  if (query.threadId) params.set("threadId", query.threadId);
  const response = await fetch(apiUrl(`/ask/stream?${params.toString()}`), {
    method: "GET",
    headers: bridgeHeaders(),
    signal: options.signal,
  });
  return readAskStreamResponse(response, onChunk);
}

export async function cancelAskStream(query: { runId?: string; threadId?: string }): Promise<{ ok: boolean; cancelled: boolean }> {
  return postJson("/ask/cancel", query);
}

async function readAskStreamResponse(
  response: Response,
  onChunk: (chunk: BridgeStreamChunk) => void,
): Promise<AskFinalPayload> {
  if (!response.ok) {
    throw new Error(await readBridgeError(response));
  }
  if (!response.body) {
    throw new Error("stream_unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalData: AskFinalPayload | null = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const chunk = JSON.parse(line) as BridgeStreamChunk;
        onChunk(chunk);
        if (chunk.type === "final" && chunk.data && typeof chunk.data === "object") {
          finalData = chunk.data as AskFinalPayload;
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const chunk = JSON.parse(buffer.trim()) as BridgeStreamChunk;
    onChunk(chunk);
    if (chunk.type === "final" && chunk.data && typeof chunk.data === "object") {
      finalData = chunk.data as AskFinalPayload;
    }
  }

  if (!finalData) {
    throw new Error("stream_finished_without_final_payload");
  }
  return finalData;
}
