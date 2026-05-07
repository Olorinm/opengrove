import type {
  AgentContext,
  ContextItem,
  JsonObject,
} from "../core.js";
import type { KernelCapabilities } from "../kernel/types.js";
import {
  knowledgeDocumentToContextItem,
  type KnowledgeResolver,
  type ResolveKnowledgeOptions,
} from "./resolver.js";
import type { KnowledgeStore } from "./store.js";
import type {
  ContextDeliveryPlan,
  KnowledgeDeliveryDecision,
  KnowledgeDeliveryMode,
  ResolvedKnowledgeDocument,
} from "./types.js";

export interface KnowledgeContextPlannerOptions {
  resolver: KnowledgeResolver;
  store: KnowledgeStore;
  defaultLimit?: number;
  kernelId?: string;
  kernelCapabilities?: KernelCapabilities;
}

export interface PlanKnowledgeContextOptions extends ResolveKnowledgeOptions {
  runId?: string;
  sessionId?: string;
  kernelId?: string;
  kernelCapabilities?: KernelCapabilities;
  recordDelivery?: boolean;
}

export interface PlannedKnowledgeContext {
  plan: ContextDeliveryPlan;
  items: ContextItem[];
}

export class KnowledgeContextPlanner {
  constructor(private readonly options: KnowledgeContextPlannerOptions) {}

  plan(
    input: string,
    context: AgentContext,
    options: PlanKnowledgeContextOptions = {},
  ): PlannedKnowledgeContext {
    const resolved = this.options.resolver.resolve(input, context, {
      limit: options.limit ?? this.options.defaultLimit,
      types: options.types,
    });
    const kernelCapabilities = options.kernelCapabilities ?? this.options.kernelCapabilities;
    const kernelId = options.kernelId ?? this.options.kernelId;
    const planId = `delivery_plan_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const decisions = resolved.map((item) =>
      createDeliveryDecision(item, context, kernelCapabilities, kernelId),
    );
    const items = decisions
      .map((decision, index) => {
        if (!decision.includeInPrompt) {
          return undefined;
        }
        const contextItem = deliveryDecisionToContextItem(resolved[index], decision);
        decision.contextItemId = contextItem.id;
        decision.characterCount = contextItem.text.length;
        return contextItem;
      })
      .filter((item): item is ContextItem => Boolean(item));
    const plan: ContextDeliveryPlan = {
      id: planId,
      runId: options.runId,
      sessionId: options.sessionId ?? context.sessionId,
      kernelId,
      createdAt: new Date().toISOString(),
      query: input,
      decisions,
      metadata: {
        resolvedCount: resolved.length,
        promptItemCount: items.length,
      },
    };

    if (options.recordDelivery !== false) {
      this.recordDelivery(plan);
    }

    return {
      plan,
      items,
    };
  }

  recordDelivery(plan: ContextDeliveryPlan): void {
    this.options.store.recordDelivery(plan);
  }
}

export function createKnowledgeContextPlanner(
  options: KnowledgeContextPlannerOptions,
): KnowledgeContextPlanner {
  return new KnowledgeContextPlanner(options);
}

function createDeliveryDecision(
  resolved: ResolvedKnowledgeDocument,
  context: AgentContext,
  kernelCapabilities?: KernelCapabilities,
  kernelId?: string,
): KnowledgeDeliveryDecision {
  const document = resolved.document;
  const mode = chooseDeliveryMode(resolved, context, kernelCapabilities, kernelId);
  return {
    knowledgeId: document.id,
    knowledgeType: document.type,
    title: document.title,
    mode,
    reason: explainDeliveryMode(mode, resolved.reason),
    score: resolved.score,
    includeInPrompt: shouldIncludeInPrompt(mode),
    metadata: {
      slug: document.slug,
      scope: document.scope,
      tags: document.tags.join(","),
      sourceRefCount: document.sourceRefs.length,
    },
  };
}

function chooseDeliveryMode(
  resolved: ResolvedKnowledgeDocument,
  context: AgentContext,
  kernelCapabilities?: KernelCapabilities,
  kernelId?: string,
): KnowledgeDeliveryMode {
  const document = resolved.document;
  if (document.type === "artifact_ref") {
    return "artifact_handle";
  }

  if (document.type !== "skill") {
    return "prompt_snippet";
  }

  if (
    kernelCapabilities?.knowledge?.nativeSkills &&
    hasNativeSkillTarget(document.metadata, kernelId)
  ) {
    return "native_skill";
  }

  const activeSkillId = context.workingState.get().activeSkillId;
  if (
    activeSkillId &&
    typeof document.metadata.skillId === "string" &&
    document.metadata.skillId === activeSkillId
  ) {
    return "loaded_skill";
  }

  if (kernelCapabilities?.knowledge?.toolMediatedSkills !== false && kernelCapabilities?.toolCalls !== false) {
    return "skill_tool_hint";
  }

  return "prompt_snippet";
}

function hasNativeSkillTarget(metadata: JsonObject, kernelId?: string): boolean {
  const targets = metadata.nativeSkillTargets;
  if (!Array.isArray(targets)) {
    return false;
  }
  return targets.some((target) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return false;
    }
    const record = target as JsonObject;
    return (
      typeof record.targetSkillRoot === "string" &&
      record.targetSkillRoot.length > 0 &&
      (typeof kernelId !== "string" || record.kernelId === kernelId)
    );
  });
}

function explainDeliveryMode(mode: KnowledgeDeliveryMode, baseReason: string): string {
  if (mode === "loaded_skill") {
    return `${baseReason}; active skill body is delivered through requestedSkillInvocation, not duplicated in context`;
  }
  if (mode === "native_skill") {
    return `${baseReason}; kernel has a native skill loader`;
  }
  if (mode === "skill_tool_hint") {
    return `${baseReason}; model can call skill.invoke for progressive disclosure`;
  }
  if (mode === "artifact_handle") {
    return `${baseReason}; artifact is delivered as a handle and preview`;
  }
  if (mode === "suppressed_duplicate") {
    return `${baseReason}; duplicate context was suppressed`;
  }
  return baseReason;
}

function shouldIncludeInPrompt(mode: KnowledgeDeliveryMode): boolean {
  return mode === "prompt_snippet" || mode === "artifact_handle";
}

function deliveryDecisionToContextItem(
  resolved: ResolvedKnowledgeDocument,
  decision: KnowledgeDeliveryDecision,
): ContextItem {
  const base = knowledgeDocumentToContextItem(resolved);
  return {
    ...base,
    data: {
      ...(base.data ?? {}),
      deliveryMode: decision.mode,
      deliveryReason: decision.reason,
    } as JsonObject,
  };
}
