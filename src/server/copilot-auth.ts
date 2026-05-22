import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { externalCliDefinition, resolveExternalCliCommand } from "../kernel/adapters/external-cli.js";
import { resolveCommandPath } from "../kernel/discovery.js";
import { StdioJsonRpcClient } from "../runtime/stdio-json-rpc-client.js";
import {
  applyKernelProxyEnv,
  resolveKernelProxySettings,
} from "../runtime/kernel-proxy.js";
import type { BridgeState } from "./bridge-types.js";
import {
  existingPath,
  kernelBinaryPathOverride,
  kernelPathEnv,
} from "./kernel-paths.js";
import { resolveBridgeWorkspaceRoot } from "./workspace-root.js";

export type CopilotAuthStatus =
  | "authenticated"
  | "missing"
  | "checking"
  | "unconfirmed"
  | "unknown"
  | "error";

export interface CopilotAuthSnapshot {
  kernelId: "copilot";
  status: CopilotAuthStatus;
  method: "env-token" | "stored-credential" | "terminal" | "none" | "unknown";
  loginAvailable: boolean;
  message?: string;
  startedAt?: string;
  deadlineAt?: string;
  lastCheckedAt?: string;
}

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const PROBE_INTERVAL_MS = 8_000;
const PROBE_TIMEOUT_MS = 12_000;

let authState: CopilotAuthSnapshot = {
  kernelId: "copilot",
  status: "unknown",
  method: "unknown",
  loginAvailable: false,
};
let probeInFlight: Promise<void> | undefined;

export async function getCopilotAuthSnapshot(state: BridgeState): Promise<CopilotAuthSnapshot> {
  if (hasCopilotEnvToken(process.env)) {
    authState = {
      kernelId: "copilot",
      status: "authenticated",
      method: "env-token",
      loginAvailable: Boolean(resolveCopilotCommand(state)),
      message: "GitHub token is configured in the environment.",
      lastCheckedAt: new Date().toISOString(),
    };
    return authState;
  }

  const command = resolveCopilotCommand(state);
  if (!command) {
    authState = {
      kernelId: "copilot",
      status: "error",
      method: "none",
      loginAvailable: false,
      message: "Copilot CLI was not found.",
      lastCheckedAt: new Date().toISOString(),
    };
    return authState;
  }

  const now = Date.now();
  const stateWithDeadline = applyLoginDeadline(authState, now);
  authState = {
    ...stateWithDeadline,
    loginAvailable: true,
  };

  if (shouldProbe(authState, now)) {
    probeInFlight ??= probeCopilotAuth(state, command)
      .finally(() => {
        probeInFlight = undefined;
      });
    await probeInFlight;
    authState = applyLoginDeadline(authState, Date.now());
  }

  return {
    ...authState,
    loginAvailable: true,
  };
}

export async function startCopilotTerminalLogin(state: BridgeState): Promise<CopilotAuthSnapshot> {
  const command = resolveCopilotCommand(state);
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + LOGIN_TIMEOUT_MS);

  if (!command) {
    authState = {
      kernelId: "copilot",
      status: "error",
      method: "none",
      loginAvailable: false,
      message: "Copilot CLI was not found.",
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      lastCheckedAt: startedAt.toISOString(),
    };
    return authState;
  }

  try {
    await openCopilotLoginTerminal(command, state);
    authState = {
      kernelId: "copilot",
      status: "checking",
      method: "terminal",
      loginAvailable: true,
      message: "Waiting for Copilot CLI login to complete in Terminal.",
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      lastCheckedAt: undefined,
    };
    return authState;
  } catch (error) {
    authState = {
      kernelId: "copilot",
      status: "error",
      method: "terminal",
      loginAvailable: true,
      message: error instanceof Error ? error.message : String(error),
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
      lastCheckedAt: new Date().toISOString(),
    };
    return authState;
  }
}

function shouldProbe(state: CopilotAuthSnapshot, now: number): boolean {
  if (state.status === "authenticated" || state.status === "error") return false;
  const lastCheckedAt = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : 0;
  return !lastCheckedAt || now - lastCheckedAt >= PROBE_INTERVAL_MS;
}

function applyLoginDeadline(state: CopilotAuthSnapshot, now: number): CopilotAuthSnapshot {
  const deadline = state.deadlineAt ? Date.parse(state.deadlineAt) : 0;
  if (state.status === "checking" && deadline && now > deadline) {
    return {
      ...state,
      status: "unconfirmed",
      message: "OpenGrove has not detected a completed Copilot login yet.",
    };
  }
  return state;
}

