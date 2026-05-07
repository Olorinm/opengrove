import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readAppEnv } from "../../identity.js";

export function resolveCodexCommandPath(): string | undefined {
  const envPath = readAppEnv("CODEX_BIN")?.trim();
  if (envPath) {
    if (envPath.includes("/") && existsSync(envPath)) {
      return envPath;
    }
    if (!envPath.includes("/")) {
      return findOnPath(envPath);
    }
  }
  const candidates = [
    findOnPath("codex"),
    "/Applications/Codex.app/Contents/Resources/codex",
    resolve(homedir(), ".local", "bin", "codex"),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
}

function findOnPath(command: string): string | undefined {
  const paths = process.env.PATH?.split(":") ?? [];
  for (const entry of paths) {
    const candidate = resolve(entry, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
