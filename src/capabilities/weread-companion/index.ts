import type { CapabilityManifest, ToolDefinition, ToolSpec } from "../../core.js";
import {
  createBrowserReadSelectionTool,
  type BrowserPageReader,
} from "../../tools/browser.js";
import { createProposeReadingNoteTool, createSearchMemoryTool } from "../../tools/memory.js";
import manifestJson from "./manifest.json" with { type: "json" };

export const wereadCompanionCapability = manifestJson as unknown as CapabilityManifest;

export function createWereadCompanionTools(readPage: BrowserPageReader): ToolDefinition[] {
  const specs = new Map(wereadCompanionCapability.tools.map((tool) => [tool.id, tool]));

  return [
    createBrowserReadSelectionTool(requireToolSpec(specs, "browser.readSelection"), readPage),
    createSearchMemoryTool(requireToolSpec(specs, "memory.search")),
    createProposeReadingNoteTool(requireToolSpec(specs, "memory.proposeReadingNote")),
  ];
}

function requireToolSpec(specs: Map<string, ToolSpec>, id: string): ToolSpec {
  const spec = specs.get(id);
  if (!spec) {
    throw new Error(`Missing tool spec in weread companion capability: ${id}`);
  }
  return spec;
}
