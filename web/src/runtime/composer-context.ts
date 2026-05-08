import type { AttachmentPayload, ContextArtifactPayload, MessageContext } from "../bridge";
import { APP_PRODUCT_NAME } from "../identity";

export function createSnapshot(
  context: { text: string } | null,
  attachments: AttachmentPayload[] = [],
  vaultFile?: { knowledgeId?: string; vaultPath?: string } | null,
): Record<string, unknown> {
  const text = context?.text || "";
  const hasExplicitContext = Boolean(text.trim() || attachments.length);
  return {
    title: hasExplicitContext ? APP_PRODUCT_NAME : "",
    url: hasExplicitContext ? location.href : "",
    selection: text,
    visibleText: text,
    locator: "standalone-ui",
    vaultFile: vaultFile?.vaultPath
      ? {
          knowledgeId: vaultFile.knowledgeId,
          vaultPath: vaultFile.vaultPath,
        }
      : undefined,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
      text: attachment.kind === "text" ? attachment.text : undefined,
      dataUrl: attachment.dataUrl,
    })),
  };
}

export function buildContextPayload(
  baseText: string,
  attachments: AttachmentPayload[],
  artifacts: ContextArtifactPayload[],
): MessageContext {
  const selectedText = baseText.trim();
  const parts = [selectedText, renderArtifactContext(artifacts), renderAttachmentContext(attachments)].filter(Boolean);
  return {
    text: parts.join("\n\n"),
    selectedText,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      size: attachment.size,
      error: attachment.error,
    })),
    artifacts,
  };
}

function renderArtifactContext(artifacts: ContextArtifactPayload[]): string {
  if (!artifacts.length) {
    return "";
  }
  const lines = ["用户明确加入的产物："];
  for (const artifact of artifacts) {
    lines.push(`- ${artifact.title} (${artifact.type}, id: ${artifact.id})${artifact.summary ? `：${artifact.summary}` : ""}`);
    if (artifact.imageUri) {
      lines.push(`  图片地址：${artifact.imageUri}`);
    }
  }
  return lines.join("\n");
}

function renderAttachmentContext(attachments: AttachmentPayload[]): string {
  if (!attachments.length) {
    return "";
  }

  const lines = ["附件："];
  for (const attachment of attachments) {
    const meta = `${attachment.name} · ${attachment.mimeType || "application/octet-stream"} · ${formatBytes(attachment.size)}`;
    if (attachment.kind === "image") {
      lines.push(`- [图片] ${meta}。图片内容会作为图像输入发送给 Codex。`);
    } else if (attachment.kind === "text" && attachment.text) {
      lines.push(`- [文本文件] ${meta}\n${attachment.text}`);
    } else {
      lines.push(`- [文件] ${meta}${attachment.error ? `。${attachment.error}` : "。文件内容会保存到本地上传副本并提供给 Codex。"}`);
    }
  }
  return lines.join("\n");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
