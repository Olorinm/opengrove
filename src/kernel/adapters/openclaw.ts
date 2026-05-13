import { createRuntimeKernelAdapter } from "../adapter.js";
import type { KernelAdapter, KernelAdapterContract, KernelCapabilities } from "../types.js";
import { APP_PRODUCT_NAME, APP_PROTOCOL_ID } from "../../identity.js";
import {
  OpenClawGatewayRuntime,
  type OpenClawGatewayRuntimeOptions,
} from "../../runtime/openclaw-gateway-runtime.js";

const OPENCLAW_GATEWAY_CAPABILITIES: KernelCapabilities = {
  streaming: true,
  toolCalls: true,
  hostTools: false,
  approvals: true,
  elicitation: false,
  artifacts: true,
  compaction: false,
  authRefresh: false,
  sandbox: ["danger-full-access"],
  knowledge: {
    nativeSkills: true,
    toolMediatedSkills: false,
    progressiveDisclosure: true,
    nativeArtifacts: false,
    deliveryLedger: true,
  },
};

export function createOpenClawGatewayKernelAdapter(options: OpenClawGatewayRuntimeOptions): KernelAdapter {
  return createRuntimeKernelAdapter({
    id: "openclaw",
    title: "OpenClaw",
    runtime: new OpenClawGatewayRuntime(options),
    capabilities: OPENCLAW_GATEWAY_CAPABILITIES,
    contract: OPENCLAW_GATEWAY_CONTRACT,
  });
}

export const OPENCLAW_GATEWAY_CONTRACT: KernelAdapterContract = {
  ownership: [
    {
      feature: "session",
      owner: "shared",
      nativeName: "OpenClaw Gateway sessionKey",
      appResponsibility: "Own OpenGrove room/session ids and normalized trajectory records.",
      adapterResponsibility: "Bind OpenGrove turns to an OpenClaw Gateway sessionKey and run id.",
      kernelResponsibility: "Own OpenClaw's native transcript, agent config, and session store.",
    },
    {
      feature: "turn_lifecycle",
      owner: "adapter",
      nativeName: "chat.send / agent.wait",
      adapterResponsibility: "Submit chat.send over WebSocket, wait with agent.wait, and normalize agent events.",
      kernelResponsibility: "Run the OpenClaw model/tool loop inside the Gateway.",
    },
    {
      feature: "model_loop",
      owner: "kernel",
      kernelResponsibility: "Own provider selection, native tools, skills, memory, and delivery behavior configured in OpenClaw.",
      adapterResponsibility: "Do not parse raw CLI JSON or reimplement OpenClaw internals.",
    },
    {
      feature: "transport",
      owner: "adapter",
      nativeName: "Gateway WebSocket",
      adapterResponsibility: "Use request/response/event frames over the persistent Gateway socket.",
    },
    {
      feature: "diagnostics",
      owner: "shared",
      appResponsibility: `Persist ${APP_PRODUCT_NAME} trajectory and redacted runtime diagnostics.`,
      kernelResponsibility: "Keep OpenClaw's native logs and Gateway transcript.",
    },
  ],
  eventMappings: [
    {
      appEvent: "assistant.delta",
      nativeEvent: "Gateway event agent/assistant",
      direction: "native_to_app",
      adapterResponsibility: "Forward assistant text only; never surface raw Gateway JSON as chat text.",
    },
    {
      appEvent: "error",
      nativeEvent: "Gateway event agent/lifecycle error or failed RPC",
      direction: "native_to_app",
      adapterResponsibility: "Map Gateway failures to concise OpenGrove error events.",
    },
  ],
  diagnostics: {
    defaultModeId: "openclaw-gateway-websocket",
    modes: [
      {
        id: "openclaw-gateway-websocket",
        title: "OpenClaw Gateway WebSocket",
        layer: "adapter-rpc",
        status: "implemented",
        enabledByDefault: true,
        redaction: "redacted",
        notes: ["Uses `chat.send`, Gateway `agent` events, `agent.wait`, and `chat.history` for final reconciliation."],
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
    ],
  },
  notes: [
    "OpenClaw is a remote/native agent surface. OpenGrove only bridges its Gateway protocol and does not keep the old one-shot CLI path.",
  ],
};
