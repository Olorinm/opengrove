import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  BridgeKernelId,
  BridgeKernelPathOverride,
  BridgeSettings,
} from "./bridge-types.js";

export function normalizeKernelPathOverrides(
  input: unknown,
  fallback: Record<string, BridgeKernelPathOverride> = {},
): Record<string, BridgeKernelPathOverride> {
  if (input === undefined || input === null) {
    return cloneKernelPathOverrides(fallback);
  }
  const source = record(input);
  const output: Record<string, BridgeKernelPathOverride> = {};
  for (const [kernelId, value] of Object.entries(source)) {
    const item = record(value);
    const override: BridgeKernelPathOverride = {};
    const binaryPath = pathString(item.binaryPath);
    const configHome = pathString(item.configHome);
    if (binaryPath) override.binaryPath = binaryPath;
    if (configHome) override.configHome = configHome;
    if (Object.keys(override).length) {
      output[kernelId] = override;
    }
  }
  return output;
}

export function kernelPathOverride(
  settings: Pick<BridgeSettings, "kernelPathOverrides">,
  kernel: BridgeKernelId,
): BridgeKernelPathOverride {
  return settings.kernelPathOverrides?.[kernel] ?? {};
}

export function kernelBinaryPathOverride(
  settings: Pick<BridgeSettings, "kernelPathOverrides">,
  kernel: BridgeKernelId,
): string | undefined {
  const path = kernelPathOverride(settings, kernel).binaryPath?.trim();
  return path || undefined;
}

export function kernelConfigHome(
  settings: Pick<BridgeSettings, "kernelPathOverrides">,
  kernel: BridgeKernelId,
): string {
  return kernelPathOverride(settings, kernel).configHome?.trim() || defaultKernelConfigHome(kernel);
}

export function kernelPathEnv(
  settings: Pick<BridgeSettings, "kernelPathOverrides">,
  kernel: BridgeKernelId,
): NodeJS.ProcessEnv {
  const configHome = kernelPathOverride(settings, kernel).configHome?.trim();
  if (!configHome) return {};
  if (kernel === "codex") return { CODEX_HOME: configHome };
  if (kernel === "claude-code") return { CLAUDE_CONFIG_DIR: configHome };
  if (kernel === "hermes") return { HERMES_HOME: configHome };
  if (kernel === "copilot") return { COPILOT_HOME: configHome };
  return {};
}

export function defaultKernelConfigHome(kernel: BridgeKernelId): string {
  if (kernel === "codex") return resolve(homedir(), ".codex");
  if (kernel === "claude-code") return resolve(homedir(), ".claude");
  if (kernel === "hermes") return resolve(homedir(), ".hermes");
  if (kernel === "pi") return resolve(homedir(), ".pi");
  if (kernel === "openclaw") return resolve(homedir(), ".openclaw");
  if (kernel === "deepseek-tui") return resolve(homedir(), ".deepseek");
  if (kernel === "gemini-cli") return resolve(homedir(), ".gemini");
  if (kernel === "qwen-code") return resolve(homedir(), ".qwen");
  if (kernel === "opencode") return resolve(homedir(), ".config", "opencode");
  if (kernel === "copilot") return resolve(homedir(), ".copilot");
  if (kernel === "cursor-agent") return resolve(homedir(), ".cursor");
  if (kernel === "kimi") return resolve(homedir(), ".kimi");
  if (kernel === "kiro-cli") return resolve(homedir(), ".kiro");
  return resolve(process.cwd(), "data", "vault");
}

export function isExecutablePath(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const stats = statSync(resolve(value.trim()));
    return stats.isFile();
  } catch {
    return false;
  }
}

export function existingPath(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const path = resolve(value.trim());
  return existsSync(path) ? path : undefined;
}

function cloneKernelPathOverrides(
  value: Record<string, BridgeKernelPathOverride>,
): Record<string, BridgeKernelPathOverride> {
  return Object.fromEntries(
    Object.entries(value).map(([kernelId, override]) => [kernelId, { ...override }]),
  );
}

function pathString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
