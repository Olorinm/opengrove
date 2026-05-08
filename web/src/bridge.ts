import type { BridgeStreamChunk } from "./runtime/agent-events";
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
  | "opencode";
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
  capabilities: Record<string, unknown>[];
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
  warning?: string;
}

export interface BridgeSettings {
  kernel: KernelPreference;
  activeKernel: string;
  kernels: KernelOption[];
  providers?: ProviderProfile[];
  customProviders?: ProviderProfile[];
  kernelProviderBindings?: Record<string, string>;
  providerBindings?: ProviderBinding[];
  kernelKnowledgeSourceEnabled?: Record<string, Record<string, boolean>>;
  providerHttpCapture: ProviderHttpCaptureSettings;
  settingsPath?: string;
}

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: string;
  custom?: boolean;
  description?: string;
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  geminiBaseUrl?: string;
  apiKeyEnv?: string;
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

export interface HealthResponse {
  ok: boolean;
  name: string;
  time: string;
  kernel?: string;
  settings?: BridgeSettings;
  runtimeControls?: RuntimeControls;
  tokenRequired: boolean;
  error?: string;
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
  if (value === "library" || value === "inbox" || value === "artifacts") {
    return "library";
  }
  if (value === "settings" || value === "context" || value === "memory" || value === "skills" || value === "tools") {
    return "settings";
  }
  return "chat";
}

export function viewTitle(view: ViewId): string {
  return (
    {
      chat: "新线程",
      library: "资料库",
      settings: "设置",
    }[view] ?? "新线程"
  );
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
  const response = await fetch(path, init);
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

export async function patchJson<T>(path: string, payload: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "PATCH",
    headers: bridgeHeaders(),
    body: JSON.stringify(payload),
  });
}

export async function runAskStream(
  payload: {
    question: string;
    model: string;
    effort?: ReasoningEffort;
    responseSpeed?: ResponseSpeed;
    accessMode?: RuntimeAccessMode;
    threadId: string;
    snapshot: unknown;
    computerSnapshot: unknown;
    allowMemory: boolean;
    saveCandidateNote: boolean;
  },
  onChunk: (chunk: BridgeStreamChunk) => void,
  options: { signal?: AbortSignal } = {},
): Promise<AskFinalPayload> {
  const response = await fetch("/ask/stream", {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify(payload),
    signal: options.signal,
  });
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
