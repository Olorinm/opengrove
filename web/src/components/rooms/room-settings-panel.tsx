import { Minus, Plus, Search, X } from "lucide-react";
import { ThemedPixelIcon } from "../sidebar/app-navigation";
import { KernelIcon } from "../ui/entity-icons";
import { RoomMemberAvatar } from "./member-avatar";
import { RoomGroupAvatar } from "./room-group-avatar";
import {
  ROOM_OWNER_MEMBER,
  memberModelLabel,
  roomMemberSourceDetail,
  roomMemberSourceLabel,
  statusLabel,
  type Room,
  type RoomMember,
} from "./rooms-storage";

export type RoomMemberPickerMode = "add" | "remove" | null;

type RoomSettingsPanelProps = {
  activeRoom: Room;
  activeDirectMember?: RoomMember;
  activeModel: string;
  pendingApprovalCount: number;
  memberPanelOpen: boolean;
  memberQuery: string;
  memberPickerMode: RoomMemberPickerMode;
  memberPickerQuery: string;
  memberPickerOptions: RoomMember[];
  visibleRoomMembers: RoomMember[];
  filteredMembers: RoomMember[];
  removableMembers: RoomMember[];
  visibleRoomMemberCount: number;
  onClose(): void;
  onRenameRoom(): void;
  onMemberQueryChange(value: string): void;
  onOpenMemberPicker(mode: Exclude<RoomMemberPickerMode, null>): void;
  onCloseMemberPicker(): void;
  onMemberPickerQueryChange(value: string): void;
  onAddMember(member: RoomMember): void;
  onRemoveMember(member: RoomMember): void;
};

