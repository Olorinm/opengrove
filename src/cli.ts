#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { packageRoot } from "./package-root.js";
import { startLocalBridgeServer } from "./server/local-bridge.js";
import { startRelayHttpServer } from "./relay/http-relay-server.js";

type PackageInfo = {
  name: string;
  version: string;
};

const USAGE = `OpenGrove

Usage:
  opengrove start [--host HOST] [--port PORT]
  opengrove bridge [--host HOST] [--port PORT]
  opengrove relay [--host HOST] [--port PORT]
  opengrove update
  opengrove version

Commands:
  start, bridge   Start the local OpenGrove bridge and UI.
  relay           Start the OpenGrove room relay HTTP/SSE server.
  update          Upgrade the npm global installation to the latest version.
  version         Print the installed OpenGrove version.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith("-") ? args[0] : "start";

  if (args.includes("--help") || args.includes("-h") || command === "help") {
    console.log(USAGE.trimEnd());
    return;
  }

  if (args.includes("--version") || args.includes("-v") || command === "version") {
    const pkg = readPackageInfo();
    console.log(pkg.version);
    return;
  }

  if (command === "start" || command === "bridge") {
    const options = parseStartOptions(command === args[0] ? args.slice(1) : args);
    startLocalBridgeServer(options);
    return;
  }

  if (command === "relay") {
    const options = parseStartOptions(args.slice(1));
    startRelayHttpServer(options);
    return;
  }

  if (command === "update" || command === "upgrade") {
    runUpdate();
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  console.error(USAGE.trimEnd());
  process.exitCode = 1;
}

function parseStartOptions(args: string[]): { host?: string; port?: number } {
  const options: { host?: string; port?: number } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") {
      options.host = readRequiredValue(args, index, "--host");
      index += 1;
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--port") {
      options.port = parsePort(readRequiredValue(args, index, "--port"));
      index += 1;
    } else if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
    } else {
      throw new Error(`Unknown start option: ${arg}`);
    }
  }

  return options;
}

function readRequiredValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function runUpdate(): void {
  const root = packageRoot();
  const pkg = readPackageInfo();

  if (existsSync(join(root, ".git")) && existsSync(join(root, "src"))) {
    console.error(`OpenGrove is running from a source checkout at ${root}.`);
    console.error("Update this checkout with:");
    console.error("  git pull");
    console.error("  npm install");
    console.error("  npm run build");
    process.exitCode = 1;
    return;
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["install", "-g", `${pkg.name}@latest`], {
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to run npm: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.status && result.status !== 0) {
    process.exitCode = result.status;
    return;
  }

  console.log("OpenGrove updated. Run `opengrove --version` to confirm the installed version.");
}

function readPackageInfo(): PackageInfo {
  const raw = readFileSync(join(packageRoot(), "package.json"), "utf8");
  const parsed = JSON.parse(raw) as Partial<PackageInfo>;
  return {
    name: parsed.name || "opengrove",
    version: parsed.version || "0.0.0",
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
