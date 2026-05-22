import type { AgentAttachmentContext } from "../../core.js";
import type { RoomChannelMember, RoomChannelMessage } from "../../rooms/channel-store.js";
import type { BridgeState } from "../bridge-types.js";
import { deliverMatrixRoomTarget } from "./matrix/delivery.js";

export async function deliverRemoteRoomTarget(
  state: BridgeState,
  input: {
    roomId: string;
    prompt: string;
    attachments: AgentAttachmentContext[];
    target: RoomChannelMember;
    assistantMessage: { id: string; remote?: { turnId?: string }; runId?: string };
  },
): Promise<RoomChannelMessage> {
  const room = state.app.rooms.getRoom(input.roomId);
  if (room?.remote?.provider === "matrix" || input.target.remote?.provider === "matrix") {
    return deliverMatrixRoomTarget(state, input);
  }

  return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
    text: `${input.target.name} 是远端成员，但当前没有可用的远端投递通道。`,
    status: "done",
    finishedAt: new Date().toISOString(),
  });
}
