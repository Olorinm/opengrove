import { summarize } from "../../format";

export type KnowledgeFilterId = "all" | "skill" | "memory" | "project" | "source" | "review" | "low" | "recent";

export function isSkillFileDocument(document: any): boolean {
  return Boolean(document?.metadata?.parentSkillId && document?.metadata?.skillFilePath);
}

export function knowledgeVaultPath(document: any): string {
  const explicitVaultPath = safeVaultPath(document?.metadata?.vaultPath);
  if (explicitVaultPath) return explicitVaultPath;
  const sourceRoot = knowledgeSourceRoot(document);
  if (isSkillFileDocument(document)) {
    return `${sourceRoot}/skills/${safePathSegment(document.metadata?.skillName || document.metadata?.skillId || "skill")}/${String(document.metadata.skillFilePath || "file.md")}`;
  }
  if (document?.type === "skill") {
    return `${sourceRoot}/skills/${safePathSegment(document.metadata?.skillName || document.title || document.id)}/SKILL.md`;
  }
  if (needsKnowledgeReview(document)) {
    return `${sourceRoot}/inbox/${knowledgeFileName(document)}`;
  }
  if (document?.type === "memory") {
    return `${sourceRoot}/memories/${knowledgeFileName(document)}`;
  }
  if (document?.type === "artifact_ref") {
    return `${sourceRoot}/artifacts/${knowledgeFileName(document)}`;
  }
  if (document?.type === "project_doc") {
    return `${sourceRoot}/projects/${knowledgeFileName(document)}`;
  }
  if (document?.type === "profile") {
    return `${sourceRoot}/profiles/${knowledgeFileName(document)}`;
  }
  if (document?.type === "routine") {
    return `${sourceRoot}/routines/${knowledgeFileName(document)}`;
  }
  if (document?.type === "source") {
    return `${sourceRoot}/sources/${knowledgeFileName(document)}`;
  }
  return `${sourceRoot}/notes/${knowledgeFileName(document)}`;
}

export function knowledgeSourceRoot(document: any): string {
  const metadata = document?.metadata ?? {};
  const explicit = metadata.kernelId || metadata.kernel || metadata.sourceKernel;
  if (typeof explicit === "string" && explicit.trim()) {
    return normalizeKnowledgeSourceRoot(explicit);
  }
  const haystack = [
    metadata.skillRoot,
    metadata.entry,
    metadata.sourceFilePath,
    metadata.sourceFileOriginPath,
    ...(document?.sourceRefs ?? []).map((ref: any) => ref?.locator || ""),
  ].filter(Boolean).join("\n").replace(/\\/g, "/").toLowerCase();
  if (haystack.includes("/.claude/") || haystack.includes("/claude.md")) return "Claude";
  if (haystack.includes("/.hermes/")) return "Hermes";
  if (haystack.includes("/.codex/") || haystack.includes("/.agents/skills/")) return "Codex";
  return "OpenGrove";
}

export function normalizeKnowledgeSourceRoot(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude code") return "Claude";
  if (normalized === "codex") return "Codex";
  if (normalized === "hermes") return "Hermes";
  return "OpenGrove";
}

export function knowledgeFileName(document: any): string {
  const base = safePathSegment(document?.slug || document?.title || document?.id || "untitled");
  const extension = document?.format === "json" ? ".json" : document?.format === "plain" ? ".txt" : ".md";
  return base.endsWith(extension) ? base : `${base}${extension}`;
}

export function safePathSegment(value: unknown): string {
  return String(value || "untitled")
    .replace(/[\\/:*?"<>|#\n\r\t]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "untitled";
}

export function safeVaultPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") return undefined;
  return normalized;
}


export function artifactTitle(artifact: any): string {
  const asset = Array.isArray(artifact?.assets)
    ? artifact.assets.find((item: any) => typeof item?.title === "string" || typeof item?.uri === "string")
    : undefined;
  const uriTitle = fileNameFromAssetUri(asset?.uri || artifact?.data?.imageUri || artifact?.data?.filePath || "");
  return (
    artifact?.preview?.title ||
    artifact?.title ||
    artifact?.data?.fileName ||
    artifact?.data?.name ||
    asset?.title ||
    uriTitle ||
    artifact?.slug ||
    artifact?.id ||
    "生成结果"
  );
}

export function artifactKind(artifact: any): string {
  const mimeType = String(artifact?.preview?.mimeType || artifact?.data?.mimeType || artifact?.assets?.[0]?.mimeType || "").toLowerCase();
  const type = String(artifact?.type || "").toLowerCase();
  const title = artifactTitle(artifact).toLowerCase();
  if (type.includes("image") || mimeType.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg)$/.test(title)) return "image";
  if (type.includes("audio") || mimeType.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/.test(title)) return "audio";
  if (type.includes("video") || mimeType.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mkv)$/.test(title)) return "video";
  if (type.includes("markdown") || mimeType.includes("markdown") || /\.md$/.test(title)) return "markdown";
  if (type.includes("text") || mimeType.startsWith("text/") || /\.(txt|json|csv|tsv|yaml|yml)$/.test(title)) return "text";
  return "file";
}


