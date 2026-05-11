import type { IncomingMessage, ServerResponse } from "node:http";
import { runRemoteRoomAgent } from "../remote-agents/claude-ssh-runner.js";
import { record } from "../http-utils.js";

type SendJson = (response: ServerResponse, status: number, data: unknown) => void;
type ReadJsonBody = (request: IncomingMessage) => Promise<unknown>;

export async function handleRemoteAgentRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  sendJson: SendJson;
  readJsonBody: ReadJsonBody;
}): Promise<boolean> {
  const { request, response, url, sendJson, readJsonBody } = options;
  if (request.method !== "POST" || url.pathname !== "/rooms/remote-agent/run") {
    return false;
  }

  const result = await runRemoteRoomAgent(record(await readJsonBody(request)));
  sendJson(response, 200, result);
  return true;
}
