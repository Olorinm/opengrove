import type {
  AgentTurnRequest,
  JsonObject,
  ResponseSpeed,
  RuntimeAccessMode,
  SandboxPolicy,
} from "../../core.js";
import type {
  CodexApprovalPolicy,
  CodexApprovalsReviewer,
  CodexSandboxMode,
} from "./types.js";
import { DEFAULT_CODEX_MODEL } from "./types.js";

export function normalizeCodexModelId(requestedModelId: string | undefined, configuredModel: string | undefined): string {
  const configured = configuredModel?.trim();
  if (configured) {
    return configured;
  }
  const requested = requestedModelId?.trim();
  if (requested && /^(gpt|o)\b/i.test(requested)) {
    return requested;
  }
  return DEFAULT_CODEX_MODEL;
}

export function resolveCodexSandboxMode(
  request: AgentTurnRequest,
  configured: CodexSandboxMode | undefined,
): CodexSandboxMode {
  const modeSandbox = codexPolicyForAccessMode(request.accessMode)?.sandbox;
  if (modeSandbox) {
    return modeSandbox;
  }
  const capabilitySandbox = strongestSandboxPolicy(
    (request.capabilities ?? [])
      .map((capability) => capability.sandbox)
      .filter(Boolean) as SandboxPolicy[],
  );
  if (capabilitySandbox) {
    return capabilitySandbox;
  }
  return configured ?? "danger-full-access";
}

export function resolveCodexApprovalPolicy(
  requested: RuntimeAccessMode | undefined,
  configured: CodexApprovalPolicy | undefined,
): CodexApprovalPolicy {
  return codexPolicyForAccessMode(requested)?.approvalPolicy ?? configured ?? "never";
}

export function resolveCodexApprovalsReviewer(configured: CodexApprovalsReviewer | undefined): CodexApprovalsReviewer {
  return configured === "auto_review" || configured === "guardian_subagent" || configured === "user"
    ? configured
    : "user";
}

export function toCodexSandboxPolicy(mode: CodexSandboxMode): JsonObject {
  switch (mode) {
    case "read-only":
      return { type: "readOnly", networkAccess: false };
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: [],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    case "danger-full-access":
      return { type: "dangerFullAccess" };
  }
}

export function resolveReasoningEffort(value: string | undefined): "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : undefined;
}

export function resolveCodexServiceTier(requested: ResponseSpeed | undefined, configured: string | undefined): string | undefined {
  if (requested === "fast") {
    return "fast";
  }
  return configured?.trim() || undefined;
}

function codexPolicyForAccessMode(value: RuntimeAccessMode | undefined): {
  sandbox: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
} | undefined {
  switch (value) {
    case "default":
      return { sandbox: "workspace-write", approvalPolicy: "on-request" };
    case "auto-review":
      return { sandbox: "workspace-write", approvalPolicy: "on-failure" };
    case "full-access":
      return { sandbox: "danger-full-access", approvalPolicy: "never" };
    default:
      return undefined;
  }
}

function strongestSandboxPolicy(values: SandboxPolicy[]): CodexSandboxMode | undefined {
  if (values.includes("danger-full-access")) {
    return "danger-full-access";
  }
  if (values.includes("workspace-write")) {
    return "workspace-write";
  }
  return values.includes("read-only") ? "read-only" : undefined;
}
