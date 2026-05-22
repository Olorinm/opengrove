#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { packageRoot } from "./package-root.js";
import { startInviteLandingServer } from "./invite/invite-landing-server.js";
import { runAppBuilderCli } from "./app-builder/cli.js";
import { normalizePersistedAgentState } from "./storage/json-state-store.js";
import { savePostgresStateSnapshot } from "./storage/postgres-state-store.js";
import { startLocalProfile } from "./profiles/local.js";
import { startServerProfile } from "./profiles/server.js";

type PackageInfo = {
  name: string;
  version: string;
};

const USAGE = `OpenGrove

Usage:
  opengrove start [--host HOST] [--port PORT]
  opengrove bridge [--host HOST] [--port PORT]
  opengrove server [--host HOST] [--port PORT] [--database-url URL] [--workspace-id ID]
  opengrove invite-landing [--host HOST] [--port PORT]
  opengrove app <inspect|validate|scaffold> ...
  opengrove migrate json-to-postgres --state PATH --database-url URL [--workspace-id ID]
  opengrove update
  opengrove version

Commands:
  start, bridge   Start the local OpenGrove bridge and UI.
  server          Start the deployable OpenGrove server profile.
  invite-landing  Start the public invite landing page server.
  app             Inspect, scaffold, and validate portable OpenGrove Apps.
  migrate         Run data migrations between storage profiles.
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
    startLocalProfile(options);
    return;
  }

  if (command === "server") {
    const options = parseServerOptions(args.slice(1));
    await startServerProfile(options);
    return;
  }

  if (command === "invite-landing") {
    const options = parseStartOptions(args.slice(1));
    startInviteLandingServer(options);
    return;
  }

  if (command === "app") {
    await runAppBuilderCli(args.slice(1));
    return;
  }

  if (command === "update" || command === "upgrade") {
    runUpdate();
    return;
  }

  if (command === "migrate") {
    await runMigrate(args.slice(1));
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

function parseServerOptions(args: string[]): {
  host?: string;
  port?: number;
  databaseUrl?: string;
  workspaceId?: string;
} {
  const options: {
    host?: string;
    port?: number;
    databaseUrl?: string;
    workspaceId?: string;
  } = {};

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
    } else if (arg === "--database-url") {
      options.databaseUrl = readRequiredValue(args, index, "--database-url");
      index += 1;
    } else if (arg.startsWith("--database-url=")) {
      options.databaseUrl = arg.slice("--database-url=".length);
    } else if (arg === "--workspace-id") {
      options.workspaceId = readRequiredValue(args, index, "--workspace-id");
      index += 1;
    } else if (arg.startsWith("--workspace-id=")) {
      options.workspaceId = arg.slice("--workspace-id=".length);
    } else {
      throw new Error(`Unknown server option: ${arg}`);
    }
  }

  return options;
}

async function runMigrate(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== "json-to-postgres") {
    throw new Error("Unknown migrate command. Use: opengrove migrate json-to-postgres --state PATH --database-url URL");
  }

  let statePath = "";
  let databaseUrl = "";
  let workspaceId = "default";
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--state") {
      statePath = readRequiredValue(args, index, "--state");
      index += 1;
    } else if (arg.startsWith("--state=")) {
      statePath = arg.slice("--state=".length);
    } else if (arg === "--database-url") {
      databaseUrl = readRequiredValue(args, index, "--database-url");
      index += 1;
    } else if (arg.startsWith("--database-url=")) {
      databaseUrl = arg.slice("--database-url=".length);
    } else if (arg === "--workspace-id") {
      workspaceId = readRequiredValue(args, index, "--workspace-id");
      index += 1;
    } else if (arg.startsWith("--workspace-id=")) {
      workspaceId = arg.slice("--workspace-id=".length);
    } else {
      throw new Error(`Unknown migrate option: ${arg}`);
    }
  }

  if (!statePath) {
    throw new Error("migrate json-to-postgres requires --state PATH");
  }
  if (!databaseUrl) {
    throw new Error("migrate json-to-postgres requires --database-url URL");
  }

  const snapshot = normalizePersistedAgentState(JSON.parse(readFileSync(statePath, "utf8")));
  await savePostgresStateSnapshot({
    connectionString: databaseUrl,
    workspaceId,
  }, snapshot);
  console.log(`Migrated ${statePath} to Postgres workspace ${workspaceId}.`);
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
