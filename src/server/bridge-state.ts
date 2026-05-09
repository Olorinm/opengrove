import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createOpenGrove } from "../app/create-opengrove.js";
import { readAppEnv } from "../identity.js";
import type { JsonObject } from "../core.js";
import {
  DEFAULT_KERNEL_NO_PROXY,
  DEFAULT_KERNEL_PROXY_URL,
  kernelProxySummary,
  resolveKernelProxySettings,
} from "../runtime/kernel-proxy.js";
import { createJsonStateStore } from "../storage/json-state-store.js";
import type {
  BridgeKernelProxySettings,
  BridgeSettings,
  BridgeState,
  LocalBridgeServerOptions,
} from "./bridge-types.js";
import {
  DEFAULT_BRIDGE_MODEL_ID,
} from "./bridge-types.js";
import {
  createBridgeKernel,
  getBridgeKernelOptions,
  getProviderHttpCaptureSnapshot,
  isEnabledEnvFlag,
  normalizeBridgeKernelPreference,
} from "./kernel-selection.js";
import {
  getAllBridgeProviderProfiles,
  normalizeCustomProviderProfiles,
  serializeProviderBindings,
} from "./provider-profiles.js";
import {
  applySystemProviderDiscovery,
} from "./system-provider-discovery.js";
import {
  normalizeKernelPathOverrides,
} from "./kernel-paths.js";
import { getBridgeTurnContext } from "./bridge-turn-context.js";
import {
  normalizeWorkspaceRootValue,
  resolveBridgeWorkspaceRoot,
} from "./workspace-root.js";

export function createBridgeState(options: LocalBridgeServerOptions): BridgeState {
  const state: BridgeState = {
    app: undefined as unknown as BridgeState["app"],
    store: createJsonStateStore(options.statePath),
    snapshot: {},
    computerSnapshot: {},
    model: DEFAULT_BRIDGE_MODEL_ID,
    kernel: "codex",
    settings: {
      kernel: "auto",
      workspaceRoot: undefined,
      providerHttpCaptureEnabled: false,
      kernelProxy: defaultKernelProxySettings(),
      kernelPathOverrides: {},
      kernelKnowledgeSourceEnabled: {},
      kernelProviderBindings: {},
      customProviders: [],
    },
    saveCandidateNote: false,
    policyOverrides: [],
  };

  const loadedSettings = loadBridgeSettings(state);
  state.settings = applySystemProviderDiscovery(loadedSettings);
  if (JSON.stringify(state.settings) !== JSON.stringify(loadedSettings)) {
    saveBridgeSettings(state);
  }
  recreateBridgeApp(state);

  return state;
}

export function recreateBridgeApp(state: BridgeState): void {
  const kernel = createBridgeKernel(state);
  const workspaceRoot = resolveBridgeWorkspaceRoot(state.settings);
  state.app = createOpenGrove({
    readPage: () => getBridgeTurnContext()?.snapshot ?? state.snapshot,
    readComputer: () => getBridgeTurnContext()?.computerSnapshot ?? state.computerSnapshot,
    kernel,
    policy: state.policyOverrides,
    sessionId: "browser-bridge",
    userId: "local-user",
    cwd: process.cwd(),
    workspaceRoot,
    includeCodexSkills: state.kernel === "codex",
  });
  state.store.loadInto(state.app);
  state.app.skills.list();
}

