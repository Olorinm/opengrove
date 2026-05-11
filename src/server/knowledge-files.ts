import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  APP_CONFIG_DIR,
  APP_PRODUCT_NAME,
  APP_PROTOCOL_ID,
  APP_VAULT_DIR,
  APP_VAULT_ROOT_NAME,
} from "../identity.js";
import type { BridgeState } from "./bridge-types.js";
import { KNOWLEDGE_FILE_SIZE_LIMIT, KNOWLEDGE_INVENTORY_LIMIT } from "./bridge-types.js";
import type { KnowledgeDocument } from "../knowledge/types.js";
import { kernelConfigHome } from "./kernel-paths.js";

export interface KnowledgeFileDescriptor {
  path: string;
  vaultPath: string;
  backing: "vault" | "native";
  format: "markdown" | "json" | "plain";
  originPath?: string;
}

export interface KnowledgeFilePatchPayload {
  content: string;
  title?: string;
  tags?: string[];
}

export interface KnowledgeVaultFolder {
  path: string;
  backing: "vault" | "native";
  originPath?: string;
}

export interface KnowledgeFileSystemCreatePayload {
  kind: "note" | "folder";
  parentPath?: string;
  name?: string;
  content?: string;
}

export interface KnowledgeFileSystemMovePayload {
  sourcePath?: string;
  targetParentPath?: string;
}

export interface KnowledgeFileSystemRenamePayload {
  sourcePath?: string;
  name?: string;
}

export interface KnowledgeFileSystemDeletePayload {
  sourcePath?: string;
}

export interface KnowledgeFileSystemImportFolderPayload {
  folderPath?: string;
}

interface KnowledgeDirectoryTarget {
  path: string;
  vaultPath: string;
  backing: "vault" | "native";
  originPath?: string;
}

interface KnowledgeWritableRootSpec extends KnowledgeDirectoryTarget {}

const VISIBLE_KNOWLEDGE_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt"]);
const IGNORED_VAULT_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".DS_Store",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".vite",
  ".cache",
  "cache",
  "tmp",
  "temp",
  "logs",
  "log",
  "sessions",
  "session-env",
  "todos",
  "telemetry",
  "usage-data",
  "statsig",
  "backups",
  "debug",
]);

export function normalizeKnowledgeFilePatchPayload(input: unknown): KnowledgeFilePatchPayload {
  const object = record(input);
  if (typeof object.content !== "string") {
    throw new Error("knowledge_file_content_required");
  }
  return {
    content: object.content,
    title: typeof object.title === "string" ? object.title : undefined,
    tags: stringArray(object.tags),
  };
}

export function normalizeKnowledgeFileSystemCreatePayload(input: unknown): KnowledgeFileSystemCreatePayload {
  const object = record(input);
  return {
    kind: object.kind === "folder" ? "folder" : "note",
    parentPath: typeof object.parentPath === "string" ? object.parentPath : undefined,
    name: typeof object.name === "string" ? object.name : undefined,
    content: typeof object.content === "string" ? object.content : undefined,
  };
}

export function normalizeKnowledgeFileSystemMovePayload(input: unknown): KnowledgeFileSystemMovePayload {
  const object = record(input);
  return {
    sourcePath: typeof object.sourcePath === "string" ? object.sourcePath : undefined,
    targetParentPath: typeof object.targetParentPath === "string" ? object.targetParentPath : undefined,
  };
}

export function normalizeKnowledgeFileSystemRenamePayload(input: unknown): KnowledgeFileSystemRenamePayload {
  const object = record(input);
  return {
    sourcePath: typeof object.sourcePath === "string" ? object.sourcePath : undefined,
    name: typeof object.name === "string" ? object.name : undefined,
  };
}

export function normalizeKnowledgeFileSystemDeletePayload(input: unknown): KnowledgeFileSystemDeletePayload {
  const object = record(input);
  return {
    sourcePath: typeof object.sourcePath === "string" ? object.sourcePath : undefined,
  };
}

export function normalizeKnowledgeFileSystemImportFolderPayload(input: unknown): KnowledgeFileSystemImportFolderPayload {
  const object = record(input);
  return {
    folderPath: typeof object.folderPath === "string" ? object.folderPath : undefined,
  };
}

export function readKnowledgeFile(state: BridgeState, knowledgeId: string) {
  const document = requireKnowledgeDocument(state, knowledgeId);
  const descriptor = resolveKnowledgeFileDescriptor(document);
  ensureKnowledgeFileExists(document, descriptor);
  return {
    document,
    file: readKnowledgeFileSnapshot(descriptor),
  };
}

export function syncKnowledgeVaultFiles(state: BridgeState): void {
  ensureKnowledgeVaultRoot();
  syncGlobalKernelKnowledgeDocumentsIfNeeded(state);
  syncImportedNativeFolders(state);
  for (const document of listKnowledgeInventoryDocuments(state)) {
    try {
      const descriptor = resolveKnowledgeFileDescriptor(document);
      ensureKnowledgeFileExists(document, descriptor);
    } catch {
      // A broken source file should not make inventory unreadable.
    }
  }
}

export function listKnowledgeVaultFolders(state: BridgeState): KnowledgeVaultFolder[] {
  ensureKnowledgeVaultRoot();
  const folders = new Map<string, KnowledgeVaultFolder>();
  const addFolder = (folder: KnowledgeVaultFolder) => {
    const safePath = safeVaultPath(folder.path);
    if (!safePath) return;
    const existing = folders.get(safePath);
    if (existing && existing.backing === "native" && folder.backing === "vault") return;
    folders.set(safePath, {
      path: safePath,
      backing: folder.backing,
      originPath: folder.originPath,
    });
  };

  for (const root of knowledgeWritableRootSpecs(state)) {
    if (root.backing === "vault") {
      scanKnowledgeFolderRoot(root, addFolder);
    } else {
      addFolder({
        path: root.vaultPath,
        backing: "native",
        originPath: root.originPath ?? root.path,
      });
    }
  }

  // Also scan vault root for user-created subdirectories
  const vaultRoot = knowledgeVaultRoot();
  try {
    for (const entry of readdirSync(vaultRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || shouldIgnoreVaultDirectory(entry.name)) continue;
      if (PROTECTED_VAULT_ROOTS.has(entry.name)) continue;
      if (folders.has(entry.name)) continue;
      addFolder({ path: entry.name, backing: "vault" });
    }
  } catch {
    // Best-effort scan
  }

  for (const document of listKnowledgeInventoryDocuments(state)) {
    try {
      const descriptor = resolveKnowledgeFileDescriptor(document);
      const vaultPath = knowledgeVaultPath(document);
      for (const parentPath of parentVaultPaths(vaultPath)) {
        addFolder({
          path: parentPath,
          backing: descriptor.backing,
          originPath: descriptor.originPath ? resolvePhysicalParentFromVaultPath(descriptor.path, vaultPath, parentPath) : undefined,
        });
      }
    } catch {
      // Folder listing should stay best-effort when a source file is broken.
    }
  }

  return [...folders.values()].sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
}

export function createKnowledgeFileSystemEntry(
  state: BridgeState,
  payload: KnowledgeFileSystemCreatePayload,
) {
  ensureKnowledgeVaultRoot();
  const parentPath = payload.parentPath === "" ? "" : (safeVaultPath(payload.parentPath) || APP_VAULT_ROOT_NAME);
  const target = parentPath === ""
    ? { vaultPath: "", path: knowledgeVaultRoot(), backing: "vault" as const }
    : resolveKnowledgeDirectoryTarget(state, parentPath);
  mkdirSync(target.path, { recursive: true });

  if (payload.kind === "folder") {
    const folderName = safePathSegment(payload.name || "新建文件夹");
    const folderPath = uniqueDirectoryPath(target.path, folderName);
    mkdirSync(folderPath, { recursive: true });
    return {
      entry: {
        kind: "folder",
        path: joinVaultPath(target.vaultPath, basename(folderPath)),
        backing: target.backing,
        originPath: target.backing === "native" ? folderPath : undefined,
      },
      knowledge: listKnowledgeInventoryDocuments(state),
      knowledgeFolders: listKnowledgeVaultFolders(state),
    };
  }

  const noteName = ensureMarkdownFileName(safePathSegment(payload.name || "未命名"));
  const filePath = uniqueFilePath(target.path, noteName);
  const vaultPath = joinVaultPath(target.vaultPath, basename(filePath));
  const content = payload.content ?? "";
  writeFileSync(filePath, content, "utf8");
  const title = basename(filePath).replace(/\.(?:md|markdown|mdx)$/i, "");
  const document = state.app.knowledge.create({
    type: "note",
    title,
    body: content,
    format: "markdown",
    tags: [],
    scope: target.backing === "native" ? "user" : "project",
    lifecycle: "active",
    sourceRefs: [{ title, locator: filePath }],
    metadata: {
      vaultPath,
      kernelId: kernelIdForVaultPath(vaultPath),
      sourceId: sourceIdForVaultPath(vaultPath),
      sourceFilePath: filePath,
      sourceFileBacking: target.backing,
      sourceFileOriginPath: target.backing === "native" ? filePath : "",
      nativeGlobalKnowledge: target.backing === "native",
      createdBy: "opengrove.file-system",
    },
  });

  return {
    entry: {
      kind: "note",
      path: vaultPath,
      backing: target.backing,
      originPath: target.backing === "native" ? filePath : undefined,
    },
    document,
    file: readKnowledgeFileSnapshot({
      path: filePath,
      vaultPath,
      backing: target.backing,
      originPath: target.backing === "native" ? filePath : undefined,
      format: "markdown",
    }),
    knowledge: listKnowledgeInventoryDocuments(state),
    knowledgeFolders: listKnowledgeVaultFolders(state),
    knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
  };
}

