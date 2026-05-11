import { chmodSync, writeFileSync } from "node:fs";

export interface FakeAcpServerOptions {
  sessionId?: string;
  marker?: string;
  toolTitle?: string;
  toolInput?: string;
  toolOutput?: string;
  includeConfigEcho?: boolean;
}

export interface FakeAcpCommandOptions extends FakeAcpServerOptions {
  commandName?: string;
  version?: string;
  acpSubcommand?: string;
}

export function writeFakeAcpServer(path: string, options: FakeAcpServerOptions = {}): void {
  writeFileSync(path, fakeAcpServerSource(options), "utf8");
}

export function writeFakeAcpCommand(
  path: string,
  serverPath: string,
  options: FakeAcpCommandOptions = {},
): void {
  const version = options.version ?? `${options.commandName ?? "fake-acp"} 0.0.0`;
  const acpSubcommand = options.acpSubcommand ?? "acp";
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      `  echo ${JSON.stringify(version)}`,
      "  exit 0",
      "fi",
      `if [ "$1" = ${JSON.stringify(acpSubcommand)} ]; then`,
      `  exec ${JSON.stringify(process.execPath)} ${JSON.stringify(serverPath)}`,
      "fi",
      "echo \"unexpected fake ACP command invocation: $*\" >&2",
      "exit 2",
    ].join("\n"),
    "utf8",
  );
  chmodSync(path, 0o755);
}

export function fakeAcpServerSource(options: FakeAcpServerOptions = {}): string {
  const sessionId = options.sessionId ?? "fake-acp-session";
  const marker = options.marker ?? "FAKE_ACP_OK";
  const toolTitle = options.toolTitle ?? "terminal: printf OK";
  const toolInput = options.toolInput ?? "printf OK";
  const toolOutput = options.toolOutput ?? "OK";
  return [
    "import { createInterface } from 'node:readline';",
    "import { readFileSync, existsSync } from 'node:fs';",
    "import { resolve } from 'node:path';",
    "const rl = createInterface({ input: process.stdin });",
    "function send(message) { process.stdout.write(`${JSON.stringify(message)}\\n`); }",
    "function configText() {",
    "  const home = process.env.HERMES_HOME || '';",
    "  const path = home ? resolve(home, 'config.yaml') : '';",
    "  return path && existsSync(path) ? readFileSync(path, 'utf8') : '';",
    "}",
    "for await (const line of rl) {",
    "  if (!line.trim()) continue;",
    "  const msg = JSON.parse(line);",
    "  if (msg.method === 'initialize') {",
    "    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'fake-acp', version: '0.0.0' }, agentCapabilities: {} } });",
    "  } else if (msg.method === 'session/new') {",
    `    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: ${JSON.stringify(sessionId)} } });`,
    "  } else if (msg.method === 'session/set_model') {",
    "    send({ jsonrpc: '2.0', id: msg.id, result: {} });",
    "  } else if (msg.method === 'session/prompt') {",
    "    const sessionId = msg.params.sessionId;",
    `    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: ${JSON.stringify(toolTitle)}, kind: 'execute', rawInput: { command: ${JSON.stringify(toolInput)} } } } });`,
    `    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: 'tc-1', status: 'completed', rawOutput: ${JSON.stringify(toolOutput)} } } });`,
    "    const prompt = msg.params.prompt?.[0]?.text || '';",
    options.includeConfigEcho
      ? `    const text = [${JSON.stringify(marker)}, \`PROMPT:\${prompt}\`, \`HERMES_HOME:\${process.env.HERMES_HOME || ''}\`, 'CONFIG_BEGIN', configText(), 'CONFIG_END'].join('\\n');`
      : `    const text = [${JSON.stringify(marker)}, \`PROMPT:\${prompt}\`].join('\\n');`,
    "    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });",
    "    send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } });",
    "  } else {",
    "    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });",
    "  }",
    "}",
  ].join("\n");
}
