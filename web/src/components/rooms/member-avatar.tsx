import type { CSSProperties } from "react";
import { memberInitial, type MemberStatus, type RoomMember } from "./rooms-model";

type MemberAvatarInput = Pick<RoomMember, "name" | "status" | "color" | "avatarDataUrl">;

export function RoomMemberAvatar(props: {
  member?: MemberAvatarInput;
  name?: string;
  status?: MemberStatus;
  color?: string;
  className?: string;
  title?: string;
}) {
  const name = props.name || props.member?.name || "";
  const status = props.status || props.member?.status || "idle";
  const color = props.color || props.member?.color || "#64748b";
  const avatarDataUrl = props.member?.avatarDataUrl;
  const className = ["rooms-avatar", props.className].filter(Boolean).join(" ");

  return (
    <span
      className={className}
      data-status={status}
      style={{ "--room-avatar-color": color } as CSSProperties}
      title={props.title ?? name}
    >
      {avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : memberInitial(name)}
    </span>
  );
}
