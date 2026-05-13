import type { AgentEvent } from "../../core.js";
import { appEnvName, readAppEnv } from "../../identity.js";
import {
  AcpCliRuntime,
  type AcpCliRuntimeOptions,
} from "../../runtime/acp-cli-runtime.js";
import {
  GenericCliRuntime,
  type GenericCliRuntimeOptions,
} from "../../runtime/generic-cli-runtime.js";
import type { ProviderHttpCaptureOptions } from "../../runtime/provider-http-capture.js";
import type { KernelTransportKind } from "../../runtime/transports/types.js";
import {
  commandVersion,
  directorySource,
  fileSource,
  plannedInstallAction,
  resolveCommandPath,
  resolveHomePath,
} from "../discovery.js";
import type {
  KernelAdapter,
  KernelAdapterContract,
  KernelCapabilities,
  KernelDiscovery,
  KernelHealth,
  KernelInstallAction,
  KernelKnowledgeSource,
  KernelSessionHandle,
  KernelSessionStart,
  KernelTurnRequest,
} from "../types.js";

export type ExternalCliKernelId =
  | "pi"
  | "openclaw"
  | "deepseek-tui"
  | "gemini-cli"
  | "qwen-code"
  | "opencode"
  | "copilot"
  | "cursor-agent"
  | "kimi"
  | "kiro-cli";

export interface ExternalCliKernelDefinition {
  id: ExternalCliKernelId;
  title: string;
  envName: string;
  commands: string[];
  versionArgs?: string[];
  runArgs?: string[];
  promptMode?: "stdin" | "arg";
  promptLayout?: GenericCliRuntimeOptions["promptLayout"];
  outputFormat?: GenericCliRuntimeOptions["outputFormat"];
  acpRuntime?: {
    args?: string[];
    promptPayload?: AcpCliRuntimeOptions["promptPayload"];
    resumeSessions?: boolean;
    setModelFailure?: AcpCliRuntimeOptions["setModelFailure"];
  };
  preferredTransport?: KernelTransportKind;
  configHome: string;
  knowledgeSources: KernelKnowledgeSource[];
  installActions?: KernelInstallAction[];
  notes?: string[];
}

const EXTERNAL_CAPABILITIES: KernelCapabilities = {
  streaming: false,
  toolCalls: true,
  hostTools: false,
  approvals: false,
  elicitation: false,
  artifacts: true,
  compaction: false,
  authRefresh: false,
  sandbox: ["danger-full-access"],
  knowledge: {
    nativeSkills: true,
    toolMediatedSkills: false,
    progressiveDisclosure: true,
    nativeArtifacts: false,
    deliveryLedger: true,
  },
};

export class ExternalCliKernelAdapter implements KernelAdapter {
  readonly id: ExternalCliKernelId;
  readonly title: string;
  readonly capabilities: KernelCapabilities;
  readonly contract: KernelAdapterContract;
  private readonly runtime?: GenericCliRuntime | AcpCliRuntime;

  constructor(
    private readonly definition: ExternalCliKernelDefinition,
    private readonly options: {
      command?: string;
      cwd?: string;
      configuredModel?: string;
      runtimeBindingFingerprint?: string;
      env?: NodeJS.ProcessEnv;
      providerHttpCapture?: ProviderHttpCaptureOptions;
    } = {},
  ) {
    this.id = definition.id;
    this.title = definition.title;
    this.capabilities = createExternalCliCapabilities(definition);
    this.contract = createExternalCliContract(definition);
    const command = options.command || resolveExternalCliCommand(definition);
    if (command && definition.acpRuntime) {
      this.runtime = new AcpCliRuntime({
        kernelId: definition.id,
        title: definition.title,
        command,
        acpArgs: definition.acpRuntime.args,
        promptPayload: definition.acpRuntime.promptPayload,
        resumeSessions: definition.acpRuntime.resumeSessions,
        setModelFailure: definition.acpRuntime.setModelFailure,
        cwd: options.cwd,
        configuredModel: options.configuredModel,
        runtimeBindingFingerprint: options.runtimeBindingFingerprint,
        env: options.env,
        providerHttpCapture: options.providerHttpCapture,
      });
    } else if (command && definition.runArgs) {
      this.runtime = new GenericCliRuntime({
        kernelId: definition.id,
        title: definition.title,
        command,
        args: definition.runArgs,
        promptMode: definition.promptMode ?? "stdin",
        promptLayout: definition.promptLayout,
        outputFormat: definition.outputFormat ?? "text",
        cwd: options.cwd,
        env: options.env,
        providerHttpCapture: options.providerHttpCapture,
      });
    }
  }

