import type {
  AgentEvent,
  AgentTurnRequest,
  JsonObject,
  SandboxPolicy,
  ToolDefinition,
} from "../core.js";

export type KernelHealthStatus = "ok" | "degraded" | "unavailable";

export interface KernelHealth {
  status: KernelHealthStatus;
  message?: string;
  metadata?: JsonObject;
}

export interface KernelCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  hostTools: boolean;
  approvals: boolean;
  elicitation: boolean;
  artifacts: boolean;
  compaction: boolean;
  authRefresh: boolean;
  sandbox: SandboxPolicy[];
  knowledge?: KernelKnowledgeCapabilities;
  metadata?: JsonObject;
}

export interface KernelKnowledgeCapabilities {
  nativeSkills?: boolean;
  toolMediatedSkills?: boolean;
  progressiveDisclosure?: boolean;
  nativeArtifacts?: boolean;
  deliveryLedger?: boolean;
}

export type KernelHarnessOwner = "app" | "kernel" | "adapter" | "shared" | "unsupported";

export type KernelHarnessFeature =
  | "session"
  | "turn_lifecycle"
  | "model_loop"
  | "native_tool_execution"
  | "host_tool_execution"
  | "approval"
  | "user_question"
  | "skill_discovery"
  | "skill_loading"
  | "context_assembly"
  | "knowledge_retrieval"
  | "artifact_extraction"
  | "memory_write"
  | "compaction"
  | "auth"
  | "sandbox"
  | "transport"
  | "trajectory"
  | "diagnostics";

export interface KernelHarnessOwnershipRule {
  feature: KernelHarnessFeature;
  owner: KernelHarnessOwner;
  nativeName?: string;
  appResponsibility?: string;
  kernelResponsibility?: string;
  adapterResponsibility?: string;
  notes?: string;
}

export type KernelEventMappingDirection = "app_to_native" | "native_to_app" | "bidirectional";

export interface KernelEventMapping {
  appEvent: string;
  nativeEvent?: string;
  nativeRequest?: string;
  direction: KernelEventMappingDirection;
  adapterResponsibility: string;
  notes?: string;
}

export type KernelDiagnosticsCaptureLayer =
  | "adapter-rpc"
  | "process-stdio"
  | "native-transcript"
  | "provider-http"
  | "host-event-log"
  | "trajectory";

export type KernelDiagnosticsCaptureStatus = "implemented" | "planned" | "external";

export interface KernelDiagnosticsCaptureMode {
  id: string;
  title: string;
  layer: KernelDiagnosticsCaptureLayer;
  status: KernelDiagnosticsCaptureStatus;
  enabledByDefault?: boolean;
  output?: string;
  env?: string[];
  redaction?: "redacted" | "external" | "raw";
  notes?: string[];
}

export interface KernelDiagnosticsContract {
  defaultModeId?: string;
  modes: KernelDiagnosticsCaptureMode[];
  nativeTranscript?: {
    path?: string;
    availability: "available" | "partial" | "unavailable" | "unknown";
    notes?: string[];
  };
  notes?: string[];
}

export interface KernelAdapterContract {
  ownership: KernelHarnessOwnershipRule[];
  eventMappings?: KernelEventMapping[];
  diagnostics?: KernelDiagnosticsContract;
  notes?: string[];
}

export type KernelKnowledgeSourceKind =
  | "skills"
  | "commands"
  | "agents"
  | "memory"
  | "project_instructions"
  | "settings"
  | "config"
  | "auth"
  | "sessions"
  | "logs"
  | "plugins"
  | "mcp"
  | "toolsets"
  | "artifacts"
  | "references"
  | "vault"
  | "other";

export type KernelKnowledgeSourceScope =
  | "app"
  | "user"
  | "project"
  | "workspace"
  | "system"
  | "managed"
  | "external";

export type KernelKnowledgeSourceSyncMode = "none" | "index" | "mirror" | "publish";

export interface KernelKnowledgeSource {
  id: string;
  title: string;
  kind: KernelKnowledgeSourceKind;
  scope: KernelKnowledgeSourceScope;
  path?: string;
  exists?: boolean;
  readable?: boolean;
  writable?: boolean;
  native?: boolean;
  userVisible?: boolean;
  knowledgeLike?: boolean;
  enabledByDefault?: boolean;
  enabled?: boolean;
  syncMode?: KernelKnowledgeSourceSyncMode;
  description?: string;
  notes?: string[];
  metadata?: JsonObject;
}

export interface KernelInstallAction {
  id: string;
  title: string;
  status?: "available" | "planned" | "manual";
  command?: string[];
  cwd?: string;
  description?: string;
  requiresConfirmation?: boolean;
}

export interface KernelDiscovery {
  kernelId: string;
  title: string;
  installed: boolean;
  available: boolean;
  active?: boolean;
  binaryPath?: string;
  version?: string;
  configHome?: string;
  health?: KernelHealth;
  knowledgeSources: KernelKnowledgeSource[];
  installActions?: KernelInstallAction[];
  diagnostics?: KernelDiagnosticsContract;
  notes?: string[];
}

export interface AuthProfile {
  id: string;
  kernelId: string;
  title?: string;
  kind: "chatgpt-oauth" | "anthropic-api-key" | "openai-compatible" | "custom";
  data?: JsonObject;
  updatedAt?: string;
}

export interface KernelSessionStart {
  sessionId: string;
  cwd?: string;
  modelId?: string;
  sandbox?: SandboxPolicy;
  authProfile?: AuthProfile;
  tools?: ToolDefinition[];
  metadata?: JsonObject;
}

export interface KernelSessionHandle {
  kernelId: string;
  sessionId: string;
  nativeSessionId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: JsonObject;
}

export interface KernelTurnRequest extends AgentTurnRequest {
  kernelSession?: KernelSessionHandle;
  authProfile?: AuthProfile;
  metadata?: JsonObject;
}

export interface CompactOptions {
  reason?: string;
  maxTokens?: number;
  metadata?: JsonObject;
}

export interface AuthRefreshResult {
  ok: boolean;
  profile?: AuthProfile;
  message?: string;
}

export type KernelEvent = AgentEvent;

export interface KernelAdapter {
  id: string;
  title: string;
  capabilities: KernelCapabilities;
  contract: KernelAdapterContract;

  healthCheck(): Promise<KernelHealth>;
  discover?(): Promise<KernelDiscovery>;
  startSession(input: KernelSessionStart): Promise<KernelSessionHandle>;
  resumeSession(sessionId: string): Promise<KernelSessionHandle>;
  runTurn(request: KernelTurnRequest): AsyncIterable<KernelEvent>;

  interrupt?(sessionId: string): Promise<void>;
  compact?(sessionId: string, options?: CompactOptions): Promise<void>;
  refreshAuth?(profile: AuthProfile): Promise<AuthRefreshResult>;
  dispose?(): Promise<void>;
}
