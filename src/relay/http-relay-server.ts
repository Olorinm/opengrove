import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRelayStore } from "./file-relay.js";
import { InMemoryRelay } from "./in-memory-relay.js";
import type { RelayEventEnvelope, RelayEventType, RelayMemberKind, RelayRoomInvite } from "./protocol.js";

export type RelayHttpServerOptions = {
  host?: string;
  port?: number;
  authToken?: string;
  relay?: InMemoryRelay;
};

export function startRelayHttpServer(options: RelayHttpServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 37372;
  const authToken = options.authToken ?? process.env.OPENGROVE_RELAY_TOKEN;
  const relay = options.relay ?? createRelayStore(process.env.OPENGROVE_RELAY_STATE_PATH);

  const server = createServer(async (request, response) => {
    applyCors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, name: "opengrove-relay", time: new Date().toISOString() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/invites/accept") {
        sendHtml(response, 200, inviteAcceptPage({
          relayBaseUrl: relayBaseUrl(url),
          token: stringValue(url.searchParams.get("token")) || "",
        }));
        return;
      }

      const publicInviteAccept = request.method === "POST" && url.pathname === "/invites/accept";
      const roomEventsMatch = url.pathname.match(/^\/rooms\/([^/]+)\/events$/);
      const roomStreamMatch = url.pathname.match(/^\/rooms\/([^/]+)\/stream$/);
      const publicInviteResolve = request.method === "GET" && url.pathname === "/invites/resolve";
      const canDeferAuthToMemberToken = Boolean(roomEventsMatch || roomStreamMatch);
      if (authToken && !publicInviteAccept && !publicInviteResolve && !canDeferAuthToMemberToken && !isAuthorized(request, authToken)) {
        sendJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/invites/resolve") {
        const invite = relay.getInvite(requiredString(url.searchParams.get("token"), "token"));
        const room = relay.getRoom(invite.roomId, invite.workspaceId);
        sendJson(response, 200, { ok: true, invite, room });
        return;
      }

      if (request.method === "POST" && url.pathname === "/workspaces") {
        const body = await readJsonBody(request);
        sendJson(response, 200, { ok: true, workspace: relay.createWorkspace(stringValue(body.name) || "OpenGrove") });
        return;
      }

      if (request.method === "POST" && url.pathname === "/nodes") {
        const body = await readJsonBody(request);
        const node = relay.registerNode({
          id: stringValue(body.id) || randomId("node"),
          accountId: stringValue(body.accountId) || "local",
          displayName: stringValue(body.displayName) || "OpenGrove Node",
          version: stringValue(body.version),
          agents: Array.isArray(body.agents) ? body.agents : [],
        });
        sendJson(response, 200, { ok: true, node });
        return;
      }

      if (request.method === "POST" && url.pathname === "/rooms") {
        const body = await readJsonBody(request);
        const room = relay.createRoom({
          workspaceId: requiredString(body.workspaceId, "workspaceId"),
          title: stringValue(body.title) || "群聊",
          createdByMemberId: stringValue(body.createdByMemberId) || "bootstrap",
        });
        sendJson(response, 200, { ok: true, room });
        return;
      }

      const roomMembersMatch = url.pathname.match(/^\/rooms\/([^/]+)\/members$/);
      if (request.method === "GET" && roomMembersMatch) {
        sendJson(response, 200, { ok: true, members: relay.listMembers(decodeURIComponent(roomMembersMatch[1]!)) });
        return;
      }
      if (request.method === "POST" && roomMembersMatch) {
        const body = await readJsonBody(request);
        const member = relay.addMember({
          workspaceId: requiredString(body.workspaceId, "workspaceId"),
          roomId: decodeURIComponent(roomMembersMatch[1]!),
          kind: relayMemberKind(body.kind),
          displayName: stringValue(body.displayName) || "员工",
          accountId: stringValue(body.accountId),
          nodeId: stringValue(body.nodeId),
          agentId: stringValue(body.agentId),
        });
        const memberAccess = relay.createMemberAccess(member.id, member.roomId);
        sendJson(response, 200, { ok: true, member, memberAccessToken: memberAccess.token });
        return;
      }

      if (request.method === "POST" && url.pathname === "/invites") {
        const body = await readJsonBody(request);
        const invite = relay.createInvite({
          workspaceId: requiredString(body.workspaceId, "workspaceId"),
          roomId: requiredString(body.roomId, "roomId"),
          createdByMemberId: requiredString(body.createdByMemberId, "createdByMemberId"),
          targetKind: inviteTargetKind(body.targetKind),
        });
        sendJson(response, 200, { ok: true, invite, inviteUrl: `/invites/accept?token=${encodeURIComponent(invite.token)}` });
        return;
      }

      if (request.method === "POST" && url.pathname === "/invites/accept") {
        const body = await readJsonBody(request);
        const accepted = relay.acceptInvite({
          token: requiredString(body.token, "token"),
          displayName: stringValue(body.displayName) || "远程员工",
          accountId: stringValue(body.accountId),
          nodeId: stringValue(body.nodeId),
          agentId: stringValue(body.agentId),
        });
        const room = relay.getRoom(accepted.invite.roomId, accepted.invite.workspaceId);
        const memberAccess = relay.createMemberAccess(accepted.member.id, accepted.member.roomId);
        sendJson(response, 200, { ok: true, ...accepted, room, memberAccessToken: memberAccess.token });
        return;
      }

      if (request.method === "GET" && roomEventsMatch) {
        const roomId = decodeURIComponent(roomEventsMatch[1]!);
        if (authToken && !isAuthorized(request, authToken) && !relay.verifyMemberAccess(
          roomId,
          requiredString(url.searchParams.get("memberId"), "memberId"),
          memberTokenFromRequest(request, url),
        )) {
          sendJson(response, 401, { ok: false, error: "unauthorized" });
          return;
        }
        sendJson(response, 200, { ok: true, events: relay.listEvents(decodeURIComponent(roomEventsMatch[1]!)) });
        return;
      }
      if (request.method === "POST" && roomEventsMatch) {
        const body = await readJsonBody(request);
        const roomId = decodeURIComponent(roomEventsMatch[1]!);
        const actorMemberId = requiredString(body.actorMemberId, "actorMemberId");
        if (authToken && !isAuthorized(request, authToken) && !relay.verifyMemberAccess(
          roomId,
          actorMemberId,
          memberTokenFromRequest(request, url),
        )) {
          sendJson(response, 401, { ok: false, error: "unauthorized" });
          return;
        }
        const event = relay.publishEvent({
          type: relayEventType(body.type),
          workspaceId: requiredString(body.workspaceId, "workspaceId"),
          roomId,
          actorMemberId,
          targetMemberIds: Array.isArray(body.targetMemberIds) ? body.targetMemberIds.map(String) : undefined,
          turnId: stringValue(body.turnId),
          idempotencyKey: stringValue(body.idempotencyKey),
          payload: body.payload ?? {},
        });
        sendJson(response, 200, { ok: true, event });
        return;
      }

      if (request.method === "GET" && roomStreamMatch) {
        const roomId = decodeURIComponent(roomStreamMatch[1]!);
        const memberId = requiredString(url.searchParams.get("memberId"), "memberId");
        if (authToken && !isAuthorized(request, authToken) && !relay.verifyMemberAccess(
          roomId,
          memberId,
          memberTokenFromRequest(request, url),
        )) {
          sendJson(response, 401, { ok: false, error: "unauthorized" });
          return;
        }
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        const send = (event: RelayEventEnvelope) => {
          response.write(`event: room.event\n`);
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        for (const event of relay.listEventsForMember(roomId, memberId)) {
          send(event);
        }
        const unsubscribe = relay.subscribeRoom(roomId, memberId, send);
        request.on("close", unsubscribe);
        return;
      }

      sendJson(response, 404, { ok: false, error: "not_found" });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.log(`OpenGrove relay listening on http://${host}:${boundPort}`);
  });
  return server;
}

