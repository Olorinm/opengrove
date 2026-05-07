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
import { normalizeComputerSnapshot } from "../environment/computer-adapter.js";
import {
  resumeRoutineAfterApproval,
  type RoutineRunResult,
} from "../routines/routine-runner.js";
import type { ComputerStateSnapshot } from "../tools/computer.js";
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

  if (approval.resume?.type === "codex.native") {
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
  const preflight = preflightApprovedToolReplay(state, approval, runId);
  const result =
    preflight ??
    (await tool.execute(input, {
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
    }));
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

function preflightApprovedToolReplay(
  state: BridgeState,
  approval: ApprovalRequest,
  runId: string,
): ToolResult | undefined {
  if (approval.toolId !== "computer.requestAction") {
    return undefined;
  }

  const observed = latestComputerObservationForRun(state.app, runId);
  const current = normalizeComputerSnapshot(state.computerSnapshot);
  if (!observed || !current.app && !current.windowTitle && !current.url) {
    return undefined;
  }

  if (!hasComputerSnapshotDrift(observed, current)) {
    return undefined;
  }

  return {
    ok: false,
    error: "environment_blocked",
    value: {
      status: "blocked",
      needsReobserve: true,
      message: "Computer state changed since the last observe step. Re-observe before replaying this approval.",
      expectedApp: observed.app ?? "",
      expectedWindowTitle: observed.windowTitle ?? "",
      expectedUrl: observed.url ?? "",
      expectedObservedAt: observed.observedAt ?? "",
      currentApp: current.app ?? "",
      currentWindowTitle: current.windowTitle ?? "",
      currentUrl: current.url ?? "",
      currentObservedAt: current.observedAt ?? "",
    },
  };
}

function latestComputerObservationForRun(
  app: OpenGroveApp,
  runId: string,
): ComputerStateSnapshot | undefined {
  const events = app.events.list();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.runId !== runId || event.type !== "tool.finished" || event.toolId !== "computer.observe" || !event.result.ok) {
      continue;
    }

    const value = asJsonObject(event.result.value);
    return normalizeComputerSnapshot({
      app: value.app,
      windowTitle: value.windowTitle,
      url: value.url,
      focusedElement: value.focusedElement,
      observation: value.observation,
      accessibilityTree: value.accessibilityTree,
      screenshotArtifactId: value.screenshotArtifactId,
      observedAt: value.observedAt,
      elements: value.elements,
    });
  }

  return undefined;
}

function hasComputerSnapshotDrift(
  expected: ComputerStateSnapshot,
  current: ComputerStateSnapshot,
): boolean {
  if (expected.observedAt && current.observedAt && expected.observedAt !== current.observedAt) {
    return true;
  }

  return changedNonEmpty(expected.app, current.app) || changedNonEmpty(expected.windowTitle, current.windowTitle) || changedNonEmpty(expected.url, current.url);
}

function changedNonEmpty(expected?: string, current?: string): boolean {
  return Boolean(expected && current && expected !== current);
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
