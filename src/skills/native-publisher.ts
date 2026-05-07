import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonObject, SkillManifest } from "../core.js";
import { APP_CONFIG_DIR, APP_MANAGED_BY, APP_NATIVE_SKILL_MARKER_FILE } from "../identity.js";
import type { KernelAdapter, KernelCapabilities } from "../kernel/types.js";

export type NativeSkillKernelId = "codex" | "claude-code" | "hermes" | string;

export type NativeSkillPublicationStatus =
  | "published"
  | "already_current"
  | "skipped_existing"
  | "failed"
  | "unsupported_kernel";

export interface NativeSkillPublicationRecord {
  kernelId: NativeSkillKernelId;
  skillId: string;
  skillName: string;
  sourceRoot: string;
  targetRoot: string;
  targetSkillRoot: string;
  status: NativeSkillPublicationStatus;
  reason: string;
  publishedAt: string;
}

export type NativeSkillPublicationMap = Map<string, NativeSkillPublicationRecord[]>;

export interface NativeSkillPublisherOptions {
  cwd?: string;
  kernelId: string;
  kernelCapabilities?: KernelCapabilities;
  skills: SkillManifest[];
}

interface NativeSkillTarget {
  kernelId: string;
  root: string;
  reason: string;
}

export function publishNativeSkills(options: NativeSkillPublisherOptions): NativeSkillPublicationMap {
  const records = new Map<string, NativeSkillPublicationRecord[]>();
  const target = resolveNativeSkillTarget(options.kernelId, options.cwd ?? process.cwd());
  if (!target || !options.kernelCapabilities?.knowledge?.nativeSkills) {
    for (const skill of options.skills) {
      addPublication(records, skill.id, {
        kernelId: options.kernelId,
        skillId: skill.id,
        skillName: skill.name,
        sourceRoot: skill.skillRoot,
        targetRoot: target?.root ?? "",
        targetSkillRoot: target ? join(target.root, skill.name) : "",
        status: "unsupported_kernel",
        reason: target ? "kernel_does_not_declare_native_skills" : "native_skill_target_not_configured",
        publishedAt: new Date().toISOString(),
      });
    }
    return records;
  }

  mkdirSync(target.root, { recursive: true });
  for (const skill of options.skills) {
    addPublication(records, skill.id, publishNativeSkill(skill, target));
  }
  return records;
}

export function nativeSkillPublicationsToMetadata(
  records: NativeSkillPublicationRecord[] | undefined,
): JsonObject {
  const usableRecords = (records ?? []).filter((record) =>
    record.status === "published" || record.status === "already_current"
  );
  return {
    nativeSkillTargets: usableRecords.map((record) => ({
      kernelId: record.kernelId,
      targetRoot: record.targetRoot,
      targetSkillRoot: record.targetSkillRoot,
      status: record.status,
      reason: record.reason,
      publishedAt: record.publishedAt,
    })),
  };
}

export function shouldExposeSkillTool(kernel?: KernelAdapter): boolean {
  const knowledge = kernel?.capabilities.knowledge;
  if (!knowledge?.nativeSkills) {
    return true;
  }
  return knowledge.toolMediatedSkills === true;
}

