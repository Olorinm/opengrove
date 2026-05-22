import type {
  VisualAnnotation,
  VisualAnnotationKind,
  VisualAnnotationPoint,
  VisualAnnotationRect,
  VisualAnnotationTarget,
} from "../../bridge";

export type VisualTool = "select" | "element" | "box" | "stroke" | "note";

export const VISUAL_AI_RAIL_BOTTOM_STORAGE_KEY = "opengrove.visual.aiRailBottom.v1";
export const VISUAL_AI_RAIL_DEFAULT_BOTTOM = 72;
export const VISUAL_AI_RAIL_MIN_BOTTOM = 18;
export const VISUAL_AI_PANEL_WIDTH_STORAGE_KEY = "opengrove.visual.aiPanelWidth.v2";
export const VISUAL_AI_PANEL_DEFAULT_WIDTH = 360;
export const VISUAL_AI_PANEL_MIN_WIDTH = 300;
export const VISUAL_AI_PANEL_MAX_WIDTH = 680;

export interface VisualAnnotationInput {
  kind: VisualAnnotationKind;
  comment?: string;
  transcript?: string;
  url?: string;
  viewport?: { width: number; height: number };
  rect?: VisualAnnotationRect;
  points?: VisualAnnotationPoint[];
  target?: VisualAnnotationTarget;
}

export type Gesture =
  | { kind: "box" | "note"; start: VisualAnnotationPoint; current: VisualAnnotationPoint; viewport: { width: number; height: number } }
  | { kind: "stroke"; points: VisualAnnotationPoint[]; viewport: { width: number; height: number } };

export type PendingAnnotationDraft = VisualAnnotationInput & {
  kind: VisualAnnotationKind;
  viewport: { width: number; height: number };
  anchor: VisualAnnotationPoint;
};

export type HoverTarget = {
  rect: VisualAnnotationRect;
  viewport: { width: number; height: number };
  label: string;
};

export type AiRailDrag = {
  startClientY: number;
  startBottom: number;
  railHeight: number;
  tabHeight: number;
  moved: boolean;
};

export type AiPanelResize = {
  startClientX: number;
  startWidth: number;
};

export function rectToStyle(rect: VisualAnnotationRect, viewport: { width: number; height: number }) {
  return {
    left: `${(rect.x / viewport.width) * 100}%`,
    top: `${(rect.y / viewport.height) * 100}%`,
    width: `${(rect.width / viewport.width) * 100}%`,
    height: `${(rect.height / viewport.height) * 100}%`,
  };
}

export function pointToStyle(point: VisualAnnotationPoint, viewport: { width: number; height: number }) {
  return {
    left: `${(point.x / viewport.width) * 100}%`,
    top: `${(point.y / viewport.height) * 100}%`,
  };
}

export function annotationAnchor(rect: VisualAnnotationRect, viewport: { width: number; height: number }): VisualAnnotationPoint {
  return popupAnchor({
    x: rect.x + Math.min(rect.width, 220),
    y: rect.y + rect.height + 18,
  }, viewport);
}

export function popupAnchor(point: VisualAnnotationPoint, viewport: { width: number; height: number }): VisualAnnotationPoint {
  return {
    x: clamp(point.x, 16, Math.max(16, viewport.width - 286)),
    y: clamp(point.y, 24, Math.max(24, viewport.height - 190)),
  };
}

export function annotationRectFromTarget(
  target: VisualAnnotationTarget | undefined,
  viewport: { width: number; height: number },
  fallbackPoint: VisualAnnotationPoint,
): VisualAnnotationRect {
  const targetBox = normalizeTargetRect(target?.boundingBox) ?? normalizeTargetRect(target?.selectionRect);
  if (targetBox) {
    const width = clamp(targetBox.width, 8, viewport.width);
    const height = clamp(targetBox.height, 8, viewport.height);
    return {
      x: clamp(targetBox.x, 0, Math.max(0, viewport.width - width)),
      y: clamp(targetBox.y, 0, Math.max(0, viewport.height - height)),
      width,
      height,
    };
  }
  return {
    x: clamp(fallbackPoint.x - 18, 0, Math.max(0, viewport.width - 36)),
    y: clamp(fallbackPoint.y - 18, 0, Math.max(0, viewport.height - 36)),
    width: 36,
    height: 36,
  };
}

export function hoverTargetFromContext(
  target: VisualAnnotationTarget | undefined,
  viewport: { width: number; height: number },
  fallbackPoint: VisualAnnotationPoint,
): HoverTarget | null {
  const rect = annotationRectFromTarget(target, viewport, fallbackPoint);
  return {
    rect,
    viewport,
    label: targetLabel(target),
  };
}

export function annotationStatus(annotation: VisualAnnotation): NonNullable<VisualAnnotation["status"]> {
  return annotation.status ?? "pending";
}

export function pendingKindLabel(kind: VisualAnnotationKind): string {
  return ({
    box: "区域标注",
    element: "元素标注",
    note: "备注标注",
    stroke: "画线标注",
    voice: "语音标注",
  })[kind] ?? "标注";
}

export function normalizeRect(start: VisualAnnotationPoint, current: VisualAnnotationPoint, note: boolean): VisualAnnotationRect {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);
  if (note && width < 8 && height < 8) {
    return {
      x: Math.max(0, start.x - 14),
      y: Math.max(0, start.y - 14),
      width: 28,
      height: 28,
    };
  }
  return {
    x,
    y,
    width: Math.max(8, width),
    height: Math.max(8, height),
  };
}

export function readVisualAiRailBottom(): number {
  if (typeof window === "undefined") return VISUAL_AI_RAIL_DEFAULT_BOTTOM;
  const value = Number.parseFloat(window.localStorage.getItem(VISUAL_AI_RAIL_BOTTOM_STORAGE_KEY) || "");
  if (!Number.isFinite(value)) return VISUAL_AI_RAIL_DEFAULT_BOTTOM;
  return clamp(value, VISUAL_AI_RAIL_MIN_BOTTOM, 600);
}

export function writeVisualAiRailBottom(value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VISUAL_AI_RAIL_BOTTOM_STORAGE_KEY, String(Math.round(value)));
}

export function readVisualAiPanelWidth(): number {
  if (typeof window === "undefined") return VISUAL_AI_PANEL_DEFAULT_WIDTH;
  const value = Number.parseFloat(window.localStorage.getItem(VISUAL_AI_PANEL_WIDTH_STORAGE_KEY) || "");
  if (!Number.isFinite(value)) return VISUAL_AI_PANEL_DEFAULT_WIDTH;
  return clamp(value, VISUAL_AI_PANEL_MIN_WIDTH, VISUAL_AI_PANEL_MAX_WIDTH);
}

export function writeVisualAiPanelWidth(value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VISUAL_AI_PANEL_WIDTH_STORAGE_KEY, String(Math.round(value)));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function targetLabel(target: VisualAnnotationTarget | undefined): string {
  if (!target) return "element";
  const label = target.reactPath || target.selector || target.elementPath || target.tagName || "element";
  return label.length > 64 ? `${label.slice(0, 63)}…` : label;
}

function normalizeTargetRect(value: unknown): VisualAnnotationRect | undefined {
  const object = recordFromUnknown(value);
  const x = numberValue(object.x);
  const y = numberValue(object.y);
  const width = numberValue(object.width);
  const height = numberValue(object.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}
