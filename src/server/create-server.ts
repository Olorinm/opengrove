import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { APP_LOCAL_BRIDGE_NAME, readAppEnv } from "../identity.js";
import { pathToFileURL } from "node:url";
import type { JsonValue } from "../core.js";
import {
  createRoutineDraftFromEvents,
  runRoutine,
} from "../routines/routine-runner.js";
import {
  type BridgeState,
  type LocalBridgeServerOptions,
} from "./bridge-types.js";
import { getBridgeCapabilitiesSnapshot } from "./capabilities.js";
import {
  createBridgeState,
  getBridgeSettingsSnapshot,
} from "./bridge-state.js";
import {
  isPublicBridgeRoute,
  normalizeBridgeApiUrl,
} from "./api-paths.js";
import { rejectUnavailableProfileRoute } from "./profile-guards.js";
import { getBridgeRuntimeControls, getBridgeRuntimeControlsByKernel } from "./kernel-selection.js";
import { buildContextRecords } from "./trajectory.js";
import { buildProviderHttpCaptureDiagnostics } from "./provider-http-captures.js";
import { listKnowledgeInventoryDocuments, listKnowledgeVaultFolders, resolveKnowledgeVaultFilePath, syncKnowledgeVaultFiles } from "./knowledge-files.js";
import { serveStaticRoute } from "./routes/static.js";
import { handleKnowledgeRoute } from "./routes/knowledge.js";
import { handleExtensionsRoute } from "./routes/extensions.js";
import { handleAppsRoute } from "./routes/apps.js";
import { handleRemoteMatrixRoute } from "./routes/remote-matrix.js";
import { handleRemoteInviteRoute } from "./routes/remote-invites.js";
import { handleRoomsRoute } from "./routes/rooms.js";
import { startRemoteRuntime } from "./remote/runtime-manager.js";
import { handleSettingsRoute } from "./routes/settings.js";
import { handleVoiceRoute } from "./routes/voice.js";
import { handleDeveloperSessionRoute } from "./routes/developer-sessions.js";
import { stopAllVisualPreviewServices } from "./visual/preview-service.js";
import { handleWorkspaceRoute } from "./routes/workspace.js";
import {
  applyCors,
  createBridgeSecurity,
  isLocalProbeRequest,
  isAllowedOrigin,
  isAuthorized,
  loadLocalEnvFile,
} from "./bridge-security.js";
import { readJsonBody, record, sendJson } from "./http-utils.js";
import {
  isActivitySpace,
  isExecutionKind,
  isMemoryScope,
  isRunStatus,
  isSessionStatus,
  normalizeArtifactAnnotationPayload,
  normalizeArtifactCreatePayload,
  normalizeArtifactPatchPayload,
  normalizeAskPayload,
  normalizeComputerStatePatchPayload,
  normalizeMemoryPatchPayload,
  normalizeRoutineDraftPayload,
  normalizeWorkingStatePatchPayload,
} from "./payloads.js";
import {
  cancelBackgroundAskRun,
  streamAskResponse,
  streamExistingAskResponse,
  persistSnapshotAttachments,
} from "./ask-stream.js";
import { resolveApproval } from "./approval-actions.js";
import { createAnnotationArtifact, createComputerSnapshotArtifact } from "./artifact-actions.js";
import { syncBridgeWorkingState } from "./bridge-working-state.js";
import { scanExtensionInventory } from "../extensions/scanner.js";

