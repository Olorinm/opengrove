import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronRight, FileText, Folder, Search } from "lucide-react";
import { summarize } from "../../format";

type VaultTreeNode = {
  id: string;
  name: string;
  kind: "folder" | "file";
  path: string;
  document?: any;
  children: VaultTreeNode[];
};

export function VaultSidebarPanel(props: {
  documents: any[];
  focusedKnowledgeId: string;
  forceOpen?: boolean;
  onFocusKnowledge(knowledgeId: string): void;
}) {
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>({
    OpenGrove: true,
    "OpenGrove/skills": true,
    Codex: true,
    Claude: true,
    Hermes: true,
  });
  const tree = useMemo(() => buildVaultTree(props.documents), [props.documents]);

  function toggleNode(path: string, currentlyOpen: boolean) {
    setOpenPaths((current) => ({ ...current, [path]: !currentlyOpen }));
  }

  return (
    <section className="sidebar-library-panel" aria-label="资料库文件">
      <div className="sidebar-library-files">
        {tree.length ? (
          tree.map((node) => (
            <VaultTreeNodeView
              depth={0}
              focusedKnowledgeId={props.focusedKnowledgeId}
              forceOpen={props.forceOpen}
              key={node.id}
              node={node}
              onFocusKnowledge={props.onFocusKnowledge}
              onToggleNode={toggleNode}
              openPaths={openPaths}
            />
          ))
        ) : (
          <div className="sidebar-library-empty">这个目录里还没有文件。</div>
        )}
      </div>
    </section>
  );
}

export function WikiSidebarPanel(props: {
  documents: any[];
  filteredDocuments: any[];
  focusedKnowledgeId: string;
  query: string;
  onQueryChange(query: string): void;
  onOpenKnowledge(knowledgeId: string): void;
}) {
  const recentDocuments = useMemo(
    () => [...props.documents].filter(Boolean).sort(sortKnowledgeDocumentsForView).slice(0, 8),
    [props.documents],
  );
  const visibleDocuments = props.query.trim() ? props.filteredDocuments : recentDocuments;

  return (
    <section className="sidebar-panel-space wiki-sidebar-panel" aria-label="Wiki">
      <div className="sidebar-space-header">
        <div>
          <div className="sidebar-space-kicker">Wiki</div>
          <div className="sidebar-space-title">知识网络</div>
        </div>
        <span className="sidebar-space-count">{props.documents.length}</span>
      </div>
      <label className="wiki-jump-search">
        <Search size={14} />
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="搜索或跳转页面"
        />
      </label>
      <div className="wiki-sidebar-section-title">{props.query.trim() ? "搜索结果" : "最近页面"}</div>
      <div className="wiki-sidebar-result-list">
        {visibleDocuments.map((document) => (
          <button
            className="wiki-sidebar-result"
            data-active={document.id === props.focusedKnowledgeId ? "true" : "false"}
            key={document.id}
            type="button"
            onClick={() => props.onOpenKnowledge(document.id)}
          >
            <span className="wiki-sidebar-glyph">{knowledgeTypeGlyph(document.type)}</span>
            <span className="wiki-sidebar-result-main">
              <strong>{document.title || document.slug || document.id}</strong>
              <small>{[knowledgeTypeLabel(document.type), knowledgeDisplaySummary(document, 54)].filter(Boolean).join(" · ")}</small>
            </span>
          </button>
        ))}
        {!visibleDocuments.length ? <div className="sidebar-library-empty">没有匹配页面。</div> : null}
      </div>
    </section>
  );
}

