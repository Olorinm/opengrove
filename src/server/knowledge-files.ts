import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
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
  backing: "vault";
  format: "markdown" | "json" | "plain";
  originPath?: string;
}

export interface KnowledgeFilePatchPayload {
  content: string;
  title?: string;
  tags?: string[];
}

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
  if (!isPathInsideRoot(descriptor.path, knowledgeVaultRoot())) {
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
    path: resolve(knowledgeVaultRoot(), vaultPath),
    vaultPath,
    backing: "vault",
    format: inferKnowledgeFileFormat(originPath || vaultPath),
    originPath,
  };
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
  return "scripted";
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
  if (document.type === "skill") return `scripted.${APP_PROTOCOL_ID}-skills`;
  if (document.type === "artifact_ref") return `scripted.${APP_PROTOCOL_ID}-artifacts`;
  if (document.type === "memory") return `scripted.${APP_PROTOCOL_ID}-vault`;
  return `scripted.${APP_PROTOCOL_ID}-vault`;
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
  let entries;
  try {
    entries = readdirSync(input.dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(input.dir, entry.name, "SKILL.md");
    upsertNativeMarkdownFile(state, {
      id: `native.${input.kernelId}.skill.${safeIdSegment(entry.name)}`,
      kernelId: input.kernelId,
      sourceId: input.sourceId,
      title: entry.name,
      path: skillFile,
      vaultPath: `${input.vaultRoot}/${safePathSegment(entry.name)}/SKILL.md`,
      tags: input.tags,
      type: "skill",
      metadata: {
        skillName: entry.name,
        skillRoot: dirname(skillFile),
        entry: skillFile,
      },
    });
  }
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
    type: "skill" | "memory" | "project_doc" | "profile";
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

function safeIdSegment(value: string): string {
  return safePathSegment(value).replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
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
