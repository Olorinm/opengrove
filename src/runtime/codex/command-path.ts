import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readAppEnv } from "../../identity.js";
import { resolveCommandPath } from "../../kernel/discovery.js";

export function resolveCodexCommandPath(): string | undefined {
  const envPath = readAppEnv("CODEX_BIN")?.trim();
  const resolvedEnvPath = resolveCommandPath(envPath);
  if (resolvedEnvPath) return resolvedEnvPath;
  const candidates = [
    resolveCommandPath("codex"),
    "/Applications/Codex.app/Contents/Resources/codex",
    resolve(homedir(), ".local", "bin", "codex"),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}
