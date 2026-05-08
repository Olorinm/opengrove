import type {
  ApprovalInbox,
  ArtifactStore,
  ExecutionStore,
  MemoryLedger,
  SessionStore,
  WorkingStateStore,
} from "./stores.js";
import type { PackRegistry } from "./registries.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ActivitySpace = "browser" | "chat" | "local" | "api" | "computer";
export type ToolRisk = "read" | "write" | "send" | "spend" | "delete";
export type PermissionMode = "allow" | "ask" | "deny";
export type MemoryScope = "user" | "workspace" | "page" | "session";
export type MemoryConfidence = "asserted" | "observed" | "inferred";
export type MemoryWriteMode = "direct" | "propose" | "ask";
export type SandboxPolicy = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type RuntimeAccessMode = "default" | "auto-review" | "full-access";
export type ResponseSpeed = "standard" | "fast";

export interface SourceRef {
  title?: string;
  url?: string;
  locator?: string;
  quote?: string;
}

export type ContextItemKind =
  | "page"
  | "selection"
  | "attachment"
  | "computer"
  | "artifact"
  | "session"
  | "execution"
  | "task"
  | "knowledge"
  | "memory"
  | "routine"
  | "permission"
  | "skill";

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  title: string;
  text: string;
  source?: SourceRef;
  score?: number;
  data?: JsonObject;
}

export interface ContextBudget {
  maxItems: number;
  usedItems: number;
  maxCharacters: number;
  usedCharacters: number;
  truncated: boolean;
}

export interface ContextEnvelope {
  id: string;
  createdAt: string;
  summary: string;
  items: ContextItem[];
  budget: ContextBudget;
  promptBlock: string;
}

export interface SchemaSpec {
  type: "json-schema";
  schema: JsonObject;
}

export interface ArtifactAsset {
  kind: "image" | "audio" | "video" | "file" | "url" | "text";
  uri?: string;
  path?: string;
  title?: string;
  mimeType?: string;
  metadata?: JsonObject;
}

export interface ArtifactPreview {
  title?: string;
  text?: string;
  imageUri?: string;
  mimeType?: string;
  status?: string;
}

export interface PermissionRequirement {
  mode: PermissionMode;
  reason: string;
}

export interface ToolSpec {
  id: string;
  title: string;
  description: string;
  activity: ActivitySpace;
  risk: ToolRisk;
  input: SchemaSpec;
  output?: SchemaSpec;
  permission: PermissionRequirement;
}

export interface PolicyRule {
  id?: string;
  toolId?: string;
  capabilityId?: string;
  risk?: ToolRisk;
  mode: PermissionMode;
  reason: string;
}

export interface PolicyDecision {
  mode: PermissionMode;
  reason: string;
  matchedRuleId?: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ModelToolCall {
  id: string;
  toolId: string;
  input: JsonValue;
}

export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}

export type ModelEvent =
  | { type: "model.delta"; text: string }
  | { type: "model.tool_call"; call: ModelToolCall }
  | { type: "model.done"; usage?: UsageStats }
  | { type: "model.error"; message: string };

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools?: ToolSpec[];
  output?: SchemaSpec;
  metadata?: JsonObject;
}

export interface AgentSessionTrace {
  provider: string;
  sessionId: string;
  persistent: boolean;
  priorMessageCount: number;
  priorMessages: ModelMessage[];
  retainedMessageLimit?: number;
}

export interface AgentModelRequestTrace {
  systemPrompt: string;
  userInput: string;
  modelId?: string;
  session?: AgentSessionTrace;
  messages?: ModelMessage[];
  context?: ContextEnvelope;
  tools: ToolSpec[];
  skills: SkillManifest[];
  packs: PackManifest[];
  capabilities: CapabilityManifest[];
}

export interface AgentModelResponseTrace {
  text: string;
  usage?: UsageStats;
}

export interface ModelAdapter {
  id: string;
  request(input: ModelRequest): AsyncIterable<ModelEvent>;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalKind =
  | "tool"
  | "command"
  | "file_change"
  | "permission_scope"
  | "user_input"
  | "routine_step"
  | "memory_write"
  | "browser_action"
  | "computer_action";

export type ApprovalResume =
  | { type: "tool"; runId?: string }
  | { type: "routine.step"; routineId: string; stepId: string; runId: string }
  | { type: "codex.native"; runId: string };

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  toolId?: string;
  capabilityId?: string;
  skillId?: string;
  input?: JsonValue;
  response?: JsonValue;
  resume?: ApprovalResume;
}

