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

      if (request.method === "GET" && url.pathname === "/opengrove/invite") {
        sendHtml(response, 200, genericInvitePage({
          payload: stringValue(url.searchParams.get("payload")) || "",
        }));
        return;
      }

      const publicInviteAccept = request.method === "POST" && url.pathname === "/invites/accept";
      const roomEventsMatch = url.pathname.match(/^\/rooms\/([^/]+)\/events$/);
      const roomStreamMatch = url.pathname.match(/^\/rooms\/([^/]+)\/stream$/);
      const roomMembersMatch = url.pathname.match(/^\/rooms\/([^/]+)\/members$/);
      const publicInviteResolve = request.method === "GET" && url.pathname === "/invites/resolve";
      const canDeferAuthToMemberToken = Boolean(roomEventsMatch || roomStreamMatch || (request.method === "GET" && roomMembersMatch));
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

      if (request.method === "GET" && roomMembersMatch) {
        const roomId = decodeURIComponent(roomMembersMatch[1]!);
        if (authToken && !isAuthorized(request, authToken)) {
          const memberId = stringValue(url.searchParams.get("memberId"));
          if (!memberId || !relay.verifyMemberAccess(roomId, memberId, memberTokenFromRequest(request, url))) {
            sendJson(response, 401, { ok: false, error: "unauthorized" });
            return;
          }
        }
        sendJson(response, 200, { ok: true, members: relay.listMembers(roomId) });
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
  const localOpenGroveUrl = localInviteUrl(input, 37371);
  const fallbackLocalOpenGroveUrl = localInviteUrl(input, 37373);
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
      a, button { appearance: none; border: 0; border-radius: 12px; background: #2f6df6; color: white; padding: 10px 14px; font-weight: 700; text-decoration: none; cursor: pointer; font: inherit; }
      .secondary { background: rgba(255,255,255,.12); color: #f3f4f6; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
      .hidden { display: none; }
      .status { min-height: 22px; margin-top: 14px; color: #aeb4bf; }
      small { display: block; margin-top: 16px; color: #8f949e; }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenGrove 员工邀请</h1>
      <p>这个邀请来自 Relay：${relay}。打开本机 OpenGrove 后，用这个邀请进入聊天室并选择一个员工加入。</p>
      <code id="token">${token}</code>
      <div class="actions">
        <button id="open-local" type="button">检测并打开本机 OpenGrove</button>
        <button class="secondary" id="copy-token" type="button">复制邀请 token</button>
      </div>
      <div class="actions hidden" id="manual-open">
        <a class="secondary" href="${escapeHtml(localOpenGroveUrl)}">手动打开 37371</a>
        <a class="secondary" href="${escapeHtml(fallbackLocalOpenGroveUrl)}">手动打开 37373</a>
      </div>
      <div class="status" id="status"></div>
      <small>如果页面打不开，请确认本机 OpenGrove 已启动。默认端口是 37371；如果你手动启动在其他端口，请复制 token 后在 OpenGrove 的邀请入口粘贴。</small>
    </main>
    <script>
      const token = '${escapeJs(input.token)}';
      const relayBaseUrl = '${escapeJs(input.relayBaseUrl)}';
      const candidatePorts = [37371, 37373, 37372, 37370, 37374, 37375, 37376, 37377, 37378, 37379, 37380];
      const openButton = document.getElementById('open-local');
      const copyButton = document.getElementById('copy-token');
      const manualOpen = document.getElementById('manual-open');
      const status = document.getElementById('status');

      function inviteUrlForPort(port) {
        const url = new URL('/ui/', 'http://127.0.0.1:' + port);
        url.searchParams.set('view', 'rooms');
        url.searchParams.set('relayBaseUrl', relayBaseUrl);
        url.searchParams.set('relayInviteToken', token);
        return url.toString();
      }

      async function probePort(port) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 900);
        try {
          const response = await fetch('http://127.0.0.1:' + port + '/opengrove-probe', {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) return undefined;
          const data = await response.json();
          return data?.ok === true && data?.product === 'OpenGrove' ? port : undefined;
        } catch {
          return undefined;
        } finally {
          window.clearTimeout(timer);
        }
      }

      async function detectOpenGrovePort() {
        const results = await Promise.all(candidatePorts.map(probePort));
        return results.find((port) => typeof port === 'number');
      }

      openButton?.addEventListener('click', async () => {
        openButton.disabled = true;
        status.textContent = '正在检测本机 OpenGrove 端口...';
        const port = await detectOpenGrovePort();
        if (port) {
          status.textContent = '已检测到端口 ' + port + '，正在打开...';
          window.location.href = inviteUrlForPort(port);
          return;
        }
        openButton.disabled = false;
        manualOpen?.classList.remove('hidden');
        status.textContent = '没有自动检测到本机 OpenGrove。请确认 OpenGrove 已启动，或用下方常用端口手动打开。';
      });

      copyButton?.addEventListener('click', async () => {
        let copied = false;
        try {
          if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(token);
            copied = true;
          }
        } catch {}
        if (!copied) {
          const field = document.createElement('textarea');
          field.value = token;
          field.setAttribute('readonly', '');
          field.style.position = 'fixed';
          field.style.opacity = '0';
          document.body.appendChild(field);
          field.select();
          try {
            copied = document.execCommand('copy');
          } catch {}
          field.remove();
        }
        copyButton.textContent = copied ? '已复制' : '请手动复制';
        window.setTimeout(() => {
          copyButton.textContent = '复制邀请 token';
        }, 1800);
      });
    </script>
  </body>
</html>`;
}

function genericInvitePage(input: { payload: string }): string {
  const payload = escapeHtml(input.payload);
  const localOpenGroveUrl = localGenericInviteUrl(input.payload, 37371);
  const fallbackLocalOpenGroveUrl = localGenericInviteUrl(input.payload, 37373);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenGrove 邀请</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101112; color: #f3f4f6; }
      main { width: min(560px, calc(100vw - 40px)); border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 28px; background: rgba(255,255,255,.06); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { margin: 0 0 16px; color: #c7c9cf; line-height: 1.6; }
      code { display: block; overflow-wrap: anywhere; padding: 12px; border-radius: 12px; background: rgba(0,0,0,.25); color: #fff; }
      a, button { appearance: none; border: 0; border-radius: 12px; background: #2f6df6; color: white; padding: 10px 14px; font-weight: 700; text-decoration: none; cursor: pointer; font: inherit; }
      .secondary { background: rgba(255,255,255,.12); color: #f3f4f6; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
      .hidden { display: none; }
      .status { min-height: 22px; margin-top: 14px; color: #aeb4bf; }
      small { display: block; margin-top: 16px; color: #8f949e; }
    </style>
  </head>
  <body>
    <main>
      <h1>OpenGrove 邀请</h1>
      <p>打开本机 OpenGrove 后，用这个邀请进入共享群聊并选择一个员工加入。</p>
      <code id="payload">${payload}</code>
      <div class="actions">
        <button id="open-local" type="button">检测并打开本机 OpenGrove</button>
        <button class="secondary" id="copy-payload" type="button">复制邀请</button>
      </div>
      <div class="actions hidden" id="manual-open">
        <a class="secondary" href="${escapeHtml(localOpenGroveUrl)}">手动打开 37371</a>
        <a class="secondary" href="${escapeHtml(fallbackLocalOpenGroveUrl)}">手动打开 37373</a>
      </div>
      <div class="status" id="status"></div>
      <small>如果页面打不开，请确认本机 OpenGrove 已启动。默认端口是 37371；如果你手动启动在其他端口，请复制邀请后在 OpenGrove 的邀请入口粘贴。</small>
    </main>
    <script>
      const payload = '${escapeJs(input.payload)}';
      const candidatePorts = [37371, 37373, 37372, 37370, 37374, 37375, 37376, 37377, 37378, 37379, 37380];
      const openButton = document.getElementById('open-local');
      const copyButton = document.getElementById('copy-payload');
      const manualOpen = document.getElementById('manual-open');
      const status = document.getElementById('status');

      function inviteUrlForPort(port) {
        const url = new URL('/ui/', 'http://127.0.0.1:' + port);
        url.searchParams.set('view', 'rooms');
        url.searchParams.set('roomInvite', payload);
        return url.toString();
      }

      async function probePort(port) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 900);
        try {
          const response = await fetch('http://127.0.0.1:' + port + '/opengrove-probe', {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) return undefined;
          const data = await response.json();
          return data?.ok === true && data?.product === 'OpenGrove' ? port : undefined;
        } catch {
          return undefined;
        } finally {
          window.clearTimeout(timer);
        }
      }

      async function detectOpenGrovePort() {
        const results = await Promise.all(candidatePorts.map(probePort));
        return results.find((port) => typeof port === 'number');
      }

      openButton?.addEventListener('click', async () => {
        openButton.disabled = true;
        status.textContent = '正在检测本机 OpenGrove 端口...';
        const port = await detectOpenGrovePort();
        if (port) {
          status.textContent = '已检测到端口 ' + port + '，正在打开...';
          window.location.href = inviteUrlForPort(port);
          return;
        }
        openButton.disabled = false;
        manualOpen?.classList.remove('hidden');
        status.textContent = '没有自动检测到本机 OpenGrove。请确认 OpenGrove 已启动，或用下方常用端口手动打开。';
      });

      copyButton?.addEventListener('click', async () => {
        let copied = false;
        try {
          if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(payload);
            copied = true;
          }
        } catch {}
        if (!copied) {
          const field = document.createElement('textarea');
          field.value = payload;
          field.setAttribute('readonly', '');
          field.style.position = 'fixed';
          field.style.opacity = '0';
          document.body.appendChild(field);
          field.select();
          try {
            copied = document.execCommand('copy');
          } catch {}
          field.remove();
        }
        copyButton.textContent = copied ? '已复制' : '请手动复制';
        window.setTimeout(() => {
          copyButton.textContent = '复制邀请';
        }, 1800);
      });
    </script>
  </body>
</html>`;
}

function localInviteUrl(input: { relayBaseUrl: string; token: string }, port: number): string {
  const url = new URL(`http://127.0.0.1:${port}/ui/`);
  url.searchParams.set("view", "rooms");
  url.searchParams.set("relayBaseUrl", input.relayBaseUrl);
  url.searchParams.set("relayInviteToken", input.token);
  return url.toString();
}

function localGenericInviteUrl(payload: string, port: number): string {
  const url = new URL("/ui/", `http://127.0.0.1:${port}`);
  url.searchParams.set("view", "rooms");
  url.searchParams.set("roomInvite", payload);
  return url.toString();
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
