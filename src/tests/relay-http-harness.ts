import assert from "node:assert/strict";
import { once } from "node:events";
import { startRelayHttpServer } from "../relay/http-relay-server.js";

const server = startRelayHttpServer({ host: "127.0.0.1", port: 0 });
await once(server, "listening");
const address = server.address();
assert.equal(typeof address, "object");
const baseUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;

try {
  const health = await postOrGet("GET", `${baseUrl}/health`);
  assert.equal(health.ok, true);

  const workspace = await postOrGet("POST", `${baseUrl}/workspaces`, { name: "HTTP Harness" });
  const workspaceId = workspace.workspace.id;
  const room = await postOrGet("POST", `${baseUrl}/rooms`, {
    workspaceId,
    title: "open group",
    createdByMemberId: "bootstrap",
  });
  const roomId = room.room.id;
  const owner = await postOrGet("POST", `${baseUrl}/rooms/${encodeURIComponent(roomId)}/members`, {
    workspaceId,
    kind: "human",
    displayName: "我",
  });
  const invite = await postOrGet("POST", `${baseUrl}/invites`, {
    workspaceId,
    roomId,
    createdByMemberId: owner.member.id,
    targetKind: "remote-agent",
  });
  const invitePage = await fetch(`${baseUrl}/invites/accept?token=${encodeURIComponent(invite.invite.token)}`);
  const inviteHtml = await invitePage.text();
  assert.equal(invitePage.ok, true);
  assert.match(inviteHtml, /OpenGrove 员工邀请/);
  assert.match(inviteHtml, /检测并打开本机 OpenGrove/);
  assert.match(inviteHtml, /opengrove-probe/);
  assert.match(inviteHtml, /http:\/\/127\.0\.0\.1:37371\/ui\//);
  assert.match(inviteHtml, /http:\/\/127\.0\.0\.1:37373\/ui\//);
  assert.match(inviteHtml, /execCommand\('copy'\)/);
  assert.doesNotMatch(inviteHtml, /opengrove:\/\//);

  const accepted = await postOrGet("POST", `${baseUrl}/invites/accept`, {
    token: invite.invite.token,
    displayName: "ReviewBot",
    nodeId: "node-review",
  });
  assert.equal(accepted.invite.status, "accepted");

  const published = await postOrGet("POST", `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`, {
    workspaceId,
    actorMemberId: owner.member.id,
    targetMemberIds: [accepted.member.id],
    type: "room.message.created",
    idempotencyKey: "harness-message-turn",
    payload: { text: "@ReviewBot 看一下" },
  });
  assert.equal(published.event.type, "room.message.created");
  const replayed = await postOrGet("POST", `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`, {
    workspaceId,
    actorMemberId: owner.member.id,
    targetMemberIds: [accepted.member.id],
    type: "room.message.created",
    idempotencyKey: "harness-message-turn",
    payload: { text: "@ReviewBot 看一下" },
  });
  assert.equal(replayed.event.id, published.event.id);

  const events = await postOrGet("GET", `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`);
  assert.equal(events.events.some((event: { type?: string }) => event.type === "invite.accepted"), true);
  assert.equal(events.events.some((event: { type?: string }) => event.type === "room.message.created"), true);
  assert.equal(events.events.filter((event: { id?: string }) => event.id === published.event.id).length, 1);
  await assertProtectedRelay();
  console.log("relay-http-harness ok");
} finally {
  server.close();
}

async function assertProtectedRelay(): Promise<void> {
  const token = "harness-token";
  const protectedServer = startRelayHttpServer({ host: "127.0.0.1", port: 0, authToken: token });
  await once(protectedServer, "listening");
  const address = protectedServer.address();
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;

  try {
    const health = await postOrGet("GET", `${baseUrl}/health`);
    assert.equal(health.ok, true);

    const denied = await fetch(`${baseUrl}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Protected" }),
    });
    const deniedJson = await denied.json() as { error?: string };
    assert.equal(denied.status, 401);
    assert.equal(deniedJson.error, "unauthorized");

    const created = await postOrGet("POST", `${baseUrl}/workspaces`, { name: "Protected" }, { authorization: `Bearer ${token}` });
    assert.equal(created.workspace.name, "Protected");
    const room = await postOrGet("POST", `${baseUrl}/rooms`, {
      workspaceId: created.workspace.id,
      title: "Protected room",
      createdByMemberId: "bootstrap",
    }, { authorization: `Bearer ${token}` });
    const owner = await postOrGet("POST", `${baseUrl}/rooms/${encodeURIComponent(room.room.id)}/members`, {
      workspaceId: created.workspace.id,
      kind: "human",
      displayName: "Owner",
    }, { authorization: `Bearer ${token}` });
    const deniedMembers = await fetch(`${baseUrl}/rooms/${encodeURIComponent(room.room.id)}/members`);
    assert.equal(deniedMembers.status, 401);
    const visibleMembers = await postOrGet(
      "GET",
      `${baseUrl}/rooms/${encodeURIComponent(room.room.id)}/members?memberId=${encodeURIComponent(owner.member.id)}&memberToken=${encodeURIComponent(owner.memberAccessToken)}`,
    );
    assert.equal(visibleMembers.members.length, 1);
    assert.equal(visibleMembers.members[0].displayName, "Owner");
  } finally {
    protectedServer.close();
  }
}

async function postOrGet(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<any> {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json", ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json() as any;
  assert.equal(response.ok, true, `${method} ${url}: ${JSON.stringify(json)}`);
  return json;
}
