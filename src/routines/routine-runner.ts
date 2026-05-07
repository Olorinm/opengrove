import type {
  ActivitySpace,
  AgentEvent,
  ApprovalInbox,
  ApprovalRequest,
  ArtifactStore,
  CapabilityRegistry,
  EventLog,
  JsonObject,
  MemoryLedger,
  PackRegistry,
  PermissionRequirement,
  Routine,
  RoutineRegistry,
  RoutineRunSummary,
  RoutineStep,
  SkillCatalog,
  ToolRegistry,
  ToolResult,
  WorkingStateStore,
} from "../core.js";

export interface RoutineRunnerPorts {
  events: EventLog;
  approvals: ApprovalInbox;
  capabilities: CapabilityRegistry;
  memory: MemoryLedger;
  artifacts: ArtifactStore;
  skills: SkillCatalog;
  packs: PackRegistry;
  routines: RoutineRegistry;
  tools: ToolRegistry;
  workingState: WorkingStateStore;
  recordEvent(
    event: AgentEvent,
    options?: {
      sessionId?: string;
      activity?: ActivitySpace;
      input?: string;
    },
  ): AgentEvent;
}

export interface RoutineDraftOptions {
  title?: string;
  description?: string;
  capabilityIds?: string[];
  runId?: string;
  maxSteps?: number;
}

export interface RoutineRunResult {
  summary: RoutineRunSummary;
  events: AgentEvent[];
  toolResults: ToolResult[];
}

export interface RoutineRunOptions {
  startStepId?: string;
  approvedStepId?: string;
  runId?: string;
}

export function createRoutineDraftFromEvents(
  app: RoutineRunnerPorts,
  options: RoutineDraftOptions = {},
): Routine {
  const sourceEvents = options.runId
    ? app.events.list().filter((event) => event.runId === options.runId)
    : app.events.list();
  const toolEvents = sourceEvents
    .filter((event): event is Extract<AgentEvent, { type: "tool.started" }> => event.type === "tool.started");
  const selectedEvents =
    typeof options.maxSteps === "number" && options.maxSteps > 0
      ? toolEvents.slice(-options.maxSteps)
      : toolEvents;

  const steps: RoutineStep[] = selectedEvents.map((event, index) => {
    const tool = app.tools.get(event.toolId);
    const approval = tool ? approvalForTool(tool.spec.permission) : undefined;
    return {
      id: `step_${index + 1}`,
      title: tool?.spec.title ?? event.toolId,
      toolId: event.toolId,
      capabilityId: findCapabilityIdForTool(app, event.toolId),
      input: event.input,
      approval,
    };
  });

  return app.routines.create({
    title: options.title ?? "Browser companion routine",
    description: options.description ?? "Drafted from the current event log.",
    status: "draft",
    trigger: "manual",
    capabilityIds: options.capabilityIds ?? app.capabilities.list().map((capability) => capability.id),
    approvalRules: [],
    steps,
  });
}