export interface ToolResult<TOutput extends JsonValue = JsonValue> {
  ok: boolean;
  value?: TOutput;
  error?: string;
  sources?: SourceRef[];
}

export interface ToolCallContext {
  runId: string;
  capabilityId?: string;
  skillId?: string;
  memory: MemoryLedger;
  artifacts: ArtifactStore;
  workingState: WorkingStateStore;
  approvals: ApprovalInbox;
  skills: SkillCatalog;
  packs: PackRegistry;
  policy: PolicyDecision;
}

export interface ToolDefinition<
  TInput extends JsonValue = JsonObject,
  TOutput extends JsonValue = JsonValue,
> {
  spec: ToolSpec;
  execute(input: TInput, context: ToolCallContext): Promise<ToolResult<TOutput>>;
}

export interface MemorySource {
  kind: "user" | "agent" | "tool" | "skill";
  ref?: SourceRef;
}

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  kind: string;
  text: string;
  confidence: MemoryConfidence;
  source: MemorySource;
  tags: string[];
  data?: JsonObject;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface MemoryWriteRequest {
  id?: string;
  scope: MemoryScope;
  kind: string;
  text: string;
  confidence: MemoryConfidence;
  source: MemorySource;
  tags?: string[];
  data?: JsonObject;
  expiresAt?: string;
}

export interface MemoryFilter {
  scope?: MemoryScope;
  kind?: string;
  tags?: string[];
  limit?: number;
}

export interface MemoryHook {
  kind: string;
  mode: MemoryWriteMode;
  reason: string;
}

export type SkillSource = "bundled" | "project" | "user" | "pack";
export type SkillTrust = "trusted" | "untrusted";
export type SkillExecutionContext = "inline" | "fork";

export interface SkillManifest {
  id: string;
  name: string;
  title: string;
  description: string;
  whenToUse?: string;
  format: "markdown-v1" | "markdown-v2";
  entry: string;
  skillRoot: string;
  activities: ActivitySpace[];
  toolIds: string[];
  memoryHooks: MemoryHook[];
  allowedTools: string[];
  argumentHint?: string;
  arguments?: string[];
  userInvocable: boolean;
  disableModelInvocation: boolean;
  model?: string;
  effort?: string;
  context: SkillExecutionContext;
  shell?: string[];
  paths?: string[];
  hooks?: JsonObject;
  source: SkillSource;
  trust: SkillTrust;
  packId?: string;
  capabilityId?: string;
  contentLength?: number;
  tags?: string[];
}

export interface LoadedSkill {
  manifest: SkillManifest;
  content: string;
  sourcePath: string;
  args?: string;
}

export interface SkillCatalog {
  list(): SkillManifest[];
  get(idOrName: string): SkillManifest | undefined;
  resolve(name: string, options?: { includeDisabled?: boolean }): SkillManifest | undefined;
  load(name: string, args: string | undefined, sessionId: string): LoadedSkill;
}

export interface InvokedSkillRecord {
  skillId: string;
  skillName: string;
  title: string;
  content: string;
  contentPreview: string;
  sourcePath: string;
  source: SkillSource;
  trust: SkillTrust;
  context: SkillExecutionContext;
  args?: string;
  allowedTools: string[];
  model?: string;
  effort?: string;
  packId?: string;
  capabilityId?: string;
  invokedAt: string;
  origin: "user" | "model";
}

export interface EvalCase {
  id: string;
  description: string;
  input: string;
  expectedBehavior: string;
}

export interface CapabilitySource {
  kind: "native" | "wrapped-open-source" | "mcp" | "external-api" | "user-routine";
  project?: string;
  url?: string;
  license?: string;
}

export interface CapabilityManifest {
  id: string;
  title: string;
  version: string;
  description: string;
  source?: CapabilitySource;
  activities: ActivitySpace[];
  triggers?: JsonObject[];
  tools: ToolSpec[];
  skills: SkillManifest[];
  memoryHooks: MemoryHook[];
  policy: PolicyRule[];
  sandbox?: SandboxPolicy;
  evals?: EvalCase[];
}

