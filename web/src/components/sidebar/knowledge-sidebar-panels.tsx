import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderPlus, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";
import {
  isLowConfidence,
  knowledgeDisplaySummary,
  knowledgeStatusLabel,
  knowledgeTypeGlyph,
  knowledgeTypeLabel,
  knowledgeVaultPath,
  needsKnowledgeReview,
  sortKnowledgeDocumentsForView,
} from "../knowledge/knowledge-model";

type VaultTreeNode = {
  id: string;
  name: string;
  kind: "folder" | "file";
  path: string;
  document?: any;
  children: VaultTreeNode[];
};

type VaultFolderRecord = {
  path: string;
  backing?: "vault" | "native";
  originPath?: string;
};

type VaultFolderState = {
  path: string;
  defaultOpen: boolean;
};

export function VaultSidebarPanel(props: {
  documents: any[];
  folders?: VaultFolderRecord[];
  focusedKnowledgeId: string;
  forceOpen?: boolean;
  expandRequest?: { id: number; open: boolean };
  editingPath?: string;
  onCreateFolder(parentPath: string): void;
  onCreateNote(parentPath: string): void;
  onCancelRename(): void;
  onDeleteEntry(sourcePath: string, kind: "folder" | "file", name: string): void;
  onActiveRootChange?(path: string): void;
  onAllFoldersOpenChange?(open: boolean): void;
  onFocusKnowledge(knowledgeId: string): void;
  onMoveEntry(sourcePath: string, targetParentPath: string): void;
  onRenameEntry(sourcePath: string, name: string): void;
  onStartRename(sourcePath: string): void;
}) {
  const [menuPath, setMenuPath] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState("");
  const [dropTargetPath, setDropTargetPath] = useState("");
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>({
    OpenGrove: true,
    "OpenGrove/skills": true,
    Codex: true,
    Claude: true,
    Hermes: true,
  });
  const tree = useMemo(() => buildVaultTree(props.documents, props.folders ?? []), [props.documents, props.folders]);
  const folderStates = useMemo(() => collectVaultFolderStates(tree), [tree]);
  const folderPaths = useMemo(() => folderStates.map((folder) => folder.path), [folderStates]);
  const focusedFolderPath = useMemo(
    () => parentVaultPath(props.documents.find((document) => document?.id === props.focusedKnowledgeId)),
    [props.documents, props.focusedKnowledgeId],
  );
  const activeRootPath = rootVaultPath(selectedFolderPath || focusedFolderPath || tree[0]?.path || "OpenGrove");

  function toggleNode(path: string, currentlyOpen: boolean) {
    setSelectedFolderPath(path);
    setOpenPaths((current) => ({ ...current, [path]: !currentlyOpen }));
  }

  const allFoldersOpen = folderStates.length > 0 &&
    folderStates.every((folder) => props.forceOpen || (openPaths[folder.path] ?? folder.defaultOpen));

  useEffect(() => {
    props.onActiveRootChange?.(activeRootPath);
  }, [activeRootPath, props.onActiveRootChange]);

  useEffect(() => {
    props.onAllFoldersOpenChange?.(allFoldersOpen);
  }, [allFoldersOpen, props.onAllFoldersOpenChange]);

  useEffect(() => {
    if (!props.expandRequest) return;
    setOpenPaths(Object.fromEntries(folderPaths.map((path) => [path, props.expandRequest!.open])));
  }, [props.expandRequest?.id, props.expandRequest?.open, folderPaths]);

  useEffect(() => {
    if (!props.editingPath) return;
    const parentPaths = parentVaultPathsFromTreePath(props.editingPath);
    setOpenPaths((current) => ({
      ...current,
      ...Object.fromEntries(parentPaths.map((path) => [path, true])),
    }));
  }, [props.editingPath]);

  function moveEntryToFolder(sourcePath: string, targetFolderPath: string) {
    if (!isDroppableVaultTarget(sourcePath, targetFolderPath)) return;
    setDropTargetPath("");
    props.onMoveEntry(sourcePath, targetFolderPath);
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
              dropTargetPath={dropTargetPath}
              editingPath={props.editingPath}
              menuPath={menuPath}
              onCancelRename={props.onCancelRename}
              onCreateFolder={props.onCreateFolder}
              onCreateNote={props.onCreateNote}
              onDeleteEntry={props.onDeleteEntry}
              onFocusKnowledge={props.onFocusKnowledge}
              onOpenMenu={setMenuPath}
              onRenameEntry={props.onRenameEntry}
              onStartRename={props.onStartRename}
              onMoveEntry={moveEntryToFolder}
              onSelectFolder={setSelectedFolderPath}
              onSetDropTarget={setDropTargetPath}
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
  const allDocuments = useMemo(
    () => [...props.documents].filter(Boolean).sort(sortKnowledgeDocumentsForView),
    [props.documents],
  );
  const reviewDocuments = useMemo(() => allDocuments.filter(needsKnowledgeReview).slice(0, 6), [allDocuments]);
  const recentDocuments = useMemo(() => allDocuments.slice(0, 8), [allDocuments]);
  const verifiedDocuments = useMemo(
    () => allDocuments.filter((document) => !needsKnowledgeReview(document) && !isLowConfidence(document)).slice(0, 6),
    [allDocuments],
  );
  const isSearching = Boolean(props.query.trim());

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
      {isSearching ? (
        <WikiSidebarSection
          title="搜索结果"
          documents={props.filteredDocuments}
          focusedKnowledgeId={props.focusedKnowledgeId}
          emptyText="没有匹配页面。"
          onOpenKnowledge={props.onOpenKnowledge}
        />
      ) : (
        <>
          <WikiSidebarSection
            title="待确认"
            documents={reviewDocuments}
            focusedKnowledgeId={props.focusedKnowledgeId}
            emptyText="没有待确认页面。"
            onOpenKnowledge={props.onOpenKnowledge}
          />
          <WikiSidebarSection
            title="最近页面"
            documents={recentDocuments}
            focusedKnowledgeId={props.focusedKnowledgeId}
            emptyText="还没有页面。"
            onOpenKnowledge={props.onOpenKnowledge}
          />
          <WikiSidebarSection
            title="已确认"
            documents={verifiedDocuments}
            focusedKnowledgeId={props.focusedKnowledgeId}
            emptyText="还没有已确认页面。"
            onOpenKnowledge={props.onOpenKnowledge}
          />
        </>
      )}
    </section>
  );
}

