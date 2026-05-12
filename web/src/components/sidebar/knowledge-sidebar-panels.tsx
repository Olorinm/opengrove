import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderCog, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  knowledgeVaultPath,
} from "../knowledge/knowledge-model";
import { APP_STORAGE_KEYS } from "../../identity";
import { useI18n } from "../../i18n";
import { ThemedPixelIcon } from "./app-navigation";

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

type VaultMenuAnchor = {
  left: number;
  top: number;
};

type VaultMenuState = VaultMenuAnchor & {
  path: string;
};

const DEFAULT_VAULT_OPEN_PATHS: Record<string, boolean> = {
  OpenGrove: true,
  "OpenGrove/skills": true,
  Codex: true,
  Claude: true,
  Hermes: true,
};

type VaultTreeOrder = Record<string, string[]>;

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
  const { t } = useI18n();
  const [menuState, setMenuState] = useState<VaultMenuState | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState("");
  const [dragSourcePath, setDragSourcePath] = useState("");
  const [dropTargetPath, setDropTargetPath] = useState("");
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>(readStoredVaultOpenPaths);
  const [treeOrder, setTreeOrder] = useState<VaultTreeOrder>(readStoredVaultTreeOrder);
  const lastExpandRequestIdRef = useRef<number>(props.expandRequest?.id ?? 0);
  const lastFocusedKnowledgeIdRef = useRef(props.focusedKnowledgeId);
  const lastEditingPathRef = useRef(props.editingPath ?? "");
  const tree = useMemo(() => buildVaultTree(props.documents, props.folders ?? [], treeOrder), [props.documents, props.folders, treeOrder]);
  const folderStates = useMemo(() => collectVaultFolderStates(tree), [tree]);
  const folderPaths = useMemo(() => folderStates.map((folder) => folder.path), [folderStates]);
  const focusedFolderPath = useMemo(
    () => parentVaultPath(props.documents.find((document) => document?.id === props.focusedKnowledgeId)),
    [props.documents, props.focusedKnowledgeId],
  );
  const activeRootPath = rootVaultPath(selectedFolderPath || focusedFolderPath || tree[0]?.path || "OpenGrove");
  const menuPath = menuState?.path ?? "";
  const userNodes = tree.filter((node) => !isProtectedVaultRoot(node.name));
  const kernelNodes = tree.filter((node) => isProtectedVaultRoot(node.name));
  const hasKernelNodes = kernelNodes.length > 0;
  const kernelsOpen = openPaths["__kernels__"] ?? true;

  function openMenu(path: string, anchor?: VaultMenuAnchor) {
    if (!path || !anchor) {
      setMenuState(null);
      return;
    }
    setMenuState({ path, ...anchor });
  }

  function toggleNode(path: string, currentlyOpen: boolean) {
    setSelectedFolderPath(path);
    setOpenPaths((current) => ({ ...current, [path]: !currentlyOpen }));
  }

  const allFoldersOpen = folderStates.length > 0 &&
    folderStates.every((folder) => props.forceOpen || (openPaths[folder.path] ?? folder.defaultOpen)) &&
    (!hasKernelNodes || props.forceOpen || kernelsOpen);

  useEffect(() => {
    props.onActiveRootChange?.(activeRootPath);
  }, [activeRootPath, props.onActiveRootChange]);

  useEffect(() => {
    props.onAllFoldersOpenChange?.(allFoldersOpen);
  }, [allFoldersOpen, props.onAllFoldersOpenChange]);

  useEffect(() => {
    writeStoredVaultOpenPaths(openPaths);
  }, [openPaths]);

  useEffect(() => {
    writeStoredVaultTreeOrder(treeOrder);
  }, [treeOrder]);

  useEffect(() => {
    if (!props.expandRequest) return;
    if (props.expandRequest.id === lastExpandRequestIdRef.current) return;
    lastExpandRequestIdRef.current = props.expandRequest.id;
    setOpenPaths({
      ...Object.fromEntries(folderPaths.map((path) => [path, props.expandRequest!.open])),
      ...(hasKernelNodes ? { __kernels__: props.expandRequest.open } : {}),
    });
  }, [props.expandRequest?.id, props.expandRequest?.open, folderPaths, hasKernelNodes]);

  useEffect(() => {
    lastFocusedKnowledgeIdRef.current = props.focusedKnowledgeId;
  }, [props.focusedKnowledgeId]);

  useEffect(() => {
    if ((props.editingPath ?? "") === lastEditingPathRef.current) return;
    lastEditingPathRef.current = props.editingPath ?? "";
    if (!props.editingPath) return;
    const parentPaths = parentVaultPathsFromTreePath(props.editingPath);
    setOpenPaths((current) => ({
      ...current,
      ...Object.fromEntries(parentPaths.map((path) => [path, true])),
    }));
  }, [props.editingPath]);

  useEffect(() => {
    if (!menuPath) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(".sidebar-tree-menu") || target?.closest(".sidebar-tree-more")) return;
      setMenuState(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuState(null);
      }
    };
    window.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuPath]);

  function moveEntryToFolder(sourcePath: string, targetFolderPath: string) {
    if (!isDroppableVaultTarget(sourcePath, targetFolderPath)) return;
    setDragSourcePath("");
    setDropTargetPath("");
    props.onMoveEntry(sourcePath, targetFolderPath);
  }

  function reorderEntry(sourcePath: string, targetPath: string) {
    const source = safeVaultTreePath(sourcePath);
    const target = safeVaultTreePath(targetPath);
    if (!source || !target || source === target) return;
    const sourceParent = parentVaultPathFromTreePath(source);
    if (sourceParent !== parentVaultPathFromTreePath(target)) return;
    setDragSourcePath("");
    setDropTargetPath("");
    setTreeOrder((current) => {
      const siblings = childPathsForParent(tree, sourceParent);
      if (!siblings.includes(source) || !siblings.includes(target)) return current;
      const nextSiblings = siblings.filter((path) => path !== source);
      const targetIndex = nextSiblings.indexOf(target);
      nextSiblings.splice(targetIndex < 0 ? nextSiblings.length : targetIndex, 0, source);
      return { ...current, [sourceParent]: nextSiblings };
    });
  }

  const renderNode = (node: VaultTreeNode, depth: number) => (
    <VaultTreeNodeView
      depth={depth}
      focusedKnowledgeId={props.focusedKnowledgeId}
      forceOpen={props.forceOpen}
      key={node.id}
      node={node}
      dragSourcePath={dragSourcePath}
      dropTargetPath={dropTargetPath}
      editingPath={props.editingPath}
      menuAnchor={menuState}
      menuPath={menuPath}
      onCancelRename={props.onCancelRename}
      onCreateFolder={props.onCreateFolder}
      onCreateNote={props.onCreateNote}
      onDeleteEntry={props.onDeleteEntry}
      onFocusKnowledge={props.onFocusKnowledge}
      onOpenMenu={openMenu}
      onRenameEntry={props.onRenameEntry}
      onReorderEntry={reorderEntry}
      onStartRename={props.onStartRename}
      onMoveEntry={moveEntryToFolder}
      onSelectFolder={setSelectedFolderPath}
      onSetDropTarget={setDropTargetPath}
      onSetDragSource={setDragSourcePath}
      onToggleNode={toggleNode}
      openPaths={openPaths}
    />
  );

  return (
    <section className="sidebar-library-panel" aria-label={t("vault.files")}>
      <div className="sidebar-library-files">
        {userNodes.length ? userNodes.map((node) => renderNode(node, 0)) : null}
        {hasKernelNodes ? (
          <div className="vault-kernels-folder">
            <div
              className="sidebar-library-file sidebar-tree-folder"
              role="button"
              style={{ paddingLeft: "7px" }}
              tabIndex={0}
              onClick={() => setOpenPaths((current) => ({ ...current, "__kernels__": !kernelsOpen }))}
              aria-expanded={kernelsOpen}
            >
              <ChevronRight className="sidebar-tree-chevron" size={13} data-open={kernelsOpen ? "true" : "false"} />
              <FolderCog size={13} />
              <span>Kernels</span>
            </div>
            {kernelsOpen ? (
              <div className="sidebar-vault-tree-children">
                {kernelNodes.map((node) => renderNode(node, 1))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!tree.length ? (
          <div className="sidebar-library-empty">{t("vault.empty")}</div>
        ) : null}
      </div>
    </section>
  );
}

function readStoredVaultOpenPaths(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEYS.vaultOpenPaths);
    if (!raw) return { ...DEFAULT_VAULT_OPEN_PATHS };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_VAULT_OPEN_PATHS };
    }
    const stored: Record<string, boolean> = {};
    for (const [path, open] of Object.entries(parsed)) {
      if (typeof path === "string" && path && typeof open === "boolean") {
        stored[path] = open;
      }
    }
    return { ...DEFAULT_VAULT_OPEN_PATHS, ...stored };
  } catch {
    return { ...DEFAULT_VAULT_OPEN_PATHS };
  }
}

