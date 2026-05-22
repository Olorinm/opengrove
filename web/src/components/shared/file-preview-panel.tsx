import { FileText, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import DocViewer, { DocViewerRenderers } from "@cyntler/react-doc-viewer";
import "@cyntler/react-doc-viewer/dist/index.css";
import { MarkdownPreview } from "../knowledge/markdown-preview";

export type PreviewableFile = {
  name: string;
  path: string;
  mimeType?: string;
  content?: string;
  contentTruncated?: boolean;
};

export function FilePreviewPanel(props: {
  file: PreviewableFile | undefined;
  loading: boolean;
  rawUrl?: string;
  selectedPath: string;
}) {
  const mimeType = props.file?.mimeType || "";
  const isMarkdown = /markdown/i.test(mimeType) || /\.(md|markdown|mdx)$/i.test(props.selectedPath);
  const isText = mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("yaml");
  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/") || /\.(mp4|webm|ogg|mov|m4v)$/i.test(props.selectedPath);
  const isAudio = mimeType.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|oga)$/i.test(props.selectedPath);
  const canUseDocViewer = Boolean(props.file && props.rawUrl && !isMarkdown && docViewerCanRender(mimeType, props.selectedPath));

  if (!props.selectedPath) {
    return (
      <PreviewEmpty icon={<FileText size={22} />} title="左侧选择文件" copy="图片、视频、音频、PDF、CSV、Markdown 和文本会在这里预览。" />
    );
  }

  if (props.loading) {
    return <PreviewEmpty icon={<Loader2 size={20} />} title="读取文件" />;
  }

  if (!props.file) {
    return <PreviewEmpty icon={<FileText size={20} />} title="文件不可用" />;
  }

  if (isMarkdown || isText) {
    return (
      <div className="file-preview-markdown-shell">
        <MarkdownPreview text={props.file.content ?? ""} format={isMarkdown ? "markdown" : "text"} />
        {props.file.contentTruncated ? <div className="file-preview-truncated">文件过大，已截断预览。</div> : null}
      </div>
    );
  }

  if (props.rawUrl && isImage) {
    return (
      <div className="file-preview-media-frame">
        <img className="file-preview-media" src={props.rawUrl} alt={props.file.name} />
      </div>
    );
  }

  if (props.rawUrl && isVideo) {
    return (
      <div className="file-preview-media-frame">
        <video className="file-preview-media" src={props.rawUrl} controls preload="metadata" />
      </div>
    );
  }

  if (props.rawUrl && isAudio) {
    return (
      <div className="file-preview-audio-frame">
        <audio src={props.rawUrl} controls />
      </div>
    );
  }

  if (canUseDocViewer && props.rawUrl) {
    return (
      <div className="file-preview-doc-viewer">
        <DocViewer
          documents={[{
            uri: props.rawUrl,
            fileName: props.file.name,
            fileType: fileExtension(props.selectedPath),
          }]}
          pluginRenderers={DocViewerRenderers}
          prefetchMethod="GET"
          config={{
            header: {
              disableHeader: true,
              disableFileName: true,
              retainURLParams: true,
            },
          }}
        />
      </div>
    );
  }

  return <PreviewEmpty icon={<FileText size={20} />} title="暂不支持预览" copy={props.file.mimeType || props.file.name} />;
}

function PreviewEmpty(props: { icon: ReactNode; title: string; copy?: string }) {
  return (
    <div className="file-preview-empty mounted-app-preview-empty">
      {props.icon}
      <strong>{props.title}</strong>
      {props.copy ? <p>{props.copy}</p> : null}
    </div>
  );
}

function docViewerCanRender(mimeType: string, path: string): boolean {
  const extension = fileExtension(path);
  if (mimeType === "application/pdf") return true;
  if (mimeType.includes("csv")) return true;
  return ["pdf", "csv"].includes(extension);
}

function fileExtension(path: string): string {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}
