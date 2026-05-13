import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readAppEnv } from "../identity.js";
import type {
  AgentEvent,
  ApprovalRequest,
  ArtifactRecord,
  ExecutionRecord,
  MemoryRecord,
  RunRecord,
  Routine,
  SessionRecord,
  WorkingStateRecord,
} from "../core.js";
import type {
  KnowledgeDeliveryRecord,
  KnowledgeDocument,
  KnowledgeEvidenceRecord,
  KnowledgeFeedbackEvent,
  KnowledgeRevision,
} from "../knowledge/types.js";
import type { RoomChannelSnapshot } from "../rooms/channel-store.js";

export interface PersistedAgentState {
  version: 8;
  savedAt: string;
  knowledge: KnowledgeDocument[];
  knowledgeEvidence: KnowledgeEvidenceRecord[];
  knowledgeRevisions: KnowledgeRevision[];
  knowledgeDeliveries: KnowledgeDeliveryRecord[];
  knowledgeFeedback: KnowledgeFeedbackEvent[];
  memory: MemoryRecord[];
  artifacts: ArtifactRecord[];
  workingState: WorkingStateRecord;
  approvals: ApprovalRequest[];
  events: AgentEvent[];
  routines: Routine[];
  sessions: SessionRecord[];
  runs: RunRecord[];
  executions: ExecutionRecord[];
  rooms: RoomChannelSnapshot;
}

