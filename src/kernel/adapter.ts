import { join } from "node:path";
import type { AgentRuntime, AgentTurnRequest } from "../core.js";
import {
  APP_KNOWLEDGE_SCOPE,
  APP_PRODUCT_NAME,
  APP_PROTOCOL_ID,
  APP_VAULT_DIR,
  APP_VAULT_ROOT_NAME,
} from "../identity.js";
import type {
  KernelAdapter,
  KernelAdapterContract,
  KernelCapabilities,
  KernelDiscovery,
  KernelHealth,
  KernelSessionHandle,
  KernelSessionStart,
  KernelTurnRequest,
} from "./types.js";
import { directorySource, fileSource } from "./discovery.js";

const DEFAULT_RUNTIME_CAPABILITIES: KernelCapabilities = {
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

export interface RuntimeKernelAdapterOptions {
  id: string;
  title: string;
  runtime: AgentRuntime;
  capabilities?: Partial<KernelCapabilities>;
  contract?: KernelAdapterContract;
}

export class RuntimeKernelAdapter implements KernelAdapter {
  readonly id: string;
  readonly title: string;
  readonly capabilities: KernelCapabilities;
  readonly contract: KernelAdapterContract;

  constructor(private readonly options: RuntimeKernelAdapterOptions) {
    this.id = options.id;
    this.title = options.title;
    this.capabilities = {
      ...DEFAULT_RUNTIME_CAPABILITIES,
      ...options.capabilities,
      sandbox: options.capabilities?.sandbox ?? DEFAULT_RUNTIME_CAPABILITIES.sandbox,
    };
    this.contract = options.contract ?? createRuntimeAdapterContract(options.id, options.title);
  }

  async healthCheck(): Promise<KernelHealth> {
    return {
      status: "ok",
      message: `${this.title} is available through the AgentRuntime adapter.`,
    };
  }

  async discover(): Promise<KernelDiscovery> {
    const cwd = process.cwd();
    const vaultRoot = join(cwd, "data", APP_VAULT_DIR);
    const appVaultRoot = join(vaultRoot, APP_VAULT_ROOT_NAME);
    return {
      kernelId: this.id,
      title: this.title,
      installed: true,
      available: true,
      configHome: cwd,
      diagnostics: this.contract.diagnostics,
      knowledgeSources: [
        directorySource({
          id: `${this.id}.${APP_PROTOCOL_ID}-vault`,
          title: `${APP_PRODUCT_NAME} Vault`,
          kind: "vault",
          scope: APP_KNOWLEDGE_SCOPE,
          path: vaultRoot,
          native: false,
          knowledgeLike: true,
          syncMode: "mirror",
          description: `${APP_PRODUCT_NAME} 自己维护的知识库根目录，包含技能、记忆、产物和参考资料。`,
        }),
        directorySource({
          id: `${this.id}.${APP_PROTOCOL_ID}-skills`,
          title: `${APP_PRODUCT_NAME} skills`,
          kind: "skills",
          scope: APP_KNOWLEDGE_SCOPE,
          path: join(appVaultRoot, "skills"),
          native: false,
          knowledgeLike: true,
          syncMode: "mirror",
        }),
        directorySource({
          id: `${this.id}.${APP_PROTOCOL_ID}-memories`,
          title: `${APP_PRODUCT_NAME} memories`,
          kind: "memory",
          scope: APP_KNOWLEDGE_SCOPE,
          path: join(appVaultRoot, "memories"),
          native: false,
          knowledgeLike: true,
          syncMode: "mirror",
        }),
        directorySource({
          id: `${this.id}.${APP_PROTOCOL_ID}-artifacts`,
          title: `${APP_PRODUCT_NAME} artifacts`,
          kind: "artifacts",
          scope: APP_KNOWLEDGE_SCOPE,
          path: join(appVaultRoot, "artifacts"),
          native: false,
          knowledgeLike: true,
          syncMode: "mirror",
        }),
        fileSource({
          id: `${this.id}.project-agents-md`,
          title: "Project AGENTS.md",
          kind: "project_instructions",
          scope: "project",
          path: `${cwd}/AGENTS.md`,
          native: false,
          knowledgeLike: true,
          syncMode: "index",
          enabledByDefault: false,
        }),
      ],
      notes: [
        `Runtime adapters expose ${APP_PRODUCT_NAME}-owned knowledge first. Native kernel-specific directories are declared by dedicated adapters.`,
      ],
    };
  }

  async startSession(input: KernelSessionStart): Promise<KernelSessionHandle> {
    const now = new Date().toISOString();
    return {
      kernelId: this.id,
      sessionId: input.sessionId,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };
  }

  async resumeSession(sessionId: string): Promise<KernelSessionHandle> {
    const now = new Date().toISOString();
    return {
      kernelId: this.id,
      sessionId,
      createdAt: now,
      updatedAt: now,
    };
  }

  runTurn(request: KernelTurnRequest) {
    return this.options.runtime.runTurn(request);
  }
}

export class KernelAgentRuntime implements AgentRuntime {
  constructor(private readonly kernel: KernelAdapter) {}

  runTurn(request: AgentTurnRequest) {
    return this.kernel.runTurn(request);
  }
}

export function createKernelRuntime(kernel: KernelAdapter): AgentRuntime {
  return new KernelAgentRuntime(kernel);
}

export function createRuntimeKernelAdapter(
  options: RuntimeKernelAdapterOptions,
): KernelAdapter {
  return new RuntimeKernelAdapter(options);
}

export function createRuntimeAdapterContract(
  kernelId: string,
  title: string,
): KernelAdapterContract {
  return {
    ownership: [
      {
        feature: "session",
        owner: "shared",
        appResponsibility: "Own OpenGrove session/run ids and persisted activity records.",
        kernelResponsibility: "May keep an internal session object behind the AgentRuntime.",
        adapterResponsibility: "Bind OpenGrove ids to the runtime request.",
      },
      {
        feature: "turn_lifecycle",
        owner: "shared",
        appResponsibility: "Record turn started/finished/error events.",
        kernelResponsibility: "Produce the AgentEvent stream for the turn.",
        adapterResponsibility: "Forward the OpenGrove turn request to AgentRuntime.runTurn.",
      },
      {
        feature: "model_loop",
        owner: "kernel",
        kernelResponsibility: "Run the inner model/tool loop.",
        adapterResponsibility: "Do not reinterpret model-loop internals unless the runtime emits events.",
      },
      {
        feature: "host_tool_execution",
        owner: "app",
        appResponsibility: "Own host tool implementations, policy, artifacts, and memory side effects.",
        adapterResponsibility: "Expose host tools through the AgentTurnRequest shape.",
      },
      {
        feature: "native_tool_execution",
        owner: "kernel",
        kernelResponsibility: "Execute any native tools hidden behind the runtime.",
        adapterResponsibility: "Map emitted tool events into OpenGrove AgentEvent when available.",
      },
      {
        feature: "approval",
        owner: "shared",
        appResponsibility: "Own approval inbox UI and durable decision records.",
        kernelResponsibility: "Decide which native operations require confirmation.",
        adapterResponsibility: "Translate between native approval requests and OpenGrove approval decisions.",
      },
      {
        feature: "user_question",
        owner: "shared",
        appResponsibility: "Own user-facing structured question UI.",
        kernelResponsibility: "May request missing information while the turn is paused.",
        adapterResponsibility: "Translate native elicitation/question requests when the runtime exposes them.",
      },
      {
        feature: "skill_discovery",
        owner: "app",
        appResponsibility: "Own OpenGrove skill catalog and knowledge vault records.",
        adapterResponsibility: "Declare whether this kernel receives native skills or OpenGrove tool-mediated skills.",
      },
      {
        feature: "skill_loading",
        owner: "shared",
        appResponsibility: "Publish or provide skill sources according to kernel capability.",
        kernelResponsibility: "Load native skills when supported.",
        adapterResponsibility: "Choose native publication vs. tool-mediated fallback.",
      },
      {
        feature: "context_assembly",
        owner: "app",
        appResponsibility: "Pass explicit user-added context, attachments, and narrow surface hints; do not auto-inject broad knowledge or UI state.",
        adapterResponsibility: "Place assembled context into the kernel's expected request fields.",
      },
      {
        feature: "artifact_extraction",
        owner: "app",
        appResponsibility: "Extract media/file artifacts and keep provenance.",
        adapterResponsibility: "Surface native tool results and file references without dropping metadata.",
      },
      {
        feature: "memory_write",
        owner: "app",
        appResponsibility: "Own memory proposal, confirmation, score, decay, and vault writes.",
      },
      {
        feature: "compaction",
        owner: "shared",
        appResponsibility: "Record compaction boundary snapshots when events are emitted.",
        kernelResponsibility: "Run native compaction when available.",
        adapterResponsibility: "Map native compaction lifecycle events.",
      },
      {
        feature: "auth",
        owner: "shared",
        appResponsibility: "Own AuthProfile records where OpenGrove has credentials.",
        kernelResponsibility: "Request/refresh provider auth through native protocol when needed.",
        adapterResponsibility: "Bridge auth refresh requests without logging secrets.",
      },
      {
        feature: "sandbox",
        owner: "shared",
        appResponsibility: "Expose product-level access modes.",
        kernelResponsibility: "Enforce the native sandbox or permission mode.",
        adapterResponsibility: "Translate OpenGrove access modes into native sandbox and approval semantics.",
      },
      {
        feature: "trajectory",
        owner: "app",
        appResponsibility: "Write replay/debug trajectory records from normalized events.",
      },
      {
        feature: "diagnostics",
        owner: "adapter",
        appResponsibility: "Expose where diagnostic captures are written and how they are redacted.",
        adapterResponsibility: "Declare native transcript/capture layers for this kernel.",
      },
    ],
    eventMappings: [
      {
        appEvent: "AgentEvent",
        nativeEvent: `${title} runtime event`,
        direction: "native_to_app",
        adapterResponsibility: "Preserve the runtime's emitted AgentEvent stream and native metadata when present.",
      },
    ],
    diagnostics: {
      defaultModeId: "host-event-log",
      modes: [
        {
          id: "host-event-log",
          title: `${APP_PRODUCT_NAME} normalized event log`,
          layer: "host-event-log",
          status: "implemented",
          enabledByDefault: true,
          redaction: "redacted",
          notes: [
            "This is the minimum diagnostic layer available to every AgentRuntime adapter.",
            `Kernel id: ${kernelId}.`,
          ],
        },
        {
          id: "trajectory",
          title: `${APP_PRODUCT_NAME} trajectory JSON`,
          layer: "trajectory",
          status: "implemented",
          enabledByDefault: true,
          output: "data/trajectories/",
          redaction: "redacted",
        },
      ],
      nativeTranscript: {
        availability: "unknown",
        notes: ["Runtime adapters must declare their native transcript location explicitly when one exists."],
      },
    },
    notes: [
      "RuntimeKernelAdapter wraps an AgentRuntime behind the KernelAdapter contract.",
    ],
  };
}