function WikiSidebarSection(props: {
  title: string;
  documents: any[];
  focusedKnowledgeId: string;
  emptyText: string;
  onOpenKnowledge(knowledgeId: string): void;
}) {
  return (
    <div className="wiki-sidebar-section">
      <div className="wiki-sidebar-section-title">
        <span>{props.title}</span>
        <strong>{props.documents.length}</strong>
      </div>
      <div className="wiki-sidebar-result-list">
        {props.documents.map((document) => (
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
              <small>
                {[knowledgeTypeLabel(document.type), knowledgeStatusLabel(document), knowledgeDisplaySummary(document, 48)]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
          </button>
        ))}
        {!props.documents.length ? <div className="sidebar-library-empty">{props.emptyText}</div> : null}
      </div>
    </div>
  );
}

function VaultTreeNodeView(props: {
  depth: number;
  focusedKnowledgeId: string;
  forceOpen?: boolean;
  node: VaultTreeNode;
  openPaths: Record<string, boolean>;
  dropTargetPath: string;
  editingPath?: string;
  menuPath: string;
  onCancelRename(): void;
  onCreateFolder(parentPath: string): void;
  onCreateNote(parentPath: string): void;
  onDeleteEntry(sourcePath: string, kind: "folder" | "file", name: string): void;
  onFocusKnowledge(knowledgeId: string): void;
  onMoveEntry(sourcePath: string, targetParentPath: string): void;
  onOpenMenu(path: string): void;
  onRenameEntry(sourcePath: string, name: string): void;
  onStartRename(sourcePath: string): void;
  onSelectFolder(path: string): void;
  onSetDropTarget(path: string): void;
  onToggleNode(path: string, currentlyOpen: boolean): void;
}) {
  const isFolder = props.node.kind === "folder";
  const nodeOpen = props.forceOpen || (props.openPaths[props.node.path] ?? props.depth < 1);
  const style: CSSProperties = { paddingLeft: `${7 + props.depth * 12}px` };
  const canDragFolder = isFolder && props.depth > 0;
  const canModify = !isFolder || props.depth > 0;
  const isEditing = props.editingPath === props.node.path;
  const menuOpen = props.menuPath === props.node.path;
  const displayName = isFolder ? props.node.name : displayVaultFileName(props.node.name);
  const [draftName, setDraftName] = useState(displayName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    setDraftName(displayName);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [displayName, isEditing]);

  function startDrag(event: DragEvent<HTMLElement>, path: string) {
    event.dataTransfer.setData("text/plain", path);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleFolderDragOver(event: DragEvent<HTMLElement>) {
    const sourcePath = event.dataTransfer.getData("text/plain");
    if (sourcePath && !isDroppableVaultTarget(sourcePath, props.node.path)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    props.onSetDropTarget(props.node.path);
  }

  function handleFolderDrop(event: DragEvent<HTMLElement>) {
    const sourcePath = event.dataTransfer.getData("text/plain");
    if (!isDroppableVaultTarget(sourcePath, props.node.path)) return;
    event.preventDefault();
    event.stopPropagation();
    props.onMoveEntry(sourcePath, props.node.path);
  }

  function commitRename() {
    const nextName = draftName.trim();
    if (!nextName || nextName === displayName) {
      props.onCancelRename();
      return;
    }
    props.onRenameEntry(props.node.path, nextName);
  }

  function handleNodeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isEditing) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (isFolder) {
      props.onToggleNode(props.node.path, Boolean(nodeOpen));
    } else {
      props.onSelectFolder(parentVaultPath(props.node.document));
      props.node.document?.id && props.onFocusKnowledge(props.node.document.id);
    }
  }

  const label = isEditing ? (
    <input
      ref={inputRef}
      className="sidebar-tree-rename-input"
      value={draftName}
      onChange={(event) => setDraftName(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={commitRename}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitRename();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          props.onCancelRename();
        }
      }}
    />
  ) : (
    <span>{displayName}</span>
  );

  const actionMenu = menuOpen ? (
    <div className="sidebar-tree-menu" role="menu" onClick={(event) => event.stopPropagation()}>
      {isFolder ? (
        <>
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onCreateNote(props.node.path);
          }}>
            <FilePlus2 size={13} />
            <span>新建笔记</span>
          </button>
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onCreateFolder(props.node.path);
          }}>
            <FolderPlus size={13} />
            <span>新建文件夹</span>
          </button>
        </>
      ) : null}
      {canModify ? (
        <>
          {isFolder ? <div className="sidebar-tree-menu-separator" /> : null}
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onStartRename(props.node.path);
          }}>
            <Pencil size={13} />
            <span>重命名</span>
          </button>
          <button className="danger" type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onDeleteEntry(props.node.path, props.node.kind, displayName);
          }}>
            <Trash2 size={13} />
            <span>删除</span>
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  if (isFolder) {
    return (
      <div className="sidebar-vault-tree-item">
        <div
          className="sidebar-library-file sidebar-tree-folder"
          data-drop-target={props.dropTargetPath === props.node.path ? "true" : "false"}
          draggable={canDragFolder}
          role="button"
          style={style}
          tabIndex={0}
          onDragLeave={() => props.onSetDropTarget("")}
          onDragOver={handleFolderDragOver}
          onDragStart={(event) => canDragFolder ? startDrag(event, props.node.path) : event.preventDefault()}
          onDrop={handleFolderDrop}
          onClick={() => props.onToggleNode(props.node.path, Boolean(nodeOpen))}
          onKeyDown={handleNodeKeyDown}
          aria-expanded={nodeOpen}
        >
          <ChevronRight className="sidebar-tree-chevron" size={13} data-open={nodeOpen ? "true" : "false"} />
          <Folder size={13} />
          {label}
          <button
            className="sidebar-tree-more"
            type="button"
            aria-label={`${props.node.name} 操作`}
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onOpenMenu(menuOpen ? "" : props.node.path);
            }}
          >
            <MoreHorizontal size={13} />
          </button>
          {actionMenu}
        </div>
        {nodeOpen ? (
          <div className="sidebar-vault-tree-children">
            {props.node.children.map((child) => (
              <VaultTreeNodeView
                depth={props.depth + 1}
                focusedKnowledgeId={props.focusedKnowledgeId}
                forceOpen={props.forceOpen}
                key={child.id}
                node={child}
                dropTargetPath={props.dropTargetPath}
                editingPath={props.editingPath}
                menuPath={props.menuPath}
                onCancelRename={props.onCancelRename}
                onCreateFolder={props.onCreateFolder}
                onCreateNote={props.onCreateNote}
                onDeleteEntry={props.onDeleteEntry}
                onFocusKnowledge={props.onFocusKnowledge}
                onOpenMenu={props.onOpenMenu}
                onRenameEntry={props.onRenameEntry}
                onStartRename={props.onStartRename}
                onMoveEntry={props.onMoveEntry}
                onSelectFolder={props.onSelectFolder}
                onSetDropTarget={props.onSetDropTarget}
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
    <div
      className="sidebar-library-file sidebar-tree-file"
      data-active={props.node.document?.id === props.focusedKnowledgeId ? "true" : "false"}
      draggable={!isEditing}
      role="button"
      style={style}
      onDragStart={(event) => startDrag(event, props.node.path)}
      onClick={() => {
        if (isEditing) return;
        props.onSelectFolder(parentVaultPath(props.node.document));
        props.node.document?.id && props.onFocusKnowledge(props.node.document.id);
      }}
      onKeyDown={handleNodeKeyDown}
      tabIndex={0}
      title={props.node.path}
    >
      <FileText size={13} />
      {label}
      <button
        className="sidebar-tree-more"
        type="button"
        aria-label={`${displayName} 操作`}
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onOpenMenu(menuOpen ? "" : props.node.path);
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      {actionMenu}
    </div>
  );
}

function buildVaultTree(documents: any[], folders: VaultFolderRecord[] = []): VaultTreeNode[] {
  const root: VaultTreeNode = { id: "vault", name: "vault", kind: "folder", path: "", children: [] };
  for (const folder of folders) {
    const path = safeVaultTreePath(folder?.path);
    if (!path) continue;
    ensureVaultFolderNode(root, path.split("/"));
  }
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

function ensureVaultFolderNode(root: VaultTreeNode, segments: string[]): VaultTreeNode {
  let current = root;
  let currentPath = "";
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    let child = current.children.find((item) => item.name === segment && item.kind === "folder");
    if (!child) {
      child = {
        id: `folder:${currentPath}`,
        name: segment,
        kind: "folder",
        path: currentPath,
        children: [],
      };
      current.children.push(child);
    }
    current = child;
  }
  return current;
}

function parentVaultPath(document: any): string {
  const path = document ? safeVaultTreePath(knowledgeVaultPath(document)) : "";
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) return segments[0] || "";
  return segments.slice(0, -1).join("/");
}

function parentVaultPathsFromTreePath(path: string): string[] {
  const segments = safeVaultTreePath(path).split("/").filter(Boolean);
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

function rootVaultPath(path: string): string {
  return safeVaultTreePath(path).split("/").filter(Boolean)[0] || "OpenGrove";
}

function isDroppableVaultTarget(sourcePath: string, targetFolderPath: string): boolean {
  const source = safeVaultTreePath(sourcePath);
  const target = safeVaultTreePath(targetFolderPath);
  if (!source || !target || source === target) return false;
  if (rootVaultPath(source) !== rootVaultPath(target)) return false;
  return !target.startsWith(`${source}/`);
}

function safeVaultTreePath(path: unknown): string {
  if (typeof path !== "string") return "";
  return path.replace(/\\/g, "/").split("/").map((segment) => segment.trim()).filter(Boolean).join("/");
}

function displayVaultFileName(name: string): string {
  return name.replace(/\.(?:md|markdown|mdx)$/i, "");
}

function collectVaultFolderStates(nodes: VaultTreeNode[], depth = 0): VaultFolderState[] {
  const folders: VaultFolderState[] = [];
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    folders.push({ path: node.path, defaultOpen: depth < 1 });
    folders.push(...collectVaultFolderStates(node.children, depth + 1));
  }
  return folders;
}

function sortVaultTree(nodes: VaultTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-CN");
  });
  nodes.forEach((node) => sortVaultTree(node.children));
}
