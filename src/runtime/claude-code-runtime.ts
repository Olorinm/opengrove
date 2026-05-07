import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAppEnv } from "../identity.js";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
  JsonObject,
  JsonValue,
  ToolResult,
} from "../core.js";
import {
  createClaudeCodeStreamCaptureRecorder,
  type ClaudeCodeStreamCaptureOptions,
} from "./claude-code-stream-capture.js";
import {
  applyProviderHttpCaptureEnv,
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
  type ResolvedProviderHttpCaptureOptions,
} from "./provider-http-capture.js";

export interface ClaudeCodeRuntimeOptions {
  cliPath: string;
  cliKind?: "node-script" | "native-executable";
  cwd?: string;
  nodePath?: string;
  permissionMode?: "acceptEdits" | "bypassPermissions" | "default" | "dontAsk" | "plan" | "auto";
  configuredBaseUrl?: string;
  configuredAuthToken?: string;
  configuredModel?: string;
  streamCapture?: ClaudeCodeStreamCaptureOptions;
  providerHttpCapture?: ProviderHttpCaptureOptions;
  env?: NodeJS.ProcessEnv;
}

type ClaudeStreamEvent = JsonObject;

interface ClaudeToolCallRecord {
  toolId: string;
  input: JsonValue;
}

export class ClaudeCodeRuntime implements AgentRuntime {
  private isolatedHome?: string;

  constructor(private readonly options: ClaudeCodeRuntimeOptions) {}

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const runId = request.runId ?? `run_${Date.now()}`;
    const claudeSessionId = toStableClaudeSessionId(request.context.sessionId);
    const requestedModel =
      normalizeClaudeModelId(request.requestedModelId) ??
      normalizeClaudeModelId(this.options.configuredModel);
    const systemPrompt = buildClaudeSystemPrompt(request);
    const capture = createClaudeCodeStreamCaptureRecorder(this.options.streamCapture);
    const providerCapture = resolveProviderHttpCaptureOptions(
      this.options.providerHttpCapture,
      this.options.env,
    );
    const sessionTrace: AgentSessionTrace = {
      provider: "claude-code",
      sessionId: claudeSessionId,
      persistent: true,
      priorMessageCount: 0,
      priorMessages: [],
    };
    capture?.recordLifecycle("turn.started", {
      runId,
      sessionId: claudeSessionId,
      model: requestedModel,
      cwd: this.options.cwd ?? process.cwd(),
      permissionMode: this.options.permissionMode ?? "bypassPermissions",
    });
    capture?.recordTurnInput({
      runId,
      sessionId: claudeSessionId,
      model: requestedModel,
      userInput: request.input,
      appendSystemPrompt: systemPrompt,
    });
    capture?.recordLifecycle("provider_http_capture.configured", providerHttpCaptureSummary(providerCapture));

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
        systemPrompt,
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

