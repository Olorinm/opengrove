import type { JsonObject, ToolDefinition, ToolSpec } from "../core.js";

export function createSearchMemoryTool(spec: ToolSpec): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute(input, context) {
      const query = readString(input, "query");
      const limit = readPositiveInteger(input, "limit") ?? 8;
      const scope = readString(input, "scope");
      const kind = readString(input, "kind");
      const records = context.memory.search(query, {
        scope: isMemoryScope(scope) ? scope : undefined,
        kind: kind || undefined,
        limit,
      });
      const serializedRecords: JsonObject[] = records.map((record) => ({
        id: record.id,
        scope: record.scope,
        kind: record.kind,
        text: record.text,
        confidence: record.confidence,
        tags: record.tags,
        source: {
          title: record.source.ref?.title ?? "",
          url: record.source.ref?.url ?? "",
          locator: record.source.ref?.locator ?? "",
          quote: record.source.ref?.quote ?? "",
        },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }));

      return {
        ok: true,
        value: {
          query,
          count: serializedRecords.length,
          records: serializedRecords,
        },
      };
    },
  };
}

export function createProposeReadingNoteTool(spec: ToolSpec): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute(input, context) {
      const text = readRequiredString(input, "text");
      const kind = readRequiredString(input, "kind");
      const tags = readStringArray(input, "tags");

      if (context.policy.mode !== "allow") {
        const approval =
          context.policy.mode === "ask"
            ? context.approvals.request({
                kind: "memory_write",
                title: "保存读书笔记",
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

      const record = context.memory.write({
        scope: "page",
        kind,
        text,
        confidence: "asserted",
        source: {
          kind: "skill",
          ref: {
            title: String(input.title ?? ""),
            url: String(input.url ?? ""),
            quote: String(input.quote ?? ""),
          },
        },
        tags,
        data: {
          capabilityId: context.capabilityId ?? "",
          skillId: context.skillId ?? "",
        },
      });

      const value: JsonObject = {
        status: "written",
        recordId: record.id,
      };

      return {
        ok: true,
        value,
      };
    },
  };
}

function readRequiredString(input: JsonObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected non-empty string input: ${key}`);
  }
  return value.trim();
}

function readString(input: JsonObject, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readStringArray(input: JsonObject, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function isMemoryScope(value: string): value is "user" | "workspace" | "page" | "session" {
  return value === "user" || value === "workspace" || value === "page" || value === "session";
}
