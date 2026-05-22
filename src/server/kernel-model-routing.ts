import type {
  BridgeKernelId,
  BridgeProviderProfile,
  BridgeRuntimeControlOption,
} from "./bridge-types.js";
import { opencodeModelIdForProvider, opencodeSupportsProvider } from "./opencode-provider-config.js";
import { usesNativeProviderConfig } from "./provider-binding.js";

export type KernelModelAliasMap = Record<string, string>;

export function kernelModelAliasesForProvider(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile | undefined,
): KernelModelAliasMap {
  if (usesNativeProviderConfig(kernelId, profile)) return {};
  if (!profile) return {};

  if (kernelId === "claude-code") {
    return Object.fromEntries(
      profile.models
        .map((model) => [model.id, claudeCodeFamilyAliasForProviderModel(model)] as const)
        .filter(([id]) => Boolean(id.trim())),
    );
  }

  return {};
}

export function kernelModelForProviderSelection(
  kernelId: BridgeKernelId,
  profile: BridgeProviderProfile | undefined,
  selectedModel: string | undefined,
): string | undefined {
  const model = selectedModel?.trim();
  if (!model) return undefined;
  const alias = resolveKernelModelAlias(model, kernelModelAliasesForProvider(kernelId, profile));
  if (alias) return alias;
  if (
    kernelId === "opencode" &&
    profile &&
    opencodeSupportsProvider(profile) &&
    !usesNativeProviderConfig(kernelId, profile)
  ) {
    return opencodeModelIdForProvider(profile.id, model);
  }
  return model;
}

function resolveKernelModelAlias(
  model: string,
  aliases: KernelModelAliasMap,
): string | undefined {
  const direct = aliases[model];
  if (direct) return direct;
  const normalized = model.toLowerCase();
  return Object.entries(aliases).find(([key]) => key.toLowerCase() === normalized)?.[1];
}

function claudeCodeFamilyAliasForProviderModel(model: BridgeRuntimeControlOption): "opus" | "sonnet" | "haiku" {
  const text = `${model.id} ${model.label} ${model.description ?? ""}`.toLowerCase();
  if (text.includes("haiku")) return "haiku";
  if (text.includes("sonnet")) return "sonnet";
  if (text.includes("opus")) return "opus";
  return "opus";
}
