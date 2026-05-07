import type { ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentEvent } from "../core.js";
import { hasComputerState } from "../environment/computer-adapter.js";
import type { BrowserPageAttachmentSnapshot, BrowserPageSnapshot } from "../tools/browser.js";
import type {
  BridgeAskPayload,
  BridgeAskResult,
  BridgeState,
} from "./bridge-types.js";
import { KNOWLEDGE_INVENTORY_LIMIT } from "./bridge-types.js";
import { getBridgeSettingsSnapshot } from "./bridge-state.js";
import { extractMediaArtifactsFromEvents } from "./media-artifacts.js";
import { buildProviderHttpCaptureDiagnostics } from "./provider-http-captures.js";
import { filterEnabledKnowledgeDocuments } from "./knowledge-files.js";
import {
  attachModelId,
  buildContextRecords,
  writeTrajectoryRecord,
} from "./trajectory.js";
import { syncBridgeWorkingState } from "./bridge-working-state.js";

export async function streamAskResponse(
  state: BridgeState,
  payload: BridgeAskPayload,
  response: ServerResponse,
): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "content-type": "application/x-ndjson; charset=utf-8",
  });
  response.flushHeaders?.();
  response.socket?.setNoDelay(true);

  const sendChunk = (chunk: unknown) => {
    response.write(`${JSON.stringify(chunk)}\n`);
  };
  const abortController = new AbortController();
  const abortRun = () => abortController.abort();
  response.once("close", abortRun);

  try {
    prepareAskState(state, payload);
    sendChunk({ type: "start", ok: true, threadId: payload.threadId });

    const events: AgentEvent[] = [];
    for await (const event of state.app.runTurn(payload.question, {
      sessionId: payload.threadId,
      sandbox: payload.sandbox,
      approvalPolicy: payload.approvalPolicy,
      signal: abortController.signal,
    })) {
      attachModelId([event], payload.model);
      events.push(event);
      sendChunk({ type: "event", event });
    }

    sendChunk({
      type: "final",
      data: finalizeAskResponse(state, payload, events),
    });
  } catch (error) {
    sendChunk({
      type: "fatal",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    response.off?.("close", abortRun);
    response.end();
  }
}

export function persistSnapshotAttachments(snapshot: BrowserPageSnapshot, state: BridgeState): void {
  if (!snapshot.attachments?.length) {
    return;
  }

  const uploadRoot = resolve(dirname(state.store.path), "uploads");
  mkdirSync(uploadRoot, { recursive: true });

  snapshot.attachments = snapshot.attachments.map((attachment) => {
    if (attachment.localPath) {
      return attachment;
    }

    const fileName = createUploadFileName(attachment);
    const localPath = resolve(uploadRoot, fileName);
    const content = attachment.text !== undefined
      ? attachment.text
      : attachment.dataUrl
        ? decodeDataUrl(attachment.dataUrl)
        : undefined;

    if (content === undefined) {
      return attachment;
    }

    writeFileSync(localPath, content);
    return {
      ...attachment,
      localPath,
    };
  });
}

function prepareAskState(state: BridgeState, payload: BridgeAskPayload): void {
  state.snapshot = payload.snapshot;
  if (hasComputerState(payload.computerSnapshot)) {
    state.computerSnapshot = payload.computerSnapshot;
  }
  state.model = payload.model;
  state.saveCandidateNote = payload.saveCandidateNote;
  state.policyOverrides.length = 0;
  syncBridgeWorkingState(state.app, {
    sessionId: payload.threadId,
    selectedModel: payload.model,
  });

  if (payload.allowMemory) {
    state.policyOverrides.push({
      id: "bridge.allow-reading-note",
      toolId: "memory.proposeReadingNote",
      mode: "allow",
      reason: "Local bridge request explicitly allowed memory writes.",
    });
  }
}

function finalizeAskResponse(
  state: BridgeState,
  payload: BridgeAskPayload,
  events: AgentEvent[],
): BridgeAskResult {
  attachModelId(events, payload.model);
  syncBridgeWorkingState(state.app, {
    sessionId: payload.threadId,
    selectedModel: payload.model,
  });
  extractMediaArtifactsFromEvents({
    artifacts: state.app.artifacts,
    question: payload.question,
    events,
  });
  state.store.saveFrom(state.app);
  const contextRecords = buildContextRecords(state.app.events.list(), currentProviderHttpCaptureDiagnostics(state));
  const answer = collectAssistantText(events);
  writeTrajectoryRecord(state, payload, events, answer, contextRecords);

  return {
    ok: true,
    answer,
    approvals: state.app.approvals.list(),
    events,
    memory: state.app.memory.list(),
    knowledge: filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: KNOWLEDGE_INVENTORY_LIMIT })),
    knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    artifacts: state.app.artifacts.list(),
    workingState: state.app.workingState.get(),
    computerState: state.computerSnapshot,
    sessions: state.app.sessions.list({ limit: 12 }),
    runs: state.app.sessions.listRuns({ limit: 24 }),
    executions: state.app.executions.list({ limit: 40 }),
    contextRecords,
  };
}

function currentProviderHttpCaptureDiagnostics(state: BridgeState) {
  return buildProviderHttpCaptureDiagnostics(getBridgeSettingsSnapshot(state).providerHttpCapture);
}

function collectAssistantText(events: AgentEvent[]): string {
  const finalResponse = [...events]
    .reverse()
    .find(
      (event): event is Extract<AgentEvent, { type: "model.response" }> =>
        event.type === "model.response" && typeof event.response.text === "string" && Boolean(event.response.text.trim()),
    );
  if (finalResponse) {
    return finalResponse.response.text;
  }
  return events
    .filter((event): event is Extract<AgentEvent, { type: "assistant.delta" }> => event.type === "assistant.delta")
    .map((event) => event.text)
    .join("");
}

function decodeDataUrl(dataUrl: string): Buffer | undefined {
  const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) {
    return undefined;
  }
  return Buffer.from(match[1].replace(/\s/g, ""), "base64");
}

function createUploadFileName(attachment: BrowserPageAttachmentSnapshot): string {
  const id = sanitizeUploadPathSegment(attachment.id || `upload_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`);
  const name = sanitizeUploadPathSegment(attachment.name) || "attachment";
  return `${id}_${name}`.slice(0, 180);
}

function sanitizeUploadPathSegment(value: string): string {
  return value
    .replace(/[^\w .()+-]+/g, "_")
    .replace(/^\.+/, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
