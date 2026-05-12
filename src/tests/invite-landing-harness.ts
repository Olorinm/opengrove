import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { startInviteLandingServer } from "../invite/invite-landing-server.js";

const server = startInviteLandingServer({
  host: "127.0.0.1",
  port: 0,
});

try {
  if (!server.listening) {
    await once(server, "listening");
  }
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetchJson(`${baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.equal(health.name, "opengrove-invite-landing");

  const invite = await fetch(`${baseUrl}/opengrove/invite?payload=testpayload`);
  assert.equal(invite.status, 200);
  const html = await invite.text();
  assert.equal(html.includes("roomInvite"), true);
  assert.equal(html.includes("/opengrove-probe"), true);

  const missing = await fetch(`${baseUrl}/missing`);
  assert.equal(missing.status, 404);

  console.log("invite-landing-harness ok");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}
