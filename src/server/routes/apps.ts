import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { APP_FILE_TEXT_SIZE_LIMIT, type BridgeState } from "../bridge-types.js";
import {
  contentTypeForPath,
  LocalFilesystemWorkspaceStore,
  safeResolveInside,
  type WorkspaceRawFileResult,
  type WorkspaceStore,
} from "../workspace-store.js";
import { resolveMountedAppTarget, type MountedAppTarget } from "../mounted-apps.js";

interface AppRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson(response: ServerResponse, status: number, data: unknown): void;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
}

const MAX_TREE_DEPTH = 8;
const MAX_TREE_ENTRIES = 1_200;
const workspaceStore: WorkspaceStore = new LocalFilesystemWorkspaceStore();

export async function handleAppsRoute(context: AppRouteContext): Promise<boolean> {
  const match = context.url.pathname.match(/^\/apps\/([^/]+)\/(files|file|raw|ui|file-system)(?:\/(.*))?$/);
  if (!match) return false;

  const appId = decodeURIComponent(match[1] || "");
  const action = match[2];
  const uiPath = match[3] || "";
  const target = resolveMountedAppTarget(context.state, appId);
  if (!target) {
    context.sendJson(context.response, 404, { ok: false, error: "app_not_found" });
    return true;
  }

  if (action === "ui") {
    if (context.request.method !== "GET") {
      context.sendJson(context.response, 405, { ok: false, error: "method_not_allowed" });
      return true;
    }
    sendMountedAppUi(context, target, uiPath);
    return true;
  }

  if (action === "file-system") {
    if (context.request.method !== "POST") {
      context.sendJson(context.response, 405, { ok: false, error: "method_not_allowed" });
      return true;
    }
    try {
      const result = handleMountedAppFileSystemAction(target, uiPath, await context.readJsonBody(context.request));
      const files = workspaceStore.listFiles(target.workspace, {
        maxDepth: MAX_TREE_DEPTH,
        maxEntries: MAX_TREE_ENTRIES,
      });
      context.sendJson(context.response, 200, {
        ok: true,
        app: publicAppTarget(target),
        ...result,
        entries: files.entries,
        truncated: files.truncated,
      });
    } catch (error) {
      context.sendJson(context.response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (context.request.method !== "GET") {
    context.sendJson(context.response, 405, { ok: false, error: "method_not_allowed" });
    return true;
  }

  if (action === "files") {
    workspaceStore.ensureWorkspace(target.workspace);
    const result = workspaceStore.listFiles(target.workspace, {
      maxDepth: MAX_TREE_DEPTH,
      maxEntries: MAX_TREE_ENTRIES,
    });
    context.sendJson(context.response, 200, {
      ok: true,
      app: publicAppTarget(target),
      path: "",
      entries: result.entries,
      truncated: result.truncated,
    });
    return true;
  }

  const requestedPath = context.url.searchParams.get("path") ?? "";
  if (action === "raw") {
    const rawFile = workspaceStore.openRawFile(target.workspace, requestedPath);
    if (!rawFile) {
      context.sendJson(context.response, 404, { ok: false, error: "app_file_not_found" });
      return true;
    }
    sendRawFile(context.response, rawFile);
    return true;
  }

  const file = workspaceStore.readFile(target.workspace, requestedPath, {
    textSizeLimit: APP_FILE_TEXT_SIZE_LIMIT,
  });
  if (!file) {
    context.sendJson(context.response, 404, { ok: false, error: "app_file_not_found" });
    return true;
  }
  context.sendJson(context.response, 200, {
    ok: true,
    app: publicAppTarget(target),
    file: {
      ...file.entry,
      content: file.content,
      contentTruncated: file.contentTruncated,
    },
  });
  return true;
}

function handleMountedAppFileSystemAction(target: MountedAppTarget, rawAction: string, body: unknown) {
  workspaceStore.ensureWorkspace(target.workspace);
  const payload = record(body);
  const action = rawAction || "create";
  if (action === "create") {
    return createMountedAppEntry(target, payload);
  }
  if (action === "move") {
    return moveMountedAppEntry(target, payload);
  }
  if (action === "rename") {
    return renameMountedAppEntry(target, payload);
  }
  if (action === "delete") {
    return deleteMountedAppEntry(target, payload);
  }
  throw new Error("app_file_system_action_unknown");
}

function createMountedAppEntry(target: MountedAppTarget, payload: Record<string, unknown>) {
  const kind = stringValue(payload.kind) === "folder" ? "folder" : "file";
  const parentPath = safeAppRelativePath(payload.parentPath);
  const parent = safeResolveInside(target.workspaceRoot, parentPath);
  if (!parent) throw new Error("app_file_parent_path_invalid");
  mkdirSync(parent, { recursive: true });
  if (!statSync(parent).isDirectory()) throw new Error("app_file_parent_not_directory");

  const requestedName = safeFileName(stringValue(payload.name) || (kind === "folder" ? "新建文件夹" : "未命名.md"));
  const nextName = kind === "folder" ? requestedName : ensureFileExtension(requestedName, ".md");
  const destination = kind === "folder"
    ? uniqueDirectoryPath(parent, nextName)
    : uniqueFilePath(parent, nextName);
  if (kind === "folder") {
    mkdirSync(destination, { recursive: true });
  } else {
    writeFileSync(destination, stringValue(payload.content), "utf8");
  }
  return { entry: publicEntry(target.workspaceRoot, destination) };
}

function moveMountedAppEntry(target: MountedAppTarget, payload: Record<string, unknown>) {
  const sourcePath = safeAppRelativePath(payload.sourcePath);
  const targetParentPath = safeAppRelativePath(payload.targetParentPath);
  if (!sourcePath || !targetParentPath || sourcePath === targetParentPath) throw new Error("app_file_move_path_invalid");
  if (targetParentPath === sourcePath || targetParentPath.startsWith(`${sourcePath}/`)) {
    throw new Error("app_file_move_into_self_not_allowed");
  }
  const source = existingAppPath(target.workspaceRoot, sourcePath);
  const targetParent = safeResolveInside(target.workspaceRoot, targetParentPath);
  if (!targetParent) throw new Error("app_file_target_path_invalid");
  mkdirSync(targetParent, { recursive: true });
  if (!statSync(targetParent).isDirectory()) throw new Error("app_file_target_not_directory");
  const sourceStat = statSync(source);
  const destination = sourceStat.isDirectory()
    ? uniqueDirectoryPath(targetParent, basename(source))
    : uniqueFilePath(targetParent, basename(source));
  if (resolve(dirname(source)) !== resolve(targetParent)) {
    renameSync(source, destination);
  }
  return { entry: publicEntry(target.workspaceRoot, destination) };
}

function renameMountedAppEntry(target: MountedAppTarget, payload: Record<string, unknown>) {
  const sourcePath = safeAppRelativePath(payload.sourcePath);
  if (!sourcePath) throw new Error("app_file_source_path_required");
  const source = existingAppPath(target.workspaceRoot, sourcePath);
  const sourceStat = statSync(source);
  const requestedName = safeFileName(stringValue(payload.name) || basename(source));
  const nextName = sourceStat.isDirectory()
    ? requestedName
    : ensureFileExtension(requestedName, extname(source) || ".md");
  const parent = dirname(source);
  const destination = sourceStat.isDirectory()
    ? uniqueDirectoryPath(parent, nextName, source)
    : uniqueFilePath(parent, nextName, source);
  if (resolve(source) !== resolve(destination)) {
    renameSync(source, destination);
  }
  return { entry: publicEntry(target.workspaceRoot, destination) };
}

function deleteMountedAppEntry(target: MountedAppTarget, payload: Record<string, unknown>) {
  const sourcePath = safeAppRelativePath(payload.sourcePath);
  if (!sourcePath) throw new Error("app_file_delete_path_required");
  const source = existingAppPath(target.workspaceRoot, sourcePath);
  rmSync(source, { recursive: true, force: false });
  return { deletedPath: sourcePath };
}

function sendMountedAppUi(
  context: AppRouteContext,
  target: MountedAppTarget,
  rawPath: string,
): void {
  const uiRoot = safeResolveInside(target.appRoot, "ui");
  if (!uiRoot || !existsSync(uiRoot)) {
    sendHtml(context.response, 404, "App UI not found");
    return;
  }

  const requestedPath = decodePath(rawPath) || "index.html";
  const candidatePath = safeResolveInside(uiRoot, requestedPath);
  if (!candidatePath) {
    sendHtml(context.response, 403, "Forbidden");
    return;
  }

  let filePath = candidatePath;
  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    // Fall back to index.html for app routes handled by client-side routers.
    filePath = join(uiRoot, "index.html");
  }

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) {
      sendHtml(context.response, 404, "App UI not found");
      return;
    }
    context.response.writeHead(200, {
      "content-type": appUiContentType(filePath),
      "content-length": String(stat.size),
      "cache-control": "no-store",
    });
    createReadStream(filePath)
      .once("error", () => {
        if (!context.response.destroyed) context.response.end();
      })
      .pipe(context.response);
  } catch {
    sendHtml(context.response, 404, "App UI not found");
  }
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function appUiContentType(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  return contentTypeForPath(path);
}

function sendHtml(response: ServerResponse, status: number, message: string): void {
  const body = `<!doctype html><meta charset="utf-8"><title>${message}</title><body>${message}</body>`;
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store",
  });
  response.end(body);
}

