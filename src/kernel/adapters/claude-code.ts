import {
  ClaudeCodeRuntime,
  type ClaudeCodeRuntimeOptions,
} from "../../runtime/claude-code-runtime.js";
import { APP_PROTOCOL_ID, appEnvName, readAppEnv } from "../../identity.js";
import { RuntimeKernelAdapter } from "../adapter.js";
import { commandVersion, directorySource, fileSource, plannedInstallAction, resolveHomePath } from "../discovery.js";
import type { KernelAdapterContract, KernelDiscovery } from "../types.js";

export class ClaudeCodeKernelAdapter extends RuntimeKernelAdapter {
  constructor(private readonly claudeOptions: ClaudeCodeRuntimeOptions) {
    super({
      id: "claude-code",
      title: "Claude Code",
      runtime: new ClaudeCodeRuntime(claudeOptions),
      capabilities: {
        streaming: true,
        toolCalls: true,
        hostTools: false,
        approvals: true,
        elicitation: false,
        artifacts: true,
        compaction: false,
        authRefresh: true,
        sandbox: ["danger-full-access"],
        knowledge: {
          nativeSkills: true,
          toolMediatedSkills: false,
          progressiveDisclosure: true,
          nativeArtifacts: false,
          deliveryLedger: true,
        },
      },
      contract: CLAUDE_CODE_KERNEL_CONTRACT,
    });
  }

  async discover(): Promise<KernelDiscovery> {
    return discoverClaudeCodeKernel(this.claudeOptions, process.cwd(), this.contract.diagnostics);
  }
}

export function createClaudeCodeKernelAdapter(
  options: ClaudeCodeRuntimeOptions,
): ClaudeCodeKernelAdapter {
  return new ClaudeCodeKernelAdapter(options);
}