export function moveKnowledgeFileSystemEntry(
  state: BridgeState,
  payload: KnowledgeFileSystemMovePayload,
) {
  ensureKnowledgeVaultRoot();
  const sourcePath = safeVaultPath(payload.sourcePath);
  const targetParentPath = safeVaultPath(payload.targetParentPath) || APP_VAULT_ROOT_NAME;
  if (!sourcePath) {
    throw new Error("knowledge_file_source_path_required");
  }
  if (sourcePath.split("/").length < 2) {
    throw new Error("knowledge_file_root_move_not_allowed");
  }
  if (rootVaultPath(sourcePath) !== rootVaultPath(targetParentPath)) {
    throw new Error("knowledge_file_cross_root_move_not_supported");
  }
  if (sourcePath === targetParentPath || vaultPathContains(targetParentPath, sourcePath)) {
    throw new Error("knowledge_file_move_into_self_not_allowed");
  }

  const source = resolveKnowledgeDirectoryTarget(state, sourcePath);
  const target = resolveKnowledgeDirectoryTarget(state, targetParentPath);
  if (!existsSync(source.path)) {
    throw new Error("knowledge_file_source_not_found");
  }
  mkdirSync(target.path, { recursive: true });
  const sourceStat = statSync(source.path);
  const sourceName = basename(source.path);
  const currentParent = dirname(source.path);
  if (resolve(currentParent) === resolve(target.path)) {
    return {
      entry: {
        kind: sourceStat.isDirectory() ? "folder" : "note",
        path: sourcePath,
        backing: source.backing,
        originPath: source.backing === "native" ? source.path : undefined,
      },
      knowledge: listKnowledgeInventoryDocuments(state),
      knowledgeFolders: listKnowledgeVaultFolders(state),
      knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    };
  }

  const destinationPath = sourceStat.isDirectory()
    ? uniqueDirectoryPath(target.path, sourceName)
    : uniqueFilePath(target.path, sourceName);
  const destinationVaultPath = joinVaultPath(target.vaultPath, basename(destinationPath));
  renameSync(source.path, destinationPath);
  updateKnowledgeDocumentPathsAfterMove(state, {
    sourceVaultPath: sourcePath,
    destinationVaultPath,
    sourcePath: source.path,
    destinationPath,
  });

  return {
    entry: {
      kind: sourceStat.isDirectory() ? "folder" : "note",
      path: destinationVaultPath,
      backing: target.backing,
      originPath: target.backing === "native" ? destinationPath : undefined,
    },
    knowledge: listKnowledgeInventoryDocuments(state),
    knowledgeFolders: listKnowledgeVaultFolders(state),
    knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
  };
}

export function renameKnowledgeFileSystemEntry(
  state: BridgeState,
  payload: KnowledgeFileSystemRenamePayload,
) {
  ensureKnowledgeVaultRoot();
  const sourcePath = safeVaultPath(payload.sourcePath);
  if (!sourcePath) {
    throw new Error("knowledge_file_source_path_required");
  }
  if (sourcePath.split("/").length < 2) {
    throw new Error("knowledge_file_root_rename_not_allowed");
  }
  const source = resolveKnowledgeDirectoryTarget(state, sourcePath);
  if (!existsSync(source.path)) {
    throw new Error("knowledge_file_source_not_found");
  }
  const sourceStat = statSync(source.path);
  const requestedName = safePathSegment(payload.name || basename(source.path));
  const nextName = sourceStat.isDirectory() ? requestedName : ensureMarkdownFileName(requestedName);
  const parentPath = dirname(source.path);
  const destinationPath = sourceStat.isDirectory()
    ? uniqueDirectoryPath(parentPath, nextName)
    : uniqueFilePath(parentPath, nextName);
  const parentVaultPath = sourcePath.split("/").slice(0, -1).join("/");
  const destinationVaultPath = joinVaultPath(parentVaultPath, basename(destinationPath));
  if (resolve(source.path) !== resolve(destinationPath)) {
    renameSync(source.path, destinationPath);
  }
  updateKnowledgeDocumentPathsAfterMove(state, {
    sourceVaultPath: sourcePath,
    destinationVaultPath,
    sourcePath: source.path,
    destinationPath,
  });
  updateKnowledgeDocumentTitlesAfterRename(state, {
    sourceVaultPath: sourcePath,
    destinationVaultPath,
    destinationPath,
  });
  return {
    entry: {
      kind: sourceStat.isDirectory() ? "folder" : "note",
      path: destinationVaultPath,
      backing: source.backing,
      originPath: source.backing === "native" ? destinationPath : undefined,
    },
    knowledge: listKnowledgeInventoryDocuments(state),
    knowledgeFolders: listKnowledgeVaultFolders(state),
    knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
  };
}

export function deleteKnowledgeFileSystemEntry(
  state: BridgeState,
  payload: KnowledgeFileSystemDeletePayload,
) {
  ensureKnowledgeVaultRoot();
  const sourcePath = safeVaultPath(payload.sourcePath);
  if (!sourcePath) {
    throw new Error("knowledge_file_source_path_required");
  }
  const segments = sourcePath.split("/");
  if (segments.length < 2 && isProtectedVaultRoot(segments[0])) {
    throw new Error("knowledge_file_root_delete_not_allowed");
  }
  const source = resolveKnowledgeDirectoryTarget(state, sourcePath);

  let entryKind: "folder" | "note" = "note";
  if (existsSync(source.path)) {
    const sourceStat = statSync(source.path);
    entryKind = sourceStat.isDirectory() ? "folder" : "note";
    // Only delete actual files for vault-backed entries (managed by the app).
    // Native-backed files must NEVER be deleted from disk — only unregistered.
    if (source.backing === "vault") {
      rmSync(source.path, { recursive: sourceStat.isDirectory(), force: true });
    }
  }

  const deletedKnowledgeIds = deleteKnowledgeDocumentsUnderVaultPath(state, sourcePath);
  return {
    entry: {
      kind: entryKind,
      path: sourcePath,
      backing: source.backing,
      originPath: source.backing === "native" ? source.path : undefined,
    },
    deletedKnowledgeIds,
    knowledge: listKnowledgeInventoryDocuments(state),
    knowledgeFolders: listKnowledgeVaultFolders(state),
    knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
  };
}

export function filterEnabledKnowledgeDocuments(
  state: BridgeState,
  documents: KnowledgeDocument[],
): KnowledgeDocument[] {
  return documents.filter((document) =>
    isPrimaryLibraryDocument(document) && isKnowledgeDocumentSourceEnabled(state, document)
  );
}

export function listKnowledgeInventoryDocuments(
  state: BridgeState,
  limit = KNOWLEDGE_INVENTORY_LIMIT,
): KnowledgeDocument[] {
  const documents = filterEnabledKnowledgeDocuments(
    state,
    state.app.knowledge.list({ lifecycle: "active" }),
  );
  return Number.isFinite(limit) && limit > 0 ? documents.slice(0, limit) : documents;
}

export function writeKnowledgeFile(
  state: BridgeState,
  knowledgeId: string,
  payload: KnowledgeFilePatchPayload,
) {
  const document = requireKnowledgeDocument(state, knowledgeId);
  const descriptor = resolveKnowledgeFileDescriptor(document);
  ensureKnowledgeFileParent(document, descriptor.path);
  if (!isPathInsideRoot(descriptor.path, knowledgeVaultRoot()) && !isAllowedKnowledgeSourcePath(document, descriptor.path)) {
    throw new Error("knowledge_file_path_not_allowed");
  }
  writeFileSync(descriptor.path, payload.content, "utf8");

  const nextMetadata = {
    ...(document.metadata ?? {}),
    sourceFilePath: descriptor.path,
    sourceFileBacking: descriptor.backing,
    sourceFileOriginPath: descriptor.originPath ?? "",
    sourceFileSyncedAt: new Date().toISOString(),
  };
  const updated = state.app.knowledge.update(knowledgeId, {
    title: payload.title?.trim() || document.title,
    body: payload.content,
    format: descriptor.format,
    tags: payload.tags ?? document.tags,
    sourceRefs: upsertKnowledgeFileSourceRef(document.sourceRefs, descriptor.path, payload.title?.trim() || document.title),
    metadata: nextMetadata,
  });
  return {
    document: updated,
    file: readKnowledgeFileSnapshot(descriptor),
  };
}

