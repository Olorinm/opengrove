import type { ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentEvent, PolicyRule } from "../core.js";
import { hasComputerState } from "../environment/computer-adapter.js";
import type { BrowserPageAttachmentSnapshot, BrowserPageSnapshot } from "../environment/browser-adapter.js";
import type {
  BridgeAskPayload,
  BridgeAskResult,
  BridgeState,
} from "./bridge-types.js";
import { getBridgeSettingsSnapshot, recreateBridgeApp } from "./bridge-state.js";
import { extractMediaArtifactsFromEvents } from "./media-artifacts.js";
import { buildProviderHttpCaptureDiagnostics } from "./provider-http-captures.js";
import { listKnowledgeInventoryDocuments } from "./knowledge-files.js";
import {
  attachModelId,
  buildContextRecords,
  writeTrajectoryRecord,
} from "./trajectory.js";
import { syncBridgeWorkingState } from "./bridge-working-state.js";
import { runWithBridgeTurnContext, type BridgeTurnContext } from "./bridge-turn-context.js";
import { bridgeDataPath } from "./storage-paths.js";
import { resolveMountedAppRuntimeEnv } from "./app-runtime-env.js";

type AskStreamChunk =
  | { type: "start"; ok: true; threadId: string; runId: string }
  | { type: "event"; event: AgentEvent }
  | { type: "final"; data: BridgeAskResult }
  | { type: "fatal"; error: string };

interface BackgroundAskRun {
  runId: string;
  threadId: string;
  payload: BridgeAskPayload;
  controller: AbortController;
  chunks: AskStreamChunk[];
  done: boolean;
  subscribers: Set<(chunk: AskStreamChunk) => void>;
}

const askRunRegistries = new WeakMap<BridgeState, Map<string, BackgroundAskRun>>();

export async function streamAskResponse(
  state: BridgeState,
  payload: BridgeAskPayload,
  response: ServerResponse,
): Promise<void> {
  const run = startBackgroundAskRun(state, payload);
  await streamBackgroundAskRun(run, response);
}

export async function streamExistingAskResponse(
  state: BridgeState,
  query: { runId?: string; threadId?: string },
  response: ServerResponse,
): Promise<void> {
  const run = findBackgroundAskRun(state, query);
  if (!run) {
    response.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ ok: false, error: "run_not_found" }));
    return;
  }
  await streamBackgroundAskRun(run, response);
}

export function cancelBackgroundAskRun(
  state: BridgeState,
  query: { runId?: string; threadId?: string },
): boolean {
  const run = findBackgroundAskRun(state, query);
  if (!run || run.done) {
    return false;
  }
  run.controller.abort();
  return true;
}

function startBackgroundAskRun(state: BridgeState, payload: BridgeAskPayload): BackgroundAskRun {
  const runId = createBackgroundRunId();
  const run: BackgroundAskRun = {
    runId,
    threadId: payload.threadId,
    payload,
    controller: new AbortController(),
    chunks: [],
    done: false,
    subscribers: new Set(),
  };
  registryForState(state).set(runId, run);
  void executeBackgroundAskRun(state, run);
  return run;
}

