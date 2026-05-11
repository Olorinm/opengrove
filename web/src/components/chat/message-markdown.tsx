import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { Download, Maximize2, PackagePlus, Pencil, Play, Sparkles } from "lucide-react";
import type { SkillRecord } from "../../bridge";
import { summarize } from "../../format";
import type { ChatImagePayload } from "./message-types";

export function ThreadTextBlock(props: {
  text: string;
  skills?: SkillRecord[];
  onTrySkill?(skillName: string): void;
  onEditSkill?(skillName: string): void;
  onPreviewImage?(image: ChatImagePayload): void;
  onSaveImageArtifact?(image: ChatImagePayload): void;
}) {
  const createdSkills = extractCreatedSkillCards(props.text, props.skills ?? []);

  return (
    <div className="thread-text-block tone-plain">
      {renderMarkdownBlocks(String(props.text || ""), {
        onPreviewImage: props.onPreviewImage,
        onSaveImageArtifact: props.onSaveImageArtifact,
      })}
      {createdSkills.length ? (
        <div className="thread-skill-created-list">
          {createdSkills.map((skill) => (
            <SkillCreatedCard
              key={skill.name}
              skill={skill}
              onTrySkill={props.onTrySkill}
              onEditSkill={props.onEditSkill}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RenderedImageBlock(props: {
  image: ChatImagePayload;
  onPreview?(image: ChatImagePayload): void;
  onSaveArtifact?(image: ChatImagePayload): void;
}) {
  const fileName = fileNameFromImageSrc(props.image.src);
  const openPreview = (event: MouseEvent | PointerEvent) => {
    event.preventDefault();
    props.onPreview?.(props.image);
  };
  return (
    <figure className="thread-image-figure">
      <div className="thread-image-frame">
        <button
          type="button"
          className="thread-image-preview-button"
          onClick={openPreview}
          onPointerDown={openPreview}
          aria-label={`预览图片 ${props.image.alt || fileName}`}
        >
          <img className="thread-rendered-image" src={props.image.src} alt={props.image.alt} />
        </button>
        <span className="thread-image-action-buttons">
          <button
            type="button"
            className="thread-image-action"
            onClick={openPreview}
            onPointerDown={openPreview}
            aria-label={`预览 ${props.image.alt || fileName}`}
            title="预览"
          >
            <Maximize2 size={13} />
          </button>
          <a className="thread-image-action" href={props.image.src} download={fileName} aria-label={`下载 ${props.image.alt || fileName}`} title="下载">
            <Download size={13} />
          </a>
          <button
            type="button"
            className="thread-image-action"
            onClick={() => props.onSaveArtifact?.(props.image)}
            aria-label={`存到成果 ${props.image.alt || fileName}`}
            title="存到成果"
          >
            <PackagePlus size={13} />
          </button>
        </span>
      </div>
      <figcaption className="thread-image-caption">
        {props.image.alt || fileName}
      </figcaption>
    </figure>
  );
}

function renderMarkdownBlocks(
  text: string,
  options: {
    onPreviewImage?(image: ChatImagePayload): void;
    onSaveImageArtifact?(image: ChatImagePayload): void;
  },
): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  const pushParagraph = (paragraphLines: string[], key: string) => {
    const content = paragraphLines.join("\n").trim();
    if (!content) {
      return;
    }
    blocks.push(
      <p className="thread-md-p" key={key}>
        {renderInlineMarkdown(content)}
      </p>,
    );
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <div className="thread-code-block" key={`code-${index}`}>
          {lang ? <div className="thread-code-lang">{lang}</div> : null}
          <pre>
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>,
      );
      continue;
    }

    const image = imageFromMarkdownLine(line);
    if (image) {
      blocks.push(
        <RenderedImageBlock
          key={`${image.src}-${index}`}
          image={image}
          onPreview={options.onPreviewImage}
          onSaveArtifact={options.onSaveImageArtifact}
        />,
      );
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const className = `thread-md-heading level-${level}`;
      const content = renderInlineMarkdown(heading[2].trim());
      blocks.push(
        level === 1 ? (
          <h2 className={className} key={`heading-${index}`}>
            {content}
          </h2>
        ) : (
          <h3 className={className} key={`heading-${index}`}>
            {content}
          </h3>
        ),
      );
      index += 1;
      continue;
    }

    if (isListLine(line)) {
      const ordered = isOrderedListLine(line);
      const start = ordered ? Number(line.match(/^\s*(\d+)[.)]\s+/)?.[1] || 1) : undefined;
      const items: string[] = [];
      while (index < lines.length && isListLine(lines[index]) && isOrderedListLine(lines[index]) === ordered) {
        items.push(lines[index].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, "").trim());
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag className="thread-md-list" start={ordered ? start : undefined} key={`list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !imageFromMarkdownLine(lines[index]) &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !isListLine(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    pushParagraph(paragraphLines, `p-${index}`);
  }

  return blocks.length ? blocks : [<p className="thread-md-p" key="empty">{text}</p>];
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[\s\S]+?\*\*)|(\[[^\]]+]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    const value = match[0];
    const key = `${match.index}-${value}`;
    if (value.startsWith("`")) {
      const codeText = value.slice(1, -1);
      const fileLink = fileLinkDisplay(codeText, codeText);
      nodes.push(
        fileLink ? (
          <span className="thread-md-file-link" title={fileLink.title} aria-label={fileLink.title} key={key}>
            <span className="thread-md-file-name">{fileLink.name}</span>
            {fileLink.line ? <span className="thread-md-file-line">(line {fileLink.line})</span> : null}
          </span>
        ) : (
          <code className="thread-md-inline-code" key={key}>
            {codeText}
          </code>
        ),
      );
    } else if (value.startsWith("**")) {
      nodes.push(
        <strong key={key}>
          {renderInlineMarkdown(value.slice(2, -2))}
        </strong>,
      );
    } else {
      const link = value.match(/^\[([^\]]+)]\(([^)]+)\)$/);
      const label = link?.[1] || value;
      const href = link?.[2] || "";
      nodes.push(renderMarkdownLink(label, href, key));
    }
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function renderMarkdownLink(label: string, href: string, key: string): ReactNode {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a className="thread-md-link" href={href} target="_blank" rel="noreferrer" key={key}>
        {label}
      </a>
    );
  }
  const fileLink = fileLinkDisplay(label, href);
  if (fileLink) {
    return (
      <span className="thread-md-file-link" title={fileLink.title} aria-label={fileLink.title} key={key}>
        <span className="thread-md-file-name">{fileLink.name}</span>
        {fileLink.line ? <span className="thread-md-file-line">(line {fileLink.line})</span> : null}
      </span>
    );
  }
  return (
    <span className="thread-md-file-link" title={href} key={key}>
      {label}
    </span>
  );
}

type FileLinkDisplay = {
  name: string;
  line: string;
  title: string;
};

function fileLinkDisplay(label: string, href: string): FileLinkDisplay | null {
  const rawHref = href.trim().replace(/^<(.+)>$/, "$1");
  const decodedHref = decodeSafe(rawHref);
  const labelLine = label.match(/\b(?:line|行)\s*(\d+)\b/i)?.[1] || "";
  const hrefLine = decodedHref.match(/(?::|#L)(\d+)(?::\d+)?$/i)?.[1] || "";
  const line = labelLine || hrefLine;
  const hrefPath = decodedHref
    .replace(/#L\d+(?::\d+)?$/i, "")
    .replace(/:\d+(?::\d+)?$/, "");
  const cleanLabel = label
    .replace(/\s*\((?:line|行)\s*\d+\)\s*$/i, "")
    .replace(/\s*[-–—]\s*(?:line|行)\s*\d+\s*$/i, "")
    .replace(/:\d+(?::\d+)?$/, "")
    .trim();
  const name = fileBasename(cleanLabel) || fileBasename(hrefPath);
  if (!name || !looksLikeFileLink(name, hrefPath)) {
    return null;
  }
  return {
    name,
    line,
    title: line ? `${hrefPath || cleanLabel}:${line}` : hrefPath || cleanLabel || name,
  };
}

function fileBasename(value: string): string {
  const normalized = value.trim().replace(/^<(.+)>$/, "$1").replace(/\\/g, "/");
  const withoutQuery = normalized.split(/[?#]/)[0] || normalized;
  return withoutQuery.split("/").filter(Boolean).at(-1) || "";
}

function fileExtension(name: string): string {
  const match = name.match(/\.([A-Za-z][A-Za-z0-9]{0,7})$/);
  return match?.[1]?.toLowerCase() || "";
}

function looksLikeFileLink(name: string, hrefPath: string): boolean {
  return Boolean(
    fileExtension(name)
    || hrefPath.startsWith("/")
    || hrefPath.startsWith(".")
    || hrefPath.includes("/")
    || hrefPath.includes("\\"),
  );
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function isOrderedListLine(line: string): boolean {
  return /^\s*\d+[.)]\s+/.test(line);
}

function imageFromMarkdownLine(line: string): ChatImagePayload | null {
  const match = line.trim().match(/^!\[([^\]]*)]\(([^)\s]+)\)$/);
  const src = match?.[2]?.trim() || "";
  if (!src || !isSafeRenderableImageSrc(src)) {
    return null;
  }
  return {
    alt: match?.[1]?.trim() || "generated image",
    src,
  };
}

function SkillCreatedCard(props: {
  skill: CreatedSkillCard;
  onTrySkill?(skillName: string): void;
  onEditSkill?(skillName: string): void;
}) {
  return (
    <section className="thread-created-skill-card">
      <div className="thread-created-skill-icon" aria-hidden="true">
        <Sparkles size={16} />
      </div>
      <div className="thread-created-skill-body">
        <div className="thread-created-skill-kicker">能力已安装</div>
        <div className="thread-created-skill-title">{props.skill.title || props.skill.name}</div>
        <div className="thread-created-skill-meta">
          /{props.skill.name}
          {props.skill.source ? ` · ${props.skill.source === "user" ? "个人能力" : props.skill.source}` : ""}
          {props.skill.entry ? ` · ${props.skill.entry}` : ""}
        </div>
        {props.skill.description ? (
          <div className="thread-created-skill-description">{summarize(props.skill.description, 150)}</div>
        ) : null}
      </div>
      <div className="thread-created-skill-actions">
        <button type="button" className="thread-image-action primary" onClick={() => props.onTrySkill?.(props.skill.name)}>
          <Play size={13} />
          试用
        </button>
        <button type="button" className="thread-image-action" onClick={() => props.onEditSkill?.(props.skill.name)}>
          <Pencil size={13} />
          编辑
        </button>
      </div>
    </section>
  );
}

interface CreatedSkillCard {
  name: string;
  title: string;
  description: string;
  entry: string;
  source: string;
}

function extractCreatedSkillCards(text: string, skills: SkillRecord[]): CreatedSkillCard[] {
  const content = String(text || "");
  if (!/(已创建|已安装|安装到|安装到了|created|installed|Skill is valid)/i.test(content)) {
    return [];
  }

  const names = uniqueStrings(
    [...content.matchAll(/(?:^|[~\w/.-])\.codex\/skills\/([A-Za-z0-9][A-Za-z0-9_-]*)/g)]
      .map((match) => match[1])
      .concat([...content.matchAll(/\[([A-Za-z0-9][A-Za-z0-9_-]*)\]\([^)]*\.codex\/skills\/\1(?:[)/]|%2F)/g)].map((match) => match[1])),
  );

  return names.map((name) => {
    const manifest = skills.find((skill) => skill?.name === name || skill?.id === `skill.${name}` || skill?.id === name);
    return {
      name,
      title: manifest?.title || titleFromSkillName(name),
      description: manifest?.description || "",
      entry: manifest?.entry || manifest?.skillRoot || "",
      source: manifest?.source || "",
    };
  });
}

function titleFromSkillName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function fileNameFromImageSrc(src: string): string {
  try {
    const url = new URL(src, window.location.origin);
    const name = url.pathname.split("/").filter(Boolean).at(-1);
    return name || "image";
  } catch {
    return "image";
  }
}

function isSafeRenderableImageSrc(src: string): boolean {
  return (
    src.startsWith("/generated/") ||
    src.startsWith("data:image/") ||
    /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(src)
  );
}
