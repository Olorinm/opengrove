import { AlertCircle, CheckCircle2, Circle, File as FileIcon, FileText, Globe2, Image as ImageIcon, LoaderCircle, Monitor, Package, Search, Sparkles, Wrench } from "lucide-react";
import type { StoredMessage } from "../../bridge";
import { formatDate, sortedArtifacts, summarize, uniqueIds } from "../../format";
import { artifactKind, artifactTitle } from "../knowledge/knowledge-model";

export type OverviewStatus = "done" | "running" | "pending" | "blocked";

export interface OverviewProgressItem {
  id: string;
  title: string;
  status: OverviewStatus;
  detail?: string;
}

export interface OverviewResultItem {
  id: string;
  title: string;
  detail: string;
  kind: string;
}

export interface OverviewSourceItem {
  id: string;
  title: string;
  kind: "browser" | "computer" | "search" | "skill" | "tool" | "kernel";
  detail?: string;
}

export interface OverviewMetaItem {
  id: string;
  label: string;
  value: string;
  detail?: string;
  status?: OverviewStatus;
}

export function OverviewMetaRow(props: { item: OverviewMetaItem }) {
  return (
    <div className="overview-meta-row" data-status={props.item.status || "pending"}>
      <span className="overview-meta-label">{props.item.label}</span>
      <span className="overview-meta-copy">
        <span className="overview-meta-value">{props.item.value}</span>
        {props.item.detail ? <span className="overview-meta-detail">{props.item.detail}</span> : null}
      </span>
    </div>
  );
}

export function OverviewProgressRow(props: { item: OverviewProgressItem }) {
  return (
    <div className="overview-progress-row" data-status={props.item.status}>
      <span className="overview-progress-icon" aria-hidden="true">
        {overviewStatusIcon(props.item.status)}
      </span>
      <span className="overview-progress-copy">
        <span className="overview-progress-title">{props.item.title}</span>
        {props.item.detail ? <span className="overview-progress-detail">{props.item.detail}</span> : null}
      </span>
    </div>
  );
}

export function OverviewResultRow(props: { item: OverviewResultItem }) {
  return (
    <div className="overview-result-row">
      <span className="overview-result-icon" data-kind={props.item.kind} aria-hidden="true">
        {overviewResultIcon(props.item)}
      </span>
      <span className="overview-result-copy">
        <span className="overview-result-title">{props.item.title}</span>
        {props.item.detail ? <span className="overview-result-detail">{props.item.detail}</span> : null}
      </span>
    </div>
  );
}

export function OverviewSourceRow(props: { item: OverviewSourceItem }) {
  return (
    <div className="overview-source-row">
      <span className="overview-source-icon" data-kind={props.item.kind} aria-hidden="true">
        {overviewSourceIcon(props.item.kind)}
      </span>
      <span className="overview-source-copy">
        <span className="overview-source-title">{props.item.title}</span>
        {props.item.detail ? <span className="overview-source-detail">{props.item.detail}</span> : null}
      </span>
    </div>
  );
}

