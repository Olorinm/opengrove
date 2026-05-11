import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import type { JsonObject, JsonValue } from "../../core.js";
import { isKnowledgeDocumentType, isKnowledgeScope } from "../../knowledge/store.js";
import type {
  KnowledgeDocumentPatch,
  KnowledgeFeedbackSignal,
} from "../../knowledge/types.js";
import { KNOWLEDGE_INVENTORY_LIMIT, type BridgeState } from "../bridge-types.js";
import {
  createKnowledgeFileSystemEntry,
  deleteKnowledgeFileSystemEntry,
  filterEnabledKnowledgeDocuments,
  importLocalFolderToKnowledge,
  listKnowledgeVaultFolders,
  moveKnowledgeFileSystemEntry,
  normalizeKnowledgeFileSystemCreatePayload,
  normalizeKnowledgeFileSystemDeletePayload,
  normalizeKnowledgeFileSystemMovePayload,
  normalizeKnowledgeFileSystemRenamePayload,
  normalizeKnowledgeFilePatchPayload,
  readKnowledgeFile,
  renameKnowledgeFileSystemEntry,
  syncKnowledgeVaultFiles,
  writeKnowledgeFile,
} from "../knowledge-files.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

export async function handleKnowledgeRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
}): Promise<boolean> {
  const { request, response, url, state, sendJson, readJsonBody } = options;

  if (request.method === "GET" && url.pathname === "/knowledge") {
    const query = url.searchParams.get("query") ?? "";
    const type = url.searchParams.get("type") ?? "";
    const scope = url.searchParams.get("scope") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;
    const includeLedgers = url.searchParams.get("ledgers") === "1" || url.searchParams.get("ledgers") === "true";
    const filter = {
      type: isKnowledgeDocumentType(type) ? type : undefined,
      scope: isKnowledgeScope(scope) ? scope : undefined,
      lifecycle: "active" as const,
      limit,
    };
    const knowledge = query
      ? state.app.knowledge.search(query, filter)
      : state.app.knowledge.list(filter);
    syncKnowledgeVaultFiles(state);
    sendJson(response, 200, {
      ok: true,
      knowledge: filterEnabledKnowledgeDocuments(state, knowledge),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      ...(includeLedgers ? { ledgers: state.app.knowledge.snapshotLedgers() } : {}),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/knowledge/file-system") {
    const result = createKnowledgeFileSystemEntry(
      state,
      normalizeKnowledgeFileSystemCreatePayload(await readJsonBody(request)),
    );
    state.store.saveFrom(state.app);
    sendJson(response, 200, {
      ok: true,
      ...result,
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/knowledge/file-system/move") {
    const result = moveKnowledgeFileSystemEntry(
      state,
      normalizeKnowledgeFileSystemMovePayload(await readJsonBody(request)),
    );
    state.store.saveFrom(state.app);
    sendJson(response, 200, {
      ok: true,
      ...result,
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/knowledge/file-system/rename") {
    const result = renameKnowledgeFileSystemEntry(
      state,
      normalizeKnowledgeFileSystemRenamePayload(await readJsonBody(request)),
    );
    state.store.saveFrom(state.app);
    sendJson(response, 200, {
      ok: true,
      ...result,
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/knowledge/file-system/choose-import-folder") {
    try {
      const folderPath = await chooseImportFolder();
      if (!folderPath) {
        sendJson(response, 200, { ok: true, cancelled: true });
      } else {
        const result = importLocalFolderToKnowledge(state, { folderPath });
        state.store.saveFrom(state.app);
        sendJson(response, 200, {
          ok: true,
          ...result,
          knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
          knowledgeFolders: listKnowledgeVaultFolders(state),
          knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
        });
      }
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/knowledge/file-system/import-folder") {
    await readJsonBody(request);
    sendJson(response, 403, { ok: false, error: "import_folder_choose_required" });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/knowledge/file-system/delete") {
    const result = deleteKnowledgeFileSystemEntry(
      state,
      normalizeKnowledgeFileSystemDeletePayload(await readJsonBody(request)),
    );
    state.store.saveFrom(state.app);
    sendJson(response, 200, {
      ok: true,
      ...result,
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    });
    return true;
  }

  const knowledgeFileAction = url.pathname.match(/^\/knowledge\/([^/]+)\/file$/);
  if (knowledgeFileAction && request.method === "GET") {
    const [, knowledgeId] = knowledgeFileAction;
    const result = readKnowledgeFile(state, decodeURIComponent(knowledgeId));
    sendJson(response, 200, { ok: true, ...result });
    return true;
  }

  if (knowledgeFileAction && request.method === "PATCH") {
    const [, knowledgeId] = knowledgeFileAction;
    const result = writeKnowledgeFile(
      state,
      decodeURIComponent(knowledgeId),
      normalizeKnowledgeFilePatchPayload(await readJsonBody(request)),
    );
    state.store.saveFrom(state.app);
    sendJson(response, 200, {
      ok: true,
      ...result,
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    });
    return true;
  }

  const knowledgeFeedbackAction = url.pathname.match(/^\/knowledge\/([^/]+)\/feedback$/);
  if (knowledgeFeedbackAction && request.method === "POST") {
    const [, knowledgeId] = knowledgeFeedbackAction;
    const result = state.app.knowledgeFeedbackScorer.apply({
      knowledgeId: decodeURIComponent(knowledgeId),
      ...normalizeKnowledgeFeedbackPayload(await readJsonBody(request)),
    });
    state.store.saveFrom(state.app);
    sendJson(response, 200, {
      ok: true,
      result,
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    });
    return true;
  }

  const knowledgeAction = url.pathname.match(/^\/knowledge\/([^/]+)$/);
  if (knowledgeAction && request.method === "PATCH") {
    const [, knowledgeId] = knowledgeAction;
    const knowledge = state.app.knowledge.update(
      decodeURIComponent(knowledgeId),
      normalizeKnowledgePatchPayload(await readJsonBody(request)),
    );
    state.store.saveFrom(state.app);
    sendJson(response, 200, {
      ok: true,
      document: knowledge,
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    });
    return true;
  }

  return false;
}

function normalizeKnowledgeFeedbackPayload(input: unknown): {
  signal: KnowledgeFeedbackSignal;
  deliveryId?: string;
  runId?: string;
  note?: string;
  scoreDelta?: number;
  metadata?: JsonObject;
} {
  const object = record(input);
  const signal = object.signal === "ignored" || object.signal === "corrected" || object.signal === "stale" || object.signal === "promoted" || object.signal === "demoted"
    ? object.signal
    : "useful";
  return {
    signal,
    deliveryId: typeof object.deliveryId === "string" ? object.deliveryId : undefined,
    runId: typeof object.runId === "string" ? object.runId : undefined,
    note: typeof object.note === "string" ? object.note : undefined,
    scoreDelta: typeof object.scoreDelta === "number" ? object.scoreDelta : undefined,
    metadata: isJsonObject(object.metadata) ? object.metadata : undefined,
  };
}

function normalizeKnowledgePatchPayload(input: unknown): KnowledgeDocumentPatch {
  const object = record(input);
  const patch: KnowledgeDocumentPatch = {};

  if (typeof object.slug === "string") patch.slug = object.slug;
  if (typeof object.type === "string" && isKnowledgeDocumentType(object.type)) patch.type = object.type;
  if (typeof object.title === "string") patch.title = object.title;
  if (typeof object.body === "string") patch.body = object.body;
  if (object.format === "markdown" || object.format === "json" || object.format === "plain") patch.format = object.format;
  if (Array.isArray(object.tags)) patch.tags = object.tags.filter((item): item is string => typeof item === "string");
  if (typeof object.scope === "string" && isKnowledgeScope(object.scope)) patch.scope = object.scope;
  if (typeof object.confidence === "number") patch.confidence = Math.max(0, Math.min(1, object.confidence));
  if (object.lifecycle === "draft" || object.lifecycle === "active" || object.lifecycle === "archived") patch.lifecycle = object.lifecycle;
  if ("metadata" in object) patch.metadata = isJsonObject(object.metadata) ? object.metadata : {};

  return patch;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function chooseImportFolder(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const script = [
      'set chosenFolder to choose folder with prompt "选择要导入的文件夹"',
      "POSIX path of chosenFolder",
    ].join("\n");
    execFile("osascript", ["-e", script], { timeout: 120_000, maxBuffer: 8192 }, (error, stdout, stderr) => {
      if (!error) {
        const folderPath = stdout.trim().replace(/\/$/, "");
        resolve(folderPath || undefined);
        return;
      }
      const message = `${stderr || ""}\n${error.message}`;
      if (message.includes("User canceled") || message.includes("-128")) {
        resolve(undefined);
        return;
      }
      reject(new Error((stderr || "").trim() || error.message));
    });
  });
}
