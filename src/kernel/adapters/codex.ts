import { CodexRuntime, type CodexRuntimeOptions } from "../../runtime/codex-runtime.js";
import { APP_PROTOCOL_ID, appEnvName, readAppEnv } from "../../identity.js";
import { RuntimeKernelAdapter } from "../adapter.js";
import { commandVersion, directorySource, fileSource, plannedInstallAction, resolveCommandPath, resolveHomePath } from "../discovery.js";
import type { KernelAdapterContract, KernelDiscovery } from "../types.js";

export class CodexKernelAdapter extends RuntimeKernelAdapter {
  constructor(private readonly codexOptions: CodexRuntimeOptions = {}) {
    super({
      id: "codex",
      title: "Codex",
      runtime: new CodexRuntime(codexOptions),
      capabilities: {
        streaming: true,
        toolCalls: true,
        hostTools: true,
        approvals: true,
        elicitation: true,
        artifacts: true,
        compaction: true,
        authRefresh: true,
        sandbox: ["read-only", "workspace-write", "danger-full-access"],
        knowledge: {
          nativeSkills: true,
          toolMediatedSkills: false,
          progressiveDisclosure: true,
          nativeArtifacts: false,
          deliveryLedger: true,
        },
      },
      contract: CODEX_KERNEL_CONTRACT,
    });
  }

  async discover(): Promise<KernelDiscovery> {
    return discoverCodexKernel(this.codexOptions, process.cwd(), this.contract.diagnostics);
  }
}

export function createCodexKernelAdapter(options: CodexRuntimeOptions = {}): CodexKernelAdapter {
  return new CodexKernelAdapter(options);
}