export function requireKnowledgeDocument(state: BridgeState, knowledgeId: string): KnowledgeDocument {
  const document = state.app.knowledge.get(knowledgeId);
  if (!document) {
    throw new Error(`knowledge_document_not_found:${knowledgeId}`);
  }
  return document;
}

export function resolveKnowledgeFileDescriptor(document: KnowledgeDocument): KnowledgeFileDescriptor {
  const vaultPath = knowledgeVaultPath(document);
  const metadata = document.metadata ?? {};
  const declaredNativePath = typeof metadata.sourceFilePath === "string"
    ? normalizeKnowledgeLocalPath(metadata.sourceFilePath)
    : undefined;
  if (metadata.sourceFileBacking === "native" && declaredNativePath) {
    return {
      path: declaredNativePath,
      vaultPath,
      backing: "native",
      format: inferKnowledgeFileFormat(declaredNativePath),
      originPath: declaredNativePath,
    };
  }
  const originPath = resolveNativeKnowledgeFilePath(document);
  return {
    path: originPath ?? resolve(knowledgeVaultRoot(), vaultPath),
    vaultPath,
    backing: originPath ? "native" : "vault",
    format: inferKnowledgeFileFormat(originPath || vaultPath),
    originPath,
  };
}

export function resolveKnowledgeVaultFilePath(vaultPath: string, state?: BridgeState): string | undefined {
  const safePath = safeVaultPath(vaultPath);
  if (!safePath) return undefined;
  const specs = knowledgeWritableRootSpecs(state)
    .filter((spec) => vaultPathContains(safePath, spec.vaultPath))
    .sort((left, right) => right.vaultPath.length - left.vaultPath.length);
  const matched = specs[0];
  if (matched) {
    const relativePath = relativeVaultPath(matched.vaultPath, safePath);
    return resolve(matched.path, ...relativePath.split("/").filter(Boolean));
  }
  return resolve(knowledgeVaultRoot(), safePath);
}

export function knowledgeVaultRoot(): string {
  return resolve(process.cwd(), "data", APP_VAULT_DIR);
}

export function ensureKnowledgeVaultRoot(): void {
  const root = knowledgeVaultRoot();
  for (const dir of [
    "",
    APP_VAULT_ROOT_NAME,
    `${APP_VAULT_ROOT_NAME}/skills`,
    `${APP_VAULT_ROOT_NAME}/memories`,
    `${APP_VAULT_ROOT_NAME}/artifacts`,
    "Codex",
    "Codex/skills",
    "Claude",
    "Claude/skills",
    "Claude/agents",
    "Claude/memory",
    "Hermes",
    "Hermes/skills",
    "Hermes/memory",
  ]) {
    mkdirSync(resolve(root, dir), { recursive: true });
  }
}

function knowledgeWritableRootSpecs(state?: BridgeState): KnowledgeWritableRootSpec[] {
  const home = homedir();
  const root = knowledgeVaultRoot();
  const codexHome = state ? kernelConfigHome(state.settings, "codex") : join(home, ".codex");
  const claudeHome = state ? kernelConfigHome(state.settings, "claude-code") : join(home, ".claude");
  const hermesHome = state ? kernelConfigHome(state.settings, "hermes") : join(home, ".hermes");
  const specs: KnowledgeWritableRootSpec[] = [
    { vaultPath: APP_VAULT_ROOT_NAME, path: resolve(root, APP_VAULT_ROOT_NAME), backing: "vault" },
    { vaultPath: "Codex", path: codexHome, backing: "native", originPath: codexHome },
    { vaultPath: "Codex/skills", path: join(codexHome, "skills"), backing: "native", originPath: join(codexHome, "skills") },
    { vaultPath: "Codex/skills", path: join(home, ".agents", "skills"), backing: "native", originPath: join(home, ".agents", "skills") },
    { vaultPath: "Codex/memories", path: join(codexHome, "memories"), backing: "native", originPath: join(codexHome, "memories") },
    { vaultPath: "Claude", path: claudeHome, backing: "native", originPath: claudeHome },
    { vaultPath: "Claude/skills", path: join(claudeHome, "skills"), backing: "native", originPath: join(claudeHome, "skills") },
    { vaultPath: "Claude/commands", path: join(claudeHome, "commands"), backing: "native", originPath: join(claudeHome, "commands") },
    { vaultPath: "Claude/agents", path: join(claudeHome, "agents"), backing: "native", originPath: join(claudeHome, "agents") },
    { vaultPath: "Claude/memory", path: join(claudeHome, "agent-memory"), backing: "native", originPath: join(claudeHome, "agent-memory") },
    { vaultPath: "Hermes", path: hermesHome, backing: "native", originPath: hermesHome },
    { vaultPath: "Hermes/skills", path: join(hermesHome, "skills"), backing: "native", originPath: join(hermesHome, "skills") },
    { vaultPath: "Hermes/memory", path: join(hermesHome, "memories"), backing: "native", originPath: join(hermesHome, "memories") },
  ];

  // Discover imported native folder roots from knowledge documents
  if (state) {
    const seen = new Set(specs.map((s) => s.vaultPath));
    for (const document of state.app.knowledge.list({ limit: 5_000 })) {
      const metadata = document.metadata ?? {};
      if (metadata.createdBy !== "opengrove.import-folder") continue;
      const vaultPath = safeVaultPath(metadata.vaultPath);
      if (!vaultPath) continue;
      const rootName = vaultPath.split("/")[0];
      if (!rootName || seen.has(rootName)) continue;
      const originPath = resolveImportedRootPath(state, rootName);
      if (originPath) {
        specs.push({ vaultPath: rootName, path: originPath, backing: "native", originPath });
        seen.add(rootName);
      }
    }
  }

  return specs;
}

function resolveImportedRootPath(state: BridgeState, rootName: string): string | undefined {
  for (const document of state.app.knowledge.list({ limit: 5_000 })) {
    const metadata = document.metadata ?? {};
    if (metadata.createdBy !== "opengrove.import-folder") continue;
    const vaultPath = safeVaultPath(metadata.vaultPath);
    if (!vaultPath) continue;
    const originPath = typeof metadata.sourceFileOriginPath === "string" ? metadata.sourceFileOriginPath : "";
    if (!originPath) continue;
    // Marker doc: vaultPath is rootName/.imported-root, originPath is the folder itself
    if (metadata.importedFolderRoot && (vaultPath === rootName || vaultPath === `${rootName}/.imported-root`)) {
      return originPath;
    }
    // File doc: vaultPath starts with rootName/
    if (!vaultPath.startsWith(`${rootName}/`)) continue;
    const relFromRoot = vaultPath.slice(rootName.length + 1);
    const relSegments = relFromRoot.split("/").filter(Boolean);
    let resolved = originPath;
    for (let i = 0; i < relSegments.length; i++) {
      resolved = dirname(resolved);
    }
    return resolved;
  }
  return undefined;
}

function scanKnowledgeFolderRoot(
  root: KnowledgeWritableRootSpec,
  addFolder: (folder: KnowledgeVaultFolder) => void,
  depth = 0,
): void {
  if (!existsSync(root.path)) return;
  addFolder({ path: root.vaultPath, backing: root.backing, originPath: root.originPath ?? root.path });
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(root.path, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || shouldIgnoreVaultDirectory(entry.name)) continue;
    const child = {
      ...root,
      path: join(root.path, entry.name),
      originPath: root.backing === "native" ? join(root.path, entry.name) : undefined,
      vaultPath: joinVaultPath(root.vaultPath, safePathSegment(entry.name)),
    };
    scanKnowledgeFolderRoot(child, addFolder, depth + 1);
  }
}

export function knowledgeVaultPath(document: KnowledgeDocument): string {
  const metadata = document.metadata ?? {};
  const explicitVaultPath = safeVaultPath(metadata.vaultPath);
  if (explicitVaultPath) {
    return explicitVaultPath;
  }
  const sourceRoot = knowledgeSourceRoot(document);
  if (metadata.parentSkillId && typeof metadata.skillFilePath === "string") {
    return [
      sourceRoot,
      "skills",
      safePathSegment(String(metadata.skillName || metadata.skillId || "skill")),
      ...metadata.skillFilePath.split(/[\\/]/).map((part) => safePathSegment(part)),
    ].join("/");
  }
  if (document.type === "skill") {
    return `${sourceRoot}/skills/${safePathSegment(String(metadata.skillName || document.slug || document.id))}/SKILL.md`;
  }
  if (needsKnowledgeReviewForFile(document)) {
    return `${sourceRoot}/inbox/${knowledgeFileName(document)}`;
  }
  if (document.type === "memory") {
    return `${sourceRoot}/memories/${knowledgeFileName(document)}`;
  }
  if (document.type === "artifact_ref") {
    return `${sourceRoot}/artifacts/${knowledgeFileName(document)}`;
  }
  if (document.type === "project_doc") {
    return `${sourceRoot}/projects/${knowledgeFileName(document)}`;
  }
  if (document.type === "profile") {
    return `${sourceRoot}/profiles/${knowledgeFileName(document)}`;
  }
  if (document.type === "routine") {
    return `${sourceRoot}/routines/${knowledgeFileName(document)}`;
  }
  if (document.type === "source") {
    return `${sourceRoot}/sources/${knowledgeFileName(document)}`;
  }
  return `${sourceRoot}/notes/${knowledgeFileName(document)}`;
}

