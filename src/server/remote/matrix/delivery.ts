import type { AgentAttachmentContext } from "../../../core.js";
import type { RoomChannelMember, RoomChannelMessage } from "../../../rooms/channel-store.js";
import type { BridgeState } from "../../bridge-types.js";
import { publishMatrixRoomEvent } from "../../../remote/matrix/client.js";
import { matrixReady } from "./invites.js";

export async function deliverMatrixRoomTarget(
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
  const matrix = state.settings.remote.matrix;
  const turnId = input.assistantMessage.remote?.turnId || input.assistantMessage.runId || input.assistantMessage.id;
  if (
    input.target.source === "remote"
    && room?.remote?.provider === "matrix"
    && input.target.remote?.provider === "matrix"
    && matrixReady(matrix)
  ) {
    try {
      const eventId = await publishMatrixRoomEvent(
        matrix,
        room.remote.remoteRoomId,
        "org.opengrove.agent.request",
        {
          version: 1,
          turnId,
          prompt: input.prompt,
          attachments: input.attachments,
          target: {
            ownerUserId: input.target.remote.ownerId,
            agentId: input.target.remote.agentId,
          },
        },
        `agent-request-${turnId}`,
      );
      return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
        status: "running",
        startedAt: new Date().toISOString(),
        remote: {
          provider: "matrix",
          accountId: room.remote.accountId,
          remoteRoomId: room.remote.remoteRoomId,
          eventId,
          turnId,
        },
      });
    } catch (error) {
      return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
        text: error instanceof Error ? error.message : String(error),
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
    }
  }

  return state.app.rooms.updateMessage(input.roomId, input.assistantMessage.id, {
    text: `${input.target.name} 是远端成员，当前没有可用的 Matrix 投递通道。`,
    status: "done",
    finishedAt: new Date().toISOString(),
  });
}
