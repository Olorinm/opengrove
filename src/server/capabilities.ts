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
  const remote = settings.remote as {
    matrix?: {
      enabled?: unknown;
      homeserverUrl?: unknown;
      userId?: unknown;
      accessToken?: unknown;
    };
  } | undefined;
  const matrix = remote?.matrix;
  const providerCapture = settings.providerHttpCapture as { enabled?: unknown } | undefined;
  const serverProfile = state.profile === "server";
  const testProfile = state.profile === "test";
  const matrixReady = matrix?.enabled === true
    && typeof matrix.homeserverUrl === "string" && matrix.homeserverUrl.trim().length > 0
    && typeof matrix.userId === "string" && matrix.userId.trim().length > 0
    && typeof matrix.accessToken === "string" && matrix.accessToken.trim().length > 0;

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
      matrix: matrixReady,
      inviteLandingPage: typeof inviteLanding?.baseUrl === "string" && inviteLanding.baseUrl.trim().length > 0,
      remoteAgents: matrixReady,
      routines: true,
      providerCapture: providerCapture?.enabled === true,
    },
  };
}
