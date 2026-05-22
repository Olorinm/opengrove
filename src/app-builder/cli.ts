import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { findAppManifestPath, validateAppManifestFile, type OpenGroveAppManifest } from "./manifest.js";
import { importProjectAsApp, type ImportProjectOptions } from "./importer.js";

const USAGE = `OpenGrove App tools

Usage:
  opengrove app inspect <source>
  opengrove app import <source> [--target DIR | --apps-dir DIR] [--id ID] [--title TITLE] [--force]
  opengrove app stage <source> [--target DIR | --apps-dir DIR] [--id ID] [--copy] [--force]
  opengrove app validate <app-root>
  opengrove app report <app-root>
  opengrove app scaffold <target> [--id ID] [--title TITLE] [--description TEXT] [--ui-kind KIND] [--force]
  opengrove app mount <app-root> [--settings PATH] [--id ID] [--title TITLE] [--disabled]

Commands:
  inspect   Classify a local folder or URL before importing it as an App.
  import    Create a portable App package around a local project folder.
  stage     Put a source into an OpenGrove-managed App directory.
  validate  Validate opengrove.app.json and the basic workspace contract.
  report    Print a machine-readable import readiness report.
  scaffold  Create a minimal portable App package for an agent to continue.
  mount     Register an App root in bridge settings after validation.
`;

