import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bridgeDataPath } from "../storage-paths.js";
import type { BridgeState } from "../bridge-types.js";
import type {
  VisualAnnotation,
  VisualAnnotationStatus,
  VisualAnnotationThreadMessage,
  DeveloperSession,
  DeveloperSessionCore,
  DeveloperSessionContextPacket,
  DeveloperSessionStoreData,
} from "./developer-session-types.js";

export function listDeveloperSessions(state: BridgeState): DeveloperSession[] {
  return readDeveloperSessionStore(state).sessions;
}

export function getDeveloperSession(state: BridgeState, sessionId: string): DeveloperSession | undefined {
  return listDeveloperSessions(state).find((session) => session.id === sessionId);
}

export function createDeveloperSession(state: BridgeState, input: {
  title?: string;
  description: string;
  targetRoot: string;
  targetUrl: string;
  core?: Partial<DeveloperSessionCore>;
  threadId?: string;
}): DeveloperSession {
  const now = new Date().toISOString();
  const session: DeveloperSession = {
    id: createId("developer_session"),
    kind: "developer_session",
    title: normalizeTitle(input.title, input.description),
    description: input.description.trim(),
    threadId: input.threadId?.trim() || createId("developer_thread"),
    targetRoot: input.targetRoot.trim(),
    targetUrl: input.targetUrl.trim(),
    core: normalizeCore(input.core),
    status: "draft",
    preview: { status: "idle" },
    annotations: [],
    runs: [],
    riskLevel: "none",
    createdAt: now,
    updatedAt: now,
  };
  writeDeveloperSessionStore(state, { sessions: [session, ...listDeveloperSessions(state)] });
  return session;
}

export function patchDeveloperSession(state: BridgeState, sessionId: string, patch: Partial<Pick<DeveloperSession,
  "title" | "description" | "targetRoot" | "targetUrl" | "core" | "status" | "preview" | "riskLevel"
>>): DeveloperSession | undefined {
  let updated: DeveloperSession | undefined;
  const sessions = listDeveloperSessions(state).map((session) => {
    if (session.id !== sessionId) return session;
    updated = {
      ...session,
      ...definedPatch(patch),
      updatedAt: new Date().toISOString(),
    };
    return updated;
  });
  if (updated) {
    writeDeveloperSessionStore(state, { sessions });
  }
  return updated;
}

export function addDeveloperSessionAnnotation(state: BridgeState, sessionId: string, input: Partial<VisualAnnotation>): DeveloperSession | undefined {
  let updated: DeveloperSession | undefined;
  const now = new Date().toISOString();
  const sessions = listDeveloperSessions(state).map((session) => {
    if (session.id !== sessionId) return session;
    const annotation: VisualAnnotation = {
      id: createId("annotation"),
      kind: normalizeAnnotationKind(input.kind),
      status: normalizeAnnotationStatus(input.status) ?? "pending",
      comment: typeof input.comment === "string" ? input.comment : "",
      transcript: typeof input.transcript === "string" && input.transcript.trim() ? input.transcript.trim() : undefined,
      url: typeof input.url === "string" && input.url.trim() ? input.url.trim() : session.targetUrl,
      viewport: normalizeViewport(input.viewport),
      rect: normalizeRect(input.rect),
      points: normalizePoints(input.points),
      target: input.target,
      createdAt: now,
      updatedAt: now,
    };
    updated = {
      ...session,
      status: "context_ready",
      annotations: [...session.annotations, annotation],
      updatedAt: now,
    };
    return updated;
  });
  if (updated) {
    writeDeveloperSessionStore(state, { sessions });
  }
  return updated;
}

export function patchDeveloperSessionAnnotation(state: BridgeState, sessionId: string, annotationId: string, patch: Partial<Pick<VisualAnnotation,
  "comment" | "status" | "resolvedBy"
>>): DeveloperSession | undefined {
  let updated: DeveloperSession | undefined;
  const now = new Date().toISOString();
  const nextStatus = normalizeAnnotationStatus(patch.status);
  const sessions = listDeveloperSessions(state).map((session) => {
    if (session.id !== sessionId) return session;
    let changed = false;
    const annotations = session.annotations.map((annotation) => {
      if (annotation.id !== annotationId) return annotation;
      changed = true;
      const status = nextStatus ?? annotation.status ?? "pending";
      const isClosed = status === "resolved" || status === "dismissed";
      return {
        ...annotation,
        comment: patch.comment !== undefined ? patch.comment : annotation.comment,
        status,
        resolvedAt: isClosed ? annotation.resolvedAt ?? now : undefined,
        resolvedBy: isClosed ? normalizeResolvedBy(patch.resolvedBy) ?? annotation.resolvedBy : undefined,
        updatedAt: now,
      };
    });
    if (!changed) return session;
    updated = {
      ...session,
      annotations,
      updatedAt: now,
    };
    return updated;
  });
  if (updated) {
    writeDeveloperSessionStore(state, { sessions });
  }
  return updated;
}

export function addDeveloperSessionAnnotationThreadMessage(state: BridgeState, sessionId: string, annotationId: string, input: {
  role?: VisualAnnotationThreadMessage["role"];
  content?: string;
}): DeveloperSession | undefined {
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) return getDeveloperSession(state, sessionId);
  let updated: DeveloperSession | undefined;
  const now = new Date().toISOString();
  const message: VisualAnnotationThreadMessage = {
    id: createId("annotation_msg"),
    role: input.role === "user" ? "user" : "agent",
    content,
    createdAt: now,
  };
  const sessions = listDeveloperSessions(state).map((session) => {
    if (session.id !== sessionId) return session;
    let changed = false;
    const annotations: VisualAnnotation[] = session.annotations.map((annotation) => {
      if (annotation.id !== annotationId) return annotation;
      changed = true;
      const status: VisualAnnotationStatus = annotation.status === "resolved" || annotation.status === "dismissed"
        ? annotation.status
        : "replied";
      return {
        ...annotation,
        status,
        thread: [...(annotation.thread ?? []), message],
        updatedAt: now,
      };
    });
    if (!changed) return session;
    const nextSession: DeveloperSession = {
      ...session,
      annotations,
      updatedAt: now,
    };
    updated = nextSession;
    return nextSession;
  });
  if (updated) {
    writeDeveloperSessionStore(state, { sessions });
  }
  return updated;
}

