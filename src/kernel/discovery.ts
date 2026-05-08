import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  KernelInstallAction,
  KernelKnowledgeSource,
  KernelKnowledgeSourceKind,
  KernelKnowledgeSourceScope,
} from "./types.js";

const COMMAND_VERSION_CACHE = new Map<string, string | undefined>();

export interface KernelSourceInput {
  id: string;
  title: string;
  kind: KernelKnowledgeSourceKind;
  scope: KernelKnowledgeSourceScope;
  path?: string;
  native?: boolean;
  userVisible?: boolean;
  knowledgeLike?: boolean;
  enabledByDefault?: boolean;
  syncMode?: KernelKnowledgeSource["syncMode"];
  description?: string;
  notes?: string[];
}

export function directorySource(input: KernelSourceInput): KernelKnowledgeSource {
  return pathSource(input, "directory");
}

export function fileSource(input: KernelSourceInput): KernelKnowledgeSource {
  return pathSource(input, "file");
}

export function plannedInstallAction(input: KernelInstallAction): KernelInstallAction {
  return {
    status: "manual",
    requiresConfirmation: true,
    ...input,
  };
}

export function resolveHomePath(...parts: string[]): string {
  return resolve(homedir(), ...parts);
}

export function commandVersion(command: string | undefined, args: string[] = ["--version"]): string | undefined {
  if (!command) return undefined;
  const cacheKey = JSON.stringify([command, args]);
  if (COMMAND_VERSION_CACHE.has(cacheKey)) {
    return COMMAND_VERSION_CACHE.get(cacheKey);
  }
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 2_000,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    const version = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    COMMAND_VERSION_CACHE.set(cacheKey, version);
    return version;
  } catch {
    COMMAND_VERSION_CACHE.set(cacheKey, undefined);
    return undefined;
  }
}

function pathSource(input: KernelSourceInput, expected: "file" | "directory"): KernelKnowledgeSource {
  const path = input.path ? expandHome(input.path) : undefined;
  const exists = path ? existsSync(path) : false;
  const stats = exists && path ? safeStat(path) : undefined;
  const readable = Boolean(stats && (expected === "file" ? stats.isFile() : stats.isDirectory()));
  return {
    id: input.id,
    title: input.title,
    kind: input.kind,
    scope: input.scope,
    path,
    exists,
    readable,
    writable: Boolean(path && (stats?.isDirectory() || stats?.isFile() || existsSync(resolve(path, "..")))),
    native: input.native ?? true,
    userVisible: input.userVisible ?? true,
    knowledgeLike: input.knowledgeLike ?? true,
    enabledByDefault: input.enabledByDefault ?? true,
    syncMode: input.syncMode ?? "index",
    description: input.description,
    notes: input.notes,
  };
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}
