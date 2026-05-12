import { spawn } from "node:child_process";
import { readAppEnv } from "../../identity.js";
import type { AgentEvent } from "../../core.js";
import { record, stringValue } from "../http-utils.js";

const DEFAULT_REMOTE_SSH_USER = "root";
const DEFAULT_REMOTE_RUN_USER = "opengrove";
const DEFAULT_REMOTE_WORKDIR = "/home/opengrove/claude-test";
const DEFAULT_REMOTE_ENV_FILE = "/home/opengrove/.opengrove-claude-volc/env";
const DEFAULT_REMOTE_RUNTIME_MODULE = "/opt/opengrove-runtime/dist/runtime/claude-code-runtime.js";
const DEFAULT_REMOTE_CLAUDE_CLI = "/usr/bin/claude";
const DEFAULT_REMOTE_MODEL = "glm-5.1";
const REMOTE_AGENT_TIMEOUT_MS = 180_000;
const MAX_REMOTE_OUTPUT_BYTES = 6_000_000;

export type RemoteRoomAgentResult = {
  ok: boolean;
  answer: string;
  duration?: string;
  events?: AgentEvent[];
  error?: string;
};

type RemoteRoomAgentConfig = {
  host: string;
  sshUser: string;
  sshKeyPath: string;
  runUser: string;
  workdir: string;
  envFile: string;
  runtimeModule: string;
  claudeCli: string;
  model: string;
};

