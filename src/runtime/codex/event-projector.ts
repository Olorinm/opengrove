import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentEvent, JsonObject, JsonValue, UsageStats } from "../../core.js";
import type { AsyncEventQueue } from "./async-event-queue.js";
import { isJsonObject, readString } from "./json.js";

export class CodexEventProjector {
  private readonly assistantTextByItem = new Map<string, string>();
  private readonly assistantItemOrder: string[] = [];
  private readonly generatedImages: Array<{ alt: string; src: string }> = [];
  private streamedAssistantText = false;
  private error?: string;
  private tokenUsage?: UsageStats;

  constructor(
    private readonly runId: string,
    private readonly threadId: string,
    private readonly queue: AsyncEventQueue<AgentEvent>,
  ) {}

  handleNotification(
    notification: { method: string; params?: JsonValue },
    turnId: string,
  ): boolean {
    const params = isJsonObject(notification.params) ? notification.params : undefined;
    if (!params || !this.isForTurn(params, turnId)) {
      return false;
    }

    if (notification.method === "item/agentMessage/delta") {
      const itemId = readString(params, "itemId") ?? readString(params, "id") ?? "assistant";
      const delta = readString(params, "delta") ?? "";
      if (delta) {
        this.rememberAssistantItem(itemId);
        this.assistantTextByItem.set(itemId, `${this.assistantTextByItem.get(itemId) ?? ""}${delta}`);
        this.streamedAssistantText = true;
        this.queue.push({ type: "assistant.delta", runId: this.runId, text: delta });
      }
      return false;
    }

    if (notification.method === "thread/tokenUsage/updated") {
      this.tokenUsage = normalizeCodexUsage(params);
      return false;
    }

    if (notification.method === "item/started") {
      const item = readItem(params);
      if (item?.type === "contextCompaction") {
        this.queue.push({
          type: "compaction.started",
          runId: this.runId,
          at: new Date().toISOString(),
          reason: readString(item, "reason") ?? readString(item, "status"),
          item,
        });
      }
      const toolEvent = itemToToolStarted(this.runId, item);
      if (toolEvent) {
        this.queue.push(toolEvent);
      }
      return false;
    }

    if (notification.method === "item/completed") {
      const item = readItem(params);
      if (item?.type === "agentMessage" && typeof item.text === "string" && item.text) {
        this.rememberAssistantItem(item.id);
        this.assistantTextByItem.set(item.id, item.text);
      }
      if (item?.type === "imageGeneration") {
        this.rememberGeneratedImage(item);
      }
      if (item?.type === "contextCompaction") {
        this.queue.push({
          type: "compaction.finished",
          runId: this.runId,
          at: new Date().toISOString(),
          summary: readString(item, "summary") ?? readString(item, "status"),
          item,
        });
      }
      const toolEvent = itemToToolFinished(this.runId, item);
      if (toolEvent) {
        this.queue.push(toolEvent);
      }
      return false;
    }

    if (notification.method === "error") {
      if (params.willRetry === true) {
        return false;
      }
      const error = isJsonObject(params.error) ? params.error : undefined;
      this.error =
        readString(params, "message") ??
        readString(error ?? {}, "message") ??
        "codex app-server error";
      return false;
    }

    if (notification.method === "turn/completed") {
      const turn = isJsonObject(params.turn) ? params.turn : undefined;
      if (!turn || readString(turn, "id") !== turnId) {
        return false;
      }
      const status = readString(turn, "status");
      if (status === "failed") {
        const turnError = isJsonObject(turn.error) ? turn.error : undefined;
        this.error = readString(turnError ?? {}, "message") ?? "codex turn failed";
      }
      const items = Array.isArray(turn.items) ? turn.items : [];
      for (const item of items) {
        const object = isJsonObject(item) ? item : undefined;
        if (object?.type === "agentMessage" && typeof object.text === "string" && object.text) {
          const itemId = typeof object.id === "string" ? object.id : "assistant";
          this.rememberAssistantItem(itemId);
          this.assistantTextByItem.set(itemId, object.text);
        }
        if (object?.type === "imageGeneration") {
          this.rememberGeneratedImage(object as JsonObject & { id: string; type: string });
        }
      }
      return true;
    }

    return false;
  }

  finalText(): string {
    const imageMarkdown = this.generatedImages
      .map((image) => `![${image.alt}](${image.src})`)
      .filter((line, index, lines) => lines.indexOf(line) === index);
    for (let index = this.assistantItemOrder.length - 1; index >= 0; index -= 1) {
      const itemId = this.assistantItemOrder[index];
      const text = itemId ? this.assistantTextByItem.get(itemId)?.trim() : "";
      if (text) {
        const missingImages = imageMarkdown.filter((line) => !text.includes(line));
        return missingImages.length ? `${text}\n\n${missingImages.join("\n")}` : text;
      }
    }
    return imageMarkdown.join("\n");
  }

  didStreamAssistantText(): boolean {
    return this.streamedAssistantText;
  }

  errorMessage(): string | undefined {
    return this.error;
  }

  usage(): UsageStats | undefined {
    return this.tokenUsage;
  }

  generatedImageCount(): number {
    return this.generatedImages.length;
  }

  private rememberAssistantItem(itemId: string): void {
    if (!itemId || this.assistantItemOrder.includes(itemId)) {
      return;
    }
    this.assistantItemOrder.push(itemId);
  }