function publicAppTarget(target: MountedAppTarget) {
  return {
    id: target.id,
    title: target.title,
    appRoot: target.appRoot,
    workspaceRoot: target.workspaceRoot,
    workspaceKind: target.workspace.kind,
  };
}

function sendRawFile(
  response: ServerResponse,
  rawFile: WorkspaceRawFileResult,
): void {
  response.writeHead(200, {
    "content-type": rawFile.entry.mimeType ?? "application/octet-stream",
    "content-length": String(rawFile.entry.size ?? 0),
    "cache-control": "no-store",
  });
  rawFile.stream.once("error", () => {
    if (!response.destroyed) response.end();
  });
  rawFile.stream.pipe(response);
}

function publicEntry(root: string, absolutePath: string) {
  const stat = statSync(absolutePath);
  const normalizedPath = normalizeRelativePath(relative(root, absolutePath));
  if (stat.isDirectory()) {
    return {
      name: basename(absolutePath),
      path: normalizedPath,
      kind: "directory",
      updatedAt: stat.mtime.toISOString(),
    };
  }
  return {
    name: basename(absolutePath),
    path: normalizedPath,
    kind: "file",
    size: stat.size,
    mimeType: contentTypeForPath(absolutePath),
    updatedAt: stat.mtime.toISOString(),
  };
}

