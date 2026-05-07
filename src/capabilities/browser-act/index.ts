import type { CapabilityManifest, ToolDefinition, ToolSpec } from "../../core.js";
import type { BrowserEnvironmentAdapter } from "../../environment/browser-adapter.js";
import {
  createBrowserObserveTool,
  createBrowserRequestActTool,
} from "../../tools/browser-act.js";
import manifestJson from "./manifest.json" with { type: "json" };

export const browserActCapability = manifestJson as unknown as CapabilityManifest;

export function createBrowserActTools(adapter: BrowserEnvironmentAdapter): ToolDefinition[] {
  const specs = new Map(browserActCapability.tools.map((tool) => [tool.id, tool]));

  return [
    createBrowserObserveTool(requireToolSpec(specs, "browser.observe"), adapter),
    createBrowserRequestActTool(requireToolSpec(specs, "browser.requestAct"), adapter),
  ];
}

function requireToolSpec(specs: Map<string, ToolSpec>, id: string): ToolSpec {
  const spec = specs.get(id);
  if (!spec) {
    throw new Error(`Missing tool spec in browser act capability: ${id}`);
  }
  return spec;
}
