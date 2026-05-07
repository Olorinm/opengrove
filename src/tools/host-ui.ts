import type { JsonObject, JsonValue, ToolDefinition, ToolResult, ToolSpec } from "../core.js";

export function createRequestChoicesTool(spec: ToolSpec): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute(input): Promise<ToolResult<JsonObject>> {
      const questions = readChoiceQuestions(input.questions);
      if (!questions.length) {
        return {
          ok: false,
          error: "choice_questions_required",
        };
      }

      return {
        ok: true,
        value: {
          kind: "choice_form",
          formId: readString(input.formId) || `choice_${Date.now().toString(36)}`,
          title: readString(input.title) || "请选择",
          instructions: readString(input.instructions),
          submitLabel: readString(input.submitLabel) || "提交",
          questions,
          next: "Render this form in the host UI, then stop. The host submit button will send the user's choices as the next user turn.",
        },
      };
    },
  };
}

function readChoiceQuestions(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const object = record(item);
      const options = readChoiceOptions(object.options);
      const prompt = readString(object.prompt) || readString(object.question);
      if (!prompt || !options.length) {
        return null;
      }
      return {
        id: readString(object.id) || `q${index + 1}`,
        prompt,
        options,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function readChoiceOptions(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const object = record(item);
      const label = readString(object.label) || readString(object.text) || readString(object.value);
      if (!label) {
        return null;
      }
      return {
        value: readString(object.value) || String(index + 1),
        label,
        description: readString(object.description),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 8);
}

function record(value: unknown): Record<string, JsonValue | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue | undefined>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}