export function getBridgeSettingsSnapshot(state: BridgeState): JsonObject {
  return {
    kernel: state.settings.kernel,
    workspaceRoot: resolveBridgeWorkspaceRoot(state.settings),
    workspaceRootConfigured: Boolean(state.settings.workspaceRoot),
    providerSetupVersion: state.settings.providerSetupVersion ?? 0,
    activeKernel: state.kernel,
    kernels: getBridgeKernelOptions(state),
    providers: getAllBridgeProviderProfiles(state.settings.customProviders) as unknown as JsonObject[],
    kernelProviderBindings: state.settings.kernelProviderBindings,
    customProviders: state.settings.customProviders as unknown as JsonObject[],
    kernelPathOverrides: state.settings.kernelPathOverrides as unknown as JsonObject,
    providerBindings: serializeProviderBindings(
      state.settings.kernelProviderBindings,
      state.settings.customProviders,
    ) as unknown as JsonObject[],
    kernelKnowledgeSourceEnabled: state.settings.kernelKnowledgeSourceEnabled,
    kernelProxy: kernelProxySummary(resolveKernelProxySettings(state.settings.kernelProxy, process.env)),
    providerHttpCapture: getProviderHttpCaptureSnapshot(state),
    settingsPath: bridgeSettingsPath(state),
  };
}

export function normalizeBridgeSettingsPatch(input: unknown, base: BridgeSettings): BridgeSettings {
  const object = record(input);
  const source = Object.keys(record(object.settings)).length > 0 ? record(object.settings) : object;
  const providerHttpCapture = record(source.providerHttpCapture);
  return {
    kernel: normalizeBridgeKernelPreference(source.kernel, base.kernel),
    workspaceRoot: normalizeWorkspaceRootValue(source.workspaceRoot, base.workspaceRoot),
    providerSetupVersion: numberOrUndefined(source.providerSetupVersion) ?? base.providerSetupVersion,
    providerHttpCaptureEnabled:
      typeof source.providerHttpCaptureEnabled === "boolean"
        ? source.providerHttpCaptureEnabled
        : Object.keys(providerHttpCapture).length > 0
          ? providerHttpCapture.enabled === true
          : base.providerHttpCaptureEnabled,
    kernelProxy: normalizeKernelProxySettings(source.kernelProxy, base.kernelProxy),
    kernelPathOverrides: normalizeKernelPathOverrides(
      source.kernelPathOverrides,
      base.kernelPathOverrides,
    ),
    kernelKnowledgeSourceEnabled: normalizeKernelSourceSettings(
      source.kernelKnowledgeSourceEnabled,
      base.kernelKnowledgeSourceEnabled,
    ),
    kernelProviderBindings: normalizeKernelProviderBindings(
      source.kernelProviderBindings,
      base.kernelProviderBindings,
    ),
    customProviders: normalizeCustomProviderProfiles(source.customProviders ?? base.customProviders),
  };
}

export function loadBridgeSettings(state: BridgeState): BridgeSettings {
  const defaults = defaultBridgeSettings();
  try {
    const parsed = JSON.parse(readFileSync(bridgeSettingsPath(state), "utf8")) as Record<string, unknown>;
    return {
      kernel: normalizeBridgeKernelPreference(parsed.kernel, defaults.kernel),
      workspaceRoot: normalizeWorkspaceRootValue(parsed.workspaceRoot, defaults.workspaceRoot),
      providerSetupVersion: numberOrUndefined(parsed.providerSetupVersion) ?? defaults.providerSetupVersion,
      providerHttpCaptureEnabled:
        typeof parsed.providerHttpCaptureEnabled === "boolean"
          ? parsed.providerHttpCaptureEnabled
          : defaults.providerHttpCaptureEnabled,
      kernelProxy: normalizeKernelProxySettings(parsed.kernelProxy, defaults.kernelProxy),
      kernelPathOverrides: normalizeKernelPathOverrides(
        parsed.kernelPathOverrides,
        defaults.kernelPathOverrides,
      ),
      kernelKnowledgeSourceEnabled: normalizeKernelSourceSettings(
        parsed.kernelKnowledgeSourceEnabled,
        defaults.kernelKnowledgeSourceEnabled,
      ),
      kernelProviderBindings: normalizeKernelProviderBindings(
        parsed.kernelProviderBindings,
        defaults.kernelProviderBindings,
      ),
      customProviders: normalizeCustomProviderProfiles(parsed.customProviders ?? defaults.customProviders),
    };
  } catch {
    return defaults;
  }
}

