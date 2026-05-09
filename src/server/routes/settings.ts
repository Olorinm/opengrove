import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { clearCommandVersionCache } from "../../kernel/discovery.js";
import { applyKernelProxyEnv, resolveKernelProxySettings } from "../../runtime/kernel-proxy.js";
import {
  getBridgeSettingsSnapshot,
  normalizeBridgeSettingsPatch,
  recreateBridgeApp,
  saveBridgeSettings,
} from "../bridge-state.js";
import type { BridgeState } from "../bridge-types.js";
import { applySystemProviderDiscovery } from "../system-provider-discovery.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

export async function handleSettingsRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  state: BridgeState;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
}): Promise<boolean> {
  const { request, response, url, state, sendJson, readJsonBody } = options;

  if (request.method === "GET" && url.pathname === "/settings") {
    sendJson(response, 200, { ok: true, settings: getBridgeSettingsSnapshot(state) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/settings/install-kernel") {
    const payload = record(await readJsonBody(request));
    const kernelId = stringValue(payload.kernelId);
    const actionId = stringValue(payload.actionId);
    const action = findKernelInstallAction(state, kernelId, actionId);
    if (!action) {
      sendJson(response, 404, { ok: false, error: "install_action_not_found" });
      return true;
    }
    if (!Array.isArray(action.command) || action.command.length === 0) {
      sendJson(response, 400, { ok: false, error: "install_command_missing" });
      return true;
    }

    const startedAt = new Date().toISOString();
    try {
      const result = await runInstallCommand(action.command, {
        cwd: stringValue(action.cwd),
        env: applyKernelProxyEnv(
          { ...process.env },
          resolveKernelProxySettings(state.settings.kernelProxy, process.env),
        ),
      });
      clearCommandVersionCache();
      try {
        recreateBridgeApp(state);
      } catch {
        // The install can be for a non-active kernel; failed recreation should not hide command output.
      }
      sendJson(response, 200, {
        ok: true,
        kernelId,
        actionId: action.id,
        command: action.command,
        startedAt,
        finishedAt: new Date().toISOString(),
        ...result,
        settings: getBridgeSettingsSnapshot(state),
      });
    } catch (error) {
      clearCommandVersionCache();
      sendJson(response, 500, {
        ok: false,
        kernelId,
        actionId: action.id,
        command: action.command,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        settings: getBridgeSettingsSnapshot(state),
      });
    }
    return true;
  }

  if (request.method !== "PATCH" || url.pathname !== "/settings") {
    return false;
  }

  const previousSettings = state.settings;
  const nextSettings = applySystemProviderDiscovery(
    normalizeBridgeSettingsPatch(await readJsonBody(request), previousSettings),
  );
  const restartRequired =
    nextSettings.kernel !== previousSettings.kernel ||
    nextSettings.providerHttpCaptureEnabled !== previousSettings.providerHttpCaptureEnabled ||
    JSON.stringify(nextSettings.kernelProxy) !== JSON.stringify(previousSettings.kernelProxy) ||
    JSON.stringify(nextSettings.kernelPathOverrides) !== JSON.stringify(previousSettings.kernelPathOverrides) ||
    JSON.stringify(nextSettings.kernelProviderBindings) !== JSON.stringify(previousSettings.kernelProviderBindings) ||
    JSON.stringify(nextSettings.customProviders) !== JSON.stringify(previousSettings.customProviders);

  if (!restartRequired) {
    state.settings = nextSettings;
    saveBridgeSettings(state);
    sendJson(response, 200, {
      ok: true,
      restarted: false,
      settings: getBridgeSettingsSnapshot(state),
    });
    return true;
  }

  if (state.app) {
    state.store.saveFrom(state.app);
  }
  state.settings = nextSettings;
  try {
    recreateBridgeApp(state);
    saveBridgeSettings(state);
  } catch (error) {
    state.settings = previousSettings;
    try {
      recreateBridgeApp(state);
    } catch {
      // Keep the original error visible; recovery can fail only if the prior runtime vanished.
    }
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      settings: getBridgeSettingsSnapshot(state),
    });
    return true;
  }

  sendJson(response, 200, {
    ok: true,
    restarted: true,
    settings: getBridgeSettingsSnapshot(state),
  });
  return true;
}

function findKernelInstallAction(
  state: BridgeState,
  kernelId: string | undefined,
  actionId: string | undefined,
): Record<string, unknown> | undefined {
  if (!kernelId || !actionId) {
    return undefined;
  }
  const settings = getBridgeSettingsSnapshot(state);
  const kernels = Array.isArray(settings.kernels) ? settings.kernels : [];
  const kernel = kernels.find((item) => record(item).id === kernelId);
  const rawActions = record(kernel).installActions;
  const actions = Array.isArray(rawActions) ? rawActions : [];
  return actions.map(record).find((action) => action.id === actionId);
}

async function runInstallCommand(command: unknown[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const executable = stringValue(command[0]);
  const args = command.slice(1).map((item) => String(item));
  if (!executable) {
    throw new Error("install_command_missing");
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("install_timed_out"));
    }, INSTALL_TIMEOUT_MS);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = limitOutput(stdout + chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = limitOutput(stderr + chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const exitCode = code ?? 0;
      if (exitCode === 0) {
        resolve({ exitCode, stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `install_failed:${exitCode}`));
    });
  });
}

function limitOutput(value: string): string {
  return value.length > 40_000 ? value.slice(value.length - 40_000) : value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
