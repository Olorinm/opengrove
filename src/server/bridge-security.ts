import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { APP_BRIDGE_TOKEN_HEADER, APP_CONFIG_DIR, readAppEnv } from "../identity.js";
import type { LocalBridgeServerOptions } from "./bridge-types.js";
import { splitList } from "./http-utils.js";

export interface BridgeSecurity {
  bridgeToken?: string;
  allowedOrigins: string[];
}

export function loadLocalEnvFile(): void {
  for (const path of localEnvPaths()) {
    if (!existsSync(path)) {
      continue;
    }

    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separator = trimmed.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = unquoteEnvValue(trimmed.slice(separator + 1).trim());
      if (/^[A-Z_][A-Z0-9_]*$/.test(key) && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function createBridgeSecurity(options: LocalBridgeServerOptions): BridgeSecurity {
  return {
    bridgeToken: options.bridgeToken ?? readAppEnv("BRIDGE_TOKEN"),
    allowedOrigins: [
      ...(options.allowedOrigins ?? []),
      ...splitList(readAppEnv("BRIDGE_ALLOWED_ORIGINS")),
    ],
  };
}

export function applyCors(response: ServerResponse, request: IncomingMessage, security: BridgeSecurity): void {
  const origin = request.headers.origin;
  if (isLocalProbeRequest(request) && origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  } else if (isAllowedOrigin(origin, security) && origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", `content-type,${APP_BRIDGE_TOKEN_HEADER}`);
  response.setHeader("Access-Control-Max-Age", "86400");
}

export function isAuthorized(request: IncomingMessage, security: BridgeSecurity): boolean {
  if (!security.bridgeToken) {
    return true;
  }
  return request.headers[APP_BRIDGE_TOKEN_HEADER] === security.bridgeToken;
}

export function isAllowedOrigin(origin: string | undefined, security: BridgeSecurity): boolean {
  if (!origin) {
    return true;
  }

  if (security.allowedOrigins.includes(origin)) {
    return true;
  }

  if (isLoopbackHttpOrigin(origin)) {
    return true;
  }

  return false;
}

function localEnvPaths(): string[] {
  return [
    readAppEnv("ENV_FILE"),
    resolve(homedir(), APP_CONFIG_DIR, ".env.local"),
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
  ].filter((path): path is string => Boolean(path));
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isLoopbackHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function isLocalProbeRequest(request: IncomingMessage): boolean {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    return url.pathname === "/opengrove-probe";
  } catch {
    return false;
  }
}
