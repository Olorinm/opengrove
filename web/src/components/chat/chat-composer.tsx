import type { ChangeEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject } from "react";
import {
  ArrowUp,
  ClipboardPlus,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Package,
  Plus,
  X,
} from "lucide-react";
import type {
  ApprovalPolicy,
  AttachmentPayload,
  ContextArtifactPayload,
  ModelId,
  SandboxPolicy,
} from "../../bridge";
import { MODEL_OPTIONS } from "../../bridge";
import { clamp, summarize } from "../../format";
import {
  MAX_COMPOSER_HEIGHT,
  MIN_COMPOSER_HEIGHT,
  attachmentIcon,
  formatAttachmentMeta,
  formatComposerSkillTitle,
  type ComposerSkillInvocation,
} from "../../runtime/ui-model";

const SANDBOX_OPTIONS: Array<{ id: SandboxPolicy; label: string }> = [
  { id: "workspace-write", label: "工作区写入" },
  { id: "read-only", label: "只读" },
  { id: "danger-full-access", label: "完全访问" },
];

const APPROVAL_POLICY_OPTIONS: Array<{ id: ApprovalPolicy; label: string }> = [
  { id: "on-request", label: "按需确认" },
  { id: "on-failure", label: "失败时确认" },
  { id: "never", label: "不确认" },
  { id: "untrusted", label: "不可信时确认" },
];

export interface ChatComposerProps {
  sending: boolean;
  messagesEmpty: boolean;
  contextText: string;
  attachments: AttachmentPayload[];
  contextArtifacts: ContextArtifactPayload[];
  composerSkillInvocation: ComposerSkillInvocation | null;
  composerQuestionValue: string;
  composerHeight: number;
  model: ModelId;
  sandbox: SandboxPolicy;
  approvalPolicy: ApprovalPolicy;
  modelMenuOpen: boolean;
  modelMenuPlacement: "up" | "down";
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  onPointerDown(event: PointerEvent<HTMLDivElement>): void;
  onClearContext(): void;
  onRemoveContextArtifact(artifactId: string): void;
  onRemoveAttachment(attachmentId: string): void;
  onQuestionChange(value: string): void;
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
  onAttachmentInputChange(event: ChangeEvent<HTMLInputElement>): void;
  onOpenAttachmentPicker(event?: MouseEvent<HTMLButtonElement>): void;
  onToggleModelMenu(): void;
  onSetModel(model: ModelId): void;
  onSetSandbox(policy: SandboxPolicy): void;
  onSetApprovalPolicy(policy: ApprovalPolicy): void;
  onSubmitOrStop(): void;
  onRemoveSkillInvocation(): void;
  onUseSuggestion(prompt: string): void;
  skillMenu?: ReactNode;
}

