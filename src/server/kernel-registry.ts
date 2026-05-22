import type {
  BridgeKernelId,
  BridgeProviderCredentialKind,
  BridgeProviderProtocol,
} from "./bridge-types.js";

export type BridgeKernelBindingMode = "native" | "env" | "config-file" | "native-api";

export interface BridgeKernelDescriptor {
  id: BridgeKernelId;
  label: string;
  externalProtocols: BridgeProviderProtocol[];
  externalCredentialKinds: BridgeProviderCredentialKind[];
  bindingMode: BridgeKernelBindingMode;
  nativeControls: {
    reasoning: boolean;
    speed: boolean;
  };
  externalControls: {
    reasoning: boolean;
    speed: boolean;
  };
  thread: {
    isolateByRuntimeBinding: boolean;
    reuseAcrossModelChanges: boolean;
  };
}

const API_CREDENTIALS: BridgeProviderCredentialKind[] = ["api-key", "env-key"];
const API_AND_VENDOR_CREDENTIALS: BridgeProviderCredentialKind[] = [
  ...API_CREDENTIALS,
  "aws",
  "google-adc",
];

const KERNEL_DESCRIPTORS: Record<BridgeKernelId, BridgeKernelDescriptor> = {
  codex: {
    id: "codex",
    label: "Codex",
    externalProtocols: ["openai-compatible"],
    externalCredentialKinds: API_CREDENTIALS,
    bindingMode: "config-file",
    nativeControls: { reasoning: true, speed: true },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: true, reuseAcrossModelChanges: true },
  },
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    externalProtocols: ["anthropic-compatible"],
    externalCredentialKinds: API_AND_VENDOR_CREDENTIALS,
    bindingMode: "config-file",
    nativeControls: { reasoning: false, speed: false },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: true, reuseAcrossModelChanges: true },
  },
  hermes: {
    id: "hermes",
    label: "Hermes",
    externalProtocols: ["openai-compatible", "anthropic-compatible"],
    externalCredentialKinds: API_CREDENTIALS,
    bindingMode: "config-file",
    nativeControls: { reasoning: false, speed: false },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: false, reuseAcrossModelChanges: true },
  },
  pi: {
    id: "pi",
    label: "Pi",
    externalProtocols: ["openai-compatible", "anthropic-compatible", "gemini-compatible"],
    externalCredentialKinds: API_CREDENTIALS,
    bindingMode: "native-api",
    nativeControls: { reasoning: false, speed: false },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: true, reuseAcrossModelChanges: true },
  },
  openclaw: nativeCliDescriptor("openclaw", "OpenClaw"),
  "deepseek-tui": openAiCliDescriptor("deepseek-tui", "DeepSeek TUI"),
  "gemini-cli": {
    id: "gemini-cli",
    label: "Gemini CLI",
    externalProtocols: ["gemini-compatible"],
    externalCredentialKinds: API_CREDENTIALS,
    bindingMode: "env",
    nativeControls: { reasoning: false, speed: false },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: true, reuseAcrossModelChanges: false },
  },
  "qwen-code": openAiCliDescriptor("qwen-code", "Qwen Code"),
  opencode: {
    ...openAiCliDescriptor("opencode", "OpenCode"),
    externalProtocols: ["openai-compatible", "anthropic-compatible"],
    externalCredentialKinds: [...API_CREDENTIALS, "aws"],
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot CLI",
    externalProtocols: ["openai-compatible", "anthropic-compatible"],
    externalCredentialKinds: API_CREDENTIALS,
    bindingMode: "env",
    nativeControls: { reasoning: false, speed: false },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: true, reuseAcrossModelChanges: true },
  },
  "cursor-agent": nativeCliDescriptor("cursor-agent", "Cursor Agent"),
  kimi: nativeCliDescriptor("kimi", "Kimi CLI"),
  "kiro-cli": nativeCliDescriptor("kiro-cli", "Kiro CLI"),
};

export function getBridgeKernelDescriptor(kernelId: BridgeKernelId): BridgeKernelDescriptor {
  return KERNEL_DESCRIPTORS[kernelId];
}

function openAiCliDescriptor(id: BridgeKernelId, label: string): BridgeKernelDescriptor {
  return {
    id,
    label,
    externalProtocols: ["openai-compatible"],
    externalCredentialKinds: API_CREDENTIALS,
    bindingMode: id === "openclaw" ? "native-api" : "env",
    nativeControls: { reasoning: false, speed: false },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: true, reuseAcrossModelChanges: false },
  };
}

function nativeCliDescriptor(id: BridgeKernelId, label: string): BridgeKernelDescriptor {
  return {
    id,
    label,
    externalProtocols: [],
    externalCredentialKinds: ["kernel-native"],
    bindingMode: "native",
    nativeControls: { reasoning: false, speed: false },
    externalControls: { reasoning: false, speed: false },
    thread: { isolateByRuntimeBinding: true, reuseAcrossModelChanges: true },
  };
}
