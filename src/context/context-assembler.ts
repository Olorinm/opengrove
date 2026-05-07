import type {
  AgentContext,
  AgentAttachmentContext,
  ContextEnvelope,
  ContextItem,
  ExecutionRecord,
  MemoryRecord,
  RunRecord,
  SessionRecord,
} from "../core.js";
import type { KernelCapabilities } from "../kernel/types.js";
import type { KnowledgeContextPlanner } from "../knowledge/context-planner.js";
import type { KnowledgeResolver } from "../knowledge/resolver.js";
import type { ContextDeliveryPlan } from "../knowledge/types.js";

export interface ContextAssemblerOptions {
  maxItems?: number;
  maxCharacters?: number;
  memoryLimit?: number;
  knowledgePlanner?: KnowledgeContextPlanner;
  knowledgeResolver?: KnowledgeResolver;
  knowledgeLimit?: number;
}

export type ContextAssembler = (
  input: string,
  context: AgentContext,
  request?: ContextAssemblyRequest,
) => ContextEnvelope;

export interface ContextAssemblyRequest {
  runId?: string;
  kernelId?: string;
  kernelCapabilities?: KernelCapabilities;
}

export function createDefaultContextAssembler(
  options: ContextAssemblerOptions = {},
): ContextAssembler {
  return (input, context, request) => assembleDefaultContext(input, context, options, request);
}

export function assembleDefaultContext(
  input: string,
  context: AgentContext,
  options: ContextAssemblerOptions = {},
  request: ContextAssemblyRequest = {},
): ContextEnvelope {
  const maxItems = options.maxItems ?? 8;
  const maxCharacters = options.maxCharacters ?? 6000;
  const memoryLimit = options.memoryLimit ?? 4;
  const items: ContextItem[] = [];
  let knowledgeDeliveryPlan: ContextDeliveryPlan | undefined;
  const workingState = context.workingState.get();

  if (workingState.taskSummary || workingState.activeGoal) {
    items.push({
      id: "task.current",
      kind: "task",
      title: "Active task",
      text: [workingState.taskSummary, workingState.activeGoal].filter(Boolean).join("\n"),
      data: workingState.selectedModel
        ? {
            selectedModel: workingState.selectedModel,
          }
        : undefined,
    });
  }

  if (context.page?.title || context.page?.url) {
    items.push({
      id: "page.current",
      kind: "page",
      title: context.page.title || "Current page",
      text: [context.page.title, context.page.url].filter(Boolean).join("\n"),
      source: {
        title: context.page.title,
        url: context.page.url,
        locator: context.page.locator,
      },
    });
  }

  if (context.page?.selection) {
    items.push({
      id: "selection.current",
      kind: "selection",
      title: "Current selection",
      text: context.page.selection,
      source: {
        title: context.page.title,
        url: context.page.url,
        locator: context.page.locator,
        quote: context.page.selection,
      },
    });
  }

  if (context.page?.visibleText && context.page.visibleText !== context.page.selection) {
    items.push({
      id: "page.surrounding-text",
      kind: "page",
      title: "Visible surrounding text",
      text: context.page.visibleText,
      source: {
        title: context.page.title,
        url: context.page.url,
        locator: context.page.locator,
      },
    });
  }

  for (const attachment of context.page?.attachments ?? []) {
    items.push({
      id: `attachment.${attachment.id || attachment.name}`,
      kind: "attachment",
      title: attachment.name || "Attached file",
      text: summarizeAttachment(attachment),
      data: {
        name: attachment.name,
        kind: attachment.kind,
        mimeType: attachment.mimeType ?? "",
        size: attachment.size ?? 0,
        hasText: Boolean(attachment.text),
        hasImage: Boolean(attachment.dataUrl && attachment.kind === "image"),
        localPath: attachment.localPath ?? "",
      },
    });
  }

  if (context.computer && hasComputerContext(context.computer)) {
    items.push({
      id: "computer.current",
      kind: "computer",
      title: [context.computer.app, context.computer.windowTitle].filter(Boolean).join(" · ") || "Current computer state",
      text: summarizeComputer(context.computer),
      source: context.computer.screenshotArtifactId
        ? {
            locator: `artifact:${context.computer.screenshotArtifactId}`,
          }
        : undefined,
      data: {
        app: context.computer.app ?? "",
        windowTitle: context.computer.windowTitle ?? "",
        focusedElement: context.computer.focusedElement ?? "",
        screenshotArtifactId: context.computer.screenshotArtifactId ?? "",
      },
    });

    if (context.computer.accessibilityTree) {
      items.push({
        id: "computer.accessibility",
        kind: "computer",
        title: "Accessibility tree",
        text: truncate(context.computer.accessibilityTree, 2200),
      });
    }
  }

  const session = context.sessions.get(context.sessionId);
  const recentRuns = context.sessions.listRuns({ sessionId: context.sessionId, limit: 3 });
  if (session || recentRuns.length) {
    items.push({
      id: "session.current",
      kind: "session",
      title: session?.title || `Session · ${context.sessionId}`,
      text: summarizeSession(session, recentRuns),
      data: {
        sessionId: context.sessionId,
        status: session?.status ?? "",
        activeRunId: session?.activeRunId ?? "",
        latestRunId: session?.latestRunId ?? "",
      },
    });
  }

  const recentExecutions = context.executions.list({ sessionId: context.sessionId, limit: 6 });
  if (recentExecutions.length) {
    items.push({
      id: "execution.recent",
      kind: "execution",
      title: "Recent execution",
      text: summarizeExecutions(recentExecutions),
    });
  }

  if (options.knowledgePlanner) {
    const planned = options.knowledgePlanner.plan(input, context, {
      limit: options.knowledgeLimit ?? memoryLimit,
      runId: request.runId,
      sessionId: context.sessionId,
      kernelId: request.kernelId,
      kernelCapabilities: request.kernelCapabilities,
      recordDelivery: false,
    });
    knowledgeDeliveryPlan = planned.plan;
    items.push(...planned.items);
  } else if (options.knowledgeResolver) {
    const knowledgeItems = options.knowledgeResolver.toContextItems(
      options.knowledgeResolver.resolve(input, context, {
        limit: options.knowledgeLimit ?? memoryLimit,
      }),
    );
    items.push(...knowledgeItems);
  } else {
    for (const memory of rankMemories(input, context).slice(0, memoryLimit)) {
      items.push({
        id: `memory.${memory.record.id}`,
        kind: "memory",
        title: `${memory.record.kind} (${memory.record.scope})`,
        text: memory.record.text,
        score: memory.score,
        source: memory.record.source.ref,
        data: {
          memoryId: memory.record.id,
          confidence: memory.record.confidence,
          tags: memory.record.tags,
        },
      });
    }
  }

  const selected = fitContext(items, maxItems, maxCharacters);
  if (knowledgeDeliveryPlan && options.knowledgePlanner) {
    options.knowledgePlanner.recordDelivery(finalizeKnowledgeDeliveryPlan(knowledgeDeliveryPlan, selected.items));
  }

  return {
    id: `ctx_${Date.now()}`,
    createdAt: new Date().toISOString(),
    summary: summarizeContext(selected.items),
    items: selected.items,
    budget: {
      maxItems,
      usedItems: selected.items.length,
      maxCharacters,
      usedCharacters: selected.usedCharacters,
      truncated: selected.truncated,
    },
    promptBlock: renderPromptBlock(selected.items, selected.truncated),
  };
}

