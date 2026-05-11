import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { AtSign, CirclePlus, Image as ImageIcon, SendHorizontal, X } from "lucide-react";
import type { AttachmentPayload } from "../../bridge";
import { attachmentIcon, formatAttachmentMeta } from "../../runtime/ui-model";
import { RoomMemberAvatar } from "./member-avatar";
import type { RoomMember } from "./rooms-storage";

export type MentionOption =
  | {
      id: "all";
      kind: "all";
      label: string;
      detail: string;
    }
  | {
      id: string;
      kind: "member";
      label: string;
      detail: string;
      member: RoomMember;
    };

export function RoomComposer(props: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  roomTitle: string;
  draft: string;
  attachments: AttachmentPayload[];
  canSend: boolean;
  mentionOpen: boolean;
  mentionOptions: MentionOption[];
  activeMentionIndex: number;
  onDraftChange(value: string, cursor: number): void;
  onAttachmentInputChange(event: ChangeEvent<HTMLInputElement>): void;
  onOpenAttachmentPicker(): void;
  onRemoveAttachment(attachmentId: string): void;
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
  onOpenMention(): void;
  onSelectMention(option: MentionOption): void;
  onHoverMention(index: number): void;
  onSend(): void;
}) {
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    props.onDraftChange(event.target.value, event.target.selectionStart);
  }

  return (
    <section className="composer-region room-composer" aria-label={`发送给 ${props.roomTitle}`}>
      <div className="opengrove-composer room-composer-og" data-sending="false" data-skill="false">
        {props.mentionOpen ? (
          <MentionMenu
            options={props.mentionOptions}
            activeIndex={props.activeMentionIndex}
            onSelect={props.onSelectMention}
            onHover={props.onHoverMention}
          />
        ) : null}
        {props.attachments.length ? (
          <RoomAttachmentBar attachments={props.attachments} onRemoveAttachment={props.onRemoveAttachment} />
        ) : null}
        <div className="opengrove-question-line" data-skill="false">
          <textarea
            ref={props.inputRef}
            className="opengrove-question"
            rows={1}
            value={props.draft}
            placeholder={`发送给 ${props.roomTitle}`}
            aria-label={`发送给 ${props.roomTitle}`}
            spellCheck={false}
            onChange={handleChange}
            onKeyDown={props.onKeyDown}
            onCompositionStart={props.onCompositionStart}
            onCompositionEnd={props.onCompositionEnd}
          />
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
            <button className="opengrove-action opengrove-composer-at" type="button" onClick={props.onOpenMention} aria-label="提及成员" title="@">
              <AtSign size={18} />
            </button>
            <button className="opengrove-action opengrove-composer-plus" type="button" onClick={props.onOpenAttachmentPicker} aria-label="上传附件" title="上传附件">
              <CirclePlus size={18} />
            </button>
          </div>
          <div className="opengrove-composer-footer-right">
            <button
              className="opengrove-action opengrove-primary opengrove-send"
              type="button"
              onClick={props.onSend}
              disabled={!props.canSend}
              aria-label="发送消息"
              title="发送消息"
            >
              <SendHorizontal size={17} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function RoomAttachmentBar(props: {
  attachments: AttachmentPayload[];
  onRemoveAttachment(attachmentId: string): void;
}) {
  return (
    <div className="attachment-bar room-attachment-bar">
      {props.attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment);
        if (attachment.kind === "image") {
          const previewUrl = attachment.thumbnailUrl || attachment.dataUrl;
          return (
            <div className="opengrove-attachment" key={attachment.id} data-kind="image" title={attachment.name}>
              {previewUrl ? (
                <img className="opengrove-attachment-thumb" src={previewUrl} alt="" />
              ) : (
                <span className="opengrove-attachment-image-fallback" aria-hidden="true">
                  <ImageIcon size={18} />
                </span>
              )}
              <button
                className="opengrove-action opengrove-icon opengrove-attachment-remove"
                type="button"
                onClick={() => props.onRemoveAttachment(attachment.id)}
                aria-label={`移除附件 ${attachment.name}`}
              >
                <X size={13} />
              </button>
            </div>
          );
        }
        return (
          <div className="opengrove-attachment" key={attachment.id} data-kind={attachment.kind}>
            <span className="opengrove-attachment-icon" aria-hidden="true">
              <Icon size={14} />
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
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MentionMenu(props: {
  options: MentionOption[];
  activeIndex: number;
  onSelect(option: MentionOption): void;
  onHover(index: number): void;
}) {
  const allOption = props.options.find((option): option is Extract<MentionOption, { kind: "all" }> => option.kind === "all");
  const allIndex = allOption ? props.options.indexOf(allOption) : -1;
  const memberOptions = props.options
    .map((option, index) => ({ option, index }))
    .filter((item): item is { option: Extract<MentionOption, { kind: "member" }>; index: number } => item.option.kind === "member");

  return (
    <div className="rooms-mention-menu" role="listbox" aria-label="选择提及对象">
      {allOption ? (
        <button
          className="rooms-mention-option all"
          data-active={props.activeIndex === allIndex ? "true" : "false"}
          type="button"
          role="option"
          aria-selected={props.activeIndex === allIndex}
          onMouseEnter={() => props.onHover(allIndex)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => props.onSelect(allOption)}
        >
          <span className="rooms-mention-all-icon" aria-hidden="true">
            <AtSign size={22} />
          </span>
          <span>
            <strong>所有人</strong>
            <small>提示所有成员</small>
          </span>
        </button>
      ) : null}
      <div className="rooms-mention-section-title">会话内成员</div>
      <div className="rooms-mention-list">
        {memberOptions.map(({ option, index }) => {
          return (
            <button
              key={option.id}
              className="rooms-mention-option"
              data-active={props.activeIndex === index ? "true" : "false"}
              type="button"
              role="option"
              aria-selected={props.activeIndex === index}
              onMouseEnter={() => props.onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onSelect(option)}
            >
              <RoomMemberAvatar member={option.member} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
            </button>
          );
        })}
        {memberOptions.length === 0 ? (
          <div className="rooms-mention-empty">没有匹配成员</div>
        ) : null}
      </div>
    </div>
  );
}