function applyCors(response: ServerResponse) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization,x-opengrove-relay-token,x-opengrove-member-token");
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization;
  if (authorization === `Bearer ${token}`) return true;
  const relayToken = request.headers["x-opengrove-relay-token"];
  return Array.isArray(relayToken) ? relayToken.includes(token) : relayToken === token;
}

function memberTokenFromRequest(request: IncomingMessage, url: URL): string | undefined {
  const header = request.headers["x-opengrove-member-token"];
  if (Array.isArray(header)) return header.find(Boolean);
  return header || stringValue(url.searchParams.get("memberToken"));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, status: number, html: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function inviteAcceptPage(input: { relayBaseUrl: string; token: string }): string {
  const token = escapeHtml(input.token);
  const relay = escapeHtml(input.relayBaseUrl);
  const deepLink = `opengrove://relay-invite?relay=${encodeURIComponent(input.relayBaseUrl)}&token=${encodeURIComponent(input.token)}`;
  const localOpenGroveUrl = `http://127.0.0.1:37373/ui/?view=rooms&relayBaseUrl=${encodeURIComponent(input.relayBaseUrl)}&relayInviteToken=${encodeURIComponent(input.token)}`;
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenGrove 员工邀请</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101112; color: #f3f4f6; }
      main { width: min(560px, calc(100vw - 40px)); border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 28px; background: rgba(255,255,255,.06); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 16px; color: #c7c9cf; line-height: 1.6; }
      code { display: block; overflow-wrap: anywhere; padding: 12px; border-radius: 12px; background: rgba(0,0,0,.25); color: #fff; }
      a, button { appearance: none; border: 0; border-radius: 12px; background: #2f6df6; color: white; padding: 10px 14px; font-weight: 700; text-decoration: none; cursor: pointer; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
      small { display: block; margin-top: 16px; color: #8f949e; }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenGrove 员工邀请</h1>
      <p>这个邀请来自 Relay：${relay}。打开本机 OpenGrove 后，用这个邀请进入聊天室并选择一个员工加入。</p>
      <code id="token">${token}</code>
      <div class="actions">
        <a href="${escapeHtml(deepLink)}">打开 OpenGrove</a>
        <a href="${escapeHtml(localOpenGroveUrl)}">打开本机网页</a>
        <button type="button" onclick="navigator.clipboard.writeText('${escapeJs(input.token)}')">复制邀请 token</button>
      </div>
      <small>如果浏览器没有自动打开 OpenGrove，复制 token 后在 OpenGrove 的邀请入口粘贴。</small>
    </main>
  </body>
</html>`;
}

function relayBaseUrl(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJs(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, name: string): string {
  const text = stringValue(value);
  if (!text) throw new Error(`${name}_required`);
  return text;
}

function relayMemberKind(value: unknown): RelayMemberKind {
  return ["human", "local-agent", "remote-agent"].includes(String(value))
    ? String(value) as RelayMemberKind
    : "remote-agent";
}

function inviteTargetKind(value: unknown): RelayRoomInvite["targetKind"] {
  return ["remote-agent", "human"].includes(String(value))
    ? String(value) as RelayRoomInvite["targetKind"]
    : "remote-agent";
}

function relayEventType(value: unknown): RelayEventType {
  const text = String(value);
  const allowed: RelayEventType[] = [
    "invite.created",
    "invite.accepted",
    "invite.revoked",
    "member.joined",
    "member.updated",
    "member.removed",
    "presence.updated",
    "room.message.created",
    "room.turn.started",
    "room.turn.delta",
    "room.turn.tool.started",
    "room.turn.tool.finished",
    "room.turn.approval.requested",
    "room.turn.approval.resolved",
    "room.turn.final",
    "room.turn.failed",
    "room.turn.cancelled",
    "attachment.created",
    "attachment.access.requested",
    "attachment.access.granted",
  ];
  if (!allowed.includes(text as RelayEventType)) throw new Error("event_type_invalid");
  return text as RelayEventType;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}
