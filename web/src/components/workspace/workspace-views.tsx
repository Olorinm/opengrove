import type { StoredMessage } from "../../bridge";
import { ListChecks, Plus } from "lucide-react";
import { createEmptyWorkingState } from "../../format";
import {
  OverviewMetaRow,
  OverviewProgressRow,
  OverviewResultRow,
  OverviewSourceRow,
  buildOverviewProgressItems,
  buildOverviewResultItems,
  buildOverviewRuntimeItems,
  buildOverviewSourceItems,
  filterOverviewArtifacts,
} from "./overview-model";

export function WorkspaceInspector(props: {
  workingState: any;
  currentSession: any;
  latestRun: any;
  runtimeBlocker: any;
  kernelLabel?: string;
  threadId: string;
  sending: boolean;
  messages: StoredMessage[];
  artifacts: any[];
  skills: any[];
  tools: any[];
  events: any[];
  pendingApprovals: any[];
  onOpenChat(): void;
}) {
  const hasThreadActivity = props.messages.length > 0 || props.sending;
  const currentRun = hasThreadActivity ? props.latestRun : null;
  const currentSession = hasThreadActivity ? props.currentSession : null;
  const effectiveWorkingState = hasThreadActivity ? props.workingState : createEmptyWorkingState();
  const threadArtifacts = hasThreadActivity
    ? filterOverviewArtifacts(props.artifacts, props.messages, props.threadId, currentRun?.id || "")
    : [];
  const threadEvents = currentRun?.id
    ? props.events.filter((event) => event?.runId === currentRun.id)
    : hasThreadActivity
      ? props.events
      : [];
  const progressItems = buildOverviewProgressItems({
    messages: props.messages,
    workingState: effectiveWorkingState,
    latestRun: currentRun,
    pendingApprovals: props.pendingApprovals,
    events: threadEvents,
    runtimeBlocker: props.runtimeBlocker,
    hasThreadActivity,
    sending: props.sending,
  });
  const resultItems = buildOverviewResultItems(threadArtifacts);
  const sourceItems = buildOverviewSourceItems({
    messages: props.messages,
    workingState: effectiveWorkingState,
    latestRun: currentRun,
    skills: props.skills,
    tools: props.tools,
    events: threadEvents,
    kernelLabel: props.kernelLabel,
    hasThreadActivity,
  });
  const completedCount = progressItems.filter((item) => item.status === "done").length;
  const progressSubtitle = !hasThreadActivity
    ? "还没有任务进度"
    : progressItems.length
      ? `共 ${progressItems.length} 个任务，已经完成 ${completedCount} 个`
      : "还没有任务进度";
  const runtimeItems = buildOverviewRuntimeItems({
    currentSession,
    latestRun: currentRun,
    runtimeBlocker: props.runtimeBlocker,
    kernelLabel: props.kernelLabel,
    pendingApprovals: props.pendingApprovals,
    messageCount: props.messages.length,
    sending: props.sending,
  });

  return (
    <div className="overview-panel">
      <div className="overview-toolbar">
        <div className="overview-tab">
          <ListChecks size={16} />
          <span>概览</span>
        </div>
        <div className="overview-toolbar-actions">
          <button className="overview-icon-button" type="button" onClick={props.onOpenChat} title="继续补充任务" aria-label="继续补充任务">
            <Plus size={17} />
          </button>
        </div>
      </div>

      <section className="overview-section">
        <div className="overview-section-title">当前状态</div>
        <div className="overview-meta-list">
          {runtimeItems.map((item) => <OverviewMetaRow key={item.id} item={item} />)}
        </div>
      </section>

      <section className="overview-section">
        <div className="overview-section-title">进度</div>
        <div className="overview-progress-subtitle">{progressSubtitle}</div>
        <div className="overview-progress-list">
          {progressItems.length ? (
            progressItems.map((item) => <OverviewProgressRow key={item.id} item={item} />)
          ) : (
            <div className="overview-empty">等待下一轮任务开始</div>
          )}
        </div>
      </section>

      <section className="overview-section">
        <div className="overview-section-title">生成结果</div>
        <div className="overview-result-list">
          {resultItems.visible.length ? (
            resultItems.visible.map((item) => <OverviewResultRow key={item.id} item={item} />)
          ) : (
            <div className="overview-empty">还没有生成结果</div>
          )}
        </div>
        {resultItems.hiddenCount > 0 ? <div className="overview-more">再显示 {resultItems.hiddenCount} 个</div> : null}
      </section>

      <section className="overview-section">
        <div className="overview-section-title">来源</div>
        <div className="overview-source-list">
          {sourceItems.length ? (
            sourceItems.map((item) => <OverviewSourceRow key={item.id} item={item} />)
          ) : (
            <div className="overview-empty">还没有来源记录</div>
          )}
        </div>
      </section>
    </div>
  );
}