export function buildOverviewRuntimeItems(input: {
  currentSession: any;
  latestRun: any;
  runtimeBlocker: any;
  kernelLabel?: string;
  pendingApprovals: any[];
  messageCount: number;
  sending: boolean;
}): OverviewMetaItem[] {
  const items: OverviewMetaItem[] = [];

  if (input.kernelLabel) {
    items.push({
      id: "kernel",
      label: "内核",
      value: input.kernelLabel,
      detail: "已连接",
      status: input.runtimeBlocker ? "blocked" : "running",
    });
  }

  items.push({
    id: "thread",
    label: "线程",
    value: input.messageCount ? `${input.messageCount} 条消息` : "新线程",
    detail: input.sending ? "运行中" : input.messageCount ? "当前对话" : "还没有开始",
    status: input.sending ? "running" : input.messageCount ? "done" : "pending",
  });

  if (input.latestRun) {
    const runTitle = summarize(input.latestRun.summary || input.latestRun.input || input.latestRun.id || "当前运行", 46);
    items.push({
      id: "run",
      label: "运行",
      value: runTitle,
      detail: [input.latestRun.status, input.latestRun.modelId, formatDate(input.latestRun.updatedAt || input.latestRun.startedAt)]
        .filter(Boolean)
        .join(" · "),
      status: overviewStatusFromRun(input.latestRun, input.runtimeBlocker),
    });
  } else {
    items.push({
      id: "run",
      label: "运行",
      value: input.sending ? "正在启动" : "没有运行",
      detail: input.sending ? "等待流式响应" : "发送消息后开始记录",
      status: input.sending ? "running" : "pending",
    });
  }

  if (input.currentSession) {
    items.push({
      id: "session",
      label: "会话",
      value: summarize(input.currentSession.title || input.currentSession.id || "当前会话", 46),
      detail: [input.currentSession.status, input.currentSession.activity, formatDate(input.currentSession.updatedAt)]
        .filter(Boolean)
        .join(" · "),
      status: input.currentSession.status === "running" ? "running" : "pending",
    });
  }

  if (input.pendingApprovals.length) {
    items.push({
      id: "approval",
      label: "确认",
      value: `${input.pendingApprovals.length} 个待确认`,
      detail: summarize(input.pendingApprovals[0]?.title || input.pendingApprovals[0]?.toolId || "", 52),
      status: "pending",
    });
  }

  return items.slice(0, 4);
}

export function buildOverviewProgressItems(input: {
  messages: StoredMessage[];
  workingState: any;
  latestRun: any;
  pendingApprovals: any[];
  events: any[];
  runtimeBlocker: any;
  hasThreadActivity: boolean;
  sending: boolean;
}): OverviewProgressItem[] {
  const checklistItems = extractChecklistProgressItems(input.messages);
  if (checklistItems.length) {
    return limitOverviewItems([
      ...checklistItems,
      ...buildRuntimeProgressItems(input).filter((item) => item.status === "running" || item.status === "blocked"),
    ]);
  }
  return limitOverviewItems(buildRuntimeProgressItems(input));
}

export function buildRuntimeProgressItems(input: {
  messages: StoredMessage[];
  workingState: any;
  latestRun: any;
  pendingApprovals: any[];
  events: any[];
  runtimeBlocker: any;
  hasThreadActivity: boolean;
  sending: boolean;
}): OverviewProgressItem[] {
  const items: OverviewProgressItem[] = [];
  if (!input.hasThreadActivity) {
    return [
      {
        id: "empty-thread",
        title: "等待你发送第一条任务",
        status: "pending",
        detail: "",
      },
    ];
  }
  if (input.sending && !input.latestRun) {
    items.push({
      id: "starting",
      title: "正在启动当前任务",
      status: "running",
      detail: "",
    });
  }
  const focusTitle =
    summarize(input.workingState.activeGoal || input.workingState.taskSummary || input.latestRun?.summary || input.latestRun?.input || "", 72);

  if (focusTitle) {
    items.push({
      id: "focus",
      title: focusTitle,
      status: overviewStatusFromRun(input.latestRun, input.runtimeBlocker),
      detail: input.latestRun?.modelId || input.workingState.selectedModel || "",
    });
  }

  if (input.pendingApprovals.length) {
    items.push({
      id: "approvals",
      title: `${input.pendingApprovals.length} 个动作等待确认`,
      status: "pending",
      detail: summarize(input.pendingApprovals[0]?.title || input.pendingApprovals[0]?.toolId || "", 58),
    });
  }

  const activityItems = buildOverviewActivityItems(input.messages, input.events, input.latestRun?.id);
  items.push(...activityItems);

  if (input.runtimeBlocker) {
    items.push({
      id: "runtime-blocker",
      title: "运行被暂停",
      status: "blocked",
      detail: summarize(formatRuntimeBlockerSummary(input.runtimeBlocker), 72),
    });
  }

  return items.length
    ? dedupeOverviewProgress(items)
    : [
        {
          id: "idle",
          title: "等待下一轮任务",
          status: "pending",
          detail: "",
        },
      ];
}