  async healthCheck(): Promise<KernelHealth> {
    const command = this.options.command || resolveExternalCliCommand(this.definition);
    if (!command) {
      return {
        status: "unavailable",
        message: `${this.definition.title} CLI was not found. Set ${appEnvName(this.definition.envName)}.`,
      };
    }
    return { status: "ok", message: `${this.definition.title} CLI detected.` };
  }

  async discover(): Promise<KernelDiscovery> {
    return discoverExternalCliKernel(this.definition, this.options.command);
  }

  async startSession(input: KernelSessionStart): Promise<KernelSessionHandle> {
    const now = new Date().toISOString();
    return {
      kernelId: this.id,
      sessionId: input.sessionId,
      nativeSessionId: `${this.id}_${input.sessionId}`,
      createdAt: now,
      updatedAt: now,
    };
  }

  async resumeSession(sessionId: string): Promise<KernelSessionHandle> {
    return this.startSession({ sessionId });
  }

  async *runTurn(request: KernelTurnRequest): AsyncIterable<AgentEvent> {
    if (this.runtime) {
      yield* this.runtime.runTurn(request);
      return;
    }
    const runId = request.runId ?? `run_${Date.now()}`;
    const message = `${this.title} adapter is available, but the CLI is not installed or configured. Set ${appEnvName(this.definition.envName)} or install the native agent.`;
    yield { type: "turn.started", runId, at: new Date().toISOString() };
    yield { type: "assistant.delta", runId, text: message };
    yield { type: "model.response", runId, response: { text: message } };
    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }
}

