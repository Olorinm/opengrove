import type { OpenGroveApp } from "../app/create-opengrove.js";
import type {
  AgentEvent,
  AgentSessionTrace,
  CapabilityManifest,
  ContextEnvelope,
  ExecutionRecord,
  JsonObject,
  MemoryRecord,
  ModelMessage,
  PackManifest,
  PolicyRule,
  ResponseSpeed,
  RunRecord,
  RuntimeAccessMode,
  SessionRecord,
  SkillManifest,
  ToolSpec,
  WorkingStateRecord,
  ArtifactRecord,
  ApprovalRequest,
} from "../core.js";
import type { JsonStateStore } from "../storage/json-state-store.js";
import type { KernelAdapter } from "../kernel/types.js";
import type { KnowledgeDocument, KnowledgeLedgerSnapshot } from "../knowledge/types.js";
import type { BrowserPageSnapshot } from "../environment/browser-adapter.js";
import type { ComputerStateSnapshot } from "../environment/computer-adapter.js";

export const BRIDGE_MODEL_IDS = [
  "MiMo-V2-Pro",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
  "claude-opus-4-6",
] as const;
export type BridgeKnownModelId = (typeof BRIDGE_MODEL_IDS)[number];
export type BridgeModelId = string;
export const DEFAULT_BRIDGE_MODEL_ID: BridgeKnownModelId = "MiMo-V2-Pro";

export const BRIDGE_KERNEL_IDS = [
  "codex",
  "claude-code",
  "hermes",
  "pi",
  "openclaw",
  "deepseek-tui",
  "gemini-cli",
  "qwen-code",
  "opencode",
] as const;
export type BridgeKernelId = (typeof BRIDGE_KERNEL_IDS)[number];
export type BridgeKernelPreference = BridgeKernelId | "auto";

export type BridgeProviderProtocol =
  | "native-oauth"
  | "openai-compatible"
  | "anthropic-compatible"
  | "gemini-compatible"
  | "custom-gateway";

export type BridgeProviderCredentialKind =
  | "none"
  | "native-login"
  | "api-key"
  | "env-key"
  | "aws"
  | "google-adc"
  | "kernel-native";

export interface BridgeProviderProfile {
  id: string;
  name: string;
  protocol: BridgeProviderProtocol;
  custom?: boolean;
  deleted?: boolean;
  enabled?: boolean;
  origin?: "builtin" | "discovered" | "user";
  sourceKernel?: BridgeKernelId;
  source?: string;
  sourcePaths?: string[];
  authConfigured?: boolean;
  description?: string;
  openaiBaseUrl?: string;
  anthropicBaseUrl?: string;
  geminiBaseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  credentialKind?: BridgeProviderCredentialKind;
  codexWireApi?: "chat" | "responses";
  models: BridgeRuntimeControlOption[];
  recommendedFor?: BridgeKernelId[];
  websiteUrl?: string;
}

export interface BridgeKernelProviderBinding {
  kernelId: BridgeKernelId;
  providerId: string;
  enabled: boolean;
  mode: "env" | "config-file" | "cli-flag" | "native-api";
  status?: "ready" | "missing-key" | "unsupported" | "not-configured";
  notes?: string[];
}

export interface BridgeRuntimeControlOption {
  id: string;
  label: string;
  description?: string;
}

export interface BridgeRuntimeControls {
  kernel: BridgeKernelId;
  source: string;
  models: BridgeRuntimeControlOption[];
  defaultModel?: string;
  reasoningEfforts: BridgeRuntimeControlOption[];
  defaultReasoningEffort?: string;
  speedTiers: BridgeRuntimeControlOption[];
  defaultSpeedTier?: string;
}

export const KNOWLEDGE_INVENTORY_LIMIT = 400;
export const KNOWLEDGE_FILE_SIZE_LIMIT = 2_000_000;
export const GENERATED_ASSET_ROUTE = "/generated/";
export const VAULT_FILE_ROUTE = "/vault-file/";

export const MAX_CONTEXT_RECORDS = 8;
export const MAX_CONTEXT_RECORD_STRING = 2_000;
export const MAX_CONTEXT_RECORD_ARRAY_ITEMS = 12;
export const MAX_CONTEXT_RECORD_OBJECT_KEYS = 60;

export interface LocalBridgeServerOptions {
  host?: string;
  port?: number;
  statePath?: string;
  bridgeToken?: string;
  allowedOrigins?: string[];
}

