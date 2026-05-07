import type { JsonObject, ToolDefinition, ToolSpec } from "../core.js";
import {
  buildBrowserActionRequest,
  type BrowserEnvironmentAdapter,
} from "../environment/browser-adapter.js";
import { observationSources } from "../environment/adapter.js";

export function createBrowserObserveTool(
  spec: ToolSpec,
  adapter: BrowserEnvironmentAdapter,
): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute() {
      const observation = await adapter.observe();
      return {
        ok: true,
        value: {
          status: "observed",
          ...observation.data,
        },
        sources: observationSources(observation),
      };
    },
  };
}

export function createBrowserRequestActTool(
  spec: ToolSpec,
  adapter: BrowserEnvironmentAdapter,
): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute(input, context) {
      const request = buildBrowserActionRequest(input);
      const instruction = request.action;

      if (context.policy.mode !== "allow") {
        const approval =
          context.policy.mode === "ask"
            ? context.approvals.request({
                kind: "browser_action",
                title: "确认网页动作",
                reason: context.policy.reason,
                toolId: spec.id,
                capabilityId: context.capabilityId,
                skillId: context.skillId,
                input,
                resume: { type: "tool", runId: context.runId },
              })
            : undefined;
        const value: JsonObject = {
          status: context.policy.mode,
          reason: context.policy.reason,
          approvalId: approval?.id ?? "",
        };

        return {
          ok: false,
          error: context.policy.mode === "deny" ? "permission_denied" : "approval_required",
          value,
        };
      }
      const result = await adapter.requestAction(request);
      if (result.status === "blocked" || result.status === "failed") {
        return {
          ok: false,
          error: result.status === "blocked" ? "environment_blocked" : "environment_failed",
          value: {
            status: result.status,
            instruction,
            ...(result.data ?? {}),
            message: result.message ?? "",
          },
        };
      }

      return {
        ok: true,
        value: {
          status: result.status,
          instruction,
          ...(result.data ?? {}),
          note: result.message ?? "",
        },
      };
    },
  };
}