export const EXTERNAL_CLI_KERNELS: ExternalCliKernelDefinition[] = [
  {
    id: "pi",
    title: "Pi",
    envName: "PI_BIN",
    commands: ["pi"],
    configHome: resolveHomePath(".pi"),
    knowledgeSources: [
      fileSource({ id: "pi.agents", title: "AGENTS.md", kind: "project_instructions", scope: "user", path: "~/.pi/agent/AGENTS.md" }),
      directorySource({ id: "pi.agent", title: "Pi agent config", kind: "config", scope: "user", path: "~/.pi/agent", knowledgeLike: false }),
      directorySource({ id: "pi.skills", title: "skills", kind: "skills", scope: "user", path: "~/.pi/agent/skills" }),
      directorySource({ id: "pi.packages", title: "packages", kind: "plugins", scope: "user", path: "~/.pi/agent/packages" }),
    ],
    installActions: [plannedInstallAction({ id: "pi.install", title: "安装 Pi", command: ["npm", "install", "-g", "@earendil-works/pi-coding-agent"] })],
    preferredTransport: "sdk-inprocess",
    notes: ["OpenGrove uses the Pi Agent SDK in-process, binding OpenGrove sessions directly to NativePiSession instead of shelling out through a prompt-only CLI."],
  },
  {
    id: "openclaw",
    title: "OpenClaw",
    envName: "OPENCLAW_BIN",
    commands: ["openclaw"],
    configHome: resolveHomePath(".openclaw"),
    knowledgeSources: [
      directorySource({ id: "openclaw.skills", title: "skills", kind: "skills", scope: "user", path: "~/.openclaw/skills" }),
      directorySource({ id: "openclaw.memory", title: "memory", kind: "memory", scope: "user", path: "~/.openclaw/memory" }),
      directorySource({ id: "openclaw.providers", title: "providers", kind: "settings", scope: "user", path: "~/.openclaw/providers", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "openclaw.install", title: "安装 OpenClaw", command: ["npm", "install", "-g", "openclaw"] })],
    preferredTransport: "websocket-gateway",
    notes: ["OpenGrove connects to OpenClaw Gateway WebSocket and uses `chat.send` plus `agent.wait`; prompt-only CLI execution is not part of this adapter."],
  },
  {
    id: "deepseek-tui",
    title: "DeepSeek TUI",
    envName: "DEEPSEEK_TUI_BIN",
    commands: ["deepseek"],
    acpRuntime: { args: ["serve", "--acp"], setModelFailure: "ignore" },
    configHome: resolveHomePath(".deepseek"),
    knowledgeSources: [
      fileSource({ id: "deepseek.config", title: "config.toml", kind: "config", scope: "user", path: "~/.deepseek/config.toml", knowledgeLike: false }),
      directorySource({ id: "deepseek.skills", title: "skills", kind: "skills", scope: "user", path: "~/.deepseek/skills" }),
      directorySource({ id: "deepseek.memory", title: "memory", kind: "memory", scope: "user", path: "~/.deepseek/memory" }),
      fileSource({ id: "deepseek.project-config", title: "Project config.toml", kind: "config", scope: "project", path: `${process.cwd()}/.deepseek/config.toml`, knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "deepseek.install", title: "安装 DeepSeek TUI", command: ["npm", "install", "-g", "deepseek-tui"] })],
    preferredTransport: "acp",
    notes: ["DeepSeek TUI is launched as an ACP stdio server with `deepseek serve --acp`; prompt-only CLI execution is not part of this adapter."],
  },
  {
    id: "gemini-cli",
    title: "Gemini CLI",
    envName: "GEMINI_CLI_BIN",
    commands: ["gemini"],
    runArgs: ["--output-format", "stream-json", "--prompt"],
    promptMode: "arg",
    outputFormat: "agent-jsonl",
    configHome: resolveHomePath(".gemini"),
    knowledgeSources: [
      fileSource({ id: "gemini.instructions", title: "GEMINI.md", kind: "project_instructions", scope: "user", path: "~/.gemini/GEMINI.md" }),
      directorySource({ id: "gemini.config", title: "Gemini config", kind: "config", scope: "user", path: "~/.gemini", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "gemini.install", title: "安装 Gemini CLI", command: ["npm", "install", "-g", "@google/gemini-cli"] })],
    preferredTransport: "oneshot-cli",
    notes: ["Headless stream-json is the deepest stable public path for Gemini CLI; OpenGrove parses JSONL and does not surface raw protocol frames."],
  },
  {
    id: "qwen-code",
    title: "Qwen Code",
    envName: "QWEN_CODE_BIN",
    commands: ["qwen"],
    runArgs: ["--output-format", "stream-json", "--include-partial-messages", "--prompt"],
    promptMode: "arg",
    outputFormat: "agent-jsonl",
    configHome: resolveHomePath(".qwen"),
    knowledgeSources: [
      fileSource({ id: "qwen.instructions", title: "QWEN.md", kind: "project_instructions", scope: "user", path: "~/.qwen/QWEN.md" }),
      directorySource({ id: "qwen.config", title: "Qwen config", kind: "config", scope: "user", path: "~/.qwen", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "qwen.install", title: "安装 Qwen Code", command: ["npm", "install", "-g", "@qwen-code/qwen-code"] })],
    preferredTransport: "oneshot-cli",
    notes: ["Headless stream-json with partial messages is Qwen Code's current structured automation path; stream-json input remains under construction upstream."],
  },
  {
    id: "opencode",
    title: "OpenCode",
    envName: "OPENCODE_BIN",
    commands: ["opencode"],
    acpRuntime: { args: ["acp"], setModelFailure: "ignore" },
    configHome: resolveHomePath(".config", "opencode"),
    knowledgeSources: [
      directorySource({ id: "opencode.config", title: "OpenCode config", kind: "config", scope: "user", path: "~/.config/opencode", knowledgeLike: false }),
      fileSource({ id: "opencode.project-config", title: "opencode.json", kind: "config", scope: "project", path: `${process.cwd()}/opencode.json`, knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "opencode.install", title: "安装 OpenCode", command: ["npm", "install", "-g", "opencode-ai"] })],
    preferredTransport: "acp",
    notes: ["OpenGrove uses `opencode acp` instead of one-shot `opencode run`, so assistant deltas, tool calls, and permission requests stay structured."],
  },
  {
    id: "copilot",
    title: "GitHub Copilot CLI",
    envName: "COPILOT_BIN",
    commands: ["copilot"],
    acpRuntime: { args: ["--acp", "--stdio"], setModelFailure: "ignore" },
    configHome: resolveHomePath(".copilot"),
    knowledgeSources: [
      fileSource({ id: "copilot.instructions", title: "copilot-instructions.md", kind: "project_instructions", scope: "project", path: `${process.cwd()}/.github/copilot-instructions.md` }),
      directorySource({ id: "copilot.skills", title: "skills", kind: "skills", scope: "project", path: `${process.cwd()}/.github/skills` }),
      directorySource({ id: "copilot.config", title: "Copilot config", kind: "config", scope: "user", path: "~/.copilot", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "copilot.install", title: "安装 GitHub Copilot CLI", command: ["brew", "install", "github/copilot/copilot"] })],
    preferredTransport: "acp",
    notes: ["Copilot CLI's deepest public integration is the ACP server (`copilot --acp --stdio`); OpenGrove uses that path directly."],
  },
  {
    id: "cursor-agent",
    title: "Cursor Agent",
    envName: "CURSOR_AGENT_BIN",
    commands: ["cursor-agent"],
    runArgs: ["-p", "--force", "--output-format", "stream-json"],
    promptMode: "arg",
    outputFormat: "agent-jsonl",
    configHome: resolveHomePath(".cursor"),
    knowledgeSources: [
      directorySource({ id: "cursor.rules", title: "Cursor rules", kind: "project_instructions", scope: "project", path: `${process.cwd()}/.cursor/rules` }),
      directorySource({ id: "cursor.skills", title: "skills", kind: "skills", scope: "project", path: `${process.cwd()}/.cursor/skills` }),
      directorySource({ id: "cursor.config", title: "Cursor config", kind: "config", scope: "user", path: "~/.cursor", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "cursor.install", title: "安装 Cursor Agent", command: ["sh", "-c", "curl https://cursor.com/install -fsS | bash"] })],
    preferredTransport: "oneshot-cli",
    notes: ["Cursor Agent exposes headless `--output-format stream-json`; no stable ACP/app-server path is documented, so OpenGrove parses its JSONL output directly."],
  },
  {
    id: "kimi",
    title: "Kimi CLI",
    envName: "KIMI_BIN",
    commands: ["kimi"],
    acpRuntime: { args: ["acp"], setModelFailure: "error" },
    configHome: resolveHomePath(".kimi"),
    knowledgeSources: [
      directorySource({ id: "kimi.skills", title: "skills", kind: "skills", scope: "user", path: "~/.kimi/skills" }),
      directorySource({ id: "kimi.config", title: "Kimi config", kind: "config", scope: "user", path: "~/.kimi", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "kimi.install", title: "安装 Kimi CLI", command: ["sh", "-c", "curl -LsSf https://code.kimi.com/install.sh | bash"] })],
    preferredTransport: "acp",
    notes: ["Kimi CLI supports ACP out of the box through `kimi acp`; OpenGrove uses that path directly."],
  },
  {
    id: "kiro-cli",
    title: "Kiro CLI",
    envName: "KIRO_CLI_BIN",
    commands: ["kiro-cli"],
    acpRuntime: { args: ["acp"], promptPayload: "content-and-prompt", setModelFailure: "error" },
    configHome: resolveHomePath(".kiro"),
    knowledgeSources: [
      directorySource({ id: "kiro.skills", title: "skills", kind: "skills", scope: "project", path: `${process.cwd()}/.kiro/skills` }),
      directorySource({ id: "kiro.config", title: "Kiro config", kind: "config", scope: "user", path: "~/.kiro", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "kiro.install", title: "安装 Kiro CLI", command: ["sh", "-c", "curl -fsSL https://cli.kiro.dev/install | bash"] })],
    preferredTransport: "acp",
    notes: ["Kiro CLI implements ACP over stdio via `kiro-cli acp`; OpenGrove sends both ACP `prompt` and Kiro's documented `content` payload for compatibility."],
  },
];

