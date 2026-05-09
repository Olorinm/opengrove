import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, extname, resolve } from "node:path";
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

export function resolveCommandPath(command: string | undefined): string | undefined {
  const trimmed = command?.trim();
  if (!trimmed) return undefined;
  if (isPathLike(trimmed)) {
    return resolveExistingCommandPath(trimmed);
  }
  return resolveCommandOnPath(trimmed);
}

export function resolveCommandInvocation(
  command: string,
  args: string[] = [],
): { command: string; args: string[] } {
  if (process.platform === "win32" && WINDOWS_SHELL_EXTENSIONS.has(extname(command).toLowerCase())) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}

export function commandVersion(command: string | undefined, args: string[] = ["--version"]): string | undefined {
  const resolvedCommand = resolveCommandPath(command) ?? command?.trim();
  if (!resolvedCommand) return undefined;
  const invocation = resolveCommandInvocation(resolvedCommand, args);
  const cacheKey = JSON.stringify([invocation.command, invocation.args]);
  if (COMMAND_VERSION_CACHE.has(cacheKey)) {
    return COMMAND_VERSION_CACHE.get(cacheKey);
  }
  try {
    const result = spawnSync(invocation.command, invocation.args, {
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

export function clearCommandVersionCache(): void {
  COMMAND_VERSION_CACHE.clear();
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

const WINDOWS_SHELL_EXTENSIONS = new Set([".cmd", ".bat"]);

function isPathLike(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function resolveExistingCommandPath(candidate: string): string | undefined {
  const resolvedCandidate = resolve(candidate);
  const extension = extname(resolvedCandidate);
  if (extension) {
    return existsSync(resolvedCandidate) ? resolvedCandidate : undefined;
  }
  if (process.platform === "win32") {
    for (const candidateWithExtension of candidateExtensions(resolvedCandidate)) {
      if (existsSync(candidateWithExtension)) {
        return candidateWithExtension;
      }
    }
  }
  return existsSync(resolvedCandidate) ? resolvedCandidate : undefined;
}

function resolveCommandOnPath(command: string): string | undefined {
  const pathEntries = process.env.PATH?.split(delimiter).filter(Boolean) ?? [];
  for (const entry of pathEntries) {
    const baseCandidate = resolve(entry, command);
    const extension = extname(baseCandidate);
    if (extension) {
      if (existsSync(baseCandidate)) {
        return baseCandidate;
      }
      continue;
    }
    if (process.platform === "win32") {
      for (const candidateWithExtension of candidateExtensions(baseCandidate)) {
        if (existsSync(candidateWithExtension)) {
          return candidateWithExtension;
        }
      }
    }
    if (existsSync(baseCandidate)) {
      return baseCandidate;
    }
  }
  return undefined;
}

function candidateExtensions(command: string): string[] {
  return windowsExecutableExtensions().map((extension) => `${command}${extension}`);
}

function windowsExecutableExtensions(): string[] {
  const configured = process.env.PATHEXT
    ?.split(";")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured?.length ? configured : [".com", ".exe", ".bat", ".cmd"];
}