export function startOpenGroveServer(options: LocalBridgeServerOptions = {}) {
  loadLocalEnvFile();
  const host = options.host ?? readAppEnv("BRIDGE_HOST") ?? "127.0.0.1";
  const port = options.port ?? Number(readAppEnv("BRIDGE_PORT") ?? 37371);
  const state = createBridgeState(options);
  const security = createBridgeSecurity(options);
  const stopRemoteRuntime = startRemoteRuntime(state);

  const server = createServer(async (request, response) => {
    applyCors(response, request, security);

    if (request.method === "OPTIONS") {
      response.writeHead(
        isLocalProbeRequest(request) || isAllowedOrigin(request.headers.origin, security)
          ? 204
          : 403,
      );
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    const routeUrl = normalizeBridgeApiUrl(url);

    try {
      if (request.method === "GET" && routeUrl.pathname === "/opengrove-probe") {
        sendJson(response, 200, {
          ok: true,
          product: "OpenGrove",
          name: APP_LOCAL_BRIDGE_NAME,
        });
        return;
      }

      if (!isAllowedOrigin(request.headers.origin, security)) {
        sendJson(response, 403, { ok: false, error: "origin_not_allowed" });
        return;
      }

      if (request.method === "GET" && serveStaticRoute(url, response)) {
        return;
      }

      if (!isPublicBridgeRoute(routeUrl.pathname) && !isAuthorized(request, security)) {
        sendJson(response, 401, { ok: false, error: "bridge_token_required" });
        return;
      }

      if (rejectUnavailableProfileRoute(request, response, routeUrl, state)) {
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          name: APP_LOCAL_BRIDGE_NAME,
          time: new Date().toISOString(),
          kernel: state.kernel,
          settings: getBridgeSettingsSnapshot(state),
          capabilities: getBridgeCapabilitiesSnapshot(state),
          runtimeControls: getBridgeRuntimeControls(state),
          runtimeControlsByKernel: getBridgeRuntimeControlsByKernel(state),
          appearance: {
            systemTheme: detectSystemTheme(),
          },
          tokenRequired: Boolean(security.bridgeToken),
        });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/capabilities") {
        sendJson(response, 200, {
          ok: true,
          capabilities: getBridgeCapabilitiesSnapshot(state),
        });
        return;
      }

      if (await handleSettingsRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (await handleVoiceRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (await handleDeveloperSessionRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (await handleWorkspaceRoute({ request, response, url: routeUrl, sendJson })) {
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/approvals") {
        const status = routeUrl.searchParams.get("status");
        const approvals =
          status === "pending" || status === "approved" || status === "rejected"
            ? state.app.approvals.list(status)
            : state.app.approvals.list();
        sendJson(response, 200, { ok: true, approvals });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/memory") {
        const query = routeUrl.searchParams.get("query") ?? "";
        const scope = routeUrl.searchParams.get("scope") ?? "";
        const kind = routeUrl.searchParams.get("kind") ?? "";
        const limit = Number(routeUrl.searchParams.get("limit") ?? 0) || undefined;
        const filter = {
          scope: isMemoryScope(scope) ? scope : undefined,
          kind: kind || undefined,
          limit,
        };
        const memory = query ? state.app.memory.search(query, filter) : state.app.memory.list(filter);
        sendJson(response, 200, { ok: true, memory });
        return;
      }

      if (await handleKnowledgeRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (await handleExtensionsRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (await handleAppsRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/artifacts") {
        const type = routeUrl.searchParams.get("type") ?? "";
        const ids = routeUrl.searchParams.getAll("id");
        const tags = routeUrl.searchParams.getAll("tag");
        const limit = Number(routeUrl.searchParams.get("limit") ?? 0) || undefined;
        const artifacts = state.app.artifacts.list({
          ids: ids.length ? ids : undefined,
          type: type || undefined,
          tags: tags.length ? tags : undefined,
          limit,
        });
        sendJson(response, 200, { ok: true, artifacts });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/working-state") {
        sendJson(response, 200, { ok: true, workingState: state.app.workingState.get() });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/computer-state") {
        sendJson(response, 200, { ok: true, computerState: state.computerSnapshot });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/sessions") {
        const status = routeUrl.searchParams.get("status") ?? "";
        const activity = routeUrl.searchParams.get("activity") ?? "";
        const limit = Number(routeUrl.searchParams.get("limit") ?? 0) || undefined;
        sendJson(response, 200, {
          ok: true,
          sessions: state.app.sessions.list({
            status: isSessionStatus(status) ? status : undefined,
            activity: isActivitySpace(activity) ? activity : undefined,
            limit,
          }),
        });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/runs") {
        const sessionId = routeUrl.searchParams.get("sessionId") ?? "";
        const status = routeUrl.searchParams.get("status") ?? "";
        const limit = Number(routeUrl.searchParams.get("limit") ?? 0) || undefined;
        sendJson(response, 200, {
          ok: true,
          runs: state.app.sessions.listRuns({
            sessionId: sessionId || undefined,
            status: isRunStatus(status) ? status : undefined,
            limit,
          }),
        });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/executions") {
        const sessionId = routeUrl.searchParams.get("sessionId") ?? "";
        const runId = routeUrl.searchParams.get("runId") ?? "";
        const kind = routeUrl.searchParams.get("kind") ?? "";
        const limit = Number(routeUrl.searchParams.get("limit") ?? 0) || undefined;
        sendJson(response, 200, {
          ok: true,
          executions: state.app.executions.list({
            sessionId: sessionId || undefined,
            runId: runId || undefined,
            kind: isExecutionKind(kind) ? kind : undefined,
            limit,
          }),
        });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/inventory") {
        syncKnowledgeVaultFiles(state);
        sendJson(response, 200, {
          ok: true,
          kernel: state.kernel,
          knowledge: listKnowledgeInventoryDocuments(state),
          knowledgeFolders: listKnowledgeVaultFolders(state),
          knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
          memory: state.app.memory.list(),
          artifacts: state.app.artifacts.list(),
          workingState: state.app.workingState.get(),
          computerState: state.computerSnapshot,
          sessions: state.app.sessions.list(),
          runs: state.app.sessions.listRuns(),
          executions: state.app.executions.list(),
          skills: state.app.skills.list(),
          packs: state.app.packs.list(),
          tools: state.app.tools.specs(),
          extensions: scanExtensionInventory(state),
          capabilities: state.app.capabilities.list(),
        });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/context-records") {
        sendJson(response, 200, {
          ok: true,
          records: buildContextRecords(state.app.events.list(), currentProviderHttpCaptureDiagnostics(state)),
        });
        return;
      }

      const memoryAction = routeUrl.pathname.match(/^\/memory\/([^/]+)$/);
      if (memoryAction && request.method === "DELETE") {
        const [, memoryId] = memoryAction;
        const deleted = state.app.memory.delete(decodeURIComponent(memoryId));
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, deleted, memory: state.app.memory.list() });
        return;
      }

      if (memoryAction && request.method === "PATCH") {
        const [, memoryId] = memoryAction;
        const patch = normalizeMemoryPatchPayload(await readJsonBody(request));
        const memory = state.app.memory.update(decodeURIComponent(memoryId), patch);
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, memory, memories: state.app.memory.list() });
        return;
      }

      if (request.method === "POST" && routeUrl.pathname === "/artifacts") {
        const artifact = state.app.artifacts.create(normalizeArtifactCreatePayload(await readJsonBody(request)));
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, artifact, artifacts: state.app.artifacts.list() });
        return;
      }

      const artifactAction = routeUrl.pathname.match(/^\/artifacts\/([^/]+)$/);
      if (artifactAction && request.method === "PATCH") {
        const [, artifactId] = artifactAction;
        const artifact = state.app.artifacts.update(
          decodeURIComponent(artifactId),
          normalizeArtifactPatchPayload(await readJsonBody(request)),
        );
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, artifact, artifacts: state.app.artifacts.list() });
        return;
      }

      if (artifactAction && request.method === "DELETE") {
        const [, artifactId] = artifactAction;
        const deleted = state.app.artifacts.delete(decodeURIComponent(artifactId));
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, deleted, artifacts: state.app.artifacts.list() });
        return;
      }

      const artifactAnnotationAction = routeUrl.pathname.match(/^\/artifacts\/([^/]+)\/annotation$/);
      if (artifactAnnotationAction && request.method === "POST") {
        const [, artifactId] = artifactAnnotationAction;
        const artifact = createAnnotationArtifact(
          state.app,
          decodeURIComponent(artifactId),
          normalizeArtifactAnnotationPayload(await readJsonBody(request)),
        );
        syncBridgeWorkingState(state.app);
        state.store.saveFrom(state.app);
        sendJson(response, 200, {
          ok: true,
          artifact,
          artifacts: state.app.artifacts.list(),
          workingState: state.app.workingState.get(),
          sessions: state.app.sessions.list({ limit: 12 }),
          runs: state.app.sessions.listRuns({ limit: 24 }),
          executions: state.app.executions.list({ limit: 40 }),
        });
        return;
      }

      if (request.method === "PATCH" && routeUrl.pathname === "/working-state") {
        const workingState = state.app.workingState.update(
          normalizeWorkingStatePatchPayload(await readJsonBody(request)),
        );
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, workingState });
        return;
      }

      if (request.method === "PATCH" && routeUrl.pathname === "/computer-state") {
        const payload = normalizeComputerStatePatchPayload(await readJsonBody(request));
        state.computerSnapshot = {
          ...state.computerSnapshot,
          ...payload.snapshot,
          elements: payload.snapshot.elements ?? state.computerSnapshot.elements ?? [],
        };
        const artifact = payload.recordArtifact ? createComputerSnapshotArtifact(state.app, state.computerSnapshot) : undefined;
        state.store.saveFrom(state.app);
        sendJson(response, 200, {
          ok: true,
          computerState: state.computerSnapshot,
          artifact,
          artifacts: state.app.artifacts.list(),
          workingState: state.app.workingState.get(),
          sessions: state.app.sessions.list({ limit: 12 }),
          runs: state.app.sessions.listRuns({ limit: 24 }),
          executions: state.app.executions.list({ limit: 40 }),
        });
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/events") {
        sendJson(response, 200, { ok: true, events: state.app.events.list() });
        return;
      }

      if (await handleRoomsRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (await handleRemoteInviteRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (await handleRemoteMatrixRoute({ request, response, url: routeUrl, state, sendJson, readJsonBody })) {
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/routines") {
        const status = routeUrl.searchParams.get("status");
        const routines =
          status === "draft" ||
          status === "active" ||
          status === "paused" ||
          status === "needs_repair" ||
          status === "archived"
            ? state.app.routines.list(status)
            : state.app.routines.list();
        sendJson(response, 200, { ok: true, routines });
        return;
      }

      if (request.method === "POST" && routeUrl.pathname === "/ask") {
        sendJson(response, 409, {
          ok: false,
          error: "ask_stream_required",
          message: "POST /ask is disabled because approval and user-input pauses require streaming events. Use POST /ask/stream.",
        });
        return;
      }

      if (request.method === "POST" && routeUrl.pathname === "/ask/stream") {
        const payload = normalizeAskPayload(await readJsonBody(request));
        if (payload.snapshot.vaultFile?.vaultPath) {
          payload.snapshot.vaultFile.filePath = resolveKnowledgeVaultFilePath(payload.snapshot.vaultFile.vaultPath, state);
        }
        persistSnapshotAttachments(payload.snapshot, state);
        await streamAskResponse(state, payload, response);
        return;
      }

      if (request.method === "GET" && routeUrl.pathname === "/ask/stream") {
        await streamExistingAskResponse(state, {
          runId: routeUrl.searchParams.get("runId") || undefined,
          threadId: routeUrl.searchParams.get("threadId") || undefined,
        }, response);
        return;
      }

      if (request.method === "POST" && routeUrl.pathname === "/ask/cancel") {
        const body = record(await readJsonBody(request));
        const cancelled = cancelBackgroundAskRun(state, {
          runId: typeof body.runId === "string" ? body.runId : undefined,
          threadId: typeof body.threadId === "string" ? body.threadId : undefined,
        });
        sendJson(response, 200, { ok: true, cancelled });
        return;
      }

      if (request.method === "POST" && routeUrl.pathname === "/routines/draft") {
        const payload = normalizeRoutineDraftPayload(await readJsonBody(request));
        const routine = createRoutineDraftFromEvents(state.app, payload);
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, routine });
        return;
      }

      const routineRunAction = routeUrl.pathname.match(/^\/routines\/([^/]+)\/run$/);
      if (request.method === "POST" && routineRunAction) {
        const [, routineId] = routineRunAction;
        const result = await runRoutine(state.app, decodeURIComponent(routineId));
        state.store.saveFrom(state.app);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }

      const approvalAction = routeUrl.pathname.match(/^\/approvals\/([^/]+)\/(approve|reject)$/);
      if (request.method === "POST" && approvalAction) {
        const [, approvalId, action] = approvalAction;
        const body = record(await readJsonBody(request));
        const result = await resolveApproval(
          state,
          decodeURIComponent(approvalId),
          action === "approve" ? "approved" : "rejected",
          body.response as JsonValue | undefined,
        );
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  server.on("close", stopRemoteRuntime);
  server.on("close", () => stopAllVisualPreviewServices(state));

  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = address && typeof address === "object" ? address.port : port;
    const profileLabel = state.profile === "local" ? "local bridge" : state.profile;
    console.log(`OpenGrove ${profileLabel} listening on http://${host}:${boundPort}`);
  });
  attachStoreLifecycle(server, state);

  return server;
}

