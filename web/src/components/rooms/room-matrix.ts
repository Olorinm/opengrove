import { postJson } from "../../bridge";
import type { RemoteRoomInvitePayload } from "./room-invites";
import type { Room, RoomMember } from "./rooms-model";

export type MatrixAcceptedInvite = {
  roomId: string;
  profileEventId: string;
  room: Omit<Room, "messages">;
  member: RoomMember;
  currentEventSeq: number;
};

export async function acceptMatrixInvite(input: {
  invite: RemoteRoomInvitePayload;
  member: RoomMember;
}): Promise<MatrixAcceptedInvite> {
  const roomId = input.invite.matrixRoomId || input.invite.token;
  if (!roomId) throw new Error("matrix_room_missing");
  const response = await postJson<MatrixAcceptedInvite & { ok?: boolean; error?: string; message?: string }>("/rooms/matrix/join", {
    roomId,
    roomTitle: input.invite.roomTitle,
    localMember: input.member,
  });
  if (response.ok === false) {
    throw new Error(response.message || response.error || "matrix_join_failed");
  }
  return response;
}
