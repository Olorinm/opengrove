import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { bridgeHeaders, fetchJson } from "../../bridge";
import { formatDate } from "../../format";
import { MarkdownCodeEditor } from "./markdown-code-editor";
import { MarkdownPreview, MarkdownProperties, insertMarkdownFrontmatterProperty, parseMarkdownFrontmatter, recommendedMarkdownProperties, vaultFileDisplayTitle } from "./markdown-preview";
import {
  buildKnowledgeRelationRows, buildKnowledgeTimeline, extractNativeTargets, knowledgeEditableBody, knowledgeStatusLabel, knowledgeTypeLabel, knowledgeVaultPath, parseTagDraft, relatedArtifactsForKnowledge,
} from "./knowledge-model";

export function KnowledgeLibraryView(props: {
  documents: any[];
  filteredDocuments: any[];
  ledgers: any;
  artifacts: any[];
  skills: any[];
  focusedKnowledgeId: string;
  embedded?: boolean;
  onFocusKnowledge(knowledgeId: string): void;
  onPatch(knowledgeId: string, patch: Record<string, unknown>, options?: { silent?: boolean }): Promise<void>;
  onFeedback(knowledgeId: string, signal: string, note?: string): void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selectedDocument =
    selectedId
      ? props.filteredDocuments.find((document) => document.id === selectedId) ||
        props.documents.find((document) => document.id === selectedId)
      : undefined;

  useEffect(() => {
    if (props.focusedKnowledgeId !== selectedId) {
      setSelectedId(props.focusedKnowledgeId);
    }
  }, [props.focusedKnowledgeId, selectedId]);

  const content = (
    <div className="knowledge-page">
      <div className="knowledge-shell obsidian-vault">
        <KnowledgeDetailPanel
          document={selectedDocument}
          documents={props.documents}
          ledgers={props.ledgers}
          artifacts={props.artifacts}
          skills={props.skills}
          onOpenKnowledge={(knowledgeId) => {
            setSelectedId(knowledgeId);
            props.onFocusKnowledge(knowledgeId);
          }}
          onPatch={props.onPatch}
          onFeedback={props.onFeedback}
        />
      </div>
    </div>
  );

  return props.embedded ? (
    content
  ) : (
    <section className="view-panel tab-view knowledge-product-view" data-view="library">
      {content}
    </section>
  );
}

export function KnowledgeDetailPanel(props: {
  document: any | undefined;
  documents: any[];
  ledgers: any;
  artifacts: any[];
  skills: any[];
  onOpenKnowledge?(knowledgeId: string): void;
  onPatch(knowledgeId: string, patch: Record<string, unknown>, options?: { silent?: boolean }): Promise<void>;
  onFeedback(knowledgeId: string, signal: string, note?: string): void;
}) {
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [editorMode, setEditorMode] = useState<"preview" | "source">("source");
  const [saveState, setSaveState] = useState<"idle" | "queued" | "saving" | "saved" | "error">("idle");
  const [savedSnapshot, setSavedSnapshot] = useState({ title: "", body: "", tagsKey: "" });
  const draftRef = useRef({ title: "", body: "", tagsKey: "" });
  const savedSnapshotRef = useRef(savedSnapshot);
  const previousDocumentIdRef = useRef("");
  const documentId = props.document?.id || "";
  const fileQuery = useQuery({
    queryKey: ["knowledge-file", documentId],
    queryFn: () => fetchJson<any>(`/knowledge/${encodeURIComponent(documentId)}/file`, { headers: bridgeHeaders(false) }),
    enabled: Boolean(documentId),
    staleTime: 1_000,
  });
  const file = fileQuery.data?.file;
  const fileContent = typeof file?.content === "string" ? file.content : undefined;
  const document = props.document;

  useEffect(() => {
    draftRef.current = {
      title: draftTitle,
      body: draftBody,
      tagsKey: parseTagDraft(draftTags).join("\n"),
    };
  }, [draftTitle, draftBody, draftTags]);

  useEffect(() => {
    savedSnapshotRef.current = savedSnapshot;
  }, [savedSnapshot]);

  useEffect(() => {
    const nextTitle = props.document?.title || "";
    const nextBody = fileContent ?? knowledgeEditableBody(props.document);
    const nextTags = Array.isArray(props.document?.tags) ? props.document.tags.join(", ") : "";
    const nextSnapshot = {
      title: nextTitle,
      body: nextBody,
      tagsKey: parseTagDraft(nextTags).join("\n"),
    };
    const nextDocumentId = props.document?.id || "";
    const documentChanged = previousDocumentIdRef.current !== nextDocumentId;
    previousDocumentIdRef.current = nextDocumentId;
    const draftMatchesSaved =
      draftRef.current.title === savedSnapshotRef.current.title &&
      draftRef.current.body === savedSnapshotRef.current.body &&
      draftRef.current.tagsKey === savedSnapshotRef.current.tagsKey;
    savedSnapshotRef.current = nextSnapshot;
    setSavedSnapshot(nextSnapshot);
    if (documentChanged || draftMatchesSaved) {
      setDraftTitle(nextTitle);
      setDraftBody(nextBody);
      setDraftTags(nextTags);
    }
  }, [file?.updatedAt, props.document?.id, props.document?.updatedAt]);

  useEffect(() => {
    setEditorMode("source");
    setSaveState("idle");
  }, [props.document?.id]);

  const draftTagsKey = parseTagDraft(draftTags).join("\n");
  const isDirty = Boolean(document) && (
    draftTitle !== savedSnapshot.title ||
    draftBody !== savedSnapshot.body ||
    draftTagsKey !== savedSnapshot.tagsKey
  );

  useEffect(() => {
    if (!document) return;
    if (!isDirty) {
      setSaveState("saved");
      return;
    }
    if (fileQuery.isFetching) return;
    setSaveState("queued");
    const handle = window.setTimeout(() => {
      const nextTitle = draftTitle.trim() || document.title;
      const nextBody = draftBody;
      const nextTags = parseTagDraft(draftTags);
      const nextTagsKey = nextTags.join("\n");
      setSaveState("saving");
      props
        .onPatch(
          document.id,
          {
            title: nextTitle,
            body: nextBody,
            tags: nextTags,
          },
          { silent: true },
        )
        .then(() => {
          const nextSavedSnapshot = { title: nextTitle, body: nextBody, tagsKey: nextTagsKey };
          savedSnapshotRef.current = nextSavedSnapshot;
          setSavedSnapshot(nextSavedSnapshot);
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [document?.id, draftTitle, draftBody, draftTags, isDirty, fileQuery.isFetching]);

  if (!document) {
    return (
      <div className="knowledge-document-area">
        <div className="knowledge-empty">选择一条页面查看属性、关系和动态。</div>
      </div>
    );
  }

  const filePath = typeof file?.path === "string" ? file.path : knowledgeVaultPath(document);
  const fileVaultPath = typeof file?.vaultPath === "string" ? file.vaultPath : knowledgeVaultPath(document);
  const fileVaultSegments = fileVaultPath.split("/");
  const fileDisplayTitle = vaultFileDisplayTitle(fileVaultSegments[fileVaultSegments.length - 1], draftTitle || document.title);
  const fileFormat = (file?.format || document.format || "markdown") as string;
  const textStats = markdownTextStats(draftBody);
  const parsedFrontmatter = fileFormat === "markdown" ? parseMarkdownFrontmatter(draftBody) : undefined;
  const frontmatterProperties = parsedFrontmatter?.properties ?? [];
  const editorBody = parsedFrontmatter?.body ?? draftBody;
  const recommendedProperties = fileFormat === "markdown"
    ? recommendedMarkdownProperties(document, fileVaultPath, frontmatterProperties)
    : [];
  const timeline = buildKnowledgeTimeline(document, props.ledgers).filter((item) => {
    if (document.type !== "skill") return true;
    return item.kind !== "evidence" && !(item.kind === "revision" && item.title === "创建");
  });
  const nativeTargets = extractNativeTargets(document);
  const relatedArtifacts = relatedArtifactsForKnowledge(document, props.artifacts);
  const relatedSkill = document.type === "skill" ? props.skills.find((skill) => skill?.id === document.metadata?.skillId || skill?.name === document.metadata?.skillName) : undefined;
  const relationRows = buildKnowledgeRelationRows(document, relatedArtifacts);
  function openMarkdownLink(href: string): boolean {
    const targetPath = resolveMarkdownLinkVaultPath(href, fileVaultPath);
    if (!targetPath) return false;
    const targetDocument = findKnowledgeDocumentByVaultPath(props.documents, targetPath);
    if (!targetDocument?.id) return true;
    props.onOpenKnowledge?.(targetDocument.id);
    return true;
  }

  const saveLabel = fileQuery.isFetching
    ? "同步中"
    : saveState === "error"
      ? "保存失败"
      : isDirty
        ? saveState === "saving"
          ? "保存中"
          : "未保存"
        : "已保存";
  const showSaveState = fileQuery.isFetching || saveState === "saving" || saveState === "error";

  return (
    <div className="knowledge-document-area">
      <section className="knowledge-page-editor md-note-editor" aria-label="Markdown 页面编辑器" data-mode={editorMode}>
        <div className="knowledge-editor-toolbar md-editor-toolbar">
          <div className="md-breadcrumb" title={filePath}>
            {fileVaultSegments.map((part: string, index: number) => (
              <span key={`${part}-${index}`} data-current={index === fileVaultSegments.length - 1 ? "true" : "false"}>
                {part}
              </span>
            ))}
          </div>
          <div className="knowledge-editor-actions">
            {showSaveState ? (
              <span className="md-save-state" data-state={saveState}>
                {saveLabel}
              </span>
            ) : null}
          </div>
        </div>

        <h1
          className="knowledge-title-display"
          tabIndex={0}
          onClick={() => setEditorMode("source")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setEditorMode("source");
            }
          }}
        >
          {fileDisplayTitle || "Untitled"}
        </h1>
        {fileQuery.isError ? (
          <div className="knowledge-edit-note">读取本地文件失败：{fileQuery.error instanceof Error ? fileQuery.error.message : String(fileQuery.error)}</div>
        ) : null}
        {editorMode === "source" ? (
          <>
            <MarkdownProperties
              properties={frontmatterProperties}
              recommendations={recommendedProperties}
              onActivate={() => setEditorMode("source")}
              onAddProperty={(property) => setDraftBody((current) => insertMarkdownFrontmatterProperty(current, property))}
            />
            <MarkdownCodeEditor
              key={`${document.id}:${parsedFrontmatter ? "frontmatter" : "plain"}`}
              value={editorBody}
              format={fileFormat}
              autoFocus={false}
              onChange={(nextBody) => setDraftBody((current) => replaceMarkdownEditableBody(current, nextBody))}
              onOpenLink={openMarkdownLink}
              placeholder="写下 Markdown 内容"
            />
          </>
        ) : (
          <>
            <MarkdownProperties
              properties={frontmatterProperties}
              recommendations={recommendedProperties}
              onActivate={() => setEditorMode("source")}
              onAddProperty={(property) => setDraftBody((current) => insertMarkdownFrontmatterProperty(current, property))}
            />
            <MarkdownPreview
              text={draftBody}
              format={fileFormat}
              vaultPath={fileVaultPath}
              onActivate={() => setEditorMode("source")}
              onOpenLink={openMarkdownLink}
            />
          </>
        )}
        <div className="md-editor-status" aria-label="文档状态">
          <span>0 条反向链接</span>
          <span>{editorMode === "source" ? "实时阅览" : "阅读视图"}</span>
          <span>{textStats.words} 个词</span>
          <span>{textStats.characters} 个字符</span>
        </div>
      </section>

      <aside className="knowledge-properties-panel">
        <section className="knowledge-side-section">
          <div className="knowledge-side-title">属性</div>
          <KnowledgeProperty label="类型" value={knowledgeTypeLabel(document.type)} />
          <KnowledgeProperty label="路径" value={knowledgeVaultPath(document)} />
          <KnowledgeProperty label="状态" value={knowledgeStatusLabel(document)} />
          <KnowledgeProperty label="更新" value={formatDate(document.updatedAt)} />
          {relatedSkill ? <KnowledgeProperty label="原生能力" value={relatedSkill.name || relatedSkill.id} /> : null}
        </section>

        {relationRows.length ? (
          <section className="knowledge-side-section">
            <div className="knowledge-side-title">关系</div>
            <div className="knowledge-side-list">
              {relationRows.map((row) => (
                <button
                  className="knowledge-mini-row"
                  data-clickable={row.targetId && props.onOpenKnowledge ? "true" : "false"}
                  disabled={!row.targetId || !props.onOpenKnowledge}
                  key={row.id}
                  type="button"
                  onClick={() => row.targetId && props.onOpenKnowledge?.(row.targetId)}
                >
                  <span>{row.title}</span>
                  <small>{row.kind}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {nativeTargets.length ? (
          <section className="knowledge-side-section">
            <div className="knowledge-side-title">Native Skill 发布</div>
            <div className="knowledge-side-list">
              {nativeTargets.map((target) => (
                <div className="knowledge-mini-row" key={target}>
                  <span>{target}</span>
                  <small>native</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {timeline.length ? (
          <section className="knowledge-side-section">
            <div className="knowledge-side-title">动态</div>
            <div className="knowledge-timeline">
              {timeline.slice(0, 6).map((item) => (
                <div className="knowledge-timeline-item" data-kind={item.kind} key={item.id}>
                  <span className="knowledge-timeline-dot" aria-hidden="true"></span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{[item.detail, formatDate(item.at)].filter(Boolean).join(" · ")}</small>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="knowledge-side-section">
          <div className="knowledge-side-title">反馈</div>
          <div className="knowledge-feedback-actions">
            <button className="ghost-button panel-action" type="button" onClick={() => props.onFeedback(document.id, "useful", "manual_library_feedback")}>
              有用
            </button>
            <button className="ghost-button panel-action" type="button" onClick={() => props.onFeedback(document.id, "corrected", "manual_library_feedback")}>
              不准确
            </button>
            <button className="ghost-button panel-action" type="button" onClick={() => props.onFeedback(document.id, "stale", "manual_library_feedback")}>
              过期
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}

function markdownTextStats(text: string): { words: number; characters: number } {
  const stripped = text
    .replace(/^---[\s\S]*?\n---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/[#>*_`~\-\[\]()+|]/g, " ");
  const compact = stripped.replace(/\s+/g, "");
  const cjkCount = (compact.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWords = stripped.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
  return {
    words: cjkCount + latinWords.length,
    characters: compact.length,
  };
}

function resolveMarkdownLinkVaultPath(href: string, currentVaultPath: string): string {
  const raw = cleanMarkdownHref(href);
  if (!raw || /^(?:https?:|mailto:|tel:|data:|blob:|#)/i.test(raw)) return "";
  const vaultFilePrefix = "/vault-file/";
  if (raw.startsWith(vaultFilePrefix)) {
    return normalizeVaultPath(raw.slice(vaultFilePrefix.length).split("/").map(decodeSafe).join("/"));
  }
  const currentDir = normalizeVaultPath(currentVaultPath).split("/").slice(0, -1).join("/");
  const roots = new Set(["OpenGrove", "Codex", "Claude", "Hermes"]);
  const firstSegment = raw.replace(/^\/+/, "").split("/").filter(Boolean)[0] || "";
  const candidate = roots.has(firstSegment)
    ? raw.replace(/^\/+/, "")
    : [currentDir, raw].filter(Boolean).join("/");
  return normalizeVaultPath(candidate);
}

function findKnowledgeDocumentByVaultPath(documents: any[], targetPath: string): any | undefined {
  const targetKeys = knowledgePathMatchKeys(targetPath);
  return documents.find((document) => {
    const documentKeys = knowledgePathMatchKeys(knowledgeVaultPath(document));
    return Array.from(documentKeys).some((key) => targetKeys.has(key));
  });
}

function knowledgePathMatchKeys(path: string): Set<string> {
  const normalized = normalizeVaultPath(path).toLowerCase();
  const withoutExtension = normalized.replace(/\.(md|markdown|mdx|txt)$/i, "");
  return new Set([normalized, withoutExtension, `${withoutExtension}.md`].filter(Boolean));
}

function cleanMarkdownHref(href: string): string {
  const withoutWrapper = String(href || "").trim().replace(/^<|>$/g, "");
  const withoutHash = withoutWrapper.split("#")[0] || "";
  const withoutQuery = withoutHash.split("?")[0] || "";
  return decodeSafe(withoutQuery);
}

function normalizeVaultPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === ".") continue;
    if (trimmed === "..") {
      parts.pop();
      continue;
    }
    parts.push(trimmed);
  }
  return parts.join("/");
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function replaceMarkdownEditableBody(text: string, nextBody: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return nextBody;
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return nextBody;
  return `${normalized.slice(0, end + 5)}${nextBody}`;
}






export function KnowledgeProperty(props: { label: string; value: string }) {
  return (
    <div className="knowledge-property">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
