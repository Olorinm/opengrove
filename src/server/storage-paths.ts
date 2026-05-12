import { dirname, resolve } from "node:path";
import { readAppEnv } from "../identity.js";
import type { BridgeState } from "./bridge-types.js";

export function bridgeDataDirectory(state: BridgeState): string {
  if (state.store.kind === "json") {
    return dirname(state.store.path);
  }
  return resolve(readAppEnv("DATA_DIR") ?? "data");
}

export function bridgeDataPath(state: BridgeState, ...segments: string[]): string {
  return resolve(bridgeDataDirectory(state), ...segments);
}
