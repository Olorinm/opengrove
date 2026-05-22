export type DeveloperSessionStatus =
  | "draft"
  | "context_ready"
  | "running"
  | "ready"
  | "accepted"
  | "reverted"
  | "blocked";

export type VisualAnnotationKind = "element" | "box" | "stroke" | "note" | "voice";
export type VisualAnnotationStatus = "pending" | "acknowledged" | "replied" | "resolved" | "dismissed";

export interface VisualAnnotationThreadMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  createdAt: string;
}

export interface DeveloperSession {
  id: string;
  kind: "developer_session";
  title: string;
  description: string;
  threadId: string;
  targetRoot: string;
  targetUrl: string;
  core?: DeveloperSessionCore;
  status: DeveloperSessionStatus;
  preview: {
    status: "idle" | "loading" | "ready" | "error";
    lastLoadedAt?: string;
    error?: string;
  };
  annotations: VisualAnnotation[];
  runs: DeveloperSessionRun[];
  baseline?: DeveloperWorkspaceSnapshot;
  latestRunId?: string;
  riskLevel?: "none" | "warning" | "blocked";
  createdAt: string;
  updatedAt: string;
}

export interface VisualAnnotation {
  id: string;
  kind: VisualAnnotationKind;
  status?: VisualAnnotationStatus;
  comment: string;
  transcript?: string;
  url: string;
  viewport: { width: number; height: number };
  rect?: { x: number; y: number; width: number; height: number };
  points?: Array<{ x: number; y: number }>;
  target?: VisualAnnotationTarget;
  thread?: VisualAnnotationThreadMessage[];
  resolvedAt?: string;
  resolvedBy?: "user" | "agent";
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualAnnotationTarget {
  capture?: Record<string, unknown>;
  selector?: string;
  elementPath?: string;
  fullPath?: string;
  tagName?: string;
  text?: string;
  className?: string;
  cssClasses?: string[];
  ariaLabel?: string;
  role?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  selectionRect?: { x: number; y: number; width: number; height: number };
  selectedText?: string;
  nearbyText?: string;
  nearbyElements?: Array<Record<string, unknown>>;
  computedStyles?: Record<string, unknown>;
  accessibility?: Record<string, unknown>;
  isFixed?: boolean;
  reactPath?: string;
  reactComponents?: string[];
  sourceHint?: string;
  sourceFile?: string;
  elementBoundingBoxes?: Array<Record<string, unknown>>;
}

export interface DeveloperSessionCore {
  coreId: string;
  name: string;
  kernel: string;
  model: string;
}

export interface DeveloperWorkspaceSnapshot {
  sessionId: string;
  targetRoot: string;
  gitHead?: string;
  diffBefore?: string;
  createdAt: string;
}

export interface DeveloperSessionRun {
  id: string;
  sessionId: string;
  threadId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";
  inputContextId: string;
  touchedFiles: string[];
  diffSummary?: string;
  boundaryCheck?: DeveloperSessionBoundaryCheck;
  startedAt: string;
  finishedAt?: string;
}

export interface DeveloperSessionBoundaryCheck {
  status: "clean" | "warning" | "blocked";
  targetRoot: string;
  touchedFiles: Array<{
    path: string;
    insideTargetRoot: boolean;
    changeKind: "added" | "modified" | "deleted" | "renamed" | "unknown";
  }>;
  message?: string;
}

export interface DeveloperSessionContextPacket {
  sessionId: string;
  kind: "developer_session";
  userIntent: string;
  target: {
    workspaceRoot: string;
    url: string;
    viewport?: { width: number; height: number };
  };
  core?: DeveloperSessionCore;
  inputs: DeveloperSessionContextInput[];
  constraints: {
    targetRoot: string;
    allowedRoots: string[];
    deniedRoots: string[];
    canModifyOpenGroveHost: boolean;
    requirePreviewBeforeAccept: boolean;
    allowDestructiveCommands: false;
    preferredChangeSize: "small" | "medium";
  };
  provenance: {
    source: "app-developer-mode";
    createdAt: string;
  };
}

export type DeveloperSessionContextInput =
  | {
      type: "text";
      text: string;
      createdAt: string;
    }
  | {
      type: "visual";
      annotationId: string;
      kind: VisualAnnotationKind;
      status?: VisualAnnotationStatus;
      comment: string;
      transcript?: string;
      url: string;
      viewport: { width: number; height: number };
      rect?: { x: number; y: number; width: number; height: number };
      points?: Array<{ x: number; y: number }>;
      target?: VisualAnnotation["target"];
      thread?: VisualAnnotationThreadMessage[];
      resolvedAt?: string;
      resolvedBy?: "user" | "agent";
      createdAt: string;
    };

export interface DeveloperSessionStoreData {
  sessions: DeveloperSession[];
}
