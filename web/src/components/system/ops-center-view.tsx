import { AlertCircle, Bot, CheckCircle2, ChevronRight, CircleDot, Clock3, Database, Images, ListChecks, MessageSquare } from "lucide-react";
import type { AgentEventRecord, ApprovalRecord, BridgeSettings, ExecutionRecord, RunRecord, SkillRecord, DeveloperSession } from "../../bridge";
import { formatDate } from "../../format";
import { compactIdentifier } from "./system-views";

type OpsCenterProps = {
  runs: RunRecord[];
  executions: ExecutionRecord[];
  approvals: ApprovalRecord[];
  events: AgentEventRecord[];
  skills: SkillRecord[];
  tools: Record<string, unknown>[];
  developerSessions: DeveloperSession[];
  settings?: BridgeSettings;
  contextRecords?: Record<string, unknown>[];
  saving?: boolean;
  onUpdateDiagnostics?(patch: {
    providerHttpCaptureEnabled?: boolean;
    codexRawEventCaptureEnabled?: boolean;
  }): void;
};

type RunSourceId = "agent" | "rooms" | "developer" | "system";

const RUN_SOURCE_DEFS: Array<{ id: RunSourceId; label: string; icon: typeof Bot }> = [
  { id: "agent", label: "Agent", icon: Bot },
  { id: "rooms", label: "Rooms", icon: MessageSquare },
  { id: "developer", label: "Developer", icon: Images },
  { id: "system", label: "System", icon: Database },
];

const OPS_COPY = {
  "zh-CN": {
    overview: "运行总览",
    metrics: "运行指标",
    selectedRun: "重点运行",
    selectedRunMeta: "重点运行元信息",
    inspector: "运行侧栏",
    systemHealthy: "运行状态正常",
    needsAttention: "有失败运行需要查看",
    needsApproval: "有审批待处理",
    noRunTitle: "还没有运行记录",
    noRunShort: "暂无运行",
    emptyDescription: "Agent、群聊、开发者模式和系统动作的运行记录会在这里聚合。",
    empty: "暂无",
    noSource: "无来源",
    modelUnknown: "模型未知",
    timeUnknown: "时间未知",
    runs: "运行",
    latest: "最近",
    failures: "失败",
    running: "个运行中",
    failureMeta: "没有失败记录",
    approvals: "审批",
    pendingApprovalMeta: "等待处理",
    noPendingApproval: "暂无待处理",
    capture: "采集",
    captureOn: "开启",
    captureOff: "关闭",
    source: "来源",
    model: "模型",
    duration: "耗时",
    events: "事件",
    tools: "工具",
    result: "结果",
    modelResponse: "模型回复",
    noResult: "这次运行没有保存可读的最终回复。",
    context: "上下文",
    noContext: "没有记录可读上下文。",
    trace: "排查信息",
    toolCalls: "工具调用",
    noToolCalls: "没有捕获到工具调用。",
    executions: "执行记录",
    noExecutions: "没有这次运行的执行记录。",
    eventStream: "事件流",
    noReadableEvents: "没有可读事件。",
    eventsUnit: "个事件",
    recordsUnit: "条",
    readableUnit: "可读",
    totalUnit: "全部",
    recentRuns: "最近运行",
    recentRunsHint: "选择一条记录查看上下文、结果和排查线索。",
    sources: "来源分布",
    diagnostics: "诊断采集",
    captureRunning: "请求和原始事件正在按设置采集。",
    captureHint: "只在需要排查模型网关或工具调用时开启。",
    on: "on",
    off: "off",
    httpsCapture: "HTTPS 采集",
    mitmRunning: "mitmproxy 运行中",
    providerCapture: "模型网关流量采集",
    rawEvents: "原始事件历史",
    rawEventsMeta: "保存 prompt、工具参数和扩展事件",
    proxy: "代理",
    captureStatus: "状态",
    disabled: "disabled",
    injected: "injected",
    notInjected: "not injected",
    warning: "警告",
    inventory: "运行上下文",
    inventoryHint: "当前运行能关联到的上下文和能力。",
    skills: "Skills",
    developerSessions: "开发会话",
    availableUnit: "可用",
  },
  en: {
    overview: "Operations overview",
    metrics: "Run metrics",
    selectedRun: "Focus run",
    selectedRunMeta: "Focus run metadata",
    inspector: "Run inspector",
    systemHealthy: "Operations healthy",
    needsAttention: "Failed runs need review",
    needsApproval: "Approvals pending",
    noRunTitle: "No runs yet",
    noRunShort: "No runs",
    emptyDescription: "Agent, room, developer-mode, and system runs will be collected here.",
    empty: "empty",
    noSource: "No source",
    modelUnknown: "Unknown model",
    timeUnknown: "Unknown time",
    runs: "Runs",
    latest: "Latest",
    failures: "Failures",
    running: "running",
    failureMeta: "No failed records",
    approvals: "Approvals",
    pendingApprovalMeta: "Needs action",
    noPendingApproval: "None pending",
    capture: "Capture",
    captureOn: "On",
    captureOff: "Off",
    source: "Source",
    model: "Model",
    duration: "Duration",
    events: "Events",
    tools: "Tools",
    result: "Result",
    modelResponse: "model response",
    noResult: "No readable final response was saved for this run.",
    context: "Context",
    noContext: "No readable context was recorded.",
    trace: "Debug details",
    toolCalls: "Tool calls",
    noToolCalls: "No tool calls captured.",
    executions: "Executions",
    noExecutions: "No execution records for this run.",
    eventStream: "Event stream",
    noReadableEvents: "No readable events.",
    eventsUnit: "events",
    recordsUnit: "records",
    readableUnit: "readable",
    totalUnit: "total",
    recentRuns: "Recent runs",
    recentRunsHint: "Select a record to inspect context, result, and debug clues.",
    sources: "Sources",
    diagnostics: "Diagnostic capture",
    captureRunning: "Requests and raw events are being captured by settings.",
    captureHint: "Turn this on only when debugging model gateways or tool calls.",
    on: "on",
    off: "off",
    httpsCapture: "HTTPS capture",
    mitmRunning: "mitmproxy running",
    providerCapture: "provider traffic capture",
    rawEvents: "Raw event history",
    rawEventsMeta: "stores prompts, tool args, extended events",
    proxy: "Proxy",
    captureStatus: "Status",
    disabled: "disabled",
    injected: "injected",
    notInjected: "not injected",
    warning: "Warning",
    inventory: "Run context",
    inventoryHint: "Context and capabilities linked to the current run.",
    skills: "Skills",
    developerSessions: "Developer sessions",
    availableUnit: "available",
  },
};