export function discoverCodexKernel(
  options: CodexRuntimeOptions = {},
  cwd = process.cwd(),
  diagnostics = CODEX_KERNEL_CONTRACT.diagnostics,
): KernelDiscovery {
  const codexHome = options.env?.CODEX_HOME || process.env.CODEX_HOME || resolveHomePath(".codex");
  const command = options.command || resolveCommandPath(readAppEnv("CODEX_BIN")) || resolveCommandPath("codex") || "codex";
  return {
    kernelId: "codex",
    title: "Codex",
    installed: Boolean(commandVersion(command)),
    available: Boolean(commandVersion(command)),
    binaryPath: command,
    version: commandVersion(command),
    configHome: codexHome,
    diagnostics,
    knowledgeSources: [
      fileSource({
        id: "codex.user-agents-md",
        title: "AGENTS.md",
        kind: "project_instructions",
        scope: "user",
        path: `${codexHome}/AGENTS.md`,
        native: true,
        syncMode: "index",
        description: "Codex 全局常驻指令文件。",
      }),
      directorySource({
        id: "codex.user-skills",
        title: "skills",
        kind: "skills",
        scope: "user",
        path: `${codexHome}/skills`,
        native: true,
        syncMode: "index",
      }),
      directorySource({
        id: "codex.system-skills",
        title: "Bundled Codex system skills",
        kind: "skills",
        scope: "system",
        path: `${codexHome}/skills/.system`,
        native: true,
        userVisible: false,
        knowledgeLike: false,
        syncMode: "index",
        enabledByDefault: false,
        description: "Codex 自带 skill 缓存，只建议只读查看。",
      }),
      directorySource({
        id: "codex.user-agent-skills",
        title: "skills (~/.agents)",
        kind: "skills",
        scope: "user",
        path: resolveHomePath(".agents", "skills"),
        native: true,
        syncMode: "index",
      }),
      fileSource({
        id: "codex.config",
        title: "Codex config.toml",
        kind: "config",
        scope: "user",
        path: `${codexHome}/config.toml`,
        native: true,
        knowledgeLike: false,
        syncMode: "none",
      }),
      fileSource({
        id: "codex.auth",
        title: "Codex auth.json",
        kind: "auth",
        scope: "user",
        path: `${codexHome}/auth.json`,
        native: true,
        userVisible: false,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
        description: "凭证文件只用于状态提示和 token 刷新，不进入资料库正文。",
      }),
      directorySource({
        id: "codex.sessions",
        title: "Codex native sessions",
        kind: "sessions",
        scope: "user",
        path: `${codexHome}/sessions`,
        native: true,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
      directorySource({
        id: "codex.plugins",
        title: "Codex plugins cache",
        kind: "plugins",
        scope: "user",
        path: `${codexHome}/plugins/cache`,
        native: true,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
    ],
    installActions: [
      plannedInstallAction({
        id: "codex.install",
        title: "安装 Codex CLI",
        command: ["npm", "install", "-g", "@openai/codex"],
      }),
    ],
    notes: [
      "Codex 的 skill 是原生渐进式加载；OpenGrove 应优先发布目录引用，不重复把完整 skill 正文塞进提示词。",
    ],
  };
}

export const CODEX_KERNEL_CONTRACT: KernelAdapterContract = {
  ownership: [
    {
      feature: "session",
      owner: "shared",
      nativeName: "thread",
      appResponsibility: "Own OpenGrove project/session ids, activity records, and UI navigation.",
      kernelResponsibility: "Own Codex thread/start, thread/resume, thread/fork, archive, and extended history.",
      adapterResponsibility: "Persist OpenGrove session id to Codex thread id bindings.",
    },
    {
      feature: "turn_lifecycle",
      owner: "shared",
      nativeName: "turn",
      appResponsibility: "Record normalized run lifecycle and trajectory.",
      kernelResponsibility: "Own turn/start, streaming item events, interrupt, and final turn result.",
      adapterResponsibility: "Translate Codex turn lifecycle into OpenGrove turn.started/turn.finished/error/run.paused events.",
    },
    {
      feature: "model_loop",
      owner: "kernel",
      nativeName: "codex core loop",
      kernelResponsibility: "Call the model, decide native tools, continue after native tool results, and compact as needed.",
      adapterResponsibility: "Do not replay or duplicate Codex's internal loop.",
    },
    {
      feature: "native_tool_execution",
      owner: "kernel",
      nativeName: "Codex native tools",
      kernelResponsibility: "Execute shell, patch/file changes, image generation, web search, and MCP tools.",
      adapterResponsibility: "Map native item events, approvals, tool results, generated files, and media into OpenGrove events/artifacts.",
    },
    {
      feature: "host_tool_execution",
      owner: "shared",
      nativeName: "dynamic tools",
      appResponsibility: "Own OpenGrove tools such as choices, browser/computer staging, memory, and artifact writes.",
      kernelResponsibility: "Request OpenGrove dynamic tools through app-server tool call requests.",
      adapterResponsibility: "Expose OpenGrove tools as Codex dynamic tools and route deferred tool calls back to OpenGrove.",
    },
    {
      feature: "approval",
      owner: "shared",
      nativeName: "requestApproval",
      appResponsibility: "Own approval inbox UI, user decision, and durable audit trail.",
      kernelResponsibility: "Decide when command/file/permission operations need review.",
      adapterResponsibility: "Bridge item/commandExecution, item/fileChange, and item/permissions approval requests.",
    },
    {
      feature: "user_question",
      owner: "shared",
      nativeName: "requestUserInput / MCP elicitation",
      appResponsibility: "Own structured choice/form UI.",
      kernelResponsibility: "Pause native turn until user answers elicitation/user input.",
      adapterResponsibility: "Return exactly the user-selected answers in Codex's expected response shape.",
    },
    {
      feature: "skill_discovery",
      owner: "shared",
      nativeName: "skills/list",
      appResponsibility: "Own OpenGrove vault skill source of truth and publication ledger.",
      kernelResponsibility: "Scan native Codex skill directories and expose native skill metadata.",
      adapterResponsibility: "Refresh Codex skill cache before native skill turns when OpenGrove has just published skills.",
    },
    {
      feature: "skill_loading",
      owner: "kernel",
      nativeName: "Codex native skill loader",
      appResponsibility: "Publish OpenGrove skills into the Codex-compatible project/user skill directories.",
      kernelResponsibility: "Progressively load SKILL.md and referenced files.",
      adapterResponsibility: "Send skill references instead of duplicating full skill bodies in prompt context.",
    },
    {
      feature: "context_assembly",
      owner: "shared",
      appResponsibility: "Pass only explicit user-added context, attachments, and narrow vault UI hints; leave filesystem/page reading to Codex tools.",
      kernelResponsibility: "Apply Codex's own context, history, tool, and compaction policies.",
      adapterResponsibility: "Place OpenGrove context into developer instructions, user input, attachments, and dynamic tool metadata.",
    },
    {
      feature: "artifact_extraction",
      owner: "shared",
      appResponsibility: "Own OpenGrove ArtifactRecord lifecycle, preview, feedback, and vault files.",
      kernelResponsibility: "May create native files/media through tools.",
      adapterResponsibility: "Extract images/audio/video/files from Codex item/tool results without relying on model wording.",
    },
    {
      feature: "memory_write",
      owner: "app",
      appResponsibility: "Own memory suggestions, confirmation, scoring, and decay.",
      adapterResponsibility: "Attach native provenance when memory is created from Codex events.",
    },
    {
      feature: "compaction",
      owner: "shared",
      nativeName: "hook/started type=compaction",
      appResponsibility: "Write memory/context snapshots at compaction boundaries.",
      kernelResponsibility: "Decide and execute Codex native compaction.",
      adapterResponsibility: "Map compaction started/finished hooks into OpenGrove events.",
    },
    {
      feature: "auth",
      owner: "shared",
      nativeName: "account/chatgptAuthTokens/refresh",
      appResponsibility: "Provide AuthProfile or Codex auth-file backed token refresh without exposing secrets.",
      kernelResponsibility: "Request token refresh when ChatGPT auth expires.",
      adapterResponsibility: "Read the configured auth profile and return Codex's expected refresh payload.",
    },
    {
      feature: "sandbox",
      owner: "shared",
      nativeName: "sandboxPolicy / approvalsReviewer",
      appResponsibility: "Expose product-level access modes.",
      kernelResponsibility: "Enforce Codex sandbox semantics.",
      adapterResponsibility: "Translate OpenGrove access modes into Codex sandboxPolicy and approvalPolicy values.",
    },
    {
      feature: "trajectory",
      owner: "app",
      appResponsibility: "Persist normalized run trajectories and OpenGrove-side artifacts.",
      adapterResponsibility: "Include Codex native ids in normalized events for replay/debug.",
    },
    {
      feature: "diagnostics",
      owner: "adapter",
      nativeName: "app-server JSON-RPC",
      appResponsibility: "Expose diagnostic locations and privacy policy in UI/docs.",
      adapterResponsibility: "Capture OpenGrove <-> Codex app-server RPC with redaction; optionally correlate with provider HTTP capture.",
    },
  ],
  eventMappings: [
    {
      appEvent: "turn.started / turn.finished / run.paused",
      nativeEvent: "turn/start + turn lifecycle notifications",
      direction: "native_to_app",
      adapterResponsibility: "Map Codex turn ids and pause reasons into OpenGrove run lifecycle events.",
    },
    {
      appEvent: "tool.call.started / tool.call.completed",
      nativeEvent: "item/tool_call / item/tool_result and dynamic tool requests",
      direction: "bidirectional",
      adapterResponsibility: "Route OpenGrove dynamic tools to OpenGrove execution and preserve Codex native tool provenance.",
    },
    {
      appEvent: "approval.requested / approval.resolved",
      nativeRequest: "item/commandExecution/requestApproval, item/fileChange/requestApproval, item/permissions/requestApproval",
      direction: "bidirectional",
      adapterResponsibility: "Render typed OpenGrove approval UI and return Codex decision objects.",
    },
    {
      appEvent: "userQuestion.requested / userQuestion.answered",
      nativeRequest: "item/tool/requestUserInput, mcpServer/elicitation/request",
      direction: "bidirectional",
      adapterResponsibility: "Keep elicitation separate from approval and return Codex-native answer payloads.",
    },
    {
      appEvent: "compaction.started / compaction.finished",
      nativeEvent: "hook/started type=compaction and matching completion signal",
      direction: "native_to_app",
      adapterResponsibility: "Trigger OpenGrove memory snapshot and record compaction provenance.",
    },
    {
      appEvent: "artifact.created",
      nativeEvent: "tool_result / item_completed with media or file references",
      direction: "native_to_app",
      adapterResponsibility: "Extract media/file artifacts generically and link them to the source run/item.",
    },
  ],
  diagnostics: {
    defaultModeId: "codex-app-server-rpc",
    modes: [
      {
        id: "codex-app-server-rpc",
        title: "Codex app-server RPC capture",
        layer: "adapter-rpc",
        status: "implemented",
        enabledByDefault: true,
        output: "data/codex-rpc-captures/",
        env: [
          appEnvName("CODEX_RPC_CAPTURE"),
          appEnvName("CODEX_RPC_CAPTURE_DIR"),
          appEnvName("CODEX_RPC_CAPTURE_MAX_INLINE_BYTES"),
          appEnvName("CODEX_RPC_CAPTURE_STDERR"),
        ],
        redaction: "redacted",
        notes: [
          "Records JSON-RPC requests/responses/notifications between OpenGrove and codex app-server.",
          "Large payloads are moved to blob files; auth/token/secret-like fields are redacted recursively.",
        ],
      },
      {
        id: "codex-native-sessions",
        title: "Codex native session JSONL",
        layer: "native-transcript",
        status: "external",
        output: "~/.codex/sessions/**/*.jsonl",
        redaction: "external",
        notes: [
          "Owned by Codex itself. Useful for checking base instructions, dynamic tools, sandbox, model, and effort.",
        ],
      },
      {
        id: "codex-provider-http",
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
          "Injects proxy and CA environment variables into the codex app-server child process.",
          "OpenGrove auto-starts the local mitmproxy archive service when provider capture is enabled.",
          "Verified with Codex 0.128.0-alpha.1: captures ChatGPT HTTP calls and Responses WebSocket frames when CODEX_CA_CERTIFICATE points at the mitm CA.",
        ],
      },
      {
        id: `${APP_PROTOCOL_ID}-trajectory`,
        title: "OpenGrove trajectory JSON",
        layer: "trajectory",
        status: "implemented",
        enabledByDefault: true,
        output: "data/trajectories/",
        redaction: "redacted",
      },
    ],
    nativeTranscript: {
      path: "~/.codex/sessions/**/*.jsonl",
      availability: "available",
      notes: [
        "Codex writes its own session transcript, but OpenGrove should still rely on adapter RPC capture for bridge debugging.",
      ],
    },
    notes: [
      "Codex is the reference adapter for full native-harness bridging: OpenGrove should not duplicate native shell/patch/tool execution.",
    ],
  },
};