export interface AgentStateStore {
  readonly path: string;
  readonly kind: "json" | "postgres" | "memory";
  loadInto(app: PersistableAgentStatePorts): PersistedAgentState | undefined;
  saveFrom(app: PersistableAgentStatePorts): PersistedAgentState;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export type JsonStateStore = AgentStateStore & { readonly kind: "json" };

export interface PersistableAgentStatePorts {
  knowledge: {
    restore(documents: KnowledgeDocument[]): void;
    restoreLedgers(snapshot: {
      evidence?: KnowledgeEvidenceRecord[];
      revisions?: KnowledgeRevision[];
      deliveries?: KnowledgeDeliveryRecord[];
      feedback?: KnowledgeFeedbackEvent[];
    }): void;
    snapshot(): KnowledgeDocument[];
    listEvidence(): KnowledgeEvidenceRecord[];
    listRevisions(): KnowledgeRevision[];
    listDeliveries(): KnowledgeDeliveryRecord[];
    listFeedback(): KnowledgeFeedbackEvent[];
  };
  memory: {
    restore(records: MemoryRecord[]): void;
    list(): MemoryRecord[];
  };
  artifacts: {
    restore(records: ArtifactRecord[]): void;
    list(): ArtifactRecord[];
  };
  workingState: {
    restore(snapshot: WorkingStateRecord): void;
    get(): WorkingStateRecord;
  };
  approvals: {
    restore(requests: ApprovalRequest[]): void;
    list(): ApprovalRequest[];
  };
  events: {
    restore(events: AgentEvent[]): void;
    list(): AgentEvent[];
  };
  routines: {
    restore(routines: Routine[]): void;
    list(): Routine[];
  };
  sessions: {
    restore(snapshot: { sessions?: SessionRecord[]; runs?: RunRecord[] }): void;
    list(): SessionRecord[];
    listRuns(): RunRecord[];
  };
  executions: {
    restore(records: ExecutionRecord[]): void;
    list(): ExecutionRecord[];
  };
  rooms: {
    restore(snapshot: RoomChannelSnapshot | undefined): void;
    snapshot(): RoomChannelSnapshot;
  };
}

export function createJsonStateStore(path = defaultStatePath()): JsonStateStore {
  const resolved = resolve(path);

  return {
    path: resolved,
    kind: "json",
    loadInto(app) {
      if (!existsSync(resolved)) {
        return undefined;
      }

      const state = normalizeState(JSON.parse(readFileSync(resolved, "utf8")));
      restorePersistedAgentState(app, state);
      return state;
    },
    saveFrom(app) {
      const state = snapshotPersistedAgentState(app);

      mkdirSync(dirname(resolved), { recursive: true });
      const tempPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      renameSync(tempPath, resolved);
      return state;
    },
  };
}

export function snapshotPersistedAgentState(app: PersistableAgentStatePorts): PersistedAgentState {
  return {
    version: 8,
    savedAt: new Date().toISOString(),
    knowledge: app.knowledge.snapshot(),
    knowledgeEvidence: app.knowledge.listEvidence(),
    knowledgeRevisions: app.knowledge.listRevisions(),
    knowledgeDeliveries: app.knowledge.listDeliveries(),
    knowledgeFeedback: app.knowledge.listFeedback(),
    memory: app.memory.list(),
    artifacts: app.artifacts.list(),
    workingState: app.workingState.get(),
    approvals: app.approvals.list(),
    events: app.events.list(),
    routines: app.routines.list(),
    sessions: app.sessions.list(),
    runs: app.sessions.listRuns(),
    executions: app.executions.list(),
    rooms: app.rooms.snapshot(),
  };
}

export function restorePersistedAgentState(
  app: PersistableAgentStatePorts,
  state: PersistedAgentState,
): void {
  app.knowledge.restore(state.knowledge);
  app.memory.restore(state.memory);
  app.artifacts.restore(state.artifacts);
  app.knowledge.restoreLedgers({
    evidence: state.knowledgeEvidence,
    revisions: state.knowledgeRevisions,
    deliveries: state.knowledgeDeliveries,
    feedback: state.knowledgeFeedback,
  });
  app.workingState.restore(state.workingState);
  app.approvals.restore(state.approvals);
  app.events.restore(state.events);
  app.routines.restore(state.routines);
  app.sessions.restore({
    sessions: state.sessions,
    runs: state.runs,
  });
  app.executions.restore(state.executions);
  app.rooms.restore(state.rooms);
}

function defaultStatePath(): string {
  return readAppEnv("STATE_PATH") ?? "data/local-state.json";
}

export function normalizePersistedAgentState(input: unknown): PersistedAgentState {
  const object =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const runs = Array.isArray(object.runs) ? object.runs as RunRecord[] : [];
  return {
    version: 8,
    savedAt: typeof object.savedAt === "string" ? object.savedAt : new Date().toISOString(),
    knowledge: Array.isArray(object.knowledge) ? object.knowledge as KnowledgeDocument[] : [],
    knowledgeEvidence: Array.isArray(object.knowledgeEvidence) ? object.knowledgeEvidence as KnowledgeEvidenceRecord[] : [],
    knowledgeRevisions: Array.isArray(object.knowledgeRevisions) ? object.knowledgeRevisions as KnowledgeRevision[] : [],
    knowledgeDeliveries: Array.isArray(object.knowledgeDeliveries) ? object.knowledgeDeliveries as KnowledgeDeliveryRecord[] : [],
    knowledgeFeedback: Array.isArray(object.knowledgeFeedback) ? object.knowledgeFeedback as KnowledgeFeedbackEvent[] : [],
    memory: Array.isArray(object.memory) ? object.memory as MemoryRecord[] : [],
    artifacts: Array.isArray(object.artifacts) ? object.artifacts as ArtifactRecord[] : [],
    workingState:
      object.workingState && typeof object.workingState === "object"
        ? (object.workingState as WorkingStateRecord)
        : {
            pinnedArtifactIds: [],
            workingArtifactIds: [],
            pendingApprovalIds: [],
            activeToolCallIds: [],
            discoveredSkillIds: [],
            discoveredSkillNames: [],
            expandedSkillIds: [],
            invokedSkills: [],
            loadedNestedMemoryPaths: [],
            toolSchemaCache: {},
            updatedAt: new Date().toISOString(),
          },
    approvals: Array.isArray(object.approvals) ? object.approvals as ApprovalRequest[] : [],
    events: Array.isArray(object.events) ? object.events as AgentEvent[] : [],
    routines: Array.isArray(object.routines) ? object.routines as Routine[] : [],
    sessions: Array.isArray(object.sessions) ? object.sessions as SessionRecord[] : [],
    runs,
    executions: Array.isArray(object.executions) ? object.executions as ExecutionRecord[] : [],
    rooms: normalizeRoomChannelState(
      object.rooms,
      runs,
      Array.isArray(object.events) ? object.events as AgentEvent[] : [],
    ),
  };
}

const normalizeState = normalizePersistedAgentState;

function normalizeRoomChannelState(
  input: unknown,
  runs: RunRecord[] = [],
  events: AgentEvent[] = [],
): RoomChannelSnapshot {
  const object = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<RoomChannelSnapshot>
    : {};
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const roomRunErrors = roomRunErrorsById(events);
  return {
    version: 1,
    currentEventSeq: typeof object.currentEventSeq === "number" ? object.currentEventSeq : 0,
    rooms: Array.isArray(object.rooms) ? object.rooms as RoomChannelSnapshot["rooms"] : [],
    members: Array.isArray(object.members) ? object.members as RoomChannelSnapshot["members"] : [],
    messages: Array.isArray(object.messages)
      ? (object.messages as RoomChannelSnapshot["messages"]).map((message) => {
          if (message.text.trim() || !message.runId) return message;
          if (message.status !== "failed" && message.status !== "done") return message;
          const error = roomRunErrors.get(message.runId) || String(runsById.get(message.runId)?.error || "").trim();
          return error ? { ...message, text: error, status: "failed" } : message;
        })
      : [],
    events: Array.isArray(object.events) ? object.events as RoomChannelSnapshot["events"] : [],
    deletedMemberIds: Array.isArray(object.deletedMemberIds) ? object.deletedMemberIds.map(String).filter(Boolean) : [],
  };
}

function roomRunErrorsById(events: AgentEvent[]): Map<string, string> {
  const errors = new Map<string, string>();
  for (const event of events) {
    if (!event.runId?.startsWith("room_run_")) continue;
    if (event.type === "error" && event.message.trim()) {
      errors.set(event.runId, event.message.trim());
      continue;
    }
    if (event.type === "runtime.diagnostic" && event.name === "hermes.acp.empty_response_diagnostic") {
      const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
        ? event.data as Record<string, unknown>
        : {};
      const diagnostic = typeof data.diagnostic === "string" ? data.diagnostic.trim() : "";
      if (diagnostic) {
        errors.set(event.runId, diagnostic);
      }
    }
  }
  return errors;
}