export function RoomSettingsPanel(props: RoomSettingsPanelProps) {
  return (
    <aside className="rooms-side-panel" data-open={props.memberPanelOpen ? "true" : "false"} aria-label={props.activeRoom.kind === "group" ? "群设置" : "成员"}>
      <header className="rooms-member-drawer-header">
        <h3>{props.activeRoom.kind === "group" ? "设置" : "成员"}</h3>
        <button className="rooms-icon-button" type="button" onClick={props.onClose} aria-label="关闭面板" title="关闭">
          <X size={20} />
        </button>
      </header>
      <div className="rooms-settings-scroll">
        <section className="rooms-group-profile-card">
          {props.activeDirectMember ? (
            <span className="rooms-group-profile-icon" aria-hidden="true">
              <KernelIcon kernelId={props.activeDirectMember.kernel} size={22} />
            </span>
          ) : (
            <RoomGroupAvatar title={props.activeRoom.title} className="rooms-group-profile-icon" />
          )}
          <div className="rooms-group-profile-copy">
            <strong>{props.activeRoom.title}</strong>
            {props.activeRoom.kind === "group" ? (
              <button type="button" onClick={props.onRenameRoom}>编辑群信息</button>
            ) : (
              <span>{props.activeDirectMember ? `${props.activeDirectMember.kernel} / ${memberModelLabel(props.activeDirectMember)}` : "私聊"}</span>
            )}
          </div>
        </section>

        <section className="rooms-member-summary-card">
          <div className="rooms-settings-section-title">
            <strong>{props.activeRoom.kind === "group" ? "群成员" : "成员"}</strong>
            <span>{props.visibleRoomMemberCount}</span>
          </div>
          <label className="rooms-member-search">
            <ThemedPixelIcon pixelIcon="search" professionalIcon={Search} professionalSize={17} pixelSize={18} />
            <input value={props.memberQuery} onChange={(event) => props.onMemberQueryChange(event.target.value)} placeholder="搜索" />
          </label>
          <div className="rooms-member-avatar-strip">
            {props.visibleRoomMembers.map((member) => (
              <RoomMemberAvatar
                key={member.id}
                member={member}
                className="rooms-member-mini-avatar"
                title={member.name}
              />
            ))}
            {props.activeRoom.kind === "group" ? (
              <>
                <button
                  className="rooms-member-round-action"
                  type="button"
                  onClick={() => props.onOpenMemberPicker("add")}
                  aria-expanded={props.memberPickerMode === "add"}
                  aria-label="添加成员"
                  title="添加成员"
                  data-active={props.memberPickerMode === "add" ? "true" : "false"}
                >
                  <ThemedPixelIcon pixelIcon="plus" professionalIcon={Plus} professionalSize={20} pixelSize={20} />
                </button>
                <button
                  className="rooms-member-round-action"
                  type="button"
                  onClick={() => props.onOpenMemberPicker("remove")}
                  disabled={props.removableMembers.length === 0}
                  aria-expanded={props.memberPickerMode === "remove"}
                  aria-label="移除成员"
                  title={props.removableMembers.length ? "移除成员" : "至少保留一位成员"}
                  data-active={props.memberPickerMode === "remove" ? "true" : "false"}
                >
                  <Minus size={20} />
                </button>
              </>
            ) : null}
          </div>
          {props.memberPickerMode ? (
            <MemberPicker
              mode={props.memberPickerMode}
              query={props.memberPickerQuery}
              options={props.memberPickerOptions}
              onQueryChange={props.onMemberPickerQueryChange}
              onClose={props.onCloseMemberPicker}
              onSelect={(member) => {
                if (props.memberPickerMode === "add") {
                  props.onAddMember(member);
                } else {
                  props.onRemoveMember(member);
                }
              }}
            />
          ) : null}
        </section>

        <div className="rooms-member-drawer-list">
          {props.filteredMembers.length ? props.filteredMembers.map((member) => (
            <div key={member.id} className="rooms-member-row">
              <RoomMemberAvatar member={member} />
              <div>
                <div className="rooms-member-row-title">
                  <strong>{member.name}</strong>
                  {member.id === ROOM_OWNER_MEMBER.id ? <span>群主</span> : <span>{roomMemberSourceLabel(member)}</span>}
                </div>
                <p>{member.role}</p>
                <small>{roomMemberSourceDetail(member)} · {statusLabel(member.status)}</small>
              </div>
            </div>
          )) : <div className="rooms-empty-row">没有匹配成员</div>}
        </div>
      </div>
      <div className="rooms-member-drawer-foot">
        <span>当前模型 {props.activeModel}</span>
        <span>待审批 {props.pendingApprovalCount}</span>
      </div>
    </aside>
  );
}

function MemberPicker(props: {
  mode: Exclude<RoomMemberPickerMode, null>;
  query: string;
  options: RoomMember[];
  onQueryChange(value: string): void;
  onClose(): void;
  onSelect(member: RoomMember): void;
}) {
  return (
    <div className="rooms-member-picker">
      <div className="rooms-member-picker-head">
        <strong>{props.mode === "add" ? "添加成员" : "移除成员"}</strong>
        <button type="button" onClick={props.onClose} aria-label="关闭选择成员">
          <X size={14} />
        </button>
      </div>
      <label className="rooms-member-picker-search">
        <ThemedPixelIcon pixelIcon="search" professionalIcon={Search} professionalSize={15} pixelSize={16} />
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={props.mode === "add" ? "搜索可添加成员" : "搜索可移除成员"}
        />
      </label>
      <div className="rooms-member-picker-list">
        {props.options.length ? props.options.map((member) => (
          <button
            key={member.id}
            className="rooms-member-picker-option"
            type="button"
            onClick={() => props.onSelect(member)}
          >
            <RoomMemberAvatar member={member} />
            <span>
              <strong>{member.name}</strong>
              <small>{member.kernel} / {memberModelLabel(member)}</small>
            </span>
          </button>
        )) : (
          <div className="rooms-member-picker-empty">
            {props.mode === "add" ? "没有可添加成员" : "没有可移除成员"}
          </div>
        )}
      </div>
    </div>
  );
}
