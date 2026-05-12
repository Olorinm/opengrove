import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { startLocalBridgeServer } from "../server/local-bridge.js";
import { startOpenGroveServer } from "../server/create-server.js";
import { normalizeBridgeApiUrl } from "../server/api-paths.js";

assert.equal(normalizeBridgeApiUrl(new URL("http://example.test/api/health")).pathname, "/health");
assert.equal(normalizeBridgeApiUrl(new URL("http://example.test/api")).pathname, "/");
assert.equal(normalizeBridgeApiUrl(new URL("http://example.test/health")).pathname, "/health");

const dir = mkdtempSync(join(tmpdir(), "opengrove-server-profile-"));
const server = startLocalBridgeServer({
  host: "127.0.0.1",
  port: 0,
  statePath: join(dir, "state.json"),
});

try {
  if (!server.listening) {
    await once(server, "listening");
  }
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await getJson(`${baseUrl}/api/health`);
  assert.equal(health.ok, true);
  assert.equal(health.capabilities.profile, "local");
  assert.equal(health.capabilities.api.prefix, "/api");
  assert.equal(health.capabilities.api.legacyPaths, true);

  const legacyHealth = await getJson(`${baseUrl}/health`);
  assert.equal(legacyHealth.ok, true);
  assert.equal(legacyHealth.capabilities.profile, "local");

  const probePreflight = await fetch(`${baseUrl}/opengrove-probe`, {
    method: "OPTIONS",
    headers: {
      origin: "https://relay.example.com",
      "access-control-request-method": "GET",
      "access-control-request-private-network": "true",
    },
  });
  assert.equal(probePreflight.status, 204);
  assert.equal(probePreflight.headers.get("access-control-allow-origin"), "https://relay.example.com");
  assert.equal(probePreflight.headers.get("access-control-allow-private-network"), "true");

  const probe = await fetch(`${baseUrl}/opengrove-probe`, {
    headers: {
      origin: "https://relay.example.com",
    },
  });
  assert.equal(probe.status, 200);
  assert.equal(probe.headers.get("access-control-allow-origin"), "https://relay.example.com");
  const probeJson = await probe.json() as { ok?: boolean; product?: string; name?: string };
  assert.equal(probeJson.ok, true);
  assert.equal(probeJson.product, "OpenGrove");
  assert.equal(probeJson.name, "opengrove-local-bridge");

  const capabilities = await getJson(`${baseUrl}/api/capabilities`);
  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.capabilities.storage, "json");

  const inventory = await getJson(`${baseUrl}/api/inventory`);
  assert.equal(inventory.ok, true);
  assert.equal(Array.isArray(inventory.sessions), true);
  assert.equal(Array.isArray(inventory.runs), true);
  assert.equal(Array.isArray(inventory.executions), true);

  const settings = await getJson(`${baseUrl}/api/settings`);
  assert.equal(settings.ok, true);
  assert.equal(typeof settings.settings.activeKernel, "string");

  await verifyServerProfileGuards(dir);

  console.log("server-profile-harness ok");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  rmSync(dir, { recursive: true, force: true });
}

process.exit(0);

async function verifyServerProfileGuards(dir: string): Promise<void> {
  const token = "server-profile-harness-token";
  const server = startOpenGroveServer({
    host: "127.0.0.1",
    port: 0,
    profile: "server",
    bridgeToken: token,
    statePath: join(dir, "server-state.json"),
  });
  try {
    if (!server.listening) {
      await once(server, "listening");
    }
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const capabilities = await getJson(`${baseUrl}/api/capabilities`);
    assert.equal(capabilities.capabilities.profile, "server");
    assert.equal(capabilities.capabilities.desktop.directoryPicker, false);
    assert.equal(capabilities.capabilities.desktop.importFolderPicker, false);
    assert.equal(capabilities.capabilities.desktop.installKernel, false);

    const response = await fetch(`${baseUrl}/api/workspace/choose-directory`, {
      method: "POST",
      headers: { "x-opengrove-token": token },
    });
    assert.equal(response.status, 403);
    const body = await response.json() as { error?: string };
    assert.equal(body.error, "capability_unavailable");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    assert.fail(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}
