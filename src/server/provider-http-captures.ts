import { existsSync, readFileSync } from "node:fs";
import type {
  BridgeContextRecord,
  BridgeProviderHttpCaptureDiagnostics,
  BridgeProviderHttpCaptureFlow,
} from "./bridge-types.js";

const MAX_CAPTURE_FLOWS = 240;
const MAX_CAPTURE_FLOWS_PER_RECORD = 24;
const MAX_CAPTURE_BODY_READ_BYTES = 256_000;
const MAX_CAPTURE_BODY_PREVIEW_CHARS = 8_000;
const CAPTURE_WINDOW_BEFORE_MS = 5_000;
const CAPTURE_WINDOW_AFTER_MS = 15_000;

export function buildProviderHttpCaptureDiagnostics(snapshot: unknown): BridgeProviderHttpCaptureDiagnostics | undefined {
  const source = record(snapshot);
  const enabled = source.enabled === true;
  const injected = source.injected === true;
  const summaryPath = stringValue(source.summaryPath);
  const runDir = stringValue(source.runDir);
  const running = source.running === true;

  if (!enabled && !running && !summaryPath && !runDir) {
    return undefined;
  }

  const flows = readProviderHttpCaptureFlows(summaryPath);
  return {
    enabled,
    injected,
    kernelId: stringValue(source.kernelId) || undefined,
    status: stringValue(source.status) || undefined,
    running,
    startedAt: stringValue(source.startedAt) || undefined,
    runDir: runDir || undefined,
    summaryPath: summaryPath || undefined,
    webUrl: stringValue(source.webUrl) || undefined,
    warning: stringValue(source.warning) || undefined,
    flowCount: flows.length,
    matchedFlowCount: 0,
    flows,
  };
}

export function attachProviderHttpCaptureDiagnostics(
  records: BridgeContextRecord[],
  diagnostics: BridgeProviderHttpCaptureDiagnostics | undefined,
): BridgeContextRecord[] {
  if (!diagnostics) {
    return records;
  }

  return records.map((record) => {
    const configured = providerHttpCaptureConfiguredForRecord(record);
    if (!configured?.enabled) {
      return record;
    }
    const allFlows = configured.injected
      ? configured.summaryPath && configured.summaryPath !== diagnostics.summaryPath
        ? readProviderHttpCaptureFlows(configured.summaryPath)
        : diagnostics.flows
      : [];
    const flows = flowsForContextRecord(record, allFlows);
    return {
      ...record,
      providerHttpCapture: {
        ...diagnostics,
        ...configured,
        flowCount: allFlows.length,
        matchedFlowCount: flows.length,
        flows,
      },
    };
  });
}

function providerHttpCaptureConfiguredForRecord(contextRecord: BridgeContextRecord): BridgeProviderHttpCaptureDiagnostics | undefined {
  const diagnostic = [...contextRecord.events]
    .reverse()
    .find((event) => event.type === "runtime.diagnostic" && event.name === "provider_http_capture.configured");
  if (!diagnostic || diagnostic.type !== "runtime.diagnostic") {
    return undefined;
  }

  const data = record(diagnostic.data);
  return {
    enabled: data.enabled === true,
    injected: data.injected === true,
    kernelId: stringValue(data.kernelId) || undefined,
    status: stringValue(data.status) || undefined,
    warning: stringValue(data.warning) || undefined,
    running: undefined,
    startedAt: stringValue(data.startedAt) || undefined,
    runDir: stringValue(data.runDir) || undefined,
    summaryPath: stringValue(data.summaryPath) || undefined,
    webUrl: stringValue(data.webUrl) || undefined,
    flowCount: 0,
    matchedFlowCount: 0,
    flows: [],
  };
}

