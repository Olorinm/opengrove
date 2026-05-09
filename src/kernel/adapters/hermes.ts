import type { AgentEvent } from "../../core.js";
import {
  HermesRuntime,
  hermesHealth,
  resolveHermesCommandPath,
  type HermesRuntimeOptions,
} from "../../runtime/hermes-runtime.js";
import { APP_CONFIG_DIR, APP_PRODUCT_NAME, APP_PROTOCOL_ID, appEnvName, readAppEnv } from "../../identity.js";
import { commandVersion, directorySource, fileSource, plannedInstallAction, resolveHomePath } from "../discovery.js";
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
  streaming: false,
  toolCalls: true,
  hostTools: false,
  approvals: false,
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
        title: "安装 Hermes CLI",
        command: ["npm", "install", "-g", "hermes-cli"],
      }),
    ],
    notes: [
      `Hermes 的 skills/memories/config 都在 ~/.hermes 下，外部 skill 目录是 ${APP_PRODUCT_NAME} 与 Hermes 对接的关键入口。`,
    ],
  };
}

export const HERMES_KERNEL_CONTRACT: KernelAdapterContract = {
  ownership: [
    {
      feature: "session",
      owner: "adapter",
      nativeName: "Hermes oneshot invocation",
      appResponsibility: `Own ${APP_PRODUCT_NAME} session/run ids.`,
      adapterResponsibility: `Map ${APP_PRODUCT_NAME} session ids to deterministic Hermes invocation ids; oneshot runs are not long-lived native sessions.`,
    },
    {
      feature: "turn_lifecycle",
      owner: "adapter",
      appResponsibility: `Record ${APP_PRODUCT_NAME} run lifecycle and trajectory.`,
      adapterResponsibility: `Call Hermes CLI oneshot mode when configured and normalize the final response into ${APP_PRODUCT_NAME} events.`,
    },
    {
      feature: "model_loop",
      owner: "kernel",
      nativeName: "Hermes AIAgent",
      kernelResponsibility: "Own provider selection, model calls, native tools, rules, memory, and skill loading.",
      adapterResponsibility: "Use Hermes CLI oneshot mode instead of recreating its internal loop.",
    },
    {
      feature: "native_tool_execution",
      owner: "kernel",
      nativeName: "Hermes toolsets",
      kernelResponsibility: "Execute enabled Hermes toolsets inside the Hermes loop.",
      adapterResponsibility: `The current oneshot bridge only receives final text, so individual tool events are not yet visible to ${APP_PRODUCT_NAME}.`,
    },
    {
      feature: "host_tool_execution",
      owner: "unsupported",
      notes: "No Hermes host tool bridge is wired yet.",
    },
    {
      feature: "approval",
      owner: "unsupported",
      notes: "No Hermes approval bridge is wired yet.",
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
      nativeName: "Hermes CLI stdout/stderr and provider capture",
      adapterResponsibility: `Expose ${APP_PRODUCT_NAME} trajectory plus Hermes process/provider capture boundaries.`,
    },
  ],
  eventMappings: [
    {
      appEvent: "model.requested / assistant.delta / model.response",
      nativeEvent: "hermes -z final stdout",
      direction: "native_to_app",
      adapterResponsibility: `Map the oneshot final response into a ${APP_PRODUCT_NAME} assistant delta and model.response.`,
    },
  ],
  diagnostics: {
    defaultModeId: "hermes-process-stdio",
    modes: [
      {
        id: "hermes-process-stdio",
        title: "Hermes CLI process boundary",
        layer: "process-stdio",
        status: "implemented",
        enabledByDefault: true,
        redaction: "raw",
        notes: [
          "The current adapter calls Hermes oneshot mode and receives final stdout/stderr.",
          `Hermes internal tool events are not streamed into ${APP_PRODUCT_NAME} yet.`,
        ],
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
        `Owned by Hermes. The ${APP_PRODUCT_NAME} bridge currently uses oneshot mode, so ${APP_PRODUCT_NAME} relies on trajectory/provider capture for turn-level debugging.`,
      ],
    },
  },
  notes: [
    `Hermes has a real native skill system. ${APP_PRODUCT_NAME} publishes skills as external skill directories and should not host-inject duplicate skill bodies.`,
    "The current bridge is a one-shot CLI adapter. A future gateway/stream adapter can map native tool events, approvals, and compaction directly.",
  ],
};
