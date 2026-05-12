import { createServer, type ServerResponse } from "node:http";

export type InviteLandingServerOptions = {
  host?: string;
  port?: number;
};

export function startInviteLandingServer(options: InviteLandingServerOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 37372;

  const server = createServer((request, response) => {
    applyCors(response);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, name: "opengrove-invite-landing", time: new Date().toISOString() });
      return;
    }

    if (request.method === "GET" && url.pathname === "/opengrove/invite") {
      sendHtml(response, 200, inviteLandingPage({
        payload: stringValue(url.searchParams.get("payload")) || "",
      }));
      return;
    }

    sendJson(response, 404, { ok: false, error: "not_found" });
  });

  server.listen(port, host, () => {
    const address = server.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    console.log(`OpenGrove invite landing listening on http://${host}:${boundPort}`);
  });
  return server;
}

function applyCors(response: ServerResponse) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendHtml(response: ServerResponse, status: number, html: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function inviteLandingPage(input: { payload: string }): string {
  const payload = escapeHtml(input.payload);
  const localOpenGroveUrl = localInviteUrl(input.payload, 37371);
  const fallbackLocalOpenGroveUrl = localInviteUrl(input.payload, 37373);
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

function localInviteUrl(payload: string, port: number): string {
  const url = new URL("/ui/", `http://127.0.0.1:${port}`);
  url.searchParams.set("view", "rooms");
  url.searchParams.set("roomInvite", payload);
  return url.toString();
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
