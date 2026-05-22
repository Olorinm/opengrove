import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { delimiter } from "node:path";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { JsonObject, ToolSpec } from "../core.js";
import { APP_MANAGED_BY, APP_NATIVE_SKILL_MARKER_FILE } from "../identity.js";
import type { BridgeKernelId, BridgeState } from "../server/bridge-types.js";
import { collectKernelExtensionLayouts } from "./kernel-roots.js";
import type { ExtensionRootDescriptor } from "./kernel-roots.js";
import { loadExtensionManagerState } from "./state.js";
import type {
  ExtensionCommandUsage,
  ExtensionDeployment,
  ExtensionInventory,
  ExtensionInventorySummary,
  ExtensionKind,
  ExtensionPermission,
  ExtensionSourceOrigin,
  ManagedExtensionRecord,
} from "./types.js";

export interface ScanExtensionInventoryOptions {
  includeSystem?: boolean;
}

interface ParsedSkill {
  name: string;
  title: string;
  description: string;
  tags: string[];
  allowedTools: string[];
  shell: string[];
  paths: string[];
  frontmatter: Record<string, unknown>;
}

interface McpServerEntry {
  name: string;
  command?: string;
  args: string[];
  envKeys: string[];
  url?: string;
  entry: JsonObject;
}

interface HookEntry {
  name: string;
  event?: string;
  matcher?: string;
  command?: string;
  args: string[];
  envKeys: string[];
  entry: JsonObject;
}

interface PluginEntry {
  name: string;
  title: string;
  description: string;
  manifestPath: string;
  pluginRoot: string;
  enabled: boolean;
  sourceOrigin: ExtensionSourceOrigin;
  metadata: JsonObject;
}

interface MountedAppEntry {
  name: string;
  title: string;
  description: string;
  appRoot: string;
  manifestPath?: string;
  enabled: boolean;
  status: ExtensionDeployment["status"];
  capabilities: string[];
  cli: MountedAppCliDeclaration[];
  metadata: JsonObject;
}

interface MountedAppCliDeclaration {
  id: string;
  title: string;
  description: string;
  command: string;
  args: string[];
  envKeys: string[];
  doctor: string[];
  smoke: string[];
  cwd?: string;
  artifacts: string[];
  allowNativeBash: boolean;
  resolvedPath?: string;
  metadata: JsonObject;
}

interface InventoryAccumulator {
  items: Map<string, ManagedExtensionRecord>;
  deployments: ExtensionDeployment[];
  commandUsages: ExtensionCommandUsage[];
}

export function scanExtensionInventory(
  state: BridgeState,
  options: ScanExtensionInventoryOptions = {},
): ExtensionInventory {
  const includeSystem = options.includeSystem === true;
  const managerState = loadExtensionManagerState(state);
  const layouts = collectKernelExtensionLayouts(state);
  const workspaceRoot = layouts[0]?.workspaceRoot ?? state.settings.workspaceRoot ?? process.cwd();
  const accumulator: InventoryAccumulator = {
    items: new Map(),
    deployments: [],
    commandUsages: [],
  };

  for (const layout of layouts) {
    for (const root of layout.roots) {
      if (root.system && !includeSystem) {
        continue;
      }
      if (root.kind === "skill") {
        scanSkillRoot(accumulator, root);
      } else if (root.kind === "mcp") {
        scanMcpConfig(accumulator, root);
      } else if (root.kind === "hook") {
        scanHookConfig(accumulator, root);
      } else if (root.kind === "plugin") {
        scanPluginRoot(accumulator, root);
      }
    }

  }

  scanMountedApps(accumulator, state);

  try {
    for (const tool of state.app.tools.specs()) {
      addTool(accumulator, tool, workspaceRoot);
    }
  } catch {
    // Inventory scanning should keep working in tests and partial bridge states.
  }

  for (const librarySkill of Object.values(managerState.skillLibrary)) {
    const libraryEntry = existsSync(join(librarySkill.sourceRoot, "SKILL.md"))
      ? join(librarySkill.sourceRoot, "SKILL.md")
      : join(librarySkill.sourceRoot, "SKILL.md.disabled");
    const parsed = parseSkillFile(libraryEntry, librarySkill.name);
    const sourceDigest = skillDirectoryDigest(librarySkill.sourceRoot);
    const deployment: ExtensionDeployment = {
      id: deploymentId("skill", undefined, librarySkill.sourceRoot, librarySkill.name),
      itemId: itemId("skill", librarySkill.name),
      kind: "skill",
      scope: "managed",
      status: existsSync(join(librarySkill.sourceRoot, "SKILL.md")) ? "unpublished" : "missing",
      enabled: existsSync(join(librarySkill.sourceRoot, "SKILL.md")),
      managedByOpenGrove: true,
      readonly: false,
      system: false,
      sourcePath: librarySkill.sourceRoot,
      targetPath: librarySkill.sourceRoot,
      metadata: {
        libraryId: librarySkill.id,
        createdAt: librarySkill.createdAt,
        updatedAt: librarySkill.updatedAt,
        ...(sourceDigest ? { sourceDigest } : {}),
      },
    };
    addItemDeployment(accumulator, {
      id: deployment.itemId,
      kind: "skill",
      name: librarySkill.name,
      title: parsed.title || librarySkill.title,
      description: parsed.description || librarySkill.description,
      enabled: deployment.enabled,
      managedByOpenGrove: true,
      readonly: false,
      system: false,
      source: {
        origin: librarySkill.origin?.origin ?? "opengrove",
        kernelId: librarySkill.origin?.kernelId,
        path: librarySkill.sourceRoot,
        readonly: false,
        system: false,
      },
      deployments: [],
      permissions: skillPermissions(parsed),
      commandUsages: skillCommandUsages(parsed, deployment.id),
      childIds: [],
      tags: parsed.tags,
      metadata: deployment.metadata ?? {},
    }, deployment);
    accumulator.commandUsages.push(...skillCommandUsages(parsed, deployment.id));
  }

  for (const disabledConfig of Object.values(managerState.disabledConfigs)) {
    const item = disabledConfig.kind === "mcp"
      ? mcpItemFromEntry({
          name: disabledConfig.name,
          args: arrayOfStrings(disabledConfig.entry.args),
          command: stringValue(disabledConfig.entry.command),
          envKeys: Object.keys(record(disabledConfig.entry.env)),
          url: stringValue(disabledConfig.entry.url),
          entry: disabledConfig.entry,
        }, disabledConfig.configPath, disabledConfig.kernelId)
      : hookItemFromEntry({
          name: disabledConfig.name,
          command: stringValue(disabledConfig.entry.command),
          args: arrayOfStrings(disabledConfig.entry.args),
          envKeys: Object.keys(record(disabledConfig.entry.env)),
          entry: disabledConfig.entry,
        }, disabledConfig.configPath, disabledConfig.kernelId);
    const deployment: ExtensionDeployment = {
      id: disabledConfig.id,
      itemId: item.id,
      kind: disabledConfig.kind,
      kernelId: disabledConfig.kernelId,
      scope: "user",
      status: "disabled",
      enabled: false,
      managedByOpenGrove: true,
      readonly: false,
      system: false,
      configPath: disabledConfig.configPath,
      configFormat: disabledConfig.configFormat,
      metadata: {
        disabledAt: disabledConfig.disabledAt,
        redacted: disabledConfig.redacted,
      },
    };
    addItemDeployment(accumulator, item, deployment);
  }

  for (const [deploymentIndex, deployment] of accumulator.deployments.entries()) {
    if (managerState.disabledOverlays[deployment.id]) {
      accumulator.deployments[deploymentIndex] = {
        ...deployment,
        enabled: false,
        status: "disabled",
        metadata: {
          ...(deployment.metadata ?? {}),
          disabledOverlay: managerState.disabledOverlays[deployment.id] as unknown as JsonObject,
        },
      };
    }
  }

  for (const item of accumulator.items.values()) {
    item.deployments = accumulator.deployments.filter((deployment) => deployment.itemId === item.id);
    item.enabled = item.deployments.some((deployment) => deployment.enabled);
    item.managedByOpenGrove = item.deployments.some((deployment) => deployment.managedByOpenGrove) || item.managedByOpenGrove;
    item.readonly = item.deployments.length > 0 && item.deployments.every((deployment) => deployment.readonly);
    item.system = item.deployments.some((deployment) => deployment.system) || item.system;
    const outdatedDeployments = item.deployments.filter((deployment) =>
      deployment.kind === "skill" &&
      deployment.enabled &&
      deployment.managedByOpenGrove &&
      deployment.metadata?.outOfDate === true
    );
    if (outdatedDeployments.length) {
      item.metadata = {
        ...(item.metadata ?? {}),
        outOfDate: true,
        outdatedDeploymentCount: outdatedDeployments.length,
        outdatedKernelIds: uniqueStrings(outdatedDeployments.map((deployment) => deployment.kernelId ?? "").filter(Boolean)),
      };
    }
  }

  const items = Array.from(accumulator.items.values()).sort(compareItems);
  const deployments = accumulator.deployments.sort(compareDeployments);
  return {
    scannedAt: new Date().toISOString(),
    workspaceRoot,
    items,
    deployments,
    commandUsages: accumulator.commandUsages.sort((left, right) => left.command.localeCompare(right.command)),
    summary: summarizeInventory(items, deployments),
  };
}