async function executeBackgroundAskRun(state: BridgeState, run: BackgroundAskRun): Promise<void> {
  const payload = run.payload;
  let executionState = state;
  let turnContext: BridgeTurnContext | undefined;
  const events: AgentEvent[] = [];

  try {
    executionState = askExecutionState(state, payload);
    turnContext = prepareAskState(executionState, payload);
    const policyOverrides = turnContext.policyOverrides;
    const appRuntimeEnv = resolveMountedAppRuntimeEnv(executionState, payload.appId);
    emitAskRunChunk(run, { type: "start", ok: true, threadId: payload.threadId, runId: run.runId });

    await runWithBridgeTurnContext(turnContext, async () => {
      for await (const event of executionState.app.runTurn(payload.question, {
        sessionId: payload.threadId,
        runId: run.runId,
        requestedModelId: payload.model,
        requestedEffort: payload.effort,
        responseSpeed: payload.responseSpeed,
        accessMode: payload.accessMode,
        requestedSkillName: payload.requestedSkill?.name,
        requestedSkillArgs: payload.requestedSkill?.args,
        policy: policyOverrides,
        runtimeEnv: appRuntimeEnv?.env,
        signal: run.controller.signal,
      })) {
        attachModelId([event], payload.model);
        events.push(event);
        emitAskRunChunk(run, { type: "event", event });
      }
    });

    emitAskRunChunk(run, {
      type: "final",
      data: finalizeAskResponse(executionState, payload, events, turnContext),
    });
  } catch (error) {
    if (turnContext) {
      const message = run.controller.signal.aborted
        ? "stopped"
        : error instanceof Error
          ? error.message
          : String(error);
      const errorEvent: AgentEvent = {
        type: "error",
        runId: run.runId,
        message,
      };
      executionState.app.recordEvent(errorEvent, {
        sessionId: payload.threadId,
        input: payload.question,
      });
      events.push(errorEvent);
      emitAskRunChunk(run, { type: "event", event: errorEvent });
      emitAskRunChunk(run, {
        type: "final",
        data: finalizeAskResponse(executionState, payload, events, turnContext),
      });
    } else {
      emitAskRunChunk(run, {
        type: "fatal",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    run.done = true;
    windowlessDelay(() => {
      registryForState(state).delete(run.runId);
    }, 10 * 60 * 1000);
  }
}

function askExecutionState(state: BridgeState, payload: BridgeAskPayload): BridgeState {
  if (!payload.kernel || payload.kernel === state.kernel) {
    return state;
  }
  const scopedState = {
    ...state,
    settings: {
      ...state.settings,
      kernel: payload.kernel,
    },
    kernel: payload.kernel,
  } satisfies BridgeState;
  recreateBridgeApp(scopedState);
  return scopedState;
}

function streamBackgroundAskRun(run: BackgroundAskRun, response: ServerResponse): Promise<void> {
  response.writeHead(200, {
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "content-type": "application/x-ndjson; charset=utf-8",
  });
  response.flushHeaders?.();
  response.socket?.setNoDelay(true);

  return new Promise((resolve) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      run.subscribers.delete(sendChunk);
      response.end();
      resolve();
    };
    const sendChunk = (chunk: AskStreamChunk) => {
      if (closed) return;
      response.write(`${JSON.stringify(chunk)}\n`);
      (response as ServerResponse & { flush?: () => void }).flush?.();
      if (chunk.type === "final" || chunk.type === "fatal") {
        queueMicrotask(close);
      }
    };
    response.once("close", close);

    for (const chunk of run.chunks) {
      if (closed) break;
      sendChunk(chunk);
    }
    if (run.done) {
      close();
      return;
    }
    run.subscribers.add(sendChunk);
  });
}

function emitAskRunChunk(run: BackgroundAskRun, chunk: AskStreamChunk): void {
  run.chunks.push(chunk);
  for (const subscriber of run.subscribers) {
    subscriber(chunk);
  }
}

function findBackgroundAskRun(
  state: BridgeState,
  query: { runId?: string; threadId?: string },
): BackgroundAskRun | undefined {
  const registry = registryForState(state);
  if (query.runId) {
    return registry.get(query.runId);
  }
  if (!query.threadId) {
    return undefined;
  }
  return [...registry.values()]
    .filter((run) => run.threadId === query.threadId && !run.done)
    .sort((left, right) => right.runId.localeCompare(left.runId))[0];
}

function registryForState(state: BridgeState): Map<string, BackgroundAskRun> {
  let registry = askRunRegistries.get(state);
  if (!registry) {
    registry = new Map();
    askRunRegistries.set(state, registry);
  }
  return registry;
}

function createBackgroundRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function windowlessDelay(callback: () => void, delayMs: number): void {
  setTimeout(callback, delayMs).unref?.();
}

export function persistSnapshotAttachments(snapshot: BrowserPageSnapshot, state: BridgeState): void {
  if (!snapshot.attachments?.length) {
    return;
  }

  const uploadRoot = bridgeDataPath(state, "uploads");
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

function prepareAskState(state: BridgeState, payload: BridgeAskPayload): BridgeTurnContext {
  const turnComputerSnapshot = hasComputerState(payload.computerSnapshot)
    ? payload.computerSnapshot
    : {};
  state.snapshot = payload.snapshot;
  state.computerSnapshot = turnComputerSnapshot;
  state.model = payload.model;
  state.saveCandidateNote = payload.saveCandidateNote;
  syncBridgeWorkingState(state.app, {
    sessionId: payload.threadId,
    selectedModel: payload.model,
  });

  return {
    threadId: payload.threadId,
    model: payload.model,
    snapshot: payload.snapshot,
    computerSnapshot: turnComputerSnapshot,
    policyOverrides: buildAskPolicyOverrides(payload),
  };
}

function buildAskPolicyOverrides(_payload: BridgeAskPayload): PolicyRule[] {
  const policyOverrides: PolicyRule[] = [];
  return policyOverrides;
}

function finalizeAskResponse(
  state: BridgeState,
  payload: BridgeAskPayload,
  events: AgentEvent[],
  turnContext: BridgeTurnContext,
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
    knowledge: listKnowledgeInventoryDocuments(state),
    knowledgeLedgers: state.app.knowledge.snapshotLedgers(),
    artifacts: state.app.artifacts.list(),
    workingState: state.app.workingState.get(),
    computerState: turnContext.computerSnapshot,
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