    const launch = this.prepareLaunchConfig(requestedModel, providerCapture);
    const launchCommand = resolveClaudeLaunchCommand(this.options);
    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      this.options.permissionMode ?? "bypassPermissions",
      "--session-id",
      claudeSessionId,
    ];

    if (requestedModel) {
      args.push("--model", requestedModel);
    }
    if (systemPrompt) {
      args.push("--append-system-prompt", systemPrompt);
    }
    args.push(request.input);
    const cwd = this.options.cwd ?? process.cwd();
    capture?.recordProcessLaunch({
      executable: launchCommand.executable,
      argv: [...launchCommand.prefixArgs, ...args],
      cwd,
      model: requestedModel,
      sessionId: claudeSessionId,
      runId,
    });

    const child = spawn(launchCommand.executable, [...launchCommand.prefixArgs, ...args], {
      cwd,
      env: launch.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    capture?.recordLifecycle("process.spawned", {
      runId,
      sessionId: claudeSessionId,
      pid: child.pid,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let assistantText = "";
    let resultText = "";
    let resultIsError = false;
    const toolCalls = new Map<string, ClaudeToolCallRecord>();
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk;
      capture?.recordStderr(chunk);
    });

    if (!child.stdout) {
      throw new Error("claude_code_stdout_unavailable");
    }

    child.stdout.setEncoding("utf8");
    for await (const chunk of child.stdout) {
      stdoutBuffer += chunk;
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf("\n");
        if (!line) {
          continue;
        }
        const parsed = parseClaudeStreamEvent(line);
        if (!parsed) {
          capture?.recordParseError(line);
          continue;
        }
        capture?.recordStdoutEvent(line, parsed);

        const mappedEvents = mapClaudeStreamEvent(parsed, {
          runId,
          toolCalls,
          onAssistantText(text) {
            assistantText += text;
          },
          onResult(value, isError) {
            resultText = value;
            resultIsError = isError;
          },
        });
        capture?.recordMappedEvents(mappedEvents);
        for (const event of mappedEvents) {
          yield event;
        }
      }
    }

    const exitCode = await new Promise<number | null>((resolveExit) => {
      child.once("close", resolveExit);
    });
    capture?.recordLifecycle("process.closed", {
      runId,
      sessionId: claudeSessionId,
      exitCode,
      stderrBytes: Buffer.byteLength(stderrBuffer, "utf8"),
    });

    if (stdoutBuffer.trim()) {
      const tailLine = stdoutBuffer.trim();
      const parsed = parseClaudeStreamEvent(tailLine);
      if (parsed) {
        capture?.recordStdoutEvent(tailLine, parsed);
        const mappedEvents = mapClaudeStreamEvent(parsed, {
          runId,
          toolCalls,
          onAssistantText(text) {
            assistantText += text;
          },
          onResult(value, isError) {
            resultText = value;
            resultIsError = isError;
          },
        });
        capture?.recordMappedEvents(mappedEvents);
        for (const event of mappedEvents) {
          yield event;
        }
      } else {
        capture?.recordParseError(tailLine);
      }
    }

    const finalText = resultText || assistantText;
    if (resultIsError) {
      yield {
        type: "error",
        runId,
        message: finalText || stderrBuffer.trim() || `claude_code_failed:${exitCode ?? "unknown"}`,
      };
    } else if (exitCode && exitCode !== 0) {
      yield {
        type: "error",
        runId,
        message: stderrBuffer.trim() || `claude_code_failed:${exitCode}`,
      };
    }

    yield {
      type: "model.response",
      runId,
      response: { text: finalText },
    };
    capture?.recordLifecycle("turn.finished", {
      runId,
      sessionId: claudeSessionId,
      resultIsError,
      exitCode,
      finalTextBytes: Buffer.byteLength(finalText, "utf8"),
    });
    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }

  private prepareLaunchConfig(
    requestedModel: string | undefined,
    providerCapture: ResolvedProviderHttpCaptureOptions,
  ): { env: NodeJS.ProcessEnv } {
    const configuredBaseUrl = this.options.configuredBaseUrl?.trim() || "";
    const configuredAuthToken = this.options.configuredAuthToken?.trim() || "";
    const configuredModel = normalizeClaudeModelId(requestedModel ?? this.options.configuredModel);
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.options.env };

    if (!configuredBaseUrl && !configuredAuthToken) {
      return { env: applyProviderHttpCaptureEnv(env, providerCapture) };
    }

    const home = this.ensureIsolatedHome();
    writeClaudeConfig(home, {
      baseUrl: configuredBaseUrl,
      authToken: configuredAuthToken,
      model: configuredModel,
    });

    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_MODEL;
    delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    env.HOME = home;
    return { env: applyProviderHttpCaptureEnv(env, providerCapture) };
  }

  private ensureIsolatedHome(): string {
    if (!this.isolatedHome) {
      this.isolatedHome = mkdtempSync(join(tmpdir(), "opengrove-claude-"));
    }
    return this.isolatedHome;
  }
}

function parseClaudeStreamEvent(line: string): ClaudeStreamEvent | undefined {
  try {
    const parsed = JSON.parse(line);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function mapClaudeStreamEvent(
  event: ClaudeStreamEvent,
  options: {
    runId: string;
    toolCalls: Map<string, ClaudeToolCallRecord>;
    onAssistantText(text: string): void;
    onResult(text: string, isError: boolean): void;
  },
): AgentEvent[] {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "assistant") {
    const message = isJsonObject(event.message) ? event.message : undefined;
    const content = Array.isArray(message?.content) ? message?.content : [];
    const events: AgentEvent[] = [];

    for (const block of content) {
      if (!isJsonObject(block)) {
        continue;
      }
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        options.onAssistantText(block.text);
        events.push({ type: "assistant.delta", runId: options.runId, text: block.text });
      }
      if (block.type === "tool_use") {
        const callId = typeof block.id === "string" ? block.id : "";
        const toolName = typeof block.name === "string" ? block.name : "Tool";
        const toolId = `claude.${toolName}`;
        const input = asJsonValue(block.input);
        if (callId) {
          options.toolCalls.set(callId, { toolId, input });
        }
        events.push({
          type: "tool.started",
          runId: options.runId,
          toolId,
          input,
        });
      }
    }

    return events;
  }

  if (type === "user") {
    const message = isJsonObject(event.message) ? event.message : undefined;
    const content = Array.isArray(message?.content) ? message?.content : [];
    const events: AgentEvent[] = [];

    for (const block of content) {
      if (!isJsonObject(block) || block.type !== "tool_result") {
        continue;
      }
      const callId = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
      const call = options.toolCalls.get(callId);
      events.push({
        type: "tool.finished",
        runId: options.runId,
        toolId: call?.toolId ?? "claude.tool",
        result: normalizeClaudeToolResult(block, event.tool_use_result),
      });
    }

    return events;
  }

  if (type === "result") {
    const text = typeof event.result === "string" ? event.result : "";
    const isError = event.is_error === true;
    options.onResult(text, isError);
  }

  return [];
}

