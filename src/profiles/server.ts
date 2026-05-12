import { readAppEnv } from "../identity.js";
import { createPostgresStateStore } from "../storage/postgres-state-store.js";
import { startOpenGroveServer } from "../server/create-server.js";
import type { LocalBridgeServerOptions } from "../server/bridge-types.js";

export interface StartServerProfileOptions extends LocalBridgeServerOptions {
  databaseUrl?: string;
  workspaceId?: string;
}

export async function startServerProfile(options: StartServerProfileOptions = {}) {
  const databaseUrl = options.databaseUrl ?? readAppEnv("DATABASE_URL") ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Server profile requires OPENGROVE_DATABASE_URL or DATABASE_URL.");
  }
  const bridgeToken = options.bridgeToken ?? readAppEnv("BRIDGE_TOKEN");
  const allowUnauthenticated = readAppEnv("ALLOW_UNAUTHENTICATED_SERVER") === "1";
  if (!bridgeToken && !allowUnauthenticated) {
    throw new Error("Server profile requires OPENGROVE_BRIDGE_TOKEN. Set OPENGROVE_ALLOW_UNAUTHENTICATED_SERVER=1 only for trusted private networks.");
  }

  const store = await createPostgresStateStore({
    connectionString: databaseUrl,
    workspaceId: options.workspaceId ?? readAppEnv("WORKSPACE_ID") ?? "default",
    tableName: readAppEnv("POSTGRES_STATE_TABLE"),
  });

  return startOpenGroveServer({
    ...options,
    host: options.host ?? readAppEnv("BRIDGE_HOST") ?? "0.0.0.0",
    port: options.port,
    profile: "server",
    bridgeToken,
    store,
  });
}