export function OpsCenterSettingsPanel(props: {
  selectedRunId: string;
  language?: "zh-CN" | "en";
  onSelectRun(runId: string): void;
} & OpsCenterProps) {
  const language = props.language || "zh-CN";
  const copy = OPS_COPY[language];
  const pendingApprovals = props.approvals.filter((approval) => approval.status === "pending");
  const allRuns = sortRunsNewestFirst(props.runs);
  const fallbackRunId = allRuns[0] ? runRecordKey(allRuns[0]) : "";
  const activeRunId = props.selectedRunId && allRuns.some((run) => runRecordKey(run) === props.selectedRunId)
    ? props.selectedRunId
    : fallbackRunId;
  const failedRuns = allRuns.filter((run) => isFailedStatus(run.status)).length;
  const runningRuns = allRuns.filter((run) => isRunningStatus(run.status)).length;
  const latestRun = allRuns[0];

  return (
    <div className="ops-settings-page">
      <section className="ops-settings-hero" aria-label={copy.overview}>
        <div className="ops-settings-metric-grid" aria-label={copy.metrics}>
          <OpsMetricTile
            label={copy.runs}
            value={String(allRuns.length)}
            meta={latestRun ? `${copy.latest} ${formatDate(String(latestRun.finishedAt || latestRun.startedAt || latestRun.createdAt || ""))}` : copy.noRunShort}
          />
          <OpsMetricTile
            label={copy.failures}
            value={String(failedRuns)}
            meta={runningRuns ? `${runningRuns} ${copy.running}` : copy.failureMeta}
            tone={failedRuns ? "danger" : "good"}
          />
          <OpsMetricTile
            label={copy.approvals}
            value={String(pendingApprovals.length)}
            meta={pendingApprovals.length ? copy.pendingApprovalMeta : copy.noPendingApproval}
            tone={pendingApprovals.length ? "warning" : "good"}
          />
          <OpsMetricTile
            label={copy.events}
            value={String(props.events.length)}
            meta={`${props.executions.length} ${copy.executions}`}
          />
        </div>
      </section>

      <section className="ops-settings-run-log" aria-label={copy.recentRuns}>
        <header className="ops-settings-log-head">
          <div>
            <h2>{copy.recentRuns}</h2>
          </div>
          <span>{allRuns.length}</span>
        </header>

        <div className="ops-settings-run-list">
          {allRuns.length ? allRuns.map((run, index) => {
            const runId = runRecordKey(run) || `run-${index}`;
            return (
              <OpsSettingsRunItem
                copy={copy}
                contextRecords={props.contextRecords ?? []}
                events={props.events}
                executions={props.executions}
                index={index}
                key={runId}
                language={language}
                open={runId === activeRunId}
                run={run}
                runId={runId}
                onOpen={props.onSelectRun}
              />
            );
          }) : (
            <div className="ops-settings-empty">
              <strong>{copy.noRunTitle}</strong>
              <span>{copy.emptyDescription}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function OpsSettingsRunItem(props: {
  copy: typeof OPS_COPY["zh-CN"];
  contextRecords: Record<string, unknown>[];
  events: AgentEventRecord[];
  executions: ExecutionRecord[];
  index: number;
  language: "zh-CN" | "en";
  open: boolean;
  run: RunRecord;
  runId: string;
  onOpen(runId: string): void;
}) {
  const runEvents = props.events.filter((event) => event.runId === props.runId);
  const readableEvents = runEvents.filter((event) => event.type !== "assistant.delta");
  const runExecutions = props.executions.filter((execution) =>
    execution.runId === props.runId || execution.id === props.runId,
  );
  const toolEvents = runEvents.filter((event) => event.type === "tool.started" || event.type === "tool.finished");
  const contextRecords = props.contextRecords.filter((record) => String(record.runId || "") === props.runId);
  const finalAnswer = finalModelResponseText(props.run, runEvents);
  const sourceId = runSourceId(props.run);
  const status = localizedStatus(props.run.status, props.language);
  const date = formatDate(String(props.run.finishedAt || props.run.endedAt || props.run.startedAt || props.run.createdAt || ""));
  const storedEventCount = Number(props.run.eventCount || 0);
  const eventCount = runEvents.length || (Number.isFinite(storedEventCount) ? storedEventCount : 0);
  const toolCount = toolEvents.length || (Array.isArray(props.run.toolIds) ? props.run.toolIds.length : 0);
  const stateTone = isFailedStatus(props.run.status) ? "danger" : isRunningStatus(props.run.status) ? "live" : "good";
  const input = runInput(props.run);

  return (
    <details
      className="ops-settings-run-entry"
      data-state={stateTone}
      open={props.open}
      onToggle={(event) => {
        if (event.currentTarget.open) {
          props.onOpen(props.runId);
        }
      }}
    >
      <summary className="ops-settings-run-summary" title={runMeta(props.run)}>
        <RunStateIcon status={props.run.status} />
        <span className="ops-settings-run-summary-main">
          <strong>{runTitle(props.run)}</strong>
          <small>{[
            localizedSourceLabel(sourceId, props.language),
            status,
            date || props.copy.timeUnknown,
          ].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="ops-settings-run-summary-stats">
          <span>{props.run.modelId ? String(props.run.modelId) : props.copy.modelUnknown}</span>
          <span>{String(eventCount)} {props.copy.events}</span>
        </span>
        <ChevronRight className="ops-settings-run-chevron" size={17} />
      </summary>

      <div className="ops-settings-run-detail">
        <div className="ops-settings-detail-facts" aria-label={props.copy.selectedRunMeta}>
          <span><strong>{props.copy.source}</strong>{localizedSourceLabel(sourceId, props.language)}</span>
          <span><strong>{props.copy.duration}</strong>{runDuration(props.run)}</span>
          <span><strong>{props.copy.tools}</strong>{String(toolCount)}</span>
          <span><strong>Run</strong>{compactIdentifier(props.runId)}</span>
        </div>

        <section className="ops-settings-detail-section">
          <OpsSettingsTitle title={props.copy.result} meta={finalAnswer ? props.copy.modelResponse : props.copy.empty} />
          <div className="ops-readable-block ops-settings-readable">
            {finalAnswer || props.copy.noResult}
          </div>
        </section>

        <details className="ops-settings-inline-foldout">
          <summary>
            <span>
              <strong>{props.copy.context}</strong>
            </span>
            <ChevronRight className="ops-settings-foldout-chevron" size={16} />
          </summary>
          <div className="ops-readable-block ops-settings-readable">
            {input || props.copy.noContext}
          </div>
          {contextRecords.length ? (
            <div className="ops-settings-context-records">
              {contextRecords.map((record, index) => (
                <ContextRecordRow key={String(record.runId || record.id || index)} record={record} />
              ))}
            </div>
          ) : null}
        </details>

        <div className="ops-settings-foldout-grid">
          <details className="ops-settings-inline-foldout">
            <summary>
              <span>
                <strong>{props.copy.toolCalls}</strong>
              </span>
              <small className="ops-settings-foldout-meta">{toolEvents.length}</small>
              <ChevronRight className="ops-settings-foldout-chevron" size={16} />
            </summary>
            <div className="ops-record-list">
              {toolEvents.length ? toolEvents.map((event, index) => (
                <EventRecordItem key={`${event.type || "tool"}-${event.at || index}`} event={event} index={index} />
              )) : (
                <EmptyState label={props.copy.noToolCalls} />
              )}
            </div>
          </details>

          <details className="ops-settings-inline-foldout">
            <summary>
              <span>
                <strong>{props.copy.executions}</strong>
              </span>
              <small className="ops-settings-foldout-meta">{runExecutions.length}</small>
              <ChevronRight className="ops-settings-foldout-chevron" size={16} />
            </summary>
            <div className="ops-record-list">
              {runExecutions.length ? runExecutions.map((execution, index) => (
                <ExecutionRecordItem key={execution.id || execution.runId || index} execution={execution} index={index} />
              )) : (
                <EmptyState label={props.copy.noExecutions} />
              )}
            </div>
          </details>

          <details className="ops-settings-inline-foldout">
            <summary>
              <span>
                <strong>{props.copy.eventStream}</strong>
              </span>
              <small className="ops-settings-foldout-meta">{readableEvents.length}/{runEvents.length}</small>
              <ChevronRight className="ops-settings-foldout-chevron" size={16} />
            </summary>
            <div className="ops-record-list">
              {readableEvents.length ? readableEvents.map((event, index) => (
                <EventRecordItem key={`${event.type || "event"}-${event.at || index}`} event={event} index={index} />
              )) : (
                <EmptyState label={props.copy.noReadableEvents} />
              )}
            </div>
          </details>
        </div>
      </div>
    </details>
  );
}

export function OpsCenterSidebar(props: {
  runs: RunRecord[];
  approvals: ApprovalRecord[];
  selectedRunId: string;
  onSelectRun(runId: string): void;
}) {
  const pendingApprovals = props.approvals.filter((approval) => approval.status === "pending");
  const allRuns = sortRunsNewestFirst(props.runs);
  const fallbackRunId = allRuns[0] ? runRecordKey(allRuns[0]) : "";
  const activeRunId = props.selectedRunId && allRuns.some((run) => runRecordKey(run) === props.selectedRunId)
    ? props.selectedRunId
    : fallbackRunId;
  const groups = RUN_SOURCE_DEFS
    .map((source) => ({
      ...source,
      runs: allRuns.filter((run) => runSourceId(run) === source.id),
    }))
    .filter((group) => group.runs.length);

  return (
    <section className="sidebar-panel-space ops-sidebar-space" aria-label="Ops Center">
      <div className="sidebar-space-header">
        <div>
          <div className="sidebar-space-title">Ops Center</div>
        </div>
      </div>
      <div className="sidebar-library-panel ops-sidebar-panel">
        <div className="sidebar-library-files ops-sidebar-files">
          {groups.length ? groups.map((group) => (
            <div className="ops-sidebar-source-group" key={group.id}>
              <div className="ops-sidebar-source" aria-hidden="true">
                <group.icon size={15} />
                <span>{group.label}</span>
                <span>{group.runs.length}</span>
              </div>
              <div className="ops-sidebar-children">
                {group.runs.map((run, index) => {
                  const runId = runRecordKey(run) || `${group.id}-${index}`;
                  return (
                    <button
                      className="sidebar-library-file sidebar-tree-file ops-sidebar-run"
                      data-active={runId === activeRunId ? "true" : "false"}
                      key={runId}
                      type="button"
                      onClick={() => props.onSelectRun(runId)}
                      title={runMeta(run)}
                    >
                      <RunStateIcon status={run.status} />
                      <span>
                        <strong>{runTitle(run)}</strong>
                        <small>{runMeta(run)}</small>
                      </span>
                      <span>{String(run.status || "unknown")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )) : (
            <div className="sidebar-library-empty">No runs yet.</div>
          )}

          {pendingApprovals.length ? (
            <div className="ops-sidebar-source-group">
              <div className="ops-sidebar-source" aria-hidden="true">
                <ListChecks size={15} />
                <span>Approvals</span>
                <span>{pendingApprovals.length}</span>
              </div>
              <div className="ops-sidebar-children">
                {pendingApprovals.map((approval, index) => (
                  <div className="sidebar-library-file sidebar-tree-file ops-sidebar-approval" key={approval.id || index}>
                    <AlertCircle size={15} />
                    <span>{approval.title || approval.toolId || "Approval"}</span>
                    <span>pending</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function OpsCenterView(props: { selectedRunId: string } & OpsCenterProps) {
  const pendingApprovals = props.approvals.filter((approval) => approval.status === "pending");
  const allRuns = sortRunsNewestFirst(props.runs);
  const activeRun =
    allRuns.find((run) => runRecordKey(run) === props.selectedRunId) ||
    allRuns[0];
  const activeRunId = activeRun ? runRecordKey(activeRun) : "";
  const runEvents = props.events.filter((event) => !activeRunId || event.runId === activeRunId);
  const readableEvents = runEvents.filter((event) => event.type !== "assistant.delta");
  const runExecutions = props.executions.filter((execution) =>
    !activeRunId || execution.runId === activeRunId || execution.id === activeRunId,
  );
  const toolEvents = runEvents.filter((event) => event.type === "tool.started" || event.type === "tool.finished");
  const finalAnswer = activeRun ? finalModelResponseText(activeRun, runEvents) : "";
  const capture = props.settings?.providerHttpCapture;
  const captureEnabled = Boolean(capture?.enabled);
  const rawCaptureEnabled = captureEnabled && Boolean(props.settings?.codexRawEventCaptureEnabled);
  const contextRecords = activeRunId
    ? (props.contextRecords ?? []).filter((record) => String(record.runId || "") === activeRunId)
    : (props.contextRecords ?? []);

  return (
    <section className="view-panel tab-view ops-center-view ops-product-view" data-view="ops">
      <div className="ops-document-pane">
        <main className="ops-run-canvas" aria-label="Execution timeline">
          <article className="ops-run-document">
            {activeRun ? (
              <>
                <div className="ops-run-heading">
                  <RunStateIcon status={activeRun.status} />
                  <div>
                    <h2>{runTitle(activeRun)}</h2>
                    <p>{[runSourceLabel(activeRun), runMeta(activeRun)].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>

                <section className="ops-document-section">
                  <div className="ops-run-summary-grid">
                    <SummaryCell label="Source" value={runSourceLabel(activeRun)} />
                    <SummaryCell label="Status" value={String(activeRun.status || "unknown")} />
                    <SummaryCell label="Model" value={String(activeRun.modelId || "unknown")} />
                    <SummaryCell label="Duration" value={runDuration(activeRun)} />
                    <SummaryCell label="Run" value={activeRunId ? compactIdentifier(activeRunId) : "unknown"} />
                    <SummaryCell label="Session" value={activeRun.sessionId ? compactIdentifier(activeRun.sessionId) : "unknown"} />
                    <SummaryCell label="Events" value={String(runEvents.length || activeRun.eventCount || 0)} />
                    <SummaryCell label="Tools" value={String(toolEvents.length || (Array.isArray(activeRun.toolIds) ? activeRun.toolIds.length : 0))} />
                  </div>
                </section>

                <section className="ops-document-section">
                  <PanelTitle title="Task" meta={activeRunId ? compactIdentifier(activeRunId) : ""} />
                  <div className="ops-readable-block">
                    {runInput(activeRun) || "没有记录可读任务输入。"}
                  </div>
                </section>

                <section className="ops-document-section">
                  <PanelTitle title="Result" meta={finalAnswer ? "model response" : "empty"} />
                  <div className="ops-readable-block">
                    {finalAnswer || "这次运行没有保存可读的最终回复。"}
                  </div>
                </section>

                <section className="ops-document-section">
                  <PanelTitle title="Tool Calls" meta={`${toolEvents.length} events`} />
                  <div className="ops-record-list">
                    {toolEvents.length ? toolEvents.map((event, index) => (
                      <EventRecordItem key={`${event.type || "tool"}-${event.at || index}`} event={event} index={index} />
                    )) : (
                      <EmptyState label="No tool calls captured." />
                    )}
                  </div>
                </section>

                <section className="ops-document-section">
                  <PanelTitle title="Executions" meta={`${runExecutions.length} records`} />
                  <div className="ops-record-list">
                    {runExecutions.length ? runExecutions.map((execution, index) => (
                      <ExecutionRecordItem key={execution.id || execution.runId || index} execution={execution} index={index} />
                    )) : (
                      <EmptyState label="No execution records for this run." />
                    )}
                  </div>
                </section>

                <section className="ops-document-section">
                  <PanelTitle title="Event Stream" meta={`${readableEvents.length} readable / ${runEvents.length} total`} />
                  <div className="ops-record-list">
                    {readableEvents.length ? readableEvents.map((event, index) => (
                      <EventRecordItem key={`${event.type || "event"}-${event.at || index}`} event={event} index={index} />
                    )) : (
                      <EmptyState label="No readable events for this run." />
                    )}
                  </div>
                </section>
              </>
            ) : (
              <div className="knowledge-empty ops-empty-state">
                <span>选择一条运行记录查看执行过程、工具调用和状态。</span>
              </div>
            )}
          </article>
        </main>

        <aside className="ops-properties-panel" aria-label="Operations inspector">
          <section>
            <PanelTitle title="Run Ledger" meta={`${allRuns.length} runs`} />
            <div className="paper-row-list compact">
              <InfoRow title="Sessions" meta={`${new Set(allRuns.map((run) => run.sessionId).filter(Boolean)).size} sessions`} />
              <InfoRow title="Executions" meta={`${props.executions.length} records`} />
              <InfoRow title="Events" meta={`${props.events.length} records`} />
            </div>
          </section>

          <section>
            <PanelTitle title="Capture" meta={captureEnabled ? "on" : "off"} />
            <div className="paper-row-list compact">
              <ToggleRow
                title="HTTPS capture"
                meta={capture?.running ? "mitmproxy running" : "provider traffic capture"}
                checked={captureEnabled}
                disabled={props.saving}
                onChange={(checked) => props.onUpdateDiagnostics?.({
                  providerHttpCaptureEnabled: checked,
                  codexRawEventCaptureEnabled: checked ? rawCaptureEnabled : false,
                })}
              />
              <ToggleRow
                title="Raw event history"
                meta="stores prompts, tool args, extended events"
                checked={rawCaptureEnabled}
                disabled={props.saving || !captureEnabled}
                onChange={(checked) => props.onUpdateDiagnostics?.({ codexRawEventCaptureEnabled: captureEnabled && checked })}
              />
              <InfoRow title="Proxy" meta={capture?.proxyUrl || "http://127.0.0.1:9080"} />
              <InfoRow title="Status" meta={[capture?.status || "disabled", capture?.injected ? "injected" : "not injected"].join(" · ")} />
              {capture?.warning ? <div className="paper-empty-row">{capture.warning}</div> : null}
            </div>
          </section>

          <section>
            <PanelTitle title="Context" meta={`${contextRecords.length} matching records`} />
            <div className="paper-row-list compact">
              {contextRecords.length ? contextRecords.map((record, index) => (
                <ContextRecordRow key={String(record.runId || record.id || index)} record={record} />
              )) : (
                <EmptyState label="No context records for this run." />
              )}
            </div>
          </section>

          <section>
            <PanelTitle title="Capabilities" meta={`${props.skills.length + props.tools.length} bound`} />
            <div className="paper-row-list compact">
              <InfoRow title="Skills" meta={`${props.skills.length} available`} />
              <InfoRow title="Tools" meta={`${props.tools.length} available`} />
            </div>
          </section>

          <section>
            <PanelTitle title="Approvals" meta={`${pendingApprovals.length} pending`} />
            <div className="paper-row-list compact">
              {pendingApprovals.length ? pendingApprovals.map((approval, index) => (
                <InfoRow key={approval.id || index} title={approval.title || approval.toolId || "Approval"} meta={[approval.status, approval.toolId].filter(Boolean).join(" · ")} />
              )) : (
                <EmptyState label="No pending approvals." />
              )}
            </div>
          </section>

          <section>
            <PanelTitle title="Developer Sessions" meta={`${props.developerSessions.length} active`} />
            <div className="paper-row-list compact">
              {props.developerSessions.length ? props.developerSessions.map((session) => (
                <InfoRow key={session.id} title={session.title} meta={[session.status, session.core?.name || session.core?.kernel, formatDate(session.updatedAt)].filter(Boolean).join(" · ")} />
              )) : (
                <EmptyState label="No developer sessions yet." />
              )}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function RunStateIcon(props: { status?: string }) {
  const state = String(props.status || "unknown").toLowerCase();
  if (state === "failed" || state === "error") {
    return <AlertCircle className="ops-run-state-icon" data-state={state} size={15} />;
  }
  if (state === "succeeded" || state === "success" || state === "finished" || state === "completed") {
    return <CheckCircle2 className="ops-run-state-icon" data-state="succeeded" size={15} />;
  }
  if (state === "running" || state === "active") {
    return <CircleDot className="ops-run-state-icon" data-state="running" size={15} />;
  }
  return <Clock3 className="ops-run-state-icon" data-state={state} size={15} />;
}

function PanelTitle(props: { title: string; meta: string }) {
  return (
    <header className="paper-panel-title">
      <h2>{props.title}</h2>
      <span>{props.meta}</span>
    </header>
  );
}

function EventRecordItem(props: { event: AgentEventRecord; index: number }) {
  return (
    <details className="ops-record-item">
      <summary>
        <RunStateIcon status={eventStatus(props.event)} />
        <span>
          <strong>{eventTitle(props.event)}</strong>
          <small>{eventSummary(props.event) || `event ${props.index + 1}`}</small>
        </span>
        <time>{formatDate(String(props.event.at || ""))}</time>
      </summary>
      <pre className="ops-json-block">{safeJson(props.event)}</pre>
    </details>
  );
}

function ExecutionRecordItem(props: { execution: ExecutionRecord; index: number }) {
  return (
    <details className="ops-record-item">
      <summary>
        <RunStateIcon status={props.execution.status} />
        <span>
          <strong>{props.execution.title || props.execution.kind || props.execution.eventType || `Execution ${props.index + 1}`}</strong>
          <small>{readableExecutionSummary(props.execution)}</small>
        </span>
        <time>{formatDate(String(props.execution.at || ""))}</time>
      </summary>
      <pre className="ops-json-block">{safeJson(props.execution)}</pre>
    </details>
  );
}

function SummaryCell(props: { label: string; value: string }) {
  return (
    <div className="ops-summary-cell">
      <span>{props.label}</span>
      <strong>{props.value || "unknown"}</strong>
    </div>
  );
}

function InfoRow(props: { title: string; meta: string }) {
  return (
    <div className="paper-row small">
      <span>
        <strong>{props.title}</strong>
        <small>{props.meta || "ready"}</small>
      </span>
    </div>
  );
}

function ToggleRow(props: { title: string; meta: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="paper-row small ops-toggle-row">
      <span>
        <strong>{props.title}</strong>
        <small>{props.meta}</small>
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

function OpsSettingsTitle(props: { title: string; meta: string }) {
  return (
    <header className="ops-settings-section-title">
      <h3>{props.title}</h3>
      <span>{props.meta}</span>
    </header>
  );
}

function OpsMetricTile(props: { label: string; value: string; meta: string; tone?: "good" | "warning" | "danger" | "muted" }) {
  return (
    <div className="ops-settings-metric" data-tone={props.tone || "neutral"}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.meta}</small>
    </div>
  );
}

function ContextRecordRow(props: { record: Record<string, unknown> }) {
  const record = props.record;
  const context = record.context && typeof record.context === "object" && !Array.isArray(record.context)
    ? record.context as Record<string, unknown>
    : {};
  const title = String(record.title || context.summary || record.userInput || "Context snapshot");
  const meta = [
    record.runId ? `run ${compactIdentifier(record.runId)}` : "",
    record.modelId,
    formatDate(String(record.updatedAt || record.finishedAt || record.startedAt || "")),
  ].filter(Boolean).join(" · ");

  return <InfoRow title={summarizeText(title, 96) || "Context snapshot"} meta={meta || "stored"} />;
}

function EmptyState(props: { label: string }) {
  return <div className="paper-empty-row">{props.label}</div>;
}

function sortRunsNewestFirst(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((left, right) => recordTimestamp(right) - recordTimestamp(left));
}

function recordTimestamp(record: Record<string, unknown>): number {
  const value = String(record.updatedAt || record.finishedAt || record.endedAt || record.at || record.startedAt || record.createdAt || "");
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function runTitle(run: RunRecord): string {
  return summarizeText(runInput(run) || run.summary || run.runId || run.id || "Agent run", 72);
}

function runInput(run: RunRecord): string {
  return String(run.input || "").trim();
}

function runDuration(run: RunRecord): string {
  const startedAt = Date.parse(String(run.startedAt || run.createdAt || ""));
  const finishedAt = Date.parse(String(run.finishedAt || run.endedAt || run.updatedAt || ""));
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return "unknown";
  const seconds = Math.round((finishedAt - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function runMeta(run: RunRecord): string {
  const runId = run.runId || run.id || "";
  const time = run.finishedAt || run.endedAt || run.startedAt || run.createdAt || "";
  return [run.status || "unknown", runId ? `run ${compactIdentifier(runId)}` : "", formatDate(time)].filter(Boolean).join(" · ");
}

function runRecordKey(run: RunRecord): string {
  return run.runId || run.id || run.sessionId || String(run.startedAt || run.createdAt || "");
}

function runSourceId(run: RunRecord): RunSourceId {
  const text = `${run.runId || ""} ${run.id || ""} ${run.sessionId || ""} ${run.input || ""} ${run.activity || ""}`.toLowerCase();
  if (text.includes("room_run") || text.includes("room member") || text.includes("rooms")) return "rooms";
  if (text.includes("developer_thread") || text.includes("developer mode") || text.includes("开发者模式") || text.includes("browser")) return "developer";
  if (text.includes("settings") || text.includes("install") || text.includes("capture") || text.includes("diagnostic")) return "system";
  return "agent";
}

function runSourceLabel(run: RunRecord): string {
  return RUN_SOURCE_DEFS.find((source) => source.id === runSourceId(run))?.label || "Agent";
}

function localizedSourceLabel(sourceId: RunSourceId, language: "zh-CN" | "en"): string {
  if (language === "en") {
    return RUN_SOURCE_DEFS.find((source) => source.id === sourceId)?.label || "Agent";
  }
  if (sourceId === "rooms") return "群聊";
  if (sourceId === "developer") return "开发";
  if (sourceId === "system") return "系统";
  return "智能体";
}

function localizedStatus(status: unknown, language: "zh-CN" | "en"): string {
  const state = String(status || "unknown").toLowerCase();
  if (language === "en") {
    if (state === "succeeded" || state === "success" || state === "finished" || state === "completed") return "succeeded";
    if (state === "failed" || state === "error") return "failed";
    if (state === "running" || state === "active") return "running";
    return state;
  }
  if (state === "succeeded" || state === "success" || state === "finished" || state === "completed") return "成功";
  if (state === "failed" || state === "error") return "失败";
  if (state === "running" || state === "active") return "运行中";
  if (state === "pending" || state === "queued") return "等待中";
  return state === "unknown" ? "未知" : state;
}

function isFailedStatus(status: unknown): boolean {
  const state = String(status || "").toLowerCase();
  return state === "failed" || state === "error";
}

function isRunningStatus(status: unknown): boolean {
  const state = String(status || "").toLowerCase();
  return state === "running" || state === "active";
}

function finalModelResponseText(run: RunRecord, events: AgentEventRecord[]): string {
  const summary = typeof run.summary === "string" ? run.summary.trim() : "";
  if (summary) return summary;
  for (const event of [...events].reverse()) {
    const text = event.type === "model.response" && event.response ? event.response.text : "";
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }
  const assistantText = events
    .filter((event) => event.type === "assistant.delta" && typeof event.text === "string")
    .map((event) => event.text)
    .join("");
  return assistantText.trim();
}

function eventTitle(event: AgentEventRecord): string {
  const type = String(event.type || "");
  if (type === "turn.finished") return "Run finished";
  if (type === "turn.started") return "Run started";
  if (type === "model.requested") return "Model request";
  if (type === "model.response") return "Model response";
  if (type === "context.assembled") return "Context assembled";
  if (type === "tool.started") return `Tool started · ${stringField(event, "toolId") || "tool"}`;
  if (type === "tool.finished") return `Tool finished · ${stringField(event, "toolId") || "tool"}`;
  if (type === "skill.discovered") return "Skills discovered";
  if (type === "runtime.diagnostic") return stringField(event, "name") || "Runtime diagnostic";
  if (type === "error") return "Run error";
  return type || "Event";
}

function eventSummary(event: AgentEventRecord): string {
  const type = String(event.type || "");
  if (type === "model.response") return summarizeText(String(event.response?.text || ""), 240) || "response saved";
  if (type === "model.requested") return summarizeText(stringFromPath(event, ["request", "userInput"]), 240) || stringFromPath(event, ["request", "modelId"]) || "request sent";
  if (type === "context.assembled") return stringFromPath(event, ["context", "summary"]) || "context assembled";
  if (type === "tool.started") return summarizeJson(event.input, 240) || "tool call started";
  if (type === "tool.finished") return summarizeJson((event.result as Record<string, unknown> | undefined)?.value, 240) || stringFromPath(event, ["result", "error"]) || "tool call finished";
  if (type === "runtime.diagnostic") return summarizeJson(event.data, 240) || "diagnostic event";
  if (type === "skill.discovered") {
    const skills = Array.isArray(event.skills) ? event.skills : [];
    return skills.map((skill) => typeof skill === "object" && skill ? String((skill as Record<string, unknown>).name || (skill as Record<string, unknown>).id || "") : "").filter(Boolean).slice(0, 6).join(" · ") || `${skills.length} skills`;
  }
  if (type === "error") return stringField(event, "message") || "failed";
  return formatDate(String(event.at || "")) || type || "event";
}

function eventStatus(event: AgentEventRecord): string {
  const type = String(event.type || "");
  if (type === "error") return "failed";
  if (type === "tool.finished") {
    const result = event.result && typeof event.result === "object" ? event.result as Record<string, unknown> : {};
    return result.ok === false ? "failed" : "succeeded";
  }
  if (type === "tool.started" || type === "model.requested") return "running";
  return "succeeded";
}

function readableExecutionSummary(execution: ExecutionRecord): string {
  return [execution.status, execution.kind || execution.eventType, summarizeJson(execution.data, 220)].filter(Boolean).join(" · ") || "queued";
}

function summarizeText(value: unknown, maxLength: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function summarizeJson(value: unknown, maxLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return summarizeText(value, maxLength);
  try {
    return summarizeText(JSON.stringify(value), maxLength);
  } catch {
    return "";
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function stringFromPath(record: Record<string, unknown>, path: string[]): string {
  let value: unknown = record;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" ? value : "";
}