function normalizeClaudeToolResult(
  block: JsonObject,
  toolUseResult: unknown,
): ToolResult {
  const isError = block.is_error === true;
  const rawValue = toolUseResult ?? block.content;
  const value = asJsonValue(rawValue);
  if (isError) {
    return {
      ok: false,
      error:
        typeof value === "string"
          ? value
          : isJsonObject(value) && typeof value.text === "string"
            ? value.text
            : "claude_tool_error",
      value: value === null ? undefined : value,
    };
  }
  return {
    ok: true,
    value: value === null ? undefined : value,
  };
}

function buildClaudeSystemPrompt(request: AgentTurnRequest): string {
  const sections = [
    "You are running inside the OpenGrove host.",
    "Use Claude Code built-in tools for workspace operations.",
    request.assembledContext?.promptBlock?.trim()
      ? `Host context:\n${request.assembledContext.promptBlock.trim()}`
      : "",
    request.requestedSkillInvocation
      ? [
          `Loaded host skill /${request.requestedSkillInvocation.skillName}:`,
          request.requestedSkillInvocation.content,
          request.requestedSkillInvocation.allowedTools.length
            ? `Host-declared tool scope for this skill: ${request.requestedSkillInvocation.allowedTools.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

function writeClaudeConfig(
  homeDir: string,
  config: { baseUrl?: string; authToken?: string; model?: string },
) {
  const claudeDir = resolve(homeDir, ".claude");
  mkdirSync(claudeDir, { recursive: true });

  const env: Record<string, string> = {};
  if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl;
  if (config.authToken) env.ANTHROPIC_AUTH_TOKEN = config.authToken;
  if (config.model) {
    env.ANTHROPIC_MODEL = config.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.model;
  }

  writeFileSync(resolve(claudeDir, "settings.json"), JSON.stringify({ env }, null, 2));
  writeFileSync(resolve(homeDir, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true }, null, 2));
}

export function resolveClaudeCodeCliPath(cwd: string = process.cwd()): string | undefined {
  const envPath = readAppEnv("CLAUDE_CLI_PATH")?.trim();
  const resolvedEnvPath = resolveClaudeCliCandidate(envPath);
  if (resolvedEnvPath) {
    return resolvedEnvPath;
  }

  const systemClaude = resolveClaudeCliCandidate("claude");
  if (systemClaude) {
    return systemClaude;
  }

  for (const candidate of ["/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const candidates = new Set<string>();
  for (const base of ancestorDirs(cwd)) {
    candidates.add(resolve(base, "reference-projects", "reference-projects", "claude-code-sourcemap", "package", "cli.js"));
    candidates.add(resolve(base, "claude-code-sourcemap", "package", "cli.js"));
  }

  const fileDir = dirname(fileURLToPath(import.meta.url));
  candidates.add(resolve(fileDir, "..", "..", "reference-projects", "reference-projects", "claude-code-sourcemap", "package", "cli.js"));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveClaudeCliCandidate(value: string | undefined): string | undefined {
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

function resolveClaudeLaunchCommand(
  options: ClaudeCodeRuntimeOptions,
): { executable: string; prefixArgs: string[] } {
  const cliKind = options.cliKind ?? inferClaudeCliKind(options.cliPath);
  if (cliKind === "node-script") {
    return {
      executable: options.nodePath ?? process.execPath,
      prefixArgs: [options.cliPath],
    };
  }

  return {
    executable: options.cliPath,
    prefixArgs: [],
  };
}

function inferClaudeCliKind(path: string): "node-script" | "native-executable" {
  const normalized = path.toLowerCase();
  return normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")
    ? "node-script"
    : "native-executable";
}

function ancestorDirs(start: string): string[] {
  const result: string[] = [];
  let current = resolve(start || process.cwd());
  while (true) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return result;
}

function normalizeClaudeModelId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "mimo-v2-pro" || normalized.startsWith("gpt-")) {
    return undefined;
  }
  return trimmed;
}

function toStableClaudeSessionId(input: string): string {
  const hash = createHash("sha1").update(input).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => asJsonValue(item));
  }
  if (isJsonObject(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = asJsonValue(item);
    }
    return result;
  }
  return String(value);
}
