import type { OpenGroveApp } from "../app/create-opengrove.js";
import type {
  ApprovalRequest,
  ArtifactRecord,
  JsonObject,
  JsonValue,
  MemoryRecord,
  PolicyDecision,
  RunRecord,
  SessionRecord,
  ToolResult,
  WorkingStateRecord,
} from "../core.js";
import {
  resumeRoutineAfterApproval,
  type RoutineRunResult,
} from "../routines/routine-runner.js";
import type { BridgeState } from "./bridge-types.js";
import { syncBridgeWorkingState } from "./bridge-working-state.js";
import { asJsonObject } from "./http-utils.js";

export async function resolveApproval(
  state: BridgeState,
  approvalId: string,
  status: "approved" | "rejected",
  approvalResponse?: JsonValue,
): Promise<{
  ok: true;
  approval: ApprovalRequest;
  alreadyResolved?: boolean;
  toolResult?: ToolResult;
  routineResult?: RoutineRunResult;
  memory: MemoryRecord[];
  approvals: ApprovalRequest[];
  artifacts: ArtifactRecord[];
  workingState: WorkingStateRecord;
  sessions: SessionRecord[];
  runs: RunRecord[];
  executions: ReturnType<BridgeState["app"]["executions"]["list"]>;
}> {
  const { app } = state;
  const approval = app.approvals.get(approvalId);
  if (!approval) {
    throw new Error(`approval_not_found:${approvalId}`);
  }

  if (approval.status !== "pending") {
    if (approval.status !== status) {
      throw new Error(`approval_already_${approval.status}:${approvalId}`);
    }
    return bridgeApprovalState(app, approval, { alreadyResolved: true });
  }

  const runId = approval.resume?.runId ?? `approval_${approvalId}`;
  const sessionId = app.workingState.get().sessionId ?? "browser-bridge";

  if (
    approval.resume?.type === "codex.native" ||
    approval.resume?.type === "claude.native" ||
    approval.resume?.type === "hermes.native"
  ) {
    const resolved = app.approvals.decide(approvalId, status, approvalResponse);
    syncBridgeWorkingState(app);
    state.store.saveFrom(app);
    return bridgeApprovalState(app, resolved);
  }

  if (status === "rejected") {
    const rejected = app.approvals.decide(approvalId, "rejected", approvalResponse);
    app.recordEvent({
      type: "approval.resolved",
      runId,
      request: rejected,
    }, {
      sessionId,
      activity: "browser",
      input: rejected.title,
    });
    app.recordEvent({
      type: "turn.finished",
      runId,
      at: new Date().toISOString(),
    }, {
      sessionId,
      activity: "browser",
      input: rejected.title,
    });
    syncBridgeWorkingState(app);
    state.store.saveFrom(app);
    return bridgeApprovalState(app, rejected);
  }

  const approved = app.approvals.decide(approvalId, "approved", approvalResponse);
  app.recordEvent({
    type: "approval.resolved",
    runId,
    request: approved,
  }, {
    sessionId,
    activity: "browser",
    input: approved.title,
  });
  app.recordEvent({
    type: "run.resumed",
    runId,
    at: new Date().toISOString(),
    reason: "Approved by user through the local bridge.",
    approvalId: approved.id,
  }, {
    sessionId,
    activity: "browser",
    input: approved.title,
  });

  const routineResult = await resumeRoutineAfterApproval(app, approved);
  const toolResult = routineResult ? undefined : await replayApprovedTool(state, approved);
  if (!routineResult) {
    app.recordEvent({
      type: "turn.finished",
      runId,
      at: new Date().toISOString(),
    }, {
      sessionId,
      activity: "browser",
      input: approved.title,
    });
  }
  syncBridgeWorkingState(app);
  state.store.saveFrom(app);
  return bridgeApprovalState(app, approved, { toolResult, routineResult });
}

async function replayApprovedTool(state: BridgeState, approval: ApprovalRequest): Promise<ToolResult> {
  const { app } = state;
  if (!approval.toolId) {
    return { ok: true, value: { status: "approved" } };
  }

  const tool = app.tools.require(approval.toolId);
  const runId = approval.resume?.runId ?? `approval_${approval.id}`;
  const input = asJsonObject(approval.input);
  const policy: PolicyDecision = {
    mode: "allow",
    reason: "Approved by user through the local bridge.",
  };
  const sessionId = app.workingState.get().sessionId ?? "browser-bridge";

  app.recordEvent({ type: "tool.started", runId, toolId: approval.toolId, input }, {
    sessionId,
    activity: "browser",
    input: approval.title,
  });
  const result = await tool.execute(input, {
    runId,
    capabilityId: approval.capabilityId,
    skillId: approval.skillId,
    memory: app.memory,
    artifacts: app.artifacts,
    workingState: app.workingState,
    approvals: app.approvals,
    skills: app.skills,
    packs: app.packs,
    policy,
  });
  app.recordEvent({ type: "tool.finished", runId, toolId: approval.toolId, result }, {
    sessionId,
    activity: "browser",
    input: approval.title,
  });
  if (!result.ok) {
    app.recordEvent({
      type: "error",
      runId,
      message: result.error ?? "approved_tool_failed",
    }, {
      sessionId,
      activity: "browser",
      input: approval.title,
    });
  }
  return result;
}

function bridgeApprovalState(
  app: OpenGroveApp,
  approval: ApprovalRequest,
  extras: {
    alreadyResolved?: boolean;
    toolResult?: ToolResult;
    routineResult?: RoutineRunResult;
  } = {},
) {
  return {
    ok: true as const,
    approval,
    ...extras,
    memory: app.memory.list(),
    approvals: app.approvals.list(),
    artifacts: app.artifacts.list(),
    workingState: app.workingState.get(),
    sessions: app.sessions.list({ limit: 12 }),
    runs: app.sessions.listRuns({ limit: 24 }),
    executions: app.executions.list({ limit: 40 }),
  };
}
