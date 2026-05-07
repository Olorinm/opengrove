import type { StoredMessage } from "../../bridge";
import { File as FileIcon, ListChecks, Maximize2, Plus } from "lucide-react";
import { createEmptyWorkingState, formatDate, hasRenderableComputerState, summarize } from "../../format";
import { computeRuntimeCount } from "../../runtime/ui-model";
import { artifactImagePreview, artifactTitle, buildKnowledgeInboxItems, filterKnowledgeDocuments, knowledgeDisplaySummary, knowledgeTypeLabel } from "../knowledge/knowledge-model";
import { PanelSection } from "../shared/panel-section";
import { ApprovalCard, ArtifactCard, ComputerStateCard, RuntimePanel, TimelineCard } from "./cards";
import { formatExecutionSummary } from "./helpers";
import { OverviewMetaRow, OverviewProgressRow, OverviewResultRow, OverviewSourceRow, buildOverviewProgressItems, buildOverviewResultItems, buildOverviewRuntimeItems, buildOverviewSourceItems, filterOverviewArtifacts, formatRuntimeBlockerMeta, formatRuntimeBlockerSummary } from "./overview-model";

export function HomeDashboardView(props: {
  workingState: any;
  currentSession: any;
  latestRun: any;
  runtimeBlocker: any;
  workingArtifacts: any[];
  pinnedArtifacts: any[];
  recentArtifacts: any[];
  pendingApprovals: any[];
  knowledge: any[];
  ledgers: any;
  computerState: any;
  sessions: any[];
  runs: any[];
  onOpenChat(): void;
  onOpenLibrary(): void;
  onOpenInbox(): void;
  onOpenArtifacts(): void;
  onRecordComputer(): void;
  onAddArtifactToComposer(artifact: any): void;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
}) {
  const inboxItems = buildKnowledgeInboxItems(props.knowledge, props.ledgers);
  const recentKnowledge = filterKnowledgeDocuments(props.knowledge, "recent", "").slice(0, 5);
  const focusTitle = props.workingState.activeGoal || props.latestRun?.summary || "继续你的 OpenGrove 工作";

  return (
    <section className="view-panel tab-view home-view" data-view="home">
      <div className="home-page">
        <header className="home-hero">
          <div>
            <div className="knowledge-eyebrow">首页</div>
            <h1>{summarize(focusTitle, 64)}</h1>
            <p>
              {[
                props.pendingApprovals.length ? `${props.pendingApprovals.length} 个待确认动作` : "",
                props.recentArtifacts.length ? `${props.recentArtifacts.length} 个最近产物` : "",
                props.currentSession?.status ? `session ${props.currentSession.status}` : "",
              ]
                .filter(Boolean)
                .join(" · ") || "当前没有阻塞项，可以从对话、资料库或产物继续。"}
            </p>
          </div>
          <div className="home-actions">
            <button className="ghost-button panel-action" type="button" onClick={props.onOpenChat}>
              继续对话
            </button>
            <button className="ghost-button panel-action" type="button" onClick={props.onOpenLibrary}>
              打开资料库
            </button>
            <button className="ghost-button panel-action" type="button" onClick={props.onOpenArtifacts}>
              查看产物
            </button>
          </div>
        </header>

        <div className="home-grid">
          <section className="home-section">
            <div className="home-section-header">
              <div>
                <h2>待处理</h2>
                <p>需要你明确看一眼的动作和知识建议。</p>
              </div>
              <button className="home-link-button" type="button" onClick={props.onOpenInbox}>
                收件箱
              </button>
            </div>
            <div className="home-stack">
              {props.pendingApprovals.slice(0, 2).map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  mode="summary"
                  onResolve={(action, response) => props.onResolveApproval(approval.id, action, response)}
                />
              ))}
              {inboxItems.slice(0, 3).map((item) => (
                <div className="home-row" key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.reason}</span>
                </div>
              ))}
              {!props.pendingApprovals.length && !inboxItems.length ? <div className="knowledge-empty">没有待处理项。</div> : null}
            </div>
          </section>

          <section className="home-section">
            <div className="home-section-header">
              <div>
                <h2>最近产物</h2>
                <p>需要时手动加入对话，加入后会显示在输入框上方。</p>
              </div>
              <button className="home-link-button" type="button" onClick={props.onOpenArtifacts}>
                全部
              </button>
            </div>
            <div className="home-artifact-list">
              {props.recentArtifacts.slice(0, 3).map((artifact) => (
                <div className="home-artifact-row" key={artifact.id}>
                  {artifactImagePreview(artifact) ? <img src={artifactImagePreview(artifact)} alt={artifactTitle(artifact)} /> : <FileIcon size={18} />}
                  <span>
                    <strong>{artifactTitle(artifact)}</strong>
                    <small>{[artifact.type, formatDate(artifact.updatedAt || artifact.createdAt)].filter(Boolean).join(" · ")}</small>
                  </span>
                  <button className="ghost-button panel-action" type="button" onClick={() => props.onAddArtifactToComposer(artifact)}>
                    加入
                  </button>
                </div>
              ))}
              {!props.recentArtifacts.length ? <div className="knowledge-empty">还没有产物。</div> : null}
            </div>
          </section>

          <section className="home-section">
            <div className="home-section-header">
              <div>
                <h2>最近知识</h2>
                <p>最近同步、创建或更新的页面。</p>
              </div>
              <button className="home-link-button" type="button" onClick={props.onOpenLibrary}>
                资料库
              </button>
            </div>
            <div className="home-stack">
              {recentKnowledge.map((document) => (
                <div className="home-row" key={document.id}>
                  <strong>{document.title || document.id}</strong>
                  <span>{[knowledgeTypeLabel(document.type), knowledgeDisplaySummary(document, 80)].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
              {!recentKnowledge.length ? <div className="knowledge-empty">还没有知识页面。</div> : null}
            </div>
          </section>

          <section className="home-section">
            <div className="home-section-header">
              <div>
                <h2>运行状态</h2>
                <p>只保留对继续工作有帮助的状态。</p>
              </div>
            </div>
            <div className="home-stack">
              {props.runtimeBlocker ? (
                <div className="home-row warn">
                  <strong>{props.runtimeBlocker.title || "运行阻塞"}</strong>
                  <span>{formatExecutionSummary(props.runtimeBlocker)}</span>
                </div>
              ) : null}
              {props.latestRun ? (
                <div className="home-row">
                  <strong>{props.latestRun.status || "run"}</strong>
                  <span>{summarize(props.latestRun.summary || props.latestRun.input || "", 140)}</span>
                </div>
              ) : null}
              {hasRenderableComputerState(props.computerState) ? (
                <button className="ghost-button panel-action" type="button" onClick={props.onRecordComputer}>
                  入库当前电脑观察
                </button>
              ) : null}
              {!props.runtimeBlocker && !props.latestRun ? <div className="knowledge-empty">还没有运行记录。</div> : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}



export function WorkspaceView(props: {
  workingState: any;
  currentSession: any;
  latestRun: any;
  runtimeBlocker: any;
  workingArtifacts: any[];
  pinnedArtifacts: any[];
  recentArtifacts: any[];
  pendingApprovals: any[];
  computerState: any;
  executions: any[];
  sessions: any[];
  runs: any[];
  runtimeItems: any[];
  onOpenChat(): void;
  onRecordComputer(): void;
  onAddArtifactToComposer(artifact: any): void;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
}) {
  const summaryLines = [
    props.workingState.taskSummary ? `Task: ${props.workingState.taskSummary}` : "Task: 未设置",
    props.workingState.activeGoal ? `Goal: ${props.workingState.activeGoal}` : "Goal: 未设置",
    props.workingState.selectedModel ? `Model: ${props.workingState.selectedModel}` : "",
    props.workingState.activePackId ? `Pack: ${props.workingState.activePackId}` : "",
    props.workingState.activeSkillId ? `Skill: ${props.workingState.activeSkillId}` : "",
    props.currentSession?.id ? `Session: ${props.currentSession.id}` : "",
    props.latestRun ? `Run: ${[props.latestRun.status, props.latestRun.modelId].filter(Boolean).join(" · ")}` : "",
    props.latestRun?.pauseReason ? `Waiting: ${props.latestRun.pauseReason}` : "",
    formatRuntimeBlockerSummary(props.runtimeBlocker),
    props.computerState.app ? `Computer: ${[props.computerState.app, props.computerState.windowTitle].filter(Boolean).join(" · ")}` : "",
    props.pendingApprovals.length ? `Pending approvals: ${props.pendingApprovals.length}` : "",
  ].filter(Boolean);

  const meta = [
    props.recentArtifacts.length ? `${props.recentArtifacts.length} recent artifacts` : "还没有 recent artifact",
    props.workingState.activePackId ? `pack: ${props.workingState.activePackId}` : "",
    props.workingState.activeSkillId ? `skill: ${props.workingState.activeSkillId}` : "",
    props.pendingApprovals.length ? `${props.pendingApprovals.length} 待确认` : "",
    props.workingState.selectedModel ? `model: ${props.workingState.selectedModel}` : "",
    props.currentSession?.status ? `session: ${props.currentSession.status}` : "",
    props.latestRun?.status ? `run: ${props.latestRun.status}` : "",
    formatRuntimeBlockerMeta(props.runtimeBlocker),
    props.computerState.app ? `computer: ${[props.computerState.app, props.computerState.windowTitle].filter(Boolean).join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="view-panel tab-view workspace-view" data-view="workspace">
      <div className="workspace-page">
        <section className="workspace-band">
          <div className="workspace-band-label">Workspace</div>
          <div className="workspace-band-title">{props.workingState.activeGoal || props.workingState.taskSummary || "还没有 active goal"}</div>
          <div className="workspace-band-meta">{meta}</div>
          <div className="panel-actions">
            <button className="ghost-button panel-action" type="button" onClick={props.onOpenChat}>
              继续对话
            </button>
            <button className="ghost-button panel-action" type="button" onClick={props.onRecordComputer}>
              入库观察
            </button>
          </div>
        </section>

        <div className="workspace-grid">
          <div className="workspace-column">
            <PanelSection title="Explicit Context" count={props.workingArtifacts.length}>
              {props.workingArtifacts.length ? (
                props.workingArtifacts.map((artifact) => (
	                  <ArtifactCard
	                    key={artifact.id}
	                    artifact={artifact}
	                    onAddToComposer={props.onAddArtifactToComposer}
	                  />
                ))
              ) : (
                <div>还没有明确加入的上下文</div>
              )}
            </PanelSection>

            <PanelSection title="Pinned Context" count={props.pinnedArtifacts.length}>
              {props.pinnedArtifacts.length ? (
                props.pinnedArtifacts.map((artifact) => (
	                  <ArtifactCard
	                    key={artifact.id}
	                    artifact={artifact}
	                    onAddToComposer={props.onAddArtifactToComposer}
	                  />
                ))
              ) : (
                <div>还没有置顶上下文</div>
              )}
            </PanelSection>

            <PanelSection title="Recent Artifacts" count={props.recentArtifacts.length}>
              {props.recentArtifacts.length ? (
                props.recentArtifacts.map((artifact) => (
	                  <ArtifactCard
	                    key={artifact.id}
	                    artifact={artifact}
	                    onAddToComposer={props.onAddArtifactToComposer}
	                  />
                ))
              ) : (
                <div>还没有 artifact</div>
              )}
            </PanelSection>
          </div>

          <div className="workspace-column workspace-side">
            <PanelSection
              title="Pending Actions"
              count={props.pendingApprovals.length}
              actions={
                props.pendingApprovals.length ? (
                  <button className="ghost-button panel-action" type="button" onClick={props.onOpenChat}>
                    回到对话
                  </button>
                ) : null
              }
            >
              {props.pendingApprovals.length ? (
                props.pendingApprovals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    mode="actions"
                    onResolve={(action, response) => props.onResolveApproval(approval.id, action, response)}
                  />
                ))
              ) : (
                <div>没有待确认请求</div>
              )}
            </PanelSection>

            <PanelSection title="Computer" count={props.computerState.app ? 1 : 0}>
              {props.computerState.app ? <ComputerStateCard state={props.computerState} /> : <div>还没有 computer state</div>}
            </PanelSection>

            <PanelSection title="Runtime" count={computeRuntimeCount(props.currentSession, props.runs, props.runtimeItems, props.workingState.sessionId)}>
              <RuntimePanel
                session={props.currentSession}
                runs={props.runs}
                executions={props.runtimeItems}
                sessionId={props.currentSession?.id || props.workingState.sessionId}
              />
            </PanelSection>

            <PanelSection title="Timeline" count={props.executions.length}>
              {props.executions.length ? props.executions.slice(-12).reverse().map((event, index) => <TimelineCard key={`${event.type}_${index}`} event={event} />) : <div>还没有执行事件</div>}
            </PanelSection>
          </div>
        </div>

        <section className="panel-section" style={{ marginTop: 20 }}>
          <div className="panel-header">
            <div className="panel-title">Workspace Summary</div>
          </div>
          <div className="workspace-summary">{summaryLines.join("\n")}</div>
        </section>
      </div>
    </section>
  );
}



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
  onOpenWorkspace(): void;
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
          <button className="overview-icon-button" type="button" onClick={props.onOpenWorkspace} title="展开工作台" aria-label="展开工作台">
            <Maximize2 size={15} />
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
