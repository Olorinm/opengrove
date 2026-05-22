import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  type ReadStream,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

export interface WorkspaceScope {
  kind: "local";
  appId: string;
  root: string;
}

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  mimeType?: string;
  updatedAt?: string;
  children?: WorkspaceFileEntry[];
}

export interface WorkspaceListResult {
  entries: WorkspaceFileEntry[];
  count: number;
  truncated: boolean;
}

export interface WorkspaceFileReadResult {
  entry: WorkspaceFileEntry & { kind: "file" };
  content?: string;
  contentTruncated?: boolean;
}

export interface WorkspaceRawFileResult {
  entry: WorkspaceFileEntry & { kind: "file" };
  stream: ReadStream;
}

export interface WorkspaceStore {
  ensureWorkspace(scope: WorkspaceScope): void;
  createRunWorkspace(scope: WorkspaceScope, runId: string): WorkspaceScope;
  listFiles(scope: WorkspaceScope, options?: WorkspaceListOptions): WorkspaceListResult;
  readFile(scope: WorkspaceScope, path: string, options?: WorkspaceReadOptions): WorkspaceFileReadResult | undefined;
  writeFile(scope: WorkspaceScope, path: string, data: string | Buffer): WorkspaceFileReadResult | undefined;
  openRawFile(scope: WorkspaceScope, path: string): WorkspaceRawFileResult | undefined;
}

export interface WorkspaceListOptions {
  path?: string;
  maxDepth?: number;
  maxEntries?: number;
  ignoredNames?: readonly string[];
}

export interface WorkspaceReadOptions {
  textSizeLimit?: number;
}

const DEFAULT_MAX_TREE_DEPTH = 8;
const DEFAULT_MAX_TREE_ENTRIES = 1_200;
const DEFAULT_IGNORED_NAMES = new Set([".DS_Store", ".gitkeep"]);

export class LocalFilesystemWorkspaceStore implements WorkspaceStore {
  ensureWorkspace(scope: WorkspaceScope): void {
    mkdirSync(scope.root, { recursive: true });
  }

  createRunWorkspace(scope: WorkspaceScope, runId: string): WorkspaceScope {
    const runRoot = safeResolveInside(scope.root, join("runs", runId));
    if (!runRoot) {
      throw new Error("workspace_run_path_invalid");
    }
    mkdirSync(runRoot, { recursive: true });
    return {
      kind: scope.kind,
      appId: scope.appId,
      root: runRoot,
    };
  }

  listFiles(scope: WorkspaceScope, options: WorkspaceListOptions = {}): WorkspaceListResult {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_TREE_DEPTH;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_TREE_ENTRIES;
    const ignoredNames = new Set([...DEFAULT_IGNORED_NAMES, ...(options.ignoredNames ?? [])]);
    const state = { count: 0, truncated: false };
    const entries = this.readDirectoryEntries(scope.root, options.path ?? "", 0, {
      ignoredNames,
      maxDepth,
      maxEntries,
      state,
    });
    return {
      entries,
      count: state.count,
      truncated: state.truncated,
    };
  }

  readFile(scope: WorkspaceScope, path: string, options: WorkspaceReadOptions = {}): WorkspaceFileReadResult | undefined {
    const filePath = safeResolveInside(scope.root, path);
    if (!filePath || !existsSync(filePath)) return undefined;
    const stat = statSync(filePath);
    if (!stat.isFile()) return undefined;

    const mimeType = contentTypeForPath(filePath);
    const entry = fileEntry(scope.root, filePath, stat.mtime.toISOString(), stat.size, mimeType);
    const textSizeLimit = options.textSizeLimit ?? 0;
    const isText = isTextMimeType(mimeType);
    const content = isText && stat.size <= textSizeLimit
      ? readFileSync(filePath, "utf8")
      : undefined;
    return {
      entry,
      content,
      contentTruncated: content === undefined && isText,
    };
  }

  writeFile(scope: WorkspaceScope, path: string, data: string | Buffer): WorkspaceFileReadResult | undefined {
    const filePath = safeResolveInside(scope.root, path);
    if (!filePath) return undefined;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, data);
    return this.readFile(scope, path, { textSizeLimit: Buffer.byteLength(data) });
  }

  openRawFile(scope: WorkspaceScope, path: string): WorkspaceRawFileResult | undefined {
    const filePath = safeResolveInside(scope.root, path);
    if (!filePath || !existsSync(filePath)) return undefined;
    const stat = statSync(filePath);
    if (!stat.isFile()) return undefined;
    return {
      entry: fileEntry(scope.root, filePath, stat.mtime.toISOString(), stat.size, contentTypeForPath(filePath)),
      stream: createReadStream(filePath),
    };
  }

  private readDirectoryEntries(
    root: string,
    relativePath: string,
    depth: number,
    options: {
      ignoredNames: Set<string>;
      maxDepth: number;
      maxEntries: number;
      state: { count: number; truncated: boolean };
    },
  ): WorkspaceFileEntry[] {
    if (depth > options.maxDepth || options.state.count >= options.maxEntries) {
      options.state.truncated = true;
      return [];
    }

    const directory = safeResolveInside(root, relativePath);
    if (!directory || !existsSync(directory)) return [];

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const output: WorkspaceFileEntry[] = [];
    for (const entry of entries) {
      if (options.ignoredNames.has(entry.name)) continue;
      if (options.state.count >= options.maxEntries) {
        options.state.truncated = true;
        break;
      }
      const childRelativePath = normalizeRelativePath(join(relativePath, entry.name));
      const childPath = safeResolveInside(root, childRelativePath);
      if (!childPath) continue;

      try {
        const stat = statSync(childPath);
        options.state.count += 1;
        if (entry.isDirectory()) {
          output.push({
            name: entry.name,
            path: childRelativePath,
            kind: "directory",
            updatedAt: stat.mtime.toISOString(),
            children: this.readDirectoryEntries(root, childRelativePath, depth + 1, options),
          });
        } else if (entry.isFile()) {
          output.push(fileEntry(root, childPath, stat.mtime.toISOString(), stat.size, contentTypeForPath(childPath)));
        }
      } catch {
        // Ignore unreadable files while keeping the workbench usable.
      }
    }

    return output.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }
}

export function safeResolveInside(root: string, requestedPath: string): string | undefined {
  const candidate = resolve(root, requestedPath || ".");
  const relation = relative(root, candidate);
  if (relation === "") return candidate;
  if (relation.startsWith("..") || relation.includes(`..${sep}`)) return undefined;
  return candidate;
}

export function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}

export function isTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/x-yaml" ||
    mimeType === "application/xml";
}

export function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".md":
    case ".markdown":
    case ".mdx":
      return "text/markdown; charset=utf-8";
    case ".txt":
    case ".log":
      return "text/plain; charset=utf-8";
    case ".json":
    case ".jsonl":
      return "application/json";
    case ".yaml":
    case ".yml":
      return "application/x-yaml; charset=utf-8";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".ts":
    case ".tsx":
      return "text/plain; charset=utf-8";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    default:
      return "application/octet-stream";
  }
}

function fileEntry(
  root: string,
  absolutePath: string,
  updatedAt: string,
  size: number,
  mimeType: string,
): WorkspaceFileEntry & { kind: "file" } {
  return {
    name: basename(absolutePath),
    path: normalizeRelativePath(relative(root, absolutePath)),
    kind: "file",
    size,
    mimeType,
    updatedAt,
  };
}
