import { apiUrl } from "../../api-base";
import type { ContextArtifactPayload, VisualAnnotation, VisualAnnotationStatus, DeveloperSession } from "../../bridge";

export const VISUAL_ACTION_BLOCK_LANGUAGE = "opengrove-visual-actions";

const VISUAL_ANNOTATION_STATUSES = new Set<VisualAnnotationStatus>([
  "pending",
  "acknowledged",
  "replied",
  "resolved",
  "dismissed",
]);

export interface VisualAnnotationAction {
  annotationId: string;
  status?: VisualAnnotationStatus;
  reply?: string;
}

export function visualAnnotationContextArtifact(session: DeveloperSession, annotation: VisualAnnotation): ContextArtifactPayload {
  const index = Math.max(0, session.annotations.findIndex((item) => item.id === annotation.id)) + 1;
  return {
    id: `visual-annotation:${annotation.id}`,
    title: `标注 #${index} · ${visualAnnotationKindLabel(annotation.kind)}`,
    type: "visual_annotation",
    summary: visualAnnotationCompactLine(session, annotation, index - 1),
  };
}

export function mergeVisualAnnotationArtifacts(artifacts: ContextArtifactPayload[], session: DeveloperSession): ContextArtifactPayload[] {
  const aggregate = visualAnnotationsContextArtifact(session);
  if (!aggregate) return artifacts;
  return [
    ...artifacts.filter((artifact) =>
      !artifact.id.startsWith("visual-annotation:") &&
      artifact.id !== aggregate.id
    ),
    aggregate,
  ];
}