export interface PackManifest {
  id: string;
  title: string;
  description: string;
  source: SkillSource;
  trust: SkillTrust;
  rootDir: string;
  skillIds: string[];
  toolIds: string[];
  capabilityIds: string[];
  artifactTypes: string[];
  referenceAssetDirs?: string[];
  tags?: string[];
}

export type RoutineStatus = "draft" | "active" | "paused" | "needs_repair" | "archived";
export type RoutineTrigger = "manual" | "schedule" | "event";

export interface RoutineStep {
  id: string;
  title: string;
  toolId?: string;
  capabilityId?: string;
  skillId?: string;
  input?: JsonValue;
  approval?: PermissionRequirement;
}

export interface RoutineRunSummary {
  id: string;
  routineId: string;
  status: "running" | "succeeded" | "failed" | "paused_for_approval";
  startedAt: string;
  endedAt?: string;
  eventCount: number;
  error?: string;
}

export interface Routine {
  id: string;
  title: string;
  description?: string;
  status: RoutineStatus;
  trigger: RoutineTrigger;
  capabilityIds: string[];
  steps: RoutineStep[];
  approvalRules: PolicyRule[];
  createdAt: string;
  updatedAt: string;
  lastRun?: RoutineRunSummary;
}

export interface ArtifactRecord {
  id: string;
  type: string;
  title?: string;
  status?: string;
  version?: number;
  tags: string[];
  data: JsonObject;
  assets?: ArtifactAsset[];
  preview?: ArtifactPreview;
  createdAt: string;
  updatedAt: string;
  sourceRefs?: SourceRef[];
  parentId?: string;
  variantOf?: string;
  derivedFrom?: string[];
  lineage?: string[];
  provenance?: JsonObject;
}

export interface ArtifactCreateRequest {
  id?: string;
  type: string;
  title?: string;
  status?: string;
  version?: number;
  tags?: string[];
  data?: JsonObject;
  assets?: ArtifactAsset[];
  preview?: ArtifactPreview;
  sourceRefs?: SourceRef[];
  parentId?: string;
  variantOf?: string;
  derivedFrom?: string[];
  lineage?: string[];
  provenance?: JsonObject;
}

export interface ArtifactFilter {
  ids?: string[];
  type?: string;
  tags?: string[];
  parentId?: string;
  limit?: number;
}

export type SessionStatus = "active" | "idle" | "archived";
export type RunStatus = "running" | "waiting_for_approval" | "succeeded" | "failed";

export interface SessionRecord {
  id: string;
  title?: string;
  activity?: ActivitySpace;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  activeRunId?: string;
  latestRunId?: string;
  runIds: string[];
  lastUserInput?: string;
  metadata?: JsonObject;
}

export interface RunRecord {
  id: string;
  sessionId: string;
  activity: ActivitySpace;
  status: RunStatus;
  input: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  endedAt?: string;
  modelId?: string;
  summary?: string;
  error?: string;
  pausedAt?: string;
  resumedAt?: string;
  pauseReason?: string;
  lastApprovalId?: string;
  resumeCount: number;
  approvalIds: string[];
  toolIds: string[];
  eventCount: number;
}

export interface SessionFilter {
  ids?: string[];
  status?: SessionStatus;
  activity?: ActivitySpace;
  limit?: number;
}

export interface RunFilter {
  ids?: string[];
  sessionId?: string;
  status?: RunStatus;
  limit?: number;
}

export type ExecutionKind = "loop" | "model" | "tool_call" | "approval" | "artifact" | "memory" | "error";

export interface ExecutionRecord {
  id: string;
  runId: string;
  sessionId?: string;
  kind: ExecutionKind;
  eventType: AgentEvent["type"];
  title: string;
  at: string;
  status?: string;
  toolId?: string;
  approvalId?: string;
  artifactId?: string;
  data?: JsonObject;
}

export interface ExecutionFilter {
  sessionId?: string;
  runId?: string;
  kind?: ExecutionKind;
  limit?: number;
}

export interface WorkingStateRecord {
  sessionId?: string;
  taskSummary?: string;
  activeGoal?: string;
  selectedModel?: string;
  activePackId?: string;
  activeSkillId?: string;
  pinnedArtifactIds: string[];
  workingArtifactIds: string[];
  pendingApprovalIds: string[];
  activeToolCallIds: string[];
  discoveredSkillIds: string[];
  discoveredSkillNames: string[];
  expandedSkillIds: string[];
  invokedSkills: InvokedSkillRecord[];
  loadedNestedMemoryPaths: string[];
  toolSchemaCache: Record<string, string>;
  updatedAt: string;
}

