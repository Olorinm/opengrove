import type { ServerResponse } from "node:http";
import type { BridgeState } from "./bridge-types.js";
import { sendJson } from "./http-utils.js";

const SERVER_DISABLED_ROUTES = new Set([
  "POST /knowledge/file-system/choose-import-folder",
  "POST /settings/install-kernel",
  "POST /workspace/choose-directory",
]);

export function rejectUnavailableProfileRoute(
  request: { method?: string },
  response: ServerResponse,
  url: URL,
  state: BridgeState,
): boolean {
  if (state.profile !== "server") {
    return false;
  }

  const routeKey = `${request.method ?? "GET"} ${url.pathname}`;
  if (!SERVER_DISABLED_ROUTES.has(routeKey)) {
    return false;
  }

  sendJson(response, 403, {
    ok: false,
    error: "capability_unavailable",
    profile: state.profile,
    route: url.pathname,
  });
  return true;
}