export function parseJsonLikeConfig(path: string, format: string | undefined): JsonObject | undefined {
  try {
    const text = readFileSync(path, "utf8");
    if (format === "toml") {
      return parseSimpleToml(text);
    }
    return record(JSON.parse(stripJsonTrailingCommas(stripJsonComments(text)))) as JsonObject;
  } catch {
    return undefined;
  }
}

export function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        output += text[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function stripJsonTrailingCommas(text: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === ",") {
      let cursor = index + 1;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
      if (text[cursor] === "}" || text[cursor] === "]") {
        continue;
      }
    }
    output += char;
  }
  return output;
}

export function extractMcpServers(config: JsonObject): McpServerEntry[] {
  const containers: Record<string, unknown>[] = [];
  for (const key of ["mcpServers", "mcp_servers", "servers"]) {
    const value = record(config[key]);
    if (Object.keys(value).length) containers.push(value);
  }
  const mcp = record(config.mcp);
  for (const key of ["servers", "mcpServers", "mcp_servers"]) {
    const value = record(mcp[key]);
    if (Object.keys(value).length) containers.push(value);
  }

  const entries: McpServerEntry[] = [];
  for (const container of containers) {
    for (const [name, raw] of Object.entries(container)) {
      const item = record(raw);
      entries.push({
        name,
        command: stringValue(item.command),
        args: arrayOfStrings(item.args),
        envKeys: Object.keys(record(item.env)),
        url: stringValue(item.url) ?? stringValue(item.endpoint),
        entry: item as JsonObject,
      });
    }
  }
  return uniqueBy(entries, (entry) => entry.name);
}

export function extractHookEntries(config: JsonObject): HookEntry[] {
  const hooks = record(config.hooks);
  if (Object.keys(hooks).length) {
    return extractClaudeStyleHooks(hooks);
  }
  return extractGenericHookCommands(config);
}

