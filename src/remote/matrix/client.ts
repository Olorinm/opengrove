export interface MatrixConnectionSettings {
  enabled: boolean;
  homeserverUrl: string;
  userId: string;
  accessToken?: string;
}

type MatrixCreateRoomResponse = {
  room_id?: string;
};

type MatrixJoinRoomResponse = {
  room_id?: string;
};

type MatrixSendEventResponse = {
  event_id?: string;
};

type MatrixSyncResponse = {
  next_batch?: string;
  rooms?: {
    join?: Record<string, {
      timeline?: {
        events?: MatrixRoomEvent[];
      };
      state?: {
        events?: MatrixRoomEvent[];
      };
    }>;
  };
};

export type MatrixRoomEvent = {
  event_id?: string;
  type?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: unknown;
};

export function matrixReady(matrix: MatrixConnectionSettings): boolean {
  return Boolean(
    matrix.enabled
    && normalizeMatrixHomeserverUrl(matrix.homeserverUrl)
    && matrix.userId.trim()
    && matrix.accessToken?.trim()
  );
}

export async function createMatrixRoom(input: {
  matrix: MatrixConnectionSettings;
  localRoomId: string;
  roomTitle: string;
  createdAt: string;
}): Promise<string> {
  const response = await matrixRequest<MatrixCreateRoomResponse>(input.matrix, "POST", "/_matrix/client/v3/createRoom", {
    visibility: "private",
    name: input.roomTitle || "OpenGrove 群聊",
    topic: "OpenGrove shared agent room",
    preset: "private_chat",
    initial_state: [
      {
        type: "m.room.join_rules",
        state_key: "",
        content: { join_rule: "public" },
      },
      {
        type: "org.opengrove.room",
        state_key: "",
        content: {
          version: 1,
          localRoomId: input.localRoomId,
          title: input.roomTitle || "OpenGrove 群聊",
          createdAt: input.createdAt,
        },
      },
    ],
  });
  if (!response.room_id) {
    throw new Error("matrix_room_create_failed");
  }
  return response.room_id;
}

export async function joinMatrixRoom(matrix: MatrixConnectionSettings, roomId: string): Promise<string> {
  const response = await matrixRequest<MatrixJoinRoomResponse>(
    matrix,
    "POST",
    `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
    {},
  );
  if (!response.room_id) {
    throw new Error("matrix_room_join_failed");
  }
  return response.room_id;
}

export async function publishMatrixRoomEvent(
  matrix: MatrixConnectionSettings,
  roomId: string,
  type: string,
  content: unknown,
  txnId = createTxnId(),
): Promise<string> {
  const response = await matrixRequest<MatrixSendEventResponse>(
    matrix,
    "PUT",
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(type)}/${encodeURIComponent(txnId)}`,
    content,
  );
  if (!response.event_id) {
    throw new Error("matrix_event_send_failed");
  }
  return response.event_id;
}

export async function syncMatrixRoom(
  matrix: MatrixConnectionSettings,
  roomId: string,
  since?: string,
): Promise<{ nextBatch: string; events: MatrixRoomEvent[] }> {
  const url = new URL("/_matrix/client/v3/sync", ensureTrailingSlash(normalizeMatrixHomeserverUrl(matrix.homeserverUrl)));
  url.searchParams.set("timeout", "0");
  if (since) url.searchParams.set("since", since);
  const response = await matrixRequest<MatrixSyncResponse>(matrix, "GET", url.pathname + url.search);
  const room = response.rooms?.join?.[roomId];
  return {
    nextBatch: response.next_batch || "",
    events: [
      ...(room?.state?.events ?? []),
      ...(room?.timeline?.events ?? []),
    ],
  };
}

async function matrixRequest<T>(
  matrix: MatrixConnectionSettings,
  method: "GET" | "POST" | "PUT",
  path: string,
  payload?: unknown,
): Promise<T> {
  const response = await fetch(new URL(path, ensureTrailingSlash(normalizeMatrixHomeserverUrl(matrix.homeserverUrl))), {
    method,
    headers: {
      "authorization": `Bearer ${matrix.accessToken}`,
      "content-type": "application/json",
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(parseMatrixError(text) || `matrix_request_failed:${response.status}`);
  }
  return (await response.json()) as T;
}

export function normalizeMatrixHomeserverUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseMatrixError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { errcode?: string; error?: string };
    return parsed.error || parsed.errcode || "";
  } catch {
    return text.trim();
  }
}

function createTxnId(): string {
  return `opengrove_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}
