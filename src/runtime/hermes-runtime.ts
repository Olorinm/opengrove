import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readAppEnv } from "../identity.js";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
} from "../core.js";
import {
  applyProviderHttpCaptureEnv,
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "./provider-http-capture.js";

export interface HermesRuntimeOptions {
  command: string;
  commandArgs?: string[];
  cwd?: string;
  configuredModel?: string;
  configuredProvider?: string;
  toolsets?: string[];
  nativeSkillDir?: string;
  providerHttpCapture?: ProviderHttpCaptureOptions;
  env?: NodeJS.ProcessEnv;
}

export class HermesRuntime implements AgentRuntime {
  private isolatedHome?: string;

  constructor(private readonly options: HermesRuntimeOptions) {}

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const runId = request.runId ?? `run_${Date.now()}`;
    const hermesSessionId = toStableHermesSessionId(request.context.sessionId);
    const requestedModel =
      normalizeOptionalString(request.requestedModelId) ??
      normalizeOptionalString(this.options.configuredModel);
    const requestedProvider = normalizeOptionalString(this.options.configuredProvider);
    const prompt = buildHermesPrompt(request);
    const providerCapture = resolveProviderHttpCaptureOptions(
      this.options.providerHttpCapture,
      this.options.env,
    );
    const sessionTrace: AgentSessionTrace = {
      provider: "hermes",
      sessionId: hermesSessionId,
      persistent: false,
      priorMessageCount: 0,
      priorMessages: [],
    };

    yield { type: "turn.started", runId, at: new Date().toISOString() };
    if (request.assembledContext) {
      yield { type: "context.assembled", runId, context: request.assembledContext };
    }
    yield {
      type: "runtime.diagnostic",
      runId,
      at: new Date().toISOString(),
      name: "provider_http_capture.configured",
      data: providerHttpCaptureSummary(providerCapture),
    };
    yield {
      type: "model.requested",
      runId,
      request: {
        systemPrompt: "Hermes oneshot mode. OpenGrove host context is prepended to the user prompt when present.",
        userInput: request.input,
        modelId: requestedModel,
        session: sessionTrace,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills: request.skills ?? [],
        packs: request.packs ?? [],
        capabilities: request.capabilities ?? [],
      },
    };

    const args = buildHermesArgs({
      prompt,
      model: requestedModel,
      provider: requestedProvider,
      toolsets: this.options.toolsets,
    });
    const env = this.prepareEnv(providerCapture);
    const cwd = this.options.cwd ?? process.cwd();
    const child = spawn(this.options.command, [...(this.options.commandArgs ?? []), ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let aborted = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const abortChild = () => {
      aborted = true;
      if (!child.killed) {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 2_000);
      }
    };
    if (request.signal?.aborted) {
      abortChild();
    } else {
      request.signal?.addEventListener("abort", abortChild, { once: true });
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    let spawnError: Error | undefined;
    const exitCode = await new Promise<number | null>((resolveExit) => {
      child.once("error", (error) => {
        spawnError = error;
        resolveExit(null);
      });
      child.once("close", resolveExit);
    });
    request.signal?.removeEventListener("abort", abortChild);
    if (killTimer) clearTimeout(killTimer);
    if (aborted) {
      yield {
        type: "error",
        runId,
        message: "hermes_aborted",
      };
      return;
    }
    const finalText = stdout.trimEnd();
    if (finalText) {
      yield { type: "assistant.delta", runId, text: finalText };
    }
    if (spawnError || (exitCode && exitCode !== 0)) {
      yield {
        type: "error",
        runId,
        message: spawnError?.message || stderr.trim() || `hermes_failed:${exitCode}`,
      };
    }
    yield {
      type: "model.response",
      runId,
      response: { text: finalText },
    };
    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }

  private prepareEnv(providerCapture: ReturnType<typeof resolveProviderHttpCaptureOptions>): NodeJS.ProcessEnv {
    const env = applyProviderHttpCaptureEnv({ ...process.env, ...this.options.env }, providerCapture);
    const explicitHome = normalizeOptionalString(readAppEnv("HERMES_HOME"));
    if (explicitHome) {
      env.HERMES_HOME = resolve(explicitHome);
      return env;
    }

    const useIsolatedHome = readAppEnv("HERMES_ISOLATED_HOME") !== "0";
    if (!useIsolatedHome) {
      return env;
    }

    const nativeSkillDir = normalizeOptionalString(this.options.nativeSkillDir);
    if (!nativeSkillDir || !existsSync(nativeSkillDir)) {
      return env;
    }

    const home = this.ensureIsolatedHome(nativeSkillDir);
    env.HERMES_HOME = home;
    return env;
  }

  private ensureIsolatedHome(nativeSkillDir: string): string {
    if (!this.isolatedHome) {
      this.isolatedHome = mkdtempSync(join(tmpdir(), "opengrove-hermes-"));
      writeHermesHomeConfig(this.isolatedHome, nativeSkillDir);
    }
    return this.isolatedHome;
  }
}

export function resolveHermesCommandPath(): string | undefined {
  const envPath = readAppEnv("HERMES_BIN")?.trim();
  const resolvedEnvPath = resolveHermesCommandCandidate(envPath);
  if (resolvedEnvPath) {
    return resolvedEnvPath;
  }

  const systemHermes = resolveHermesCommandCandidate("hermes");
  if (systemHermes) {
    return systemHermes;
  }

  for (const candidate of ["/opt/homebrew/bin/hermes", "/usr/local/bin/hermes", "/usr/bin/hermes"]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function hermesHealth(command: string): { ok: boolean; message: string } {
  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    });
    if (result.status === 0) {
      const version = (result.stdout || result.stderr || "").trim();
      return { ok: true, message: version || "Hermes CLI is available." };
    }
    return {
      ok: false,
      message: (result.stderr || result.stdout || "").trim() || `Hermes CLI exited with ${result.status}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function buildHermesArgs(input: {
  prompt: string;
  model?: string;
  provider?: string;
  toolsets?: string[];
}): string[] {
  const args: string[] = [];
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.provider) {
    args.push("--provider", input.provider);
  }
  if (input.toolsets?.length) {
    args.push("--toolsets", input.toolsets.join(","));
  }
  args.push("-z", input.prompt);
  return args;
}

function buildHermesPrompt(request: AgentTurnRequest): string {
  const hostContext = request.assembledContext?.promptBlock?.trim();
  const skillHint = request.requestedSkillInvocation
    ? [
        `The user invoked OpenGrove skill /${request.requestedSkillInvocation.skillName}.`,
        "Hermes should use its native skills_list / skill_view mechanism when the skill is available there.",
      ].join(" ")
    : "";
  const sections = [
    "You are running inside the OpenGrove host.",
    hostContext ? `Host context:\n${hostContext}` : "",
    skillHint,
    `User request:\n${request.input}`,
  ].filter(Boolean);
  return sections.join("\n\n");
}

function writeHermesHomeConfig(homeDir: string, nativeSkillDir: string): void {
  mkdirSync(homeDir, { recursive: true });
  const sourceEnv = resolve(homedir(), ".hermes", ".env");
  if (existsSync(sourceEnv)) {
    try {
      copyFileSync(sourceEnv, resolve(homeDir, ".env"));
    } catch {
      // Ignore copy failures; Hermes can still use process env credentials.
    }
  }
  const normalizedSkillDir = resolve(nativeSkillDir);
  writeFileSync(
    resolve(homeDir, "config.yaml"),
    [
      "skills:",
      "  external_dirs:",
      `    - ${JSON.stringify(normalizedSkillDir)}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function resolveHermesCommandCandidate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("/")) {
    const resolved = resolve(trimmed);
    return existsSync(resolved) ? resolved : undefined;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    return undefined;
  }

  const result = spawnSync("sh", ["-lc", `command -v ${trimmed}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const path = result.stdout?.trim();
  return path && existsSync(path) ? path : undefined;
}

function toStableHermesSessionId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 24);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