export function createExternalCliKernelAdapter(
  definition: ExternalCliKernelDefinition,
  options: ConstructorParameters<typeof ExternalCliKernelAdapter>[1] = {},
): ExternalCliKernelAdapter {
  return new ExternalCliKernelAdapter(definition, options);
}

export function externalCliDefinition(id: string): ExternalCliKernelDefinition | undefined {
  return EXTERNAL_CLI_KERNELS.find((definition) => definition.id === id);
}

export function discoverExternalCliKernel(
  definition: ExternalCliKernelDefinition,
  configuredCommand?: string,
): KernelDiscovery {
  const command = configuredCommand || resolveExternalCliCommand(definition);
  const version = commandVersion(command || definition.commands[0], definition.versionArgs ?? ["--version"]);
  const installed = Boolean(command || version);
  return {
    kernelId: definition.id,
    title: definition.title,
    installed,
    available: installed,
    binaryPath: command,
    version,
    configHome: definition.configHome,
    diagnostics: createExternalCliContract(definition).diagnostics,
    knowledgeSources: definition.knowledgeSources,
    installActions: definition.installActions ?? [],
    notes: definition.notes ?? [
      `${definition.title} is integrated through the generic CLI adapter. Deep protocol support can be added by replacing only this adapter.`,
    ],
  };
}