function scanSkillRoot(accumulator: InventoryAccumulator, root: ExtensionRootDescriptor): void {
  if (!existsSync(root.path)) return;
  const skillRoots = discoverSkillDirectories(root.path, root.recursive === true, root.maxDepth ?? 2);
  for (const skillRoot of skillRoots) {
    const enabledEntry = join(skillRoot, "SKILL.md");
    const disabledEntry = join(skillRoot, "SKILL.md.disabled");
    const entry = existsSync(enabledEntry) ? enabledEntry : disabledEntry;
    const status = existsSync(enabledEntry) ? "enabled" : "disabled";
    const parsed = parseSkillFile(entry, basename(skillRoot));
    const marker = readManagedMarker(skillRoot);
    const managedByOpenGrove = marker?.managedBy === APP_MANAGED_BY;
    const system = root.system || skillRoot.includes(`${pathSep()}skills${pathSep()}.system${pathSep()}`);
    const sourceDigest = marker?.sourceRoot ? skillDirectoryDigest(marker.sourceRoot) : undefined;
    const targetDigest = marker?.sourceRoot ? skillDirectoryDigest(skillRoot) : undefined;
    const outOfDate = Boolean(sourceDigest && targetDigest && sourceDigest !== targetDigest);
    const deployment: ExtensionDeployment = {
      id: deploymentId("skill", root.kernelId, skillRoot, parsed.name),
      itemId: itemId("skill", parsed.name),
      kind: "skill",
      kernelId: root.kernelId,
      scope: root.scope,
      status,
      enabled: status === "enabled",
      managedByOpenGrove,
      readonly: root.readonly || system,
      system,
      sourcePath: skillRoot,
      targetPath: skillRoot,
      markerPath: marker ? join(skillRoot, APP_NATIVE_SKILL_MARKER_FILE) : undefined,
      metadata: {
        root: root.path,
        reason: root.reason,
        skillFile: entry,
        sourceOrigin: marker?.sourceRoot ? "opengrove" : root.sourceOrigin,
        ...(marker?.sourceRoot ? { managedSourceRoot: marker.sourceRoot } : {}),
        ...(sourceDigest ? { sourceDigest } : {}),
        ...(targetDigest ? { targetDigest } : {}),
        ...(marker?.sourceRoot ? { outOfDate } : {}),
      },
    };
    addItemDeployment(accumulator, {
      id: deployment.itemId,
      kind: "skill",
      name: parsed.name,
      title: parsed.title,
      description: parsed.description,
      enabled: deployment.enabled,
      managedByOpenGrove,
      readonly: deployment.readonly,
      system,
      source: {
        origin: marker?.sourceRoot ? "opengrove" : root.sourceOrigin,
        kernelId: root.kernelId,
        path: skillRoot,
        readonly: deployment.readonly,
        system,
      },
      deployments: [],
      permissions: skillPermissions(parsed),
      commandUsages: skillCommandUsages(parsed, deployment.id, root.kernelId),
      childIds: [],
      tags: parsed.tags,
      metadata: {
        allowedTools: parsed.allowedTools,
        shell: parsed.shell,
        paths: parsed.paths,
      },
    }, deployment);
    accumulator.commandUsages.push(...skillCommandUsages(parsed, deployment.id, root.kernelId));
  }
}

function scanMcpConfig(accumulator: InventoryAccumulator, root: ExtensionRootDescriptor): void {
  if (!existsSync(root.path)) return;
  const config = parseJsonLikeConfig(root.path, root.configFormat);
  if (!config) return;
  for (const server of extractMcpServers(config)) {
    const item = mcpItemFromEntry(server, root.path, root.kernelId);
    const deployment: ExtensionDeployment = {
      id: deploymentId("mcp", root.kernelId, root.path, server.name),
      itemId: item.id,
      kind: "mcp",
      kernelId: root.kernelId,
      scope: root.scope,
      status: "enabled",
      enabled: true,
      managedByOpenGrove: false,
      readonly: root.readonly,
      system: root.system,
      configPath: root.path,
      configFormat: root.configFormat,
      command: server.command,
      args: server.args,
      envKeys: server.envKeys,
      metadata: {
        reason: root.reason,
        ...(server.url ? { url: server.url } : {}),
      },
    };
    addItemDeployment(accumulator, item, deployment);
    accumulator.commandUsages.push(...item.commandUsages);
  }
}

function scanHookConfig(accumulator: InventoryAccumulator, root: ExtensionRootDescriptor): void {
  if (!existsSync(root.path)) return;
  const config = parseJsonLikeConfig(root.path, root.configFormat);
  if (!config) return;
  for (const hook of extractHookEntries(config)) {
    const item = hookItemFromEntry(hook, root.path, root.kernelId);
    const deployment: ExtensionDeployment = {
      id: deploymentId("hook", root.kernelId, root.path, hook.name),
      itemId: item.id,
      kind: "hook",
      kernelId: root.kernelId,
      scope: root.scope,
      status: "enabled",
      enabled: true,
      managedByOpenGrove: false,
      readonly: root.readonly,
      system: root.system,
      configPath: root.path,
      configFormat: root.configFormat,
      command: hook.command,
      args: hook.args,
      envKeys: hook.envKeys,
      metadata: {
        reason: root.reason,
        ...(hook.event ? { event: hook.event } : {}),
        ...(hook.matcher ? { matcher: hook.matcher } : {}),
      },
    };
    addItemDeployment(accumulator, item, deployment);
    accumulator.commandUsages.push(...item.commandUsages);
  }
}

function scanPluginRoot(accumulator: InventoryAccumulator, root: ExtensionRootDescriptor): void {
  if (!existsSync(root.path)) return;
  for (const plugin of discoverPlugins(root)) {
    const commands = extractCommandUsagesFromObject(plugin.metadata, "plugin", itemId("plugin", plugin.name), root.kernelId, plugin.manifestPath);
    const deployment: ExtensionDeployment = {
      id: deploymentId("plugin", root.kernelId, plugin.pluginRoot, plugin.name),
      itemId: itemId("plugin", plugin.name),
      kind: "plugin",
      kernelId: root.kernelId,
      scope: root.scope,
      status: plugin.enabled ? "enabled" : "disabled",
      enabled: plugin.enabled,
      managedByOpenGrove: plugin.sourceOrigin === "opengrove",
      readonly: root.readonly,
      system: root.system,
      sourcePath: plugin.manifestPath,
      targetPath: plugin.pluginRoot,
      metadata: {
        reason: root.reason,
        manifestPath: plugin.manifestPath,
      },
    };
    addItemDeployment(accumulator, {
      id: deployment.itemId,
      kind: "plugin",
      name: plugin.name,
      title: plugin.title,
      description: plugin.description,
      enabled: plugin.enabled,
      managedByOpenGrove: deployment.managedByOpenGrove,
      readonly: deployment.readonly,
      system: deployment.system,
      source: {
        origin: plugin.sourceOrigin,
        kernelId: root.kernelId,
        path: plugin.pluginRoot,
        readonly: deployment.readonly,
        system: deployment.system,
      },
      deployments: [],
      permissions: commandsToPermissions(commands),
      commandUsages: commands,
      childIds: [],
      tags: [],
      metadata: plugin.metadata,
    }, deployment);
    accumulator.commandUsages.push(...commands);
  }
}