function attachStoreLifecycle(
  server: ReturnType<typeof createServer>,
  state: BridgeState,
): void {
  let storeClosing: Promise<void> | undefined;
  const closeStore = () => {
    storeClosing ??= (async () => {
      if (state.store.close) {
        await state.store.close();
      } else {
        await state.store.flush?.();
      }
    })();
    return storeClosing;
  };

  server.once("close", () => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    void closeStore();
  });

  const shutdown = () => {
    server.close(() => {
      void (async () => {
        await closeStore();
        process.exit(0);
      })();
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function detectSystemTheme(): "light" | "dark" {
  if (process.platform === "darwin") {
    try {
      const value = execFileSync("defaults", ["read", "-g", "AppleInterfaceStyle"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 750,
      }).trim().toLowerCase();
      return value.includes("dark") ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  if (process.platform === "win32") {
    try {
      const value = execFileSync("reg", [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        "/v",
        "AppsUseLightTheme",
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 750,
      }).toLowerCase();
      return /\b0x0\b/.test(value) ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  try {
    const colorScheme = execFileSync("gsettings", ["get", "org.gnome.desktop.interface", "color-scheme"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 750,
    }).toLowerCase();
    if (colorScheme.includes("dark")) return "dark";
  } catch {
    // Non-GNOME Linux desktops may not expose gsettings.
  }

  return "light";
}

function currentProviderHttpCaptureDiagnostics(state: BridgeState) {
  return buildProviderHttpCaptureDiagnostics(getBridgeSettingsSnapshot(state).providerHttpCapture);
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startOpenGroveServer();
}
