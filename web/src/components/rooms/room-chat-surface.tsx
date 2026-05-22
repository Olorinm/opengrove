import type { ChangeEvent, KeyboardEvent, Ref, RefObject } from "react";
import type { AgentEventRecord, AttachmentPayload } from "../../bridge";
import { RoomComposer, type MentionOption } from "./room-composer";
import { RoomMessageStream } from "./room-message-stream";
import type { RoomMember, RoomMessage } from "./rooms-model";

export function RoomChatSurface(props: {
  streamRef?: Ref<HTMLElement>;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  roomTitle: string;
  messages: RoomMessage[];
  members: RoomMember[];
  runtimeEventsByRunId: Map<string, AgentEventRecord[]>;
  draft: string;
  attachments: AttachmentPayload[];
  canSend: boolean;
  mentionOpen: boolean;
  mentionOptions: MentionOption[];
  activeMentionIndex: number;
  onResolveApproval(approvalId: string, action: "approve" | "reject", response?: unknown): void;
  onInsertPrompt(prompt: string): void;
  onSubmitPrompt(prompt: string): void;
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
  return (
    <>
      <section ref={props.streamRef} className="room-message-stream chat-thread-scroll" aria-live="polite">
        <RoomMessageStream
          messages={props.messages}
          members={props.members}
          runtimeEventsByRunId={props.runtimeEventsByRunId}
          onResolveApproval={props.onResolveApproval}
          onInsertPrompt={props.onInsertPrompt}
          onSubmitPrompt={props.onSubmitPrompt}
        />
      </section>

      <RoomComposer
        inputRef={props.composerInputRef}
        fileInputRef={props.fileInputRef}
        roomTitle={props.roomTitle}
        draft={props.draft}
        attachments={props.attachments}
        canSend={props.canSend}
        mentionOpen={props.mentionOpen}
        mentionOptions={props.mentionOptions}
        activeMentionIndex={props.activeMentionIndex}
        onDraftChange={props.onDraftChange}
        onAttachmentInputChange={props.onAttachmentInputChange}
        onOpenAttachmentPicker={props.onOpenAttachmentPicker}
        onRemoveAttachment={props.onRemoveAttachment}
        onKeyDown={props.onKeyDown}
        onCompositionStart={props.onCompositionStart}
        onCompositionEnd={props.onCompositionEnd}
        onOpenMention={props.onOpenMention}
        onSelectMention={props.onSelectMention}
        onHoverMention={props.onHoverMention}
        onSend={props.onSend}
      />
    </>
  );
}
