import { formatDate, formatExecutionSummary, formatJson, formatReobserveText, sortedExecutions, sortedRuns, summarize, uniqueIds } from "../../format";

export function isPinned(artifact: { id?: string }, workingState: any): boolean {
  return workingState.pinnedArtifactIds.includes(artifact.id);
}

export function isWorking(artifact: { id?: string }, workingState: any): boolean {
  return workingState.workingArtifactIds.includes(artifact.id);
}

export function buildArtifactTags(artifact: any): string[] {
  const tags = Array.isArray(artifact.tags) ? artifact.tags.map(String) : [];
  return uniqueIds(tags);
}

export function summarizeArtifactText(artifact: any): string {
  const text =
    artifact?.data?.markdown ||
    artifact?.data?.text ||
    artifact?.data?.summary ||
    artifact?.data?.observation ||
    artifact?.data?.rationale ||
    artifact?.data?.action ||
    artifact?.data?.description ||
    artifact?.content ||
    "";
  return typeof text === "string" ? summarize(text, 180) : "";
}

export function buildArtifactDetails(artifact: any): string {
  const lines: string[] = [];
  if (artifact.parentId) lines.push(`parent: ${artifact.parentId}`);
  if (Array.isArray(artifact.sourceRefs) && artifact.sourceRefs.length) {
    const first = artifact.sourceRefs[0];
    lines.push(`source: ${first.title || first.url || first.locator || "ref"}`);
  }
  if (Array.isArray(artifact.derivedFrom) && artifact.derivedFrom.length) {
    lines.push(`derived: ${artifact.derivedFrom.join(", ")}`);
  }
  if (typeof artifact?.data?.screenshotArtifactId === "string" && artifact.data.screenshotArtifactId) {
    lines.push(`screenshot: ${artifact.data.screenshotArtifactId}`);
  }
  return lines.join(" · ");
}

export function formatEventTitle(event: any): string {
  switch (event?.type) {
    case "turn.started":
      return "Turn Started";
    case "turn.finished":
      return "Turn Finished";
    case "context.assembled":
      return "Context Assembled";
    case "model.requested":
      return `Model Requested · ${event.request?.modelId || "unknown"}`;
    case "model.response":
      return "Model Responded";
    case "tool.started":
      return `Tool Started · ${event.toolId}`;
    case "tool.finished":
      return `Tool Finished · ${event.toolId}`;
    case "approval.requested":
      return `Approval Requested · ${event.request?.title || event.request?.toolId || event.request?.id}`;
    case "approval.resolved":
      return `Approval ${event.request?.status === "approved" ? "Approved" : "Rejected"}`;
    case "run.paused":
      return "Run Paused";
    case "run.resumed":
      return "Run Resumed";
    case "error":
      return "Run Error";
    default:
      return event?.type || "event";
  }
}

export function formatEventText(event: any): string {
  switch (event?.type) {
    case "context.assembled":
      return event.context?.summary || "Context assembled.";
    case "model.requested":
      return event.request?.userInput || "Model call requested.";
    case "tool.started":
      return summarize(formatJson(event.input), 160);
    case "tool.finished":
      return formatToolFinishedEventText(event);
    case "approval.requested":
    case "approval.resolved":
      return event.request?.reason || event.request?.toolId || event.request?.id || "";
    case "run.paused":
      return event.reason || event.approvalId || "";
    case "run.resumed":
      return event.reason || event.approvalId || "";
    case "error":
      return event.message || "";
    case "model.response":
      return summarize(event.response?.text || "", 160) || "Model response captured.";
    default:
      return "";
  }
}

export function formatToolFinishedEventText(event: any): string {
  const value = event?.result?.value;
  const reobserve = formatReobserveText(value);
  if (reobserve) {
    return reobserve;
  }
  return summarize(formatJson(value || event.result), 160);
}

export function buildRuntimeItems(props: { runs: any[]; executions: any[]; sessionId: string }) {
  const sessionRuns = sortedRuns(props.runs.filter((item) => !props.sessionId || item?.sessionId === props.sessionId)).slice(0, 3);
  const executionItems = sortedExecutions(props.executions.filter((item) => !props.sessionId || item?.sessionId === props.sessionId)).slice(0, 5);
  return { sessionRuns, executionItems };
}

export { formatDate, formatExecutionSummary, summarize };
