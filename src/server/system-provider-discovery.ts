import type {
  BridgeProviderProfile,
  BridgeSettings,
} from "./bridge-types.js";
import { BRIDGE_KERNEL_IDS } from "./bridge-types.js";
import { getAllBridgeProviderProfiles } from "./provider-profiles.js";
import {
  kernelConfigHome,
} from "./kernel-paths.js";
import {
  type KernelNativeProviderProfile,
  readKernelNativeProviderProfile,
} from "./kernel-native-profiles.js";

export const CURRENT_PROVIDER_SETUP_VERSION = 2;

export function applySystemProviderDiscovery(settings: BridgeSettings): BridgeSettings {
  const next: BridgeSettings = {
    ...settings,
    providerSetupVersion: CURRENT_PROVIDER_SETUP_VERSION,
    kernelProviderBindings: { ...settings.kernelProviderBindings },
    customProviders: [...settings.customProviders],
  };

  for (const kernel of BRIDGE_KERNEL_IDS) {
    const nativeProfile = readKernelNativeProviderProfile(kernel, {
      configHome: kernelConfigHome(next, kernel),
    });
    const discovered = providerProfileFromNativeProfile(nativeProfile);
    if (!discovered || isDeletedProvider(next.customProviders, discovered.id)) {
      continue;
    }

    next.customProviders = upsertDiscoveredProvider(next.customProviders, discovered);
    next.customProviders = removeStaleDiscoveredAliases(next.customProviders, discovered);
  }

  const profiles = getAllBridgeProviderProfiles(next.customProviders);
  for (const [kernel, providerId] of Object.entries(next.kernelProviderBindings)) {
    const provider = profiles.find((item) => item.id === providerId);
    if (provider?.sourceKernel === kernel && provider.authConfigured) {
      delete next.kernelProviderBindings[kernel];
    }
  }

  return next;
}

function providerProfileFromNativeProfile(
  profile: KernelNativeProviderProfile | undefined,
): BridgeProviderProfile | undefined {
  if (!profile || !shouldMaterializeNativeProfile(profile)) return undefined;
  if (profile.kernel === "codex") return codexProviderFromNativeProfile(profile);
  if (profile.kernel === "claude-code") return claudeProviderFromNativeProfile(profile);
  if (profile.kernel === "gemini-cli") return geminiProviderFromNativeProfile(profile);
  return genericProviderFromNativeProfile(profile);
}

function shouldMaterializeNativeProfile(profile: KernelNativeProviderProfile): boolean {
  return Boolean(profile.authConfigured || profile.baseUrl || profile.models.length);
}

function codexProviderFromNativeProfile(profile: KernelNativeProviderProfile): BridgeProviderProfile {
  const id = profile.baseUrl ? slug(profile.providerId || "codex-provider") : "openai";
  return {
    id,
    name: profile.providerLabel || (id === "openai" ? "OpenAI" : id),
    custom: true,
    origin: "discovered",
    sourceKernel: profile.kernel,
    source: profile.source,
    sourcePaths: profile.sourcePaths,
    authConfigured: profile.authConfigured,
    protocol: id === "openai" && !profile.baseUrl ? "native-oauth" : "openai-compatible",
    openaiBaseUrl: profile.baseUrl,
    apiKeyEnv: profile.apiKeyEnv,
    credentialKind: profile.apiKeyEnv ? "env-key" : id === "openai" && !profile.baseUrl ? "native-login" : "kernel-native",
    models: profile.models,
    recommendedFor: ["codex", "pi", "opencode"],
  };
}

function claudeProviderFromNativeProfile(profile: KernelNativeProviderProfile): BridgeProviderProfile {
  const id = slug(profile.providerId || "anthropic");
  return {
    id,
    name: profile.providerLabel || (id === "anthropic" ? "Anthropic" : id),
    custom: true,
    origin: "discovered",
    sourceKernel: profile.kernel,
    source: profile.source,
    sourcePaths: profile.sourcePaths,
    authConfigured: profile.authConfigured,
    protocol: "anthropic-compatible",
    anthropicBaseUrl: profile.baseUrl || (id === "anthropic" ? "https://api.anthropic.com" : undefined),
    apiKeyEnv: profile.apiKeyEnv,
    credentialKind: claudeCredentialKind(id, profile.apiKeyEnv),
    models: profile.models,
    recommendedFor: ["claude-code", "hermes"],
  };
}