function writeStoredVaultOpenPaths(openPaths: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(APP_STORAGE_KEYS.vaultOpenPaths, JSON.stringify(openPaths));
  } catch {
    // Ignore storage failures; the tree still works for the current session.
  }
}

function readStoredVaultTreeOrder(): VaultTreeOrder {
  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEYS.vaultTreeOrder);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const order: VaultTreeOrder = {};
    for (const [parentPath, childPaths] of Object.entries(parsed)) {
      if (!Array.isArray(childPaths)) continue;
      order[safeVaultTreePath(parentPath)] = childPaths
        .map((path) => safeVaultTreePath(path))
        .filter(Boolean);
    }
    return order;
  } catch {
    return {};
  }
}

function writeStoredVaultTreeOrder(order: VaultTreeOrder): void {
  try {
    window.localStorage.setItem(APP_STORAGE_KEYS.vaultTreeOrder, JSON.stringify(order));
  } catch {
    // Ignore storage failures; ordering will fall back to deterministic sorting.
  }
}

function VaultTreeNodeView(props: {
  depth: number;
  focusedKnowledgeId: string;
  forceOpen?: boolean;
  node: VaultTreeNode;
  openPaths: Record<string, boolean>;
  dragSourcePath: string;
  dropTargetPath: string;
  editingPath?: string;
  menuAnchor: VaultMenuState | null;
  menuPath: string;
  onCancelRename(): void;
  onCreateFolder(parentPath: string): void;
  onCreateNote(parentPath: string): void;
  onDeleteEntry(sourcePath: string, kind: "folder" | "file", name: string): void;
  onFocusKnowledge(knowledgeId: string): void;
  onMoveEntry(sourcePath: string, targetParentPath: string): void;
  onOpenMenu(path: string, anchor?: VaultMenuAnchor): void;
  onRenameEntry(sourcePath: string, name: string): void;
  onReorderEntry(sourcePath: string, targetPath: string): void;
  onStartRename(sourcePath: string): void;
  onSelectFolder(path: string): void;
  onSetDropTarget(path: string): void;
  onSetDragSource(path: string): void;
  onToggleNode(path: string, currentlyOpen: boolean): void;
}) {
  const isFolder = props.node.kind === "folder";
  const nodeOpen = props.forceOpen || (props.openPaths[props.node.path] ?? props.depth < 1);
  const style: CSSProperties = { paddingLeft: `${7 + props.depth * 12 + (isFolder ? 0 : 17)}px` };
  const canDragFolder = isFolder;
  const canModify = !isFolder || props.depth > 0 || !isProtectedVaultRoot(props.node.name);
  const isEditing = props.editingPath === props.node.path;
  const menuOpen = props.menuPath === props.node.path;
  const displayName = isFolder ? props.node.name : displayVaultFileName(props.node.name);
  const { t } = useI18n();
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
    props.onSetDragSource(path);
    event.dataTransfer.setData("text/plain", path);
    event.dataTransfer.effectAllowed = "move";
  }

  function dragSourceFromEvent(event: DragEvent<HTMLElement>): string {
    return props.dragSourcePath || event.dataTransfer.getData("text/plain");
  }

  function finishDrag() {
    props.onSetDragSource("");
    props.onSetDropTarget("");
  }

  function handleFolderDragOver(event: DragEvent<HTMLElement>) {
    const sourcePath = dragSourceFromEvent(event);
    if (!canReorderVaultEntry(sourcePath, props.node.path) && !isDroppableVaultTarget(sourcePath, props.node.path)) {
      props.onSetDropTarget("");
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    props.onSetDropTarget(props.node.path);
  }

  function handleFolderDrop(event: DragEvent<HTMLElement>) {
    const sourcePath = dragSourceFromEvent(event);
    if (!canReorderVaultEntry(sourcePath, props.node.path) && !isDroppableVaultTarget(sourcePath, props.node.path)) {
      finishDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (canReorderVaultEntry(sourcePath, props.node.path)) {
      props.onReorderEntry(sourcePath, props.node.path);
      return;
    }
    props.onMoveEntry(sourcePath, props.node.path);
  }

  function handleFileDragOver(event: DragEvent<HTMLElement>) {
    const sourcePath = dragSourceFromEvent(event);
    if (!canReorderVaultEntry(sourcePath, props.node.path)) {
      props.onSetDropTarget("");
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    props.onSetDropTarget(props.node.path);
  }

  function handleFileDrop(event: DragEvent<HTMLElement>) {
    const sourcePath = dragSourceFromEvent(event);
    if (!canReorderVaultEntry(sourcePath, props.node.path)) {
      finishDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onReorderEntry(sourcePath, props.node.path);
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
    <div
      className="sidebar-tree-menu"
      role="menu"
      style={props.menuAnchor ? { left: props.menuAnchor.left, top: props.menuAnchor.top } : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      {isFolder ? (
        <>
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onCreateNote(props.node.path);
          }}>
            <ThemedPixelIcon pixelIcon="document" professionalIcon={FilePlus2} professionalSize={13} pixelSize={15} />
            <span>{t("vault.newNote")}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onCreateFolder(props.node.path);
          }}>
            <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderPlus} professionalSize={13} pixelSize={15} />
            <span>{t("vault.newFolder")}</span>
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
            <span>{t("vault.rename")}</span>
          </button>
          <button className="danger" type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onDeleteEntry(props.node.path, props.node.kind, displayName);
          }}>
            <Trash2 size={13} />
            <span>{t("common.delete")}</span>
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
          onDragEnd={finishDrag}
          onDragOver={handleFolderDragOver}
          onDragStart={(event) => canDragFolder ? startDrag(event, props.node.path) : event.preventDefault()}
          onDrop={handleFolderDrop}
          onClick={() => props.onToggleNode(props.node.path, Boolean(nodeOpen))}
          onKeyDown={handleNodeKeyDown}
          aria-expanded={nodeOpen}
        >
          <ChevronRight className="sidebar-tree-chevron" size={13} data-open={nodeOpen ? "true" : "false"} />
          <ThemedPixelIcon pixelIcon="folder" professionalIcon={Folder} professionalSize={13} pixelSize={15} />
          {label}
          <button
            className="sidebar-tree-more"
            type="button"
            aria-label={`${props.node.name} ${t("conversation.more")}`}
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onOpenMenu(menuOpen ? "" : props.node.path, menuAnchorFromButton(event.currentTarget));
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
                dragSourcePath={props.dragSourcePath}
                dropTargetPath={props.dropTargetPath}
                editingPath={props.editingPath}
                menuAnchor={props.menuAnchor}
                menuPath={props.menuPath}
                onCancelRename={props.onCancelRename}
                onCreateFolder={props.onCreateFolder}
                onCreateNote={props.onCreateNote}
                onDeleteEntry={props.onDeleteEntry}
                onFocusKnowledge={props.onFocusKnowledge}
                onOpenMenu={props.onOpenMenu}
                onRenameEntry={props.onRenameEntry}
                onReorderEntry={props.onReorderEntry}
                onStartRename={props.onStartRename}
                onMoveEntry={props.onMoveEntry}
                onSelectFolder={props.onSelectFolder}
                onSetDropTarget={props.onSetDropTarget}
                onSetDragSource={props.onSetDragSource}
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
      data-drop-target={props.dropTargetPath === props.node.path ? "true" : "false"}
      draggable={!isEditing}
      role="button"
      style={style}
      onDragLeave={() => props.onSetDropTarget("")}
      onDragEnd={finishDrag}
      onDragOver={handleFileDragOver}
      onDragStart={(event) => startDrag(event, props.node.path)}
      onDrop={handleFileDrop}
      onClick={() => {
        if (isEditing) return;
        props.onSelectFolder(parentVaultPath(props.node.document));
        props.node.document?.id && props.onFocusKnowledge(props.node.document.id);
      }}
      onKeyDown={handleNodeKeyDown}
      tabIndex={0}
      title={props.node.path}
    >
      <ThemedPixelIcon pixelIcon="document" professionalIcon={FileText} professionalSize={13} pixelSize={15} />
      {label}
      <button
        className="sidebar-tree-more"
        type="button"
        aria-label={`${displayName} ${t("conversation.more")}`}
        aria-expanded={menuOpen}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onOpenMenu(menuOpen ? "" : props.node.path, menuAnchorFromButton(event.currentTarget));
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      {actionMenu}
    </div>
  );
}

