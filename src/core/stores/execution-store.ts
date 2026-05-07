import type {
  AgentEvent,
  ExecutionFilter,
  ExecutionKind,
  ExecutionRecord,
  JsonObject,
} from "../types.js";

export class ExecutionStore {
  private readonly records = new Map<string, ExecutionRecord>();
  private sequence = 0;

  restore(records: ExecutionRecord[] = []): void {
    this.records.clear();
    this.sequence = 0;

    for (const record of records) {
      this.records.set(record.id, normalizeExecutionRecord(record));
      const match = record.id.match(/^exec_(\d+)$/);
      if (match) {
        this.sequence = Math.max(this.sequence, Number(match[1]));
      }
    }
  }

  appendFromEvent(
    event: AgentEvent,
    options: { sessionId?: string; recordedAt?: string } = {},
  ): ExecutionRecord {
    const record = normalizeExecutionRecord({
      id: `exec_${++this.sequence}`,
      runId: event.runId,
      sessionId: options.sessionId,
      kind: inferExecutionKind(event),
      eventType: event.type,
      title: executionTitle(event),
      at: inferExecutionTimestamp(event, options.recordedAt),
      status: executionStatus(event),
      toolId: "toolId" in event ? event.toolId : undefined,
      approvalId: approvalIdFromEvent(event),
      artifactId: inferArtifactId(event),
      data: executionData(event),
    });
    this.records.set(record.id, record);
    return { ...record };
  }

  list(filter: ExecutionFilter = {}): ExecutionRecord[] {
    const records = Array.from(this.records.values())
      .filter((record) => {
        if (filter.sessionId && record.sessionId !== filter.sessionId) return false;
        if (filter.runId && record.runId !== filter.runId) return false;
        if (filter.kind && record.kind !== filter.kind) return false;
        return true;
      })
      .sort((left, right) => right.at.localeCompare(left.at))
      .map((record) => ({ ...record }));
    return typeof filter.limit === "number" ? records.slice(0, filter.limit) : records;
  }

  clear(): void {
    this.records.clear();
    this.sequence = 0;
  }
}

function normalizeExecutionRecord(input: ExecutionRecord): ExecutionRecord {
  return {
    ...input,
    sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
    status: typeof input.status === "string" ? input.status : undefined,
    toolId: typeof input.toolId === "string" ? input.toolId : undefined,
    approvalId: typeof input.approvalId === "string" ? input.approvalId : undefined,
    artifactId: typeof input.artifactId === "string" ? input.artifactId : undefined,
    data: isJsonObject(input.data) ? input.data : undefined,
  };
}

function inferExecutionKind(event: AgentEvent): ExecutionKind {
  switch (event.type) {
    case "turn.started":
    case "turn.finished":
    case "context.assembled":
    case "compaction.started":
    case "compaction.finished":
      return "loop";
    case "model.requested":
    case "model.response":
    case "assistant.delta":
      return "model";
    case "skill.discovered":
    case "skill.invoked":
    case "skill.loaded":
    case "skill.forked":
    case "skill.cleared":
      return "loop";
    case "approval.requested":
    case "approval.resolved":
    case "run.paused":
    case "run.resumed":
      return "approval";
    case "error":
      return "error";
    case "tool.finished":
      return event.toolId === "artifact.annotation" || Boolean(inferArtifactId(event)) ? "artifact" : "tool_call";
    case "tool.started":
      return "tool_call";
    case "memory.written":
      return "memory";
    default:
      return "tool_call";
  }
}

function executionTitle(event: AgentEvent): string {
  switch (event.type) {
    case "turn.started":
      return "Turn started";
    case "turn.finished":
      return "Turn finished";
    case "context.assembled":
      return "Context assembled";
    case "compaction.started":
      return "Compaction started";
    case "compaction.finished":
      return "Compaction finished";
    case "model.requested":
      return `Model requested${event.request.modelId ? ` · ${event.request.modelId}` : ""}`;
    case "model.response":
      return "Model responded";
    case "assistant.delta":
      return "Assistant delta";
    case "skill.discovered":
      return `Skills discovered · ${event.skills.length}`;
    case "skill.invoked":
      return `Skill invoked · ${event.skill.name}`;
    case "skill.loaded":
      return `Skill loaded · ${event.skillId}`;
    case "skill.forked":
      return `Skill forked · ${event.skillId}`;
    case "skill.cleared":
      return `Skill cleared${event.skillId ? ` · ${event.skillId}` : ""}`;
    case "tool.started":
      return `Tool started · ${event.toolId}`;
    case "tool.finished":
      return `Tool finished · ${event.toolId}`;
    case "approval.requested":
      return `Approval requested · ${event.request.title || event.request.toolId || event.request.id}`;
    case "approval.resolved":
      return `Approval ${event.request.status}`;
    case "run.paused":
      return "Run paused";
    case "run.resumed":
      return "Run resumed";
    case "memory.written":
      return `Memory written · ${event.record.kind}`;
    case "error":
      return "Run error";
    default:
      return "Event";
  }
}

