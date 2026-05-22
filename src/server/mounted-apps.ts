import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { JsonObject } from "../core.js";
import type { BridgeState } from "./bridge-types.js";
import { safeResolveInside, type WorkspaceScope } from "./workspace-store.js";

export interface MountedAppTarget {
  id: string;
  title: string;
  appRoot: string;
  workspaceRoot: string;
  workspace: WorkspaceScope;
  manifest: JsonObject;
}

export function resolveMountedAppTarget(state: BridgeState, appId: string): MountedAppTarget | undefined {
  for (const mountedApp of state.settings.mountedApps ?? []) {
    if (mountedApp.enabled === false || !mountedApp.path?.trim()) continue;
    const appRoot = resolvePathLike(mountedApp.path);
    if (!existsSync(appRoot)) continue;
    const manifest = readMountedAppManifest(appRoot);
    const manifestId = stringValue(manifest.id) || stringValue(manifest.name);
    const id = manifestId || mountedApp.id || basename(appRoot);
    if (appId !== id && appId !== `app:${id}` && appId !== mountedApp.id) continue;
    const workspaceSetting = stringValue(recordValue(manifest.ui).workspace)
      || stringValue(recordValue(manifest.workspace).path)
      || "workspace";
    const workspaceRoot = safeResolveInside(appRoot, workspaceSetting) ?? join(appRoot, "workspace");
    return {
      id,
      title: stringValue(manifest.title) || mountedApp.title || id,
      appRoot,
      workspaceRoot,
      workspace: {
        kind: "local",
        appId: id,
        root: workspaceRoot,
      },
      manifest,
    };
  }
  return undefined;
}

export function readMountedAppManifest(appRoot: string): JsonObject {
  for (const candidate of ["opengrove.app.json", "opengrove.app.jsonc"]) {
    const path = join(appRoot, candidate);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as JsonObject;
    } catch {
      return {};
    }
  }
  return {};
}

export function resolvePathLike(path: string): string {
  if (path === "~") return resolve(homedir());
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
