import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeState } from "../bridge-types.js";
import type { DeveloperSession } from "./developer-session-types.js";

export type DeveloperPreviewServiceResult =
  | {
      status: "restarted";
      command: string;
      args: string[];
      ready: boolean;
      pid?: number;
      message?: string;
    }
  | {
      status: "unsupported" | "failed";
      message: string;
      command?: string;
      args?: string[];
    };

type PreviewProcessMap = Map<string, ChildProcess>;

const PREVIEW_READY_TIMEOUT_MS = 10_000;
const PREVIEW_READY_POLL_MS = 250;
const PREVIEW_READY_REQUEST_TIMEOUT_MS = 800;
const STATIC_PREVIEW_SERVER_PATH = fileURLToPath(new URL("./static-preview-server.js", import.meta.url));
const previewProcesses = new WeakMap<BridgeState, PreviewProcessMap>();

export async function restartDeveloperPreviewService(state: BridgeState, session: DeveloperSession): Promise<DeveloperPreviewServiceResult> {
  const invocation = resolvePreviewInvocation(session);
  if (!invocation) {
    return {
      status: "unsupported",
      message: "No package.json dev/start/preview script was found for this developer session.",
    };
  }

  const processes = getPreviewProcesses(state);
  const previous = processes.get(session.id);
  if (previous) terminateChild(previous, 900);
  processes.delete(session.id);

  const child = spawn(invocation.command, invocation.args, {
    cwd: session.targetRoot,
    env: {
      ...process.env,
      BROWSER: "none",
      HOST: invocation.host,
      PORT: invocation.port,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stdout?.on("data", () => {
    // Drain output so long-running dev servers cannot block on stdout.
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 1200) stderr += chunk.toString("utf8");
  });

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: DeveloperPreviewServiceResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.once("error", (error) => {
      processes.delete(session.id);
      settle({
        status: "failed",
        command: invocation.command,
        args: invocation.args,
        message: error.message,
      });
    });

    child.once("exit", (code, signal) => {
      if (processes.get(session.id) === child) processes.delete(session.id);
      settle({
        status: "failed",
        command: invocation.command,
        args: invocation.args,
        message: stderr.trim() || `Preview service exited early (${signal || (code ?? "unknown")}).`,
      });
    });

    child.once("spawn", () => {
      processes.set(session.id, child);
      void waitForPreviewReady(session.targetUrl, PREVIEW_READY_TIMEOUT_MS).then((ready) => {
        settle({
          status: "restarted",
          command: invocation.command,
          args: invocation.args,
          ready,
          pid: child.pid,
          message: ready
            ? `Preview service restarted for ${session.targetUrl}.`
            : `Preview service restarted, but ${session.targetUrl} did not respond within ${PREVIEW_READY_TIMEOUT_MS}ms.`,
        });
      });
    });
  });
}

export function stopAllVisualPreviewServices(state: BridgeState): void {
  const processes = previewProcesses.get(state);
  if (!processes) return;
  for (const child of processes.values()) {
    terminateChild(child, 900);
  }
  processes.clear();
}

export function stopVisualPreviewService(state: BridgeState, sessionId: string): void {
  const processes = previewProcesses.get(state);
  const child = processes?.get(sessionId);
  if (!processes || !child) return;
  terminateChild(child, 900);
  processes.delete(sessionId);
}

function getPreviewProcesses(state: BridgeState): PreviewProcessMap {
  let processes = previewProcesses.get(state);
  if (!processes) {
    processes = new Map();
    previewProcesses.set(state, processes);
  }
  return processes;
}

function resolvePreviewInvocation(session: DeveloperSession): { command: string; args: string[]; host: string; port: string } | undefined {
  const url = safeUrl(session.targetUrl);
  const port = url?.port || (url?.protocol === "https:" ? "443" : "80");
  const host = url?.hostname || "127.0.0.1";
  const packageJsonPath = join(session.targetRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    const parsed = readPackageJson(packageJsonPath);
    const scripts = parsed?.scripts ?? {};
    const script = ["dev", "start", "preview"].find((name) => typeof scripts[name] === "string" && scripts[name]?.trim());
    if (script) {
      const packageManager = resolvePackageManager(session.targetRoot);
      const extraArgs = resolvePreviewArgs(scripts[script] ?? "", host, port);
      return {
        command: packageManager,
        args: ["run", script, ...extraArgs],
        host,
        port,
      };
    }
  }

  if (existsSync(join(session.targetRoot, "index.html"))) {
    return {
      command: process.execPath,
      args: [STATIC_PREVIEW_SERVER_PATH],
      host,
      port,
    };
  }

  return undefined;
}

function readPackageJson(packageJsonPath: string): { scripts?: Record<string, string> } | undefined {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
  } catch {
    return undefined;
  }
}

function resolvePreviewArgs(scriptCommand: string, host: string, port: string): string[] {
  const command = scriptCommand.toLowerCase();
  if (command.includes("vite") || command.includes("astro") || command.includes("svelte-kit")) {
    return ["--", "--host", host, "--port", port];
  }
  if (command.includes("next dev")) {
    return ["--", "--hostname", host, "--port", port];
  }
  return [];
}

function resolvePackageManager(root: string): string {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  return "npm";
}

function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

async function waitForPreviewReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canReachPreview(url)) return true;
    await delay(PREVIEW_READY_POLL_MS);
  }
  return false;
}

async function canReachPreview(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_READY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminateChild(child: ChildProcess, delayMs: number): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, delayMs);
  child.once("exit", () => clearTimeout(timer));
}