function knowledgeSourceRoot(document: KnowledgeDocument): string {
  const metadata = document.metadata ?? {};
  const explicit = stringValue(metadata.kernelId) || stringValue(metadata.kernel) || stringValue(metadata.sourceKernel);
  if (explicit) {
    return normalizeKnowledgeSourceRoot(explicit);
  }
  const haystack = [
    stringValue(metadata.skillRoot),
    stringValue(metadata.entry),
    stringValue(metadata.sourceFilePath),
    stringValue(metadata.sourceFileOriginPath),
    ...(document.sourceRefs ?? []).map((ref) => ref.locator || ""),
  ].join("\n").replace(/\\/g, "/").toLowerCase();
  if (haystack.includes("/.claude/") || haystack.includes("/claude.md")) return "Claude";
  if (haystack.includes("/.hermes/")) return "Hermes";
  if (haystack.includes("/.codex/") || haystack.includes("/.agents/skills/")) return "Codex";
  return APP_VAULT_ROOT_NAME;
}

function normalizeKnowledgeSourceRoot(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude code") return "Claude";
  if (normalized === "codex") return "Codex";
  if (normalized === "hermes") return "Hermes";
  if (normalized === APP_PROTOCOL_ID || normalized === APP_PRODUCT_NAME.toLowerCase()) {
    return APP_VAULT_ROOT_NAME;
  }
  return APP_VAULT_ROOT_NAME;
}

function isKnowledgeDocumentSourceEnabled(state: BridgeState, document: KnowledgeDocument): boolean {
  const kernelId = knowledgeSourceKernelId(document);
  const sourceId = knowledgeSourceId(document, kernelId);
  const kernelSettings = state.settings.kernelKnowledgeSourceEnabled[kernelId];
  if (!kernelSettings) return true;
  if (typeof kernelSettings[sourceId] === "boolean") return kernelSettings[sourceId];
  const rootSwitch = `${kernelId}.all`;
  if (typeof kernelSettings[rootSwitch] === "boolean") return kernelSettings[rootSwitch];
  return true;
}

function knowledgeSourceKernelId(document: KnowledgeDocument): string {
  const root = knowledgeSourceRoot(document);
  if (root === "Codex") return "codex";
  if (root === "Claude") return "claude-code";
  if (root === "Hermes") return "hermes";
  return APP_PROTOCOL_ID;
}

function knowledgeSourceId(document: KnowledgeDocument, kernelId: string): string {
  const metadata = document.metadata ?? {};
  const explicitSourceId = stringValue(metadata.sourceId);
  if (explicitSourceId) {
    return explicitSourceId;
  }
  const path = [
    stringValue(metadata.skillRoot),
    stringValue(metadata.entry),
    stringValue(metadata.sourceFilePath),
    stringValue(metadata.sourceFileOriginPath),
    ...(document.sourceRefs ?? []).map((ref) => ref.locator || ""),
  ].join("\n").replace(/\\/g, "/").toLowerCase();
  if (kernelId === "codex") {
    if (path.includes("/.codex/skills/.system/")) return "codex.system-skills";
    if (path.includes("/.codex/skills/")) return "codex.project-codex-skills";
    if (path.includes("/.agents/skills/")) return "codex.project-agent-skills";
    return "codex.user-skills";
  }
  if (kernelId === "claude-code") {
    if (path.includes("/.claude/skills/")) return "claude.project-skills";
    if (path.includes("/.claude/commands/")) return "claude.project-commands";
    if (path.includes("/.claude/agents/")) return "claude.project-agents";
    if (path.includes("/.claude/agent-memory")) return "claude.project-agent-memory";
    if (path.includes("/claude.md") || path.includes("/.claude/rules/")) return "claude.project-claude-md";
    return "claude.user-skills";
  }
  if (kernelId === "hermes") {
    if (path.includes(`/${APP_CONFIG_DIR}/native-skills/hermes/`)) return `hermes.${APP_PROTOCOL_ID}-external-skills`;
    if (path.includes("/.hermes/memories/")) return "hermes.memories";
    return "hermes.local-skills";
  }
  if (document.type === "skill") return `${APP_PROTOCOL_ID}.skills`;
  if (document.type === "artifact_ref") return `${APP_PROTOCOL_ID}.artifacts`;
  if (document.type === "memory") return `${APP_PROTOCOL_ID}.vault`;
  return `${APP_PROTOCOL_ID}.vault`;
}

function syncGlobalKernelKnowledgeDocuments(state: BridgeState): void {
  const home = homedir();
  const codexHome = kernelConfigHome(state.settings, "codex");
  const claudeHome = kernelConfigHome(state.settings, "claude-code");
  const hermesHome = kernelConfigHome(state.settings, "hermes");
  upsertNativeMarkdownFile(state, {
    id: "native.codex.agents-md",
    kernelId: "codex",
    sourceId: "codex.user-agents-md",
    title: "AGENTS.md",
    path: join(codexHome, "AGENTS.md"),
    vaultPath: "Codex/AGENTS.md",
    tags: ["codex", "instructions"],
    type: "project_doc",
  });
  upsertSkillDirectory(state, {
    kernelId: "codex",
    sourceId: "codex.user-skills",
    dir: join(codexHome, "skills"),
    vaultRoot: "Codex/skills",
    tags: ["codex", "skill"],
  });
  upsertNativeKnowledgeDirectory(state, {
    kernelId: "codex",
    sourceId: "codex.user-memories",
    dir: join(codexHome, "memories"),
    vaultRoot: "Codex/memories",
    tags: ["codex", "memory"],
    type: "memory",
  });
  upsertSkillDirectory(state, {
    kernelId: "codex",
    sourceId: "codex.user-agent-skills",
    dir: join(home, ".agents", "skills"),
    vaultRoot: "Codex/skills",
    tags: ["codex", "skill"],
  });

  upsertNativeMarkdownFile(state, {
    id: "native.claude.claude-md",
    kernelId: "claude-code",
    sourceId: "claude.user-claude-md",
    title: "CLAUDE.md",
    path: join(claudeHome, "CLAUDE.md"),
    vaultPath: "Claude/CLAUDE.md",
    tags: ["claude", "instructions"],
    type: "project_doc",
  });
  upsertSkillDirectory(state, {
    kernelId: "claude-code",
    sourceId: "claude.user-skills",
    dir: join(claudeHome, "skills"),
    vaultRoot: "Claude/skills",
    tags: ["claude", "skill"],
  });
  upsertSkillDirectory(state, {
    kernelId: "claude-code",
    sourceId: "claude.user-commands",
    dir: join(claudeHome, "commands"),
    vaultRoot: "Claude/commands",
    tags: ["claude", "command"],
  });
  upsertClaudeAgents(state, join(claudeHome, "agents"));
  upsertClaudeAgentMemory(state, join(claudeHome, "agent-memory"));

  upsertNativeMarkdownFile(state, {
    id: "native.hermes.soul-md",
    kernelId: "hermes",
    sourceId: "hermes.soul",
    title: "SOUL.md",
    path: join(hermesHome, "SOUL.md"),
    vaultPath: "Hermes/SOUL.md",
    tags: ["hermes", "identity"],
    type: "profile",
  });
  upsertSkillDirectory(state, {
    kernelId: "hermes",
    sourceId: "hermes.local-skills",
    dir: join(hermesHome, "skills"),
    vaultRoot: "Hermes/skills",
    tags: ["hermes", "skill"],
  });
  upsertSkillDirectory(state, {
    kernelId: APP_PROTOCOL_ID,
    sourceId: `${APP_PROTOCOL_ID}.cc-switch-skills`,
    dir: join(home, ".cc-switch", "skills"),
    vaultRoot: `${APP_VAULT_ROOT_NAME}/skills`,
    tags: [APP_PROTOCOL_ID, "skill", "cc-switch"],
  });
  upsertNativeMarkdownFile(state, {
    id: "native.hermes.memory-md",
    kernelId: "hermes",
    sourceId: "hermes.memories",
    title: "MEMORY.md",
    path: join(hermesHome, "memories", "MEMORY.md"),
    vaultPath: "Hermes/memory/MEMORY.md",
    tags: ["hermes", "memory"],
    type: "memory",
  });
  upsertNativeMarkdownFile(state, {
    id: "native.hermes.user-md",
    kernelId: "hermes",
    sourceId: "hermes.memories",
    title: "USER.md",
    path: join(hermesHome, "memories", "USER.md"),
    vaultPath: "Hermes/memory/USER.md",
    tags: ["hermes", "memory", "user"],
    type: "memory",
  });
}

