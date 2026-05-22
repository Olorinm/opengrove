import { apiUrl } from "../../api-base";
import type { ExtensionItemRecord, DeveloperSession } from "../../bridge";

export function isMountedWorkbenchApp(item: ExtensionItemRecord): boolean {
  if (item.kind !== "app" || !item.enabled) return false;
  const ui = recordFromUnknown(item.metadata?.ui);
  const kind = String(ui.kind || "");
  return kind === "file-workbench" || kind === "web-app" || kind === "web";
}

export function mountedAppMatchesId(app: ExtensionItemRecord, appId: string): boolean {
  if (!appId) return false;
  const source = recordFromUnknown(app.source);
  return app.name === appId ||
    app.id === appId ||
    app.id === `app:${appId}` ||
    source.packageId === appId;
}

export function mountedAppSourcePath(app: ExtensionItemRecord): string {
  const sourcePath = typeof app.source?.path === "string" ? app.source.path : "";
  return sourcePath || String(app.deployments[0]?.targetPath || app.deployments[0]?.sourcePath || "");
}

export function mountedAppWorkspaceHint(app: ExtensionItemRecord): string {
  const ui = recordFromUnknown(app.metadata?.ui);
  const workspace = typeof ui.workspace === "string" && ui.workspace.trim() ? ui.workspace.trim() : "workspace";
  const root = mountedAppSourcePath(app);
  return root ? `${root}/${workspace}` : workspace;
}

export function mountedAppDeveloperPreviewUrl(app: ExtensionItemRecord): string {
  const ui = recordFromUnknown(app.metadata?.ui);
  const developer = recordFromUnknown(ui.developer);
  const kind = String(ui.kind || "");
  const explicitUrl = [
    developer.targetUrl,
    developer.previewUrl,
    developer.url,
    ui.targetUrl,
    ui.previewUrl,
    ui.url,
  ].find((value) => typeof value === "string" && value.trim());
  if (typeof explicitUrl === "string") return apiUrl(explicitUrl.trim());
  const explicitEntry = [developer.entry, ui.entry].find((value) => typeof value === "string" && value.trim());
  if (typeof explicitEntry === "string") {
    return apiUrl(`/apps/${encodeURIComponent(app.name)}/ui/${explicitEntry.trim().replace(/^\/+/, "")}`);
  }
  if (kind === "file-workbench") {
    const params = new URLSearchParams({
      view: "app",
      app: app.name,
      embedded: "app",
    });
    return apiUrl(`/ui/?${params.toString()}`);
  }
  return apiUrl(`/apps/${encodeURIComponent(app.name)}/ui/`);
}

export function mountedAppDeveloperSessionTitle(app: ExtensionItemRecord): string {
  return `${app.title} 开发`;
}

export function mountedAppDeveloperSessionDescription(app: ExtensionItemRecord): string {
  return [
    `开发和修改 ${app.title} App。`,
    "",
    `Mounted App: ${app.name}`,
    `App root: ${mountedAppSourcePath(app) || "unknown"}`,
  ].join("\n");
}

export function findMountedAppDeveloperSession(app: ExtensionItemRecord | undefined, sessions: DeveloperSession[]): DeveloperSession | undefined {
  if (!app) return undefined;
  const targetRoot = mountedAppSourcePath(app);
  const title = mountedAppDeveloperSessionTitle(app);
  return sessions.find((session) => session.targetRoot === targetRoot && session.title === title);
}

export function mountedAppAgentContext(app: ExtensionItemRecord, selectedPath: string): string {
  const ui = recordFromUnknown(app.metadata?.ui);
  const contextPrompt = typeof ui.agentContext === "string" ? ui.agentContext.trim() : "";
  return [
    "OpenGrove Mounted App Context",
    `App: ${app.title} (${app.name})`,
    `App root: ${mountedAppSourcePath(app) || "unknown"}`,
    `Workspace: ${mountedAppWorkspaceHint(app)}`,
    selectedPath ? `Selected file: ${selectedPath}` : "Selected file: none",
    "",
    contextPrompt || "Use this app's mounted skills and local CLIs for the requested workflow. Write generated files under the app workspace so the file tree and preview can update.",
  ].join("\n");
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
