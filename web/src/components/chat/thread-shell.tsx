import type { AgentEventRecord, RunRecord, SkillRecord, StoredMessage } from "../../bridge";
import { useI18n } from "../../i18n";
import { MessageList } from "./message-list";
import type { ChatImagePayload } from "./message-types";

export function ThreadShell(props: {
  messages: StoredMessage[];
  projectTitle: string;
  skills?: SkillRecord[];
  runtimeEvents?: AgentEventRecord[];
  runs?: RunRecord[];
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt(prompt: string): void;
  onSubmitPrompt(prompt: string): void;
  onSaveImageArtifact?(image: ChatImagePayload): void;
}) {
  const { t } = useI18n();
  return (
    <div className="thread-shell">
      {props.messages.length === 0 ? (
        <section className="thread-welcome">
          <div className="thread-welcome-copy">
            <strong>{t("thread.welcome")}</strong>
          </div>
        </section>
      ) : null}
      <MessageList
        messages={props.messages}
        skills={props.skills}
        runtimeEvents={props.runtimeEvents}
        runs={props.runs}
        onResolveApproval={props.onResolveApproval}
        onInsertPrompt={props.onInsertPrompt}
        onSubmitPrompt={props.onSubmitPrompt}
        onTrySkill={(skillName) => props.onInsertPrompt(`/${skillName} `)}
        onEditSkill={(skillName) => props.onInsertPrompt(`/skill-creator 修改 /${skillName}：`)}
        onSaveImageArtifact={props.onSaveImageArtifact}
      />
    </div>
  );
}