function syncGlobalKernelKnowledgeDocumentsIfNeeded(state: BridgeState): void {
  const syncKey = [
    kernelConfigHome(state.settings, "codex"),
    kernelConfigHome(state.settings, "claude-code"),
    kernelConfigHome(state.settings, "hermes"),
  ].join("\0");
  const now = Date.now();
  if (
    syncKey === lastGlobalKernelKnowledgeSyncKey &&
    now - lastGlobalKernelKnowledgeSyncAt < GLOBAL_KERNEL_KNOWLEDGE_SYNC_INTERVAL_MS
  ) {
    return;
  }
  lastGlobalKernelKnowledgeSyncKey = syncKey;
  lastGlobalKernelKnowledgeSyncAt = now;
  syncGlobalKernelKnowledgeDocuments(state);
}

function upsertSkillDirectory(
  state: BridgeState,
  input: {
    kernelId: string;
    sourceId: string;
    dir: string;
    vaultRoot: string;
    tags: string[];
  },
): void {
  if (!existsSync(input.dir)) return;
  for (const entry of safeReadDir(input.dir)) {
    if (!entry.isDirectory() || shouldIgnoreVaultDirectory(entry.name)) continue;
    upsertNativeSkillFolder(state, {
      ...input,
      skillName: entry.name,
      skillRoot: join(input.dir, entry.name),
      vaultRoot: `${input.vaultRoot}/${safePathSegment(entry.name)}`,
    });
  }
}

function upsertNativeSkillFolder(
  state: BridgeState,
  input: {
    kernelId: string;
    sourceId: string;
    skillName: string;
    skillRoot: string;
    vaultRoot: string;
    tags: string[];
  },
): void {
  const skillId = `native.${input.kernelId}.skill.${safeIdSegment(input.skillName)}`;
  for (const filePath of listVisibleKnowledgeFiles(input.skillRoot)) {
    const relativePath = relative(input.skillRoot, filePath).replace(/\\/g, "/");
    const isEntry = relativePath.toLowerCase() === "skill.md";
    upsertNativeMarkdownFile(state, {
      id: isEntry ? skillId : `${skillId}.${shortHash(filePath)}`,
      kernelId: input.kernelId,
      sourceId: input.sourceId,
      title: isEntry ? input.skillName : relativePath,
      path: filePath,
      vaultPath: `${input.vaultRoot}/${relativePath.split("/").map((part) => safePathSegment(part)).join("/")}`,
      tags: isEntry ? input.tags : [...input.tags, "reference"],
      type: isEntry ? "skill" : "source",
      metadata: {
        skillName: input.skillName,
        skillRoot: input.skillRoot,
        entry: join(input.skillRoot, "SKILL.md"),
        parentSkillId: skillId,
        skillFilePath: relativePath,
      },
    });
  }
}

function upsertNativeKnowledgeDirectory(
  state: BridgeState,
  input: {
    kernelId: string;
    sourceId: string;
    dir: string;
    vaultRoot: string;
    tags: string[];
    type: "memory" | "note" | "project_doc" | "profile" | "source";
  },
): void {
  if (!existsSync(input.dir)) return;
  for (const filePath of listVisibleKnowledgeFiles(input.dir)) {
    const relativePath = relative(input.dir, filePath).replace(/\\/g, "/");
    upsertNativeMarkdownFile(state, {
      id: `native.${input.kernelId}.${input.sourceId}.${shortHash(filePath)}`,
      kernelId: input.kernelId,
      sourceId: input.sourceId,
      title: relativePath,
      path: filePath,
      vaultPath: `${input.vaultRoot}/${relativePath.split("/").map((part) => safePathSegment(part)).join("/")}`,
      tags: input.tags,
      type: input.type,
    });
  }
}

function listVisibleKnowledgeFiles(root: string, depth = 0): string[] {
  if (depth > 8) return [];
  const files: string[] = [];
  for (const entry of safeReadDir(root)) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!shouldIgnoreVaultDirectory(entry.name)) {
        files.push(...listVisibleKnowledgeFiles(path, depth + 1));
      }
      continue;
    }
    if (!entry.isFile() || !isVisibleKnowledgeFileName(entry.name)) continue;
    try {
      const stat = statSync(path);
      if (!stat.isFile() || stat.size > KNOWLEDGE_FILE_SIZE_LIMIT) continue;
      files.push(path);
    } catch {
      // Ignore files that disappear while scanning.
    }
  }
  return files.sort((left, right) => relative(root, left).localeCompare(relative(root, right), "zh-CN"));
}

function safeReadDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isVisibleKnowledgeFileName(name: string): boolean {
  return VISIBLE_KNOWLEDGE_EXTENSIONS.has(extname(name).toLowerCase());
}

function shouldIgnoreVaultDirectory(name: string): boolean {
  return IGNORED_VAULT_DIR_NAMES.has(name) || name.startsWith(".");
}

function upsertClaudeAgents(state: BridgeState, dir: string): void {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") continue;
    const file = join(dir, entry.name);
    const name = basename(entry.name, ".md");
    upsertNativeMarkdownFile(state, {
      id: `native.claude.agent.${safeIdSegment(name)}`,
      kernelId: "claude-code",
      sourceId: "claude.user-agents",
      title: entry.name,
      path: file,
      vaultPath: `Claude/agents/${safePathSegment(entry.name)}`,
      tags: ["claude", "agent"],
      type: "profile",
    });
  }
}

function upsertClaudeAgentMemory(state: BridgeState, dir: string): void {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(dir, entry.name, "MEMORY.md");
    upsertNativeMarkdownFile(state, {
      id: `native.claude.memory.${safeIdSegment(entry.name)}`,
      kernelId: "claude-code",
      sourceId: "claude.user-agent-memory",
      title: `${entry.name}/MEMORY.md`,
      path: file,
      vaultPath: `Claude/memory/${safePathSegment(entry.name)}/MEMORY.md`,
      tags: ["claude", "memory", entry.name],
      type: "memory",
    });
  }
}

function upsertNativeMarkdownFile(
  state: BridgeState,
  input: {
    id: string;
    kernelId: string;
    sourceId: string;
    title: string;
    path: string;
    vaultPath: string;
    tags: string[];
    type: "skill" | "memory" | "note" | "project_doc" | "profile" | "source";
    metadata?: Record<string, unknown>;
  },
): void {
  if (!existsSync(input.path)) return;
  try {
    const stat = statSync(input.path);
    if (!stat.isFile() || stat.size > KNOWLEDGE_FILE_SIZE_LIMIT) return;
    const body = readFileSync(input.path, "utf8");
    state.app.knowledge.upsert({
      id: input.id,
      slug: input.id.replace(/^native\./, "native-").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase(),
      type: input.type,
      title: input.title,
      body,
      format: inferKnowledgeFileFormat(input.path),
      tags: input.tags,
      sourceRefs: [{ title: input.title, locator: input.path }],
      scope: "user",
      lifecycle: "active",
      metadata: {
        nativeGlobalKnowledge: true,
        kernelId: input.kernelId,
        sourceId: input.sourceId,
        sourceFilePath: input.path,
        sourceFileOriginPath: input.path,
        vaultPath: input.vaultPath,
        ...input.metadata,
      },
    });
  } catch {
    // Native files are optional; a broken file should not break inventory.
  }
}

function isPrimaryLibraryDocument(document: KnowledgeDocument): boolean {
  const metadata = document.metadata ?? {};
  if (metadata.nativeGlobalKnowledge === true || safeVaultPath(metadata.vaultPath)) {
    return true;
  }
  const root = knowledgeSourceRoot(document);
  const source = stringValue(metadata.source);
  const isSkillChild = Boolean(metadata.parentSkillId && typeof metadata.skillFilePath === "string");
  if (root === "OpenGrove") {
    if (document.type === "memory" || document.type === "artifact_ref") return true;
    if ((document.type === "skill" || (document.type === "source" && isSkillChild)) && source !== "project") return true;
    return false;
  }
  if (root === "Codex" || root === "Claude" || root === "Hermes") {
    return document.type === "skill" && source === "user";
  }
  return false;
}

function safeVaultPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") return undefined;
  return normalized;
}

