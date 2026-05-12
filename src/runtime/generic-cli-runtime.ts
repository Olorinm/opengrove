import { spawn } from "node:child_process";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSessionTrace,
  AgentTurnRequest,
} from "../core.js";
import { resolveCommandInvocation } from "../kernel/discovery.js";
import {
  applyProviderHttpCaptureEnv,
  providerHttpCaptureSummary,
  resolveProviderHttpCaptureOptions,
  type ProviderHttpCaptureOptions,
} from "./provider-http-capture.js";
import {
  recentSessionMessages,
  recentSessionPromptBlock,
} from "./session-history.js";

export interface GenericCliRuntimeOptions {
  kernelId: string;
  title: string;
  command: string;
  args?: string[];
  promptMode?: "stdin" | "arg";
  promptLayout?: "full-context" | "input-only";
  outputFormat?: "text" | "openclaw-agent-json";
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  providerHttpCapture?: ProviderHttpCaptureOptions;
}

export class GenericCliRuntime implements AgentRuntime {
  constructor(private readonly options: GenericCliRuntimeOptions) {}

  async *runTurn(request: AgentTurnRequest): AsyncIterable<AgentEvent> {
    const runId = request.runId ?? `run_${Date.now()}`;
    const capture = resolveProviderHttpCaptureOptions(this.options.providerHttpCapture, this.options.env);
    const prompt = buildPrompt(request, this.options.promptLayout);
    const priorMessages = recentSessionMessages(request);
    const args = this.options.promptMode === "arg"
      ? [...(this.options.args ?? []), prompt]
      : [...(this.options.args ?? [])];
    const invocation = resolveCommandInvocation(this.options.command, args);
    const env = applyProviderHttpCaptureEnv({ ...process.env, ...this.options.env }, capture);
    const session: AgentSessionTrace = {
      provider: this.options.kernelId,
      sessionId: request.context.sessionId,
      persistent: false,
      priorMessageCount: priorMessages.length,
      priorMessages,
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
      data: providerHttpCaptureSummary(capture),
    };
    yield {
      type: "model.requested",
      runId,
      request: {
        systemPrompt: `${this.options.title} CLI adapter`,
        userInput: request.input,
        modelId: request.requestedModelId,
        session,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills: request.skills ?? [],
        packs: request.packs ?? [],
        capabilities: request.capabilities ?? [],
      },
    };

    const child = spawn(invocation.command, invocation.args, {
      cwd: this.options.cwd ?? process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    const abort = () => {
      aborted = true;
      if (!child.killed) child.kill("SIGTERM");
    };
    if (request.signal?.aborted) {
      abort();
    } else {
      request.signal?.addEventListener("abort", abort, { once: true });
    }
    if (this.options.promptMode !== "arg") {
      child.stdin?.end(prompt);
    } else {
      child.stdin?.end();
    }
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
    request.signal?.removeEventListener("abort", abort);
    if (aborted) {
      yield { type: "error", runId, message: `${this.options.kernelId}_aborted` };
      return;
    }
    const text = formatCliOutput(stdout.trimEnd(), this.options.outputFormat);
    if (text) yield { type: "assistant.delta", runId, text };
    if (spawnError || (exitCode && exitCode !== 0)) {
      yield {
        type: "error",
        runId,
        message: spawnError?.message || stderr.trim() || `${this.options.kernelId}_failed:${exitCode}`,
      };
    }
    yield { type: "model.response", runId, response: { text } };
    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }
}

function formatCliOutput(stdout: string, outputFormat: GenericCliRuntimeOptions["outputFormat"]): string {
  if (outputFormat !== "openclaw-agent-json" || !stdout) {
    return stdout;
  }
  try {
    const parsed = JSON.parse(stdout) as {
      result?: {
        finalAssistantVisibleText?: string;
        finalAssistantRawText?: string;
        payloads?: Array<{ text?: string | null }>;
      };
    };
    const directText = parsed.result?.finalAssistantVisibleText?.trim()
      || parsed.result?.finalAssistantRawText?.trim();
    if (directText) {
      return directText;
    }
    const payloadText = (parsed.result?.payloads ?? [])
      .map((payload) => payload.text?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    return payloadText || stdout;
  } catch {
    return stdout;
  }
}

function buildPrompt(
  request: AgentTurnRequest,
  promptLayout: GenericCliRuntimeOptions["promptLayout"] = "full-context",
): string {
  if (promptLayout === "input-only") {
    return `${request.input}\n`;
  }
  const ambientContext = renderAmbientContext(request);
  const sections = [
    ambientContext,
    recentSessionPromptBlock(request),
    request.input,
  ].filter(Boolean);
  return `${sections.join("\n\n")}\n`;
}

function renderAmbientContext(request: AgentTurnRequest): string {
  const context = request.assembledContext;
  if (!context) {
    return "";
  }
  const promptBlock = context.promptBlock?.trim();
  if (promptBlock) {
    return `OpenGrove host context:\n${promptBlock}`;
  }
  const summary = context.summary?.trim();
  const hasItems = (context.items?.length ?? 0) > 0;
  if (!hasItems && (!summary || summary === "empty context")) {
    return "";
  }
  if (summary) {
    return `OpenGrove context summary:\n${summary}`;
  }
  return "";
}
