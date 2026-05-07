import { useState } from "react";
import { PanelSection } from "../shared/panel-section";
import {
  buildArtifactDetails,
  buildArtifactTags,
  buildRuntimeItems,
  formatDate,
  formatEventText,
  formatEventTitle,
  formatExecutionSummary,
  summarize,
  summarizeArtifactText,
} from "./helpers";

export function ArtifactCard(props: {
  artifact: any;
  onAddToComposer(artifact: any): void;
}) {
  const artifact = props.artifact;
  return (
    <div className="panel-item" data-artifact-id={artifact.id}>
      <div className="panel-item-title">{artifact.title || artifact.type || artifact.id}</div>
      <div className="panel-item-meta">{[artifact.id, artifact.type, formatDate(artifact.updatedAt || artifact.createdAt)].filter(Boolean).join(" · ")}</div>
      {artifactImageUri(artifact) ? (
        <img className="panel-artifact-image" src={artifactImageUri(artifact)} alt={artifact.title || artifact.id || "artifact"} />
      ) : null}
      <div className="panel-item-text">{summarizeArtifactText(artifact)}</div>
      {buildArtifactDetails(artifact) ? <div className="panel-item-meta">{buildArtifactDetails(artifact)}</div> : null}
      <div className="panel-tags">
        {buildArtifactTags(artifact).map((tag: string) => (
          <span key={tag} className="panel-tag">
            {tag}
          </span>
        ))}
      </div>
      <div className="panel-item-actions">
        <button className="ghost-button panel-action" type="button" onClick={() => props.onAddToComposer(artifact)}>
          加入对话
        </button>
      </div>
    </div>
  );
}

function artifactImageUri(artifact: any): string {
  const imageAsset = Array.isArray(artifact?.assets)
    ? artifact.assets.find((asset: any) => asset?.kind === "image" && typeof asset.uri === "string")
    : null;
  return artifact?.preview?.imageUri || artifact?.data?.imageUri || imageAsset?.uri || "";
}

export function ApprovalCard(props: { approval: any; mode: "actions" | "summary"; onResolve(action: "approve" | "reject", response?: unknown): void }) {
  const [userInputResponse, setUserInputResponse] = useState("");
  const asksForUserInput = isUserInputApproval(props.approval);

  return (
    <div className="panel-item" data-approval-id={props.approval.id} data-mode={props.mode}>
      <div className="panel-item-title">{props.approval.title || props.approval.kind || props.approval.toolId || props.approval.id}</div>
      <div className="panel-item-meta">
        {[
          approvalKindLabel(props.approval.kind),
          props.approval.status || "pending",
          props.approval.toolId,
          formatDate(props.approval.updatedAt || props.approval.createdAt),
        ].filter(Boolean).join(" · ")}
      </div>
      {props.approval.reason ? <div className="panel-item-text">{props.approval.reason}</div> : null}
      {props.mode === "actions" && asksForUserInput ? (
        <label className="thread-approval-input-label compact">
          <span>{userInputPromptLabel(props.approval)}</span>
          <textarea
            className="thread-approval-input"
            value={userInputResponse}
            onChange={(event) => setUserInputResponse(event.target.value)}
            placeholder="输入要回给 Codex 的内容"
            rows={3}
          />
        </label>
      ) : null}
      <div className="panel-item-actions">
        {props.mode === "actions" ? (
          <>
            <button
              className="ghost-button panel-action"
              type="button"
              onClick={() => props.onResolve("approve", asksForUserInput ? buildUserInputApprovalResponse(props.approval, userInputResponse) : undefined)}
            >
              确认
            </button>
            <button className="ghost-button panel-action" type="button" onClick={() => props.onResolve("reject")}>
              拒绝
            </button>
          </>
        ) : (
          <div className="panel-item-meta panel-item-hint">回到对话里处理</div>
        )}
      </div>
    </div>
  );
}

function approvalKindLabel(kind: string | undefined): string {
  if (kind === "command") return "命令";
  if (kind === "file_change") return "文件";
  if (kind === "permission_scope") return "权限";
  if (kind === "user_input") return "提问";
  if (kind === "routine_step") return "例程";
  if (kind === "memory_write") return "记忆";
  if (kind === "browser_action") return "浏览器";
  if (kind === "computer_action") return "电脑";
  if (kind === "tool") return "工具";
  return kind || "";
}

function isUserInputApproval(approval: any): boolean {
  const input = recordValue(approval?.input);
  const method = stringValue(input.method);
  return (
    approval?.kind === "user_input" ||
    approval?.toolId === "user_input" ||
    method === "item/tool/requestUserInput" ||
    method === "mcpServer/elicitation/request"
  );
}

