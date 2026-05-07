import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { appEnvName, readAppEnv } from "../identity.js";
import type { JsonObject } from "../core.js";

export interface ProviderHttpCaptureOptions {
  enabled?: boolean;
  inject?: boolean;
  kernelId?: string;
  status?: string;
  warning?: string;
  startedAt?: string;
  runDir?: string;
  summaryPath?: string;
  webUrl?: string;
  proxyUrl?: string;
  caCertPath?: string;
  noProxy?: string;
  nodeUseEnvProxy?: boolean;
}

export interface ResolvedProviderHttpCaptureOptions {
  enabled: boolean;
  injected: boolean;
  kernelId?: string;
  status: string;
  warning?: string;
  startedAt?: string;
  runDir?: string;
  summaryPath?: string;
  webUrl?: string;
  proxyUrl?: string;
  caCertPath?: string;
  noProxy: string;
  nodeUseEnvProxy: boolean;
}

const DISABLED_VALUES = new Set(["0", "false", "off", "no", "disabled"]);
const DEFAULT_PROXY_URL = "http://127.0.0.1:9080";
const DEFAULT_NO_PROXY = "127.0.0.1,localhost,::1";

export function resolveProviderHttpCaptureOptions(
  options: ProviderHttpCaptureOptions | undefined,
  env: NodeJS.ProcessEnv | undefined = process.env,
): ResolvedProviderHttpCaptureOptions {
  const enabled = options?.enabled ?? isEnabledFlag(env?.[appEnvName("PROVIDER_HTTP_CAPTURE")]);
  const injected = enabled && (options?.inject ?? true);
  const proxyUrl = options?.proxyUrl?.trim() || env?.[appEnvName("PROVIDER_HTTP_PROXY")]?.trim() || DEFAULT_PROXY_URL;
  const caCertPath =
    options?.caCertPath?.trim() ||
    env?.[appEnvName("PROVIDER_HTTP_CA_CERT")]?.trim() ||
    findDefaultMitmCaCert();
  const noProxy = options?.noProxy?.trim() || env?.[appEnvName("PROVIDER_HTTP_NO_PROXY")]?.trim() || DEFAULT_NO_PROXY;
  const nodeUseEnvProxy =
    options?.nodeUseEnvProxy ??
    isEnabledFlag(env?.[appEnvName("PROVIDER_HTTP_NODE_USE_ENV_PROXY")]);

  return {
    enabled,
    injected,
    kernelId: options?.kernelId,
    status: options?.status ?? (enabled ? (injected ? "ready" : "not-injected") : "disabled"),
    warning: options?.warning,
    startedAt: options?.startedAt,
    runDir: options?.runDir,
    summaryPath: options?.summaryPath,
    webUrl: options?.webUrl,
    proxyUrl,
    caCertPath,
    noProxy,
    nodeUseEnvProxy,
  };
}

export function applyProviderHttpCaptureEnv(
  input: NodeJS.ProcessEnv,
  capture: ResolvedProviderHttpCaptureOptions,
): NodeJS.ProcessEnv {
  if (!capture.enabled || !capture.injected || !capture.proxyUrl) {
    return input;
  }

  const env: NodeJS.ProcessEnv = { ...input };
  env.HTTP_PROXY = capture.proxyUrl;
  env.HTTPS_PROXY = capture.proxyUrl;
  env.ALL_PROXY = capture.proxyUrl;
  env.http_proxy = capture.proxyUrl;
  env.https_proxy = capture.proxyUrl;
  env.all_proxy = capture.proxyUrl;
  env.NO_PROXY = capture.noProxy;
  env.no_proxy = capture.noProxy;
  env[appEnvName("PROVIDER_HTTP_CAPTURE_ACTIVE")] = "1";

  if (capture.caCertPath) {
    env.NODE_EXTRA_CA_CERTS = capture.caCertPath;
    env.AWS_CA_BUNDLE = capture.caCertPath;
    env.CODEX_CA_CERTIFICATE = capture.caCertPath;
    env.SSL_CERT_FILE = capture.caCertPath;
    env.REQUESTS_CA_BUNDLE = capture.caCertPath;
    env.CURL_CA_BUNDLE = capture.caCertPath;
  }

  if (capture.nodeUseEnvProxy) {
    env.NODE_USE_ENV_PROXY = "1";
    env.NODE_OPTIONS = appendNodeOption(env.NODE_OPTIONS, "--use-env-proxy");
  }

  return env;
}

export function providerHttpCaptureSummary(
  capture: ResolvedProviderHttpCaptureOptions,
): JsonObject {
  return {
    enabled: capture.enabled,
    injected: capture.injected,
    kernelId: capture.kernelId ?? "",
    status: capture.status,
    warning: capture.warning ?? "",
    startedAt: capture.startedAt ?? "",
    runDir: capture.runDir ?? "",
    summaryPath: capture.summaryPath ?? "",
    webUrl: capture.webUrl ?? "",
    proxyUrl: capture.proxyUrl ?? "",
    caCertPath: capture.caCertPath ?? "",
    caCertExists: capture.caCertPath ? existsSync(capture.caCertPath) : false,
    noProxy: capture.noProxy,
    nodeUseEnvProxy: capture.nodeUseEnvProxy,
  };
}

function findDefaultMitmCaCert(): string | undefined {
  const candidates = [
    readAppEnv("PROVIDER_HTTP_CA_CERT"),
    resolve(process.cwd(), "data", "provider-http-captures", "mitmproxy-conf", "mitmproxy-ca-cert.pem"),
    resolve(process.cwd(), "data", "provider-http-captures", "conf", "mitmproxy-ca-cert.pem"),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate));
}

function appendNodeOption(current: string | undefined, option: string): string {
  const parts = (current ?? "").split(/\s+/).filter(Boolean);
  return parts.includes(option) ? parts.join(" ") : [...parts, option].join(" ");
}

function isEnabledFlag(value: string | undefined): boolean {
  return value !== undefined && !DISABLED_VALUES.has(value.trim().toLowerCase());
}
