import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { File as FileIcon, FileText, Image as ImageIcon, Pencil } from "lucide-react";
import { bridgeHeaders, fetchJson } from "../../bridge";
import { formatDate } from "../../format";
import { MarkdownCodeEditor } from "./markdown-code-editor";
import { MarkdownPreview, MarkdownProperties, insertMarkdownFrontmatterProperty, parseMarkdownFrontmatter, recommendedMarkdownProperties, vaultFileDisplayTitle } from "./markdown-preview";
import { ArtifactCard } from "../workspace/cards";
import {
  artifactImagePreview, artifactKind, artifactTitle, buildKnowledgeInboxItems, buildKnowledgeRelationRows, buildKnowledgeTimeline, buildWikiReferenceGroups, confidenceLabel, extractNativeTargets, isLowConfidence, knowledgeEditableBody, knowledgeStatusLabel, knowledgeTypeLabel, knowledgeVaultPath, needsKnowledgeReview, parseTagDraft, relatedArtifactsForKnowledge, relatedKnowledgeForArtifact, sortKnowledgeDocumentsForView,
} from "./knowledge-model";

export function KnowledgeLibraryView(props: {
  documents: any[];
  filteredDocuments: any[];
  ledgers: any;
  artifacts: any[];
  skills: any[];
  focusedKnowledgeId: string;
  onFocusKnowledge(knowledgeId: string): void;
  onPatch(knowledgeId: string, patch: Record<string, unknown>, options?: { silent?: boolean }): Promise<void>;
  onFeedback(knowledgeId: string, signal: string, note?: string): void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selectedDocument =
    props.filteredDocuments.find((document) => document.id === selectedId) ||
    props.documents.find((document) => document.id === selectedId) ||
    props.filteredDocuments[0] ||
    props.documents[0];

  useEffect(() => {
    if (props.focusedKnowledgeId && props.focusedKnowledgeId !== selectedId) {
      setSelectedId(props.focusedKnowledgeId);
      return;
    }
    if (!selectedDocument?.id) {
      setSelectedId("");
      return;
    }
    if (selectedId !== selectedDocument.id) {
      setSelectedId(selectedDocument.id);
      props.onFocusKnowledge(selectedDocument.id);
    }
  }, [props.focusedKnowledgeId, selectedDocument?.id, selectedId, props.filteredDocuments]);

  return (
    <section className="view-panel tab-view knowledge-product-view" data-view="library">
      <div className="knowledge-page">
        <div className="knowledge-shell obsidian-vault">
          <KnowledgeDetailPanel
            document={selectedDocument}
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
    </section>
  );
}



export function KnowledgeWikiView(props: {
  documents: any[];
  filteredDocuments: any[];
  ledgers: any;
  artifacts: any[];
  skills: any[];
  query: string;
  focusedKnowledgeId: string;
  onFocusKnowledge(knowledgeId: string): void;
  onPatch(knowledgeId: string, patch: Record<string, unknown>, options?: { silent?: boolean }): Promise<void>;
  onFeedback(knowledgeId: string, signal: string, note?: string): void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const hasWikiFilter = Boolean(props.query.trim());
  const activeSelectedId = props.focusedKnowledgeId || selectedId;
  const selectedDocument =
    props.documents.find((document) => document?.id === activeSelectedId) ||
    props.filteredDocuments.find((document) => document?.id === activeSelectedId);

  useEffect(() => {
    if (props.focusedKnowledgeId && props.focusedKnowledgeId !== selectedId) {
      setSelectedId(props.focusedKnowledgeId);
    } else if (!props.focusedKnowledgeId && selectedId && !props.documents.some((document) => document?.id === selectedId)) {
      setSelectedId("");
    }
  }, [props.focusedKnowledgeId, props.documents, selectedId]);

  function openKnowledge(knowledgeId: string) {
    setSelectedId(knowledgeId);
    props.onFocusKnowledge(knowledgeId);
  }

  return (
    <section className="view-panel tab-view wiki-view" data-view="wiki">
      <div className="wiki-page-shell">
        <div className="wiki-document-stage">
          {selectedDocument ? (
            <KnowledgeDetailPanel
              document={selectedDocument}
              ledgers={props.ledgers}
              artifacts={props.artifacts}
              skills={props.skills}
              surface="wiki"
              onOpenKnowledge={openKnowledge}
              onPatch={props.onPatch}
              onFeedback={props.onFeedback}
            />
          ) : (
            <WikiHomePanel
              documents={props.documents}
              filteredDocuments={props.filteredDocuments}
              hasFilter={hasWikiFilter}
              query={props.query}
              onOpenKnowledge={openKnowledge}
            />
          )}
        </div>
        <WikiReferencePanel
          document={selectedDocument}
          documents={props.documents}
          artifacts={props.artifacts}
          onOpenKnowledge={openKnowledge}
          onFeedback={props.onFeedback}
        />
      </div>
    </section>
  );
}

function WikiHomePanel(props: {
  documents: any[];
  filteredDocuments: any[];
  hasFilter: boolean;
  query: string;
  onOpenKnowledge(knowledgeId: string): void;
}) {
  const allDocuments = useMemo(
    () => [...(Array.isArray(props.documents) ? props.documents : [])].filter(Boolean).sort(sortKnowledgeDocumentsForView),
    [props.documents],
  );
  const searchResults = props.filteredDocuments.filter(Boolean).slice(0, 16);
  const reviewAllDocuments = allDocuments.filter(needsKnowledgeReview);
  const verifiedAllDocuments = allDocuments.filter((document) => !needsKnowledgeReview(document) && !isLowConfidence(document));
  const reviewDocuments = reviewAllDocuments.slice(0, 6);
  const recentDocuments = allDocuments.slice(0, 8);
  const verifiedDocuments = verifiedAllDocuments.slice(0, 6);

  return (
    <div className="wiki-home">
      <header className="wiki-home-hero">
        <div>
          <div className="wiki-page-kicker">Wiki</div>
          <h1>知识入口</h1>
          <p>这里按可信状态、最近更新和页面关系来浏览知识；需要看真实文件位置时，去资料库。</p>
        </div>
        <div className="wiki-page-meta">
          <span>{props.documents.length} 页面</span>
          <span>{reviewAllDocuments.length} 待确认</span>
          <span>{verifiedAllDocuments.length} 已确认</span>
        </div>
      </header>

      {props.hasFilter ? (
        <WikiHomeSection
          title={`搜索：${props.query.trim()}`}
          documents={searchResults}
          emptyText="没有匹配页面。"
          onOpenKnowledge={props.onOpenKnowledge}
        />
      ) : (
        <>
          <WikiHomeSection
            title="待确认"
            documents={reviewDocuments}
            emptyText="暂时没有需要确认的页面。"
            onOpenKnowledge={props.onOpenKnowledge}
          />
          <WikiHomeSection
            title="最近更新"
            documents={recentDocuments}
            emptyText="还没有页面。"
            onOpenKnowledge={props.onOpenKnowledge}
          />
          <WikiHomeSection
            title="已确认"
            documents={verifiedDocuments}
            emptyText="还没有稳定页面。"
            onOpenKnowledge={props.onOpenKnowledge}
          />
        </>
      )}
    </div>
  );
}

function WikiHomeSection(props: {
  title: string;
  documents: any[];
  emptyText: string;
  onOpenKnowledge(knowledgeId: string): void;
}) {
  return (
    <section className="wiki-home-section">
      <div className="wiki-home-section-head">
        <h2>{props.title}</h2>
        <span>{props.documents.length}</span>
      </div>
      <div className="wiki-home-grid">
        {props.documents.length ? (
          props.documents.map((document) => (
            <button
              className="wiki-home-card"
              key={document.id}
              type="button"
              onClick={() => props.onOpenKnowledge(document.id)}
            >
              <span className="wiki-home-card-type">{knowledgeTypeLabel(document.type)}</span>
              <strong>{document.title || document.slug || document.id}</strong>
              <small>{[knowledgeStatusLabel(document), formatDate(document.updatedAt), knowledgeVaultPath(document)].filter(Boolean).join(" · ")}</small>
            </button>
          ))
        ) : (
          <div className="wiki-home-empty">{props.emptyText}</div>
        )}
      </div>
    </section>
  );
}



export function WikiReferencePanel(props: {
  document: any;
  documents: any[];
  artifacts: any[];
  onOpenKnowledge(knowledgeId: string): void;
  onFeedback?(knowledgeId: string, signal: string, note?: string): void;
}) {
  const groups = useMemo(
    () => buildWikiReferenceGroups(props.document, props.documents, props.artifacts),
    [props.document, props.documents, props.artifacts],
  );
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <aside className="wiki-reference-panel" aria-label="引用关系">
      <section className="wiki-reference-card">
        <div className="wiki-reference-kicker">当前页面</div>
        <h2>{props.document?.title || "未选择页面"}</h2>
        <p>{props.document ? knowledgeVaultPath(props.document) : "从左侧搜索或入口卡片打开一个页面。"}</p>
        <div className="wiki-reference-count">{total}</div>
        {props.document ? (
          <div className="wiki-reference-meta">
            <span>{knowledgeTypeLabel(props.document.type)}</span>
            <span>{knowledgeStatusLabel(props.document)}</span>
            <span>{formatDate(props.document.updatedAt)}</span>
          </div>
        ) : null}
        {props.document && props.onFeedback ? (
          <div className="wiki-reference-actions">
            <button type="button" onClick={() => props.onFeedback?.(props.document.id, "useful", "wiki_reference_panel")}>
              有用
            </button>
            <button type="button" onClick={() => props.onFeedback?.(props.document.id, "corrected", "wiki_reference_panel")}>
              不准确
            </button>
            <button type="button" onClick={() => props.onFeedback?.(props.document.id, "stale", "wiki_reference_panel")}>
              过期
            </button>
          </div>
        ) : null}
      </section>
      {groups.map((group) => (
        <section className="wiki-reference-card" key={group.id}>
          <div className="wiki-reference-title">
            <span>{group.title}</span>
            <strong>{group.rows.length}</strong>
          </div>
          <div className="wiki-reference-list">
            {group.rows.length ? (
              group.rows.map((row) => (
                <button
                  className="wiki-reference-row"
                  data-clickable={row.targetId ? "true" : "false"}
                  disabled={!row.targetId}
                  key={row.id}
                  type="button"
                  onClick={() => row.targetId && props.onOpenKnowledge(row.targetId)}
                >
                  <span>{row.title}</span>
                  <small>{row.kind}</small>
                </button>
              ))
            ) : (
              <div className="wiki-reference-empty">暂无</div>
            )}
          </div>
        </section>
      ))}
    </aside>
  );
}



export function KnowledgeInboxView(props: {
  documents: any[];
  ledgers: any;
  onOpenPage(knowledgeId: string): void;
  onFeedback(knowledgeId: string, signal: string, note?: string): void;
}) {
  const inboxItems = useMemo(() => buildKnowledgeInboxItems(props.documents, props.ledgers), [props.documents, props.ledgers]);

  return (
    <section className="view-panel tab-view knowledge-product-view" data-view="inbox">
      <div className="knowledge-page">
        <header className="knowledge-hero compact">
          <div>
            <div className="knowledge-eyebrow">待处理</div>
            <h1>收件箱</h1>
            <p>这里不是知识库本体，而是 AI 建议、低可信页面、原始证据和冲突反馈进入正式资料库前的缓冲区。</p>
          </div>
          <div className="knowledge-hero-stats">
            <KnowledgeMetric label="待处理" value={inboxItems.length} />
          </div>
        </header>

        <div className="inbox-list">
          {inboxItems.length ? (
            inboxItems.map((item) => (
              <article className="inbox-card" data-tone={item.tone} key={item.id}>
                <div className="inbox-card-main">
                  <div className="inbox-kicker">{item.reason}</div>
                  <h2>{item.title}</h2>
                  <p>{item.detail}</p>
                  <div className="knowledge-chip-row">
                    <span className="knowledge-chip">{knowledgeTypeLabel(item.document.type)}</span>
                    <span className="knowledge-chip">{knowledgeStatusLabel(item.document)}</span>
                    <span className="knowledge-chip">{confidenceLabel(item.document.confidence)}</span>
                  </div>
                </div>
                <div className="inbox-actions">
                  <button className="ghost-button panel-action" type="button" onClick={() => props.onOpenPage(item.document.id)}>
                    打开页面
                  </button>
                  <button className="ghost-button panel-action" type="button" onClick={() => props.onFeedback(item.document.id, "useful", item.reason)}>
                    有用
                  </button>
                  <button className="ghost-button panel-action" type="button" onClick={() => props.onFeedback(item.document.id, "ignored", item.reason)}>
                    暂时忽略
                  </button>
                  <button className="ghost-button panel-action" type="button" onClick={() => props.onFeedback(item.document.id, "stale", item.reason)}>
                    过期
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="knowledge-empty large">
              <strong>现在没有待确认内容</strong>
              <span>新的记忆建议、低可信页面、skill 修改建议和产物反馈会先来到这里，再进入正式资料库。</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}



export function ArtifactSpaceView(props: {
  artifacts: any[];
  knowledge: any[];
  ledgers: any;
  workingState: any;
  onAddArtifactToComposer(artifact: any): void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const selectedArtifact = props.artifacts.find((artifact) => artifact.id === selectedId) || props.artifacts[0];
  const relatedKnowledge = selectedArtifact ? relatedKnowledgeForArtifact(selectedArtifact, props.knowledge) : [];

  useEffect(() => {
    if (!selectedArtifact?.id) {
      setSelectedId("");
      return;
    }
    if (selectedId !== selectedArtifact.id) {
      setSelectedId(selectedArtifact.id);
    }
  }, [selectedArtifact?.id, selectedId]);

  return (
    <section className="view-panel tab-view artifact-space-view" data-view="artifacts">
      <div className="knowledge-page">
        <header className="knowledge-hero">
          <div>
            <div className="knowledge-eyebrow">产物空间</div>
            <h1>产物</h1>
            <p>这里先作为产物浏览区。需要让模型参考某个产物时，手动加入对话，它会出现在输入框上方。</p>
          </div>
          <div className="knowledge-hero-stats">
            <KnowledgeMetric label="产物" value={props.artifacts.length} />
          </div>
        </header>

        <div className="artifact-shell">
          <section className="artifact-gallery" aria-label="产物列表">
            {props.artifacts.length ? (
              props.artifacts.map((artifact) => (
                <button
                  key={artifact.id}
                  className="artifact-tile"
                  data-active={artifact.id === selectedArtifact?.id ? "true" : "false"}
                  type="button"
                  onClick={() => setSelectedId(artifact.id)}
                >
                  {artifactImagePreview(artifact) ? (
                    <img src={artifactImagePreview(artifact)} alt={artifact.title || artifact.id || "artifact"} />
                  ) : (
                    <span className="artifact-tile-icon" data-kind={artifactKind(artifact)}>
                      {artifactKind(artifact) === "image" ? <ImageIcon size={18} /> : <FileIcon size={18} />}
                    </span>
                  )}
                  <span className="artifact-tile-title">{artifactTitle(artifact)}</span>
                  <span className="artifact-tile-meta">{[artifact.type, formatDate(artifact.updatedAt || artifact.createdAt)].filter(Boolean).join(" · ")}</span>
                </button>
              ))
            ) : (
              <div className="knowledge-empty large">
                <strong>还没有产物</strong>
                <span>图片、文档、网页快照、代码结果和批注会在这里以一等对象保存。</span>
              </div>
            )}
          </section>

          <aside className="artifact-detail">
            {selectedArtifact ? (
              <>
                <ArtifactCard
                  artifact={selectedArtifact}
                  onAddToComposer={props.onAddArtifactToComposer}
                />
                <section className="knowledge-side-section">
                  <div className="knowledge-side-title">关联知识</div>
                  <div className="knowledge-side-list">
                    {relatedKnowledge.length ? (
                      relatedKnowledge.map((document) => (
                        <div className="knowledge-mini-row" key={document.id}>
                          <span>{document.title || document.id}</span>
                          <small>{knowledgeTypeLabel(document.type)}</small>
                        </div>
                      ))
                    ) : (
                      <div className="knowledge-muted">还没有 artifact_ref 或来源页面引用这个产物。</div>
                    )}
                  </div>
                </section>
              </>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  );
}



export function KnowledgeDetailPanel(props: {
  document: any | undefined;
  ledgers: any;
  artifacts: any[];
  skills: any[];
  surface?: "library" | "wiki";
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

  const saveLabel = fileQuery.isFetching
    ? "同步中"
    : saveState === "error"
      ? "保存失败"
      : isDirty
        ? saveState === "saving"
          ? "保存中"
          : "未保存"
        : "已保存";

  return (
    <div className="knowledge-document-area" data-surface={props.surface || "library"}>
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
            <span className="md-save-state" data-state={isDirty ? saveState : "saved"}>
              {saveLabel}
            </span>
            <button
              className="md-icon-button"
              type="button"
              title={editorMode === "preview" ? "切换到编辑视图" : "切换到阅读视图"}
              onClick={() => setEditorMode(editorMode === "preview" ? "source" : "preview")}
            >
              {editorMode === "preview" ? <Pencil size={17} /> : <FileText size={17} />}
            </button>
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

function replaceMarkdownEditableBody(text: string, nextBody: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return nextBody;
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return nextBody;
  return `${normalized.slice(0, end + 5)}${nextBody}`;
}



export function KnowledgeMetric(props: { label: string; value: number }) {
  return (
    <div className="knowledge-metric">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}



export function KnowledgeProperty(props: { label: string; value: string }) {
  return (
    <div className="knowledge-property">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
