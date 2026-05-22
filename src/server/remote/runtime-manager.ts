import type { BridgeState } from "../bridge-types.js";
import {
  refreshRoomMatrixSync,
  startRoomMatrixSync,
} from "./matrix/ledger-sync.js";
import { matrixReady } from "./matrix/invites.js";

type RemoteRuntimeController = {
  stopMatrix?: () => void;
};

const remoteRuntimeControllers = new WeakMap<BridgeState, RemoteRuntimeController>();

export function startRemoteRuntime(state: BridgeState): () => void {
  const controller: RemoteRuntimeController = {};
  remoteRuntimeControllers.set(state, controller);
  refreshRemoteRuntime(state);
  return () => {
    stopMatrixRuntime(controller);
    remoteRuntimeControllers.delete(state);
  };
}

export function refreshRemoteRuntime(state: BridgeState): void {
  const controller = remoteRuntimeControllers.get(state);
  if (!controller) return;
  if (matrixReady(state.settings.remote.matrix)) {
    if (controller.stopMatrix) {
      refreshRoomMatrixSync(state);
    } else {
      controller.stopMatrix = startRoomMatrixSync(state);
    }
    return;
  }
  stopMatrixRuntime(controller);
}

function stopMatrixRuntime(controller: RemoteRuntimeController): void {
  if (!controller.stopMatrix) return;
  controller.stopMatrix();
  controller.stopMatrix = undefined;
}
