import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";

const cliDeclarationSchema = z.union([
  z.string().min(1),
  z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    command: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    bin: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    doctor: z.union([z.string(), z.array(z.string())]).optional(),
    smoke: z.union([z.string(), z.array(z.string())]).optional(),
    env: z.array(z.string()).optional(),
    envKeys: z.array(z.string()).optional(),
    artifacts: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    allowNativeBash: z.boolean().optional(),
  }).passthrough(),
]);

const providerEnvSchema = z.object({
  providerId: z.string().min(1),
  env: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  required: z.boolean().optional(),
}).passthrough();

export const opengroveAppManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9._:-]*$/i, "id must be URL-safe"),
  name: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  version: z.string().min(1).optional(),
  ui: z.object({
    kind: z.enum(["file-workbench", "web-app", "native", "custom"]).optional(),
    entry: z.string().optional(),
    workspace: z.string().optional(),
    devCommand: z.union([z.string(), z.array(z.string())]).optional(),
  }).passthrough().optional(),
  workspace: z.object({
    path: z.string().min(1).optional(),
  }).passthrough().optional(),
  skills: z.object({
    roots: z.array(z.string()).optional(),
  }).passthrough().optional(),
  capabilities: z.object({
    cli: z.array(cliDeclarationSchema).optional(),
    skillRoots: z.array(z.string()).optional(),
  }).passthrough().optional(),
  runtimeEnv: z.object({
    providerKeys: z.array(providerEnvSchema).optional(),
  }).passthrough().optional(),
  agent: z.object({
    instructions: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export type OpenGroveAppManifest = z.infer<typeof opengroveAppManifestSchema>;

export interface AppManifestValidationResult {
  ok: boolean;
  issues: string[];
  manifest?: OpenGroveAppManifest;
}

export function findAppManifestPath(appRoot: string): string | undefined {
  for (const candidate of ["opengrove.app.json", "opengrove.app.jsonc"]) {
    const manifestPath = join(appRoot, candidate);
    if (existsSync(manifestPath)) return manifestPath;
  }
  return undefined;
}

export function validateAppManifestFile(appRoot: string): AppManifestValidationResult & { manifestPath?: string } {
  const manifestPath = findAppManifestPath(appRoot);
  if (!manifestPath) {
    return {
      ok: false,
      issues: ["missing opengrove.app.json"],
    };
  }
  return {
    manifestPath,
    ...validateAppManifestText(readFileSync(manifestPath, "utf8")),
  };
}

export function validateAppManifestText(text: string): AppManifestValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonLikeComments(text));
  } catch (error) {
    return {
      ok: false,
      issues: [`invalid json: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return validateAppManifest(parsed);
}

export function validateAppManifest(value: unknown): AppManifestValidationResult {
  const result = opengroveAppManifestSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`),
    };
  }
  const semanticIssues = semanticManifestIssues(result.data);
  return {
    ok: semanticIssues.length === 0,
    issues: semanticIssues,
    manifest: result.data,
  };
}

function semanticManifestIssues(manifest: OpenGroveAppManifest): string[] {
  const issues: string[] = [];
  const uiKind = manifest.ui?.kind;
  const workspacePath = manifest.ui?.workspace || manifest.workspace?.path;
  if (uiKind === "file-workbench" && !workspacePath) {
    issues.push("ui.kind=file-workbench requires ui.workspace or workspace.path");
  }
  for (const declaration of manifest.capabilities?.cli ?? []) {
    if (typeof declaration === "string") continue;
    if (!declaration.command && !declaration.path && !declaration.bin) {
      issues.push(`capabilities.cli.${declaration.id ?? declaration.name ?? "item"} requires command/path/bin`);
    }
  }
  return issues;
}

function stripJsonLikeComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, "$1");
}
