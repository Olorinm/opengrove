#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ENV_PREFIX = "OPENGROVE";
const appEnvName = (name) => `${APP_ENV_PREFIX}_${name}`;
const DATA_ROOT = resolve(ROOT, process.env[appEnvName("PROVIDER_HTTP_CAPTURE_ROOT")] ?? "data/provider-http-captures");
const STATE_FILE = resolve(DATA_ROOT, "capture-state.json");
const CONF_DIR = resolve(DATA_ROOT, "mitmproxy-conf");
const DEFAULT_HOST_REGEX =
  "(^|.*\\.)(anthropic\\.com|amazonaws\\.com|openai\\.com|chatgpt\\.com|oaistatic\\.com)(:\\d+)?$";

const command = process.argv[2] ?? "status";

switch (command) {
  case "start":
    start();
    break;
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  case "env":
    printEnv(readState());
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: npm run capture:provider -- start|stop|status|env");
    process.exit(1);
}

function start() {
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(CONF_DIR, { recursive: true });

  const current = readState();
  if (current?.pid && isAlive(current.pid)) {
    console.log(`provider HTTPS capture is already running, pid=${current.pid}`);
    printEnv(current);
    return;
  }

  const mitmweb = resolveMitmBinary();
  const proxyHost = process.env[appEnvName("PROVIDER_HTTP_PROXY_HOST")] ?? "127.0.0.1";
  const proxyPort = process.env[appEnvName("PROVIDER_HTTP_PROXY_PORT")] ?? "9080";
  const webHost = process.env[appEnvName("PROVIDER_HTTP_WEB_HOST")] ?? "127.0.0.1";
  const webPort = process.env[appEnvName("PROVIDER_HTTP_WEB_PORT")] ?? "9081";
  const webPassword = process.env[appEnvName("PROVIDER_HTTP_WEB_PASSWORD")] ?? randomBytes(18).toString("base64url");
  const upstreamProxy = resolveUpstreamProxy(proxyHost, proxyPort);
  const hostRegex = process.env[appEnvName("PROVIDER_HTTP_CAPTURE_HOST_REGEX")] ?? DEFAULT_HOST_REGEX;
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = resolve(DATA_ROOT, runId);
  const logFile = resolve(runDir, "mitmweb.log");
  const addon = resolve(SCRIPT_DIR, "provider-http-capture-addon.py");
  mkdirSync(runDir, { recursive: true });

  const latest = resolve(DATA_ROOT, "latest");
  try {
    rmSync(latest, { force: true, recursive: true });
  } catch {
    // Best effort.
  }
  try {
    symlinkSync(runDir, latest);
  } catch {
    // Symlink creation can fail on some filesystems; the concrete run dir remains authoritative.
  }

  const args = [
    "--listen-host",
    proxyHost,
    "--listen-port",
    proxyPort,
    "--web-host",
    webHost,
    "--web-port",
    webPort,
    "--no-web-open-browser",
    "--showhost",
    "--allow-hosts",
    hostRegex,
    "--set",
    `web_password=${webPassword}`,
    "--set",
    `confdir=${CONF_DIR}`,
    "--save-stream-file",
    resolve(runDir, "flows.mitm"),
    "-s",
    addon,
  ];
  if (upstreamProxy) {
    args.unshift("--mode", `upstream:${upstreamProxy}`);
  }

  const log = openLog(logFile);
  const child = spawn(mitmweb, args, {
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      [appEnvName("PROVIDER_HTTP_CAPTURE_DIR")]: runDir,
      [appEnvName("PROVIDER_HTTP_CAPTURE_HOST_REGEX")]: hostRegex,
      [appEnvName("PROVIDER_HTTP_CAPTURE_LABEL")]: "provider-http",
    },
  });
  child.unref();

  const state = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    runDir,
    proxyUrl: `http://${proxyHost}:${proxyPort}`,
    webUrl: `http://${webHost}:${webPort}/?token=${encodeURIComponent(webPassword)}`,
    caCertPath: resolve(CONF_DIR, "mitmproxy-ca-cert.pem"),
    flowsPath: resolve(runDir, "flows.mitm"),
    summaryPath: resolve(runDir, "summary.jsonl"),
    bodiesDir: resolve(runDir, "bodies"),
    logFile,
    hostRegex,
    upstreamProxy: upstreamProxy ?? "",
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  console.log("provider HTTPS capture started");
  printState(state);
  printEnv(state);
}

function resolveUpstreamProxy(proxyHost, proxyPort) {
  const explicit = process.env[appEnvName("PROVIDER_HTTP_UPSTREAM_PROXY")]?.trim();
  if (explicit) {
    return explicit;
  }

  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
  ]
    .map((value) => value?.trim())
    .filter(Boolean);

  return candidates.find((candidate) => !isSelfProxy(candidate, proxyHost, proxyPort)) ?? "";
}

function isSelfProxy(value, proxyHost, proxyPort) {
  try {
    const url = new URL(value);
    const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
    const configuredHost = proxyHost === "localhost" ? "127.0.0.1" : proxyHost;
    return host === configuredHost && String(url.port || defaultPort(url.protocol)) === String(proxyPort);
  } catch {
    return false;
  }
}

function defaultPort(protocol) {
  return protocol === "https:" ? "443" : "80";
}

function stop() {
  const state = readState();
  if (!state?.pid) {
    console.log("provider HTTPS capture is not running");
    return;
  }
  if (isAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
    console.log(`stopped provider HTTPS capture, pid=${state.pid}`);
  } else {
    console.log(`provider HTTPS capture pid is not alive, pid=${state.pid}`);
  }
  rmSync(STATE_FILE, { force: true });
}

function status() {
  const state = readState();
  if (!state) {
    console.log("provider HTTPS capture is not configured");
    return;
  }
  printState({ ...state, running: Boolean(state.pid && isAlive(state.pid)) });
}

function printState(state) {
  console.log(JSON.stringify(state, null, 2));
}

function printEnv(state) {
  if (!state) {
    console.log("No capture state found. Run: npm run capture:provider -- start");
    return;
  }
  console.log("kernel env:");
  console.log(`${appEnvName("PROVIDER_HTTP_CAPTURE")}=1`);
  console.log(`${appEnvName("PROVIDER_HTTP_PROXY")}=${state.proxyUrl}`);
  console.log(`${appEnvName("PROVIDER_HTTP_CA_CERT")}=${state.caCertPath}`);
  console.log(`${appEnvName("PROVIDER_HTTP_NO_PROXY")}=127.0.0.1,localhost,::1`);
}

function readState() {
  if (!existsSync(STATE_FILE)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return undefined;
  }
}

function resolveMitmBinary() {
  const candidates = [
    process.env[appEnvName("PROVIDER_HTTP_MITMWEB")],
    process.env.MITMWEB_BIN,
    resolve(ROOT, "..", "..", ".venv-mitm", "bin", "mitmweb"),
    resolve(ROOT, "..", ".venv-mitm", "bin", "mitmweb"),
    "mitmweb",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === "mitmweb") {
      const resolved = spawnSync("sh", ["-lc", "command -v mitmweb"], { encoding: "utf8" }).stdout.trim();
      if (resolved) {
        return resolved;
      }
      continue;
    }
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  console.error(`mitmweb was not found. Set ${appEnvName("PROVIDER_HTTP_MITMWEB")}=/path/to/mitmweb.`);
  process.exit(1);
}

function openLog(path) {
  mkdirSync(dirname(path), { recursive: true });
  return openSync(path, "a");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
