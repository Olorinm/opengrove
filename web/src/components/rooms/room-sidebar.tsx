import type { RefObject } from "react";
import { MessageCircleMore, Plus, Search, UserPlus, UsersRound, X } from "lucide-react";
import { ThemedPixelIcon } from "../sidebar/app-navigation";
import { KernelIcon } from "../ui/entity-icons";
import { RoomGroupAvatar } from "./room-group-avatar";
import { formatRoomPreview, formatShortTime } from "./room-message-model";
import { roomMemberSourceDetail, roomMemberSourceLabel, statusLabel, type Room, type RoomMember } from "./rooms-storage";

type RoomSidebarProps = {
  activeRoom: Room;
  rooms: Room[];
  members: RoomMember[];
  roomQuery: string;
  createMenuRef: RefObject<HTMLDivElement | null>;
  createMenuOpen: boolean;
  onToggleCreateMenu(): void;
  onCreateGroup(): void;
  onRecruitEmployee(): void;
  onRoomQueryChange(value: string): void;
  onOpenRoom(roomId: string): void;
  onOpenDirectMember(member: RoomMember): void;
};

export function RoomSidebar(props: RoomSidebarProps) {
  const pinnedRooms = props.rooms.filter((room) => room.pinned);
  const conversationRooms = props.rooms.filter((room) => !room.pinned);
  const query = props.roomQuery.trim().toLowerCase();
  const hasSearchQuery = Boolean(query);
  const roomSearchResults = query
    ? props.rooms.filter((room) => {
        const lastMessage = room.messages.at(-1);
        return `${room.title} ${room.badge || ""} ${formatRoomPreview(lastMessage)}`.toLowerCase().includes(query);
      })
    : [];
  const kernelSearchResults = query
    ? props.members.filter((member) => {
        const text = `${member.name} ${member.kernel} ${member.role} ${member.model}`.toLowerCase();
        const sourceText = `${roomMemberSourceLabel(member)} ${roomMemberSourceDetail(member)}`.toLowerCase();
        return `${text} ${sourceText}`.includes(query);
      })
    : [];
  const hasSearchResults = kernelSearchResults.length > 0 || roomSearchResults.length > 0;

  return (
    <aside className="rooms-list-panel">
      <header className="rooms-list-header">
        <div className="rooms-list-title">
          <span className="rooms-title-icon" aria-hidden="true">
            <ThemedPixelIcon pixelIcon="messages" professionalIcon={MessageCircleMore} professionalSize={18} pixelSize={19} />
          </span>
          <div>
            <h1>消息</h1>
            <p>对话列表</p>
          </div>
        </div>
        <div className="rooms-create-menu-wrap" ref={props.createMenuRef}>
          <button
            className="rooms-icon-button"
            type="button"
            onClick={props.onToggleCreateMenu}
            aria-expanded={props.createMenuOpen}
            aria-label="新建"
            title="新建"
          >
            <ThemedPixelIcon pixelIcon="plus" professionalIcon={Plus} professionalSize={16} pixelSize={17} />
          </button>
          {props.createMenuOpen ? (
            <div className="rooms-create-menu" role="menu" aria-label="新建">
              <button type="button" role="menuitem" onClick={props.onCreateGroup}>
                <ThemedPixelIcon pixelIcon="messages" professionalIcon={UsersRound} professionalSize={17} pixelSize={18} />
                <span>创建群聊</span>
              </button>
              <button type="button" role="menuitem" onClick={props.onRecruitEmployee}>
                <ThemedPixelIcon pixelIcon="user" professionalIcon={UserPlus} professionalSize={17} pixelSize={18} />
                <span>添加员工</span>
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="rooms-search-wrap" data-open={hasSearchQuery ? "true" : "false"}>
        <label className="rooms-search">
          <ThemedPixelIcon pixelIcon="search" professionalIcon={Search} professionalSize={14} pixelSize={16} />
          <input value={props.roomQuery} onChange={(event) => props.onRoomQueryChange(event.target.value)} placeholder="搜索对话或 kernel" />
          {hasSearchQuery ? (
            <button className="rooms-search-clear" type="button" onClick={() => props.onRoomQueryChange("")} aria-label="清空搜索" title="清空搜索">
              <X size={15} />
            </button>
          ) : null}
        </label>

        {hasSearchQuery ? (
          <section className="rooms-search-results" aria-label="搜索结果">
            {kernelSearchResults.length ? (
              <div className="rooms-search-group">
                <div className="rooms-section-label">Kernel</div>
                <div className="rooms-kernel-results">
                  {kernelSearchResults.map((member) => (
                    <button key={member.id} className="rooms-kernel-result" type="button" onClick={() => props.onOpenDirectMember(member)}>
                      <span className="rooms-kernel-icon" aria-hidden="true">
                        <KernelIcon kernelId={member.kernel} size={18} />
                      </span>
                      <span className="rooms-list-copy">
                        <span className="rooms-list-name">{member.name}</span>
                        <span className="rooms-list-preview">{roomMemberSourceLabel(member)} · {statusLabel(member.status)}</span>
                      </span>
                      <span className="rooms-room-badge">私聊</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {roomSearchResults.length ? (
              <div className="rooms-search-group">
                <div className="rooms-section-label">对话</div>
                <div className="rooms-kernel-results">
                  {roomSearchResults.map((room) => (
                    <RoomSearchResult
                      key={room.id}
                      room={room}
                      members={props.members}
                      onOpenRoom={props.onOpenRoom}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {!hasSearchResults ? <div className="rooms-empty-row">没有匹配的对话或已安装 kernel</div> : null}
          </section>
        ) : null}
      </div>

      {pinnedRooms.length ? (
        <section className="rooms-pinboard" aria-label="置顶区域">
          <div className="rooms-section-label">置顶</div>
          <div className="rooms-pinned-grid">
            {pinnedRooms.map((room) => {
              const directMember = findDirectMember(room, props.members);
              return (
                <button
                  key={room.id}
                  className="rooms-pin-item"
                  data-active={room.id === props.activeRoom.id ? "true" : "false"}
                  type="button"
                  onClick={() => props.onOpenRoom(room.id)}
                >
                  {directMember ? (
                    <span className="rooms-kernel-icon pin" aria-hidden="true">
                      <KernelIcon kernelId={directMember.kernel} size={18} />
                    </span>
                  ) : (
                    <RoomGroupAvatar title={room.title} className="rooms-pin-avatar group" />
                  )}
                  <span>{room.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="rooms-chat-list" aria-label="对话列表">
        <div className="rooms-section-label">对话</div>
        <div className="rooms-list-items">
          {conversationRooms.map((room) => (
            <RoomListItem
              key={room.id}
              room={room}
              active={room.id === props.activeRoom.id}
              members={props.members}
              onOpenRoom={props.onOpenRoom}
            />
          ))}
          {conversationRooms.length === 0 ? <div className="rooms-empty-row">没有匹配对话</div> : null}
        </div>
      </section>
    </aside>
  );
}

function RoomSearchResult(props: { room: Room; members: RoomMember[]; onOpenRoom(roomId: string): void }) {
  const directMember = findDirectMember(props.room, props.members);
  const lastMessage = props.room.messages.at(-1);
  return (
    <button key={props.room.id} className="rooms-kernel-result" type="button" onClick={() => props.onOpenRoom(props.room.id)}>
      {directMember ? (
        <span className="rooms-room-avatar direct" aria-hidden="true">
          <KernelIcon kernelId={directMember.kernel} size={18} />
        </span>
      ) : (
        <RoomGroupAvatar title={props.room.title} className="rooms-room-avatar" />
      )}
      <span className="rooms-list-copy">
        <span className="rooms-list-name">{props.room.title}</span>
        <span className="rooms-list-preview">{formatRoomPreview(lastMessage)}</span>
      </span>
      {props.room.badge ? <span className="rooms-room-badge">{props.room.badge}</span> : null}
    </button>
  );
}

function RoomListItem(props: { room: Room; active: boolean; members: RoomMember[]; onOpenRoom(roomId: string): void }) {
  const lastMessage = props.room.messages.at(-1);
  const directMember = findDirectMember(props.room, props.members);
  return (
    <button
      className="rooms-list-item"
      data-active={props.active ? "true" : "false"}
      type="button"
      onClick={() => props.onOpenRoom(props.room.id)}
    >
      {directMember ? (
        <span className="rooms-room-avatar direct" aria-hidden="true">
          <KernelIcon kernelId={directMember.kernel} size={18} />
        </span>
      ) : (
        <RoomGroupAvatar title={props.room.title} className="rooms-room-avatar" />
      )}
      <span className="rooms-list-copy">
        <span className="rooms-list-name-row">
          <span className="rooms-list-name">{props.room.title}</span>
          <span className="rooms-list-time">{formatShortTime(props.room.updatedAt)}</span>
        </span>
        <span className="rooms-list-preview">{formatRoomPreview(lastMessage)}</span>
      </span>
      {props.room.unread ? <span className="rooms-unread">{props.room.unread}</span> : null}
    </button>
  );
}

function findDirectMember(room: Room, members: RoomMember[]): RoomMember | undefined {
  return room.directMemberId ? members.find((member) => member.id === room.directMemberId) : undefined;
}
