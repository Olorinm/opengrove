import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createOpenGrove } from "../app/create-opengrove.js";
import { readAppEnv } from "../identity.js";
import type { JsonObject } from "../core.js";
import { createJsonStateStore } from "../storage/json-state-store.js";
import type {
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
      providerHttpCaptureEnabled: false,
      kernelKnowledgeSourceEnabled: {},
      kernelProviderBindings: {},
      customProviders: [],
    },
    saveCandidateNote: false,
    policyOverrides: [],
  };

  state.settings = loadBridgeSettings(state);
  recreateBridgeApp(state);

  return state;
}

export function recreateBridgeApp(state: BridgeState): void {
  const kernel = createBridgeKernel(state);
  state.app = createOpenGrove({
    readPage: () => state.snapshot,
    readComputer: () => state.computerSnapshot,
    kernel,
    policy: state.policyOverrides,
    sessionId: "browser-bridge",
    userId: "local-user",
    cwd: process.cwd(),
    includeCodexSkills: state.kernel === "codex",
  });
  state.store.loadInto(state.app);
  state.app.skills.list();
}

export function getBridgeSettingsSnapshot(state: BridgeState): JsonObject {
  return {
    kernel: state.settings.kernel,
    activeKernel: state.kernel,
    kernels: getBridgeKernelOptions(state),
    providers: getAllBridgeProviderProfiles(state.settings.customProviders) as unknown as JsonObject[],
    kernelProviderBindings: state.settings.kernelProviderBindings,
    customProviders: state.settings.customProviders as unknown as JsonObject[],
    providerBindings: serializeProviderBindings(
      state.settings.kernelProviderBindings,
      state.settings.customProviders,
    ) as unknown as JsonObject[],
    kernelKnowledgeSourceEnabled: state.settings.kernelKnowledgeSourceEnabled,
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
    providerHttpCaptureEnabled:
      typeof source.providerHttpCaptureEnabled === "boolean"
        ? source.providerHttpCaptureEnabled
        : Object.keys(providerHttpCapture).length > 0
          ? providerHttpCapture.enabled === true
          : base.providerHttpCaptureEnabled,
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
      providerHttpCaptureEnabled:
        typeof parsed.providerHttpCaptureEnabled === "boolean"
          ? parsed.providerHttpCaptureEnabled
          : defaults.providerHttpCaptureEnabled,
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
    providerHttpCaptureEnabled: isEnabledEnvFlag(
      readAppEnv("PROVIDER_CAPTURE_ENABLED") ?? readAppEnv("PROVIDER_HTTP_CAPTURE"),
    ),
    kernelKnowledgeSourceEnabled: {},
    kernelProviderBindings: {},
    customProviders: [],
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

export function bridgeSettingsFileExists(state: BridgeState): boolean {
  return existsSync(bridgeSettingsPath(state));
}