function scanMountedApps(accumulator: InventoryAccumulator, state: BridgeState): void {
  const seenRoots = new Set<string>();
  for (const mountedApp of state.settings.mountedApps ?? []) {
    if (!mountedApp.path?.trim()) continue;
    const appRoot = resolvePathLike(mountedApp.path);
    if (seenRoots.has(appRoot)) continue;
    seenRoots.add(appRoot);
    const entry = mountedAppEntry(mountedApp, appRoot);
    const appItemId = itemId("app", entry.name);
    const cliChildIds = entry.cli.map((cli) => itemId("cli", `${entry.name}.${cli.id}`));
    const deployment: ExtensionDeployment = {
      id: deploymentId("app", undefined, appRoot, entry.name),
      itemId: appItemId,
      kind: "app",
      scope: "external",
      status: entry.status,
      enabled: entry.enabled,
      managedByOpenGrove: false,
      readonly: false,
      system: false,
      sourcePath: appRoot,
      targetPath: appRoot,
      metadata: {
        ...(entry.manifestPath ? { manifestPath: entry.manifestPath } : {}),
        ...entry.metadata,
        capabilities: entry.capabilities,
      },
    };
    addItemDeployment(accumulator, {
      id: deployment.itemId,
      kind: "app",
      name: entry.name,
      title: entry.title,
      description: entry.description,
      enabled: deployment.enabled,
      managedByOpenGrove: false,
      readonly: false,
      system: false,
      source: {
        origin: "local",
        path: appRoot,
        packageId: entry.name,
        readonly: false,
        system: false,
      },
      deployments: [],
      permissions: [{ type: "filesystem", values: [appRoot] }],
      commandUsages: [],
      childIds: cliChildIds,
      tags: ["app", ...entry.capabilities],
      metadata: deployment.metadata ?? {},
    }, deployment);
    for (const cli of entry.cli) {
      addMountedAppCli(accumulator, entry, appItemId, cli);
    }
  }
}

function addMountedAppCli(
  accumulator: InventoryAccumulator,
  app: MountedAppEntry,
  appItemId: string,
  cli: MountedAppCliDeclaration,
): void {
  const cliItemName = `${app.name}.${cli.id}`;
  const cliItemId = itemId("cli", cliItemName);
  const usage = commandUsage({
    command: cli.command,
    args: cli.args,
    envKeys: cli.envKeys,
    parentKind: "cli",
    parentId: cliItemId,
    resolvedPath: cli.resolvedPath,
    risk: commandRisk(cli.command, cli.args),
  });
  const enabled = app.enabled && Boolean(cli.resolvedPath);
  const deployment: ExtensionDeployment = {
    id: deploymentId("cli", undefined, cli.command, cliItemName),
    itemId: cliItemId,
    kind: "cli",
    scope: "external",
    status: enabled ? "enabled" : "missing",
    enabled,
    managedByOpenGrove: false,
    readonly: true,
    system: false,
    sourcePath: app.manifestPath ?? app.appRoot,
    targetPath: cli.resolvedPath,
    command: cli.command,
    args: cli.args,
    envKeys: cli.envKeys,
    metadata: {
      appId: app.name,
      appRoot: app.appRoot,
      cwd: cli.cwd ?? app.appRoot,
      doctor: cli.doctor,
      smoke: cli.smoke,
      artifacts: cli.artifacts,
      allowNativeBash: cli.allowNativeBash,
      declared: cli.metadata,
      ...(cli.resolvedPath ? { resolvedPath: cli.resolvedPath } : {}),
    },
  };
  addItemDeployment(accumulator, {
    id: cliItemId,
    kind: "cli",
    name: cliItemName,
    title: `${app.title} / ${cli.title}`,
    description: cli.description || `CLI declared by ${app.title}.`,
    enabled,
    managedByOpenGrove: false,
    readonly: true,
    system: false,
    source: {
      origin: "local",
      path: cli.resolvedPath ?? app.appRoot,
      packageId: app.name,
      readonly: true,
      system: false,
    },
    deployments: [],
    permissions: [
      { type: "shell", values: [cli.command] },
      ...(cli.envKeys.length ? [{ type: "env" as const, values: cli.envKeys }] : []),
    ],
    commandUsages: [usage],
    parentId: appItemId,
    childIds: [],
    tags: ["cli", app.name, cli.allowNativeBash ? "native-bash" : ""],
    metadata: deployment.metadata ?? {},
  }, deployment);
}

function addTool(accumulator: InventoryAccumulator, tool: ToolSpec, workspaceRoot: string): void {
  const deployment: ExtensionDeployment = {
    id: deploymentId("tool", undefined, "opengrove", tool.id),
    itemId: itemId("tool", tool.id),
    kind: "tool",
    scope: "managed",
    status: "enabled",
    enabled: true,
    managedByOpenGrove: true,
    readonly: true,
    system: false,
    metadata: {
      activity: tool.activity,
      risk: tool.risk,
      permission: tool.permission as unknown as JsonObject,
    },
  };
  addItemDeployment(accumulator, {
    id: deployment.itemId,
    kind: "tool",
    name: tool.id,
    title: tool.title,
    description: tool.description,
    enabled: true,
    managedByOpenGrove: true,
    readonly: true,
    system: false,
    source: {
      origin: "opengrove",
      path: workspaceRoot,
      readonly: true,
      system: false,
    },
    deployments: [],
    permissions: [{
      type: tool.risk === "send" ? "network" : tool.risk === "write" || tool.risk === "delete" ? "filesystem" : "unknown",
      values: [tool.risk],
    }],
    commandUsages: [],
    childIds: [],
    tags: [tool.activity, tool.risk],
    metadata: {
      input: tool.input as unknown as JsonObject,
      output: tool.output as unknown as JsonObject,
    },
  }, deployment);
}

function discoverSkillDirectories(rootPath: string, recursive: boolean, maxDepth: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let identity = dir;
    try {
      identity = realpathSync(dir);
    } catch {
      identity = dir;
    }
    if (seen.has(identity)) return;
    seen.add(identity);
    if (existsSync(join(dir, "SKILL.md")) || existsSync(join(dir, "SKILL.md.disabled"))) {
      output.push(dir);
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) continue;
      if (!recursive && depth >= 1) continue;
      visit(join(dir, entry.name), depth + 1);
    }
  };
  visit(rootPath, 0);
  return output.sort((left, right) => left.localeCompare(right));
}