  private rememberGeneratedImage(item: JsonObject & { id: string; type: string }): void {
    const status = readString(item, "status") ?? "";
    const hasImagePayload =
      Boolean(readString(item, "savedPath") ?? readString(item, "saved_path")) ||
      Boolean(readString(item, "result"));
    if (status && status !== "completed" && !hasImagePayload) {
      return;
    }
    const src = persistCodexGeneratedImage(item);
    if (!src || this.generatedImages.some((image) => image.src === src)) {
      return;
    }
    const revisedPrompt = readString(item, "revisedPrompt") ?? readString(item, "revised_prompt");
    this.generatedImages.push({
      alt: revisedPrompt ? truncateImageAlt(revisedPrompt) : `Codex generated image ${this.generatedImages.length + 1}`,
      src,
    });
  }

  private isForTurn(params: JsonObject, turnId: string): boolean {
    const notificationThreadId = readString(params, "threadId");
    const notificationTurnId = readString(params, "turnId");
    return (
      (!notificationThreadId || notificationThreadId === this.threadId) &&
      (!notificationTurnId || notificationTurnId === turnId)
    );
  }
}

function itemToToolStarted(
  runId: string,
  item: (JsonObject & { id: string; type: string }) | undefined,
): AgentEvent | undefined {
  if (!item || item.type === "dynamicToolCall" || item.type === "agentMessage" || item.type === "userMessage") {
    return undefined;
  }
  const toolId = codexItemToolId(item);
  if (!toolId) {
    return undefined;
  }
  return {
    type: "tool.started",
    runId,
    toolId,
    input: item,
  };
}

function itemToToolFinished(
  runId: string,
  item: (JsonObject & { id: string; type: string }) | undefined,
): AgentEvent | undefined {
  if (!item || item.type === "dynamicToolCall" || item.type === "agentMessage" || item.type === "userMessage") {
    return undefined;
  }
  const toolId = codexItemToolId(item);
  if (!toolId) {
    return undefined;
  }
  const status = typeof item.status === "string" ? item.status : "completed";
  const value = item.type === "imageGeneration" ? sanitizeImageGenerationItem(item) : item;
  return {
    type: "tool.finished",
    runId,
    toolId,
    result: {
      ok: status !== "failed" && status !== "declined",
      value,
      error: status === "failed" || status === "declined" ? status : undefined,
    },
  };
}

function sanitizeImageGenerationItem(item: JsonObject & { id: string; type: string }): JsonObject {
  const src = persistCodexGeneratedImage(item);
  const sanitized: JsonObject = {
    ...item,
    result: readString(item, "result") ? "[omitted image binary]" : "",
  };
  if (src) {
    sanitized.generatedSrc = src;
  }
  return sanitized;
}

function codexItemToolId(item: JsonObject & { type: string }): string | undefined {
  if (
    item.type === "commandExecution" ||
    item.type === "fileChange" ||
    item.type === "mcpToolCall" ||
    item.type === "webSearch" ||
    item.type === "collabToolCall" ||
    item.type === "imageView" ||
    item.type === "imageGeneration" ||
    item.type === "contextCompaction" ||
    item.type === "plan" ||
    item.type === "reasoning"
  ) {
    return `codex.${item.type}`;
  }
  return undefined;
}

function readItem(params: JsonObject): (JsonObject & { id: string; type: string }) | undefined {
  const item = isJsonObject(params.item) ? params.item : undefined;
  const id = item ? readString(item, "id") : undefined;
  const type = item ? readString(item, "type") : undefined;
  if (!item || !id || !type) {
    return undefined;
  }
  return { ...item, id, type };
}

function persistCodexGeneratedImage(item: JsonObject): string | undefined {
  const generatedRoot = resolve(process.cwd(), "data/generated");
  mkdirSync(generatedRoot, { recursive: true });
  const itemId = sanitizeGeneratedImageId(readString(item, "id") ?? `image_${Date.now()}`);
  const savedPath = readString(item, "savedPath") ?? readString(item, "saved_path");
  const extension = imageExtensionFromPath(savedPath) ?? "png";
  const filename = `codex-${itemId}.${extension}`;
  const outputPath = resolve(generatedRoot, filename);

  try {
    if (savedPath && existsSync(savedPath)) {
      copyFileSync(savedPath, outputPath);
      return `/generated/${filename}`;
    }

    const result = readString(item, "result");
    if (result && /^[A-Za-z0-9+/=\s]+$/.test(result)) {
      writeFileSync(outputPath, Buffer.from(result.replace(/\s+/g, ""), "base64"));
      return `/generated/${filename}`;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function sanitizeGeneratedImageId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `image_${Date.now()}`;
}

function imageExtensionFromPath(value: string | undefined): "png" | "jpg" | "jpeg" | "webp" | undefined {
  const match = value?.toLowerCase().match(/\.([a-z0-9]+)(?:$|[?#])/);
  const ext = match?.[1];
  return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" ? ext : undefined;
}

function truncateImageAlt(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function normalizeCodexUsage(params: JsonObject): UsageStats | undefined {
  const tokenUsage = isJsonObject(params.tokenUsage) ? params.tokenUsage : params;
  const current =
    readFirstJsonObject(tokenUsage, ["last", "current", "lastCall", "lastCallUsage"]) ??
    tokenUsage;
  const inputTokens =
    readNumberAlias(current, ["inputTokens", "input_tokens", "input", "promptTokens", "prompt_tokens"]) ?? undefined;
  const outputTokens =
    readNumberAlias(current, ["outputTokens", "output_tokens", "output", "completionTokens", "completion_tokens"]) ?? undefined;
  const totalTokens =
    readNumberAlias(current, ["totalTokens", "total_tokens", "total"]) ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function readFirstJsonObject(record: JsonObject, keys: string[]): JsonObject | undefined {
  for (const key of keys) {
    if (isJsonObject(record[key])) {
      return record[key] as JsonObject;
    }
  }
  return undefined;
}

function readNumberAlias(record: JsonObject, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
