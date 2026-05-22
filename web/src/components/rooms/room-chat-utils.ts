import type { RoomMember } from "./rooms-model";

export type MentionMenuState = {
  open: boolean;
  query: string;
  start: number;
  end: number;
  activeIndex: number;
};

export function findMentionContext(value: string, cursor: number): Pick<MentionMenuState, "query" | "start" | "end"> | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] ?? "";
  return {
    query,
    start: beforeCursor.length - query.length - 1,
    end: cursor,
  };
}

export function resolveRoomTargets(text: string, members: RoomMember[]): RoomMember[] {
  const normalized = text.toLowerCase();
  if (/@all\b/i.test(text) || /@全部|@所有人/.test(text)) {
    return members.filter((member) => !member.disabled && member.status !== "offline");
  }
  return members.filter((member) => {
    if (member.disabled) return false;
    const aliases = [member.name, member.id, member.kernel].map((value) => `@${value.toLowerCase()}`);
    return aliases.some((alias) => normalized.includes(alias));
  });
}

export function canSendRoomDraft(rawText: string, attachmentCount: number): boolean {
  if (attachmentCount > 0) return true;
  const text = rawText.trim();
  if (!text) return false;
  return !/^@\S*$/.test(text);
}