function inferExecutionTimestamp(event: AgentEvent, recordedAt = new Date().toISOString()): string {
  switch (event.type) {
    case "turn.started":
    case "turn.finished":
    case "compaction.started":
    case "compaction.finished":
      return event.at;
    case "approval.requested":
      return event.request.createdAt;
    case "approval.resolved":
      return event.request.updatedAt;
    case "run.paused":
    case "run.resumed":
      return event.at;
    case "memory.written":
      return event.record.updatedAt;
    default:
      return recordedAt;
  }
}

function executionStatus(event: AgentEvent): string | undefined {
  switch (event.type) {
    case "approval.requested":
    case "approval.resolved":
      return event.request.status;
    case "run.paused":
      return "paused";
    case "run.resumed":
      return "running";
    case "skill.forked":
      return event.status;
    case "tool.finished":
      return event.result.ok ? "ok" : event.result.error ?? "error";
    case "error":
      return "failed";
    default:
      return undefined;
  }
}

function inferArtifactId(event: AgentEvent): string | undefined {
  if (event.type === "tool.finished" && isJsonObject(event.result.value) && typeof event.result.value.artifactId === "string") {
    return event.result.value.artifactId;
  }
  return undefined;
}

function approvalIdFromEvent(event: AgentEvent): string | undefined {
  if (event.type === "approval.requested" || event.type === "approval.resolved") {
    return event.request.id;
  }
  if (event.type === "run.paused" || event.type === "run.resumed") {
    return event.approvalId;
  }
  return undefined;
}

function executionData(event: AgentEvent): JsonObject | undefined {
  switch (event.type) {
    case "context.assembled":
      return { summary: event.context.summary };
    case "compaction.started":
      return {
        reason: event.reason ?? "",
      };
    case "compaction.finished":
      return {
        summary: event.summary ?? "",
      };
    case "model.requested":
      return {
        modelId: event.request.modelId ?? "",
        userInput: event.request.userInput,
      };
    case "model.response":
      return event.response.text ? { text: summarizeRunText(event.response.text) ?? "" } : undefined;
    case "skill.discovered":
      return { skillIds: event.skills.map((skill) => skill.id).join(", ") };
    case "skill.invoked":
      return {
        skillId: event.skill.id,
        skillName: event.skill.name,
        origin: event.invocation.origin,
        args: event.invocation.args ?? "",
      };
    case "skill.loaded":
      return {
        skillId: event.skillId,
        contentPreview: event.contentPreview,
        allowedTools: event.allowedTools.join(", "),
        model: event.model ?? "",
        effort: event.effort ?? "",
        context: event.context,
      };
    case "skill.forked":
      return {
        skillId: event.skillId,
        forkSessionId: event.forkSessionId,
        status: event.status,
        result: summarizeRunText(event.result) ?? "",
      };
    case "skill.cleared":
      return {
        skillId: event.skillId ?? "",
        reason: event.reason,
      };
    case "tool.started":
      return isJsonObject(event.input) ? event.input : undefined;
    case "tool.finished":
      return isJsonObject(event.result.value) ? event.result.value : undefined;
    case "approval.requested":
    case "approval.resolved":
      return isJsonObject(event.request.input) ? event.request.input : undefined;
    case "run.paused":
      return {
        reason: event.reason,
        approvalId: event.approvalId ?? "",
      };
    case "run.resumed":
      return {
        reason: event.reason ?? "",
        approvalId: event.approvalId ?? "",
      };
    case "memory.written":
      return event.record.data;
    case "error":
      return { message: event.message };
    default:
      return undefined;
  }
}

function summarizeRunText(primary?: string, fallback?: string): string | undefined {
  const text = (primary ?? fallback ?? "").trim();
  return text ? (text.length > 240 ? `${text.slice(0, 237)}...` : text) : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
