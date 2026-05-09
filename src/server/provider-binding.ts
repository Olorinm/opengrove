import { createHash } from "node:crypto";
import type {
  BridgeKernelId,
  BridgeProviderCredentialKind,
  BridgeProviderProfile,
  BridgeProviderProtocol,
} from "./bridge-types.js";
import {
  getBridgeKernelDescriptor,
  type BridgeKernelBindingMode,
} from "./kernel-registry.js";

export interface BridgeProviderBindingPlan {
  kernelId: BridgeKernelId;
  providerId?: string;
  kind: "native" | "external" | "unsupported";
  supported: boolean;
  protocol?: BridgeProviderProtocol;
  credentialKind: BridgeProviderCredentialKind;
  mode: BridgeKernelBindingMode;
  preserveNativeControls: boolean;
  reason: string;
}

export function planProviderBinding(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile | undefined,
): BridgeProviderBindingPlan {
  const descriptor = getBridgeKernelDescriptor(kernelId);
  if (!profile) {
    return {
      kernelId,
      kind: "native",
      supported: true,
      credentialKind: "kernel-native",
      mode: "native",
      preserveNativeControls: true,
      reason: `${descriptor.label} uses its native provider/login configuration.`,
    };
  }

  const credentialKind = providerCredentialKind(profile);
  if (profile.sourceKernel === kernelId && profile.authConfigured) {
    return {
      kernelId,
      providerId: profile.id,
      kind: "native",
      supported: true,
      protocol: profile.protocol,
      credentialKind,
      mode: "native",
      preserveNativeControls: true,
      reason: `${descriptor.label} can keep using its native provider configuration.`,
    };
  }

  if (kernelId === "codex" && profile.protocol === "native-oauth" && !profile.sourceKernel) {
    return {
      kernelId,
      providerId: profile.id,
      kind: "native",
      supported: true,
      protocol: "native-oauth",
      credentialKind,
      mode: "native",
      preserveNativeControls: true,
      reason: "Codex can use its native account login.",
    };
  }

  const protocol = providerProtocolForKernel(kernelId, profile);
  if (!protocol) {
    return unsupportedPlan(
      kernelId,
      profile,
      credentialKind,
      `${descriptor.label} does not support this provider protocol.`,
    );
  }

  if (!descriptor.externalCredentialKinds.includes(credentialKind)) {
    return unsupportedPlan(
      kernelId,
      profile,
      credentialKind,
      `${descriptor.label} cannot reuse this provider credential type.`,
      protocol,
    );
  }

  if (!providerHasTransferableCredential(profile) && credentialKind !== "aws" && credentialKind !== "google-adc") {
    return unsupportedPlan(
      kernelId,
      profile,
      credentialKind,
      `${descriptor.label} provider binding requires a transferable API key or environment variable.`,
      protocol,
    );
  }

  return {
    kernelId,
    providerId: profile.id,
    kind: "external",
    supported: true,
    protocol,
    credentialKind,
    mode: descriptor.bindingMode,
    preserveNativeControls: false,
    reason: `${descriptor.label} can use this provider through ${protocol}.`,
  };
}

export function providerCredentialKind(profile: BridgeProviderProfile): BridgeProviderCredentialKind {
  if (profile.credentialKind) return profile.credentialKind;
  if (profile.protocol === "native-oauth") return "native-login";
  if (profile.apiKey) return "api-key";
  if (profile.apiKeyEnv) return "env-key";
  if (profile.id.includes("bedrock") || profile.name.toLowerCase().includes("bedrock")) return "aws";
  if (profile.id.includes("vertex") || profile.name.toLowerCase().includes("vertex")) return "google-adc";
  if (profile.authConfigured && profile.sourceKernel) return "kernel-native";
  return "none";
}

export function providerHasTransferableCredential(profile: BridgeProviderProfile): boolean {
  return Boolean(profile.apiKey || profile.apiKeyEnv);
}

export function usesNativeProviderConfig(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile | undefined,
): boolean {
  return planProviderBinding(kernelId, profile).kind === "native";
}

export function providerBindingFingerprint(input: {
  kernelId: BridgeKernelId;
  provider: BridgeProviderProfile | undefined;
  providerModel?: string;
  kernelModel?: string;
  cwd?: string;
  dynamicToolsFingerprint?: string;
}): string {
  const plan = planProviderBinding(input.kernelId, input.provider);
  const descriptor = getBridgeKernelDescriptor(input.kernelId);
  const includeModel = !descriptor.thread.reuseAcrossModelChanges;
  return shortHash(stableJson({
    kernelId: input.kernelId,
    kind: plan.kind,
    providerId: input.provider?.id ?? "native",
    sourceKernel: input.provider?.sourceKernel,
    protocol: plan.protocol,
    credentialKind: plan.credentialKind,
    openaiBaseUrl: input.provider?.openaiBaseUrl,
    anthropicBaseUrl: input.provider?.anthropicBaseUrl,
    geminiBaseUrl: input.provider?.geminiBaseUrl,
    providerModel: includeModel ? input.providerModel : undefined,
    kernelModel: includeModel ? input.kernelModel : undefined,
    cwd: input.cwd,
    dynamicToolsFingerprint: input.dynamicToolsFingerprint,
  }));
}

function providerProtocolForKernel(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile,
): BridgeProviderProtocol | undefined {
  const descriptor = getBridgeKernelDescriptor(kernelId);
  for (const protocol of descriptor.externalProtocols) {
    if (providerHasProtocolUrl(profile, protocol)) {
      return protocol;
    }
  }
  return undefined;
}

function providerHasProtocolUrl(profile: BridgeProviderProfile, protocol: BridgeProviderProtocol): boolean {
  if (protocol === "openai-compatible") return Boolean(profile.openaiBaseUrl);
  if (protocol === "anthropic-compatible") return Boolean(profile.anthropicBaseUrl);
  if (protocol === "gemini-compatible") return Boolean(profile.geminiBaseUrl);
  if (protocol === "native-oauth") return profile.protocol === "native-oauth";
  return false;
}

function unsupportedPlan(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile,
  credentialKind: BridgeProviderCredentialKind,
  reason: string,
  protocol?: BridgeProviderProtocol,
): BridgeProviderBindingPlan {
  return {
    kernelId,
    providerId: profile.id,
    kind: "unsupported",
    supported: false,
    protocol,
    credentialKind,
    mode: getBridgeKernelDescriptor(kernelId).bindingMode,
    preserveNativeControls: false,
    reason,
  };
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