function finalizeKnowledgeDeliveryPlan(
  plan: ContextDeliveryPlan,
  selectedItems: ContextItem[],
): ContextDeliveryPlan {
  const selectedIds = new Set(selectedItems.map((item) => item.id));
  return {
    ...plan,
    decisions: plan.decisions.map((decision) => {
      const selected = Boolean(decision.contextItemId && selectedIds.has(decision.contextItemId));
      if (!decision.includeInPrompt || selected) {
        return decision;
      }
      return {
        ...decision,
        includeInPrompt: false,
        reason: `${decision.reason}; planned prompt item was trimmed by context budget`,
        metadata: {
          ...decision.metadata,
          plannedIncludeInPrompt: true,
          trimmedByContextBudget: true,
        },
      };
    }),
  };
}

function rankMemories(
  input: string,
  context: AgentContext,
): Array<{ record: MemoryRecord; score: number }> {
  const query = [
    input,
    context.page?.selection ?? "",
    context.page?.title ?? "",
    context.page?.url ?? "",
  ].join(" ");
  const queryTokens = tokenize(query);

  return context.memory
    .list()
    .map((record) => ({ record, score: scoreMemory(record, query, queryTokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

function scoreMemory(record: MemoryRecord, query: string, queryTokens: string[]): number {
  const haystack = [
    record.kind,
    record.scope,
    record.text,
    record.tags.join(" "),
    record.source.ref?.title ?? "",
    record.source.ref?.url ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  let score = 0;
  if (normalizedQuery && haystack.includes(normalizedQuery.slice(0, 80))) {
    score += 5;
  }

  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length > 8 ? 2 : 1;
    }
  }

  return score;
}

function fitContext(
  items: ContextItem[],
  maxItems: number,
  maxCharacters: number,
): { items: ContextItem[]; usedCharacters: number; truncated: boolean } {
  const fitted: ContextItem[] = [];
  let usedCharacters = 0;
  let truncated = false;

  for (const item of items) {
    if (fitted.length >= maxItems) {
      truncated = true;
      break;
    }

    const remaining = maxCharacters - usedCharacters;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const text = item.text.length > remaining ? `${item.text.slice(0, Math.max(0, remaining - 1))}...` : item.text;
    if (text.length !== item.text.length) {
      truncated = true;
    }

    fitted.push({ ...item, text });
    usedCharacters += text.length;
  }

  return { items: fitted, usedCharacters, truncated };
}

function summarizeContext(items: ContextItem[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ") || "empty context";
}

function renderPromptBlock(items: ContextItem[], truncated: boolean): string {
  if (items.length === 0) {
    return "Context: none.";
  }

  const lines = ["Context assembled for this turn:"];
  for (const item of items) {
    lines.push(`\n[${item.kind}] ${item.title}`);
    if (item.source?.url) {
      lines.push(`Source: ${item.source.url}`);
    }
    if (item.source?.locator) {
      lines.push(`Locator: ${item.source.locator}`);
    }
    lines.push(item.text);
  }

  if (truncated) {
    lines.push("\nSome context was trimmed to stay within budget.");
  }

  return lines.join("\n");
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function summarizeAttachment(attachment: AgentAttachmentContext): string {
  const meta = [
    `Name: ${attachment.name}`,
    `Kind: ${attachment.kind}`,
    attachment.mimeType ? `MIME: ${attachment.mimeType}` : "",
    typeof attachment.size === "number" ? `Size: ${attachment.size} bytes` : "",
    attachment.localPath ? `Local path: ${attachment.localPath}` : "",
  ].filter(Boolean);

  if (attachment.text) {
    meta.push(`Content:\n${truncate(attachment.text, 3200)}`);
  } else if (attachment.kind === "image" && attachment.dataUrl) {
    meta.push("Image content is attached to the model input separately.");
  } else if (attachment.localPath) {
    meta.push("The uploaded file copy is available on the local filesystem at the path above.");
  } else {
    meta.push("Only file metadata is available; this file type is not text-readable in the browser.");
  }

  return meta.join("\n");
}

function summarizeComputer(
  computer: NonNullable<AgentContext["computer"]>,
): string {
  const elements = Array.isArray(computer.elements) ? computer.elements : [];
  const lines = [
    computer.app ? `App: ${computer.app}` : "",
    computer.windowTitle ? `Window: ${computer.windowTitle}` : "",
    computer.url ? `URL: ${computer.url}` : "",
    computer.focusedElement ? `Focused element: ${computer.focusedElement}` : "",
    computer.observation ? `Observation: ${computer.observation}` : "",
    computer.screenshotArtifactId ? `Screenshot artifact: ${computer.screenshotArtifactId}` : "",
    computer.observedAt ? `Observed at: ${computer.observedAt}` : "",
    elements.length ? `Elements: ${elements.length}` : "",
  ].filter(Boolean);

  if (elements.length) {
    const preview = elements
      .slice(0, 6)
      .map((item) => [item.id, item.role, item.name || item.value || item.description].filter(Boolean).join(" · "))
      .filter(Boolean)
      .join("\n");
    if (preview) {
      lines.push(`Visible controls:\n${preview}`);
    }
  }

  return lines.join("\n");
}

function summarizeSession(
  session: SessionRecord | undefined,
  runs: RunRecord[],
): string {
  const sortedRuns = [...runs].sort((left, right) =>
    String(right.updatedAt || right.startedAt || "").localeCompare(String(left.updatedAt || left.startedAt || "")),
  );
  const lines = [
    `Session ID: ${session?.id ?? "unknown"}`,
    session?.activity ? `Activity: ${session.activity}` : "",
    session?.status ? `Status: ${session.status}` : "",
    session?.lastUserInput ? `Last input: ${truncate(session.lastUserInput, 280)}` : "",
    sortedRuns.length ? `Recent runs: ${sortedRuns.length}` : "",
  ].filter(Boolean);

  if (sortedRuns.length) {
    lines.push(
      sortedRuns
        .map((run) =>
          [
            run.id,
            run.status,
            run.activity,
            run.modelId ? `model=${run.modelId}` : "",
            run.summary ? truncate(run.summary, 120) : "",
          ]
            .filter(Boolean)
            .join(" · "),
        )
        .join("\n"),
    );
  }

  return lines.join("\n");
}

function summarizeExecutions(records: ExecutionRecord[]): string {
  return [...records]
    .sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")))
    .map((record) =>
      [
        record.title,
        record.status ? `status=${record.status}` : "",
        record.toolId ? `tool=${record.toolId}` : "",
        record.approvalId ? `approval=${record.approvalId}` : "",
        record.artifactId ? `artifact=${record.artifactId}` : "",
        record.at ? `at=${record.at}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("\n");
}

function hasComputerContext(computer: NonNullable<AgentContext["computer"]>) {
  return Boolean(
    computer.app ||
      computer.windowTitle ||
      computer.url ||
      computer.focusedElement ||
      computer.observation ||
      computer.accessibilityTree ||
      computer.screenshotArtifactId ||
      (Array.isArray(computer.elements) && computer.elements.length > 0),
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 3))}...`;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