function VaultTreeNodeView(props: {
  depth: number;
  focusedKnowledgeId: string;
  forceOpen?: boolean;
  node: VaultTreeNode;
  openPaths: Record<string, boolean>;
  onFocusKnowledge(knowledgeId: string): void;
  onToggleNode(path: string, currentlyOpen: boolean): void;
}) {
  const isFolder = props.node.kind === "folder";
  const nodeOpen = props.forceOpen || (props.openPaths[props.node.path] ?? props.depth < 1);
  const style: CSSProperties = { paddingLeft: `${7 + props.depth * 12}px` };
  if (isFolder) {
    return (
      <div className="sidebar-vault-tree-item">
        <button
          className="sidebar-library-file sidebar-tree-folder"
          style={style}
          type="button"
          onClick={() => props.onToggleNode(props.node.path, Boolean(nodeOpen))}
          aria-expanded={nodeOpen}
        >
          <ChevronRight className="sidebar-tree-chevron" size={13} data-open={nodeOpen ? "true" : "false"} />
          <Folder size={13} />
          <span>{props.node.name}</span>
        </button>
        {nodeOpen ? (
          <div className="sidebar-vault-tree-children">
            {props.node.children.map((child) => (
              <VaultTreeNodeView
                depth={props.depth + 1}
                focusedKnowledgeId={props.focusedKnowledgeId}
                forceOpen={props.forceOpen}
                key={child.id}
                node={child}
                onFocusKnowledge={props.onFocusKnowledge}
                onToggleNode={props.onToggleNode}
                openPaths={props.openPaths}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      className="sidebar-library-file sidebar-tree-file"
      data-active={props.node.document?.id === props.focusedKnowledgeId ? "true" : "false"}
      style={style}
      type="button"
      onClick={() => props.node.document?.id && props.onFocusKnowledge(props.node.document.id)}
      title={props.node.path}
    >
      <FileText size={13} />
      <span>{props.node.name}</span>
    </button>
  );
}

function buildVaultTree(documents: any[]): VaultTreeNode[] {
  const root: VaultTreeNode = { id: "vault", name: "vault", kind: "folder", path: "", children: [] };
  for (const document of documents) {
    if (!document?.id) continue;
    const path = knowledgeVaultPath(document);
    const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length) continue;
    let current = root;
    let currentPath = "";
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      let child = current.children.find((item) => item.name === segment && item.kind === (isFile ? "file" : "folder"));
      if (!child) {
        child = {
          id: isFile ? `file:${document.id}` : `folder:${currentPath}`,
          name: segment,
          kind: isFile ? "file" : "folder",
          path: currentPath,
          children: [],
        };
        current.children.push(child);
      }
      if (isFile) {
        child.document = document;
      }
      current = child;
    });
  }
  sortVaultTree(root.children);
  return root.children;
}

function sortVaultTree(nodes: VaultTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-CN");
  });
  nodes.forEach((node) => sortVaultTree(node.children));
}

function knowledgeVaultPath(document: any): string {
  const explicitVaultPath = safeVaultPath(document?.metadata?.vaultPath);
  if (explicitVaultPath) return explicitVaultPath;
  const sourceRoot = knowledgeSourceRoot(document);
  if (isSkillFileDocument(document)) {
    return `${sourceRoot}/skills/${safePathSegment(document.metadata?.skillName || document.metadata?.skillId || "skill")}/${String(document.metadata.skillFilePath || "file.md")}`;
  }
  if (document?.type === "skill") {
    return `${sourceRoot}/skills/${safePathSegment(document.metadata?.skillName || document.title || document.id)}/SKILL.md`;
  }
  if (needsKnowledgeReview(document)) {
    return `${sourceRoot}/inbox/${knowledgeFileName(document)}`;
  }
  if (document?.type === "memory") {
    return `${sourceRoot}/memories/${knowledgeFileName(document)}`;
  }
  if (document?.type === "artifact_ref") {
    return `${sourceRoot}/artifacts/${knowledgeFileName(document)}`;
  }
  if (document?.type === "project_doc") {
    return `${sourceRoot}/projects/${knowledgeFileName(document)}`;
  }
  if (document?.type === "profile") {
    return `${sourceRoot}/profiles/${knowledgeFileName(document)}`;
  }
  if (document?.type === "routine") {
    return `${sourceRoot}/routines/${knowledgeFileName(document)}`;
  }
  if (document?.type === "source") {
    return `${sourceRoot}/sources/${knowledgeFileName(document)}`;
  }
  return `${sourceRoot}/notes/${knowledgeFileName(document)}`;
}

function knowledgeSourceRoot(document: any): string {
  const metadata = document?.metadata ?? {};
  const explicit = metadata.kernelId || metadata.kernel || metadata.sourceKernel;
  if (typeof explicit === "string" && explicit.trim()) {
    return normalizeKnowledgeSourceRoot(explicit);
  }
  const haystack = [
    metadata.skillRoot,
    metadata.entry,
    metadata.sourceFilePath,
    metadata.sourceFileOriginPath,
    ...(document?.sourceRefs ?? []).map((ref: any) => ref?.locator || ""),
  ].filter(Boolean).join("\n").replace(/\\/g, "/").toLowerCase();
  if (haystack.includes("/.claude/") || haystack.includes("/claude.md")) return "Claude";
  if (haystack.includes("/.hermes/")) return "Hermes";
  if (haystack.includes("/.codex/") || haystack.includes("/.agents/skills/")) return "Codex";
  return "OpenGrove";
}

function normalizeKnowledgeSourceRoot(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claude code") return "Claude";
  if (normalized === "codex") return "Codex";
  if (normalized === "hermes") return "Hermes";
  return "OpenGrove";
}

function isSkillFileDocument(document: any): boolean {
  return Boolean(document?.metadata?.parentSkillId && document?.metadata?.skillFilePath);
}

function knowledgeFileName(document: any): string {
  const base = safePathSegment(document?.slug || document?.title || document?.id || "untitled");
  const extension = document?.format === "json" ? ".json" : document?.format === "plain" ? ".txt" : ".md";
  return base.endsWith(extension) ? base : `${base}${extension}`;
}

function safePathSegment(value: unknown): string {
  return String(value || "untitled")
    .replace(/[\\/:*?"<>|#\n\r\t]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "untitled";
}

function safeVaultPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") return undefined;
  return normalized;
}

function sortKnowledgeDocumentsForView(left: any, right: any): number {
  const priorityDelta = knowledgeDisplayPriority(left) - knowledgeDisplayPriority(right);
  if (priorityDelta !== 0) return priorityDelta;
  return String(right?.updatedAt || "").localeCompare(String(left?.updatedAt || ""));
}

function knowledgeDisplayPriority(document: any): number {
  if (!document) return 99;
  if (document.type === "memory") return 0;
  if (document.type === "project_doc" || document.type === "note" || document.type === "profile") return 1;
  if (document.type === "artifact_ref") return 2;
  if (document.type === "source") return 3;
  if (document.type === "skill" && !isSystemSkillDocument(document)) return 4;
  if (document.type === "routine") return 5;
  if (document.type === "skill") return 8;
  return 6;
}

function isSystemSkillDocument(document: any): boolean {
  if (document?.type !== "skill") return false;
  const source = String(document?.metadata?.source || "");
  const skillRoot = String(document?.metadata?.skillRoot || "");
  const entry = String(document?.metadata?.entry || "");
  return source === "system" || source === "bundled" || skillRoot.includes("/.codex/skills/.system/") || entry.includes("/.codex/skills/.system/");
}

function knowledgeDisplaySummary(document: any, maxLength = 140): string {
  const body = String(document?.body || "").trim();
  if (!body) return "";
  if (document?.type === "artifact_ref") {
    const preview = extractLabeledLine(body, "Preview text");
    const title = extractLabeledLine(body, "Title");
    const dataText = extractJsonTextField(extractLabeledLine(body, "Data"));
    return summarize([preview, dataText, title].find(Boolean) || body, maxLength);
  }
  if (document?.type === "skill") {
    const description = extractLabeledLine(body, "Description");
    const when = extractLabeledLine(body, "When to use");
    return summarize([description, when].filter(Boolean).join(" · ") || body, maxLength);
  }
  return summarize(body, maxLength);
}

function extractLabeledLine(body: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`(?:^|\\n)${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || "";
}

function extractJsonTextField(value: string): string {
  if (!value.trim().startsWith("{")) return "";
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

function needsKnowledgeReview(document: any): boolean {
  if (!document) return false;
  if (document.lifecycle && document.lifecycle !== "active") return true;
  if (document.type === "source" && document.metadata?.organizerRole === "raw_evidence") return true;
  if (isLowConfidence(document)) return true;
  return false;
}

function isLowConfidence(document: any): boolean {
  const confidence = numericConfidence(document?.confidence);
  return typeof confidence === "number" && confidence < 0.65;
}

function numericConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function knowledgeTypeLabel(type: string | undefined): string {
  return (
    {
      skill: "能力",
      memory: "记忆",
      note: "笔记",
      project_doc: "项目资料",
      artifact_ref: "产物引用",
      routine: "流程",
      profile: "画像",
      source: "来源",
    }[type || ""] || type || "页面"
  );
}

function knowledgeTypeGlyph(type: string | undefined): string {
  return (
    {
      skill: "✦",
      memory: "●",
      note: "◇",
      project_doc: "□",
      artifact_ref: "▣",
      routine: "↻",
      profile: "◎",
      source: "⌁",
    }[type || ""] || "·"
  );
}