export function extractChecklistProgressItems(messages: StoredMessage[]): OverviewProgressItem[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }
    const text = messageText(message);
    const items = text
      .split(/\r?\n/)
      .map((line, lineIndex) => checklistItemFromLine(line, lineIndex))
      .filter((item): item is OverviewProgressItem => Boolean(item));
    if (items.length >= 2) {
      return items;
    }
  }
  return [];
}

export function checklistItemFromLine(line: string, lineIndex: number): OverviewProgressItem | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(?:[-*]\s*)?(?:\[(x|X| |-|~)\]|(✅|☑|✓|✔|☐|○|◯|●|◉))\s*(?:\d+[.)]\s*)?(.+)$/);
  if (!match) {
    return null;
  }
  const marker = match[1] || match[2] || "";
  const title = cleanOverviewTitle(match[3]);
  if (!title) {
    return null;
  }
  return {
    id: `checklist-${lineIndex}-${title}`,
    title: summarize(title, 72),
    status: overviewStatusFromChecklistMarker(marker),
  };
}

export function buildOverviewActivityItems(messages: StoredMessage[], events: any[], latestRunId: string | undefined): OverviewProgressItem[] {
  const items = new Map<string, OverviewProgressItem>();
  const latestMessages = messages.filter((message) => message.role === "assistant").slice(-3);
  for (const message of latestMessages) {
    for (const part of message.parts || []) {
      if (part.type === "skill") {
        const title = cleanOverviewTitle(part.title || part.skillName || part.skillId || "Skill");
        items.set(`skill:${part.skillId || title}`, {
          id: `skill:${part.skillId || title}`,
          title: title.startsWith("/") ? title : `使用 ${title}`,
          status: overviewStatusFromPartStatus(part.status),
          detail: part.model || part.context || "",
        });
      }
      if (part.type === "tool") {
        const toolId = part.toolId || "tool";
        items.set(`tool:${toolId}`, {
          id: `tool:${toolId}`,
          title: formatToolIdLabel(toolId),
          status: overviewStatusFromPartStatus(part.status || (part.phase === "call" ? "running" : "")),
          detail: part.error ? summarize(part.error, 64) : "",
        });
      }
    }
  }

  const runEvents = Array.isArray(events)
    ? events.filter((event) => (latestRunId ? event?.runId === latestRunId : true)).slice(-30)
    : [];
  for (const event of runEvents) {
    if (event?.type !== "tool.started" && event?.type !== "tool.finished") {
      continue;
    }
    const toolId = event.toolId || "tool";
    items.set(`tool:${toolId}`, {
      id: `tool:${toolId}`,
      title: formatToolIdLabel(toolId),
      status: event.type === "tool.started" ? "running" : event.result?.ok ? "done" : "blocked",
      detail: event.result?.error ? summarize(event.result.error, 64) : "",
    });
  }

  return Array.from(items.values());
}

export function buildOverviewResultItems(artifacts: any[]): { visible: OverviewResultItem[]; hiddenCount: number } {
  const items = sortedArtifacts(artifacts).map((artifact) => {
    const title = artifactTitle(artifact);
    return {
      id: artifact.id || title,
      title,
      detail: [artifact.type, formatDate(artifact.updatedAt || artifact.createdAt)].filter(Boolean).join(" · "),
      kind: artifactKind(artifact),
    };
  });
  return {
    visible: items.slice(0, 6),
    hiddenCount: Math.max(0, items.length - 6),
  };
}

