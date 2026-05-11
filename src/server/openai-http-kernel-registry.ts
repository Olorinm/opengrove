import { appEnvName, readAppEnv } from "../identity.js";
import type { OpenAiHttpKernelDefinition } from "../kernel/adapters/openai-http.js";
import type { ProviderHttpCaptureOptions } from "../runtime/provider-http-capture.js";
import type { BridgeKernelId } from "./bridge-types.js";

export interface OpenAiHttpKernelFactoryContext {
  env?: NodeJS.ProcessEnv;
  providerHttpCapture?: ProviderHttpCaptureOptions;
}

type OpenAiHttpKernelFactory = (context: OpenAiHttpKernelFactoryContext) => OpenAiHttpKernelDefinition | undefined;

const OPENAI_HTTP_KERNEL_FACTORIES: Partial<Record<BridgeKernelId, OpenAiHttpKernelFactory>> = {
  openclaw: (context) => {
    const baseUrl = readAppEnv("OPENCLAW_API_URL")?.trim();
    if (!baseUrl) return undefined;
    return withOpenAiHttpRuntimeContext({
      id: "openclaw",
      title: "OpenClaw",
      baseUrl,
      apiKeyEnv: appEnvName("OPENCLAW_API_KEY"),
      apiKey: process.env.OPENCLAW_API_KEY?.trim(),
      model: readAppEnv("OPENCLAW_MODEL")?.trim() || "default",
      sessionMode: "stateless",
      healthPath: "/models",
      knowledgeSources: [],
      notes: ["OpenClaw connected via OpenAI-compatible HTTP gateway."],
    }, context);
  },
  hermes: (context) => {
    const baseUrl = readAppEnv("HERMES_API_URL")?.trim();
    if (!baseUrl) return undefined;
    return withOpenAiHttpRuntimeContext({
      id: "hermes",
      title: "Hermes",
      baseUrl,
      apiKeyEnv: appEnvName("HERMES_API_KEY"),
      apiKey: process.env.HERMES_API_KEY?.trim(),
      model: readAppEnv("HERMES_MODEL")?.trim() || "hermes-default",
      sessionMode: "stateless",
      healthPath: "/models",
      knowledgeSources: [],
      notes: ["Hermes connected via OpenAI-compatible HTTP gateway."],
    }, context);
  },
};

export function resolveOpenAiHttpKernelDefinition(
  kernelId: BridgeKernelId,
  context: OpenAiHttpKernelFactoryContext = {},
): OpenAiHttpKernelDefinition | undefined {
  return OPENAI_HTTP_KERNEL_FACTORIES[kernelId]?.(context);
}

function withOpenAiHttpRuntimeContext(
  definition: OpenAiHttpKernelDefinition,
  context: OpenAiHttpKernelFactoryContext,
): OpenAiHttpKernelDefinition {
  return {
    ...definition,
    providerHttpCapture: context.providerHttpCapture,
    env: { ...process.env, ...context.env },
  };
}