function existingAppPath(root: string, requestedPath: string): string {
  const resolved = safeResolveInside(root, requestedPath);
  if (!resolved || !existsSync(resolved)) throw new Error("app_file_not_found");
  return resolved;
}

function safeAppRelativePath(value: unknown): string {
  if (typeof value !== "string") return "";
  return normalizeRelativePath(value)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}

function safeFileName(value: string): string {
  const sanitized = value
    .replace(/[<>:"\\|?*\x00-\x1f]/g, "-")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 160);
  return sanitized || "untitled";
}

function ensureFileExtension(name: string, fallbackExtension: string): string {
  if (extname(name)) return name;
  return `${name}${fallbackExtension || ".md"}`;
}

function uniqueFilePath(parentPath: string, fileName: string, currentPath?: string): string {
  const extension = extname(fileName) || ".md";
  const stem = fileName.slice(0, fileName.length - extension.length) || "untitled";
  let candidate = resolve(parentPath, `${stem}${extension}`);
  let index = 2;
  while (existsSync(candidate) && (!currentPath || resolve(candidate) !== resolve(currentPath))) {
    candidate = resolve(parentPath, `${stem} ${index}${extension}`);
    index += 1;
  }
  return candidate;
}

function uniqueDirectoryPath(parentPath: string, folderName: string, currentPath?: string): string {
  const base = folderName || "新建文件夹";
  let candidate = resolve(parentPath, base);
  let index = 2;
  while (existsSync(candidate) && (!currentPath || resolve(candidate) !== resolve(currentPath))) {
    candidate = resolve(parentPath, `${base} ${index}`);
    index += 1;
  }
  return candidate;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