export async function runAppBuilderCli(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "help" || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE.trimEnd());
    return;
  }
  if (command === "inspect") {
    const source = args[1];
    if (!source) throw new Error("opengrove app inspect requires <source>");
    printJson(inspectAppSource(source));
    return;
  }
  if (command === "stage") {
    const source = args[1];
    if (!source) throw new Error("opengrove app stage requires <source>");
    const result = await stageAppSource(source, parseStageOptions(args.slice(2)));
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "import") {
    const source = args[1];
    if (!source) throw new Error("opengrove app import requires <source>");
    const imported = importProjectAsApp(source, parseImportOptions(args.slice(2)));
    printJson({
      ...imported,
      inspect: inspectAppSource(imported.appRoot),
      report: appImportReport(imported.appRoot),
      nextCommands: [
        `opengrove app report ${shellQuote(imported.appRoot)}`,
        `opengrove app mount ${shellQuote(imported.appRoot)}`,
      ],
    });
    return;
  }
  if (command === "validate") {
    const appRoot = args[1];
    if (!appRoot) throw new Error("opengrove app validate requires <app-root>");
    const result = validateAppRoot(resolvePathLike(appRoot));
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === "report") {
    const appRoot = args[1];
    if (!appRoot) throw new Error("opengrove app report requires <app-root>");
    const result = appImportReport(resolvePathLike(appRoot));
    printJson(result);
    if (!result.readyToMount) process.exitCode = 1;
    return;
  }
  if (command === "scaffold") {
    const target = args[1];
    if (!target) throw new Error("opengrove app scaffold requires <target>");
    printJson(scaffoldApp(resolvePathLike(target), parseScaffoldOptions(args.slice(2))));
    return;
  }
  if (command === "mount") {
    const appRoot = args[1];
    if (!appRoot) throw new Error("opengrove app mount requires <app-root>");
    const result = mountAppInSettings(resolvePathLike(appRoot), parseMountOptions(args.slice(2)));
    printJson(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown app command: ${command}`);
}

export function inspectAppSource(source: string): Record<string, unknown> {
  const kind = classifySourceInput(source);
  if (kind !== "local") {
    return {
      ok: true,
      source,
      sourceKind: kind,
      sourceType: kind === "git" ? "remote-git" : kind === "archive" ? "remote-archive" : "remote-project",
      uiStatus: "needs-staging",
      recommendedNextStep: "Download or clone into an OpenGrove-managed staging directory, then run inspect on that local directory.",
      boundaries: defaultBoundaries(),
    };
  }

  const root = resolvePathLike(source);
  if (!existsSync(root)) {
    return {
      ok: false,
      source,
      sourceKind: "local",
      root,
      sourceType: "missing",
      issues: ["source path does not exist"],
      boundaries: defaultBoundaries(),
    };
  }
  if (!statSync(root).isDirectory()) {
    return {
      ok: false,
      source,
      sourceKind: "local",
      root,
      sourceType: "file",
      issues: ["source path must be a directory"],
      boundaries: defaultBoundaries(),
    };
  }

  const manifestPath = findAppManifestPath(root);
  const manifestValidation = validateAppManifestFile(root);
  const packageJson = readPackageJson(root);
  const capabilities = discoverCapabilities(root, packageJson);
  const sourceType = classifyLocalSource(manifestPath, capabilities, packageJson);
  return {
    ok: true,
    source,
    sourceKind: "local",
    root,
    sourceType,
    title: manifestValidation.manifest?.title ?? packageJson?.name ?? basename(root),
    manifestPath,
    manifest: manifestValidation.ok ? "valid" : manifestPath ? "invalid" : "missing",
    manifestIssues: manifestValidation.issues,
    capabilities,
    uiStatus: decideUiStatus(sourceType, capabilities, manifestValidation.manifest),
    recommendedUiKind: recommendUiKind(sourceType, capabilities, manifestValidation.manifest),
    packageScripts: packageJson?.scripts ?? {},
    boundaries: defaultBoundaries(),
  };
}

export function validateAppRoot(appRoot: string): Record<string, unknown> {
  const validation = validateAppManifestFile(appRoot);
  const workspacePath = validation.manifest?.ui?.workspace || validation.manifest?.workspace?.path || "workspace";
  const workspaceRoot = resolve(appRoot, workspacePath);
  const cliIssues = validateCliFiles(appRoot, validation.manifest);
  const boundaryIssues = isInside(appRoot, workspaceRoot) ? [] : [`workspace escapes app root: ${workspacePath}`];
  const issues = [...validation.issues, ...boundaryIssues, ...cliIssues];
  return {
    ok: validation.ok && boundaryIssues.length === 0 && cliIssues.length === 0,
    appRoot,
    manifestPath: validation.manifestPath,
    manifest: validation.manifest,
    workspacePath,
    workspaceExists: existsSync(workspaceRoot),
    issues,
  };
}

export async function stageAppSource(source: string, options: StageOptions = {}): Promise<Record<string, unknown> & { ok: boolean }> {
  const sourceKind = classifySourceInput(source);
  const id = normalizeAppId(options.id || sourceId(source));
  const target = resolveStageTarget(id, options);
  const targetExisted = existsSync(target);
  if (targetExisted && readdirSync(target).length > 0 && !options.force) {
    return {
      ok: false,
      source,
      sourceKind,
      target,
      issues: ["target already exists and is not empty; pass --force or choose another target"],
    };
  }
  if (options.force) rmSync(target, { recursive: true, force: true });

  if (sourceKind === "local") {
    const localRoot = resolvePathLike(source);
    if (!existsSync(localRoot) || !statSync(localRoot).isDirectory()) {
      return {
        ok: false,
        source,
        sourceKind,
        target,
        issues: ["local source must be an existing directory"],
      };
    }
    if (!options.copy) {
      return {
        ok: true,
        source,
        sourceKind,
        action: "local-reference",
        stagedRoot: localRoot,
        copied: false,
        inspect: inspectAppSource(localRoot),
        report: appImportReport(localRoot),
        nextCommands: [
          `opengrove app report ${shellQuote(localRoot)}`,
          `opengrove app mount ${shellQuote(localRoot)}`,
        ],
      };
    }
    mkdirSync(dirname(target), { recursive: true });
    copyAppSource(localRoot, target);
    return stageSuccess(source, sourceKind, target, "copy");
  }

  if (sourceKind === "git") {
    mkdirSync(dirname(target), { recursive: true });
    const result = spawnSync("git", ["clone", "--depth", "1", source, target], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return {
        ok: false,
        source,
        sourceKind,
        target,
        issues: [`git clone failed: ${(result.stderr || result.stdout || "").trim()}`],
      };
    }
    return stageSuccess(source, sourceKind, target, "git-clone");
  }

  if (sourceKind === "archive") {
    mkdirSync(dirname(target), { recursive: true });
    const staged = await downloadAndExtractArchive(source, target);
    if (!staged.ok) {
      return staged;
    }
    return stageSuccess(source, sourceKind, staged.stagedRoot, "archive-extract");
  }

  return {
    ok: false,
    source,
    sourceKind,
    target,
    issues: ["ordinary project URLs need a git URL, archive URL, or local downloaded folder before staging"],
  };
}

export function appImportReport(appRoot: string): Record<string, unknown> & { readyToMount: boolean } {
  const inspect = inspectAppSource(appRoot);
  const validation = validateAppRoot(appRoot);
  const readyToMount = Boolean(inspect.ok && validation.ok);
  const manifest = validation.manifest as OpenGroveAppManifest | undefined;
  return {
    ok: readyToMount,
    readyToMount,
    appRoot,
    mountCandidate: readyToMount
      ? {
        id: manifest?.id || normalizeAppId(basename(appRoot)),
        title: manifest?.title || titleFromName(basename(appRoot)),
        path: appRoot,
        enabled: true,
      }
      : undefined,
    inspect,
    validation,
    nextSteps: readyToMount
      ? [
        `Register with: opengrove app mount ${shellQuote(appRoot)}`,
        "Open Settings -> Apps or the App rail to verify it appears.",
        "Run app-specific doctor/smoke commands before declaring production readiness.",
      ]
      : [
        "Fix manifest/workspace issues or run opengrove app scaffold in a target App directory.",
        `Re-run: opengrove app report ${shellQuote(appRoot)}`,
      ],
  };
}

export function scaffoldApp(target: string, options: ScaffoldOptions): Record<string, unknown> {
  const id = normalizeAppId(options.id || basename(target) || "opengrove-app");
  const title = options.title || titleFromName(id);
  const uiKind = options.uiKind || "file-workbench";
  if (existsSync(target) && readdirSync(target).length > 0 && !options.force) {
    throw new Error("target already exists and is not empty; pass --force to write into it");
  }
  mkdirSync(target, { recursive: true });
  mkdirSync(join(target, "workspace", "runs"), { recursive: true });
  mkdirSync(join(target, "skills", `${id}-operator`), { recursive: true });

  const manifest = {
    id,
    title,
    description: options.description || `${title} workbench for OpenGrove.`,
    version: "0.1.0",
    ui: {
      kind: uiKind,
      workspace: "workspace",
    },
    workspace: {
      path: "workspace",
    },
    skills: {
      roots: [`skills/${id}-operator`],
    },
    capabilities: {
      cli: [],
    },
    agent: {
      instructions: "Keep generated user-visible outputs inside workspace/runs. Add concrete CLI declarations only when real commands exist.",
    },
  };
  writeJsonIfAllowed(join(target, "opengrove.app.json"), manifest, options.force);
  writeTextIfAllowed(join(target, "workspace", "runs", ".gitkeep"), "", options.force);
  writeTextIfAllowed(join(target, "skills", `${id}-operator`, "SKILL.md"), operatorSkillText(id, title), options.force);
  return {
    ok: true,
    appRoot: target,
    manifestPath: join(target, "opengrove.app.json"),
    skillPath: join(target, "skills", `${id}-operator`, "SKILL.md"),
    workspacePath: join(target, "workspace"),
    nextSteps: [
      "Fill in real UI, CLI, tool, MCP, or hook capabilities based on the app workflow.",
      "Run opengrove app validate <app-root>.",
      "Run the app-specific doctor/smoke commands before registering the mounted App.",
    ],
  };
}

export function mountAppInSettings(appRoot: string, options: MountOptions = {}): Record<string, unknown> & { ok: boolean } {
  const report = appImportReport(appRoot);
  if (!report.readyToMount) {
    return {
      ok: false,
      appRoot,
      report,
      issues: ["app is not ready to mount; run opengrove app report for details"],
    };
  }
  const validation = validateAppManifestFile(appRoot);
  const id = normalizeAppId(options.id || validation.manifest?.id || basename(appRoot));
  const title = options.title || validation.manifest?.title || titleFromName(id);
  const settingsPath = resolvePathLike(options.settingsPath || join("data", "bridge-settings.json"));
  const settings = readJsonFile(settingsPath);
  const currentApps = Array.isArray(settings.mountedApps) ? settings.mountedApps : [];
  const entry = {
    id,
    path: appRoot,
    enabled: options.disabled ? false : true,
    title,
  };
  const nextApps = [
    ...currentApps.filter((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      return record.id !== id && resolvePathLike(String(record.path || "")) !== appRoot;
    }),
    entry,
  ];
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify({ ...settings, mountedApps: nextApps }, null, 2)}\n`, "utf8");
  return {
    ok: true,
    settingsPath,
    appRoot,
    entry,
    mountedAppsCount: nextApps.length,
  };
}