function discoverPlugins(root: ExtensionRootDescriptor): PluginEntry[] {
  const output: PluginEntry[] = [];
  const seen = new Set<string>();
  const visit = (dir: string, depth: number) => {
    if (depth > (root.maxDepth ?? 4)) return;
    if (seen.has(dir)) return;
    seen.add(dir);
    const manifest = findPluginManifest(dir);
    if (manifest) {
      const parsed = parseJsonLikeConfig(manifest.path, "jsonc") ?? {};
      const name = stringValue(parsed.name) || stringValue(parsed.id) || basename(pluginRootForManifest(manifest.path));
      output.push({
        name,
        title: stringValue(parsed.title) || stringValue(parsed.displayName) || titleFromName(name),
        description: stringValue(parsed.description) || "",
        manifestPath: manifest.path,
        pluginRoot: pluginRootForManifest(manifest.path),
        enabled: manifest.enabled,
        sourceOrigin: stringValue(parsed.managedBy) === APP_MANAGED_BY ? "opengrove" : root.sourceOrigin,
        metadata: parsed,
      });
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDirectory(entry.name)) continue;
      visit(join(dir, entry.name), depth + 1);
    }
  };
  visit(root.path, 0);
  return output.sort((left, right) => left.name.localeCompare(right.name));
}

function findPluginManifest(dir: string): { path: string; enabled: boolean } | undefined {
  const candidates = [
    "plugin.json",
    "plugin.json.disabled",
    "manifest.json",
    "manifest.json.disabled",
    join(".codex-plugin", "plugin.json"),
    join(".codex-plugin", "plugin.json.disabled"),
    join(".claude-plugin", "plugin.json"),
    join(".claude-plugin", "plugin.json.disabled"),
  ];
  for (const candidate of candidates) {
    const path = join(dir, candidate);
    if (existsSync(path)) {
      return { path, enabled: !path.endsWith(".disabled") };
    }
  }
  return undefined;
}

function mountedAppEntry(
  mountedApp: { id?: string; path: string; enabled?: boolean; title?: string },
  appRoot: string,
): MountedAppEntry {
  const exists = existsSync(appRoot);
  const manifest = exists ? findMountedAppManifest(appRoot) : undefined;
  const metadata = manifest ? parseJsonLikeConfig(manifest, "jsonc") ?? {} : {};
  const name = stringValue(metadata.id)
    ?? stringValue(metadata.name)
    ?? mountedApp.id
    ?? basename(appRoot);
  const cli = exists ? parseMountedAppCliDeclarations(metadata as JsonObject, appRoot) : [];
  const capabilities = exists ? uniqueStrings([
    ...discoverMountedAppCapabilities(appRoot),
    ...(cli.length ? ["cli"] : []),
  ]) : [];
  const enabled = mountedApp.enabled !== false && exists;
  return {
    name,
    title: stringValue(metadata.title)
      ?? stringValue(metadata.displayName)
      ?? mountedApp.title
      ?? titleFromName(name),
    description: stringValue(metadata.description) || "",
    appRoot,
    manifestPath: manifest,
    enabled,
    status: !exists ? "missing" : mountedApp.enabled === false ? "disabled" : "enabled",
    capabilities,
    cli,
    metadata: metadata as JsonObject,
  };
}

