import type { JsonObject, ToolDefinition, ToolSpec, ToolResult } from "../core.js";
import { observationSources } from "../environment/adapter.js";
import {
  actionResultToToolFailure,
  buildComputerActionRequest,
  hasComputerState,
  type ComputerEnvironmentAdapter,
  type ComputerStateReader,
  type ComputerStateSnapshot,
} from "../environment/computer-adapter.js";

export type { ComputerStateReader, ComputerStateSnapshot };

export function createComputerObserveTool(
  spec: ToolSpec,
  adapter: ComputerEnvironmentAdapter,
): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute() {
      const observation = await adapter.observe();
      const data = observation.data;
      return {
        ok: true,
        value: {
          status: hasObservationData(data) ? "observed" : "missing_snapshot",
          ...data,
        },
        sources: observationSources(observation),
      };
    },
  };
}

export function createComputerRequestActionTool(
  spec: ToolSpec,
  adapter: ComputerEnvironmentAdapter,
): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute(input, context) {
      const action = readRequiredString(input, "action");
      const observation = await adapter.observe();
      const enrichedInput = mergeObservationIntoActionInput(input, observation.data);
      const request = buildComputerActionRequest(action, enrichedInput);
      const approvalInput = createApprovalInput(action, request, enrichedInput);
      const payload = normalizeActionPayload(request);
      const result: ToolResult<JsonObject> = stageOrRequestApproval(spec, approvalInput, context);
      if (!result.ok) {
        return result;
      }

      const actionResult = await adapter.requestAction(request);
      if (actionResult.status === "blocked" || actionResult.status === "failed") {
        return {
          ok: false,
          error: actionResultToToolFailure(actionResult),
          value: {
            status: actionResult.status,
            action,
            ...payload,
            ...(actionResult.data ?? {}),
            message: actionResult.message ?? "",
          },
        };
      }

      const artifact = context.artifacts.create({
        type: "computer_action",
        title: buildActionTitle(action, payload),
        status: actionResult.status === "executed" ? "executed" : "approved",
        tags: uniqueStrings(["computer", "action", action]),
        derivedFrom: uniqueStrings([readString(enrichedInput, "screenshotArtifactId")]),
        lineage: uniqueStrings([readString(enrichedInput, "screenshotArtifactId")]),
        provenance: {
          toolId: spec.id,
          runId: context.runId,
          capabilityId: context.capabilityId ?? "",
          skillId: context.skillId ?? "",
        },
        data: {
          action,
          app: readString(enrichedInput, "app"),
          windowTitle: readString(enrichedInput, "windowTitle"),
          url: readString(enrichedInput, "url"),
          focusedElement: readString(enrichedInput, "focusedElement"),
          execution: actionResult.status === "executed" ? "executed" : "staged_only",
          ...payload,
          ...(actionResult.data ?? {}),
        },
      });
      const currentWorkingState = context.workingState.get();
      context.workingState.update({
        pinnedArtifactIds: uniqueStrings([...currentWorkingState.pinnedArtifactIds, artifact.id]),
        workingArtifactIds: uniqueStrings([...currentWorkingState.workingArtifactIds, artifact.id]),
      });

      return {
        ok: true,
        value: {
          status: actionResult.status,
          action,
          artifactId: artifact.id,
          ...payload,
          ...(actionResult.data ?? {}),
          note: actionResult.message ?? "This V0 capability records computer actions before a real executor is attached.",
        },
      };
    },
  };
}

function stageOrRequestApproval(
  spec: ToolSpec,
  input: JsonObject,
  context: Parameters<ToolDefinition<JsonObject, JsonObject>["execute"]>[1],
): ToolResult<JsonObject> {
  if (context.policy.mode === "allow") {
    return { ok: true, value: {} };
  }

  const approval =
    context.policy.mode === "ask"
      ? context.approvals.request({
          kind: "computer_action",
          title: "确认电脑动作",
          reason: context.policy.reason,
          toolId: spec.id,
          capabilityId: context.capabilityId,
          skillId: context.skillId,
          input,
          resume: { type: "tool", runId: context.runId },
        })
      : undefined;

  return {
    ok: false,
    error: context.policy.mode === "deny" ? "permission_denied" : "approval_required",
    value: {
      status: context.policy.mode,
      reason: context.policy.reason,
      approvalId: approval?.id ?? "",
    },
  };
}

