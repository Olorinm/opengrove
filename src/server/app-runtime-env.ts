import type { JsonObject } from "../core.js";
import type { BridgeProviderProfile, BridgeState } from "./bridge-types.js";
import { getAllBridgeProviderProfiles, resolveProviderApiKey } from "./provider-profiles.js";
import { resolveMountedAppTarget } from "./mounted-apps.js";

export interface AppRuntimeEnvResolution {
  appId: string;
  env: NodeJS.ProcessEnv;
  injectedEnv: string[];
  missing: AppRuntimeEnvMissing[];
}

export interface AppRuntimeEnvMissing {
  providerId: string;
  env: string[];
  required: boolean;
  reason: "provider-not-found" | "provider-disabled" | "key-not-configured" | "env-not-declared";
}

interface ProviderEnvDeclaration {
  providerId: string;
  envNames: string[];
  required: boolean;
}

export function resolveMountedAppRuntimeEnv(
  state: BridgeState,
  appId: string | undefined,
): AppRuntimeEnvResolution | undefined {
  const requestedAppId = appId?.trim();
  if (!requestedAppId) return undefined;
  const target = resolveMountedAppTarget(state, requestedAppId);
  if (!target) return undefined;
  const declarations = readProviderEnvDeclarations(target.manifest);
  if (declarations.length === 0) {
    return {
      appId: target.id,
      env: {},
      injectedEnv: [],
      missing: [],
    };
  }

  const providers = getAllBridgeProviderProfiles(state.settings.customProviders);
  const env: NodeJS.ProcessEnv = {};
  const injectedEnv: string[] = [];
  const missing: AppRuntimeEnvMissing[] = [];

  for (const declaration of declarations) {
    if (declaration.envNames.length === 0) {
      missing.push({
        providerId: declaration.providerId,
        env: [],
        required: declaration.required,
        reason: "env-not-declared",
      });
      continue;
    }
    const provider = providers.find((profile) => profile.id === declaration.providerId);
    if (!provider) {
      missing.push({
        providerId: declaration.providerId,
        env: declaration.envNames,
        required: declaration.required,
        reason: "provider-not-found",
      });
      continue;
    }
    if (provider.enabled === false) {
      missing.push({
        providerId: declaration.providerId,
        env: declaration.envNames,
        required: declaration.required,
        reason: "provider-disabled",
      });
      continue;
    }
    const apiKey = resolveAppProviderApiKey(provider);
    if (!apiKey) {
      missing.push({
        providerId: declaration.providerId,
        env: declaration.envNames,
        required: declaration.required,
        reason: "key-not-configured",
      });
      continue;
    }
    for (const envName of declaration.envNames) {
      env[envName] = apiKey;
      injectedEnv.push(envName);
    }
  }

  return {
    appId: target.id,
    env,
    injectedEnv: [...new Set(injectedEnv)].sort(),
    missing,
  };
}

function readProviderEnvDeclarations(manifest: JsonObject): ProviderEnvDeclaration[] {
  const runtimeEnv = recordValue(manifest.runtimeEnv);
  const legacyEnv = recordValue(manifest.env);
  return [
    ...providerEnvArray(runtimeEnv.providerKeys),
    ...providerEnvArray(runtimeEnv.providers),
    ...providerEnvArray(legacyEnv.providerKeys),
    ...providerEnvArray(legacyEnv.providers),
  ];
}

function providerEnvArray(value: unknown): ProviderEnvDeclaration[] {
  return Array.isArray(value)
    ? value
        .map(providerEnvDeclaration)
        .filter((item): item is ProviderEnvDeclaration => Boolean(item))
    : [];
}

function providerEnvDeclaration(value: unknown): ProviderEnvDeclaration | undefined {
  const object = recordValue(value);
  const providerId = stringValue(object.providerId) || stringValue(object.id);
  if (!providerId) return undefined;
  return {
    providerId,
    envNames: envNameList(object.env ?? object.apiKeyEnv ?? object.apiKeyEnvs),
    required: object.required === true,
  };
}

function envNameList(value: unknown): string[] {
  if (typeof value === "string") {
    return normalizeEnvNames([value]);
  }
  if (Array.isArray(value)) {
    return normalizeEnvNames(value);
  }
  const object = recordValue(value);
  return normalizeEnvNames([
    ...rawEnvNames(object.apiKey),
    ...rawEnvNames(object.apiKeyEnv),
    ...rawEnvNames(object.apiKeyEnvs),
  ]);
}

function rawEnvNames(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function normalizeEnvNames(values: unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(isEnvironmentVariableName))];
}

function resolveAppProviderApiKey(profile: BridgeProviderProfile): string | undefined {
  if (profile.id === "aws-bedrock-api-key") {
    const configured = resolveProviderApiKey(profile);
    return configured?.startsWith("ABSK") ? configured : providerAliasApiKey(profile.id);
  }
  return resolveProviderApiKey(profile) || providerAliasApiKey(profile.id);
}

function providerAliasApiKey(providerId: string): string | undefined {
  if (providerId === "gemini") {
    return process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || undefined;
  }
  if (providerId === "aws-bedrock-api-key") {
    return process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() || undefined;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isEnvironmentVariableName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
