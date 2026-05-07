import type {
  AgentContext,
  ContextItem,
  ContextItemKind,
} from "../core.js";
import type { KnowledgeStore } from "./store.js";
import type {
  KnowledgeDocument,
  KnowledgeDocumentType,
  ResolvedKnowledgeDocument,
} from "./types.js";

export interface KnowledgeResolverOptions {
  store: KnowledgeStore;
  defaultLimit?: number;
}

export interface ResolveKnowledgeOptions {
  limit?: number;
  types?: KnowledgeDocumentType[];
}

export class KnowledgeResolver {
  constructor(private readonly options: KnowledgeResolverOptions) {}

  resolve(
    input: string,
    context: AgentContext,
    options: ResolveKnowledgeOptions = {},
  ): ResolvedKnowledgeDocument[] {
    const limit = options.limit ?? this.options.defaultLimit ?? 4;
    const query = buildQuery(input, context);
    const workingState = context.workingState.get();
    const workingArtifactIds = new Set([
      ...workingState.pinnedArtifactIds,
      ...workingState.workingArtifactIds,
    ]);
    const activeSkillId = workingState.activeSkillId;
    const documents = this.options.store.search(query, {
      types: options.types,
      lifecycle: "active",
      limit: Math.max(limit * 4, 12),
    })
      .filter((document) => !isDuplicateWorkingArtifactRef(document, workingArtifactIds))
      .filter((document) => shouldAutoResolveDocument(document, query, activeSkillId));

    return documents
      .map((document) => ({
        document,
        score: scoreResolvedDocument(document, query, activeSkillId),
        reason: buildReason(document),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || right.document.updatedAt.localeCompare(left.document.updatedAt))
      .slice(0, limit);
  }

  toContextItems(resolved: ResolvedKnowledgeDocument[]): ContextItem[] {
    return resolved.map((item) => knowledgeDocumentToContextItem(item));
  }
}

function shouldAutoResolveDocument(
  document: KnowledgeDocument,
  query: string,
  activeSkillId?: string,
): boolean {
  if (!isSkillFileSourceDocument(document)) {
    return true;
  }

  const skillId = typeof document.metadata.skillId === "string" ? document.metadata.skillId : "";
  if (activeSkillId && skillId === activeSkillId) {
    return true;
  }

  const skillName = typeof document.metadata.skillName === "string" ? document.metadata.skillName : "";
  return Boolean(skillName && mentionsSkillByName(query, skillName));
}

function isSkillFileSourceDocument(document: KnowledgeDocument): boolean {
  return document.type === "source" && document.tags.includes("skill-file");
}

function mentionsSkillByName(query: string, skillName: string): boolean {
  const normalizedQuery = query.toLowerCase();
  const normalizedSkillName = skillName.toLowerCase();
  return (
    normalizedQuery.includes(`/${normalizedSkillName}`) ||
    normalizedQuery.includes(` ${normalizedSkillName}`) ||
    normalizedQuery.includes(`\n${normalizedSkillName}`) ||
    normalizedQuery.trim() === normalizedSkillName
  );
}

function isDuplicateWorkingArtifactRef(
  document: KnowledgeDocument,
  workingArtifactIds: Set<string>,
): boolean {
  return (
    document.type === "artifact_ref" &&
    typeof document.metadata.artifactId === "string" &&
    workingArtifactIds.has(document.metadata.artifactId)
  );
}

export function createKnowledgeResolver(
  options: KnowledgeResolverOptions,
): KnowledgeResolver {
  return new KnowledgeResolver(options);
}

export function knowledgeDocumentToContextItem(
  resolved: ResolvedKnowledgeDocument,
): ContextItem {
  const document = resolved.document;
  return {
    id: `knowledge.${document.id}`,
    kind: mapKnowledgeTypeToContextKind(document.type),
    title: document.title,
    text: renderKnowledgeDocument(document, resolved.reason),
    score: resolved.score,
    source: document.sourceRefs[0],
    data: {
      knowledgeId: document.id,
      knowledgeType: document.type,
      slug: document.slug,
      scope: document.scope,
      lifecycle: document.lifecycle,
      tags: document.tags,
      reason: resolved.reason,
    },
  };
}

function buildQuery(input: string, context: AgentContext): string {
  const workingState = context.workingState.get();
  return [
    input,
    workingState.taskSummary ?? "",
    workingState.activeGoal ?? "",
    workingState.activeSkillId ?? "",
    context.page?.selection ?? "",
    context.page?.title ?? "",
    context.page?.url ?? "",
  ].join(" ");
}

function scoreResolvedDocument(
  document: KnowledgeDocument,
  query: string,
  activeSkillId?: string,
): number {
  const haystack = [
    document.id,
    document.slug,
    document.type,
    document.title,
    document.body,
    document.tags.join(" "),
    JSON.stringify(document.metadata),
  ]
    .join(" ")
    .toLowerCase();
  const tokens = tokenize(query);
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length > 8 ? 2 : 1;
    }
  }
  if (activeSkillId && document.type === "skill" && document.metadata.skillId === activeSkillId) {
    score += 10;
  }
  if (document.type === "memory") {
    score += 0.5;
  }
  if (document.type === "artifact_ref") {
    score += 0.25;
  }
  return score;
}

function buildReason(document: KnowledgeDocument): string {
  if (document.type === "skill") return "Relevant skill document";
  if (document.type === "memory") return "Relevant memory document";
  if (document.type === "artifact_ref") return "Relevant artifact reference";
  return `Relevant ${document.type}`;
}

function renderKnowledgeDocument(document: KnowledgeDocument, reason: string): string {
  return [
    `Type: ${document.type}`,
    `Scope: ${document.scope}`,
    `Reason: ${reason}`,
    document.tags.length ? `Tags: ${document.tags.join(", ")}` : "",
    document.body,
  ]
    .filter(Boolean)
    .join("\n");
}

function mapKnowledgeTypeToContextKind(type: KnowledgeDocumentType): ContextItemKind {
  if (type === "memory") return "memory";
  if (type === "skill") return "skill";
  if (type === "artifact_ref") return "artifact";
  if (type === "routine") return "routine";
  return "knowledge";
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
