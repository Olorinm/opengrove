import type { ComponentType, CSSProperties } from "react";
import ClaudeColor from "@lobehub/icons/es/Claude/components/Color";
import ClaudeCodeColor from "@lobehub/icons/es/ClaudeCode/components/Color";
import CodexColor from "@lobehub/icons/es/Codex/components/Color";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color";
import GeminiCliColor from "@lobehub/icons/es/GeminiCLI/components/Color";
import HermesAgentMono from "@lobehub/icons/es/HermesAgent/components/Mono";
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono";
import OpenClawColor from "@lobehub/icons/es/OpenClaw/components/Color";
import BedrockColor from "@lobehub/icons/es/Bedrock/components/Color";
import AwsColor from "@lobehub/icons/es/Aws/components/Color";
import VolcengineColor from "@lobehub/icons/es/Volcengine/components/Color";
import AlibabaCloudColor from "@lobehub/icons/es/AlibabaCloud/components/Color";
import BailianColor from "@lobehub/icons/es/Bailian/components/Color";
import BaiduColor from "@lobehub/icons/es/Baidu/components/Color";
import BaiduCloudColor from "@lobehub/icons/es/BaiduCloud/components/Color";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color";
import MoonshotMono from "@lobehub/icons/es/Moonshot/components/Mono";
import KimiColor from "@lobehub/icons/es/Kimi/components/Color";
import OpenRouterMono from "@lobehub/icons/es/OpenRouter/components/Mono";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color";
import ModelScopeColor from "@lobehub/icons/es/ModelScope/components/Color";
import SiliconCloudColor from "@lobehub/icons/es/SiliconCloud/components/Color";
import StepfunColor from "@lobehub/icons/es/Stepfun/components/Color";
import NovitaColor from "@lobehub/icons/es/Novita/components/Color";
import AiHubMixColor from "@lobehub/icons/es/AiHubMix/components/Color";
import ZhipuColor from "@lobehub/icons/es/Zhipu/components/Color";
import ChatGLMColor from "@lobehub/icons/es/ChatGLM/components/Color";
import GoogleCloudColor from "@lobehub/icons/es/GoogleCloud/components/Color";
import VertexAIColor from "@lobehub/icons/es/VertexAI/components/Color";
import { Bot, PlugZap } from "lucide-react";
import type { KernelPreference, ProviderProfile } from "../../bridge";

type BrandIconComponent = ComponentType<{
  className?: string;
  size?: number | string;
  style?: CSSProperties;
}>;

type ProviderIconInput = Pick<
  ProviderProfile,
  "id" | "name" | "protocol" | "sourceKernel" | "openaiBaseUrl" | "anthropicBaseUrl" | "geminiBaseUrl"
>;

type BrandIconSpec = {
  brand: string;
  component?: BrandIconComponent;
  currentColor?: string;
  placeholder?: boolean;
};

export function KernelIcon(props: {
  kernelId?: KernelPreference | string;
  className?: string;
  size?: number;
}) {
  const spec = kernelIconSpec(props.kernelId);
  return <EntityIcon kind="kernel" spec={spec} className={props.className} size={props.size} />;
}

export function ProviderIcon(props: {
  provider?: ProviderIconInput;
  providerId?: string;
  providerName?: string;
  className?: string;
  size?: number;
}) {
  const spec = providerIconSpec(props.provider, props.providerId, props.providerName);
  return <EntityIcon kind="provider" spec={spec} className={props.className} size={props.size} />;
}

function EntityIcon(props: {
  kind: "kernel" | "provider";
  spec: BrandIconSpec;
  className?: string;
  size?: number;
}) {
  const Icon = props.spec.component;
  const size = props.size ?? 16;
  return (
    <span
      className={["entity-icon", `entity-icon-${props.kind}`, props.className].filter(Boolean).join(" ")}
      data-brand={props.spec.brand}
      data-placeholder={props.spec.placeholder ? "true" : "false"}
      aria-hidden="true"
    >
      {Icon ? (
        <Icon size={size} style={props.spec.currentColor ? { color: props.spec.currentColor } : undefined} />
      ) : (
        <PlugZap size={size} strokeWidth={2.05} />
      )}
    </span>
  );
}

function kernelIconSpec(kernelId?: KernelPreference | string): BrandIconSpec {
  const normalized = normalizeToken(kernelId);
  if (normalized === "codex") return { brand: "codex", component: CodexColor };
  if (normalized === "claude-code" || normalized === "claude") return { brand: "claude-code", component: ClaudeCodeColor };
  if (normalized === "opencode") return { brand: "opencode", component: OpenCodeMono };
  if (normalized === "hermes") return { brand: "hermes", component: HermesAgentMono };
  if (normalized === "pi") return { brand: "pi", component: PiMark };
  if (normalized === "openclaw") return { brand: "openclaw", component: OpenClawColor };
  if (normalized === "gemini-cli") return { brand: "gemini-cli", component: GeminiCliColor };
  if (normalized === "deepseek-tui" || normalized === "deepseek") return { brand: "deepseek", component: DeepSeekColor };
  if (normalized === "qwen-code" || normalized === "qwen") return { brand: "qwen", component: QwenColor };
  if (normalized === "kimi") return { brand: "kimi", component: KimiColor };
  if (normalized === "auto") return { brand: "auto", component: Bot };
  return { brand: normalized || "kernel", placeholder: true };
}

