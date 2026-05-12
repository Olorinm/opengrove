import type { BridgeState } from "./bridge-types.js";
import { getBridgeSettingsSnapshot } from "./bridge-state.js";

export type BridgeProfileId = "local" | "server" | "test";

export interface BridgeCapabilitiesSnapshot {
  profile: BridgeProfileId;
  auth: "bridge-token" | "session" | "test";
  multiUser: boolean;
  storage: "json" | "postgres" | "memory";
  blobStorage: "filesystem" | "s3-compatible" | "memory";
  kernelRuntime: "local-process" | "queue-worker" | "fake";
  workspaceScoped: boolean;
  approvals: boolean;
  api: {
    prefix: "/api";
    legacyPaths: boolean;
    streamFormat: "ndjson";
  };
  desktop: {
    directoryPicker: boolean;
    importFolderPicker: boolean;
    nativeKnowledgeRoots: boolean;
    installKernel: boolean;
  };
  features: {
    rooms: boolean;
    matrix: boolean;
    inviteLandingPage: boolean;
    remoteAgents: boolean;
    routines: boolean;
    providerCapture: boolean;
  };
}

export function getBridgeCapabilitiesSnapshot(state: BridgeState): BridgeCapabilitiesSnapshot {
  const settings = getBridgeSettingsSnapshot(state);
  const inviteLanding = settings.inviteLanding as { baseUrl?: unknown } | undefined;
  const matrix = settings.matrix as { enabled?: unknown } | undefined;
  const providerCapture = settings.providerHttpCapture as { enabled?: unknown } | undefined;
  const serverProfile = state.profile === "server";
  const testProfile = state.profile === "test";

  return {
    profile: state.profile,
    auth: testProfile ? "test" : "bridge-token",
    multiUser: false,
    storage: state.store.kind,
    blobStorage: testProfile ? "memory" : "filesystem",
    kernelRuntime: testProfile ? "fake" : "local-process",
    workspaceScoped: serverProfile,
    approvals: true,
    api: {
      prefix: "/api",
      legacyPaths: true,
      streamFormat: "ndjson",
    },
    desktop: {
      directoryPicker: !serverProfile && process.platform === "darwin",
      importFolderPicker: !serverProfile && process.platform === "darwin",
      nativeKnowledgeRoots: !serverProfile,
      installKernel: !serverProfile,
    },
    features: {
      rooms: true,
      matrix: matrix?.enabled === true,
      inviteLandingPage: typeof inviteLanding?.baseUrl === "string" && inviteLanding.baseUrl.trim().length > 0,
      remoteAgents: true,
      routines: true,
      providerCapture: providerCapture?.enabled === true,
    },
  };
}