export function deleteDeveloperSessionAnnotation(state: BridgeState, sessionId: string, annotationId: string): DeveloperSession | undefined {
  let updated: DeveloperSession | undefined;
  const sessions = listDeveloperSessions(state).map((session) => {
    if (session.id !== sessionId) return session;
    updated = {
      ...session,
      annotations: session.annotations.filter((annotation) => annotation.id !== annotationId),
      updatedAt: new Date().toISOString(),
    };
    return updated;
  });
  if (updated) {
    writeDeveloperSessionStore(state, { sessions });
  }
  return updated;
}

export function buildDeveloperSessionContext(session: DeveloperSession): DeveloperSessionContextPacket {
  const viewport = session.annotations[session.annotations.length - 1]?.viewport;
  return {
    sessionId: session.id,
    kind: "developer_session",
    userIntent: session.description,
    target: {
      workspaceRoot: session.targetRoot,
      url: session.targetUrl,
      viewport,
    },
    core: session.core,
    inputs: [
      {
        type: "text",
        text: session.description,
        createdAt: session.createdAt,
      },
      ...session.annotations.map((annotation) => ({
        type: "visual" as const,
        annotationId: annotation.id,
        kind: annotation.kind,
        status: annotation.status ?? "pending",
        comment: annotation.comment,
        transcript: annotation.transcript,
        url: annotation.url,
        viewport: annotation.viewport,
        rect: annotation.rect,
        points: annotation.points,
        target: annotation.target,
        thread: annotation.thread,
        resolvedAt: annotation.resolvedAt,
        resolvedBy: annotation.resolvedBy,
        createdAt: annotation.createdAt,
      })),
    ],
    constraints: {
      targetRoot: session.targetRoot,
      allowedRoots: [session.targetRoot],
      deniedRoots: [],
      canModifyOpenGroveHost: false,
      requirePreviewBeforeAccept: true,
      allowDestructiveCommands: false,
      preferredChangeSize: "small",
    },
    provenance: {
      source: "app-developer-mode",
      createdAt: new Date().toISOString(),
    },
  };
}

function readDeveloperSessionStore(state: BridgeState): DeveloperSessionStoreData {
  const path = developerSessionStorePath(state);
  if (!existsSync(path)) {
    return { sessions: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DeveloperSessionStoreData>;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter(isDeveloperSession) : [],
    };
  } catch {
    return { sessions: [] };
  }
}

function writeDeveloperSessionStore(state: BridgeState, data: DeveloperSessionStoreData): void {
  const path = developerSessionStorePath(state);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function developerSessionStorePath(state: BridgeState): string {
  return bridgeDataPath(state, "developer-sessions.json");
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}

function normalizeTitle(title: string | undefined, description: string): string {
  const value = title?.trim() || description.trim().replace(/\s+/g, " ");
  if (!value) return "Developer session";
  return value.length > 40 ? `${value.slice(0, 40)}...` : value;
}

function normalizeCore(input: Partial<DeveloperSessionCore> | undefined): DeveloperSessionCore | undefined {
  if (!input) return undefined;
  const coreId = input.coreId?.trim();
  const name = input.name?.trim();
  const kernel = input.kernel?.trim();
  const model = input.model?.trim();
  if (!coreId || !name || !kernel || !model) return undefined;
  return { coreId, name, kernel, model };
}

function normalizeAnnotationKind(kind: unknown): VisualAnnotation["kind"] {
  return kind === "element" || kind === "stroke" || kind === "note" || kind === "voice" ? kind : "box";
}

function normalizeAnnotationStatus(value: unknown): VisualAnnotationStatus | undefined {
  return value === "pending" ||
    value === "acknowledged" ||
    value === "replied" ||
    value === "resolved" ||
    value === "dismissed"
    ? value
    : undefined;
}

function normalizeResolvedBy(value: unknown): VisualAnnotation["resolvedBy"] | undefined {
  return value === "user" || value === "agent" ? value : undefined;
}

function normalizeViewport(value: unknown): { width: number; height: number } {
  const object = record(value);
  return {
    width: positiveNumber(object.width, 1440),
    height: positiveNumber(object.height, 900),
  };
}

function normalizeRect(value: unknown): VisualAnnotation["rect"] {
  const object = record(value);
  if (!Object.keys(object).length) return undefined;
  return {
    x: numberValue(object.x, 0),
    y: numberValue(object.y, 0),
    width: Math.max(1, numberValue(object.width, 1)),
    height: Math.max(1, numberValue(object.height, 1)),
  };
}

function normalizePoints(value: unknown): VisualAnnotation["points"] {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .map((item) => {
      const object = record(item);
      return { x: numberValue(object.x, 0), y: numberValue(object.y, 0) };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  return points.length ? points : undefined;
}

function definedPatch<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function isDeveloperSession(value: unknown): value is DeveloperSession {
  const object = record(value);
  return object.kind === "developer_session" && typeof object.id === "string" && typeof object.targetRoot === "string";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return Math.max(1, numberValue(value, fallback));
}