interface StageOptions {
  id?: string;
  target?: string;
  appsDir?: string;
  copy?: boolean;
  force?: boolean;
}

interface ScaffoldOptions {
  id?: string;
  title?: string;
  description?: string;
  uiKind?: "file-workbench" | "web-app" | "native" | "custom";
  force?: boolean;
}

interface MountOptions {
  settingsPath?: string;
  id?: string;
  title?: string;
  disabled?: boolean;
}

function parseStageOptions(args: string[]): StageOptions {
  const options: StageOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--id") {
      options.id = readRequiredValue(args, index, "--id");
      index += 1;
    } else if (arg.startsWith("--id=")) {
      options.id = arg.slice("--id=".length);
    } else if (arg === "--target") {
      options.target = readRequiredValue(args, index, "--target");
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else if (arg === "--apps-dir") {
      options.appsDir = readRequiredValue(args, index, "--apps-dir");
      index += 1;
    } else if (arg.startsWith("--apps-dir=")) {
      options.appsDir = arg.slice("--apps-dir=".length);
    } else if (arg === "--copy") {
      options.copy = true;
    } else if (arg === "--force") {
      options.force = true;
    } else {
      throw new Error(`Unknown stage option: ${arg}`);
    }
  }
  return options;
}

function parseImportOptions(args: string[]): ImportProjectOptions {
  const options: ImportProjectOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--id") {
      options.id = readRequiredValue(args, index, "--id");
      index += 1;
    } else if (arg.startsWith("--id=")) {
      options.id = arg.slice("--id=".length);
    } else if (arg === "--title") {
      options.title = readRequiredValue(args, index, "--title");
      index += 1;
    } else if (arg.startsWith("--title=")) {
      options.title = arg.slice("--title=".length);
    } else if (arg === "--description") {
      options.description = readRequiredValue(args, index, "--description");
      index += 1;
    } else if (arg.startsWith("--description=")) {
      options.description = arg.slice("--description=".length);
    } else if (arg === "--target") {
      options.target = readRequiredValue(args, index, "--target");
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else if (arg === "--apps-dir") {
      options.appsDir = readRequiredValue(args, index, "--apps-dir");
      index += 1;
    } else if (arg.startsWith("--apps-dir=")) {
      options.appsDir = arg.slice("--apps-dir=".length);
    } else if (arg === "--force") {
      options.force = true;
    } else {
      throw new Error(`Unknown import option: ${arg}`);
    }
  }
  return options;
}