export interface BridgeAskPayload {
  question: string;
  model: BridgeModelId;
  kernel?: BridgeKernelId;
  effort?: string;
  responseSpeed?: ResponseSpeed;
  accessMode?: RuntimeAccessMode;
  threadId: string;
  snapshot: BrowserPageSnapshot;
  computerSnapshot: ComputerStateSnapshot;
  allowMemory: boolean;
  saveCandidateNote: boolean;
  requestedSkill?: {
    name: string;
    args?: string;
  };
}

export interface BridgeContextRecord {
  runId: string;
  startedAt?: string;
  finishedAt?: string;
  modelId?: string;
  session?: AgentSessionTrace;
  messages: ModelMessage[];
  userInput: string;
  systemPrompt: string;
  context?: ContextEnvelope;
  tools: ToolSpec[];
  skills: SkillManifest[];
  packs: PackManifest[];
  capabilities: CapabilityManifest[];
  responseText: string;
  toolEvents: AgentEvent[];
  events: AgentEvent[];
  providerHttpCapture?: BridgeProviderHttpCaptureDiagnostics;
}

export interface BridgeProviderHttpCaptureDiagnostics {
  enabled: boolean;
  injected?: boolean;
  kernelId?: string;
  status?: string;
  running?: boolean;
  startedAt?: string;
  runDir?: string;
  summaryPath?: string;
  webUrl?: string;
  warning?: string;
  flowCount: number;
  matchedFlowCount: number;
  flows: BridgeProviderHttpCaptureFlow[];
}

export interface BridgeProviderHttpCaptureFlow {
  kind?: "http" | "websocket_message" | "websocket_end";
  flowId: string;
  connectionFlowId?: string;
  startedAt: string;
  durationMs?: number;
  request: {
    method: string;
    host: string;
    path: string;
    url: string;
    bodyBytes?: number;
    bodyPath?: string;
    bodyPreview?: string;
    bodyPreviewTruncated?: boolean;
  };
  websocket?: {
    direction?: string;
    opcode?: string;
    isText?: boolean;
    bodyBytes?: number;
    bodyPath?: string;
    messageIndex?: number;
    messageCount?: number;
    closeCode?: number;
    closeReason?: string;
    bodyPreview?: string;
    bodyPreviewTruncated?: boolean;
  };
  response: {
    statusCode?: number;
    reason?: string;
    bodyBytes?: number;
    bodyPath?: string;
    bodyPreview?: string;
    bodyPreviewTruncated?: boolean;
  };
}

export interface BridgeSettings {
  kernel: BridgeKernelPreference;
  workspaceRoot?: string;
  providerSetupVersion?: number;
  providerHttpCaptureEnabled: boolean;
  codexRawEventCaptureEnabled: boolean;
  kernelProxy: BridgeKernelProxySettings;
  kernelPathOverrides: Record<string, BridgeKernelPathOverride>;
  kernelKnowledgeSourceEnabled: Record<string, Record<string, boolean>>;
  kernelProviderBindings: Record<string, string>;
  customProviders: BridgeProviderProfile[];
}

export interface BridgeKernelPathOverride {
  binaryPath?: string;
  configHome?: string;
}

export interface BridgeKernelProxySettings {
  enabled: boolean;
  proxyUrl: string;
  noProxy: string;
  nodeUseEnvProxy: boolean;
}

export interface BridgeState {
  app: OpenGroveApp;
  store: JsonStateStore;
  snapshot: BrowserPageSnapshot;
  computerSnapshot: ComputerStateSnapshot;
  model: BridgeModelId;
  kernel: BridgeKernelId;
  settings: BridgeSettings;
  saveCandidateNote: boolean;
  policyOverrides: PolicyRule[];
}

export interface BridgeAskResult {
  ok: true;
  answer: string;
  approvals: ApprovalRequest[];
  events: AgentEvent[];
  memory: MemoryRecord[];
  knowledge: KnowledgeDocument[];
  knowledgeLedgers: KnowledgeLedgerSnapshot;
  artifacts: ArtifactRecord[];
  workingState: WorkingStateRecord;
  computerState: ComputerStateSnapshot;
  sessions: SessionRecord[];
  runs: RunRecord[];
  executions: ExecutionRecord[];
  contextRecords: BridgeContextRecord[];
}

export interface BridgeKernelResolution {
  kernel: BridgeKernelId;
  adapter: KernelAdapter;
}

export type BridgeJsonObject = JsonObject;
