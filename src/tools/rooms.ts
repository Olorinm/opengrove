import type { JsonObject, JsonValue, ToolDefinition, ToolResult, ToolSpec } from "../core.js";
import type { RoomChannelStore } from "../rooms/channel-store.js";

export function createRoomLedgerReadTool(spec: ToolSpec, rooms: RoomChannelStore): ToolDefinition<JsonObject, JsonValue> {
  return {
    spec,
    async execute(input): Promise<ToolResult<JsonValue>> {
      const roomId = readString(input.roomId);
      if (!roomId) {
        return { ok: false, error: "room_id_required" };
      }
      const room = rooms.getRoom(roomId);
      if (!room) {
        return { ok: false, error: "room_not_found" };
      }
      const query = readString(input.query).toLowerCase();
      const limit = readNumber(input.limit, 50, 1, 200);
      const beforeSeq = readOptionalNumber(input.beforeSeq);
      const afterSeq = readOptionalNumber(input.afterSeq);
      const messages = rooms
        .listMessages(roomId, { limit: query ? 500 : limit, beforeSeq, afterSeq })
        .filter((message) => !query || message.text.toLowerCase().includes(query) || message.senderName.toLowerCase().includes(query))
        .slice(-limit);
      return {
        ok: true,
        value: {
          room,
          messages,
          currentEventSeq: rooms.snapshot().currentEventSeq,
        } as unknown as JsonValue,
      };
    },
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
