import type { CapabilityManifest, ToolDefinition, ToolSpec } from "../../core.js";
import type { ComputerEnvironmentAdapter } from "../../environment/computer-adapter.js";
import {
  createComputerObserveTool,
  createComputerRequestActionTool,
} from "../../tools/computer.js";
import manifestJson from "./manifest.json" with { type: "json" };

export const computerUseCapability = manifestJson as unknown as CapabilityManifest;

export function createComputerUseTools(adapter: ComputerEnvironmentAdapter): ToolDefinition[] {
  const specs = new Map(computerUseCapability.tools.map((tool) => [tool.id, tool]));

  return [
    createComputerObserveTool(requireToolSpec(specs, "computer.observe"), adapter),
    createComputerRequestActionTool(requireToolSpec(specs, "computer.requestAction"), adapter),
  ];
}

function requireToolSpec(specs: Map<string, ToolSpec>, id: string): ToolSpec {
  const spec = specs.get(id);
  if (!spec) {
    throw new Error(`Missing tool spec in computer use capability: ${id}`);
  }
  return spec;
}