export function saveBridgeSettings(state: BridgeState): void {
  const path = bridgeSettingsPath(state);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state.settings, null, 2)}\n`, "utf8");
}

function defaultBridgeSettings(): BridgeSettings {
  return {
    kernel: normalizeBridgeKernelPreference(readAppEnv("KERNEL"), "auto"),
    workspaceRoot: normalizeWorkspaceRootValue(readAppEnv("WORKSPACE_ROOT"), undefined),
    providerSetupVersion: 0,
    providerHttpCaptureEnabled: isEnabledEnvFlag(
      readAppEnv("PROVIDER_CAPTURE_ENABLED") ?? readAppEnv("PROVIDER_HTTP_CAPTURE"),
    ),
    kernelProxy: defaultKernelProxySettings(),
    kernelPathOverrides: {},
    kernelKnowledgeSourceEnabled: {},
    kernelProviderBindings: {},
    customProviders: [],
  };
}

function defaultKernelProxySettings(): BridgeKernelProxySettings {
  return {
    enabled: isEnabledEnvFlag(readAppEnv("KERNEL_PROXY")),
    proxyUrl: readAppEnv("KERNEL_PROXY_URL") || DEFAULT_KERNEL_PROXY_URL,
    noProxy: readAppEnv("KERNEL_PROXY_NO_PROXY") || DEFAULT_KERNEL_NO_PROXY,
    nodeUseEnvProxy: isEnabledEnvFlag(readAppEnv("KERNEL_PROXY_NODE_USE_ENV_PROXY")),
  };
}

function bridgeSettingsPath(state: BridgeState): string {
  const explicit = readAppEnv("BRIDGE_SETTINGS_PATH");
  if (explicit) return resolve(explicit);
  const statePath = "path" in state.store && typeof state.store.path === "string" ? state.store.path : "";
  return statePath ? resolve(dirname(statePath), "bridge-settings.json") : resolve(process.cwd(), "data", "bridge-settings.json");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeKernelSourceSettings(
  input: unknown,
  fallback: Record<string, Record<string, boolean>>,
): Record<string, Record<string, boolean>> {
  if (input === undefined || input === null) {
    return { ...fallback };
  }
  const source = record(input);
  const normalized: Record<string, Record<string, boolean>> = {};
  for (const [kernelId, value] of Object.entries(source)) {
    const sourceRecord = record(value);
    const entries: Record<string, boolean> = {};
    for (const [sourceId, enabled] of Object.entries(sourceRecord)) {
      if (typeof enabled === "boolean") {
        entries[sourceId] = enabled;
      }
    }
    if (Object.keys(entries).length) {
      normalized[kernelId] = entries;
    }
  }
  return normalized;
}

function normalizeKernelProviderBindings(
  input: unknown,
  fallback: Record<string, string>,
): Record<string, string> {
  if (input === undefined || input === null) {
    return { ...fallback };
  }
  const source = record(input);
  const normalized: Record<string, string> = {};
  for (const [kernelId, providerId] of Object.entries(source)) {
    if (typeof providerId === "string" && providerId.trim()) {
      normalized[kernelId] = providerId.trim();
    }
  }
  return normalized;
}

function normalizeKernelProxySettings(
  input: unknown,
  fallback: BridgeKernelProxySettings,
): BridgeKernelProxySettings {
  const source = record(input);
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    proxyUrl: nonEmptyString(source.proxyUrl) ?? fallback.proxyUrl,
    noProxy: nonEmptyString(source.noProxy) ?? fallback.noProxy,
    nodeUseEnvProxy:
      typeof source.nodeUseEnvProxy === "boolean"
        ? source.nodeUseEnvProxy
        : fallback.nodeUseEnvProxy,
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function bridgeSettingsFileExists(state: BridgeState): boolean {
  return existsSync(bridgeSettingsPath(state));
}
