import { postJson, type AgentEventRecord, type AttachmentPayload } from "../../bridge";

export type RemoteRoomAgentRunInput = {
  roomId: string;
  memberId: string;
  memberName: string;
  prompt: string;
  attachments?: AttachmentPayload[];
};

export type RemoteRoomAgentRunResult = {
  ok: boolean;
  answer?: string;
  duration?: string;
  events?: AgentEventRecord[];
  error?: string;
};

export function runRemoteRoomAgent(input: RemoteRoomAgentRunInput): Promise<RemoteRoomAgentRunResult> {
  return postJson<RemoteRoomAgentRunResult>("/rooms/remote-agent/run", input);
}