function findMountedAppManifest(appRoot: string): string | undefined {
  for (const candidate of ["opengrove.app.json", "opengrove.app.jsonc"]) {
    const path = join(appRoot, candidate);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function discoverMountedAppCapabilities(appRoot: string): string[] {
  const capabilities: string[] = [];
  const directories = [
    ["ui", "ui"],
    ["skills", "skills"],
    ["tools", "tools"],
    ["bin", "bin"],
    ["assets", "assets"],
  ] as const;
  for (const [dirName, capability] of directories) {
    if (existsSync(join(appRoot, dirName))) capabilities.push(capability);
  }
  if (existsSync(join(appRoot, "mcp.json"))) capabilities.push("mcp");
  if (existsSync(join(appRoot, "hooks.json"))) capabilities.push("hooks");
  return capabilities;
}

function parseMountedAppCliDeclarations(manifest: JsonObject, appRoot: string): MountedAppCliDeclaration[] {
  const capabilities = record(manifest.capabilities);
  const rawDeclarations = Array.isArray(capabilities.cli)
    ? capabilities.cli
    : Array.isArray(manifest.cli)
      ? manifest.cli
      : [];
  return uniqueBy(
    rawDeclarations
      .map((value) => parseMountedAppCliDeclaration(value, appRoot))
      .filter((value): value is MountedAppCliDeclaration => Boolean(value)),
    (value) => value.id,
  );
}

function parseMountedAppCliDeclaration(value: unknown, appRoot: string): MountedAppCliDeclaration | undefined {
  if (typeof value === "string") {
    const command = resolveMountedAppCommand(appRoot, value);
    const id = basename(value).replace(/\.[^.]+$/, "") || value;
    return {
      id,
      title: titleFromName(id),
      description: "",
      command,
      args: [],
      envKeys: [],
      doctor: [],
      smoke: [],
      artifacts: [],
      allowNativeBash: true,
      resolvedPath: resolveExecutable(command),
      metadata: { id, command: value },
    };
  }

  const declaration = record(value);
  const declaredCommand = stringValue(declaration.command)
    ?? stringValue(declaration.path)
    ?? stringValue(declaration.bin)
    ?? stringValue(declaration.id)
    ?? stringValue(declaration.name);
  if (!declaredCommand) return undefined;

  const command = resolveMountedAppCommand(appRoot, declaredCommand);
  const id = stringValue(declaration.id)
    ?? stringValue(declaration.name)
    ?? basename(declaredCommand).replace(/\.[^.]+$/, "")
    ?? declaredCommand;
  return {
    id,
    title: stringValue(declaration.title) ?? stringValue(declaration.displayName) ?? titleFromName(id),
    description: stringValue(declaration.description) ?? "",
    command,
    args: arrayOfStrings(declaration.args),
    envKeys: uniqueStrings([
      ...arrayOfStrings(declaration.env),
      ...arrayOfStrings(declaration.envKeys),
      ...arrayOfStrings(declaration.env_keys),
    ]),
    doctor: commandTokens(declaration.doctor),
    smoke: commandTokens(declaration.smoke),
    cwd: resolveMountedAppOptionalPath(appRoot, stringValue(declaration.cwd)),
    artifacts: arrayOfStrings(declaration.artifacts ?? declaration.outputs),
    allowNativeBash: declaration.allowNativeBash !== false && declaration.allow_native_bash !== false,
    resolvedPath: resolveExecutable(command),
    metadata: declaration as JsonObject,
  };
}

function resolveMountedAppCommand(appRoot: string, command: string): string {
  const value = command.trim();
  if (!value) return value;
  if (isAbsolute(value)) return value;
  if (value.startsWith(".") || value.includes("/")) return resolve(appRoot, value);
  const appBinCommand = join(appRoot, "bin", value);
  return existsSync(appBinCommand) ? appBinCommand : value;
}

function resolveMountedAppOptionalPath(appRoot: string, path: string | undefined): string | undefined {
  if (!path) return undefined;
  return isAbsolute(path) ? path : resolve(appRoot, path);
}

function commandTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function pluginRootForManifest(path: string): string {
  const parent = dirname(path);
  const parentName = basename(parent);
  if (parentName === ".codex-plugin" || parentName === ".claude-plugin" || parentName === ".plugin") {
    return dirname(parent);
  }
  return parent;
}

function mcpItemFromEntry(
  server: McpServerEntry,
  configPath: string,
  kernelId?: BridgeKernelId,
): ManagedExtensionRecord {
  const usage = server.command ? commandUsage({
    command: server.command,
    args: server.args,
    envKeys: server.envKeys,
    parentKind: "mcp",
    parentId: itemId("mcp", server.name),
    kernelId,
    configPath,
    risk: commandRisk(server.command, server.args),
  }) : undefined;
  const permissions: ExtensionPermission[] = [];
  if (server.command) permissions.push({ type: "shell", values: [server.command] });
  if (server.url) permissions.push({ type: "network", values: [server.url] });
  if (server.envKeys.length) permissions.push({ type: "env", values: server.envKeys });
  return {
    id: itemId("mcp", server.name),
    kind: "mcp",
    name: server.name,
    title: titleFromName(server.name),
    description: server.command
      ? `MCP server launched with ${server.command}.`
      : server.url
        ? `Remote MCP server at ${server.url}.`
        : "MCP server configuration.",
    enabled: true,
    managedByOpenGrove: false,
    readonly: false,
    system: false,
    source: {
      origin: "kernel",
      kernelId,
      path: configPath,
      readonly: false,
      system: false,
    },
    deployments: [],
    permissions,
    commandUsages: usage ? [usage] : [],
    childIds: [],
    tags: ["mcp"],
    metadata: {
      hasEnv: server.envKeys.length > 0,
      ...(server.url ? { url: server.url } : {}),
    },
  };
}

function hookItemFromEntry(
  hook: HookEntry,
  configPath: string,
  kernelId?: BridgeKernelId,
): ManagedExtensionRecord {
  const usage = hook.command ? commandUsage({
    command: hook.command,
    args: hook.args,
    envKeys: hook.envKeys,
    parentKind: "hook",
    parentId: itemId("hook", hook.name),
    kernelId,
    configPath,
    risk: commandRisk(hook.command, hook.args),
  }) : undefined;
  return {
    id: itemId("hook", hook.name),
    kind: "hook",
    name: hook.name,
    title: hook.event ? `${hook.event}: ${hook.matcher || hook.command || hook.name}` : titleFromName(hook.name),
    description: hook.command ? `Hook command: ${hook.command}` : "Hook configuration.",
    enabled: true,
    managedByOpenGrove: false,
    readonly: false,
    system: false,
    source: {
      origin: "kernel",
      kernelId,
      path: configPath,
      readonly: false,
      system: false,
    },
    deployments: [],
    permissions: hook.command ? [{ type: "shell", values: [hook.command] }] : [],
    commandUsages: usage ? [usage] : [],
    childIds: [],
    tags: ["hook", hook.event ?? ""].filter(Boolean),
    metadata: {
      ...(hook.event ? { event: hook.event } : {}),
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
    },
  };
}

function addItemDeployment(
  accumulator: InventoryAccumulator,
  item: ManagedExtensionRecord,
  deployment: ExtensionDeployment,
): void {
  if (!accumulator.items.has(item.id)) {
    accumulator.items.set(item.id, {
      ...item,
      deployments: [],
      permissions: dedupePermissions(item.permissions),
      commandUsages: uniqueCommandUsages(item.commandUsages),
      childIds: uniqueStrings(item.childIds),
      tags: uniqueStrings(item.tags.filter(Boolean)),
    });
  } else {
    const existing = accumulator.items.get(item.id);
    if (existing) {
      existing.enabled = existing.enabled || item.enabled;
      existing.managedByOpenGrove = existing.managedByOpenGrove || item.managedByOpenGrove;
      existing.readonly = existing.readonly && item.readonly;
      existing.system = existing.system || item.system;
      existing.permissions = dedupePermissions([...existing.permissions, ...item.permissions]);
      existing.commandUsages = uniqueCommandUsages([...existing.commandUsages, ...item.commandUsages]);
      existing.childIds = uniqueStrings([...existing.childIds, ...item.childIds]);
      existing.tags = uniqueStrings([...existing.tags, ...item.tags.filter(Boolean)]);
    }
  }
  if (!accumulator.deployments.some((candidate) => candidate.id === deployment.id)) {
    accumulator.deployments.push(deployment);
  }
}

function parseSkillFile(path: string, fallbackName: string): ParsedSkill {
  try {
    const parsed = parseFrontmatter(readFileSync(path, "utf8"));
    const name = stringValue(parsed.frontmatter.name) || fallbackName;
    const bodyDescription = firstBodyParagraph(parsed.body);
    const skillRoot = dirname(path);
    return {
      name,
      title: stringValue(parsed.frontmatter.title) || titleFromName(name),
      description: stringValue(parsed.frontmatter.description) || bodyDescription || "",
      tags: arrayOfStrings(parsed.frontmatter.tags),
      allowedTools: arrayOfStrings(parsed.frontmatter["allowed-tools"] ?? parsed.frontmatter.allowed_tools),
      shell: arrayOfStrings(parsed.frontmatter.shell).map((item) => resolveSkillScopedValue(item, skillRoot)),
      paths: arrayOfStrings(parsed.frontmatter.paths).map((item) => resolveSkillScopedValue(item, skillRoot)),
      frontmatter: parsed.frontmatter,
    };
  } catch {
    return {
      name: fallbackName,
      title: titleFromName(fallbackName),
      description: "",
      tags: [],
      allowedTools: [],
      shell: [],
      paths: [],
      frontmatter: {},
    };
  }
}

function resolveSkillScopedValue(value: string, skillRoot: string): string {
  const resolved = value
    .replace(/\$\{OPENGROVE_SKILL_DIR\}/g, skillRoot)
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillRoot);
  if (/^[^\s]+$/.test(resolved) && (resolved.startsWith("/") || resolved === "~" || resolved.startsWith("~/"))) {
    return resolvePathLike(resolved);
  }
  return resolved;
}

function resolvePathLike(path: string): string {
  if (path === "~") return resolve(homedir());
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }
  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex < 0) {
    return { frontmatter: {}, body: normalized };
  }
  const rawFrontmatter = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5);
  const frontmatter: Record<string, unknown> = {};
  let currentKey = "";
  let currentList: string[] | undefined;
  const flushList = () => {
    if (currentKey && currentList) frontmatter[currentKey] = [...currentList];
    currentList = undefined;
  };
  for (const rawLine of rawFrontmatter.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      currentList ??= [];
      currentList.push(stripQuotes(listMatch[1].trim()));
      continue;
    }
    flushList();
    const separator = line.indexOf(":");
    if (separator < 0) {
      currentKey = "";
      continue;
    }
    currentKey = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!rawValue) {
      currentList = [];
      continue;
    }
    frontmatter[currentKey] = parseScalar(rawValue);
    currentKey = "";
  }
  flushList();
  return { frontmatter, body };
}