function publishNativeSkill(
  skill: SkillManifest,
  target: NativeSkillTarget,
): NativeSkillPublicationRecord {
  const publishedAt = new Date().toISOString();
  const sourceRoot = resolve(skill.skillRoot);
  const targetSkillRoot = join(target.root, skill.name);
  const alreadyInTarget = sameOrInside(sourceRoot, targetSkillRoot);
  const alreadyNativeForKernel = isNativeSkillForKernel(sourceRoot, target.kernelId);

  if (alreadyInTarget || alreadyNativeForKernel) {
    return {
      kernelId: target.kernelId,
      skillId: skill.id,
      skillName: skill.name,
      sourceRoot,
      targetRoot: alreadyInTarget ? target.root : dirname(sourceRoot),
      targetSkillRoot: alreadyInTarget ? targetSkillRoot : sourceRoot,
      status: "already_current",
      reason: "skill_already_lives_in_kernel_native_directory",
      publishedAt,
    };
  }

  if (!isPortableAppSkill(sourceRoot)) {
    return {
      kernelId: target.kernelId,
      skillId: skill.id,
      skillName: skill.name,
      sourceRoot,
      targetRoot: target.root,
      targetSkillRoot,
      status: "skipped_existing",
      reason: `source_skill_is_not_${APP_MANAGED_BY}_portable_skill`,
      publishedAt,
    };
  }

  if (existsSync(targetSkillRoot) && !isAppManagedNativeSkill(targetSkillRoot)) {
    return {
      kernelId: target.kernelId,
      skillId: skill.id,
      skillName: skill.name,
      sourceRoot,
      targetRoot: target.root,
      targetSkillRoot,
      status: "skipped_existing",
      reason: `target_skill_exists_without_${APP_MANAGED_BY}_marker`,
      publishedAt,
    };
  }

  try {
    rmSync(targetSkillRoot, { recursive: true, force: true });
    mkdirSync(dirname(targetSkillRoot), { recursive: true });
    cpSync(sourceRoot, targetSkillRoot, {
      recursive: true,
      dereference: false,
      errorOnExist: false,
      force: true,
      filter(source) {
        return !source.endsWith(APP_NATIVE_SKILL_MARKER_FILE);
      },
    });
    writeFileSync(
      join(targetSkillRoot, APP_NATIVE_SKILL_MARKER_FILE),
      `${JSON.stringify({
        managedBy: APP_MANAGED_BY,
        kernelId: target.kernelId,
        sourceRoot,
        sourceEntry: skill.entry,
        skillId: skill.id,
        skillName: skill.name,
        targetReason: target.reason,
        publishedAt,
      }, null, 2)}\n`,
      "utf8",
    );
    return {
      kernelId: target.kernelId,
      skillId: skill.id,
      skillName: skill.name,
      sourceRoot,
      targetRoot: target.root,
      targetSkillRoot,
      status: "published",
      reason: target.reason,
      publishedAt,
    };
  } catch (error) {
    return {
      kernelId: target.kernelId,
      skillId: skill.id,
      skillName: skill.name,
      sourceRoot,
      targetRoot: target.root,
      targetSkillRoot,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      publishedAt,
    };
  }
}

function resolveNativeSkillTarget(kernelId: string, cwd: string): NativeSkillTarget | undefined {
  const projectRoot = resolve(cwd);
  if (kernelId === "codex") {
    return {
      kernelId,
      root: join(projectRoot, ".codex", "skills"),
      reason: "codex_project_skill_directory",
    };
  }
  if (kernelId === "claude-code") {
    return {
      kernelId,
      root: join(projectRoot, ".claude", "skills"),
      reason: "claude_code_project_skill_directory",
    };
  }
  if (kernelId === "hermes") {
    return {
      kernelId,
      root: join(projectRoot, APP_CONFIG_DIR, "native-skills", "hermes"),
      reason: "hermes_external_skill_directory_candidate",
    };
  }
  return undefined;
}

function isAppManagedNativeSkill(skillRoot: string): boolean {
  const markerPath = join(skillRoot, APP_NATIVE_SKILL_MARKER_FILE);
  if (!existsSync(markerPath)) {
    return false;
  }
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { managedBy?: unknown };
    return marker.managedBy === APP_MANAGED_BY;
  } catch {
    return false;
  }
}

function isPortableAppSkill(sourceRoot: string): boolean {
  const normalized = sourceRoot.split("\\").join("/");
  return (
    normalized.includes(`/${APP_CONFIG_DIR}/skills/`) ||
    normalized.endsWith(`/${APP_CONFIG_DIR}/skills`) ||
    normalized.includes("/src/skills/bundled/") ||
    normalized.includes("/src/packs/bundled/")
  );
}

function isNativeSkillForKernel(sourceRoot: string, kernelId: string): boolean {
  const normalized = sourceRoot.split("\\").join("/");
  if (kernelId === "codex") {
    return normalized.includes("/.codex/skills/");
  }
  if (kernelId === "claude-code") {
    return normalized.includes("/.claude/skills/");
  }
  if (kernelId === "hermes") {
    return normalized.includes("/.hermes/skills/");
  }
  return false;
}

function addPublication(
  records: NativeSkillPublicationMap,
  skillId: string,
  record: NativeSkillPublicationRecord,
): void {
  const key = skillId.replace(/^skill\./, "");
  const idKey = skillId;
  records.set(idKey, [...(records.get(idKey) ?? []), record]);
  records.set(`skill.${key}`, [...(records.get(`skill.${key}`) ?? []), record]);
}

function sameOrInside(left: string, right: string): boolean {
  const resolvedLeft = safeRealpath(left);
  const resolvedRight = safeRealpath(right);
  if (resolvedLeft === resolvedRight) {
    return true;
  }
  const relation = relative(resolvedRight, resolvedLeft);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function defaultHermesExternalSkillDir(cwd: string = process.cwd()): string {
  return join(resolve(cwd), APP_CONFIG_DIR, "native-skills", "hermes");
}

export function defaultHermesUserSkillDir(): string {
  return join(homedir(), ".hermes", "skills");
}
