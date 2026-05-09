import type { AgentEvent } from "../../core.js";
import {
  OpenAiHttpRuntime,
  type OpenAiHttpRuntimeOptions,
} from "../../runtime/openai-http-runtime.js";
import type {
  KernelAdapter,
  KernelAdapterContract,
  KernelCapabilities,
  KernelDiscovery,
  KernelHealth,
  KernelKnowledgeSource,
  KernelInstallAction,
  KernelSessionHandle,
  KernelSessionStart,
  KernelTurnRequest,
} from "../types.js";

export interface OpenAiHttpKernelDefinition {
  id: string;
  title: string;
  baseUrl: string;
  apiKeyEnv?: string;
  apiKey?: string;
  model: string;
  models?: string[];
  healthPath?: string;
  sessionMode?: "stateless" | "server-side";
  sessionHeaderName?: string;
  customHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  knowledgeSources?: KernelKnowledgeSource[];
  installActions?: KernelInstallAction[];
  notes?: string[];
}

const OPENAI_HTTP_CAPABILITIES: KernelCapabilities = {
  streaming: true,
  toolCalls: true,
  hostTools: false,
  approvals: false,
  elicitation: false,
  artifacts: false,
  compaction: false,
  authRefresh: false,
  sandbox: ["danger-full-access"],
  knowledge: {
    nativeSkills: false,
    toolMediatedSkills: false,
    progressiveDisclosure: true,
    nativeArtifacts: false,
    deliveryLedger: true,
  },
};

const OPENAI_HTTP_CONTRACT: KernelAdapterContract = {
  ownership: [
    { feature: "session", owner: "app", appResponsibility: "OpenGrove manages session history in stateless mode; server manages in server-side mode." },
    { feature: "turn_lifecycle", owner: "adapter", adapterResponsibility: "Adapter yields turn.started/turn.finished around the HTTP call." },
    { feature: "model_loop", owner: "kernel", kernelResponsibility: "The remote endpoint runs the inference loop." },
    { feature: "native_tool_execution", owner: "kernel", kernelResponsibility: "Tool execution is performed server-side when supported." },
    { feature: "host_tool_execution", owner: "unsupported" },
    { feature: "approval", owner: "unsupported" },
    { feature: "user_question", owner: "unsupported" },
    { feature: "skill_discovery", owner: "app" },
    { feature: "skill_loading", owner: "app" },
    { feature: "context_assembly", owner: "app" },
    { feature: "knowledge_retrieval", owner: "app" },
    { feature: "artifact_extraction", owner: "unsupported" },
    { feature: "memory_write", owner: "unsupported" },
    { feature: "compaction", owner: "unsupported" },
    { feature: "auth", owner: "adapter", adapterResponsibility: "API key resolved from env or config." },
    { feature: "sandbox", owner: "kernel" },
    { feature: "trajectory", owner: "unsupported" },
    { feature: "diagnostics", owner: "adapter" },
  ],
};

export class OpenAiHttpKernelAdapter implements KernelAdapter {
  readonly id: string;
  readonly title: string;
  readonly capabilities: KernelCapabilities;
  readonly contract: KernelAdapterContract;
  private readonly runtime: OpenAiHttpRuntime;
  private readonly definition: OpenAiHttpKernelDefinition;

  constructor(definition: OpenAiHttpKernelDefinition) {
    this.id = definition.id;
    this.title = definition.title;
    this.capabilities = { ...OPENAI_HTTP_CAPABILITIES };
    this.contract = OPENAI_HTTP_CONTRACT;
    this.definition = definition;

    const runtimeOptions: OpenAiHttpRuntimeOptions = {
      baseUrl: definition.baseUrl,
      apiKeyEnv: definition.apiKeyEnv,
      apiKey: definition.apiKey,
      model: definition.model,
      customHeaders: definition.customHeaders,
      timeoutMs: definition.timeoutMs,
      maxTokens: definition.maxTokens,
      temperature: definition.temperature,
      sessionMode: definition.sessionMode,
      sessionHeaderName: definition.sessionHeaderName,
    };
    this.runtime = new OpenAiHttpRuntime(runtimeOptions);
  }

  async healthCheck(): Promise<KernelHealth> {
    const healthPath = this.definition.healthPath ?? "/models";
    const url = `${this.definition.baseUrl.replace(/\/+$/, "")}${healthPath}`;
    try {
      const headers: Record<string, string> = {};
      const apiKey = this.resolveApiKey();
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        return { status: "ok", message: `${this.title} endpoint is reachable.` };
      }
      return {
        status: "degraded",
        message: `${this.title} returned HTTP ${response.status}.`,
      };
    } catch (err) {
      return {
        status: "unavailable",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async discover(): Promise<KernelDiscovery> {
    const health = await this.healthCheck();
    return {
      kernelId: this.id,
      title: this.title,
      installed: health.status !== "unavailable",
      available: health.status === "ok",
      version: undefined,
      health,
      knowledgeSources: this.definition.knowledgeSources ?? [],
    };
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
    yield* this.runtime.runTurn(request);
  }

  private resolveApiKey(): string | undefined {
    if (this.definition.apiKeyEnv) {
      return process.env[this.definition.apiKeyEnv]?.trim() || undefined;
    }
    return this.definition.apiKey?.trim() || undefined;
  }
}