export function filterOverviewArtifacts(artifacts: any[], messages: StoredMessage[], threadId: string, runId: string): any[] {
  const contextArtifactIds = new Set<string>();
  for (const message of messages) {
    for (const artifact of message.context?.artifacts || []) {
      if (artifact?.id) {
        contextArtifactIds.add(artifact.id);
      }
    }
  }
  return artifacts.filter((artifact) => {
    if (!artifact) {
      return false;
    }
    if (contextArtifactIds.has(artifact.id)) {
      return true;
    }
    if (threadId && (artifact.threadId === threadId || artifact.provenance?.threadId === threadId)) {
      return true;
    }
    if (runId && (artifact.runId === runId || artifact.provenance?.runId === runId)) {
      return true;
    }
    return false;
  });
}

export function buildOverviewSourceItems(input: {
  messages: StoredMessage[];
  workingState: any;
  latestRun: any;
  skills: any[];
  tools: any[];
  events: any[];
  kernelLabel?: string;
  hasThreadActivity: boolean;
}): OverviewSourceItem[] {
  const sources = new Map<string, OverviewSourceItem>();
  const addSource = (item: OverviewSourceItem) => {
    if (!sources.has(item.id)) {
      sources.set(item.id, item);
    }
  };

  if (!input.hasThreadActivity) {
    return [];
  }

  if (input.workingState.activeSkillId || input.workingState.activePackId) {
    const skillId = input.workingState.activeSkillId || input.workingState.activePackId;
    addSource({
      id: `skill:${skillId}`,
      title: skillTitle(skillId, input.skills),
      kind: "skill",
      detail: input.workingState.activePackId ? "pack" : "skill",
    });
  }

  for (const message of input.messages.filter((message) => message.role === "assistant").slice(-4)) {
    for (const part of message.parts || []) {
      if (part.type === "skill") {
        addSource({
          id: `skill:${part.skillId || part.skillName || part.title}`,
          title: part.title || part.skillName || part.skillId || "Skill",
          kind: "skill",
          detail: part.source || part.context || "",
        });
      }
      if (part.type === "tool") {
        addSource(toolSourceItem(part.toolId, input.tools));
      }
    }
  }

  const runToolIds = Array.isArray(input.latestRun?.toolIds) ? input.latestRun.toolIds : [];
  for (const toolId of runToolIds) {
    addSource(toolSourceItem(toolId, input.tools));
  }

  const recentToolIds = uniqueIds(
    (Array.isArray(input.events) ? input.events : [])
      .slice(-40)
      .map((event) => (event?.type === "tool.started" || event?.type === "tool.finished" ? event.toolId : ""))
      .filter(Boolean),
  );
  for (const toolId of recentToolIds) {
    addSource(toolSourceItem(toolId, input.tools));
  }

  if (!sources.size && input.kernelLabel) {
    addSource({
      id: "kernel",
      title: input.kernelLabel,
      kind: "kernel",
      detail: "",
    });
  }

  return Array.from(sources.values()).slice(0, 6);
}

export function overviewStatusIcon(status: OverviewStatus) {
  if (status === "done") {
    return <CheckCircle2 size={16} />;
  }
  if (status === "running") {
    return <LoaderCircle size={16} className="spin" />;
  }
  if (status === "blocked") {
    return <AlertCircle size={16} />;
  }
  return <Circle size={16} />;
}

export function overviewResultIcon(item: OverviewResultItem) {
  if (item.kind === "image") {
    return <ImageIcon size={16} />;
  }
  if (item.kind === "text" || item.kind === "markdown") {
    return <FileText size={16} />;
  }
  return <FileIcon size={16} />;
}

export function overviewSourceIcon(kind: OverviewSourceItem["kind"]) {
  if (kind === "browser") {
    return <Globe2 size={16} />;
  }
  if (kind === "search") {
    return <Search size={16} />;
  }
  if (kind === "computer") {
    return <Monitor size={16} />;
  }
  if (kind === "skill") {
    return <Sparkles size={16} />;
  }
  if (kind === "tool") {
    return <Wrench size={16} />;
  }
  return <Package size={16} />;
}

