import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { ApprovalInbox, type AgentContext, type AgentEvent } from "../core.js";
import { OpenClawGatewayRuntime } from "../runtime/openclaw-gateway-runtime.js";

async function main() {
  const gateway = await startFakeOpenClawGateway();
  const runtime = new OpenClawGatewayRuntime({
    url: gateway.url,
    requestTimeoutMs: 5_000,
  });

  const events: AgentEvent[] = [];
  for await (const event of runtime.runTurn({
    runId: "run-openclaw-harness",
    input: "first line\nsecond line",
    context: createContext("openclaw-harness-session"),
    tools: [],
    skills: [],
    packs: [],
    capabilities: [],
    assembledContext: {
      id: "ctx-openclaw",
      createdAt: new Date().toISOString(),
      summary: "fake OpenClaw context",
      items: [],
      budget: {
        maxItems: 10,
        usedItems: 0,
        maxCharacters: 1000,
        usedCharacters: 0,
        truncated: false,
      },
      promptBlock: "Host marker: OPENCLAW_CONTEXT_VISIBLE",
    },
  })) {
    events.push(event);
  }

  runtime.close();
  await gateway.close();

  assert.ok(gateway.capturedPrompt.includes("first line\nsecond line"), "Gateway prompt should preserve multiline user input");
  assert.ok(gateway.capturedPrompt.includes("OPENCLAW_CONTEXT_VISIBLE"), "Gateway prompt should include assembled host context");

  const response = events.find((event) => event.type === "model.response");
  assert.ok(response && response.type === "model.response", "OpenClaw Gateway runtime should emit model.response");
  assert.equal(response.response.text, "gateway ok");
  assert.ok(events.some((event) => event.type === "assistant.delta" && event.text === "gateway ok"));
  assert.equal(events.some((event) => event.type === "assistant.delta" && event.text.includes("\"payloads\"")), false);
}

function createContext(sessionId: string): AgentContext {
  return {
    sessionId,
    activity: undefined as any,
    sessions: undefined as any,
    memory: undefined as any,
    artifacts: undefined as any,
    skills: undefined as any,
    executions: undefined as any,
    workingState: undefined as any,
    approvals: new ApprovalInbox(),
    packs: undefined as any,
  };
}

async function startFakeOpenClawGateway(): Promise<{
  url: string;
  capturedPrompt: string;
  close(): Promise<void>;
}> {
  let capturedPrompt = "";
  const sockets = new Set<Duplex>();
  const server = createServer();

  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${webSocketAccept(key)}`,
      "\r\n",
    ].join("\r\n"));

    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const decoded = decodeClientTextFrames(buffered);
      buffered = decoded.remaining;
      for (const text of decoded.messages) {
        handleGatewayRequest(socket, text, (prompt) => {
          capturedPrompt = prompt;
        });
      }
    });
  });

  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    get capturedPrompt() {
      return capturedPrompt;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

function handleGatewayRequest(
  socket: Duplex,
  text: string,
  capturePrompt: (prompt: string) => void,
): void {
  const frame = JSON.parse(text) as {
    type?: string;
    id?: string;
    method?: string;
    params?: Record<string, unknown>;
  };
  if (frame.type !== "req" || !frame.id || !frame.method) return;
  if (frame.method === "connect") {
    sendTextFrame(socket, JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } }));
    return;
  }
  if (frame.method === "chat.send") {
    capturePrompt(typeof frame.params?.message === "string" ? frame.params.message : "");
    sendTextFrame(socket, JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { runId: "native-openclaw-run" } }));
    return;
  }
  if (frame.method === "agent.wait") {
    sendTextFrame(socket, JSON.stringify({
      type: "event",
      event: "agent",
      payload: {
        runId: "native-openclaw-run",
        stream: "assistant",
        data: { text: "gateway ok" },
      },
      seq: 1,
    }));
    sendTextFrame(socket, JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { status: "ok" } }));
    return;
  }
  if (frame.method === "chat.history") {
    sendTextFrame(socket, JSON.stringify({
      type: "res",
      id: frame.id,
      ok: true,
      payload: { messages: [{ role: "assistant", text: "history fallback" }] },
    }));
    return;
  }
  sendTextFrame(socket, JSON.stringify({ type: "res", id: frame.id, ok: false, error: { message: "unknown_method" } }));
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function webSocketAccept(key: string): string {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function decodeClientTextFrames(buffer: Buffer): { messages: string[]; remaining: Buffer } {
  const messages: string[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      throw new Error("fake gateway does not support oversized frames");
    }
    const maskLength = masked ? 4 : 0;
    const frameEnd = offset + headerLength + maskLength + length;
    if (frameEnd > buffer.length) break;
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : undefined;
    const payload = Buffer.from(buffer.subarray(offset + headerLength + maskLength, frameEnd));
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = payload[index]! ^ mask[index % 4]!;
      }
    }
    if (opcode === 1) {
      messages.push(payload.toString("utf8"));
    } else if (opcode === 8) {
      return { messages, remaining: Buffer.alloc(0) };
    }
    offset = frameEnd;
  }
  return { messages, remaining: buffer.subarray(offset) };
}

function sendTextFrame(socket: Duplex, text: string): void {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
