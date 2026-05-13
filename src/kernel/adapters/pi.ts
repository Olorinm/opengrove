import type { Model } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import { createRuntimeKernelAdapter } from "../adapter.js";
import type { KernelAdapter, KernelAdapterContract, KernelCapabilities } from "../types.js";
import { APP_PRODUCT_NAME, APP_PROTOCOL_ID } from "../../identity.js";
import { PiAgentRuntime } from "../../runtime/pi-runtime.js";
import { createNativePiSessionFactory } from "../../runtime/native-pi-session.js";
import type { ProviderHttpCaptureOptions } from "../../runtime/provider-http-capture.js";

export interface PiKernelAdapterOptions {
  cwd?: string;
  configuredModel?: string;
  runtimeBindingFingerprint?: string;
  env?: NodeJS.ProcessEnv;
  providerHttpCapture?: ProviderHttpCaptureOptions;
}

const PI_KERNEL_CAPABILITIES: KernelCapabilities = {
  streaming: true,
  toolCalls: true,
  hostTools: true,
  approvals: true,
  elicitation: false,
  artifacts: true,
  compaction: false,
  authRefresh: false,
  sandbox: ["danger-full-access"],
  knowledge: {
    nativeSkills: false,
    toolMediatedSkills: true,
    progressiveDisclosure: true,
    nativeArtifacts: false,
    deliveryLedger: true,
  },
};

export function createPiKernelAdapter(options: PiKernelAdapterOptions = {}): KernelAdapter {
  const env = { ...process.env, ...options.env };
  return createRuntimeKernelAdapter({
    id: "pi",
    title: "Pi",
    runtime: new PiAgentRuntime({
      createSession: createNativePiSessionFactory({
        model: (requestedModelId) => resolvePiRuntimeModel(env, requestedModelId ?? options.configuredModel),
        getApiKey: (provider) => resolvePiApiKey(env, provider),
      }),
    }),
    capabilities: PI_KERNEL_CAPABILITIES,
    contract: PI_KERNEL_CONTRACT,
  });
}

export function canResolvePiRuntimeModel(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    readEnv(env, "OPENAI_API_KEY", "MODEL_API_KEY") ||
      readEnv(env, "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN") ||
      readEnv(env, "GEMINI_API_KEY", "GOOGLE_API_KEY"),
  );
}

function resolvePiRuntimeModel(env: NodeJS.ProcessEnv, requestedModelId?: string): Model<any> {
  const modelId =
    requestedModelId?.trim() ||
    readEnv(env, "PI_MODEL", "OPENAI_MODEL", "DEFAULT_MODEL", "ANTHROPIC_MODEL", "GEMINI_MODEL") ||
    "gpt-4o-mini";
  const provider = resolvePiProvider(env);
  const known = getKnownPiModel(provider.knownProvider, modelId);
  if (known && (!provider.baseUrl || known.baseUrl === provider.baseUrl)) {
    return known;
  }
  if (known && provider.baseUrl) {
    return { ...known, baseUrl: provider.baseUrl };
  }
  return createCustomPiModel(provider, modelId);
}

function resolvePiProvider(env: NodeJS.ProcessEnv): {
  kind: "openai" | "anthropic" | "google";
  knownProvider: string;
  api: "openai-completions" | "anthropic-messages" | "google-generative-ai";
  provider: string;
  baseUrl: string;
} {
  const openAiBaseUrl = readEnv(env, "OPENAI_BASE_URL", "MODEL_BASE_URL");
  if (readEnv(env, "OPENAI_API_KEY", "MODEL_API_KEY") || openAiBaseUrl) {
    return {
      kind: "openai",
      knownProvider: "openai",
      api: "openai-completions",
      provider: "opengrove-openai",
      baseUrl: openAiBaseUrl || "https://api.openai.com/v1",
    };
  }
  const anthropicBaseUrl = readEnv(env, "ANTHROPIC_BASE_URL");
  if (readEnv(env, "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN") || anthropicBaseUrl) {
    return {
      kind: "anthropic",
      knownProvider: "anthropic",
      api: "anthropic-messages",
      provider: "opengrove-anthropic",
      baseUrl: anthropicBaseUrl || "https://api.anthropic.com",
    };
  }
  return {
    kind: "google",
    knownProvider: "google",
    api: "google-generative-ai",
    provider: "opengrove-google",
    baseUrl: readEnv(env, "GEMINI_BASE_URL", "GOOGLE_BASE_URL") || "https://generativelanguage.googleapis.com",
  };
}