function parseMountOptions(args: string[]): MountOptions {
  const options: MountOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--settings") {
      options.settingsPath = readRequiredValue(args, index, "--settings");
      index += 1;
    } else if (arg.startsWith("--settings=")) {
      options.settingsPath = arg.slice("--settings=".length);
    } else if (arg === "--id") {
      options.id = readRequiredValue(args, index, "--id");
      index += 1;
    } else if (arg.startsWith("--id=")) {
      options.id = arg.slice("--id=".length);
    } else if (arg === "--title") {
      options.title = readRequiredValue(args, index, "--title");
      index += 1;
    } else if (arg.startsWith("--title=")) {
      options.title = arg.slice("--title=".length);
    } else if (arg === "--disabled") {
      options.disabled = true;
    } else {
      throw new Error(`Unknown mount option: ${arg}`);
    }
  }
  return options;
}

function parseScaffoldOptions(args: string[]): ScaffoldOptions {
  const options: ScaffoldOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--id") {
      options.id = readRequiredValue(args, index, "--id");
      index += 1;
    } else if (arg.startsWith("--id=")) {
      options.id = arg.slice("--id=".length);
    } else if (arg === "--title") {
      options.title = readRequiredValue(args, index, "--title");
      index += 1;
    } else if (arg.startsWith("--title=")) {
      options.title = arg.slice("--title=".length);
    } else if (arg === "--description") {
      options.description = readRequiredValue(args, index, "--description");
      index += 1;
    } else if (arg.startsWith("--description=")) {
      options.description = arg.slice("--description=".length);
    } else if (arg === "--ui-kind") {
      options.uiKind = parseUiKind(readRequiredValue(args, index, "--ui-kind"));
      index += 1;
    } else if (arg.startsWith("--ui-kind=")) {
      options.uiKind = parseUiKind(arg.slice("--ui-kind=".length));
    } else if (arg === "--force") {
      options.force = true;
    } else {
      throw new Error(`Unknown scaffold option: ${arg}`);
    }
  }
  return options;
}

