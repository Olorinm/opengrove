import type { AgentEvent } from "../../core.js";
import { appEnvName, readAppEnv } from "../../identity.js";
import {
  GenericCliRuntime,
  type GenericCliRuntimeOptions,
} from "../../runtime/generic-cli-runtime.js";
import type { ProviderHttpCaptureOptions } from "../../runtime/provider-http-capture.js";
import {
  commandVersion,
  directorySource,
  fileSource,
  plannedInstallAction,
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
  | "opencode";

export interface ExternalCliKernelDefinition {
  id: ExternalCliKernelId;
  title: string;
  envName: string;
  commands: string[];
  versionArgs?: string[];
  runArgs?: string[];
  promptMode?: "stdin" | "arg";
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
  readonly capabilities = EXTERNAL_CAPABILITIES;
  readonly contract: KernelAdapterContract;
  private readonly runtime?: GenericCliRuntime;

  constructor(
    private readonly definition: ExternalCliKernelDefinition,
    private readonly options: {
      command?: string;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      providerHttpCapture?: ProviderHttpCaptureOptions;
    } = {},
  ) {
    this.id = definition.id;
    this.title = definition.title;
    this.contract = createExternalCliContract(definition);
    const command = options.command || resolveExternalCliCommand(definition);
    if (command) {
      this.runtime = new GenericCliRuntime({
        kernelId: definition.id,
        title: definition.title,
        command,
        args: definition.runArgs,
        promptMode: definition.promptMode ?? "stdin",
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
    runArgs: ["-p"],
    promptMode: "arg",
    configHome: resolveHomePath(".pi"),
    knowledgeSources: [
      fileSource({ id: "pi.agents", title: "AGENTS.md", kind: "project_instructions", scope: "user", path: "~/.pi/agent/AGENTS.md" }),
      directorySource({ id: "pi.agent", title: "Pi agent config", kind: "config", scope: "user", path: "~/.pi/agent", knowledgeLike: false }),
      directorySource({ id: "pi.skills", title: "skills", kind: "skills", scope: "user", path: "~/.pi/agent/skills" }),
      directorySource({ id: "pi.packages", title: "packages", kind: "plugins", scope: "user", path: "~/.pi/agent/packages" }),
    ],
    installActions: [plannedInstallAction({ id: "pi.install", title: "安装 Pi", command: ["npm", "install", "-g", "@earendil-works/pi-coding-agent"] })],
    notes: ["Pi uses the upstream pi-mono coding agent CLI. OpenGrove launches it in one-shot mode with `pi -p`."],
  },
  {
    id: "openclaw",
    title: "OpenClaw",
    envName: "OPENCLAW_BIN",
    commands: ["openclaw"],
    runArgs: ["agent", "--message"],
    promptMode: "arg",
    configHome: resolveHomePath(".openclaw"),
    knowledgeSources: [
      directorySource({ id: "openclaw.skills", title: "skills", kind: "skills", scope: "user", path: "~/.openclaw/skills" }),
      directorySource({ id: "openclaw.memory", title: "memory", kind: "memory", scope: "user", path: "~/.openclaw/memory" }),
      directorySource({ id: "openclaw.providers", title: "providers", kind: "settings", scope: "user", path: "~/.openclaw/providers", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "openclaw.install", title: "安装 OpenClaw", command: ["npm", "install", "-g", "openclaw"] })],
    notes: ["OpenClaw has its own gateway/provider layer; OpenGrove treats it as a high-level kernel instead of flattening it into a simple CLI."],
  },
  {
    id: "deepseek-tui",
    title: "DeepSeek TUI",
    envName: "DEEPSEEK_TUI_BIN",
    commands: ["deepseek"],
    runArgs: ["--print"],
    promptMode: "arg",
    configHome: resolveHomePath(".deepseek"),
    knowledgeSources: [
      fileSource({ id: "deepseek.config", title: "config.toml", kind: "config", scope: "user", path: "~/.deepseek/config.toml", knowledgeLike: false }),
      directorySource({ id: "deepseek.skills", title: "skills", kind: "skills", scope: "user", path: "~/.deepseek/skills" }),
      directorySource({ id: "deepseek.memory", title: "memory", kind: "memory", scope: "user", path: "~/.deepseek/memory" }),
      fileSource({ id: "deepseek.project-config", title: "Project config.toml", kind: "config", scope: "project", path: `${process.cwd()}/.deepseek/config.toml`, knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "deepseek.install", title: "安装 DeepSeek TUI", command: ["npm", "install", "-g", "deepseek-tui"] })],
  },
  {
    id: "gemini-cli",
    title: "Gemini CLI",
    envName: "GEMINI_CLI_BIN",
    commands: ["gemini"],
    runArgs: ["--prompt"],
    promptMode: "arg",
    configHome: resolveHomePath(".gemini"),
    knowledgeSources: [
      fileSource({ id: "gemini.instructions", title: "GEMINI.md", kind: "project_instructions", scope: "user", path: "~/.gemini/GEMINI.md" }),
      directorySource({ id: "gemini.config", title: "Gemini config", kind: "config", scope: "user", path: "~/.gemini", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "gemini.install", title: "安装 Gemini CLI", command: ["npm", "install", "-g", "@google/gemini-cli"] })],
  },
  {
    id: "qwen-code",
    title: "Qwen Code",
    envName: "QWEN_CODE_BIN",
    commands: ["qwen"],
    runArgs: ["--prompt"],
    promptMode: "arg",
    configHome: resolveHomePath(".qwen"),
    knowledgeSources: [
      fileSource({ id: "qwen.instructions", title: "QWEN.md", kind: "project_instructions", scope: "user", path: "~/.qwen/QWEN.md" }),
      directorySource({ id: "qwen.config", title: "Qwen config", kind: "config", scope: "user", path: "~/.qwen", knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "qwen.install", title: "安装 Qwen Code", command: ["npm", "install", "-g", "@qwen-code/qwen-code"] })],
  },
  {
    id: "opencode",
    title: "OpenCode",
    envName: "OPENCODE_BIN",
    commands: ["opencode"],
    runArgs: ["run"],
    promptMode: "arg",
    configHome: resolveHomePath(".config", "opencode"),
    knowledgeSources: [
      directorySource({ id: "opencode.config", title: "OpenCode config", kind: "config", scope: "user", path: "~/.config/opencode", knowledgeLike: false }),
      fileSource({ id: "opencode.project-config", title: "opencode.json", kind: "config", scope: "project", path: `${process.cwd()}/opencode.json`, knowledgeLike: false }),
    ],
    installActions: [plannedInstallAction({ id: "opencode.install", title: "安装 OpenCode", command: ["npm", "install", "-g", "opencode-ai"] })],
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
  if (configured) return configured;
  for (const command of definition.commands) {
    if (commandVersion(command, definition.versionArgs ?? ["--version"])) {
      return command;
    }
  }
  return undefined;
}

function createExternalCliContract(definition: ExternalCliKernelDefinition): KernelAdapterContract {
  return {
    ownership: [
      {
        feature: "session",
        owner: "adapter",
        appResponsibility: "Own OpenGrove session ids and UI state.",
        adapterResponsibility: "Launch the external CLI per turn unless a native session API is added.",
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
      defaultModeId: "process-stdio",
      modes: [
        {
          id: "process-stdio",
          title: `${definition.title} process stdio`,
          layer: "process-stdio",
          status: "implemented",
          redaction: "redacted",
        },
        {
          id: "provider-http",
          title: "Provider HTTPS capture",
          layer: "provider-http",
          status: "implemented",
          redaction: "redacted",
        },
      ],
    },
  };
}