function resolveKnowledgeDirectoryTarget(state: BridgeState, parentPath: string): KnowledgeDirectoryTarget {
  const safeParent = safeVaultPath(parentPath) || APP_VAULT_ROOT_NAME;
  const specs = knowledgeWritableRootSpecs(state)
    .filter((spec) => vaultPathContains(safeParent, spec.vaultPath))
    .sort((left, right) => right.vaultPath.length - left.vaultPath.length);
  const matched = specs[0];
  if (matched) {
    const relativePath = relativeVaultPath(matched.vaultPath, safeParent);
    return {
      vaultPath: safeParent,
      path: resolve(matched.path, ...relativePath.split("/").filter(Boolean)),
      backing: matched.backing,
      originPath: matched.backing === "native" ? resolve(matched.path, ...relativePath.split("/").filter(Boolean)) : undefined,
    };
  }
  return {
    vaultPath: safeParent,
    path: resolve(knowledgeVaultRoot(), safeParent),
    backing: "vault",
  };
}

function vaultPathContains(childPath: string, parentPath: string): boolean {
  return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

function rootVaultPath(path: string): string {
  return safeVaultPath(path)?.split("/")[0] || APP_VAULT_ROOT_NAME;
}

function relativeVaultPath(parentPath: string, childPath: string): string {
  if (childPath === parentPath) return "";
  return childPath.slice(parentPath.length + 1);
}

function parentVaultPaths(vaultPath: string): string[] {
  const segments = vaultPath.split("/").filter(Boolean);
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function resolvePhysicalParentFromVaultPath(filePath: string, fileVaultPath: string, parentVaultPath: string): string | undefined {
  if (!vaultPathContains(fileVaultPath, parentVaultPath)) return undefined;
  const remainderSegments = relativeVaultPath(parentVaultPath, fileVaultPath).split("/").filter(Boolean);
  let parent = resolve(filePath);
  for (let index = 0; index < remainderSegments.length; index += 1) {
    parent = dirname(parent);
  }
  return parent;
}

function joinVaultPath(parentPath: string, childName: string): string {
  return [safeVaultPath(parentPath), safePathSegment(childName)].filter(Boolean).join("/");
}

function updateKnowledgeDocumentPathsAfterMove(
  state: BridgeState,
  input: {
    sourceVaultPath: string;
    destinationVaultPath: string;
    sourcePath: string;
    destinationPath: string;
  },
): void {
  for (const document of state.app.knowledge.list({ limit: 5_000 })) {
    const currentVaultPath = safeVaultPath(document.metadata?.vaultPath);
    if (!currentVaultPath || !vaultPathContains(currentVaultPath, input.sourceVaultPath)) continue;
    const nextVaultPath = replaceVaultPathPrefix(currentVaultPath, input.sourceVaultPath, input.destinationVaultPath);
    const nextMetadata = replaceMetadataPathPrefixes(document.metadata ?? {}, input.sourcePath, input.destinationPath);
    state.app.knowledge.update(document.id, {
      metadata: {
        ...nextMetadata,
        vaultPath: nextVaultPath,
        sourceFileSyncedAt: new Date().toISOString(),
      },
      sourceRefs: (document.sourceRefs ?? []).map((ref) => ({
        ...ref,
        locator: replaceLocatorPathPrefix(ref.locator, input.sourcePath, input.destinationPath),
      })),
    });
  }
}

function updateKnowledgeDocumentTitlesAfterRename(
  state: BridgeState,
  input: {
    sourceVaultPath: string;
    destinationVaultPath: string;
    destinationPath: string;
  },
): void {
  const isSingleFileRename = !input.sourceVaultPath.endsWith("/") && extname(input.destinationPath);
  if (!isSingleFileRename) return;
  const nextTitle = basename(input.destinationPath).replace(/\.(?:md|markdown|mdx|txt)$/i, "");
  for (const document of state.app.knowledge.list({ limit: 5_000 })) {
    const currentVaultPath = safeVaultPath(document.metadata?.vaultPath);
    if (currentVaultPath !== input.destinationVaultPath) continue;
    state.app.knowledge.update(document.id, {
      title: nextTitle,
      sourceRefs: upsertKnowledgeFileSourceRef(document.sourceRefs, input.destinationPath, nextTitle),
    });
  }
}

function deleteKnowledgeDocumentsUnderVaultPath(state: BridgeState, sourceVaultPath: string): string[] {
  const deletedIds: string[] = [];
  for (const document of state.app.knowledge.list({ limit: 5_000 })) {
    const currentVaultPath = safeVaultPath(document.metadata?.vaultPath);
    if (!currentVaultPath || !vaultPathContains(currentVaultPath, sourceVaultPath)) continue;
    if (state.app.knowledge.delete(document.id)) {
      deletedIds.push(document.id);
    }
  }
  return deletedIds;
}

function replaceVaultPathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  return joinVaultPath(newPrefix, relativeVaultPath(oldPrefix, path));
}

function replaceMetadataPathPrefixes(
  metadata: Record<string, unknown>,
  oldPrefix: string,
  newPrefix: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...metadata };
  for (const key of ["sourceFilePath", "sourceFileOriginPath", "skillRoot", "entry"]) {
    const value = metadata[key];
    if (typeof value === "string") {
      next[key] = replaceLocalPathPrefix(value, oldPrefix, newPrefix);
    }
  }
  return next;
}

function replaceLocatorPathPrefix(locator: string | undefined, oldPrefix: string, newPrefix: string): string | undefined {
  if (!locator) return locator;
  return replaceLocalPathPrefix(locator, oldPrefix, newPrefix);
}

function replaceLocalPathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  const localPath = normalizeKnowledgeLocalPath(path);
  if (!localPath || !isPathInsideRoot(localPath, oldPrefix)) return path;
  return resolve(newPrefix, relative(resolve(oldPrefix), localPath));
}

function ensureMarkdownFileName(name: string): string {
  return /\.(?:md|markdown|mdx)$/i.test(name) ? name : `${name}.md`;
}

function uniqueFilePath(parentPath: string, fileName: string): string {
  const extension = extname(fileName) || ".md";
  const stem = fileName.slice(0, fileName.length - extension.length) || "未命名";
  let candidate = resolve(parentPath, `${stem}${extension}`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = resolve(parentPath, `${stem} ${index}${extension}`);
    index += 1;
  }
  return candidate;
}

function uniqueDirectoryPath(parentPath: string, folderName: string): string {
  const base = folderName || "新建文件夹";
  let candidate = resolve(parentPath, base);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = resolve(parentPath, `${base} ${index}`);
    index += 1;
  }
  return candidate;
}

function kernelIdForVaultPath(vaultPath: string): string {
  if (vaultPath === "Codex" || vaultPath.startsWith("Codex/")) return "codex";
  if (vaultPath === "Claude" || vaultPath.startsWith("Claude/")) return "claude-code";
  if (vaultPath === "Hermes" || vaultPath.startsWith("Hermes/")) return "hermes";
  return APP_PROTOCOL_ID;
}

function sourceIdForVaultPath(vaultPath: string): string {
  if (vaultPath.startsWith("Codex/skills/")) return "codex.user-skills";
  if (vaultPath.startsWith("Codex/memories/")) return "codex.user-memories";
  if (vaultPath.startsWith("Codex/")) return "codex.user-files";
  if (vaultPath.startsWith("Claude/commands/")) return "claude.user-commands";
  if (vaultPath.startsWith("Claude/skills/")) return "claude.user-skills";
  if (vaultPath.startsWith("Claude/agents/")) return "claude.user-agents";
  if (vaultPath.startsWith("Claude/memory/")) return "claude.user-agent-memory";
  if (vaultPath.startsWith("Claude/")) return "claude.user-files";
  if (vaultPath.startsWith("Hermes/skills/")) return "hermes.local-skills";
  if (vaultPath.startsWith("Hermes/memory/")) return "hermes.memories";
  if (vaultPath.startsWith("Hermes/")) return "hermes.local-files";
  return `${APP_PROTOCOL_ID}.vault`;
}

function safeIdSegment(value: string): string {
  return safePathSegment(value).replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
}

function shortHash(value: string): string {
  return createHash("sha1").update(resolve(value)).digest("hex").slice(0, 12);
}

function resolveNativeKnowledgeFilePath(document: KnowledgeDocument): string | undefined {
  const metadata = document.metadata ?? {};
  const candidates: string[] = [];
  const skillRoot = typeof metadata.skillRoot === "string" ? metadata.skillRoot : "";
  const skillFilePath = typeof metadata.skillFilePath === "string" ? metadata.skillFilePath : "";
  if (skillRoot && skillFilePath) {
    candidates.push(resolve(skillRoot, skillFilePath));
  }
  if (typeof metadata.entry === "string") {
    candidates.push(metadata.entry);
  }
  if (typeof metadata.sourceFilePath === "string") {
    candidates.push(metadata.sourceFilePath);
  }
  for (const ref of document.sourceRefs ?? []) {
    if (ref.locator) {
      candidates.push(ref.locator);
    }
  }

  for (const candidate of candidates) {
    const path = normalizeKnowledgeLocalPath(candidate);
    if (!path || !existsSync(path) || !isAllowedKnowledgeSourcePath(document, path)) continue;
    try {
      if (!statSync(path).isFile()) continue;
    } catch {
      continue;
    }
    return path;
  }

  return undefined;
}

function normalizeKnowledgeLocalPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    if (!trimmed.startsWith("file://")) return undefined;
    try {
      return fileURLToPath(trimmed);
    } catch {
      return undefined;
    }
  }
  return resolve(process.cwd(), trimmed);
}

function isAllowedKnowledgeSourcePath(document: KnowledgeDocument, filePath: string): boolean {
  const metadata = document.metadata ?? {};
  const roots = [
    process.cwd(),
    homedir(),
    typeof metadata.skillRoot === "string" ? metadata.skillRoot : "",
  ].filter(Boolean);
  return roots.some((root) => isPathInsideRoot(filePath, root));
}

export function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const root = resolve(rootPath);
  const file = resolve(filePath);
  const rel = relative(root, file);
  return rel === "" || Boolean(rel && !rel.startsWith("..") && !rel.startsWith("/"));
}

function ensureKnowledgeFileExists(document: KnowledgeDocument, descriptor: KnowledgeFileDescriptor): void {
  if (!existsSync(descriptor.path)) {
    if (descriptor.backing === "native") {
      throw new Error("knowledge_file_source_not_found");
    }
    ensureKnowledgeFileParent(document, descriptor.path);
    const seedContent = descriptor.originPath && existsSync(descriptor.originPath)
      ? readFileSync(descriptor.originPath, "utf8")
      : knowledgeDocumentToMarkdownFile(document);
    writeFileSync(descriptor.path, seedContent, "utf8");
  } else {
    repairStaleManagedKnowledgeFile(document, descriptor);
  }
  const stat = statSync(descriptor.path);
  if (!stat.isFile()) {
    throw new Error("knowledge_file_not_a_file");
  }
  if (stat.size > KNOWLEDGE_FILE_SIZE_LIMIT) {
    throw new Error("knowledge_file_too_large");
  }
}

function repairStaleManagedKnowledgeFile(document: KnowledgeDocument, descriptor: KnowledgeFileDescriptor): void {
  if (document.type !== "artifact_ref" || descriptor.format !== "markdown") return;
  const content = readFileSync(descriptor.path, "utf8");
  const trimmed = content.trim();
  const titleOnly = Boolean(document.title && trimmed === document.title.trim());
  const missingArtifactData = document.body.includes("Data:") && !trimmed.includes("Data:") && trimmed.length < 240;
  const missingArtifactImage = document.body.includes("![") && !trimmed.includes("![") && trimmed.length < 1_200;
  if (!titleOnly && !missingArtifactData && !missingArtifactImage) return;
  writeFileSync(descriptor.path, knowledgeDocumentToMarkdownFile(document), "utf8");
}

function ensureKnowledgeFileParent(document: KnowledgeDocument, filePath: string): void {
  const parent = dirname(filePath);
  const root = knowledgeVaultRoot();
  if (!isPathInsideRoot(filePath, root) && !isAllowedKnowledgeSourcePath(document, filePath)) {
    throw new Error("knowledge_file_path_not_allowed");
  }
  mkdirSync(parent, { recursive: true });
}

function readKnowledgeFileSnapshot(descriptor: KnowledgeFileDescriptor) {
  const stat = statSync(descriptor.path);
  if (stat.size > KNOWLEDGE_FILE_SIZE_LIMIT) {
    throw new Error("knowledge_file_too_large");
  }
  return {
    path: descriptor.path,
    uri: pathToFileURL(descriptor.path).href,
    vaultPath: descriptor.vaultPath,
    backing: descriptor.backing,
    originPath: descriptor.originPath,
    format: descriptor.format,
    size: stat.size,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    content: readFileSync(descriptor.path, "utf8"),
  };
}

function upsertKnowledgeFileSourceRef(
  refs: KnowledgeDocument["sourceRefs"],
  filePath: string,
  title: string,
): KnowledgeDocument["sourceRefs"] {
  const normalized = resolve(filePath);
  return [
    { title, locator: normalized },
    ...(refs ?? []).filter((ref) => {
      if (!ref.locator) return true;
      const refPath = normalizeKnowledgeLocalPath(ref.locator);
      return !refPath || resolve(refPath) !== normalized;
    }),
  ];
}

function knowledgeFileName(document: KnowledgeDocument): string {
  const base = safePathSegment(document.slug || document.title || document.id);
  const extension = document.format === "json" ? ".json" : ".md";
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

function safePathSegment(value: string): string {
  const sanitized = value
    .replace(/[<>:"\\|?*\x00-\x1f]/g, "-")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "")
    .slice(0, 120);
  return sanitized || "untitled";
}

function inferKnowledgeFileFormat(path: string): "markdown" | "json" | "plain" {
  const extension = extname(path).toLowerCase();
  if (extension === ".md" || extension === ".mdx" || extension === ".markdown") return "markdown";
  if (extension === ".json") return "json";
  return "plain";
}

function knowledgeDocumentToMarkdownFile(document: KnowledgeDocument): string {
  if (document.format === "markdown" && document.body.trimStart().startsWith("---\n")) {
    return document.body.endsWith("\n") ? document.body : `${document.body}\n`;
  }
  const tags = document.tags.length
    ? ["tags:", ...document.tags.map((tag) => `  - ${yamlScalar(tag)}`)]
    : ["tags: []"];
  const header = [
    "---",
    `title: ${yamlScalar(document.title || document.id)}`,
    `type: ${yamlScalar(document.type)}`,
    `status: ${yamlScalar(document.lifecycle)}`,
    ...tags,
    "---",
  ].join("\n");
  const body = document.body.trim();
  return `${header}\n\n${body}${body ? "\n" : ""}`;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function needsKnowledgeReviewForFile(document: KnowledgeDocument): boolean {
  if (document.lifecycle && document.lifecycle !== "active") return true;
  if (document.type === "source" && document.metadata?.organizerRole === "raw_evidence") return true;
  if (typeof document.confidence === "number" && document.confidence < 0.55) return true;
  return false;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

const PROTECTED_VAULT_ROOTS = new Set(["OpenGrove", "Codex", "Claude", "Hermes"]);
const IMPORTED_FOLDER_WATCH_DEBOUNCE_MS = 450;
const IMPORTED_FOLDER_FALLBACK_POLL_MS = 5_000;
const GLOBAL_KERNEL_KNOWLEDGE_SYNC_INTERVAL_MS = 30_000;

let lastGlobalKernelKnowledgeSyncAt = 0;
let lastGlobalKernelKnowledgeSyncKey = "";

interface ImportedFolderWatcher {
  watcher: FSWatcher;
  state: BridgeState;
  spec: KnowledgeWritableRootSpec;
  timer?: ReturnType<typeof setTimeout>;
  poller?: ReturnType<typeof setInterval>;
}

const importedFolderWatchers = new Map<string, ImportedFolderWatcher>();
const dirtyImportedFolderRoots = new Set<string>();

export function isProtectedVaultRoot(name: string): boolean {
  return PROTECTED_VAULT_ROOTS.has(name);
}

function syncImportedNativeFolders(state: BridgeState): void {
  const specs = importedNativeRootSpecs(state);
  ensureImportedNativeFolderWatchers(state, specs);
  let changed = false;
  for (const spec of specs) {
    const key = importedFolderWatcherKey(spec);
    if (importedFolderWatchers.get(key)?.timer) continue;
    if (!dirtyImportedFolderRoots.delete(key)) continue;
    if (!isReadableDirectory(spec.path)) continue;
    if (syncImportedNativeFolderRoot(state, spec.path, spec.vaultPath)) {
      changed = true;
    }
  }
  if (changed) {
    state.store.saveFrom(state.app);
  }
}

function importedNativeRootSpecs(state: BridgeState): KnowledgeWritableRootSpec[] {
  return knowledgeWritableRootSpecs(state).filter((spec) =>
    spec.backing === "native" &&
    Boolean(spec.originPath) &&
    !PROTECTED_VAULT_ROOTS.has(spec.vaultPath)
  );
}

function ensureImportedNativeFolderWatchers(state: BridgeState, specs: KnowledgeWritableRootSpec[]): void {
  const nextKeys = new Set<string>();
  for (const spec of specs) {
    if (!isReadableDirectory(spec.path)) continue;
    const key = importedFolderWatcherKey(spec);
    nextKeys.add(key);
    const existing = importedFolderWatchers.get(key);
    if (existing) {
      existing.state = state;
      existing.spec = spec;
      continue;
    }
    try {
      const watcher = watch(spec.path, { recursive: true }, () => {
        scheduleImportedFolderSync(key);
      });
      importedFolderWatchers.set(key, { watcher, state, spec });
      scheduleImportedFolderSync(key);
    } catch {
      try {
        const watcher = watch(spec.path, () => {
          scheduleImportedFolderSync(key);
        });
        const poller = setInterval(() => {
          scheduleImportedFolderSync(key);
        }, IMPORTED_FOLDER_FALLBACK_POLL_MS);
        poller.unref?.();
        importedFolderWatchers.set(key, { watcher, state, spec, poller });
        scheduleImportedFolderSync(key);
      } catch {
        dirtyImportedFolderRoots.add(key);
      }
    }
  }

  for (const [key, entry] of importedFolderWatchers) {
    if (nextKeys.has(key)) continue;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.poller) clearInterval(entry.poller);
    entry.watcher.close();
    importedFolderWatchers.delete(key);
    dirtyImportedFolderRoots.delete(key);
  }
}

function scheduleImportedFolderSync(key: string): void {
  dirtyImportedFolderRoots.add(key);
  const entry = importedFolderWatchers.get(key);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (!dirtyImportedFolderRoots.delete(key)) return;
    if (!isReadableDirectory(entry.spec.path)) return;
    if (syncImportedNativeFolderRoot(entry.state, entry.spec.path, entry.spec.vaultPath)) {
      entry.state.store.saveFrom(entry.state.app);
    }
  }, IMPORTED_FOLDER_WATCH_DEBOUNCE_MS);
}

function importedFolderWatcherKey(spec: KnowledgeWritableRootSpec): string {
  return `${spec.vaultPath}\0${resolve(spec.path)}`;
}

function isReadableDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function syncImportedNativeFolderRoot(state: BridgeState, rootPath: string, vaultRoot: string): boolean {
  const seenDocumentIds = new Set<string>();
  let changed = syncNativeFolderFiles(state, rootPath, vaultRoot, 0, seenDocumentIds);
  for (const document of state.app.knowledge.list({ limit: 5_000 })) {
    const metadata = document.metadata ?? {};
    if (metadata.createdBy !== "opengrove.import-folder" || metadata.importedFolderRoot) continue;
    const currentVaultPath = safeVaultPath(metadata.vaultPath);
    if (!currentVaultPath || !vaultPathContains(currentVaultPath, vaultRoot)) continue;
    if (seenDocumentIds.has(document.id)) continue;
    if (state.app.knowledge.delete(document.id)) {
      changed = true;
    }
  }
  return changed;
}

function syncNativeFolderFiles(
  state: BridgeState,
  dirPath: string,
  vaultPrefix: string,
  depth: number,
  seenDocumentIds: Set<string>,
): boolean {
  if (depth > 8) return false;
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return false;
  }
  let changed = false;
  for (const entry of entries) {
    if (entry.name.startsWith(".") || shouldIgnoreVaultDirectory(entry.name)) continue;
    const filePath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (syncNativeFolderFiles(state, filePath, `${vaultPrefix}/${safePathSegment(entry.name)}`, depth + 1, seenDocumentIds)) {
        changed = true;
      }
      continue;
    }
    if (!entry.isFile() || !isVisibleKnowledgeFileName(entry.name)) continue;
    const result = upsertImportedNativeFile(state, filePath, vaultPrefix);
    if (result.documentId) {
      seenDocumentIds.add(result.documentId);
    }
    changed = result.changed || changed;
  }
  return changed;
}

