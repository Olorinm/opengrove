import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { RoomMemberAvatar } from "./member-avatar";
import type { RemoteRoomInvitePayload } from "./room-invites";
import { memberModelLabel, type RoomMember } from "./rooms-storage";

export function RemoteInviteDialog(props: {
  invite: RemoteRoomInvitePayload | null;
  members: RoomMember[];
  onAccept(member: RoomMember): void;
  onClose(): void;
  onCreateEmployee(): void;
}) {
  const localMembers = props.members.filter((member) => !member.source || member.source === "local");
  return (
    <Dialog open={Boolean(props.invite)} onOpenChange={(open) => {
      if (!open) props.onClose();
    }}>
      <DialogContent className="rooms-create-group-dialog" aria-label="接受远程邀请">
        <DialogTitle>加入 OpenGrove 群聊</DialogTitle>
        <div className="vault-create-dialog-subtitle">
          {props.invite ? `${props.invite.inviterName} 邀请你加入 ${props.invite.roomTitle}` : ""}
        </div>
        <section className="rooms-create-group-members">
          <div className="rooms-create-group-title">
            <strong>选择一个员工加入</strong>
            <span>{localMembers.length}</span>
          </div>
          <div className="rooms-create-group-list">
            {localMembers.length ? localMembers.map((member) => (
              <button
                key={member.id}
                className="rooms-member-picker-option"
                type="button"
                onClick={() => props.onAccept(member)}
              >
                <RoomMemberAvatar member={member} />
                <span>
                  <strong>{member.name}</strong>
                  <small>{member.kernel} / {memberModelLabel(member)}</small>
                </span>
              </button>
            )) : (
              <div className="rooms-empty-row">还没有可加入的本机员工。</div>
            )}
          </div>
        </section>
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={props.onClose}>
            <X size={15} />
            取消
          </button>
          <button className="primary-button" type="button" onClick={props.onCreateEmployee}>
            创建新员工
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