export async function runRemoteRoomAgent(source: Record<string, unknown>): Promise<RemoteRoomAgentResult> {
  const prompt = stringValue(source.prompt).trim();
  const memberName = stringValue(source.memberName).trim() || "远程员工";
  const memberId = stringValue(source.memberId).trim() || "remote-member";
  const roomId = stringValue(source.roomId).trim() || "room";
  const attachments = summarizeAttachments(source.attachments);

  if (!prompt) {
    return { ok: false, answer: "", error: "prompt_required" };
  }

  const config = resolveRemoteRoomAgentConfig();
  if (!config.host || !config.sshKeyPath) {
    return {
      ok: false,
      answer: "",
      error: "remote_claude_not_configured",
    };
  }

  const startedAt = Date.now();
  const input = buildRemoteAgentInput({ memberName, prompt, attachments });

  try {
    const script = buildRemoteRuntimeScript({
      config,
      promptB64: b64(input),
      memberNameB64: b64(memberName),
      roomIdB64: b64(roomId),
      memberIdB64: b64(memberId),
    });
    const { stdout, stderr } = await runSshScript(config, script, REMOTE_AGENT_TIMEOUT_MS);
    const result = parseRemoteRuntimeResult(stdout, stderr);
    if (!result.ok) {
      return {
        ok: false,
        answer: "",
        duration: elapsedSeconds(startedAt),
        events: result.events,
        error: result.error || "remote_agent_failed",
      };
    }
    return {
      ok: true,
      answer: cleanRemoteAnswer(result.answer),
      duration: elapsedSeconds(startedAt),
      events: cleanRemoteAnswerEvents(result.events),
    };
  } catch (error) {
    return {
      ok: false,
      answer: "",
      duration: elapsedSeconds(startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveRemoteRoomAgentConfig(): RemoteRoomAgentConfig {
  return {
    host: env("REMOTE_CLAUDE_SSH_HOST"),
    sshUser: env("REMOTE_CLAUDE_SSH_USER") || DEFAULT_REMOTE_SSH_USER,
    sshKeyPath: env("REMOTE_CLAUDE_SSH_KEY"),
    runUser: env("REMOTE_CLAUDE_RUN_USER") || DEFAULT_REMOTE_RUN_USER,
    workdir: env("REMOTE_CLAUDE_WORKDIR") || DEFAULT_REMOTE_WORKDIR,
    envFile: env("REMOTE_CLAUDE_ENV") || DEFAULT_REMOTE_ENV_FILE,
    runtimeModule: env("REMOTE_CLAUDE_RUNTIME") || DEFAULT_REMOTE_RUNTIME_MODULE,
    claudeCli: env("REMOTE_CLAUDE_CLI") || DEFAULT_REMOTE_CLAUDE_CLI,
    model: env("REMOTE_CLAUDE_MODEL") || DEFAULT_REMOTE_MODEL,
  };
}

function env(name: string): string {
  return readAppEnv(name)?.trim() || "";
}

function summarizeAttachments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item, index) => {
    const attachment = record(item);
    const name = stringValue(attachment.name).trim() || `附件 ${index + 1}`;
    const kind = stringValue(attachment.kind).trim() || "file";
    const mimeType = stringValue(attachment.mimeType).trim();
    const size = typeof attachment.size === "number" ? `${attachment.size} bytes` : "";
    const text = stringValue(attachment.text).trim();
    const preview = text ? `；文本预览：${text.slice(0, 600)}` : "";
    return `- ${name}（${[kind, mimeType, size].filter(Boolean).join(" / ") || "附件"}）${preview}`;
  });
}

function buildRemoteAgentInput(input: {
  memberName: string;
  prompt: string;
  attachments: string[];
}): string {
  const attachmentBlock = input.attachments.length
    ? `消息带有附件：\n${input.attachments.join("\n")}\n如需读取未提供的附件内容，请在回复里说明需要授权或补充内容。`
    : "";
  return [
    `你是 ${input.memberName}，一个已经加入 OpenGrove 群聊的远程员工。`,
    "你刚刚在群聊里被 @。请直接回复用户消息，保持自然、简洁、可执行。",
    "不要说邀请仍在等待接受，也不要解释 SSH、bridge 或内部运行方式，除非用户主动问。",
    `用户消息：\n${input.prompt}`,
    attachmentBlock,
  ].filter(Boolean).join("\n\n");
}

function buildRemoteRuntimeScript(input: {
  config: RemoteRoomAgentConfig;
  promptB64: string;
  memberNameB64: string;
  roomIdB64: string;
  memberIdB64: string;
}): string {
  const { config } = input;
  const inner = [
    "set -euo pipefail",
    'cd "$OPENGROVE_REMOTE_WORKDIR"',
    "node --input-type=module <<'NODE'",
    remoteNodeProgram(),
    "NODE",
  ].join("\n");

  const runCommand = [
    "runuser",
    "-u",
    shellQuote(config.runUser),
    "--",
    "env",
    `OPENGROVE_REMOTE_PROMPT_B64=${shellQuote(input.promptB64)}`,
    `OPENGROVE_REMOTE_MEMBER_NAME_B64=${shellQuote(input.memberNameB64)}`,
    `OPENGROVE_REMOTE_ROOM_ID_B64=${shellQuote(input.roomIdB64)}`,
    `OPENGROVE_REMOTE_MEMBER_ID_B64=${shellQuote(input.memberIdB64)}`,
    `OPENGROVE_REMOTE_WORKDIR=${shellQuote(config.workdir)}`,
    `OPENGROVE_REMOTE_ENV_FILE=${shellQuote(config.envFile)}`,
    `OPENGROVE_REMOTE_RUNTIME_MODULE=${shellQuote(config.runtimeModule)}`,
    `OPENGROVE_REMOTE_CLAUDE_CLI=${shellQuote(config.claudeCli)}`,
    `OPENGROVE_REMOTE_MODEL=${shellQuote(config.model)}`,
    "bash",
    "-lc",
    shellQuote(inner),
  ].join(" ");

  return ["set -euo pipefail", runCommand].join("\n");
}

function remoteNodeProgram(): string {
  return String.raw`
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function decode(name, fallback = "") {
  const value = process.env[name] || "";
  return value ? Buffer.from(value, "base64").toString("utf8") : fallback;
}

function readEnvFile(filePath) {
  const result = {};
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

const prompt = decode("OPENGROVE_REMOTE_PROMPT_B64");
const memberName = decode("OPENGROVE_REMOTE_MEMBER_NAME_B64", "远程员工");
const roomId = decode("OPENGROVE_REMOTE_ROOM_ID_B64", "room");
const memberId = decode("OPENGROVE_REMOTE_MEMBER_ID_B64", "remote-member");
const workdir = process.env.OPENGROVE_REMOTE_WORKDIR;
const envFile = process.env.OPENGROVE_REMOTE_ENV_FILE;
const runtimeModule = process.env.OPENGROVE_REMOTE_RUNTIME_MODULE;
const model = process.env.OPENGROVE_REMOTE_MODEL || "glm-5.1";
const { ClaudeCodeRuntime } = await import(pathToFileURL(runtimeModule).href);
const runtimeEnv = readEnvFile(envFile);
const startedAt = new Date().toISOString();
const runId = "remote_room_" + Date.now();
const events = [];

try {
  const runtime = new ClaudeCodeRuntime({
    cliPath: process.env.OPENGROVE_REMOTE_CLAUDE_CLI || "/usr/bin/claude",
    cwd: workdir,
    permissionMode: "default",
    configuredModel: "opus",
    modelAliases: { [model]: "opus" },
    env: runtimeEnv,
    streamCapture: {
      enabled: true,
      dir: workdir + "/opengrove-ui-captures",
      includeRawIO: false
    }
  });

  for await (const event of runtime.runTurn({
    input: prompt,
    context: { sessionId: "opengrove-room-" + roomId + "-" + memberId + "-" + runId },
    tools: [],
    runId,
    requestedModelId: model,
    skills: [],
    packs: [],
    capabilities: [],
    assembledContext: {
      id: "remote-room-context-" + runId,
      createdAt: startedAt,
      summary: "OpenGrove 群聊远程员工消息",
      items: [{
        id: "mentioned-message",
        kind: "task",
        title: memberName + " 被 @ 的群聊消息",
        text: prompt
      }],
      budget: {
        maxItems: 1,
        usedItems: 1,
        maxCharacters: prompt.length,
        usedCharacters: prompt.length,
        truncated: false
      },
      promptBlock: "当前任务来自 OpenGrove 群聊 @ 远程员工。只回复本次被 @ 的消息。"
    }
  })) {
    events.push(event);
  }

  const response = [...events].reverse().find((event) => event?.type === "model.response");
  const streamedText = events
    .filter((event) => event?.type === "assistant.delta" && typeof event.text === "string")
    .map((event) => event.text)
    .join("");
  const answer = response?.response?.text || streamedText || "";
  console.log(JSON.stringify({ ok: true, answer, events }));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    answer: "",
    error: error instanceof Error ? error.message : String(error),
    events
  }));
}
`;
}

function runSshScript(
  config: RemoteRoomAgentConfig,
  script: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      config.sshKeyPath,
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=12",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=2",
      `${config.sshUser}@${config.host}`,
      "bash",
      "-s",
    ];
    const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= MAX_REMOTE_OUTPUT_BYTES) {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= MAX_REMOTE_OUTPUT_BYTES) {
        stderr += chunk.toString("utf8");
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("remote_agent_timeout"));
        return;
      }
      if (outputBytes > MAX_REMOTE_OUTPUT_BYTES) {
        reject(new Error("remote_agent_output_too_large"));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`remote_agent_ssh_failed:${code ?? "unknown"}:${tail(stderr || stdout)}`));
    });
    child.stdin.end(script);
  });
}

