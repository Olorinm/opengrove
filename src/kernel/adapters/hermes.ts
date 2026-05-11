import type { AgentEvent } from "../../core.js";
import {
  HermesRuntime,
  hermesHealth,
  resolveHermesCommandPath,
  type HermesRuntimeOptions,
} from "../../runtime/hermes-runtime.js";
import { APP_CONFIG_DIR, APP_PRODUCT_NAME, APP_PROTOCOL_ID, appEnvName, readAppEnv } from "../../identity.js";
import { commandVersion, directorySource, fileSource, plannedInstallAction, resolveHomePath } from "../discovery.js";
import type { KernelIntegrationManifest } from "../manifest.js";
import type {
  KernelAdapter,
  KernelAdapterContract,
  KernelCapabilities,
  KernelDiscovery,
  KernelHealth,
  KernelSessionHandle,
  KernelSessionStart,
  KernelTurnRequest,
} from "../types.js";

const HERMES_CAPABILITIES: KernelCapabilities = {
  streaming: true,
  toolCalls: true,
  hostTools: false,
  approvals: true,
  elicitation: false,
  artifacts: false,
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

export interface HermesKernelAdapterOptions extends Partial<HermesRuntimeOptions> {}

export class HermesKernelAdapter implements KernelAdapter {
  readonly id = "hermes";
  readonly title = "Hermes";
  readonly capabilities = HERMES_CAPABILITIES;
  readonly contract = HERMES_KERNEL_CONTRACT;
  private readonly runtime?: HermesRuntime;

  constructor(private readonly options: HermesKernelAdapterOptions = {}) {
    if (options.command) {
      this.runtime = new HermesRuntime(options as HermesRuntimeOptions);
    }
  }

  async healthCheck(): Promise<KernelHealth> {
    if (this.options.command) {
      const health = hermesHealth(this.options.command);
      return {
        status: health.ok ? "ok" : "unavailable",
        message: health.message,
      };
    }
    return {
      status: "degraded",
      message: "Hermes adapter is available as a contract stub, but no Hermes CLI command is configured.",
    };
  }

  async discover(): Promise<KernelDiscovery> {
    return discoverHermesKernel(this.options, process.cwd(), this.contract.diagnostics);
  }

  async startSession(input: KernelSessionStart): Promise<KernelSessionHandle> {
    const now = new Date().toISOString();
    return {
      kernelId: this.id,
      sessionId: input.sessionId,
      nativeSessionId: `hermes_stub_${input.sessionId}`,
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
    const text = `Hermes kernel adapter is selected, but no Hermes CLI command is configured. Install Hermes or set ${appEnvName("HERMES_BIN")}.`;

    yield { type: "turn.started", runId, at: new Date().toISOString() };
    if (request.assembledContext) {
      yield { type: "context.assembled", runId, context: request.assembledContext };
    }
    yield {
      type: "model.requested",
      runId,
      request: {
        systemPrompt: "Hermes contract stub",
        userInput: request.input,
        modelId: request.requestedModelId,
        context: request.assembledContext,
        tools: request.tools.map((tool) => tool.spec),
        skills: request.skills ?? [],
        packs: request.packs ?? [],
        capabilities: request.capabilities ?? [],
      },
    };
    yield { type: "assistant.delta", runId, text };
    yield { type: "model.response", runId, response: { text } };
    yield { type: "turn.finished", runId, at: new Date().toISOString() };
  }
}

export function createHermesKernelAdapter(options: HermesKernelAdapterOptions = {}): HermesKernelAdapter {
  return new HermesKernelAdapter(options);
}

export function discoverHermesKernel(
  options: HermesKernelAdapterOptions = {},
  cwd = process.cwd(),
  diagnostics = HERMES_KERNEL_CONTRACT.diagnostics,
): KernelDiscovery {
  const hermesHome = options.env?.HERMES_HOME || process.env.HERMES_HOME || resolveHomePath(".hermes");
  const command = options.command || resolveHermesCommandPath() || readAppEnv("HERMES_BIN") || "hermes";
  const version = commandVersion(command);
  const installed = Boolean(version);
  return {
    kernelId: "hermes",
    title: "Hermes",
    installed,
    available: installed,
    binaryPath: command,
    version,
    configHome: hermesHome,
    diagnostics,
    knowledgeSources: [
      fileSource({
        id: "hermes.soul",
        title: "SOUL.md",
        kind: "project_instructions",
        scope: "user",
        path: `${hermesHome}/SOUL.md`,
        native: true,
        syncMode: "index",
        description: "Hermes 全局身份/行为底座。",
      }),
      directorySource({
        id: "hermes.local-skills",
        title: "skills",
        kind: "skills",
        scope: "user",
        path: `${hermesHome}/skills`,
        native: true,
        syncMode: "index",
      }),
      directorySource({
        id: `hermes.${APP_PROTOCOL_ID}-external-skills`,
        title: `${APP_PRODUCT_NAME} external Hermes skills`,
        kind: "skills",
        scope: "external",
        path: options.nativeSkillDir || `${cwd}/${APP_CONFIG_DIR}/native-skills/hermes`,
        native: true,
        userVisible: false,
        knowledgeLike: false,
        syncMode: "publish",
        description: `${APP_PRODUCT_NAME} 发布给 Hermes 的 external skill directory；Hermes 通过 skills.external_dirs 使用。`,
      }),
      directorySource({
        id: "hermes.memories",
        title: "memory",
        kind: "memory",
        scope: "user",
        path: `${hermesHome}/memories`,
        native: true,
        syncMode: "index",
      }),
      directorySource({
        id: "hermes.sessions",
        title: "Hermes sessions",
        kind: "sessions",
        scope: "user",
        path: `${hermesHome}/sessions`,
        native: true,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
      directorySource({
        id: "hermes.logs",
        title: "Hermes logs",
        kind: "logs",
        scope: "user",
        path: `${hermesHome}/logs`,
        native: true,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
      directorySource({
        id: "hermes.cron",
        title: "Hermes cron jobs",
        kind: "toolsets",
        scope: "user",
        path: `${hermesHome}/cron`,
        native: true,
        knowledgeLike: true,
        enabledByDefault: false,
        syncMode: "index",
      }),
      fileSource({
        id: "hermes.config",
        title: "Hermes config.yaml",
        kind: "config",
        scope: "user",
        path: `${hermesHome}/config.yaml`,
        native: true,
        knowledgeLike: false,
        syncMode: "none",
      }),
      fileSource({
        id: "hermes.env",
        title: "Hermes .env",
        kind: "auth",
        scope: "user",
        path: `${hermesHome}/.env`,
        native: true,
        userVisible: false,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
      fileSource({
        id: "hermes.state-db",
        title: "Hermes state.db",
        kind: "memory",
        scope: "user",
        path: `${hermesHome}/state.db`,
        native: true,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
    ],
    installActions: [
      plannedInstallAction({
        id: "hermes.install",
        title: "安装 Hermes Agent CLI",
        command: [
          "bash",
          "-lc",
          "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup",
        ],
      }),
    ],
    notes: [
      `Hermes 的 skills/memories/config 都在 ~/.hermes 下，外部 skill 目录是 ${APP_PRODUCT_NAME} 与 Hermes 对接的关键入口。`,
      `Preferred transport: ${HERMES_KERNEL_MANIFEST.transport.primary}; fallback: ${HERMES_KERNEL_MANIFEST.transport.fallbacks?.join(", ") ?? "none"}.`,
    ],
  };
}

export const HERMES_KERNEL_CONTRACT: KernelAdapterContract = {
  ownership: [
    {
      feature: "session",
      owner: "adapter",
      nativeName: "Hermes ACP session",
      appResponsibility: `Own ${APP_PRODUCT_NAME} session/run ids and persist the Hermes ACP session id binding.`,
      adapterResponsibility: `Create or reuse Hermes ACP sessions over stdio JSON-RPC and map them to ${APP_PRODUCT_NAME} sessions.`,
    },
    {
      feature: "turn_lifecycle",
      owner: "adapter",
      appResponsibility: `Record ${APP_PRODUCT_NAME} run lifecycle and trajectory.`,
      adapterResponsibility: `Send session/prompt over Hermes ACP and normalize streamed session/update notifications into ${APP_PRODUCT_NAME} events.`,
    },
    {
      feature: "model_loop",
      owner: "kernel",
      nativeName: "Hermes AIAgent",
      kernelResponsibility: "Own provider selection, model calls, native tools, rules, memory, and skill loading.",
      adapterResponsibility: "Use Hermes ACP instead of recreating its internal loop.",
    },
    {
      feature: "native_tool_execution",
      owner: "kernel",
      nativeName: "Hermes toolsets",
      kernelResponsibility: "Execute enabled Hermes toolsets inside the Hermes loop.",
      adapterResponsibility: `Map Hermes ACP tool_call/tool_call_update notifications into ${APP_PRODUCT_NAME} tool.started/tool.finished events.`,
    },
    {
      feature: "host_tool_execution",
      owner: "unsupported",
      notes: "No Hermes host tool bridge is wired yet.",
    },
    {
      feature: "approval",
      owner: "shared",
      nativeName: "Hermes ACP session/request_permission",
      kernelResponsibility: "Decide when native tool execution requires permission.",
      adapterResponsibility: `Translate Hermes permission requests into ${APP_PRODUCT_NAME} approvals and return selected/cancelled ACP decisions.`,
    },
    {
      feature: "user_question",
      owner: "unsupported",
      notes: "No Hermes elicitation bridge is wired yet.",
    },
    {
      feature: "skill_discovery",
      owner: "shared",
      nativeName: "Hermes skills_list / skill_view",
      appResponsibility: `Own ${APP_PRODUCT_NAME} vault skills and publication source.`,
      kernelResponsibility: "Discover local and external skills through Hermes' native skill tools.",
      adapterResponsibility: `Publish ${APP_PRODUCT_NAME} skills into an external skill directory and run Hermes with that directory configured.`,
    },
    {
      feature: "skill_loading",
      owner: "kernel",
      nativeName: "Hermes skill_view",
      appResponsibility: `Publish ${APP_PRODUCT_NAME} skills into the agreed Hermes external skill directory.`,
      kernelResponsibility: "Load SKILL.md and referenced files progressively through skill_view.",
      adapterResponsibility: `Avoid duplicating full ${APP_PRODUCT_NAME} skill bodies in prompt context when Hermes native skills are active.`,
    },
    {
      feature: "context_assembly",
      owner: "app",
      appResponsibility: `Pass explicit user-added context, attachments, and narrow ${APP_PRODUCT_NAME} surface hints.`,
    },
    {
      feature: "artifact_extraction",
      owner: "app",
      appResponsibility: "Own artifact extraction once Hermes produces file/media references.",
    },
    {
      feature: "memory_write",
      owner: "app",
      appResponsibility: "Own memory writes, feedback, confidence, and decay.",
    },
    {
      feature: "compaction",
      owner: "unsupported",
      notes: "No Hermes compaction bridge is wired yet.",
    },
    {
      feature: "auth",
      owner: "kernel",
      nativeName: "Hermes provider/config auth",
      kernelResponsibility: "Use Hermes config, .env, provider pools, or process env credentials.",
      adapterResponsibility: "Optionally inject provider HTTP capture environment without logging secrets.",
    },
    {
      feature: "sandbox",
      owner: "unsupported",
      notes: "No Hermes sandbox mapping is wired yet.",
    },
    {
      feature: "trajectory",
      owner: "app",
      appResponsibility: "Persist normalized trajectory records.",
    },
    {
      feature: "diagnostics",
      owner: "adapter",
      nativeName: "Hermes ACP JSON-RPC, process stderr, and provider capture",
      adapterResponsibility: `Expose ${APP_PRODUCT_NAME} trajectory plus Hermes ACP/process/provider capture boundaries.`,
    },
  ],
  eventMappings: [
    {
      appEvent: "model.requested",
      nativeRequest: "session/prompt",
      direction: "app_to_native",
      adapterResponsibility: "Send the assembled turn prompt to Hermes ACP while preserving the OpenGrove run/session identity.",
    },
    {
      appEvent: "assistant.delta / model.response",
      nativeEvent: "session/update agent_message_chunk",
      direction: "native_to_app",
      adapterResponsibility: `Stream Hermes text chunks into ${APP_PRODUCT_NAME} assistant deltas and emit the completed model.response.`,
    },
    {
      appEvent: "tool.started / tool.finished",
      nativeEvent: "session/update tool_call / tool_call_update",
      direction: "native_to_app",
      adapterResponsibility: "Project Hermes native tool lifecycle into OpenGrove trajectory events.",
    },
    {
      appEvent: "approval.requested / approval.decided",
      nativeRequest: "session/request_permission",
      direction: "bidirectional",
      adapterResponsibility: "Bridge Hermes native permission prompts to OpenGrove approval decisions.",
    },
  ],
  diagnostics: {
    defaultModeId: "hermes-acp-jsonrpc",
    modes: [
      {
        id: "hermes-acp-jsonrpc",
        title: "Hermes ACP JSON-RPC stream",
        layer: "adapter-rpc",
        status: "implemented",
        enabledByDefault: true,
        redaction: "raw",
        notes: [
          "The adapter launches `hermes acp --accept-hooks` and exchanges line-delimited JSON-RPC messages over stdio.",
          `Hermes assistant chunks, tool calls, usage updates, and permission requests are normalized into ${APP_PRODUCT_NAME} events.`,
        ],
      },
      {
        id: "hermes-process-stdio",
        title: "Hermes child process stderr",
        layer: "process-stdio",
        status: "implemented",
        enabledByDefault: false,
        redaction: "raw",
        notes: ["Captures the native Hermes process boundary for startup/runtime errors."],
      },
      {
        id: `${APP_PROTOCOL_ID}-trajectory`,
        title: `${APP_PRODUCT_NAME} trajectory JSON`,
        layer: "trajectory",
        status: "implemented",
        enabledByDefault: true,
        output: "data/trajectories/",
        redaction: "redacted",
      },
      {
        id: "hermes-provider-http",
        title: "Provider HTTP capture",
        layer: "provider-http",
        status: "implemented",
        enabledByDefault: false,
        output: "data/provider-http-captures/",
        env: [
          appEnvName("PROVIDER_HTTP_CAPTURE"),
          appEnvName("PROVIDER_HTTP_PROXY"),
          appEnvName("PROVIDER_HTTP_CA_CERT"),
          appEnvName("PROVIDER_HTTP_NO_PROXY"),
          appEnvName("PROVIDER_HTTP_NODE_USE_ENV_PROXY"),
        ],
        redaction: "raw",
        notes: [
          "Injects proxy and CA environment variables into the Hermes child process.",
          "Actual capture depends on Hermes' provider client honoring the proxy and CA.",
        ],
      },
    ],
    nativeTranscript: {
      path: "~/.hermes/sessions/",
      availability: "partial",
      notes: [
        `Owned by Hermes. ${APP_PRODUCT_NAME} stores the ACP session id binding and separately records normalized trajectory/provider capture for turn-level debugging.`,
      ],
    },
  },
  notes: [
    `Hermes has a real native skill system. ${APP_PRODUCT_NAME} publishes skills as external skill directories and should not host-inject duplicate skill bodies.`,
    "The primary bridge uses ACP. The legacy oneshot CLI path remains available as an explicit fallback for environments where ACP is unavailable.",
  ],
};

export const HERMES_KERNEL_MANIFEST: KernelIntegrationManifest = {
  kernelId: "hermes",
  title: "Hermes",
  transport: {
    primary: "acp",
    fallbacks: ["oneshot-cli"],
    launch: {
      command: "hermes",
      args: ["acp", "--accept-hooks"],
    },
    notes: [
      "ACP is the native bridge: OpenGrove keeps stdout for JSON-RPC and reads structured session/update notifications.",
    ],
  },
  session: {
    strategy: "native-persistent",
    nativeSessionKey: "hermesAcpSessionIds",
    reuseAcrossModelChanges: true,
    notes: [
      "OpenGrove stores Hermes ACP session ids by runtime binding fingerprint and reuses only sessions active in the current ACP child.",
    ],
  },
  providerBinding: {
    mode: "config-file",
    configFiles: ["~/.hermes/config.yaml", "$HERMES_HOME/config.yaml"],
    env: [appEnvName("HERMES_HOME")],
    notes: [
      "OpenGrove can generate an isolated HERMES_HOME config.yaml so Hermes owns the provider call while OpenGrove avoids logging credentials.",
    ],
  },
  approvals: {
    mode: "native-request",
    nativeRequest: "session/request_permission",
    notes: [
      "Hermes native permission requests are turned into OpenGrove approval records and answered inline over ACP.",
    ],
  },
  eventProjector: {
    id: "acp-session-update",
    nativeEvents: [
      "session/update agent_message_chunk",
      "session/update tool_call",
      "session/update tool_call_update",
      "session/update usage_update",
      "session/request_permission",
    ],
    appEvents: [
      "assistant.delta",
      "model.response",
      "tool.started",
      "tool.finished",
      "runtime.diagnostic",
      "approval.requested",
      "approval.resolved",
    ],
  },
  harness: {
    fakeServer: "acp",
    smokePrompt: "Use a terminal tool to print an OpenGrove ACP marker.",
    expectedEvents: ["assistant.delta", "tool.started", "tool.finished", "model.response", "turn.finished"],
  },
  capabilities: HERMES_CAPABILITIES,
  contract: HERMES_KERNEL_CONTRACT,
  rollout: {
    status: "implemented",
    next: ["Add elicitation mapping if Hermes exposes user-question ACP requests."],
  },
};
