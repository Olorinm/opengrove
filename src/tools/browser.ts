import type { JsonObject, ToolDefinition, ToolSpec } from "../core.js";

export interface BrowserPageSnapshot {
  url?: string;
  title?: string;
  selection?: string;
  visibleText?: string;
  locator?: string;
  vaultFile?: BrowserVaultFileSnapshot;
  attachments?: BrowserPageAttachmentSnapshot[];
}

export interface BrowserVaultFileSnapshot {
  knowledgeId?: string;
  vaultPath?: string;
  filePath?: string;
}

export interface BrowserPageAttachmentSnapshot {
  id?: string;
  name: string;
  kind: "image" | "text" | "file";
  mimeType?: string;
  size?: number;
  text?: string;
  dataUrl?: string;
  localPath?: string;
}

export type BrowserPageReader = () => BrowserPageSnapshot | Promise<BrowserPageSnapshot>;

export function createBrowserReadSelectionTool(
  spec: ToolSpec,
  readPage: BrowserPageReader,
): ToolDefinition<JsonObject, JsonObject> {
  return {
    spec,
    async execute() {
      const page = await readPage();
      const value: JsonObject = {
        url: page.url ?? "",
        title: page.title ?? "",
        selection: page.selection ?? "",
        visibleText: page.visibleText ?? "",
        locator: page.locator ?? "",
      };

      return {
        ok: true,
        value,
        sources: [
          {
            title: page.title,
            url: page.url,
            locator: page.locator,
            quote: page.selection,
          },
        ],
      };
    },
  };
}
