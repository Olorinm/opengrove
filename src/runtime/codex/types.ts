import type {
  ApprovalPolicy,
  JsonObject,
  JsonValue,
} from "../../core.js";
import type {
  CodexRpcCaptureOptions,
} from "../codex-rpc-capture.js";
import type { ProviderHttpCaptureOptions } from "../provider-http-capture.js";

export type CodexApprovalPolicy = ApprovalPolicy;
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";

export interface CodexRuntimeOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  statePath?: string;
  configuredModel?: string;
  configuredModelProvider?: string;
  runtimeBindingFingerprint?: string;
  providerConfig?: CodexModelProviderRuntimeConfig;
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
  approvalsReviewer?: CodexApprovalsReviewer;
  serviceTier?: string;
  allowServiceTier?: boolean;
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  rpcCapture?: CodexRpcCaptureOptions;
  providerHttpCapture?: ProviderHttpCaptureOptions;
  rawEventCapture?: boolean;
}

export type CodexModelProviderRuntimeConfig = {
  providerKey: string;
  name: string;
  baseUrl: string;
  envKey: string;
  wireApi: "chat" | "responses";
};

export type RpcRequest = {
  id?: number | string;
  method: string;
  params?: JsonValue;
};

export type RpcResponse = {
  id: number | string;
  result?: JsonValue;
  error?: {
    code?: number;
    message: string;
    data?: JsonValue;
  };
};

export type RpcMessage = RpcRequest | RpcResponse;

export type CodexDynamicToolSpec = {
  name: string;
  description: string;
  inputSchema: JsonValue;
  deferLoading?: boolean;
};

export type CodexDynamicToolCallParams = {
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments?: JsonValue;
};

export type CodexDynamicToolCallResponse = {
  contentItems: Array<{ type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }>;
  success: boolean;
};

export type CodexThreadBinding = {
  threadId: string;
  dynamicToolsFingerprint: string;
  runtimeBindingFingerprint?: string;
  model?: string;
  modelProvider?: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
};

export type CodexThreadStartResponse = {
  thread?: {
    id?: string;
  };
  model?: string | null;
  modelProvider?: string | null;
};

export type CodexTurnStartResponse = {
  turn?: {
    id?: string;
    status?: string;
  };
};

export type CodexInitializeResponse = {
  userAgent?: string;
  codexHome?: string;
};

export type CodexTurnInputItem =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; url: string; detail?: "auto" | "low" | "high" | "original" }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type ServerRequestHandler = (request: {
  id: number | string;
  method: string;
  params?: JsonValue;
}) => Promise<JsonValue | undefined> | JsonValue | undefined;

export type ServerNotificationHandler = (notification: {
  method: string;
  params?: JsonValue;
}) => void | Promise<void>;

export const DEFAULT_CODEX_MODEL = "gpt-5.4";
export const MIN_CODEX_APP_SERVER_VERSION = "0.125.0";
export const CODEX_NATIVE_APPROVAL_TIMEOUT_MS = 120_000;
export const DEFAULT_CODEX_APP_SERVER_ARGS = [
  "app-server",
  "--disable",
  "responses_websockets",
  "--disable",
  "responses_websockets_v2",
  "--disable",
  "responses_websocket_response_processed",
  "--listen",
  "stdio://",
];
export const CODEX_THREAD_CONFIG_OVERRIDES: JsonObject = {
  "features.responses_websockets": false,
  "features.responses_websockets_v2": false,
  "features.responses_websocket_response_processed": false,
  "features.image_generation": true,
  suppress_unstable_features_warning: true,
};
