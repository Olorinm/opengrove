import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getBridgeSettingsSnapshot,
  normalizeBridgeSettingsPatch,
  recreateBridgeApp,
  saveBridgeSettings,
} from "../bridge-state.js";
import type { BridgeState } from "../bridge-types.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

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

  if (request.method !== "PATCH" || url.pathname !== "/settings") {
    return false;
  }

  const previousSettings = state.settings;
  const nextSettings = normalizeBridgeSettingsPatch(await readJsonBody(request), previousSettings);
  const restartRequired =
    nextSettings.kernel !== previousSettings.kernel ||
    nextSettings.providerHttpCaptureEnabled !== previousSettings.providerHttpCaptureEnabled ||
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
