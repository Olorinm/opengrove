import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export interface PersistedAgentState {
  version: 7;
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
}

export interface JsonStateStore {
  readonly path: string;
  loadInto(app: PersistableAgentStatePorts): PersistedAgentState | undefined;
  saveFrom(app: PersistableAgentStatePorts): PersistedAgentState;
}

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
}

export function createJsonStateStore(path = defaultStatePath()): JsonStateStore {
  const resolved = resolve(path);

  return {
    path: resolved,
    loadInto(app) {
      if (!existsSync(resolved)) {
        return undefined;
      }

      const state = normalizeState(JSON.parse(readFileSync(resolved, "utf8")));
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
      return state;
    },
    saveFrom(app) {
      const state: PersistedAgentState = {
        version: 7,
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
      };

      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      return state;
    },
  };
}

function defaultStatePath(): string {
  return readAppEnv("STATE_PATH") ?? "data/local-state.json";
}

function normalizeState(input: unknown): PersistedAgentState {
  const object =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    version: 7,
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
    runs: Array.isArray(object.runs) ? object.runs as RunRecord[] : [],
    executions: Array.isArray(object.executions) ? object.executions as ExecutionRecord[] : [],
  };
}