function geminiProviderFromNativeProfile(profile: KernelNativeProviderProfile): BridgeProviderProfile {
  return {
    id: slug(profile.providerId || "gemini"),
    name: profile.providerLabel || (profile.kernel === "gemini-cli"
      ? "Google Gemini (Gemini CLI)"
      : "Google Gemini"),
    custom: true,
    origin: "discovered",
    sourceKernel: profile.kernel,
    source: profile.source,
    sourcePaths: profile.sourcePaths,
    authConfigured: profile.authConfigured,
    protocol: "gemini-compatible",
    geminiBaseUrl: profile.baseUrl,
    apiKeyEnv: profile.apiKeyEnv,
    credentialKind: profile.apiKeyEnv ? "env-key" : "kernel-native",
    models: profile.models,
    recommendedFor: ["gemini-cli", "pi"],
  };
}

function genericProviderFromNativeProfile(profile: KernelNativeProviderProfile): BridgeProviderProfile {
  return {
    id: slug(profile.providerId || `${profile.kernel}-native`),
    name: profile.providerLabel || profile.kernel,
    custom: true,
    origin: "discovered",
    sourceKernel: profile.kernel,
    source: profile.source,
    sourcePaths: profile.sourcePaths,
    authConfigured: profile.authConfigured,
    protocol: profile.protocol || "openai-compatible",
    openaiBaseUrl: profile.protocol === "anthropic-compatible" ? undefined : profile.baseUrl,
    anthropicBaseUrl: profile.protocol === "anthropic-compatible" ? profile.baseUrl : undefined,
    geminiBaseUrl: profile.protocol === "gemini-compatible" ? profile.baseUrl : undefined,
    apiKeyEnv: profile.apiKeyEnv,
    credentialKind: profile.apiKeyEnv ? "env-key" : "kernel-native",
    models: profile.models,
    recommendedFor: [profile.kernel],
  };
}

function claudeCredentialKind(id: string, apiKeyEnv: string | undefined): BridgeProviderProfile["credentialKind"] {
  if (id.includes("bedrock")) return "aws";
  if (id.includes("vertex")) return "google-adc";
  return apiKeyEnv ? "env-key" : "kernel-native";
}

function upsertDiscoveredProvider(
  current: BridgeProviderProfile[],
  discovered: BridgeProviderProfile,
): BridgeProviderProfile[] {
  const index = current.findIndex((item) => item.id === discovered.id);
  if (index < 0) return [...current, discovered];

  const existing = current[index];
  if (existing.origin && existing.origin !== "discovered" && !canRefreshStaleNativeProvider(existing, discovered)) {
    return current;
  }
  if (!existing.origin && existing.custom && !existing.sourceKernel) {
    return current;
  }

  const next = [...current];
  next[index] = {
    ...existing,
    ...withoutUndefined(discovered),
    custom: true,
    deleted: false,
    origin: "discovered",
  };
  return next;
}

function canRefreshStaleNativeProvider(
  existing: BridgeProviderProfile,
  discovered: BridgeProviderProfile,
): boolean {
  if (existing.id !== discovered.id) return false;
  if (existing.sourceKernel || discovered.sourceKernel) return true;
  return existing.custom === true && existing.id.endsWith("-native");
}

function removeStaleDiscoveredAliases(
  current: BridgeProviderProfile[],
  discovered: BridgeProviderProfile,
): BridgeProviderProfile[] {
  if (discovered.id !== "gemini-cli-native" || discovered.sourceKernel !== "gemini-cli") {
    return current;
  }
  return current.filter((provider) => {
    if (provider.id !== "gemini") return true;
    if (provider.sourceKernel !== "gemini-cli") return true;
    if (provider.apiKey?.trim()) return true;
    return false;
  });
}

function isDeletedProvider(providers: BridgeProviderProfile[], providerId: string): boolean {
  return providers.some((provider) => provider.id === providerId && provider.deleted);
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