export function resolveExternalCliCommand(definition: ExternalCliKernelDefinition): string | undefined {
  const configured = readAppEnv(definition.envName)?.trim();
  const resolvedConfigured = resolveCommandPath(configured);
  if (resolvedConfigured) return resolvedConfigured;
  for (const command of definition.commands) {
    const resolvedCommand = resolveCommandPath(command);
    if (resolvedCommand && commandVersion(resolvedCommand, definition.versionArgs ?? ["--version"])) {
      return resolvedCommand;
    }
  }
  return undefined;
}

function createExternalCliContract(definition: ExternalCliKernelDefinition): KernelAdapterContract {
  const preferredTransport = definition.preferredTransport ?? "oneshot-cli";
  const preferredImplemented =
    preferredTransport === "oneshot-cli" ||
    preferredTransport === "sdk-inprocess" ||
    preferredTransport === "websocket-gateway" ||
    Boolean(definition.acpRuntime);
  const diagnostics: KernelAdapterContract["diagnostics"] = {
    defaultModeId: `${preferredTransport}-bridge`,
    modes: [
      {
        id: `${preferredTransport}-bridge`,
        title: `${definition.title} ${preferredTransport} bridge`,
        layer: preferredTransport === "http-sse"
          ? "adapter-rpc"
          : preferredTransport === "oneshot-cli" || definition.acpRuntime || definition.runArgs
            ? "process-stdio"
            : "adapter-rpc",
        status: preferredImplemented ? "implemented" : "planned",
        redaction: "redacted",
        notes: definition.notes,
      },
      {
        id: "provider-http",
        title: "Provider HTTPS capture",
        layer: "provider-http",
        status: "implemented",
        redaction: "redacted",
      },
    ],
  };
  if (definition.runArgs || definition.acpRuntime) {
    diagnostics.modes.splice(1, 0, {
      id: "process-stdio",
      title: `${definition.title} process stdio`,
      layer: "process-stdio",
      status: "implemented",
      redaction: "redacted",
    });
  }
  return {
    ownership: [
      {
        feature: "session",
        owner: "adapter",
        appResponsibility: "Own OpenGrove session ids and UI state.",
        adapterResponsibility: preferredTransport === "oneshot-cli"
          ? "Launch the external CLI per turn."
          : `Use ${preferredTransport} as the target integration.`,
        kernelResponsibility: "May maintain its own transcripts/config outside OpenGrove.",
      },
      {
        feature: "model_loop",
        owner: "kernel",
        kernelResponsibility: `${definition.title} owns its internal model/tool loop.`,
        adapterResponsibility: "Do not reimplement native tools; pass prompt, provider env, cwd, and collect stdout/stderr.",
      },
      {
        feature: "context_assembly",
        owner: "shared",
        appResponsibility: "Provide narrow explicit context only.",
        adapterResponsibility: "Serialize OpenGrove ambient context into the prompt or native request field.",
      },
      {
        feature: "diagnostics",
        owner: "shared",
        appResponsibility: "Record OpenGrove trajectory and provider capture settings.",
        adapterResponsibility: "Capture process stdio and provider proxy injection status.",
      },
    ],
    diagnostics: {
      defaultModeId: diagnostics.defaultModeId,
      modes: diagnostics.modes,
    },
  };
}

function createExternalCliCapabilities(definition: ExternalCliKernelDefinition): KernelCapabilities {
  if (definition.acpRuntime) {
    return {
      ...EXTERNAL_CAPABILITIES,
      streaming: true,
      hostTools: false,
      approvals: true,
      compaction: false,
    };
  }
  if (definition.outputFormat === "agent-jsonl") {
    return {
      ...EXTERNAL_CAPABILITIES,
      streaming: true,
    };
  }
  return EXTERNAL_CAPABILITIES;
}