export interface AgentPageContext {
  url?: string;
  title?: string;
  selection?: string;
  visibleText?: string;
  locator?: string;
  vaultFile?: AgentVaultFileContext;
  attachments?: AgentAttachmentContext[];
}

export interface AgentVaultFileContext {
  knowledgeId?: string;
  vaultPath?: string;
  filePath?: string;
}

export interface AgentAttachmentContext {
  id?: string;
  name: string;
  kind: "image" | "text" | "file";
  mimeType?: string;
  size?: number;
  text?: string;
  dataUrl?: string;
  localPath?: string;
}

export interface AgentComputerElementContext {
  id?: string;
  role?: string;
  name?: string;
  value?: string;
  description?: string;
}

export interface AgentComputerContext {
  app?: string;
  windowTitle?: string;
  url?: string;
  focusedElement?: string;
  observation?: string;
  accessibilityTree?: string;
  screenshotArtifactId?: string;
  observedAt?: string;
  elements?: AgentComputerElementContext[];
}

export interface AgentContext {
  sessionId: string;
  activity: ActivitySpace;
  memory: MemoryLedger;
  artifacts: ArtifactStore;
  skills: SkillCatalog;
  packs: PackRegistry;
  sessions: SessionStore;
  executions: ExecutionStore;
  workingState: WorkingStateStore;
  approvals: ApprovalInbox;
  userId?: string;
  page?: AgentPageContext;
  computer?: AgentComputerContext;
}

export interface AgentTurnRequest {
  input: string;
  context: AgentContext;
  tools: ToolDefinition[];
  runId?: string;
  assembledContext?: ContextEnvelope;
  requestedModelId?: string;
  requestedEffort?: string;
  responseSpeed?: ResponseSpeed;
  accessMode?: RuntimeAccessMode;
  requestedSkillInvocation?: InvokedSkillRecord;
  signal?: AbortSignal;
  skills?: SkillManifest[];
  packs?: PackManifest[];
  capabilities?: CapabilityManifest[];
  policy?: PolicyRule[];
}

export type AgentEvent =
  | { type: "turn.started"; runId: string; at: string }
  | { type: "context.assembled"; runId: string; context: ContextEnvelope }
  | {
      type: "compaction.started";
      runId: string;
      at: string;
      reason?: string;
      item?: JsonValue;
    }
  | {
      type: "compaction.finished";
      runId: string;
      at: string;
      summary?: string;
      item?: JsonValue;
    }
  | { type: "model.requested"; runId: string; request: AgentModelRequestTrace }
  | { type: "model.response"; runId: string; response: AgentModelResponseTrace }
  | { type: "runtime.diagnostic"; runId: string; at: string; name: string; data: JsonObject }
  | { type: "assistant.delta"; runId: string; text: string }
  | { type: "skill.discovered"; runId: string; skills: SkillManifest[] }
  | { type: "skill.invoked"; runId: string; skill: SkillManifest; invocation: InvokedSkillRecord }
  | {
      type: "skill.loaded";
      runId: string;
      skillId: string;
      contentPreview: string;
      allowedTools: string[];
      model?: string;
      effort?: string;
      context: SkillExecutionContext;
    }
  | {
      type: "skill.forked";
      runId: string;
      skillId: string;
      forkSessionId: string;
      status: "started" | "finished";
      result?: string;
    }
  | { type: "skill.cleared"; runId: string; skillId?: string; reason: string }
  | { type: "tool.started"; runId: string; toolId: string; input: JsonValue }
  | { type: "tool.finished"; runId: string; toolId: string; result: ToolResult }
  | { type: "approval.requested"; runId: string; request: ApprovalRequest }
  | { type: "approval.resolved"; runId: string; request: ApprovalRequest }
  | { type: "run.paused"; runId: string; at: string; reason: string; approvalId?: string }
  | { type: "run.resumed"; runId: string; at: string; reason?: string; approvalId?: string }
  | { type: "memory.written"; runId: string; record: MemoryRecord }
  | { type: "turn.finished"; runId: string; at: string }
  | { type: "error"; runId: string; message: string };

export interface AgentRuntime {
  runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent>;
}