function classifySourceInput(source: string): "local" | "git" | "archive" | "project" {
  if (/^https?:\/\//i.test(source)) {
    if (/github\.com|gitlab\.com|bitbucket\.org|\.git(?:[#?].*)?$/i.test(source)) return "git";
    if (/\.(zip|tar|tgz|tar\.gz)(?:[#?].*)?$/i.test(source)) return "archive";
    return "project";
  }
  if (/^(git@|ssh:\/\/)/i.test(source) || /\.git$/i.test(source)) return "git";
  return "local";
}

function discoverCapabilities(root: string, packageJson: PackageJson | undefined): Record<string, unknown> {
  const entries = new Set(safeReadDir(root));
  const hasSrc = entries.has("src");
  const hasScripts = entries.has("scripts");
  const pythonEntryPoints = hasSrc ? pythonFileCount(join(root, "src")) : 0;
  return {
    manifest: Boolean(findAppManifestPath(root)),
    uiDirectory: entries.has("ui"),
    webProject: Boolean(packageJson || entries.has("index.html") || hasFilePrefix(root, "vite.config")),
    packageJson: Boolean(packageJson),
    packageBin: Boolean(packageJson?.bin),
    skills: entries.has("skills"),
    bin: entries.has("bin"),
    srcDirectory: hasSrc,
    tools: entries.has("tools"),
    mcp: entries.has("mcp.json"),
    hooks: entries.has("hooks.json"),
    workspace: entries.has("workspace"),
    scriptsDirectory: hasScripts,
    pythonProject: pythonEntryPoints > 0 || Boolean(entries.has("requirements.txt") && (hasSrc || hasScripts)),
    pythonEntryPoints,
    projectData: entries.has("projects"),
    existingReviewUi: entries.has("web"),
    docs: entries.has("docs") || entries.has("README.md"),
  };
}

function classifyLocalSource(
  manifestPath: string | undefined,
  capabilities: Record<string, unknown>,
  packageJson: PackageJson | undefined,
): string {
  if (manifestPath) return "opengrove-app";
  const hasWeb = Boolean(capabilities.webProject);
  const hasCli = Boolean(capabilities.bin || capabilities.packageBin);
  const hasWorkflowCode = Boolean(capabilities.srcDirectory || capabilities.scriptsDirectory || capabilities.pythonProject);
  const hasAppParts = Boolean(capabilities.skills || capabilities.tools || capabilities.mcp || capabilities.hooks || capabilities.workspace);
  if (hasWeb && hasCli) return "mixed-project";
  if (hasWeb) return "web-project";
  if (hasCli) return "cli-toolkit";
  if (hasWorkflowCode) return "workflow-project";
  if (hasAppParts) return "partial-opengrove-app";
  if (packageJson?.scripts && Object.keys(packageJson.scripts).length > 0) return "script-collection";
  if (capabilities.docs) return "knowledge-directory";
  return "directory";
}

function decideUiStatus(sourceType: string, capabilities: Record<string, unknown>, manifest: OpenGroveAppManifest | undefined): string {
  if (manifest?.ui?.kind === "web-app" || sourceType === "web-project" || sourceType === "mixed-project") return "existing-ui";
  if (
    manifest?.ui?.kind === "file-workbench"
    || capabilities.workspace
    || capabilities.bin
    || capabilities.scriptsDirectory
    || capabilities.srcDirectory
  ) return "file-workbench";
  return "needs-native-ui-design";
}

function recommendUiKind(sourceType: string, capabilities: Record<string, unknown>, manifest: OpenGroveAppManifest | undefined): string {
  if (manifest?.ui?.kind) return manifest.ui.kind;
  if (sourceType === "web-project" || sourceType === "mixed-project") return "web-app";
  if (capabilities.workspace || capabilities.bin || capabilities.scriptsDirectory || capabilities.srcDirectory) return "file-workbench";
  return "native";
}

function validateCliFiles(appRoot: string, manifest: OpenGroveAppManifest | undefined): string[] {
  const issues: string[] = [];
  for (const declaration of manifest?.capabilities?.cli ?? []) {
    const command = typeof declaration === "string"
      ? declaration
      : declaration.command || declaration.path || declaration.bin || "";
    if (!command || /^[a-z0-9._-]+$/i.test(command)) continue;
    const resolved = command.startsWith("/") ? command : resolve(appRoot, command);
    if (!existsSync(resolved)) issues.push(`cli command missing: ${command}`);
  }
  return issues;
}

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  bin?: unknown;
};

function readPackageJson(root: string): PackageJson | undefined {
  const path = join(root, "package.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function safeReadDir(root: string): string[] {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}

function hasFilePrefix(root: string, prefix: string): boolean {
  return safeReadDir(root).some((name) => name.startsWith(prefix));
}

function pythonFileCount(root: string): number {
  try {
    return safeReadDir(root).filter((name) => name.endsWith(".py")).length;
  } catch {
    return 0;
  }
}

function parseUiKind(value: string): ScaffoldOptions["uiKind"] {
  if (value === "file-workbench" || value === "web-app" || value === "native" || value === "custom") return value;
  throw new Error(`Invalid --ui-kind: ${value}`);
}

function resolveStageTarget(id: string, options: StageOptions): string {
  if (options.target) return resolvePathLike(options.target);
  const appsDir = options.appsDir ? resolvePathLike(options.appsDir) : resolve("data", "apps");
  return resolve(appsDir, id);
}

function sourceId(source: string): string {
  const withoutQuery = source.split(/[?#]/)[0] || source;
  const clean = withoutQuery.replace(/\/+$/, "");
  const base = basename(clean).replace(/\.git$/i, "").replace(/\.(zip|tar|tgz|gz)$/i, "");
  return base || "opengrove-app";
}

function stageSuccess(source: string, sourceKind: string, stagedRoot: string, action: string): Record<string, unknown> & { ok: true } {
  return {
    ok: true,
    source,
    sourceKind,
    action,
    stagedRoot,
    copied: action === "copy",
    inspect: inspectAppSource(stagedRoot),
    report: appImportReport(stagedRoot),
    nextCommands: [
      `opengrove app report ${shellQuote(stagedRoot)}`,
      `opengrove app mount ${shellQuote(stagedRoot)}`,
    ],
  };
}

function copyAppSource(sourceRoot: string, target: string): void {
  cpSync(sourceRoot, target, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      if (name === ".git" || name === "node_modules" || name === ".venv" || name === "__pycache__") return false;
      if (name === ".cache" || name === "cache" || name === ".DS_Store") return false;
      if (/^\.env(?:\.|$)/.test(name)) return false;
      return true;
    },
  });
}

async function downloadAndExtractArchive(source: string, target: string): Promise<Record<string, unknown> & { ok: false } | { ok: true; stagedRoot: string }> {
  const tempRoot = mkdtempSync(join(dirname(target), ".opengrove-archive-"));
  const archivePath = join(tempRoot, `source${archiveExtension(source)}`);
  try {
    const response = await fetch(source);
    if (!response.ok || !response.body) {
      return {
        ok: false,
        source,
        sourceKind: "archive",
        target,
        issues: [`download failed: ${response.status} ${response.statusText}`],
      };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    writeFileSync(archivePath, bytes);
    const unpackRoot = join(tempRoot, "unpacked");
    mkdirSync(unpackRoot, { recursive: true });
    const unpack = unpackArchive(archivePath, unpackRoot);
    if (!unpack.ok) {
      return {
        ok: false,
        source,
        sourceKind: "archive",
        target,
        issues: [unpack.error],
      };
    }
    const root = singleDirectoryRoot(unpackRoot) ?? unpackRoot;
    copyAppSource(root, target);
    return { ok: true, stagedRoot: target };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function archiveExtension(source: string): string {
  const lower = source.toLowerCase().split(/[?#]/)[0] || "";
  if (lower.endsWith(".tar.gz")) return ".tar.gz";
  if (lower.endsWith(".tgz")) return ".tgz";
  if (lower.endsWith(".tar")) return ".tar";
  if (lower.endsWith(".zip")) return ".zip";
  return extname(lower) || ".archive";
}

function unpackArchive(archivePath: string, target: string): { ok: true } | { ok: false; error: string } {
  const lower = archivePath.toLowerCase();
  const command = lower.endsWith(".zip")
    ? { bin: "unzip", args: ["-q", archivePath, "-d", target] }
    : { bin: "tar", args: ["-xf", archivePath, "-C", target] };
  const result = spawnSync(command.bin, command.args, { encoding: "utf8" });
  if (result.status === 0) return { ok: true };
  return {
    ok: false,
    error: `${command.bin} failed: ${(result.stderr || result.stdout || "").trim()}`,
  };
}

function singleDirectoryRoot(root: string): string | undefined {
  const entries = readdirSync(root).filter((name) => name !== "__MACOSX" && name !== ".DS_Store");
  if (entries.length !== 1) return undefined;
  const candidate = join(root, entries[0] ?? "");
  return statSync(candidate).isDirectory() ? candidate : undefined;
}

function readRequiredValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${name} requires a value`);
  return value;
}

function writeJsonIfAllowed(path: string, value: unknown, force: boolean | undefined): void {
  writeTextIfAllowed(path, `${JSON.stringify(value, null, 2)}\n`, force);
}

function writeTextIfAllowed(path: string, value: string, force: boolean | undefined): void {
  if (existsSync(path) && !force) throw new Error(`${path} already exists; pass --force to overwrite`);
  writeFileSync(path, value, "utf8");
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function operatorSkillText(id: string, title: string): string {
  return `---
name: ${id}-operator
description: Use when operating the ${title} OpenGrove App, including running its commands, reading workspace artifacts, and keeping outputs inside the App workspace.
---

# ${title} Operator

Use this skill for App-specific work after the App is mounted in OpenGrove.

## Workflow

1. Read opengrove.app.json first.
2. Keep generated outputs inside workspace/runs unless the manifest says otherwise.
3. Run declared doctor/smoke commands before claiming the App is ready.
4. Report missing API keys, model files, or system dependencies as configuration gaps.
`;
}

function defaultBoundaries(): string[] {
  return [
    "Write only inside the App root or its declared workspace.",
    "Stage URL imports into an OpenGrove-managed App directory before editing.",
    "Do not copy secrets, caches, or unrelated source folders into the App package.",
    "Document API keys, model files, and system dependencies as runtime configuration.",
  ];
}

function normalizeAppId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "opengrove-app";
}

function titleFromName(name: string): string {
  return name
    .split(/[-_:.\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function resolvePathLike(path: string): string {
  if (path === "~") return resolve(homedir());
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