function readProviderHttpCaptureFlows(summaryPath: string): BridgeProviderHttpCaptureFlow[] {
  if (!summaryPath || !existsSync(summaryPath)) {
    return [];
  }

  const lines = readFileSync(summaryPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .slice(-MAX_CAPTURE_FLOWS)
    .map(parseProviderFlow)
    .filter((flow): flow is BridgeProviderHttpCaptureFlow => Boolean(flow));
}

function parseProviderFlow(line: string): BridgeProviderHttpCaptureFlow | undefined {
  try {
    const source = JSON.parse(line) as unknown;
    const item = record(source);
    const kind = stringValue(item.kind) || "http";
    const request = record(item.request);
    const response = record(item.response);
    const websocket = record(item.websocket);
    const requestBody = record(request.body);
    const responseBody = record(response.body);
    const websocketBody = record(websocket.body);
    const startedSeconds = numberValue(item.timestampStart);
    const endedSeconds = numberValue(item.timestampEnd);
    const startedAt = startedSeconds ? new Date(startedSeconds * 1000).toISOString() : stringValue(item.startedAt) || "";
    const durationMs = startedSeconds && endedSeconds ? Math.max(0, Math.round((endedSeconds - startedSeconds) * 1000)) : undefined;
    const connectionFlowId = stringValue(item.flowId) || startedAt || "provider-flow";
    const messageId = stringValue(item.messageId);

    return {
      kind: providerFlowKind(kind),
      flowId: messageId || (kind === "websocket_end" ? `${connectionFlowId}-ws-end` : connectionFlowId),
      connectionFlowId: messageId ? connectionFlowId : undefined,
      startedAt,
      durationMs,
      request: {
        method: stringValue(request.method) || "GET",
        host: stringValue(request.host),
        path: redactPath(stringValue(request.path)),
        url: redactUrl(stringValue(request.url)),
        bodyBytes: optionalNumber(requestBody.bytes),
        bodyPath: stringValue(requestBody.path) || undefined,
        ...readCaptureBodyPreview(requestBody),
      },
      websocket:
        kind === "websocket_message" || kind === "websocket_end"
          ? {
              direction: stringValue(websocket.direction) || undefined,
              opcode: stringValue(websocket.opcode) || undefined,
              isText: typeof websocket.isText === "boolean" ? websocket.isText : undefined,
              bodyBytes: optionalNumber(websocketBody.bytes),
              bodyPath: stringValue(websocketBody.path) || undefined,
              ...readCaptureBodyPreview(websocketBody),
              messageIndex: optionalNumber(item.messageIndex),
              messageCount: optionalNumber(websocket.messageCount),
              closeCode: optionalNumber(websocket.closeCode),
              closeReason: stringValue(websocket.closeReason) || undefined,
            }
          : undefined,
      response: {
        statusCode: optionalNumber(response.statusCode),
        reason: stringValue(response.reason) || undefined,
        bodyBytes: optionalNumber(responseBody.bytes),
        bodyPath: stringValue(responseBody.path) || undefined,
        ...readCaptureBodyPreview(responseBody),
      },
    };
  } catch {
    return undefined;
  }
}

function providerFlowKind(value: string): "http" | "websocket_message" | "websocket_end" {
  if (value === "websocket_message" || value === "websocket_end") {
    return value;
  }
  return "http";
}

function flowsForContextRecord(
  contextRecord: BridgeContextRecord,
  flows: BridgeProviderHttpCaptureFlow[],
): BridgeProviderHttpCaptureFlow[] {
  if (!flows.length || !contextRecord.startedAt) {
    return [];
  }

  const start = Date.parse(contextRecord.startedAt);
  const end = Date.parse(contextRecord.finishedAt || contextRecord.startedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return [];
  }

  const from = start - CAPTURE_WINDOW_BEFORE_MS;
  const to = Math.max(end, start) + CAPTURE_WINDOW_AFTER_MS;
  return flows
    .filter((flow) => {
      const time = Date.parse(flow.startedAt);
      return Number.isFinite(time) && time >= from && time <= to;
    })
    .filter(isValuableProviderCaptureFlow)
    .slice(-MAX_CAPTURE_FLOWS_PER_RECORD);
}

function isValuableProviderCaptureFlow(flow: BridgeProviderHttpCaptureFlow): boolean {
  const path = flow.request?.path || "";
  if (/analytics-events|telemetry|\/events(?:\?|$)/i.test(path)) return false;
  if (flow.kind === "websocket_end") return false;
  if (flow.kind === "websocket_message") {
    const preview = flow.websocket?.bodyPreview || "";
    if (!preview.trim()) return false;
    return isUsefulWebsocketPreview(preview);
  }
  if (!isLikelyModelProviderPath(flow)) return false;
  return Boolean(flow.request?.bodyPreview || flow.response?.bodyPreview);
}

function isLikelyModelProviderPath(flow: BridgeProviderHttpCaptureFlow): boolean {
  const host = flow.request?.host || "";
  const path = flow.request?.path || "";
  if (/anthropic\.com|amazonaws\.com|api\.openai\.com/i.test(host)) return true;
  if (/chatgpt\.com/i.test(host)) {
    return /\/codex\/responses|\/conversation|\/responses|\/backend-api\/conversation/i.test(path);
  }
  return false;
}

function isUsefulWebsocketPreview(preview: string): boolean {
  try {
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    const type = String(parsed.type || "");
    if (!type) return true;
    if (type.endsWith(".delta")) return false;
    if (type === "response.output_item.done") {
      const item = record(parsed.item);
      return String(item.type || "") !== "reasoning" || Object.keys(item).some((key) => key !== "id" && key !== "type" && key !== "encrypted_content");
    }
    return /input|created|done|completed|failed|error|tool|function|message|content_part|output_item/i.test(type);
  } catch {
    return preview.trim().length > 0;
  }
}

function readCaptureBodyPreview(body: Record<string, unknown>): { bodyPreview?: string; bodyPreviewTruncated?: boolean } {
  const path = stringValue(body.path);
  if (!path || !existsSync(path)) return {};
  try {
    const raw = readFileSync(path);
    const truncatedByBytes = raw.length > MAX_CAPTURE_BODY_READ_BYTES;
    const buffer = truncatedByBytes ? raw.subarray(0, MAX_CAPTURE_BODY_READ_BYTES) : raw;
    const text = buffer.toString("utf8").replace(/\0/g, "");
    const redacted = redactCaptureBodyText(text);
    const truncated = truncatedByBytes || redacted.length > MAX_CAPTURE_BODY_PREVIEW_CHARS;
    return {
      bodyPreview: redacted.slice(0, MAX_CAPTURE_BODY_PREVIEW_CHARS),
      bodyPreviewTruncated: truncated,
    };
  } catch {
    return {};
  }
}

function redactCaptureBodyText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(trimmed)), null, 2);
  } catch {
    return redactSecretLikeText(trimmed);
  }
}

function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactJsonValue);
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactSecretLikeText(value) : value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveCaptureKey(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = redactJsonValue(child);
  }
  return output;
}

function isSensitiveCaptureKey(key: string): boolean {
  return /authorization|cookie|token|secret|password|api[-_]?key|credential|encrypted_content|session_id|account_id|user_id|email/i.test(key);
}

function redactSecretLikeText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt-redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email-redacted]");
}

function redactUrl(value: string): string {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    url.search = url.search ? "?..." : "";
    return url.toString();
  } catch {
    return value.replace(/\?.*$/, "?...");
  }
}

function redactPath(value: string): string {
  if (!value) {
    return "";
  }
  return value.replace(/\?.*$/, "?...");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const number = numberValue(value);
  return number === undefined ? undefined : number;
}