function userInputPromptLabel(approval: any): string {
  const input = recordValue(approval?.input);
  const params = recordValue(input.params);
  return stringValue(params.title) || stringValue(params.prompt) || stringValue(params.message) || "回答";
}

function buildUserInputApprovalResponse(approval: any, text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const input = recordValue(approval?.input);
  const params = recordValue(input.params);
  const firstQuestionId = firstUserInputQuestionId(params);
  const keyed = firstQuestionId ? { [firstQuestionId]: trimmed } : { answer: trimmed, text: trimmed };
  return {
    text: trimmed,
    answers: keyed,
    content: keyed,
  };
}

function firstUserInputQuestionId(params: Record<string, unknown>): string {
  const questions = Array.isArray(params.questions) ? params.questions : [];
  for (const question of questions) {
    const id = stringValue(recordValue(question).id);
    if (id) {
      return id;
    }
  }
  return "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function ComputerStateCard(props: { state: any }) {
  return (
    <div className="panel-item">
      <div className="panel-item-title">{[props.state.app, props.state.windowTitle].filter(Boolean).join(" · ") || "Computer State"}</div>
      <div className="panel-item-meta">{[props.state.focusedElement ? `focus: ${props.state.focusedElement}` : "", props.state.observedAt ? formatDate(props.state.observedAt) : ""].filter(Boolean).join(" · ")}</div>
      <div className="panel-item-text">
        {[props.state.observation, props.state.url, props.state.screenshotArtifactId ? `screenshot: ${props.state.screenshotArtifactId}` : "", props.state.elements.length ? `elements: ${props.state.elements.length}` : ""]
          .filter(Boolean)
          .join("\n")}
      </div>
    </div>
  );
}

export function RuntimePanel(props: { session: any; runs: any[]; executions: any[]; sessionId: string }) {
  const { sessionRuns, executionItems } = buildRuntimeItems(props);

  if (!props.session && sessionRuns.length === 0 && executionItems.length === 0) {
    return <div>还没有 runtime state</div>;
  }

  return (
    <>
      {props.session ? (
        <div className="panel-item">
          <div className="panel-item-title">Session · {props.session.id}</div>
          <div className="panel-item-meta">{[props.session.status, props.session.activity, formatDate(props.session.updatedAt)].filter(Boolean).join(" · ")}</div>
          <div className="panel-item-text">
            {[
              props.session.lastUserInput ? `last input: ${summarize(props.session.lastUserInput, 90)}` : "",
              props.session.activeRunId ? `active run: ${props.session.activeRunId}` : "",
              props.session.latestRunId ? `latest run: ${props.session.latestRunId}` : "",
            ]
              .filter(Boolean)
              .join("\n")}
          </div>
          <div className="panel-tags">
            <span className="panel-tag">runs:{Array.isArray(props.session.runIds) ? props.session.runIds.length : 0}</span>
          </div>
        </div>
      ) : null}

      {sessionRuns.map((run) => (
        <div key={run.id} className="panel-item">
          <div className="panel-item-title">Run · {run.id}</div>
          <div className="panel-item-meta">{[run.status, run.activity, run.modelId, formatDate(run.updatedAt || run.startedAt)].filter(Boolean).join(" · ")}</div>
          <div className="panel-item-text">
            {[run.summary || summarize(run.input || "", 120), run.pauseReason ? `waiting: ${run.pauseReason}` : "", run.error ? `error: ${run.error}` : ""].filter(Boolean).join("\n")}
          </div>
        </div>
      ))}

      {executionItems.map((item, index) => (
        <div key={`${item.id || item.eventType}_${index}`} className="panel-item">
          <div className="panel-item-title">{item.title || item.eventType || item.id}</div>
          <div className="panel-item-meta">{[item.kind, item.status, formatDate(item.at)].filter(Boolean).join(" · ")}</div>
          <div className="panel-item-text">{formatExecutionSummary(item)}</div>
          {item.runId ? (
            <div className="panel-tags">
              <span className="panel-tag">{item.runId}</span>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

export function TimelineCard(props: { event: any }) {
  return (
    <div className="panel-item">
      <div className="panel-item-title">{formatEventTitle(props.event)}</div>
      <div className="panel-item-meta">{[props.event.runId, formatDate(props.event.at || props.event.request?.updatedAt || props.event.request?.createdAt)].filter(Boolean).join(" · ")}</div>
      <div className="panel-item-text">{formatEventText(props.event)}</div>
    </div>
  );
}

export { PanelSection };