export function ChatComposer(props: ChatComposerProps) {
  return (
    <section className="composer-region" aria-label="输入">
      {props.skillMenu}

      <div
        className="opengrove-composer"
        data-sending={props.sending ? "true" : "false"}
        data-skill={props.composerSkillInvocation ? "true" : "false"}
        onPointerDown={props.onPointerDown}
      >
        <div className="opengrove-composer-resize-handle" data-action="resize-composer" title="拖拽调整输入框高度"></div>

        {props.contextText || props.attachments.length || props.contextArtifacts.length ? (
          <ComposerAttachmentBar
            contextText={props.contextText}
            attachments={props.attachments}
            contextArtifacts={props.contextArtifacts}
            onClearContext={props.onClearContext}
            onRemoveAttachment={props.onRemoveAttachment}
            onRemoveContextArtifact={props.onRemoveContextArtifact}
          />
        ) : null}

        <div className="opengrove-question-line" data-skill={props.composerSkillInvocation ? "true" : "false"}>
          {props.composerSkillInvocation ? (
            <button
              className="opengrove-skill-chip"
              type="button"
              onClick={props.onRemoveSkillInvocation}
              aria-label={`移除技能 ${formatComposerSkillTitle(props.composerSkillInvocation.skill)}`}
              title={`/${props.composerSkillInvocation.name}`}
            >
              <Package size={15} strokeWidth={2.2} />
              <span>{formatComposerSkillTitle(props.composerSkillInvocation.skill)}</span>
            </button>
          ) : null}

          <textarea
            ref={props.composerInputRef}
            className="opengrove-question"
            rows={3}
            value={props.composerQuestionValue}
            placeholder={props.composerSkillInvocation ? "补充这个技能要做什么..." : "问 Codex，或输入 / 调用能力"}
            spellCheck={false}
            onChange={(event) => props.onQuestionChange(event.target.value)}
            onKeyDown={props.onKeyDown}
            onCompositionStart={props.onCompositionStart}
            onCompositionEnd={props.onCompositionEnd}
            style={{ height: `${clamp(props.composerHeight, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT)}px` }}
          ></textarea>
        </div>

        <div className="opengrove-composer-footer">
          <div className="opengrove-composer-footer-left">
            <input
              ref={props.fileInputRef}
              className="opengrove-file-input"
              type="file"
              multiple
              onChange={props.onAttachmentInputChange}
            />
            <button className="opengrove-action opengrove-composer-plus" type="button" onClick={props.onOpenAttachmentPicker} aria-label="添加图片或文件" title="添加图片或文件">
              <Plus size={20} strokeWidth={2.1} />
            </button>
          </div>
          <div className="opengrove-composer-footer-right">
            <ComposerModelPicker
              model={props.model}
              sandbox={props.sandbox}
              approvalPolicy={props.approvalPolicy}
              open={props.modelMenuOpen}
              placement={props.modelMenuPlacement}
              modelMenuRef={props.modelMenuRef}
              onToggle={props.onToggleModelMenu}
              onSetModel={props.onSetModel}
              onSetSandbox={props.onSetSandbox}
              onSetApprovalPolicy={props.onSetApprovalPolicy}
            />
            <button
              className="opengrove-action opengrove-primary opengrove-send"
              type="button"
              onClick={props.onSubmitOrStop}
              aria-label={props.sending ? "停止运行" : "发送消息"}
              title={props.sending ? "停止运行" : "发送消息"}
            >
              {props.sending ? <X size={18} /> : <ArrowUp size={18} />}
            </button>
          </div>
        </div>
      </div>

      {props.messagesEmpty ? (
        <div className="empty-suggestions" aria-label="建议">
          <button type="button" onClick={() => props.onUseSuggestion("把当前目标拆成下一步可以执行的计划")}>
            <MessageSquare size={15} />
            把当前目标拆成下一步
          </button>
          <button type="button" onClick={() => props.onUseSuggestion("整理一下当前项目里的关键记忆和资料")}>
            <MessageSquare size={15} />
            整理当前记忆和资料
          </button>
          <button type="button" onClick={() => props.onUseSuggestion("看看最近产物、待确认事项和运行状态")}>
            <MessageSquare size={15} />
            查看最近产物和待确认
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ComposerAttachmentBar(props: {
  contextText: string;
  attachments: AttachmentPayload[];
  contextArtifacts: ContextArtifactPayload[];
  onClearContext(): void;
  onRemoveContextArtifact(artifactId: string): void;
  onRemoveAttachment(attachmentId: string): void;
}) {
  return (
    <div className="attachment-bar">
      {props.contextText ? (
        <div className="opengrove-attachment" data-kind="text">
          <span className="opengrove-attachment-icon" aria-hidden="true">
            <ClipboardPlus size={13} />
          </span>
          <span className="opengrove-attachment-name">已选文本片段 · {summarize(props.contextText, 90)}</span>
          <button className="opengrove-action opengrove-icon opengrove-attachment-remove" type="button" onClick={props.onClearContext} aria-label="移除上下文">
            ×
          </button>
        </div>
      ) : null}
      {props.contextArtifacts.map((artifact) => (
        <div className="opengrove-attachment" key={artifact.id} data-kind="artifact">
          <span className="opengrove-attachment-icon" aria-hidden="true">
            {artifact.imageUri ? <ImageIcon size={13} /> : <FileText size={13} />}
          </span>
          <span className="opengrove-attachment-name">
            {artifact.title}
            <span className="opengrove-attachment-meta"> · 产物</span>
          </span>
          <button
            className="opengrove-action opengrove-icon opengrove-attachment-remove"
            type="button"
            onClick={() => props.onRemoveContextArtifact(artifact.id)}
            aria-label={`移除产物 ${artifact.title}`}
          >
            ×
          </button>
        </div>
      ))}
      {props.attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment);
        return (
          <div className="opengrove-attachment" key={attachment.id} data-kind={attachment.kind}>
            <span className="opengrove-attachment-icon" aria-hidden="true">
              <Icon size={13} />
            </span>
            <span className="opengrove-attachment-name">
              {attachment.name}
              <span className="opengrove-attachment-meta">{formatAttachmentMeta(attachment)}</span>
            </span>
            <button
              className="opengrove-action opengrove-icon opengrove-attachment-remove"
              type="button"
              onClick={() => props.onRemoveAttachment(attachment.id)}
              aria-label={`移除附件 ${attachment.name}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ComposerModelPicker(props: {
  model: ModelId;
  sandbox: SandboxPolicy;
  approvalPolicy: ApprovalPolicy;
  open: boolean;
  placement: "up" | "down";
  modelMenuRef: RefObject<HTMLDivElement | null>;
  onToggle(): void;
  onSetModel(model: ModelId): void;
  onSetSandbox(policy: SandboxPolicy): void;
  onSetApprovalPolicy(policy: ApprovalPolicy): void;
}) {
  return (
    <div className="opengrove-model-picker" ref={props.modelMenuRef}>
      <button
        className="opengrove-model-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        aria-label="模型"
        onClick={props.onToggle}
      >
        <span className="opengrove-model-label">{MODEL_OPTIONS.find((item) => item.id === props.model)?.label || props.model}</span>
        <span className="opengrove-chevron" aria-hidden="true"></span>
      </button>
      <div className="opengrove-model-menu" data-open={props.open ? "true" : "false"} data-placement={props.placement} role="listbox" aria-label="模型列表">
        <div className="opengrove-model-menu-title">模型</div>
        {MODEL_OPTIONS.map((item) => (
          <button
            key={item.id}
            className="opengrove-model-option"
            type="button"
            aria-selected={item.id === props.model}
            onClick={() => props.onSetModel(item.id as ModelId)}
          >
            <span className="opengrove-model-option-name">{item.label}</span>
            <span className="opengrove-model-option-check" aria-hidden="true"></span>
          </button>
        ))}
        <div className="opengrove-model-menu-title">权限</div>
        {SANDBOX_OPTIONS.map((item) => (
          <button
            key={item.id}
            className="opengrove-model-option"
            type="button"
            aria-selected={item.id === props.sandbox}
            onClick={() => props.onSetSandbox(item.id)}
          >
            <span className="opengrove-model-option-name">{item.label}</span>
            <span className="opengrove-model-option-check" aria-hidden="true"></span>
          </button>
        ))}
        <div className="opengrove-model-menu-title">确认</div>
        {APPROVAL_POLICY_OPTIONS.map((item) => (
          <button
            key={item.id}
            className="opengrove-model-option"
            type="button"
            aria-selected={item.id === props.approvalPolicy}
            onClick={() => props.onSetApprovalPolicy(item.id)}
          >
            <span className="opengrove-model-option-name">{item.label}</span>
            <span className="opengrove-model-option-check" aria-hidden="true"></span>
          </button>
        ))}
      </div>
    </div>
  );
}