export function importLocalFolderToKnowledge(
  state: BridgeState,
  payload: KnowledgeFileSystemImportFolderPayload,
) {
  ensureKnowledgeVaultRoot();
  const folderPath = payload.folderPath;
  if (!folderPath || !existsSync(folderPath)) {
    throw new Error("import_folder_path_required");
  }
  const stat = statSync(folderPath);
  if (!stat.isDirectory()) {
    throw new Error("import_folder_not_a_directory");
  }
  const resolvedFolderPath = resolve(folderPath);
  const folderName = basename(resolvedFolderPath);
  const vaultRoot = uniqueImportedVaultRoot(state, resolvedFolderPath);

  // Always create a root marker document so the folder appears in the tree.
  // vaultPath is just the root name so resolveImportedRootPath can find it.
  const rootDocId = `native.import.root.${shortHash(resolvedFolderPath)}`;
  state.app.knowledge.upsert({
    id: rootDocId,
    slug: rootDocId.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase(),
    type: "source",
    title: folderName,
    body: "",
    format: "markdown",
    tags: ["imported", "folder-root"],
    sourceRefs: [{ title: folderName, locator: resolvedFolderPath }],
    scope: "user",
    lifecycle: "active",
    metadata: {
      vaultPath: `${vaultRoot}/.imported-root`,
      kernelId: APP_PROTOCOL_ID,
      sourceId: `${APP_PROTOCOL_ID}.vault`,
      sourceFilePath: resolvedFolderPath,
      sourceFileBacking: "native",
      sourceFileOriginPath: resolvedFolderPath,
      nativeGlobalKnowledge: true,
      createdBy: "opengrove.import-folder",
      importedFolderRoot: true,
    },
  });

  syncImportedNativeFolderRoot(state, resolvedFolderPath, vaultRoot);
  ensureImportedNativeFolderWatchers(state, [
    { vaultPath: vaultRoot, path: resolvedFolderPath, backing: "native", originPath: resolvedFolderPath },
  ]);

  return {
    knowledge: listKnowledgeInventoryDocuments(state),
    knowledgeFolders: listKnowledgeVaultFolders(state),
    knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
  };
}

function upsertImportedNativeFile(
  state: BridgeState,
  filePath: string,
  vaultPrefix: string,
): { changed: boolean; documentId?: string } {
  const docId = `native.import.${shortHash(filePath)}`;
  try {
    const fileStat = statSync(filePath);
    if (!fileStat.isFile() || fileStat.size > KNOWLEDGE_FILE_SIZE_LIMIT) {
      return { changed: false };
    }
    const existing = state.app.knowledge.get(docId);
    const metadata = existing?.metadata ?? {};
    const sameSnapshot =
      existing?.lifecycle === "active" &&
      Number(metadata.sourceFileMtimeMs) === fileStat.mtimeMs &&
      Number(metadata.sourceFileSize) === fileStat.size;
    if (sameSnapshot) {
      return { changed: false, documentId: docId };
    }
    const fileVaultPath = `${vaultPrefix}/${safePathSegment(basename(filePath))}`;
    const title = basename(filePath).replace(/\.(?:md|markdown|mdx|txt)$/i, "");
    const body = readFileSync(filePath, "utf8");
    state.app.knowledge.upsert({
      id: docId,
      slug: docId.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase(),
      type: "note",
      title,
      body,
      format: inferKnowledgeFileFormat(filePath),
      tags: ["imported"],
      sourceRefs: [{ title, locator: filePath }],
      scope: "user",
      lifecycle: "active",
      metadata: {
        vaultPath: fileVaultPath,
        kernelId: APP_PROTOCOL_ID,
        sourceId: `${APP_PROTOCOL_ID}.vault`,
        sourceFilePath: filePath,
        sourceFileBacking: "native",
        sourceFileOriginPath: filePath,
        sourceFileMtimeMs: fileStat.mtimeMs,
        sourceFileSize: fileStat.size,
        sourceFileSyncedAt: new Date().toISOString(),
        nativeGlobalKnowledge: true,
        createdBy: "opengrove.import-folder",
      },
    });
    return { changed: true, documentId: docId };
  } catch {
    return { changed: false };
  }
}

function uniqueImportedVaultRoot(state: BridgeState, folderPath: string): string {
  const existingRoot = importedRootForFolder(state, folderPath);
  if (existingRoot) return existingRoot;

  const base = safePathSegment(basename(folderPath));
  if (!isImportedVaultRootNameTaken(state, base, folderPath)) return base;

  const hash = shortHash(folderPath).slice(0, 6);
  let candidate = `${base}-${hash}`;
  let index = 2;
  while (isImportedVaultRootNameTaken(state, candidate, folderPath)) {
    candidate = `${base}-${hash}-${index}`;
    index += 1;
  }
  return candidate;
}

function importedRootForFolder(state: BridgeState, folderPath: string): string | undefined {
  const rootDoc = state.app.knowledge.get(`native.import.root.${shortHash(folderPath)}`);
  const vaultPath = safeVaultPath(rootDoc?.metadata?.vaultPath);
  return vaultPath?.split("/")[0];
}

function isImportedVaultRootNameTaken(state: BridgeState, rootName: string, folderPath: string): boolean {
  if (!rootName || PROTECTED_VAULT_ROOTS.has(rootName)) return true;
  if (existsSync(resolve(knowledgeVaultRoot(), rootName))) return true;
  const target = resolve(folderPath);
  for (const document of state.app.knowledge.list({ limit: 5_000 })) {
    const vaultPath = safeVaultPath(document.metadata?.vaultPath);
    if (vaultPath?.split("/")[0] !== rootName) continue;
    const originPath = typeof document.metadata?.sourceFileOriginPath === "string"
      ? resolve(document.metadata.sourceFileOriginPath)
      : "";
    if (originPath && (originPath === target || isPathInsideRoot(originPath, target))) {
      continue;
    }
    return true;
  }
  return false;
}