function providerIconSpec(provider?: ProviderIconInput, providerId?: string, providerName?: string): BrandIconSpec {
  const haystack = [
    provider?.id,
    provider?.name,
    provider?.protocol,
    provider?.sourceKernel,
    provider?.openaiBaseUrl,
    provider?.anthropicBaseUrl,
    provider?.geminiBaseUrl,
    providerId,
    providerName,
  ].map((item) => normalizeToken(item)).join(" ");

  if (includesAny(haystack, ["bedrock"])) return { brand: "bedrock", component: BedrockColor };
  if (includesAny(haystack, ["aws", "amazon"])) return { brand: "aws", component: AwsColor };
  if (includesAny(haystack, ["vertex"])) return { brand: "vertex-ai", component: VertexAIColor };
  if (includesAny(haystack, ["google-cloud"])) return { brand: "google-cloud", component: GoogleCloudColor };
  if (includesAny(haystack, ["google", "gemini"])) return { brand: "gemini", component: GeminiColor };
  if (includesAny(haystack, ["deepseek"])) return { brand: "deepseek", component: DeepSeekColor };
  if (includesAny(haystack, ["volc", "volcengine", "ark", "doubao", "火山"])) return { brand: "volcengine", component: VolcengineColor };
  if (includesAny(haystack, ["bailian", "dashscope", "百炼"])) return { brand: "bailian", component: BailianColor };
  if (includesAny(haystack, ["alibaba", "aliyun", "阿里"])) return { brand: "alibaba-cloud", component: AlibabaCloudColor };
  if (includesAny(haystack, ["qwen"])) return { brand: "qwen", component: QwenColor };
  if (includesAny(haystack, ["aihubmix"])) return { brand: "aihubmix", component: AiHubMixColor };
  if (includesAny(haystack, ["openrouter"])) return { brand: "openrouter", component: OpenRouterMono, currentColor: "#6566f1" };
  if (includesAny(haystack, ["therouter", "router", "newapi", "n1n"])) return { brand: "router", component: OpenRouterMono, currentColor: "#6566f1" };
  if (includesAny(haystack, ["zhipu", "bigmodel", "智谱"])) return { brand: "zhipu", component: ZhipuColor };
  if (includesAny(haystack, ["glm"])) return { brand: "chatglm", component: ChatGLMColor };
  if (includesAny(haystack, ["kimi"])) return { brand: "kimi", component: KimiColor };
  if (includesAny(haystack, ["moonshot"])) return { brand: "moonshot", component: MoonshotMono };
  if (includesAny(haystack, ["minimax"])) return { brand: "minimax", component: MinimaxColor };
  if (includesAny(haystack, ["siliconflow", "silicon-cloud"])) return { brand: "silicon-cloud", component: SiliconCloudColor };
  if (includesAny(haystack, ["modelscope"])) return { brand: "modelscope", component: ModelScopeColor };
  if (includesAny(haystack, ["stepfun"])) return { brand: "stepfun", component: StepfunColor };
  if (includesAny(haystack, ["novita"])) return { brand: "novita", component: NovitaColor };
  if (includesAny(haystack, ["qianfan", "baidu-cloud"])) return { brand: "baidu-cloud", component: BaiduCloudColor };
  if (includesAny(haystack, ["baidu", "百度"])) return { brand: "baidu", component: BaiduColor };
  if (includesAny(haystack, ["opencode"])) return { brand: "opencode", component: OpenCodeMono };
  if (includesAny(haystack, ["hermes"])) return { brand: "hermes", component: HermesAgentMono };
  if (includesAny(haystack, ["openclaw"])) return { brand: "openclaw", component: OpenClawColor };
  if (includesAny(haystack, ["pi-agent", "pi-ai", "pi-native"]) || hasToken(haystack, "pi")) return { brand: "pi", component: PiMark };
  if (includesAny(haystack, ["codex"])) return { brand: "codex", component: CodexColor };
  if (includesAny(haystack, ["claude-code"])) return { brand: "claude-code", component: ClaudeCodeColor };
  if (includesAny(haystack, ["anthropic", "claude"])) return { brand: "claude", component: ClaudeColor };
  if (includesAny(haystack, ["openai", "chatgpt", "gpt"])) return { brand: "openai", component: OpenAIMono };
  if (includesAny(haystack, ["native", "oauth", "account"])) return { brand: "native", component: OpenAIMono };
  return { brand: normalizeToken(providerId || provider?.id || providerName || provider?.name) || "provider", placeholder: true };
}

function normalizeToken(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[_./:]+/g, "-");
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function hasToken(value: string, token: string): boolean {
  return value.split(/[\s-]+/g).includes(token);
}

function PiMark(props: { className?: string; size?: number | string; style?: CSSProperties }) {
  const size = props.size ?? "1em";
  return (
    <svg
      className={props.className}
      height={size}
      style={{ flex: "none", lineHeight: 1, ...props.style }}
      viewBox="0 0 800 800"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Pi</title>
      <path
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      <path d="M517.36 400H634.72V634.72H517.36Z" fill="currentColor" />
    </svg>
  );
}