export function overviewStatusFromRun(run: any, runtimeBlocker: any): OverviewStatus {
  if (runtimeBlocker || run?.status === "failed") {
    return "blocked";
  }
  if (run?.status === "running") {
    return "running";
  }
  if (run?.status === "waiting_for_approval") {
    return "pending";
  }
  if (run?.status === "succeeded") {
    return "done";
  }
  return run ? "pending" : "running";
}

export function overviewStatusFromPartStatus(status: string): OverviewStatus {
  if (["complete", "finished", "loaded", "staged", "approved", "succeeded", "success"].includes(status)) {
    return "done";
  }
  if (["running", "started", "invoked"].includes(status)) {
    return "running";
  }
  if (["blocked", "incomplete", "rejected", "failed", "error"].includes(status)) {
    return "blocked";
  }
  return "pending";
}

export function overviewStatusFromChecklistMarker(marker: string): OverviewStatus {
  if (/x/i.test(marker) || ["✅", "☑", "✓", "✔", "●", "◉"].includes(marker)) {
    return "done";
  }
  if (marker === "-" || marker === "~") {
    return "running";
  }
  return "pending";
}

export function toolSourceItem(toolId: string, tools: any[]): OverviewSourceItem {
  const id = toolId || "tool";
  const spec = tools.find((tool) => tool?.id === id);
  const kind = classifyToolKind(id);
  return {
    id: `tool:${id}`,
    title: toolSourceTitle(id, spec, kind),
    kind,
    detail: spec?.activity || spec?.risk || "",
  };
}

export function classifyToolKind(toolId: string): OverviewSourceItem["kind"] {
  const normalized = String(toolId || "").toLowerCase();
  if (normalized.includes("browser")) return "browser";
  if (normalized.includes("computer")) return "computer";
  if (normalized.includes("search") || normalized.includes("web")) return "search";
  if (normalized.includes("skill")) return "skill";
  return "tool";
}

export function toolSourceTitle(toolId: string, spec: any, kind: OverviewSourceItem["kind"]): string {
  if (kind === "browser") return spec?.title || "Browser 技能";
  if (kind === "computer") return spec?.title || "Computer Use";
  if (kind === "search") return spec?.title || "网页搜索";
  return spec?.title || formatToolIdLabel(toolId);
}

export function formatToolIdLabel(toolId: string): string {
  const normalized = String(toolId || "tool");
  const known: Record<string, string> = {
    "browser.open": "打开网页",
    "browser.act": "浏览器操作",
    "computer.observe": "观察电脑",
    "computer.act": "电脑操作",
    "memory.write": "写入记忆",
    "artifact.annotation": "保存批注",
    "host_ui.request_user_input": "等待选择",
  };
  return known[normalized] || normalized.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function skillTitle(skillId: string, skills: any[]): string {
  const skill = skills.find((item) => item?.id === skillId || item?.name === skillId);
  return skill?.title || skill?.name || skillId;
}

export function messageText(message: StoredMessage): string {
  const textParts = (message.parts || [])
    .filter((part) => part?.type === "text")
    .map((part: any) => part.text || "")
    .join("");
  return textParts || message.text || "";
}

export function cleanOverviewTitle(value: string): string {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function limitOverviewItems(items: OverviewProgressItem[]): OverviewProgressItem[] {
  return dedupeOverviewProgress(items).slice(0, 5);
}

export function dedupeOverviewProgress(items: OverviewProgressItem[]): OverviewProgressItem[] {
  const seen = new Set<string>();
  const result: OverviewProgressItem[] = [];
  for (const item of items) {
    const key = cleanOverviewTitle(item.title).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}


export function formatRuntimeBlockerSummary(blocker: any): string {
  if (!blocker) return "";
  if (blocker?.data?.needsReobserve) return "Needs attention: 界面快照已变化，先重新观察";
  const message = blocker?.data?.message || blocker?.title || blocker?.status;
  return message ? `Needs attention: ${message}` : "Needs attention: runtime blocked";
}

export function formatRuntimeBlockerMeta(blocker: any): string {
  return blocker?.data?.needsReobserve ? "next: re-observe" : "";
}