export function emptyKnowledgeLedgers() {
  return {
    evidence: [],
    revisions: [],
    deliveries: [],
    feedback: [],
  };
}

export function filterKnowledgeDocuments(documents: any[], activeFilter: KnowledgeFilterId, query: string): any[] {
  const needle = query.trim().toLowerCase();
  const base = [...(Array.isArray(documents) ? documents : [])]
    .filter((document) => {
      if (!document) return false;
      if (activeFilter === "skill" && document.type !== "skill") return false;
      if (activeFilter === "memory" && document.type !== "memory") return false;
      if (activeFilter === "project" && !["project_doc", "note", "profile", "routine"].includes(document.type)) return false;
      if (activeFilter === "source" && !["source", "artifact_ref"].includes(document.type)) return false;
      if (activeFilter === "review" && !needsKnowledgeReview(document)) return false;
      if (activeFilter === "low" && !isLowConfidence(document)) return false;
      if (needle && !knowledgeSearchText(document).includes(needle)) return false;
      return true;
  });
  if (activeFilter === "recent" && !needle) {
    const nonSkill = base.filter((document) => document?.type !== "skill");
    return (nonSkill.length ? nonSkill : base).sort(sortKnowledgeDocumentsForView).slice(0, 12);
  }
  return base.sort(sortKnowledgeDocumentsForView);
}

export function filterVaultDocuments(documents: any[], query: string): any[] {
  const needle = query.trim().toLowerCase();
  const base = (Array.isArray(documents) ? documents.filter(Boolean) : []).filter(
    (document) => !isAutoToolResultArtifact(document),
  );
  if (!needle) {
    return base.sort((left, right) => knowledgeVaultPath(left).localeCompare(knowledgeVaultPath(right), "zh-CN"));
  }
  return base
    .filter((document) => {
      const haystack = [knowledgeVaultPath(document), knowledgeSearchText(document)].join("\n").toLowerCase();
      return haystack.includes(needle);
    })
    .sort((left, right) => knowledgeVaultPath(left).localeCompare(knowledgeVaultPath(right), "zh-CN"));
}

export function isAutoToolResultArtifact(document: any): boolean {
  if (document?.type !== "artifact_ref") {
    return false;
  }
  const tags = Array.isArray(document.tags) ? document.tags.map((tag: unknown) => String(tag).toLowerCase()) : [];
  const metadata = document.metadata && typeof document.metadata === "object" ? document.metadata : {};
  const source = [
    String(metadata.source || ""),
    String(metadata.sourceToolId || ""),
    String(metadata.toolId || ""),
    String(metadata.artifactId || ""),
    String(document.id || ""),
  ].join("\n").toLowerCase();
  return (tags.includes("auto") && tags.includes("tool-result")) || source.includes("codex.commandexecution");
}

export function filterWikiDocuments(documents: any[], query: string, tag: string, type: string): any[] {
  const needle = query.trim().toLowerCase();
  return (Array.isArray(documents) ? documents : [])
    .filter((document) => {
      if (!document) return false;
      if (type && document.type !== type) return false;
      if (tag && !Array.isArray(document.tags)) return false;
      if (tag && !document.tags.includes(tag)) return false;
      if (needle && !knowledgeSearchText(document).includes(needle)) return false;
      return true;
    })
    .sort(sortKnowledgeDocumentsForView);
}

export function buildWikiTagFacets(documents: any[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const document of Array.isArray(documents) ? documents : []) {
    for (const tag of Array.isArray(document?.tags) ? document.tags : []) {
      const normalized = String(tag || "").trim();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, "zh-CN"));
}

export function buildWikiTypeFacets(documents: any[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const document of Array.isArray(documents) ? documents : []) {
    const type = String(document?.type || "note");
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => knowledgeDisplayPriority({ type: left.type }) - knowledgeDisplayPriority({ type: right.type }));
}