function parseSimpleToml(text: string): JsonObject {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;
  for (const rawLine of text.split(/\r?\n/g)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = root;
      for (const part of sectionMatch[1].split(".")) {
        const key = stripQuotes(part.trim());
        const next = record(current[key]);
        current[key] = next;
        current = next;
      }
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    current[key] = parseTomlValue(line.slice(separator + 1).trim());
  }
  return root as JsonObject;
}

function parseTomlValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitCsvLike(inner).map((part) => stripQuotes(part.trim()));
  }
  if (value === "true") return true;
  if (value === "false") return false;
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && /^-?\d+(\.\d+)?$/.test(value)) return numberValue;
  return stripQuotes(value);
}

function extractClaudeStyleHooks(hooks: Record<string, unknown>): HookEntry[] {
  const entries: HookEntry[] = [];
  for (const [event, rawEventEntries] of Object.entries(hooks)) {
    const eventEntries = Array.isArray(rawEventEntries) ? rawEventEntries : [rawEventEntries];
    for (const rawEntry of eventEntries) {
      const entry = record(rawEntry);
      const matcher = stringValue(entry.matcher);
      const nestedHooks = Array.isArray(entry.hooks) ? entry.hooks : [entry];
      for (const nested of nestedHooks) {
        const nestedRecord = record(nested);
        const command = stringValue(nestedRecord.command) ?? stringValue(nestedRecord.cmd);
        if (!command) continue;
        const name = safeName([event, matcher ?? "all", command].join("-"));
        entries.push({
          name,
          event,
          matcher,
          command,
          args: arrayOfStrings(nestedRecord.args),
          envKeys: Object.keys(record(nestedRecord.env)),
          entry: nestedRecord as JsonObject,
        });
      }
    }
  }
  return uniqueBy(entries, (entry) => entry.name);
}

function extractGenericHookCommands(config: JsonObject): HookEntry[] {
  const entries: HookEntry[] = [];
  const visit = (value: unknown, path: string[]) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    const item = record(value);
    if (!Object.keys(item).length) return;
    const command = stringValue(item.command) ?? stringValue(item.cmd) ?? stringValue(item.run);
    if (command) {
      const event = stringValue(item.event) ?? path[path.length - 1];
      const matcher = stringValue(item.matcher) ?? stringValue(item.match);
      const name = safeName([event ?? "hook", matcher ?? "all", command].join("-"));
      entries.push({
        name,
        event,
        matcher,
        command,
        args: arrayOfStrings(item.args),
        envKeys: Object.keys(record(item.env)),
        entry: item as JsonObject,
      });
    }
    for (const [key, child] of Object.entries(item)) {
      if (key === "mcpServers" || key === "mcp_servers" || key === "servers") continue;
      visit(child, [...path, key]);
    }
  };
  visit(config, []);
  return uniqueBy(entries, (entry) => entry.name);
}

function extractCommandUsagesFromObject(
  input: JsonObject,
  parentKind: ExtensionKind,
  parentId: string,
  kernelId: BridgeKernelId | undefined,
  configPath: string,
): ExtensionCommandUsage[] {
  const commands: ExtensionCommandUsage[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const item = record(value);
    if (!Object.keys(item).length) return;
    const command = stringValue(item.command) ?? stringValue(item.cmd) ?? stringValue(item.run);
    if (command) {
      commands.push(commandUsage({
        command,
        args: arrayOfStrings(item.args),
        envKeys: Object.keys(record(item.env)),
        parentKind,
        parentId,
        kernelId,
        configPath,
        risk: commandRisk(command, arrayOfStrings(item.args)),
      }));
    }
    for (const child of Object.values(item)) visit(child);
  };
  visit(input);
  return uniqueCommandUsages(commands);
}

function skillPermissions(skill: ParsedSkill): ExtensionPermission[] {
  const permissions: ExtensionPermission[] = [];
  if (skill.allowedTools.length) permissions.push({ type: "unknown", values: skill.allowedTools });
  if (skill.shell.length) permissions.push({ type: "shell", values: skill.shell });
  if (skill.paths.length) permissions.push({ type: "filesystem", values: skill.paths });
  return permissions;
}