export function discoverClaudeCodeKernel(
  options: Partial<ClaudeCodeRuntimeOptions> = {},
  cwd = process.cwd(),
  diagnostics = CLAUDE_CODE_KERNEL_CONTRACT.diagnostics,
): KernelDiscovery {
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || resolveHomePath(".claude");
  const cliPath = options.cliPath || readAppEnv("CLAUDE_CLI_PATH") || "claude";
  const version = commandVersion(cliPath);
  const installed = Boolean(options.cliPath || version);
  return {
    kernelId: "claude-code",
    title: "Claude Code",
    installed,
    available: installed,
    binaryPath: options.cliPath,
    version,
    configHome: claudeHome,
    diagnostics,
    knowledgeSources: [
      fileSource({
        id: "claude.user-claude-md",
        title: "CLAUDE.md",
        kind: "project_instructions",
        scope: "user",
        path: `${claudeHome}/CLAUDE.md`,
        native: true,
        syncMode: "index",
        description: "Claude 全局常驻指令文件。",
      }),
      directorySource({
        id: "claude.user-skills",
        title: "skills",
        kind: "skills",
        scope: "user",
        path: `${claudeHome}/skills`,
        native: true,
        syncMode: "index",
      }),
      directorySource({
        id: "claude.user-commands",
        title: "User slash commands",
        kind: "commands",
        scope: "user",
        path: `${claudeHome}/commands`,
        native: true,
        userVisible: false,
        knowledgeLike: false,
        syncMode: "index",
      }),
      directorySource({
        id: "claude.user-agents",
        title: "agents",
        kind: "agents",
        scope: "user",
        path: `${claudeHome}/agents`,
        native: true,
        knowledgeLike: true,
        syncMode: "index",
      }),
      directorySource({
        id: "claude.user-agent-memory",
        title: "memory",
        kind: "memory",
        scope: "user",
        path: `${claudeHome}/agent-memory`,
        native: true,
        syncMode: "index",
      }),
      directorySource({
        id: "claude.session-memory",
        title: "Session memory config",
        kind: "memory",
        scope: "user",
        path: `${claudeHome}/session-memory`,
        native: true,
        userVisible: false,
        knowledgeLike: false,
        syncMode: "index",
        description: "Claude Code session memory 的 prompt/template 和缓存目录。",
      }),
      directorySource({
        id: "claude.output-styles",
        title: "Output styles",
        kind: "settings",
        scope: "user",
        path: `${claudeHome}/output-styles`,
        native: true,
        userVisible: false,
        knowledgeLike: false,
        syncMode: "index",
      }),
      fileSource({
        id: "claude.user-settings",
        title: "User settings.json",
        kind: "settings",
        scope: "user",
        path: `${claudeHome}/settings.json`,
        native: true,
        knowledgeLike: false,
        syncMode: "none",
      }),
      fileSource({
        id: "claude.project-settings",
        title: "Project settings.json",
        kind: "settings",
        scope: "project",
        path: `${cwd}/.claude/settings.json`,
        native: true,
        knowledgeLike: false,
        syncMode: "none",
      }),
      fileSource({
        id: "claude.local-settings",
        title: "Local settings.json",
        kind: "settings",
        scope: "workspace",
        path: `${cwd}/.claude/settings.local.json`,
        native: true,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
      directorySource({
        id: "claude.native-transcripts",
        title: "Claude native transcripts",
        kind: "sessions",
        scope: "user",
        path: `${claudeHome}/projects`,
        native: true,
        knowledgeLike: false,
        enabledByDefault: false,
        syncMode: "none",
      }),
    ],
    installActions: [
      plannedInstallAction({
        id: "claude.install",
        title: "安装 Claude Code CLI",
        command: ["npm", "install", "-g", "@anthropic-ai/claude-code"],
        description: "如果本机没有 claude 命令，可以按官方 CLI 安装；执行前需要用户确认。",
      }),
    ],
    notes: [
      "Claude Code 把 CLAUDE.md/rules 视为项目指令，把 skills/commands/agents/agent-memory 视为不同原生对象；OpenGrove 不应该把它们混成一个 flat skill 列表。",
    ],
  };
}

export const CLAUDE_CODE_KERNEL_CONTRACT: KernelAdapterContract = {
  ownership: [
    {
      feature: "session",
      owner: "shared",
      nativeName: "Claude session / transcript",
      appResponsibility: "Own OpenGrove session/run ids and project navigation.",
      kernelResponsibility: "Own Claude Code session storage and transcript files.",
      adapterResponsibility: "Bind OpenGrove session ids to the stable Claude session id used by the bridge.",
    },
    {
      feature: "turn_lifecycle",
      owner: "shared",
      nativeName: "stream-json messages",
      appResponsibility: "Record normalized run lifecycle and trajectory.",
      kernelResponsibility: "Stream assistant/tool events through Claude Code.",
      adapterResponsibility: "Map Claude stream-json events into OpenGrove AgentEvent.",
      notes: "Current adapter is still a CLI stream bridge, not the full QueryEngine/RemoteSession harness.",
    },
    {
      feature: "model_loop",
      owner: "kernel",
      nativeName: "Claude Code QueryEngine",
      kernelResponsibility: "Own model calls, tool planning, native skill loading, and compact behavior.",
      adapterResponsibility: "Avoid rebuilding Claude Code's native loop in OpenGrove.",
    },
    {
      feature: "native_tool_execution",
      owner: "kernel",
      nativeName: "Claude Code tools",
      kernelResponsibility: "Execute Claude Code native tools and MCP tools.",
      adapterResponsibility: "Map Claude tool_use/tool_result blocks into OpenGrove events when visible in the stream.",
    },
    {
      feature: "host_tool_execution",
      owner: "shared",
      appResponsibility: "Own OpenGrove host tools and tool-side artifacts.",
      kernelResponsibility: "Can call exposed MCP/SDK tools when a deeper bridge is wired.",
      adapterResponsibility: "Current CLI bridge has limited host-tool parity; future SDK bridge should expose OpenGrove tools natively.",
    },
    {
      feature: "approval",
      owner: "shared",
      nativeName: "CanUseToolFn / ToolUseConfirm",
      appResponsibility: "Own approval UI and durable approval records.",
      kernelResponsibility: "Decide native tool confirmation requirements.",
      adapterResponsibility: "Future full bridge should map ToolUseConfirm into OpenGrove approval requests.",
      notes: "Current CLI bridge passes Claude permission modes, but it does not yet map native confirmation prompts into OpenGrove approval records.",
    },
    {
      feature: "user_question",
      owner: "shared",
      nativeName: "handleElicitation / ask user",
      appResponsibility: "Own structured question UI.",
      kernelResponsibility: "May request user information through native elicitation paths.",
      adapterResponsibility: "Future SDK/RemoteSession bridge should map elicitation separately from approval.",
    },
    {
      feature: "skill_discovery",
      owner: "shared",
      nativeName: "Claude Code plugin/bundled/MCP skills",
      appResponsibility: "Own OpenGrove vault skill source and publication ledger.",
      kernelResponsibility: "Discover native Claude Code skills.",
      adapterResponsibility: "Publish OpenGrove skills into Claude-compatible skill locations instead of injecting full bodies.",
    },
    {
      feature: "skill_loading",
      owner: "kernel",
      nativeName: "Claude Code native skill loader",
      appResponsibility: "Provide source files and metadata in a Claude-compatible layout.",
      kernelResponsibility: "Progressively load skill documents and references.",
      adapterResponsibility: "Declare publication targets and loading status.",
    },
    {
      feature: "context_assembly",
      owner: "shared",
      appResponsibility: "Pass explicit user-added context, attachments, and narrow vault UI hints; leave project reading to Claude Code tools.",
      kernelResponsibility: "Add Claude Code native system/user/tool context.",
      adapterResponsibility: "Keep OpenGrove context distinct from Claude native prompt internals.",
    },
    {
      feature: "artifact_extraction",
      owner: "shared",
      appResponsibility: "Own OpenGrove ArtifactRecord lifecycle.",
      kernelResponsibility: "May create files/media through native tools.",
      adapterResponsibility: "Extract visible tool result attachments and file references into OpenGrove artifacts.",
    },
    {
      feature: "memory_write",
      owner: "app",
      appResponsibility: "Own OpenGrove memory writes, review, confidence, and decay.",
    },
    {
      feature: "compaction",
      owner: "shared",
      nativeName: "Claude compact boundary",
      appResponsibility: "Record OpenGrove memory/context snapshots.",
      kernelResponsibility: "Run native compact.",
      adapterResponsibility: "Future full bridge should map compact start/finish into OpenGrove events.",
    },
    {
      feature: "auth",
      owner: "shared",
      nativeName: "Anthropic/Bedrock auth",
      appResponsibility: "Own AuthProfileStore entries when configured through OpenGrove.",
      kernelResponsibility: "Use Claude Code's configured auth/provider path.",
      adapterResponsibility: "Avoid writing raw API keys or Bedrock credentials into diagnostic captures.",
    },
    {
      feature: "sandbox",
      owner: "shared",
      nativeName: "permission mode",
      appResponsibility: "Expose OpenGrove policy preference.",
      kernelResponsibility: "Enforce Claude Code permission mode.",
      adapterResponsibility: "Map OpenGrove access modes into Claude permission modes.",
    },
    {
      feature: "trajectory",
      owner: "app",
      appResponsibility: "Persist normalized trajectory records.",
      adapterResponsibility: "Attach Claude native message/session ids when available.",
    },
    {
      feature: "diagnostics",
      owner: "adapter",
      nativeName: "stream-json / transcript / provider capture",
      appResponsibility: "Expose available diagnostic layers and privacy notes.",
      adapterResponsibility: "Declare what can be captured through CLI stream, native transcript, and optional Bedrock/HTTP capture.",
    },
  ],
  eventMappings: [
    {
      appEvent: "assistant.delta / model.response",
      nativeEvent: "Claude stream-json assistant messages",
      direction: "native_to_app",
      adapterResponsibility: "Convert stream-json assistant content into OpenGrove assistant events.",
    },
    {
      appEvent: "tool.call.started / tool.call.completed",
      nativeEvent: "tool_use / tool_result blocks",
      direction: "native_to_app",
      adapterResponsibility: "Preserve visible Claude tool ids, names, input, and result summaries.",
    },
    {
      appEvent: "approval.requested",
      nativeRequest: "ToolUseConfirm / CanUseToolFn",
      direction: "bidirectional",
      adapterResponsibility: "Planned for full SDK/RemoteSession bridge; not provided by the current bypassPermissions CLI bridge.",
    },
    {
      appEvent: "userQuestion.requested",
      nativeRequest: "handleElicitation",
      direction: "bidirectional",
      adapterResponsibility: "Planned for full SDK/RemoteSession bridge.",
    },
    {
      appEvent: "compaction.started / compaction.finished",
      nativeEvent: "Claude compact lifecycle",
      direction: "native_to_app",
      adapterResponsibility: "Planned for full SDK/RemoteSession bridge.",
    },
  ],
  diagnostics: {
    defaultModeId: "claude-cli-stream",
    modes: [
      {
        id: "claude-cli-stream",
        title: "Claude CLI stream-json capture",
        layer: "process-stdio",
        status: "implemented",
        enabledByDefault: true,
        output: "data/claude-code-captures/",
        env: [
          appEnvName("CLAUDE_CODE_CAPTURE"),
          appEnvName("CLAUDE_CODE_CAPTURE_DIR"),
          appEnvName("CLAUDE_CODE_CAPTURE_MAX_INLINE_BYTES"),
          appEnvName("CLAUDE_CODE_CAPTURE_STDERR"),
          appEnvName("CLAUDE_CODE_CAPTURE_RAW_IO"),
        ],
        redaction: "raw",
        notes: [
          "Records Claude CLI stream-json stdout events plus OpenGrove-mapped events.",
          "By default it also records the raw OpenGrove user input, appended system prompt, and raw stdout JSON line, matching native transcript expectations.",
          `Set ${appEnvName("CLAUDE_CODE_CAPTURE_RAW_IO")}=0 to keep only bytes/hash summaries for input and stdout.`,
          "Structured event copies are still redacted for easier inspection, but raw fields are intentionally exact.",
          "It does not expose hidden reasoning or the final provider request payload.",
        ],
      },
      {
        id: "claude-native-transcript",
        title: "Claude Code native transcript",
        layer: "native-transcript",
        status: "external",
        output: "~/.claude/projects/**/*.jsonl",
        redaction: "external",
        notes: [
          "Owned by Claude Code. Useful for session messages, but not a full provider request/system-prompt dump.",
        ],
      },
      {
        id: "claude-provider-http",
        title: "Provider HTTP / Bedrock capture",
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
          "Injects proxy and CA environment variables into the Claude CLI child process.",
          "OpenGrove auto-starts the local mitmproxy archive service when provider capture is enabled.",
          "Works for provider HTTPS bodies when Claude Code's network stack honors the proxy and trusts the CA.",
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
      path: "~/.claude/projects/**/*.jsonl",
      availability: "partial",
      notes: [
        "Claude native transcripts are useful but do not include hidden thinking or complete provider requests.",
      ],
    },
    notes: [
      "Claude Code needs a deeper SDK/RemoteSession adapter before OpenGrove can claim full parity with Claude's native harness.",
    ],
  },
};
