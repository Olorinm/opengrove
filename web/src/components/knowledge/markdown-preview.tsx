import { useState, type MouseEvent, type ReactNode } from "react";
import { Download, Maximize2, Plus, X } from "lucide-react";
import { APP_VAULT_DIR } from "../../identity";

export function MarkdownPreview(props: { text: string; format: string; vaultPath?: string; onActivate?(): void; onOpenLink?(href: string): boolean }) {
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const text = props.format === "markdown" ? stripMarkdownFrontmatter(props.text) : props.text;
  if (props.format !== "markdown") {
    return (
      <pre className="markdown-preview markdown-preview-code" onClick={props.onActivate}>
        <code>{props.text || " "}</code>
      </pre>
    );
  }
  const nodes = markdownBlocks(text, props.vaultPath, setPreviewImage, props.onOpenLink);
  return (
    <>
      <div className="markdown-preview" data-click-to-edit="true" onClick={props.onActivate}>
        {nodes.length ? nodes : <p className="markdown-empty">空白页面</p>}
      </div>
      {previewImage ? (
        <div className="markdown-image-lightbox" role="dialog" aria-modal="true" aria-label={previewImage.alt || "图片预览"} onClick={() => setPreviewImage(null)}>
          <div className="markdown-image-lightbox-panel" onClick={(event) => event.stopPropagation()}>
            <div className="markdown-image-lightbox-actions">
              <a className="markdown-image-action" href={previewImage.src} download={fileNameFromAssetUri(previewImage.src) || undefined} aria-label="保存图片" title="保存图片">
                <Download size={17} />
              </a>
              <button className="markdown-image-action" type="button" aria-label="关闭预览" title="关闭预览" onClick={() => setPreviewImage(null)}>
                <X size={17} />
              </button>
            </div>
            <img src={previewImage.src} alt={previewImage.alt || "图片预览"} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MarkdownProperties(props: {
  properties: MarkdownProperty[];
  recommendations: MarkdownPropertyDefinition[];
  onActivate?(): void;
  onAddProperty(property: MarkdownPropertyDefinition): void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!props.properties.length && !props.recommendations.length) return null;

  function togglePicker(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPickerOpen((current) => !current);
  }

  function addProperty(event: MouseEvent<HTMLButtonElement>, property: MarkdownPropertyDefinition) {
    event.stopPropagation();
    props.onAddProperty(property);
    setPickerOpen(false);
  }

  return (
    <section className="md-properties" aria-label="笔记属性">
      <div className="md-properties-title">笔记属性</div>
      <div className="md-properties-list">
        {props.properties.map((property) => (
          <button className="md-property-row" key={property.key} type="button" onClick={props.onActivate}>
            <span className="md-property-icon" aria-hidden="true" />
            <span className="md-property-key">{property.key}</span>
            <span className="md-property-value">{formatMarkdownPropertyValue(property.value)}</span>
          </button>
        ))}
        <button
          className="md-add-property"
          type="button"
          onClick={togglePicker}
          disabled={!props.recommendations.length}
          title={props.recommendations.length ? "添加当前类型推荐属性" : "当前类型的推荐属性已完整"}
        >
          <Plus size={15} />
          {props.recommendations.length ? "添加推荐属性" : "属性已完整"}
        </button>
        {pickerOpen && props.recommendations.length ? (
          <div className="md-property-recommendations" role="menu" aria-label="推荐属性">
            {props.recommendations.map((property) => (
              <button
                className="md-property-recommendation"
                key={property.key}
                type="button"
                role="menuitem"
                onClick={(event) => addProperty(event, property)}
              >
                <span>{property.key}</span>
                <small>{property.description}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export type MarkdownProperty = { key: string; value: string | string[] };
export type MarkdownPropertyValue = string | string[] | boolean | number;
export type MarkdownPropertyDefinition = {
  key: string;
  description: string;
  value: MarkdownPropertyValue;
};

export function parseMarkdownFrontmatter(text: string): { properties: MarkdownProperty[]; body: string } | undefined {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return undefined;
  const raw = normalized.slice(4, end);
  const properties: MarkdownProperty[] = [];
  let current: MarkdownProperty | undefined;
  for (const line of raw.split("\n")) {
    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && current) {
      current.value = Array.isArray(current.value)
        ? [...current.value, cleanYamlScalar(listItem[1])]
        : [String(current.value), cleanYamlScalar(listItem[1])].filter(Boolean);
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    current = {
      key: match[1],
      value: cleanYamlScalar(match[2] || ""),
    };
    properties.push(current);
  }
  return {
    properties: properties.filter((property) =>
      Array.isArray(property.value) ? property.value.length > 0 : Boolean(String(property.value).trim()),
    ),
    body: normalized.slice(end + 5),
  };
}

export function recommendedMarkdownProperties(
  document: any,
  vaultPath: string,
  properties: MarkdownProperty[],
): MarkdownPropertyDefinition[] {
  const existing = new Set(properties.map((property) => canonicalPropertyKey(property.key)));
  const definitions = markdownPropertyDefinitionsForDocument(document, vaultPath);
  return definitions.filter((property) => !existing.has(canonicalPropertyKey(property.key)));
}

export function insertMarkdownFrontmatterProperty(text: string, property: MarkdownPropertyDefinition): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const entry = formatMarkdownFrontmatterEntry(property);
  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---\n", 4);
    if (end >= 0) {
      const before = normalized.slice(0, end).replace(/\s+$/, "");
      return `${before}\n${entry}${normalized.slice(end)}`;
    }
  }
  return `---\n${entry}\n---\n\n${normalized}`;
}

export function stripMarkdownFrontmatter(text: string): string {
  return parseMarkdownFrontmatter(text)?.body.trimStart() ?? text;
}

export function vaultFileDisplayTitle(fileName: string | undefined, fallback: string): string {
  const name = String(fileName || "").trim();
  if (!name) return fallback;
  return name.replace(/\.(md|markdown|mdx|txt|json|ya?ml)$/i, "") || fallback;
}

function cleanYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function formatMarkdownPropertyValue(value: string | string[]): string {
  return Array.isArray(value) ? value.join(", ") : value;
}

function markdownPropertyDefinitionsForDocument(document: any, vaultPath: string): MarkdownPropertyDefinition[] {
  const path = String(vaultPath || "");
  const type = String(document?.type || "");
  const isSkill = type === "skill" || path.startsWith("skills/");
  if (isSkill) {
    return [
      { key: "when_to_use", description: "什么时候应该触发这个 skill", value: "" },
      { key: "allowed-tools", description: "这个 skill 允许或建议配合的工具", value: [] },
      { key: "activities", description: "适用场景，例如 browser / computer / coding", value: [] },
      { key: "user-invocable", description: "用户是否可以手动调用", value: true },
      { key: "disable-model-invocation", description: "是否禁止模型主动调用", value: false },
      { key: "references", description: "渐进加载的参考文件路径", value: [] },
      { key: "native_publish", description: "同步到哪些内核原生 skill 目录", value: [] },
    ];
  }
  if (type === "artifact_ref" || path.startsWith("artifacts/")) {
    return [
      { key: "artifact_type", description: "产物类型，例如 image / file / snapshot", value: "" },
      { key: "version", description: "产物版本号", value: 1 },
      { key: "created_by", description: "模型、工具、用户或导入来源", value: "" },
      { key: "source_run", description: "生成它的 run 或对话回合", value: "" },
      { key: "derived_from", description: "派生自哪些产物或来源", value: [] },
      { key: "status", description: "draft / generated / selected / deprecated", value: "generated" },
    ];
  }
  if (type === "memory" || path.startsWith("memories/")) {
    return [
      { key: "memory_type", description: "preference / fact / correction / project_rule", value: "" },
      { key: "scope", description: "global / project / thread / page", value: document?.scope || "project" },
      { key: "confidence", description: "可信度，0 到 1", value: typeof document?.confidence === "number" ? document.confidence : 0.6 },
      { key: "last_used", description: "最近一次被引用的时间", value: "" },
      { key: "feedback", description: "用户反馈记录", value: [] },
    ];
  }
  return [
    { key: "summary", description: "一句话说明这个页面", value: "" },
    { key: "status", description: "draft / active / archived / stale", value: document?.lifecycle || "active" },
    { key: "source", description: "来源：聊天、网页、文件、工具或用户创建", value: "" },
    { key: "tags", description: "用户可维护标签", value: [] },
  ];
}

function canonicalPropertyKey(key: string): string {
  return key.trim().toLowerCase().replace(/-/g, "_");
}

function formatMarkdownFrontmatterEntry(property: MarkdownPropertyDefinition): string {
  const value = property.value;
  if (Array.isArray(value)) {
    return value.length
      ? `${property.key}:\n${value.map((item) => `  - ${yamlFrontmatterScalar(item)}`).join("\n")}`
      : `${property.key}: []`;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return `${property.key}: ${String(value)}`;
  }
  return `${property.key}: ${yamlFrontmatterScalar(value)}`;
}

function yamlFrontmatterScalar(value: string): string {
  const text = String(value ?? "");
  if (!text) return "\"\"";
  return /^[\w\u4e00-\u9fff .,:/@+-]+$/.test(text) ? text : JSON.stringify(text);
}

function markdownBlocks(
  text: string,
  vaultPath?: string,
  onImageOpen?: (image: { src: string; alt: string }) => void,
  onOpenLink?: (href: string) => boolean,
): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const imageBlock = line.trim().match(/^!\[([^\]]*)]\(([^)]+)\)$/);
    if (imageBlock) {
      const alt = imageBlock[1] || "";
      const src = resolveMarkdownImageHref(imageBlock[2] || "", vaultPath);
      blocks.push(<MarkdownPreviewImage alt={alt} key={`image-${index}`} onOpen={onImageOpen} src={src} />);
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="markdown-code-block" key={`code-${index}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      blocks.push(renderMarkdownHeading(level, heading[2], `heading-${index}`, vaultPath, onImageOpen, onOpenLink));
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(<li key={`li-${index}`}>{renderInlineMarkdown(lines[index].replace(/^\s*[-*]\s+/, ""), vaultPath, onImageOpen, onOpenLink)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(<li key={`oli-${index}`}>{renderInlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, ""), vaultPath, onImageOpen, onOpenLink)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quoteLines.map((item, itemIndex) => <p key={itemIndex}>{renderInlineMarkdown(item, vaultPath, onImageOpen, onOpenLink)}</p>)}</blockquote>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(paragraph.join(" "), vaultPath, onImageOpen, onOpenLink)}</p>);
  }

  return blocks;
}

function renderMarkdownHeading(
  level: number,
  text: string,
  key: string,
  vaultPath?: string,
  onImageOpen?: (image: { src: string; alt: string }) => void,
  onOpenLink?: (href: string) => boolean,
): ReactNode {
  const content = renderInlineMarkdown(text, vaultPath, onImageOpen, onOpenLink);
  if (level === 1) return <h1 key={key}>{content}</h1>;
  if (level === 2) return <h2 key={key}>{content}</h2>;
  if (level === 3) return <h3 key={key}>{content}</h3>;
  if (level === 4) return <h4 key={key}>{content}</h4>;
  if (level === 5) return <h5 key={key}>{content}</h5>;
  return <h6 key={key}>{content}</h6>;
}

function isMarkdownBlockStart(line: string): boolean {
  return /^(```|#{1,6}\s+|\s*[-*]\s+|\s*\d+\.\s+|>\s?)/.test(line);
}

function renderInlineMarkdown(
  text: string,
  vaultPath?: string,
  onImageOpen?: (image: { src: string; alt: string }) => void,
  onOpenLink?: (href: string) => boolean,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(!\[[^\]]*]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+]]|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("![")) {
      const image = token.match(/^!\[([^\]]*)]\(([^)]+)\)$/);
      const alt = image?.[1] || "";
      const src = resolveMarkdownImageHref(image?.[2] || "", vaultPath);
      nodes.push(<MarkdownPreviewImage alt={alt} inline key={`image-${match.index}`} onOpen={onImageOpen} src={src} />);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={`code-${match.index}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[[")) {
      const wikiLink = parseWikiLinkToken(token);
      nodes.push(renderMarkdownLink(wikiLink.label, wikiLink.href, `wikilink-${match.index}`, onOpenLink));
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link?.[2] || "";
      nodes.push(renderMarkdownLink(link?.[1] || href, href, `link-${match.index}`, onOpenLink));
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderMarkdownLink(label: string, href: string, key: string, onOpenLink?: (href: string) => boolean): ReactNode {
  const external = isExternalHref(href);
  function open(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (onOpenLink?.(href)) {
      event.preventDefault();
    }
  }
  return (
    <a href={href || "#"} key={key} rel="noreferrer" target={external ? "_blank" : undefined} onClick={open}>
      {label || href}
    </a>
  );
}

function parseWikiLinkToken(token: string): { href: string; label: string } {
  const content = token.slice(2, -2).trim();
  const [href, label] = content.split("|");
  const cleanHref = href.trim();
  return {
    href: cleanHref,
    label: (label || cleanHref.split("/").filter(Boolean).pop() || cleanHref).trim(),
  };
}

function MarkdownPreviewImage(props: { src: string; alt: string; inline?: boolean; onOpen?(image: { src: string; alt: string }): void }) {
  const fileName = fileNameFromAssetUri(props.src) || "image";
  function stop(event: MouseEvent) {
    event.stopPropagation();
  }
  function open(event: MouseEvent) {
    event.stopPropagation();
    props.onOpen?.({ src: props.src, alt: props.alt });
  }

  return (
    <span className="markdown-image-block" data-inline={props.inline ? "true" : "false"}>
      <button className="markdown-image-preview-button" type="button" onClick={open} aria-label={`放大图片 ${props.alt || fileName}`}>
        <img alt={props.alt} className="markdown-preview-image" loading="lazy" src={props.src} />
      </button>
      <span className="markdown-image-actions" onClick={stop}>
        <button className="markdown-image-action" type="button" onClick={open} aria-label={`放大图片 ${props.alt || fileName}`} title="放大">
          <Maximize2 size={16} />
        </button>
        <a className="markdown-image-action" href={props.src} download={fileName} aria-label={`保存图片 ${props.alt || fileName}`} title="保存" onClick={stop}>
          <Download size={16} />
        </a>
      </span>
    </span>
  );
}

function resolveMarkdownImageHref(href: string, vaultPath?: string): string {
  const trimmed = href.trim().replace(/^<|>$/g, "");
  if (!trimmed) return "";
  if (/^(?:https?:|data:|blob:|#)/i.test(trimmed) || trimmed.startsWith("/generated/") || trimmed.startsWith("/vault-file/")) {
    return trimmed;
  }

  const normalizedInput = trimmed.replace(/\\/g, "/");
  const vaultMarker = `/data/${APP_VAULT_DIR}/`;
  const markerIndex = normalizedInput.indexOf(vaultMarker);
  const relativeInput = markerIndex >= 0 ? normalizedInput.slice(markerIndex + vaultMarker.length) : normalizedInput.replace(/^\/+/, "");
  const baseDir = vaultPath && !relativeInput.startsWith("/")
    ? vaultPath.split("/").slice(0, -1).join("/")
    : "";
  const normalized = normalizeVaultRoutePath([baseDir, relativeInput].filter(Boolean).join("/"));
  return normalized ? `/vault-file/${normalized.split("/").map(encodeURIComponent).join("/")}` : trimmed;
}

function normalizeVaultRoutePath(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function fileNameFromAssetUri(uri: string): string {
  const text = String(uri || "");
  if (!text) return "";
  try {
    const url = new URL(text, window.location.origin);
    const part = url.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(part);
  } catch {
    return text.split("/").filter(Boolean).pop() || "";
  }
}