function parseRemoteRuntimeResult(stdout: string, stderr = ""): RemoteRoomAgentResult {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonObject(lines[index]);
    if (!parsed || typeof parsed.ok !== "boolean") continue;
    return {
      ok: parsed.ok,
      answer: stringValue(parsed.answer),
      error: stringValue(parsed.error) || undefined,
      events: normalizeAgentEvents(parsed.events),
    };
  }
  return {
    ok: false,
    answer: "",
    error: `remote_agent_result_missing:${tail([stdout, stderr].filter(Boolean).join("\n"))}`,
  };
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    return record(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function normalizeAgentEvents(value: unknown): AgentEvent[] {
  return Array.isArray(value)
    ? value.filter((event) => record(event).type).map((event) => event as AgentEvent)
    : [];
}

function cleanRemoteAnswer(value: string): string {
  return value.replace(/(?:<\|assistant\|>)+\s*$/g, "").trim();
}

function cleanRemoteAnswerEvents(events: AgentEvent[] | undefined): AgentEvent[] | undefined {
  if (!events?.length) return events;
  return events.map((event) => {
    if (event.type !== "model.response") return event;
    return {
      ...event,
      response: {
        ...event.response,
        text: cleanRemoteAnswer(event.response.text),
      },
    };
  });
}

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function elapsedSeconds(startedAt: number): string {
  return `${Math.max(0.1, (Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function tail(value: string): string {
  return value.trim().slice(-1_500);
}
