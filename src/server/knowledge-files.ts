import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { KNOWLEDGE_FILE_SIZE_LIMIT } from "./bridge-types.js";
import type { KnowledgeDocument } from "../knowledge/types.js";

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
  syncGlobalKernelKnowledgeDocuments(state);
  for (const document of filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 }))) {
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
    folders.set(safePath, {
      path: safePath,
      backing: folder.backing,
      originPath: folder.originPath,
    });
  };

  for (const root of knowledgeWritableRootSpecs()) {
    scanKnowledgeFolderRoot(root, addFolder);
  }

  for (const document of filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 }))) {
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
  const parentPath = safeVaultPath(payload.parentPath) || APP_VAULT_ROOT_NAME;
  const target = resolveKnowledgeDirectoryTarget(parentPath);
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
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 })),
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
    knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 })),
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

  const source = resolveKnowledgeDirectoryTarget(sourcePath);
  const target = resolveKnowledgeDirectoryTarget(targetParentPath);
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
      knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 })),
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
    knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 })),
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
  const source = resolveKnowledgeDirectoryTarget(sourcePath);
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
    knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 })),
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
  if (sourcePath.split("/").length < 2) {
    throw new Error("knowledge_file_root_delete_not_allowed");
  }
  const source = resolveKnowledgeDirectoryTarget(sourcePath);
  if (!existsSync(source.path)) {
    throw new Error("knowledge_file_source_not_found");
  }
  const sourceStat = statSync(source.path);
  rmSync(source.path, { recursive: sourceStat.isDirectory(), force: true });
  const deletedKnowledgeIds = deleteKnowledgeDocumentsUnderVaultPath(state, sourcePath);
  return {
    entry: {
      kind: sourceStat.isDirectory() ? "folder" : "note",
      path: sourcePath,
      backing: source.backing,
      originPath: source.backing === "native" ? source.path : undefined,
    },
    deletedKnowledgeIds,
    knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 2_000 })),
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
  const originPath = resolveNativeKnowledgeFilePath(document);
  return {
    path: originPath ?? resolve(knowledgeVaultRoot(), vaultPath),
    vaultPath,
    backing: originPath ? "native" : "vault",
    format: inferKnowledgeFileFormat(originPath || vaultPath),
    originPath,
  };
}

export function resolveKnowledgeVaultFilePath(vaultPath: string): string | undefined {
  const safePath = safeVaultPath(vaultPath);
  if (!safePath) return undefined;
  const specs = knowledgeWritableRootSpecs()
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

function knowledgeWritableRootSpecs(): KnowledgeWritableRootSpec[] {
  const home = homedir();
  const root = knowledgeVaultRoot();
  return [
    { vaultPath: APP_VAULT_ROOT_NAME, path: resolve(root, APP_VAULT_ROOT_NAME), backing: "vault" },
    { vaultPath: "Codex", path: join(home, ".codex"), backing: "native", originPath: join(home, ".codex") },
    { vaultPath: "Codex/skills", path: join(home, ".codex", "skills"), backing: "native", originPath: join(home, ".codex", "skills") },
    { vaultPath: "Codex/skills", path: join(home, ".agents", "skills"), backing: "native", originPath: join(home, ".agents", "skills") },
    { vaultPath: "Codex/memories", path: join(home, ".codex", "memories"), backing: "native", originPath: join(home, ".codex", "memories") },
    { vaultPath: "Claude", path: join(home, ".claude"), backing: "native", originPath: join(home, ".claude") },
    { vaultPath: "Claude/skills", path: join(home, ".claude", "skills"), backing: "native", originPath: join(home, ".claude", "skills") },
    { vaultPath: "Claude/commands", path: join(home, ".claude", "commands"), backing: "native", originPath: join(home, ".claude", "commands") },
    { vaultPath: "Claude/agents", path: join(home, ".claude", "agents"), backing: "native", originPath: join(home, ".claude", "agents") },
    { vaultPath: "Claude/memory", path: join(home, ".claude", "agent-memory"), backing: "native", originPath: join(home, ".claude", "agent-memory") },
    { vaultPath: "Hermes", path: join(home, ".hermes"), backing: "native", originPath: join(home, ".hermes") },
    { vaultPath: "Hermes/skills", path: join(home, ".hermes", "skills"), backing: "native", originPath: join(home, ".hermes", "skills") },
    { vaultPath: "Hermes/memory", path: join(home, ".hermes", "memories"), backing: "native", originPath: join(home, ".hermes", "memories") },
  ];
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
  upsertNativeMarkdownFile(state, {
    id: "native.codex.agents-md",
    kernelId: "codex",
    sourceId: "codex.user-agents-md",
    title: "AGENTS.md",
    path: join(home, ".codex", "AGENTS.md"),
    vaultPath: "Codex/AGENTS.md",
    tags: ["codex", "instructions"],
    type: "project_doc",
  });
  upsertSkillDirectory(state, {
    kernelId: "codex",
    sourceId: "codex.user-skills",
    dir: join(home, ".codex", "skills"),
    vaultRoot: "Codex/skills",
    tags: ["codex", "skill"],
  });
  upsertNativeKnowledgeDirectory(state, {
    kernelId: "codex",
    sourceId: "codex.user-memories",
    dir: join(home, ".codex", "memories"),
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
    path: join(home, ".claude", "CLAUDE.md"),
    vaultPath: "Claude/CLAUDE.md",
    tags: ["claude", "instructions"],
    type: "project_doc",
  });
  upsertSkillDirectory(state, {
    kernelId: "claude-code",
    sourceId: "claude.user-skills",
    dir: join(home, ".claude", "skills"),
    vaultRoot: "Claude/skills",
    tags: ["claude", "skill"],
  });
  upsertSkillDirectory(state, {
    kernelId: "claude-code",
    sourceId: "claude.user-commands",
    dir: join(home, ".claude", "commands"),
    vaultRoot: "Claude/commands",
    tags: ["claude", "command"],
  });
  upsertClaudeAgents(state, join(home, ".claude", "agents"));
  upsertClaudeAgentMemory(state, join(home, ".claude", "agent-memory"));

  upsertNativeMarkdownFile(state, {
    id: "native.hermes.soul-md",
    kernelId: "hermes",
    sourceId: "hermes.soul",
    title: "SOUL.md",
    path: join(home, ".hermes", "SOUL.md"),
    vaultPath: "Hermes/SOUL.md",
    tags: ["hermes", "identity"],
    type: "profile",
  });
  upsertSkillDirectory(state, {
    kernelId: "hermes",
    sourceId: "hermes.local-skills",
    dir: join(home, ".hermes", "skills"),
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
    path: join(home, ".hermes", "memories", "MEMORY.md"),
    vaultPath: "Hermes/memory/MEMORY.md",
    tags: ["hermes", "memory"],
    type: "memory",
  });
  upsertNativeMarkdownFile(state, {
    id: "native.hermes.user-md",
    kernelId: "hermes",
    sourceId: "hermes.memories",
    title: "USER.md",
    path: join(home, ".hermes", "memories", "USER.md"),
    vaultPath: "Hermes/memory/USER.md",
    tags: ["hermes", "memory", "user"],
    type: "memory",
  });
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

function resolveKnowledgeDirectoryTarget(parentPath: string): KnowledgeDirectoryTarget {
  const safeParent = safeVaultPath(parentPath) || APP_VAULT_ROOT_NAME;
  const specs = knowledgeWritableRootSpecs()
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
