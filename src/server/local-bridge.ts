import { pathToFileURL } from "node:url";
import { startLocalProfile } from "../profiles/local.js";
import type { LocalBridgeServerOptions } from "./bridge-types.js";

export function startLocalBridgeServer(options: LocalBridgeServerOptions = {}) {
  return startLocalProfile(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startLocalBridgeServer();
}