export function sortKnowledgeDocumentsForView(left: any, right: any): number {
  const priorityDelta = knowledgeDisplayPriority(left) - knowledgeDisplayPriority(right);
  if (priorityDelta !== 0) return priorityDelta;
  return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
}

export function knowledgeDisplayPriority(document: any): number {
  if (!document) return 99;
  if (document.type === "memory") return 0;
  if (document.type === "project_doc" || document.type === "note" || document.type === "profile") return 1;
  if (document.type === "artifact_ref") return 2;
  if (document.type === "source") return 3;
  if (document.type === "skill" && !isSystemSkillDocument(document)) return 4;
  if (document.type === "routine") return 5;
  if (document.type === "skill") return 8;
  return 6;
}

export function isSystemSkillDocument(document: any): boolean {
  if (document?.type !== "skill") return false;
  const source = String(document?.metadata?.source || "");
  const skillRoot = String(document?.metadata?.skillRoot || "");
  const entry = String(document?.metadata?.entry || "");
  return source === "system" || source === "bundled" || skillRoot.includes("/.codex/skills/.system/") || entry.includes("/.codex/skills/.system/");
}

export function knowledgeSearchText(document: any): string {
  return [
    document?.id,
    document?.title,
    document?.slug,
    document?.body,
    document?.type,
    document?.scope,
    ...(Array.isArray(document?.tags) ? document.tags : []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function knowledgeDisplaySummary(document: any, maxLength = 140): string {
  const body = String(document?.body || "").trim();
  if (!body) return "";
  if (document?.type === "artifact_ref") {
    const preview = extractLabeledLine(body, "Preview text");
    const title = extractLabeledLine(body, "Title");
    const dataText = extractJsonTextField(extractLabeledLine(body, "Data"));
    return summarize([preview, dataText, title].find(Boolean) || body, maxLength);
  }
  if (document?.type === "skill") {
    const description = extractLabeledLine(body, "Description");
    const when = extractLabeledLine(body, "When to use");
    return summarize([description, when].filter(Boolean).join(" · ") || body, maxLength);
  }
  return summarize(body, maxLength);
}

export function knowledgeEditableBody(document: any): string {
  const body = String(document?.body || "").trim();
  if (!body) return "";
  if (document?.type === "artifact_ref") {
    const preview = extractLabeledLine(body, "Preview text");
    const dataText = extractJsonTextField(extractLabeledLine(body, "Data"));
    const title = extractLabeledLine(body, "Title");
    return [preview, dataText, title].find(Boolean) || "";
  }
  if (document?.type === "skill") {
    const description = extractLabeledLine(body, "Description");
    const when = extractLabeledLine(body, "When to use");
    const readable = [description, when].filter(Boolean).join("\n\n");
    return readable || body;
  }
  return body;
}

export function extractLabeledLine(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`(?:^|\\n)${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

export function extractJsonTextField(value: string): string {
  if (!value.trim().startsWith("{")) return "";
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

export function knowledgeBadges(document: any): string[] {
  const badges = [knowledgeTypeLabel(document?.type)];
  const status = knowledgeStatusLabel(document);
  if (status !== "生效中") {
    badges.push(status);
  }
  const confidence = numericConfidence(document?.confidence);
  if (typeof confidence === "number" && (confidence < 0.9 || document?.type !== "skill")) {
    badges.push(confidenceLabel(confidence));
  }
  if (document?.type === "skill" && extractNativeTargets(document).length) {
    badges.push("native");
  }
  return [...new Set(badges.filter(Boolean))];
}

export function parseTagDraft(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

export function needsKnowledgeReview(document: any): boolean {
  if (!document) return false;
  if (document.lifecycle && document.lifecycle !== "active") return true;
  if (document.type === "source" && document.metadata?.organizerRole === "raw_evidence") return true;
  if (isLowConfidence(document)) return true;
  return false;
}

export function isLowConfidence(document: any): boolean {
  const confidence = numericConfidence(document?.confidence);
  return typeof confidence === "number" && confidence < 0.65;
}

export function numericConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

export function confidenceLabel(value: unknown): string {
  const confidence = numericConfidence(value);
  return typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : "未评分";
}

export function knowledgeStatusLabel(document: any): string {
  if (!document) return "未知";
  if (document.lifecycle === "draft") return "待确认";
  if (document.lifecycle === "archived") return "已归档";
  if (isLowConfidence(document)) return "低可信";
  return "生效中";
}

export function knowledgeTypeLabel(type: string | undefined): string {
  return (
    {
      skill: "能力",
      memory: "记忆",
      note: "笔记",
      project_doc: "项目资料",
      artifact_ref: "产物引用",
      routine: "流程",
      profile: "画像",
      source: "来源",
    }[type || ""] || type || "页面"
  );
}

export function knowledgeTypeGlyph(type: string | undefined): string {
  return (
    {
      skill: "✦",
      memory: "●",
      note: "◇",
      project_doc: "□",
      artifact_ref: "▣",
      routine: "↻",
      profile: "◎",
      source: "⌁",
    }[type || ""] || "·"
  );
}

export function buildKnowledgeInboxItems(documents: any[], ledgers: any) {
  const items = new Map<string, { id: string; document: any; title: string; reason: string; detail: string; tone: string }>();
  const dismissedByFeedback = new Set(
    latestFeedbackByKnowledge(ledgers)
      .filter((event) => event.signal === "useful" || event.signal === "ignored")
      .map((event) => event.knowledgeId),
  );
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document) continue;
    if (dismissedByFeedback.has(document.id)) continue;
    if (document.lifecycle && document.lifecycle !== "active") {
      items.set(`${document.id}:lifecycle`, {
        id: `${document.id}:lifecycle`,
        document,
        title: document.title || document.id,
        reason: "待确认页面",
        detail: summarize(document.body || "这条知识还没有进入生效状态。", 180),
        tone: "review",
      });
    }
    if (document.type === "source" && document.metadata?.organizerRole === "raw_evidence") {
      items.set(`${document.id}:source`, {
        id: `${document.id}:source`,
        document,
        title: document.title || "原始证据",
        reason: "原始证据待整理",
        detail: summarize(document.body || "这条 evidence 还没有被整理成稳定页面。", 180),
        tone: "source",
      });
    }
    if (isLowConfidence(document)) {
      items.set(`${document.id}:low`, {
        id: `${document.id}:low`,
        document,
        title: document.title || document.id,
        reason: "低可信，需要复查",
        detail: summarize(document.body || "这条知识的 confidence 偏低。", 180),
        tone: "low",
      });
    }
  }

  for (const event of ledgerArray(ledgers, "feedback")) {
    if (event.signal !== "corrected" && event.signal !== "stale") continue;
    const document = documents.find((item) => item?.id === event.knowledgeId);
    if (!document) continue;
    items.set(`${event.knowledgeId}:feedback:${event.id}`, {
      id: `${event.knowledgeId}:feedback:${event.id}`,
      document,
      title: document.title || document.id,
      reason: event.signal === "stale" ? "近期被标记过期" : "近期被标记不准确",
      detail: event.note || summarize(document.body || "", 180),
      tone: event.signal,
    });
  }

  return Array.from(items.values()).sort((left, right) =>
    String(right.document.updatedAt || "").localeCompare(String(left.document.updatedAt || "")),
  );
}

export function latestFeedbackByKnowledge(ledgers: any): any[] {
  const latest = new Map<string, any>();
  for (const event of ledgerArray(ledgers, "feedback")) {
    if (!event?.knowledgeId) continue;
    const previous = latest.get(event.knowledgeId);
    if (!previous || String(event.createdAt || "").localeCompare(String(previous.createdAt || "")) > 0) {
      latest.set(event.knowledgeId, event);
    }
  }
  return Array.from(latest.values());
}

export function buildKnowledgeTimeline(document: any, ledgers: any) {
  const knowledgeId = document?.id;
  if (!knowledgeId) return [];
  const evidence = ledgerArray(ledgers, "evidence")
    .filter((item) => item.knowledgeId === knowledgeId)
    .map((item) => ({
      id: item.id,
      kind: "evidence",
      title: "证据",
      detail: item.summary || item.kind,
      at: item.observedAt || item.createdAt,
    }));
  const revisions = ledgerArray(ledgers, "revisions")
    .filter((item) => item.knowledgeId === knowledgeId)
    .map((item) => ({
      id: item.id,
      kind: "revision",
      title: revisionOperationLabel(item.operation),
      detail: summarize(item.bodyPreview || item.title || "", 80),
      at: item.createdAt,
    }));
  const deliveries = ledgerArray(ledgers, "deliveries")
    .filter((item) => item.knowledgeId === knowledgeId)
    .map((item) => ({
      id: item.id,
      kind: "delivery",
      title: deliveryModeLabel(item.mode),
      detail: item.reason,
      at: item.createdAt,
    }));
  const feedback = ledgerArray(ledgers, "feedback")
    .filter((item) => item.knowledgeId === knowledgeId)
    .map((item) => ({
      id: item.id,
      kind: "feedback",
      title: feedbackSignalLabel(item.signal),
      detail: item.note || (typeof item.scoreDelta === "number" ? `score ${item.scoreDelta}` : ""),
      at: item.createdAt,
    }));
  return [...evidence, ...revisions, ...deliveries, ...feedback]
    .filter((item) => item.id)
    .sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")));
}

export function ledgerArray(ledgers: any, key: "evidence" | "revisions" | "deliveries" | "feedback"): any[] {
  return Array.isArray(ledgers?.[key]) ? ledgers[key] : [];
}

export function revisionOperationLabel(operation: string | undefined): string {
  if (operation === "create") return "创建";
  if (operation === "update") return "更新";
  if (operation === "archive") return "归档";
  if (operation === "delete") return "删除";
  if (operation === "sync") return "同步";
  return operation || "变更";
}

export function deliveryModeLabel(mode: string | undefined): string {
  if (mode === "native_skill") return "Native Skill";
  if (mode === "prompt_snippet") return "Prompt 片段";
  if (mode === "skill_tool_hint") return "Skill 工具提示";
  if (mode === "artifact_handle") return "Artifact Handle";
  if (mode === "suppressed_duplicate") return "避免重复投喂";
  return mode || "交付";
}

export function feedbackSignalLabel(signal: string | undefined): string {
  if (signal === "useful") return "反馈：有用";
  if (signal === "ignored") return "反馈：忽略";
  if (signal === "corrected") return "反馈：不准确";
  if (signal === "stale") return "反馈：过期";
  if (signal === "promoted") return "反馈：提升";
  if (signal === "demoted") return "反馈：降权";
  return signal || "反馈";
}

export function extractNativeTargets(document: any): string[] {
  const candidates = [
    document?.metadata?.nativeTarget,
    document?.metadata?.nativeTargets,
    document?.metadata?.publishedTargets,
    document?.metadata?.nativeSkillPath,
  ];
  const values: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      values.push(...candidate.split(",").map((item) => item.trim()));
    } else if (Array.isArray(candidate)) {
      values.push(...candidate.filter((item): item is string => typeof item === "string"));
    }
  }
  return [...new Set(values.filter(Boolean))];
}

export function buildKnowledgeRelationRows(document: any, relatedArtifacts: any[]): Array<{ id: string; title: string; kind: string; targetId?: string }> {
  const rows: Array<{ id: string; title: string; kind: string; targetId?: string }> = [];
  for (const link of Array.isArray(document?.links) ? document.links : []) {
    rows.push({
      id: `link:${link.targetId || link.title || rows.length}`,
      title: link.title || link.targetId || "未命名页面",
      kind: link.relation || "链接",
      targetId: link.targetId,
    });
  }
  for (const link of Array.isArray(document?.backlinks) ? document.backlinks : []) {
    rows.push({
      id: `backlink:${link.targetId || rows.length}`,
      title: link.title || link.targetId || "未命名页面",
      kind: "反链",
      targetId: link.targetId,
    });
  }
  for (const artifact of relatedArtifacts) {
    rows.push({
      id: `artifact:${artifact.id}`,
      title: artifactTitle(artifact),
      kind: "产物",
    });
  }
  return rows;
}

export function buildWikiReferenceGroups(
  document: any,
  documents: any[],
  artifacts: any[],
): Array<{ id: string; title: string; rows: Array<{ id: string; title: string; kind: string; targetId?: string }> }> {
  if (!document?.id) {
    return [
      { id: "outbound", title: "出链", rows: [] },
      { id: "backlinks", title: "反链", rows: [] },
      { id: "artifacts", title: "关联产物", rows: [] },
    ];
  }

  const allDocuments = Array.isArray(documents) ? documents.filter(Boolean) : [];
  const explicitTargets = new Set<string>();
  for (const link of Array.isArray(document.links) ? document.links : []) {
    if (typeof link?.targetId === "string" && link.targetId) {
      explicitTargets.add(link.targetId);
    }
  }
  for (const target of extractWikiLinkTargets(String(document.body || ""))) {
    const matched = findKnowledgeDocumentByWikiTarget(allDocuments, target);
    if (matched?.id) explicitTargets.add(matched.id);
  }

  const outbound = Array.from(explicitTargets)
    .map((targetId) => allDocuments.find((candidate) => candidate.id === targetId))
    .filter(Boolean)
    .map((target) => ({
      id: `out:${target.id}`,
      title: target.title || target.slug || target.id,
      kind: knowledgeTypeLabel(target.type),
      targetId: target.id,
    }));

  const backlinks = allDocuments
    .filter((candidate) => candidate.id !== document.id && documentReferencesKnowledge(candidate, document, allDocuments))
    .map((candidate) => ({
      id: `back:${candidate.id}`,
      title: candidate.title || candidate.slug || candidate.id,
      kind: knowledgeTypeLabel(candidate.type),
      targetId: candidate.id,
    }));

  const artifactRows = relatedArtifactsForKnowledge(document, artifacts).map((artifact) => ({
    id: `artifact:${artifact.id}`,
    title: artifactTitle(artifact),
    kind: "产物",
  }));

  return [
    { id: "outbound", title: "出链", rows: dedupeWikiRows(outbound) },
    { id: "backlinks", title: "反链", rows: dedupeWikiRows(backlinks) },
    { id: "artifacts", title: "关联产物", rows: dedupeWikiRows(artifactRows) },
  ];
}

export function documentReferencesKnowledge(candidate: any, target: any, documents: any[]): boolean {
  if (!candidate || !target?.id) return false;
  if (Array.isArray(candidate.links) && candidate.links.some((link: any) => link?.targetId === target.id)) {
    return true;
  }
  const wikiTargets = extractWikiLinkTargets(String(candidate.body || ""));
  return wikiTargets.some((wikiTarget) => findKnowledgeDocumentByWikiTarget(documents, wikiTarget)?.id === target.id);
}

export function extractWikiLinkTargets(body: string): string[] {
  const targets: string[] = [];
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    const target = match[1]?.trim();
    if (target) targets.push(target);
  }
  return [...new Set(targets)];
}

export function findKnowledgeDocumentByWikiTarget(documents: any[], target: string): any | undefined {
  const normalized = normalizeWikiTarget(target);
  return documents.find((document) =>
    [document?.id, document?.slug, document?.title, knowledgeVaultPath(document)]
      .filter(Boolean)
      .some((value) => normalizeWikiTarget(String(value)) === normalized),
  );
}

export function normalizeWikiTarget(value: string): string {
  return value.trim().replace(/\.md$/i, "").replace(/^\/+/, "").toLowerCase();
}

export function dedupeWikiRows<T extends { id: string; targetId?: string; title: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.targetId || row.id || row.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function relatedArtifactsForKnowledge(document: any, artifacts: any[]): any[] {
  const artifactIds = new Set<string>();
  for (const value of [
    document?.metadata?.artifactId,
    document?.metadata?.artifact_id,
    document?.metadata?.parentArtifactId,
  ]) {
    if (typeof value === "string" && value) artifactIds.add(value);
  }
  for (const link of Array.isArray(document?.links) ? document.links : []) {
    if (typeof link?.targetId === "string" && link.targetId.startsWith("artifact")) {
      artifactIds.add(link.targetId.replace(/^artifact:/, ""));
    }
  }
  return artifacts.filter((artifact) => artifactIds.has(artifact?.id));
}

export function relatedKnowledgeForArtifact(artifact: any, documents: any[]): any[] {
  const artifactId = artifact?.id;
  if (!artifactId) return [];
  return documents.filter((document) => {
    if (!document) return false;
    if (document.type === "artifact_ref" && String(document.metadata?.artifactId || document.metadata?.artifact_id || "").includes(artifactId)) return true;
    if (Array.isArray(document.links) && document.links.some((link: any) => String(link?.targetId || "").includes(artifactId))) return true;
    if (String(document.body || "").includes(artifactId)) return true;
    return false;
  });
}

export function artifactImagePreview(artifact: any): string {
  const imageAsset = Array.isArray(artifact?.assets)
    ? artifact.assets.find((asset: any) => asset?.kind === "image" && typeof asset.uri === "string")
    : null;
  return artifact?.preview?.imageUri || artifact?.data?.imageUri || imageAsset?.uri || "";
}



function fileNameFromAssetUri(uri: string): string {
  const text = String(uri || "");
  if (!text) return "";
  try {
    const url = new URL(text, globalThis.location?.origin || "http://localhost");
    const part = url.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(part);
  } catch {
    return text.split("/").filter(Boolean).pop() || "";
  }
}
