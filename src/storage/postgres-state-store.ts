import { Pool } from "pg";
import {
  normalizePersistedAgentState,
  restorePersistedAgentState,
  snapshotPersistedAgentState,
  type AgentStateStore,
  type PersistableAgentStatePorts,
  type PersistedAgentState,
} from "./json-state-store.js";

export interface PostgresStateStoreOptions {
  connectionString: string;
  workspaceId?: string;
  tableName?: string;
}

export type PostgresStateStore = AgentStateStore & {
  readonly kind: "postgres";
};

export async function createPostgresStateStore(
  options: PostgresStateStoreOptions,
): Promise<PostgresStateStore> {
  const workspaceId = options.workspaceId?.trim() || "default";
  const tableName = safeTableName(options.tableName ?? "opengrove_state_snapshots");
  const pool = new Pool({ connectionString: options.connectionString });

  await ensurePostgresStateTable(pool, tableName);

  const loaded = await pool.query<{ snapshot: unknown }>(
    `select snapshot from ${tableName} where workspace_id = $1`,
    [workspaceId],
  );
  let cached = loaded.rows[0]?.snapshot
    ? normalizePersistedAgentState(loaded.rows[0].snapshot)
    : undefined;
  let pendingWrite: Promise<void> = Promise.resolve();

  async function writeSnapshot(snapshot: PersistedAgentState): Promise<void> {
    await writePostgresStateSnapshotWithPool(pool, tableName, workspaceId, snapshot);
  }

  return {
    path: `postgres://${workspaceId}/${tableName}`,
    kind: "postgres",
    loadInto(app) {
      if (!cached) {
        return undefined;
      }
      restorePersistedAgentState(app, cached);
      return cached;
    },
    saveFrom(app: PersistableAgentStatePorts) {
      cached = snapshotPersistedAgentState(app);
      pendingWrite = pendingWrite
        .catch(() => undefined)
        .then(() => cached ? writeSnapshot(cached) : undefined);
      return cached;
    },
    async flush() {
      await pendingWrite;
    },
    async close() {
      await pendingWrite;
      await pool.end();
    },
  };
}

export async function savePostgresStateSnapshot(
  options: PostgresStateStoreOptions,
  snapshot: PersistedAgentState,
): Promise<void> {
  const workspaceId = options.workspaceId?.trim() || "default";
  const tableName = safeTableName(options.tableName ?? "opengrove_state_snapshots");
  const pool = new Pool({ connectionString: options.connectionString });
  try {
    await ensurePostgresStateTable(pool, tableName);
    await writePostgresStateSnapshotWithPool(pool, tableName, workspaceId, snapshot);
  } finally {
    await pool.end();
  }
}

async function ensurePostgresStateTable(pool: Pool, tableName: string): Promise<void> {
  await pool.query(`
    create table if not exists ${tableName} (
      workspace_id text primary key,
      snapshot jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
}

async function writePostgresStateSnapshotWithPool(
  pool: Pool,
  tableName: string,
  workspaceId: string,
  snapshot: PersistedAgentState,
): Promise<void> {
  await pool.query(
    `
      insert into ${tableName} (workspace_id, snapshot, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (workspace_id)
      do update set snapshot = excluded.snapshot, updated_at = now()
    `,
    [workspaceId, JSON.stringify(snapshot)],
  );
}

function safeTableName(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid Postgres state table name: ${value}`);
  }
  return trimmed;
}
