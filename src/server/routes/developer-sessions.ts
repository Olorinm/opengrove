import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeState } from "../bridge-types.js";
import { record, stringValue } from "../http-utils.js";
import {
  addDeveloperSessionAnnotation,
  addDeveloperSessionAnnotationThreadMessage,
  buildDeveloperSessionContext,
  createDeveloperSession,
  deleteDeveloperSessionAnnotation,
  getDeveloperSession,
  listDeveloperSessions,
  patchDeveloperSessionAnnotation,
  patchDeveloperSession,
} from "../visual/developer-session-store.js";
import { restartDeveloperPreviewService } from "../visual/preview-service.js";
import type { DeveloperSession } from "../visual/developer-session-types.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

export async function handleDeveloperSessionRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
}): Promise<boolean> {
  const { request, response, url, state, sendJson, readJsonBody } = options;
  const match = matchDeveloperSessionPath(url.pathname);

  if (request.method === "GET" && url.pathname === "/developer/sessions") {
    sendJson(response, 200, { ok: true, sessions: listDeveloperSessions(state) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/developer/sessions") {
    const payload = record(await readJsonBody(request));
    const description = stringValue(payload.description).trim();
    const targetRoot = stringValue(payload.targetRoot).trim();
    const targetUrl = stringValue(payload.targetUrl).trim();
    if (!description || !targetRoot || !targetUrl) {
      sendJson(response, 400, {
        ok: false,
        error: !description ? "description_required" : !targetRoot ? "target_root_required" : "target_url_required",
      });
      return true;
    }
    const session = createDeveloperSession(state, {
      title: stringValue(payload.title),
      description,
      targetRoot,
      targetUrl,
      core: normalizeCorePayload(payload.core),
      threadId: stringValue(payload.threadId) || undefined,
    });
    sendJson(response, 200, {
      ok: true,
      session,
      context: buildDeveloperSessionContext(session),
    });
    return true;
  }

  if (!match) {
    return false;
  }

  const session = getDeveloperSession(state, match.sessionId);
  if (!session) {
    sendJson(response, 404, { ok: false, error: "developer_session_not_found" });
    return true;
  }

  if (request.method === "GET" && match.action === "") {
    sendJson(response, 200, { ok: true, session, context: buildDeveloperSessionContext(session) });
    return true;
  }

  if (request.method === "POST" && match.action === "preview" && match.childId === "restart") {
    const previewService = await restartDeveloperPreviewService(state, session);
    const updated = patchDeveloperSession(state, session.id, {
      preview: previewStateFromRestart(previewService),
    }) ?? session;
    sendJson(response, 200, {
      ok: true,
      session: updated,
      context: buildDeveloperSessionContext(updated),
      previewService,
    });
    return true;
  }

  if (request.method === "PATCH" && match.action === "") {
    const payload = record(await readJsonBody(request));
    const updated = patchDeveloperSession(state, session.id, {
      title: optionalString(payload.title),
      description: optionalString(payload.description),
      targetRoot: optionalString(payload.targetRoot),
      targetUrl: optionalString(payload.targetUrl),
      core: normalizeCorePayload(payload.core),
      status: optionalDeveloperSessionStatus(payload.status),
      preview: typeof payload.preview === "object" && payload.preview ? payload.preview as DeveloperSession["preview"] : undefined,
      riskLevel: optionalRiskLevel(payload.riskLevel),
    });
    sendJson(response, 200, { ok: true, session: updated, context: updated ? buildDeveloperSessionContext(updated) : undefined });
    return true;
  }

  if (request.method === "POST" && match.action === "annotations" && !match.childId) {
    const updated = addDeveloperSessionAnnotation(state, session.id, record(await readJsonBody(request)));
    sendJson(response, 200, { ok: true, session: updated, context: updated ? buildDeveloperSessionContext(updated) : undefined });
    return true;
  }

  if (request.method === "PATCH" && match.action === "annotations" && match.childId && !match.grandchild) {
    const payload = record(await readJsonBody(request));
    const updated = patchDeveloperSessionAnnotation(state, session.id, match.childId, {
      comment: optionalString(payload.comment),
      status: optionalVisualAnnotationStatus(payload.status),
      resolvedBy: optionalResolvedBy(payload.resolvedBy),
    });
    sendJson(response, 200, { ok: true, session: updated, context: updated ? buildDeveloperSessionContext(updated) : undefined });
    return true;
  }

  if (request.method === "POST" && match.action === "annotations" && match.childId && match.grandchild === "thread") {
    const payload = record(await readJsonBody(request));
    const updated = addDeveloperSessionAnnotationThreadMessage(state, session.id, match.childId, {
      role: payload.role === "user" ? "user" : "agent",
      content: stringValue(payload.content),
    });
    sendJson(response, 200, { ok: true, session: updated, context: updated ? buildDeveloperSessionContext(updated) : undefined });
    return true;
  }

  if (request.method === "DELETE" && match.action === "annotations" && match.childId) {
    const updated = deleteDeveloperSessionAnnotation(state, session.id, match.childId);
    sendJson(response, 200, { ok: true, session: updated, context: updated ? buildDeveloperSessionContext(updated) : undefined });
    return true;
  }

  if (request.method === "GET" && match.action === "context") {
    sendJson(response, 200, { ok: true, session, context: buildDeveloperSessionContext(session) });
    return true;
  }

  return false;
}

function matchDeveloperSessionPath(pathname: string): { sessionId: string; action: string; childId?: string; grandchild?: string } | undefined {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "developer" || parts[1] !== "sessions" || !parts[2]) {
    return undefined;
  }
  return {
    sessionId: decodeURIComponent(parts[2]),
    action: parts[3] ? decodeURIComponent(parts[3]) : "",
    childId: parts[4] ? decodeURIComponent(parts[4]) : undefined,
    grandchild: parts[5] ? decodeURIComponent(parts[5]) : undefined,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeCorePayload(value: unknown): DeveloperSession["core"] | undefined {
  const object = record(value);
  const coreId = stringValue(object.coreId).trim();
  const name = stringValue(object.name).trim();
  const kernel = stringValue(object.kernel).trim();
  const model = stringValue(object.model).trim();
  return coreId && name && kernel && model ? { coreId, name, kernel, model } : undefined;
}

function optionalDeveloperSessionStatus(value: unknown): DeveloperSession["status"] | undefined {
  return value === "draft" ||
    value === "context_ready" ||
    value === "running" ||
    value === "ready" ||
    value === "accepted" ||
    value === "reverted" ||
    value === "blocked"
    ? value
    : undefined;
}

function optionalVisualAnnotationStatus(value: unknown) {
  return value === "pending" ||
    value === "acknowledged" ||
    value === "replied" ||
    value === "resolved" ||
    value === "dismissed"
    ? value
    : undefined;
}

function optionalResolvedBy(value: unknown) {
  return value === "user" || value === "agent" ? value : undefined;
}

function optionalRiskLevel(value: unknown): DeveloperSession["riskLevel"] | undefined {
  return value === "none" || value === "warning" || value === "blocked" ? value : undefined;
}

function previewStateFromRestart(previewService: Awaited<ReturnType<typeof restartDeveloperPreviewService>>): DeveloperSession["preview"] {
  if (previewService.status === "restarted" && previewService.ready) {
    return {
      status: "ready",
      lastLoadedAt: new Date().toISOString(),
    };
  }
  return {
    status: "error",
    error: previewService.message || "preview_unavailable",
  };
}