function getKnownPiModel(provider: string, modelId: string): Model<any> | undefined {
  try {
    return (getModel as (provider: string, modelId: string) => Model<any> | undefined)(provider, modelId);
  } catch {
    return undefined;
  }
}

function createCustomPiModel(
  provider: ReturnType<typeof resolvePiProvider>,
  modelId: string,
): Model<any> {
  return {
    id: modelId,
    name: modelId,
    api: provider.api,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    reasoning: /gpt-5|o[134]|claude|glm|deepseek|qwen|kimi/i.test(modelId),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...(provider.api === "openai-completions"
      ? {
          compat: {
            supportsStore: false,
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
        }
      : {}),
  };
}

function resolvePiApiKey(env: NodeJS.ProcessEnv, provider: string): string | undefined {
  const normalized = provider.toLowerCase();
  if (normalized.includes("anthropic")) {
    return readEnv(env, "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN");
  }
  if (normalized.includes("google") || normalized.includes("gemini")) {
    return readEnv(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
  }
  return readEnv(env, "OPENAI_API_KEY", "MODEL_API_KEY") ||
    readEnv(env, "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN") ||
    readEnv(env, "GEMINI_API_KEY", "GOOGLE_API_KEY");
}

function readEnv(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export const PI_KERNEL_CONTRACT: KernelAdapterContract = {
  ownership: [
    {
      feature: "session",
      owner: "app",
      nativeName: "PiSession",
      appResponsibility: "Own session creation, retained messages, runtime context, and OpenGrove session/run ids.",
      adapterResponsibility: "Bind the OpenGrove session id directly to the Pi session factory.",
    },
    {
      feature: "turn_lifecycle",
      owner: "app",
      nativeName: "PiAgentRuntime.runTurn",
      appResponsibility: "Own turn lifecycle, event normalization, trajectory, and pause/resume records.",
      adapterResponsibility: "Forward the normalized KernelTurnRequest into the Pi AgentRuntime.",
    },
    {
      feature: "model_loop",
      owner: "shared",
      nativeName: "NativePiSession",
      appResponsibility: "Own context assembly, tool gate, middleware, and memory/artifact side effects.",
      kernelResponsibility: "Own the provider model call and message continuation loop inside NativePiSession.",
      adapterResponsibility: "Keep provider/model details behind the Pi runtime contract.",
    },
    {
      feature: "native_tool_execution",
      owner: "unsupported",
      notes: "Pi does not have a separate native tool harness comparable to Codex app-server or Claude Code.",
    },
    {
      feature: "host_tool_execution",
      owner: "app",
      appResponsibility: "Own OpenGrove host tool definitions, policy gates, execution, and tool result middleware.",
      adapterResponsibility: "Expose OpenGrove tools directly to NativePiSession.",
    },
    {
      feature: "approval",
      owner: "app",
      appResponsibility: "Own approval policy evaluation, approval inbox UI, user decisions, and audit trail.",
      adapterResponsibility: "Call OpenGrove beforeToolCall gates before executing host tools.",
    },
    {
      feature: "user_question",
      owner: "app",
      appResponsibility: "Own structured choice/question UI and route answers back into OpenGrove tools or Pi flow.",
      notes: "Pi currently has no independent native elicitation protocol.",
    },
    {
      feature: "skill_discovery",
      owner: "app",
      appResponsibility: "Own OpenGrove skill catalog and knowledge vault.",
    },
    {
      feature: "skill_loading",
      owner: "app",
      nativeName: "skill.invoke tool",
      appResponsibility: "Provide tool-mediated progressive disclosure through OpenGrove skill tools.",
      adapterResponsibility: "Do not claim native skill parity for Pi unless a future Pi runtime adds one.",
    },
    {
      feature: "context_assembly",
      owner: "app",
      appResponsibility: "Assemble browser/computer/page/knowledge/memory/artifact context before the turn.",
    },
    {
      feature: "knowledge_retrieval",
      owner: "app",
      appResponsibility: "Plan and deliver knowledge context using OpenGrove KnowledgeStore/ContextPlanner.",
    },
    {
      feature: "artifact_extraction",
      owner: "app",
      appResponsibility: "Extract media/file artifacts from host tool results and model-visible outputs.",
    },
    {
      feature: "memory_write",
      owner: "app",
      appResponsibility: "Own memory proposals, writes, feedback, confidence, and decay.",
    },
    {
      feature: "compaction",
      owner: "app",
      appResponsibility: "Own any future Pi summarization/retention policy and memory snapshots.",
      notes: "NativePiSession currently uses retainedMessageLimit rather than a full native compact protocol.",
    },
    {
      feature: "auth",
      owner: "app",
      appResponsibility: "Own OpenAI-compatible provider API key resolution.",
      adapterResponsibility: "Never include raw provider credentials in event logs or captures.",
    },
    {
      feature: "sandbox",
      owner: "app",
      appResponsibility: "Own policy rules and host tool permission decisions.",
      notes: "Pi has no separate process sandbox comparable to Codex sandboxPolicy.",
    },
    {
      feature: "trajectory",
      owner: "app",
      appResponsibility: "Persist OpenGrove trajectory JSON from normalized events.",
    },
    {
      feature: "diagnostics",
      owner: "app",
      appResponsibility: "Use OpenGrove event log/trajectory as the authoritative diagnostic surface.",
      adapterResponsibility: "Declare provider HTTP capture as optional external diagnostics only.",
    },
  ],
  eventMappings: [
    {
      appEvent: "tool.call.started / tool.call.completed",
      nativeEvent: "NativePiSession host tool call",
      direction: "bidirectional",
      adapterResponsibility: "Route directly through OpenGrove tool execution and preserve tool call ids.",
    },
    {
      appEvent: "approval.requested / approval.resolved",
      nativeRequest: "Pi beforeToolCall gate",
      direction: "bidirectional",
      adapterResponsibility: "Use OpenGrove approval inbox for host tool gates.",
    },
    {
      appEvent: "skill.loaded",
      nativeRequest: "skill.invoke",
      direction: "bidirectional",
      adapterResponsibility: "Expose OpenGrove skill progressive disclosure as a host tool, not a native skill directory.",
    },
  ],
  diagnostics: {
    defaultModeId: `${APP_PROTOCOL_ID}-trajectory`,
    modes: [
      {
        id: `${APP_PROTOCOL_ID}-event-log`,
        title: `${APP_PRODUCT_NAME} normalized event log`,
        layer: "host-event-log",
        status: "implemented",
        enabledByDefault: true,
        redaction: "redacted",
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
        id: "provider-http",
        title: "Provider HTTP capture",
        layer: "provider-http",
        status: "external",
        enabledByDefault: false,
        redaction: "external",
        notes: ["Optional model-provider debugging; not required for normal Pi adapter diagnostics."],
      },
    ],
    nativeTranscript: {
      availability: "unavailable",
      notes: [`Pi's durable transcript is ${APP_PRODUCT_NAME}'s event log/trajectory rather than a separate native transcript file.`],
    },
  },
  notes: [
    `Pi is the ${APP_PRODUCT_NAME}-owned harness path: useful as the control case for what ${APP_PRODUCT_NAME} itself must own.`,
  ],
};