export function extractVisualAnnotationActions(answer: string): {
  answer: string;
  actions: VisualAnnotationAction[];
} {
  const actions: VisualAnnotationAction[] = [];
  const blockPattern = new RegExp(`\`\`\`${VISUAL_ACTION_BLOCK_LANGUAGE}\\s*([\\s\\S]*?)\`\`\``, "gi");
  const cleaned = answer.replace(blockPattern, (_match, body: string) => {
    actions.push(...parseVisualAnnotationActions(body));
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { answer: cleaned, actions };
}

function visualAnnotationsContextArtifact(session: DeveloperSession): ContextArtifactPayload | undefined {
  const annotations = visualActionableAnnotations(session);
  if (!annotations.length) return undefined;
  return {
    id: `visual-annotations:${session.id}`,
    title: `视觉标注 · ${annotations.length} 条待处理`,
    type: "visual_annotations",
    summary: [
      `开发会话：${session.title}`,
      `Target Root：${session.targetRoot}`,
      `Preview URL：${session.targetUrl}`,
      `详情：${developerSessionContextUrl(session.id)}`,
      visualAnnotationActionHint(),
      "",
      ...annotations.map((annotation) => visualAnnotationCompactLine(session, annotation, session.annotations.indexOf(annotation))),
    ].join("\n").trim(),
  };
}

function visualAnnotationTargetLines(annotation: VisualAnnotation): string[] {
  const target = annotation.target ? recordFromUnknown(annotation.target) : {};
  if (!Object.keys(target).length) return ["target=none"];
  const capture = recordFromUnknown(target.capture);
  const lines: string[] = [];
  const captureStatus = stringFromUnknown(capture.status);
  const captureReason = stringFromUnknown(capture.reason);
  if (captureStatus && captureStatus !== "ok") {
    lines.push(`capture=${captureStatus}${captureReason ? `(${captureReason})` : ""}`);
  }
  addTargetLine(lines, "selector", target.selector, 160);
  addTargetLine(lines, "tag", target.tagName, 40);
  addTargetLine(lines, "role", target.role, 40);
  addTargetLine(lines, "label", target.ariaLabel, 120);
  addTargetLine(lines, "text", target.text, 160);
  addTargetLine(lines, "react", target.reactPath, 180);
  addTargetLine(lines, "source", target.sourceHint || target.sourceFile, 180);
  return lines;
}

function visualAnnotationCompactLine(session: DeveloperSession, annotation: VisualAnnotation, index: number): string {
  const copy = compactText(annotation.comment || annotation.transcript || "", 220) || "no comment";
  const target = visualAnnotationTargetLines(annotation).join("; ");
  return [
    `#${index + 1}`,
    `id=${annotation.id}`,
    `status=${visualAnnotationStatus(annotation)}`,
    `kind=${visualAnnotationKindLabel(annotation.kind)}`,
    `comment="${copy}"`,
    `url=${compactText(annotation.url || session.targetUrl, 180)}`,
    visualAnnotationGeometry(annotation),
    target ? `target: ${target}` : "",
  ].filter(Boolean).join(" | ");
}

function visualActionableAnnotations(session: DeveloperSession): VisualAnnotation[] {
  return session.annotations.filter((annotation) => {
    const status = visualAnnotationStatus(annotation);
    return status !== "resolved" && status !== "dismissed";
  });
}

function visualAnnotationStatus(annotation: VisualAnnotation): VisualAnnotationStatus {
  return annotation.status ?? "pending";
}

function developerSessionContextUrl(sessionId: string): string {
  const path = `/developer/sessions/${encodeURIComponent(sessionId)}/context`;
  const url = apiUrl(path);
  if (/^\//.test(url) && typeof window !== "undefined") {
    return new URL(url, window.location.origin).toString();
  }
  return url;
}

function visualAnnotationActionHint(): string {
  return `Action block: \`\`\`${VISUAL_ACTION_BLOCK_LANGUAGE} [{"annotationId":"...","status":"resolved|dismissed|replied","reply":"..."}]\`\`\``;
}

function addTargetLine(lines: string[], label: string, value: unknown, maxLength = 120) {
  const text = stringFromUnknown(value);
  if (text) lines.push(`${label}="${compactText(text, maxLength)}"`);
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function visualAnnotationGeometry(annotation: VisualAnnotation): string {
  if (annotation.rect) {
    return `rect x=${Math.round(annotation.rect.x)}, y=${Math.round(annotation.rect.y)}, w=${Math.round(annotation.rect.width)}, h=${Math.round(annotation.rect.height)}; viewport ${annotation.viewport.width}x${annotation.viewport.height}`;
  }
  if (annotation.points?.length) {
    return `stroke points=${annotation.points.length}; viewport ${annotation.viewport.width}x${annotation.viewport.height}`;
  }
  return `viewport ${annotation.viewport.width}x${annotation.viewport.height}`;
}

function visualAnnotationKindLabel(kind: VisualAnnotation["kind"]): string {
  return ({
    box: "区域",
    element: "元素",
    note: "备注",
    stroke: "画线",
    voice: "语音",
  })[kind] ?? "标注";
}

function parseVisualAnnotationActions(value: string): VisualAnnotationAction[] {
  const parsed = parseJsonLike(value);
  const items = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const actions: VisualAnnotationAction[] = [];
  for (const item of items) {
    const object = recordFromUnknown(item);
    const annotationId = stringFromUnknown(object.annotationId || object.id);
    if (!annotationId) continue;
    const status = normalizeVisualAnnotationStatus(object.status);
    const reply = stringFromUnknown(object.reply || object.message || object.comment);
    actions.push({ annotationId, status, reply: reply || undefined });
  }
  return actions;
}

function parseJsonLike(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = Math.min(...[trimmed.indexOf("["), trimmed.indexOf("{")].filter((index) => index >= 0));
    const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));
    if (!Number.isFinite(start) || start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

function normalizeVisualAnnotationStatus(value: unknown): VisualAnnotationStatus | undefined {
  const status = stringFromUnknown(value);
  return VISUAL_ANNOTATION_STATUSES.has(status as VisualAnnotationStatus)
    ? status as VisualAnnotationStatus
    : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