function skillCommandUsages(
  skill: ParsedSkill,
  deploymentIdValue: string,
  kernelId?: BridgeKernelId,
): ExtensionCommandUsage[] {
  return skill.shell.map((command) => commandUsage({
    command,
    args: [],
    envKeys: [],
    parentKind: "skill",
    parentId: deploymentIdValue,
    kernelId,
    risk: commandRisk(command, []),
  }));
}

function commandsToPermissions(commands: ExtensionCommandUsage[]): ExtensionPermission[] {
  const permissions: ExtensionPermission[] = [];
  const shellValues = uniqueStrings(commands.map((usage) => usage.command));
  const envValues = uniqueStrings(commands.flatMap((usage) => usage.envKeys));
  if (shellValues.length) permissions.push({ type: "shell", values: shellValues });
  if (envValues.length) permissions.push({ type: "env", values: envValues });
  return permissions;
}

function readManagedMarker(skillRoot: string): { managedBy?: string; sourceRoot?: string } | undefined {
  const markerPath = join(skillRoot, APP_NATIVE_SKILL_MARKER_FILE);
  if (!existsSync(markerPath)) return undefined;
  try {
    return record(JSON.parse(readFileSync(markerPath, "utf8"))) as { managedBy?: string; sourceRoot?: string };
  } catch {
    return undefined;
  }
}

function skillDirectoryDigest(skillRoot: string | undefined): string | undefined {
  if (!skillRoot || !existsSync(skillRoot)) return undefined;
  try {
    const root = realpathSync(skillRoot);
    const hash = createHash("sha256");
    for (const file of comparableSkillFiles(root)) {
      hash.update(file.relativePath);
      hash.update("\0");
      hash.update(readFileSync(file.absolutePath));
      hash.update("\0");
    }
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

function comparableSkillFiles(root: string, base = root): { absolutePath: string; relativePath: string }[] {
  const files: { absolutePath: string; relativePath: string }[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === APP_NATIVE_SKILL_MARKER_FILE || entry.name === ".opengrove-skill-origin.json") continue;
    const absolutePath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...comparableSkillFiles(absolutePath, base));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({
      absolutePath,
      relativePath: absolutePath.slice(base.length + 1).replace(/\\/g, "/"),
    });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function commandUsage(input: Omit<ExtensionCommandUsage, "resolvedPath"> & { resolvedPath?: string }): ExtensionCommandUsage {
  return {
    ...input,
    resolvedPath: input.resolvedPath ?? resolveExecutable(input.command),
  };
}

function commandRisk(command: string, args: string[]): "low" | "medium" | "high" {
  const text = [command, ...args].join(" ").toLowerCase();
  if (/\b(rm|sudo|chmod|chown|mkfs|dd|curl|wget|ssh|scp|docker|kubectl)\b/.test(text)) {
    return "high";
  }
  if (/\b(npx|uvx|python|node|bash|sh|zsh|powershell|pwsh)\b/.test(text)) {
    return "medium";
  }
  return "low";
}

function resolveExecutable(command: string | undefined): string | undefined {
  if (!command?.trim()) return undefined;
  const executable = command.trim().split(/\s+/)[0];
  if (!executable) return undefined;
  if (isAbsolute(executable) || executable.includes("/")) {
    return isExecutable(executable) ? resolve(executable) : undefined;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, executable);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function summarizeInventory(
  items: ManagedExtensionRecord[],
  deployments: ExtensionDeployment[],
): ExtensionInventorySummary {
  const byKind: Record<string, number> = {};
  const byKernel: Record<string, number> = {};
  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  }
  for (const deployment of deployments) {
    if (deployment.kernelId) {
      byKernel[deployment.kernelId] = (byKernel[deployment.kernelId] ?? 0) + 1;
    }
  }
  return {
    itemCount: items.length,
    deploymentCount: deployments.length,
    byKind,
    byKernel,
    managedCount: items.filter((item) => item.managedByOpenGrove).length,
    systemCount: items.filter((item) => item.system).length,
  };
}

function parseScalar(rawValue: string): unknown {
  const value = rawValue.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner ? splitCsvLike(inner).map((part) => stripQuotes(part.trim())) : [];
  }
  return stripQuotes(value);
}

function splitCsvLike(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function firstBodyParagraph(body: string): string | undefined {
  const line = body
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith("#"));
  return line || undefined;
}

function itemId(kind: ExtensionKind, name: string): string {
  return `${kind}.${safeName(name)}`;
}

function deploymentId(kind: ExtensionKind, kernelId: BridgeKernelId | undefined, path: string, name: string): string {
  return `deployment.${kind}.${kernelId ?? "host"}.${safeName(name)}.${hashText(`${path}\n${name}`)}`;
}

function safeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function arrayOfStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const output: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(item);
  }
  return output;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function uniqueCommandUsages(values: ExtensionCommandUsage[]): ExtensionCommandUsage[] {
  return uniqueBy(values, (usage) =>
    [
      usage.parentKind,
      usage.parentId,
      usage.kernelId ?? "",
      usage.command,
      usage.args.join(" "),
      usage.configPath ?? "",
    ].join("\n")
  );
}

function dedupePermissions(values: ExtensionPermission[]): ExtensionPermission[] {
  const byType = new Map<ExtensionPermission["type"], Set<string>>();
  for (const value of values) {
    const set = byType.get(value.type) ?? new Set<string>();
    for (const item of value.values) set.add(item);
    byType.set(value.type, set);
  }
  return Array.from(byType.entries()).map(([type, set]) => ({
    type,
    values: Array.from(set).sort((left, right) => left.localeCompare(right)),
  }));
}

function compareItems(left: ManagedExtensionRecord, right: ManagedExtensionRecord): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}

function compareDeployments(left: ExtensionDeployment, right: ExtensionDeployment): number {
  return (
    left.kind.localeCompare(right.kind) ||
    (left.kernelId ?? "").localeCompare(right.kernelId ?? "") ||
    (left.targetPath ?? left.configPath ?? "").localeCompare(right.targetPath ?? right.configPath ?? "")
  );
}

function shouldSkipDirectory(name: string): boolean {
  return name === "node_modules" || name === ".git" || name === "dist" || name === "web-dist";
}

function titleFromName(name: string): string {
  return name
    .split(/[-_.\s]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function pathSep(): string {
  return process.platform === "win32" ? "\\" : "/";
}
