import type { ModelId, RuntimeControls } from "../bridge";
import { MODEL_OPTIONS } from "../bridge";

export type KernelModelOption = { id: string; label: string; description?: string };

export const MODEL_LABELS: Record<string, string> = {
  "claude-code-default": "跟随 Claude Code 配置",
  "pi-default": "跟随 Pi 配置",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2": "GPT-5.2",
  "claude-opus-4-6": "Claude Opus 4.6",
  "MiMo-V2-Pro": "MiMo-V2-Pro",
};

export function runtimeControlsForKernel(
  kernelId: string | undefined,
  activeRuntimeControls: RuntimeControls | undefined,
  controlsByKernel: Record<string, RuntimeControls> | undefined,
): RuntimeControls | undefined {
  if (!kernelId) return undefined;
  return controlsByKernel?.[kernelId] ?? (activeRuntimeControls?.kernel === kernelId ? activeRuntimeControls : undefined);
}

export function modelOptionsForKernel(kernelId?: string, runtimeControls?: RuntimeControls): KernelModelOption[] {
  const controls = runtimeControls?.kernel === kernelId ? runtimeControls : undefined;
  const discovered = controls?.models
    ?.filter((item): item is KernelModelOption => Boolean(item.id.trim()))
    .map((item) => ({ id: item.id, label: item.label, description: item.description }));
  if (discovered?.length) {
    return discovered;
  }
  if (kernelId === "codex") {
    return MODEL_OPTIONS.filter((item) => item.id.startsWith("gpt-"));
  }
  if (kernelId === "claude-code") {
    return [{ id: "claude-code-default", label: MODEL_LABELS["claude-code-default"] }];
  }
  if (kernelId === "pi") {
    return [{ id: "pi-default", label: MODEL_LABELS["pi-default"] }];
  }
  return [...MODEL_OPTIONS];
}

export function modelLabel(option: KernelModelOption): string {
  return MODEL_LABELS[option.id as ModelId] || option.label;
}

export function resolveDefaultModelForKernel(input: {
  kernelId: string;
  activeKernel: string | undefined;
  activeModel: ModelId;
  runtimeControls?: RuntimeControls;
  runtimeControlsByKernel?: Record<string, RuntimeControls>;
  options?: KernelModelOption[];
}): string {
  const controls = runtimeControlsForKernel(input.kernelId, input.runtimeControls, input.runtimeControlsByKernel);
  const options = input.options ?? modelOptionsForKernel(input.kernelId, controls);
  if (input.kernelId === input.activeKernel && options.some((option) => option.id === input.activeModel)) {
    return input.activeModel;
  }
  if (controls?.defaultModel && options.some((option) => option.id === controls.defaultModel)) {
    return controls.defaultModel;
  }
  return options[0]?.id || input.activeModel || "native";
}