function buildVaultTree(documents: any[], folders: VaultFolderRecord[] = [], order: VaultTreeOrder = {}): VaultTreeNode[] {
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
    if (segments[segments.length - 1].startsWith(".")) continue;
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
  sortVaultTree(root.children, "", order);
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

function parentVaultPathFromTreePath(path: string): string {
  const segments = safeVaultTreePath(path).split("/").filter(Boolean);
  if (segments.length <= 1) return "";
  return segments.slice(0, -1).join("/");
}

function rootVaultPath(path: string): string {
  return safeVaultTreePath(path).split("/").filter(Boolean)[0] || "OpenGrove";
}

function isDroppableVaultTarget(sourcePath: string, targetFolderPath: string): boolean {
  const source = safeVaultTreePath(sourcePath);
  const target = safeVaultTreePath(targetFolderPath);
  if (!source || !target || source === target) return false;
  if (canReorderVaultEntry(source, target)) return false;
  if (rootVaultPath(source) !== rootVaultPath(target)) return false;
  return !target.startsWith(`${source}/`);
}

function canReorderVaultEntry(sourcePath: string, targetPath: string): boolean {
  const source = safeVaultTreePath(sourcePath);
  const target = safeVaultTreePath(targetPath);
  return Boolean(source && target && source !== target && parentVaultPathFromTreePath(source) === parentVaultPathFromTreePath(target));
}

function safeVaultTreePath(path: unknown): string {
  if (typeof path !== "string") return "";
  return path.replace(/\\/g, "/").split("/").map((segment) => segment.trim()).filter(Boolean).join("/");
}

function displayVaultFileName(name: string): string {
  return name.replace(/\.(?:md|markdown|mdx)$/i, "");
}

function menuAnchorFromButton(button: HTMLElement): VaultMenuAnchor {
  const rect = button.getBoundingClientRect();
  const menuWidth = 168;
  const menuHeight = 188;
  const margin = 8;
  const left = Math.min(Math.max(margin, rect.right - menuWidth), window.innerWidth - menuWidth - margin);
  const top = window.innerHeight - rect.bottom - margin >= menuHeight
    ? rect.bottom + 6
    : Math.max(margin, rect.top - menuHeight - 6);
  return { left, top };
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

function sortVaultTree(nodes: VaultTreeNode[], parentPath: string, order: VaultTreeOrder): void {
  const orderedPaths = order[safeVaultTreePath(parentPath)] ?? [];
  const orderIndex = new Map(orderedPaths.map((path, index) => [path, index]));
  nodes.sort((left, right) => {
    const leftIndex = orderIndex.get(left.path);
    const rightIndex = orderIndex.get(right.path);
    if (leftIndex !== undefined || rightIndex !== undefined) {
      if (leftIndex === undefined) return 1;
      if (rightIndex === undefined) return -1;
      return leftIndex - rightIndex;
    }
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name, "zh-CN");
  });
  nodes.forEach((node) => sortVaultTree(node.children, node.path, order));
}

function childPathsForParent(nodes: VaultTreeNode[], parentPath: string): string[] {
  const parent = findVaultTreeNodeByPath(nodes, parentPath);
  const children = parentPath ? parent?.children ?? [] : nodes;
  return children.map((node) => node.path);
}

function findVaultTreeNodeByPath(nodes: VaultTreeNode[], path: string): VaultTreeNode | undefined {
  const target = safeVaultTreePath(path);
  if (!target) return undefined;
  for (const node of nodes) {
    if (node.path === target) return node;
    const found = findVaultTreeNodeByPath(node.children, target);
    if (found) return found;
  }
  return undefined;
}

const PROTECTED_VAULT_ROOTS_SET = new Set(["OpenGrove", "Codex", "Claude", "Hermes"]);
function isProtectedVaultRoot(name: string): boolean {
  return PROTECTED_VAULT_ROOTS_SET.has(name);
}