async function probeCopilotAuth(state: BridgeState, command: string): Promise<void> {
  const checkedAt = new Date().toISOString();
  let client: StdioJsonRpcClient | undefined;
  try {
    client = StdioJsonRpcClient.start({
      command,
      args: ["--acp", "--stdio"],
      cwd: resolveBridgeWorkspaceRoot(state.settings),
      env: buildCopilotEnv(state),
    });
    await client.request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: {
          name: "opengrove-auth-check",
          title: "OpenGrove Auth Check",
          version: "0.0.0",
        },
        clientCapabilities: {
          auth: { terminal: false },
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      { timeoutMs: PROBE_TIMEOUT_MS },
    );
    await client.request(
      "session/new",
      {
        cwd: resolveBridgeWorkspaceRoot(state.settings),
        mcpServers: [],
      },
      { timeoutMs: PROBE_TIMEOUT_MS },
    );
    authState = {
      ...authState,
      kernelId: "copilot",
      status: "authenticated",
      method: "stored-credential",
      loginAvailable: true,
      message: "Copilot CLI accepted the stored GitHub credential.",
      lastCheckedAt: checkedAt,
    };
  } catch (error) {
    const message = [
      client?.stderr().trim(),
      error instanceof Error ? error.message : String(error),
    ].filter(Boolean).join("\n").trim();
    const authMissing = /authentication required|not authenticated|login required|unauthorized/i.test(message);
    if (authMissing && (authState.status === "checking" || authState.status === "unconfirmed")) {
      authState = {
        ...authState,
        loginAvailable: true,
        lastCheckedAt: checkedAt,
      };
      return;
    }
    authState = {
      ...authState,
      kernelId: "copilot",
      status: authMissing ? "missing" : authState.status === "checking" ? "checking" : "unknown",
      method: authMissing ? "none" : "unknown",
      loginAvailable: true,
      message: authMissing
        ? "Copilot CLI requires GitHub login."
        : message || "Copilot auth status could not be confirmed.",
      lastCheckedAt: checkedAt,
    };
  } finally {
    client?.close();
  }
}

function resolveCopilotCommand(state: BridgeState): string | undefined {
  const override = existingPath(kernelBinaryPathOverride(state.settings, "copilot"));
  if (override) return override;
  const definition = externalCliDefinition("copilot");
  return definition ? resolveExternalCliCommand(definition) : undefined;
}

function buildCopilotEnv(state: BridgeState): NodeJS.ProcessEnv {
  return applyKernelProxyEnv(
    {
      ...process.env,
      ...kernelPathEnv(state.settings, "copilot"),
    },
    resolveKernelProxySettings(state.settings.kernelProxy, process.env),
  );
}

async function openCopilotLoginTerminal(command: string, state: BridgeState): Promise<void> {
  const env = buildCopilotEnv(state);
  const scriptPath = createCopilotLoginScript(command, env);
  if (process.platform === "darwin") {
    await spawnDetached("open", [scriptPath]);
    return;
  }
  if (process.platform === "win32") {
    await spawnDetached("cmd", ["/c", "start", "", scriptPath]);
    return;
  }
  const terminal = [
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "xterm",
  ].map(resolveCommandPath).find(Boolean);
  if (!terminal) {
    throw new Error("No supported terminal app was found. Run `copilot login` in your terminal.");
  }
  await spawnDetached(terminal, ["-e", scriptPath]);
}

function createCopilotLoginScript(command: string, env: NodeJS.ProcessEnv): string {
  const dir = mkdtempSync(join(tmpdir(), "opengrove-copilot-login-"));
  const path = join(dir, process.platform === "win32" ? "copilot-login.cmd" : "copilot-login.command");
  const envLines = terminalEnvLines(env);
  const body = process.platform === "win32"
    ? [
        "@echo off",
        "echo OpenGrove is starting GitHub Copilot CLI login.",
        `"${command}" login`,
        "echo.",
        "echo After login completes, return to OpenGrove. Detection will continue automatically.",
        "pause",
        "",
      ].join("\r\n")
    : [
        "#!/bin/zsh",
        "echo 'OpenGrove is starting GitHub Copilot CLI login.'",
        ...envLines,
        `${shellQuote(command)} login`,
        "status=$?",
        "echo",
        "echo 'After login completes, return to OpenGrove. Detection will continue automatically.'",
        "echo 'Press any key to close this window.'",
        "read -k 1",
        "exit $status",
        "",
      ].join("\n");
  writeFileSync(path, body, "utf8");
  if (process.platform !== "win32" && existsSync(path)) {
    chmodSync(path, 0o700);
  }
  return path;
}

function terminalEnvLines(env: NodeJS.ProcessEnv): string[] {
  const names = [
    "COPILOT_HOME",
    "GH_HOST",
    "COPILOT_GH_HOST",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ];
  return names
    .map((name) => [name, env[name]] as const)
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([name, value]) => `export ${name}=${shellQuote(value ?? "")}`);
}

function hasCopilotEnvToken(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.COPILOT_GITHUB_TOKEN?.trim() ||
    env.GH_TOKEN?.trim() ||
    env.GITHUB_TOKEN?.trim()
  );
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    let settled = false;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolvePromise();
      }
    };
    child.once("error", settle);
    child.once("spawn", () => settle());
    child.unref();
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