export async function runRoutine(
  app: RoutineRunnerPorts,
  routineId: string,
  options: RoutineRunOptions = {},
): Promise<RoutineRunResult> {
  const routine = app.routines.get(routineId);
  if (!routine) {
    throw new Error(`Routine not found: ${routineId}`);
  }

  const runId = options.runId ?? `routine_run_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const continuingRun = Boolean(options.runId && options.approvedStepId);
  const events: AgentEvent[] = continuingRun ? [] : [{ type: "turn.started", runId, at: startedAt }];
  const toolResults: ToolResult[] = [];
  const sessionId = app.workingState.get().sessionId ?? `routine:${routineId}`;
  const startIndex = options.startStepId
    ? routine.steps.findIndex((step) => step.id === options.startStepId)
    : 0;

  if (startIndex < 0) {
    throw new Error(`Routine step not found: ${options.startStepId}`);
  }

  for (const step of routine.steps.slice(startIndex)) {
    if (!step.toolId) {
      continue;
    }

    const tool = app.tools.require(step.toolId);
    const input = asJsonObject(step.input);
    const mode = step.approval?.mode ?? tool.spec.permission.mode;
    const wasApproved = options.approvedStepId === step.id;
    if (mode !== "allow" && !wasApproved) {
      const request = app.approvals.request({
        kind: "routine_step",
        title: step.title,
        reason: step.approval?.reason ?? tool.spec.permission.reason,
        toolId: step.toolId,
        capabilityId: step.capabilityId,
        input,
        resume: {
          type: "routine.step",
          routineId,
          stepId: step.id,
          runId,
        },
      });
      events.push({ type: "approval.requested", runId, request });
      events.push({
        type: "run.paused",
        runId,
        at: new Date().toISOString(),
        reason: request.reason,
        approvalId: request.id,
      });
      const summary = finishRoutine(app, routine, {
        id: runId,
        routineId,
        status: "paused_for_approval",
        startedAt,
        endedAt: new Date().toISOString(),
        eventCount: events.length,
      });
      for (const event of events) {
        app.recordEvent(event, {
          sessionId,
          activity: "browser",
          input: routine.title,
        });
      }
      return { summary, events, toolResults };
    }

    events.push({ type: "tool.started", runId, toolId: step.toolId, input });
    const result = await tool.execute(input, {
      runId,
      capabilityId: step.capabilityId,
      memory: app.memory,
      artifacts: app.artifacts,
      workingState: app.workingState,
      approvals: app.approvals,
      skills: app.skills,
      packs: app.packs,
      policy: {
        mode: "allow",
        reason: wasApproved
          ? "Routine step approved by the user."
          : "Routine step allowed by routine configuration.",
      },
    });
    toolResults.push(result);
    events.push({ type: "tool.finished", runId, toolId: step.toolId, result });

    if (!result.ok) {
      events.push({
        type: "error",
        runId,
        message: result.error ?? "routine_step_failed",
      });
      events.push({ type: "turn.finished", runId, at: new Date().toISOString() });
      const summary = finishRoutine(app, routine, {
        id: runId,
        routineId,
        status: "failed",
        startedAt,
        endedAt: new Date().toISOString(),
        eventCount: events.length,
        error: result.error,
      });
      for (const event of events) {
        app.recordEvent(event, {
          sessionId,
          activity: "browser",
          input: routine.title,
        });
      }
      return { summary, events, toolResults };
    }
  }

  events.push({ type: "turn.finished", runId, at: new Date().toISOString() });
  const summary = finishRoutine(app, routine, {
    id: runId,
    routineId,
    status: "succeeded",
    startedAt,
    endedAt: new Date().toISOString(),
    eventCount: events.length,
  });
  for (const event of events) {
    app.recordEvent(event, {
      sessionId,
      activity: "browser",
      input: routine.title,
    });
  }
  return { summary, events, toolResults };
}

export async function resumeRoutineAfterApproval(
  app: RoutineRunnerPorts,
  approval: ApprovalRequest,
): Promise<RoutineRunResult | undefined> {
  if (approval.resume?.type !== "routine.step") {
    return undefined;
  }

  return runRoutine(app, approval.resume.routineId, {
    startStepId: approval.resume.stepId,
    approvedStepId: approval.resume.stepId,
    runId: approval.resume.runId,
  });
}

function finishRoutine(
  app: RoutineRunnerPorts,
  routine: Routine,
  summary: RoutineRunSummary,
): RoutineRunSummary {
  app.routines.update(routine.id, {
    lastRun: summary,
    status:
      summary.status === "failed"
        ? "needs_repair"
        : summary.status === "paused_for_approval"
          ? "paused"
          : routine.status === "paused"
            ? "draft"
            : routine.status,
  });
  return summary;
}

function approvalForTool(permission: PermissionRequirement): PermissionRequirement | undefined {
  return permission.mode === "allow" ? undefined : permission;
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function findCapabilityIdForTool(app: RoutineRunnerPorts, toolId: string): string | undefined {
  return app.capabilities
    .list()
    .find((capability) => capability.tools.some((tool) => tool.id === toolId))
    ?.id;
}