function mergeObservationIntoActionInput(input: JsonObject, observation: JsonObject): JsonObject {
  return {
    ...input,
    app: preferInputString(input, observation, "app"),
    windowTitle: preferInputString(input, observation, "windowTitle"),
    url: preferInputString(input, observation, "url"),
    focusedElement: preferInputString(input, observation, "focusedElement"),
    screenshotArtifactId: preferInputString(input, observation, "screenshotArtifactId"),
    observedAt: preferInputString(input, observation, "observedAt"),
  };
}

function createApprovalInput(
  action: string,
  request: {
    target?: string;
    elementId?: string;
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    direction?: string;
    rationale?: string;
  },
  input: JsonObject,
): JsonObject {
  const approvalInput: JsonObject = {
    action,
    app: readString(input, "app"),
    windowTitle: readString(input, "windowTitle"),
    url: readString(input, "url"),
    focusedElement: readString(input, "focusedElement"),
    screenshotArtifactId: readString(input, "screenshotArtifactId"),
    observedAt: readString(input, "observedAt"),
    target: request.target ?? "",
    elementId: request.elementId ?? "",
    rationale: request.rationale ?? "",
  };

  if (typeof request.x === "number") approvalInput.x = request.x;
  if (typeof request.y === "number") approvalInput.y = request.y;
  if (request.text) approvalInput.text = request.text;
  if (request.key) approvalInput.key = request.key;
  if (request.direction) approvalInput.direction = request.direction;

  return approvalInput;
}

function preferInputString(input: JsonObject, fallback: JsonObject, key: string): string {
  const primary = readString(input, key);
  return primary || readJsonString(fallback[key]);
}

function normalizeActionPayload(request: {
  action: string;
  target?: string;
  elementId?: string;
  rationale?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  direction?: string;
  data?: JsonObject;
}): JsonObject {
  const payload: JsonObject = {
    ...request.data,
    target: request.target ?? "",
    elementId: request.elementId ?? "",
    rationale: request.rationale ?? "",
  };

  if (typeof request.x === "number") payload.x = request.x;
  if (typeof request.y === "number") payload.y = request.y;
  if (request.text) payload.text = request.text;
  if (request.key) payload.key = request.key;
  if (request.direction) payload.direction = request.direction;

  return payload;
}

function buildActionTitle(action: string, payload: JsonObject): string {
  const target = readJsonString(payload.target);
  const elementId = readJsonString(payload.elementId);
  const key = readJsonString(payload.key);
  const direction = readJsonString(payload.direction);

  if (target) {
    return `Computer ${action} · ${target}`;
  }
  if (elementId) {
    return `Computer ${action} · ${elementId}`;
  }
  if (key) {
    return `Computer ${action} · ${key}`;
  }
  if (direction) {
    return `Computer ${action} · ${direction}`;
  }
  return `Computer ${action}`;
}

function readRequiredString(input: JsonObject, key: string): string {
  const value = readString(input, key);
  if (!value) {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value;
}

function readString(input: JsonObject, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function readJsonString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim())));
}

function hasObservationData(value: JsonObject): boolean {
  const snapshot: ComputerStateSnapshot = {
    app: readJsonString(value.app),
    windowTitle: readJsonString(value.windowTitle),
    url: readJsonString(value.url),
    focusedElement: readJsonString(value.focusedElement),
    observation: readJsonString(value.observation),
    accessibilityTree: readJsonString(value.accessibilityTree),
    screenshotArtifactId: readJsonString(value.screenshotArtifactId),
    observedAt: readJsonString(value.observedAt),
    elements: Array.isArray(value.elements)
      ? value.elements
          .filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
          .map((item) => ({
            id: readJsonString(item.id),
            role: readJsonString(item.role),
            name: readJsonString(item.name),
            value: readJsonString(item.value),
            description: readJsonString(item.description),
          }))
      : [],
  };
  return hasComputerState(snapshot);
}
