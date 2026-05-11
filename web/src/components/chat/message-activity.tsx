import { useState } from "react";
import clsx from "clsx";
import { FileText, LoaderCircle, Pencil, Search, Sparkles, Terminal, Wrench } from "lucide-react";
import { Button } from "../ui/button";
import {
  activityItemDetailDisplay,
  activityItemError,
  activityItemKind,
  activityItemStatus,
  activityItemTitle,
  activityItemTitleTooltip,
  buildUserInputApprovalResponse,
  choiceFormFromItem,
  editActivityInfo,
  isUserInputApproval,
  primaryActivityKind,
  summarizeActivityItems,
  userInputPromptLabel,
  type ActivityEntry,
  type ActivityItem,
  type ChoiceForm,
} from "./message-activity-model";

export { activityItemStatus, buildActivityItems, choiceFormFromItem, summarizeActivityItems, type ActivityEntry } from "./message-activity-model";

export function AssistantProcessBlock(props: {
  entries: ActivityEntry[];
  activeChoiceFormKey?: string;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt?(prompt: string): void;
  onSubmitPrompt?(prompt: string): void;
}) {
  const hasPendingApproval = props.entries.some(
    ({ item }) => item.type === "approval" && item.part.approvalStatus === "pending" && item.part.approvalId,
  );
  const hasActiveChoiceForm = props.entries.some(
    ({ groupKey, item }) => groupKey === props.activeChoiceFormKey && Boolean(choiceFormFromItem(item)),
  );
  const items = props.entries.map(({ item }) => item);
  const hasRunningItem = props.entries.some(({ item }) => activityItemStatus(item) === "running");
  const hasProblem = props.entries.some(({ item }) =>
    ["blocked", "incomplete", "rejected", "failed", "error"].includes(activityItemStatus(item)),
  );
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const shouldOpenByDefault = hasPendingApproval || hasActiveChoiceForm;
  const detailsOpen = userOpen ?? shouldOpenByDefault;
  const summary = summarizeActivityItems(items, {
    active: hasRunningItem,
    pendingApproval: hasPendingApproval,
    activeChoiceForm: hasActiveChoiceForm,
  });
  const summaryKind = primaryActivityKind(items);

  return (
    <details
      className={clsx(
        "thread-activity",
        hasProblem ? "tone-warn" : null,
        hasPendingApproval ? "tone-approval" : null,
      )}
      data-active={hasRunningItem ? "true" : "false"}
      open={detailsOpen}
      onToggle={(event) => setUserOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="thread-activity-summary">
          <ActivitySummaryIcon kind={summaryKind} active={hasRunningItem} />
          {summary}
        </span>
      </summary>
      <div className="thread-activity-list">
        {props.entries.map(({ groupKey, item }) => (
          <ActivityItemRow
            key={`${groupKey}:${item.key}`}
            item={item}
            choiceFormActive={groupKey === props.activeChoiceFormKey}
            onResolveApproval={props.onResolveApproval}
            onInsertPrompt={props.onInsertPrompt}
            onSubmitPrompt={props.onSubmitPrompt}
          />
        ))}
      </div>
    </details>
  );
}

function ActivityItemRow(props: {
  item: ActivityItem;
  choiceFormActive: boolean;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt?(prompt: string): void;
  onSubmitPrompt?(prompt: string): void;
}) {
  const status = activityItemStatus(props.item);
  const detail = activityItemDetailDisplay(props.item);
  const titleTooltip = activityItemTitleTooltip(props.item);
  const choiceForm = choiceFormFromItem(props.item);
  const editInfo = activityItemKind(props.item) === "edit" ? editActivityInfo(props.item) : null;
  const editStatusLabel =
    status === "running"
      ? "正在编辑"
      : ["blocked", "incomplete", "rejected", "failed", "error"].includes(status)
        ? "未完成编辑"
        : "已编辑";
  const pendingApprovalPart =
    props.item.type === "approval" && props.item.part.approvalStatus === "pending" && props.item.part.approvalId
      ? props.item.part
      : null;
  const asksForUserInput = pendingApprovalPart ? isUserInputApproval(pendingApprovalPart) : false;
  const [userInputResponse, setUserInputResponse] = useState("");

  return (
    <div className={clsx("thread-activity-row", `status-${status}`)}>
      <span className="thread-activity-dot" aria-hidden="true" />
      <div className="thread-activity-row-body">
        {editInfo ? (
          <div className="thread-activity-edit" title={editInfo.fullPaths.join("\n") || editInfo.label}>
            <span className="thread-activity-edit-prefix">{editStatusLabel}</span>
            <span className="thread-activity-edit-file">{editInfo.label}</span>
            {editInfo.added !== undefined ? <span className="thread-activity-edit-added">+{editInfo.added}</span> : null}
            {editInfo.removed !== undefined ? <span className="thread-activity-edit-removed">-{editInfo.removed}</span> : null}
          </div>
        ) : (
          <>
            <div className="thread-activity-row-title" title={titleTooltip || undefined}>{activityItemTitle(props.item)}</div>
            {detail ? (
              <div className="thread-activity-row-detail" title={detail.title || undefined}>
                {detail.label}
              </div>
            ) : null}
          </>
        )}
        {pendingApprovalPart ? (
          asksForUserInput ? (
            <label className="thread-approval-input-label compact">
              <span>{userInputPromptLabel(pendingApprovalPart)}</span>
              <textarea
                className="thread-approval-input"
                value={userInputResponse}
                onChange={(event) => setUserInputResponse(event.target.value)}
                placeholder="输入要回给 Codex 的内容"
                rows={3}
              />
            </label>
          ) : null
        ) : null}
        {pendingApprovalPart ? (
          <div className="thread-approval-actions compact">
            <Button
              variant="primary"
              onClick={() =>
                props.onResolveApproval(
                  pendingApprovalPart.approvalId,
                  "approve",
                  asksForUserInput ? buildUserInputApprovalResponse(pendingApprovalPart, userInputResponse) : undefined,
                )
              }
            >
              确认
            </Button>
            <Button onClick={() => props.onResolveApproval(pendingApprovalPart.approvalId, "reject")}>拒绝</Button>
          </div>
        ) : null}
        {choiceForm ? (
          <ChoiceFormBlock
            form={choiceForm}
            disabled={!props.choiceFormActive}
            onInsertPrompt={props.onInsertPrompt}
            onSubmitPrompt={props.onSubmitPrompt}
          />
        ) : null}
        {activityItemError(props.item) ? (
          <div className="thread-activity-row-error">{activityItemError(props.item)}</div>
        ) : null}
      </div>
    </div>
  );
}

function ChoiceFormBlock(props: { form: ChoiceForm; disabled?: boolean; onInsertPrompt?(prompt: string): void; onSubmitPrompt?(prompt: string): void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const disabled = props.disabled || submitted;

  return (
    <section className="thread-choice-form">
      <div className="thread-choice-form-header">
        <div>
          <div className="thread-choice-form-kicker">需要你选择</div>
          <div className="thread-choice-form-title">{props.form.title}</div>
        </div>
      </div>
      {props.form.instructions ? <div className="thread-choice-form-instructions">{props.form.instructions}</div> : null}
      <div className="thread-choice-question-list">
        {props.form.questions.map((question, index) => (
          <div className="thread-choice-question" key={`${question.id || "question"}-${index}`}>
            <div className="thread-choice-question-title">
              {index + 1}. {question.prompt}
            </div>
            <div className="thread-choice-options">
              {question.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={clsx("thread-choice-option", answers[index] === option.value && "selected")}
                  disabled={disabled}
                  onClick={() => {
                    setAnswers({ [index]: option.value });
                    setSubmitted(true);
                    if (props.onSubmitPrompt) {
                      props.onSubmitPrompt(option.label);
                    } else {
                      props.onInsertPrompt?.(option.label);
                    }
                  }}
                >
                  <span>{option.label}</span>
                  {option.description ? <small>{option.description}</small> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivitySummaryIcon(props: { kind: string; active?: boolean }) {
  if (props.active) {
    return <LoaderCircle size={14} className="spin" />;
  }
  if (props.kind === "search") {
    return <Search size={14} />;
  }
  if (props.kind === "read") {
    return <FileText size={14} />;
  }
  if (props.kind === "command") {
    return <Terminal size={14} />;
  }
  if (props.kind === "edit") {
    return <Pencil size={14} />;
  }
  if (props.kind === "skill") {
    return <Sparkles size={14} />;
  }
  return <Wrench size={14} />;
}
