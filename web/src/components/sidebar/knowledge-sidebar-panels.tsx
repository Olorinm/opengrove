import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FilePlus2, FileText, Folder, FolderCog, FolderPlus, Pencil, Trash2 } from "lucide-react";
import {
  knowledgeVaultPath,
} from "../knowledge/knowledge-model";
import { APP_STORAGE_KEYS } from "../../identity";
import { useI18n } from "../../i18n";
import {
  DirectoryTree,
  findDirectoryTreeElement,
  parentDirectoryPath,
  parentDirectoryPaths,
  safeDirectoryTreePath,
  type DirectoryTreeMenuAnchor,
  type DirectoryTreeMenuState,
  type DirectoryTreeNode,
} from "../shared/directory-tree";
import { ThemedPixelIcon } from "./app-navigation";

type VaultTreeNode = {
  id: string;
  name: string;
  kind: "folder" | "file";
  path: string;
  data?: any;
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

type VaultMenuAnchor = DirectoryTreeMenuAnchor;
type VaultMenuState = DirectoryTreeMenuState;

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
  revealPathRequest?: { id: number; path: string };
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
  const lastRevealPathRequestIdRef = useRef<number>(props.revealPathRequest?.id ?? 0);
  const lastFocusedKnowledgePathRef = useRef("");
  const lastEditingPathRef = useRef(props.editingPath ?? "");
  const tree = useMemo(() => buildVaultTree(props.documents, props.folders ?? [], treeOrder), [props.documents, props.folders, treeOrder]);
  const folderStates = useMemo(() => collectVaultFolderStates(tree), [tree]);
  const folderPaths = useMemo(() => folderStates.map((folder) => folder.path), [folderStates]);
  const focusedDocument = useMemo(
    () => props.documents.find((document) => document?.id === props.focusedKnowledgeId),
    [props.documents, props.focusedKnowledgeId],
  );
  const focusedVaultPath = useMemo(() => focusedDocument ? knowledgeVaultPath(focusedDocument) : "", [focusedDocument]);
  const focusedFolderPath = useMemo(() => parentVaultPath(focusedDocument), [focusedDocument]);
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
    if (!props.revealPathRequest) return;
    if (props.revealPathRequest.id === lastRevealPathRequestIdRef.current) return;
    lastRevealPathRequestIdRef.current = props.revealPathRequest.id;
    const parentPaths = parentVaultPathsFromTreePath(props.revealPathRequest.path);
    if (!parentPaths.length) return;
    setOpenPaths((current) => ({
      ...current,
      ...Object.fromEntries(parentPaths.map((path) => [path, true])),
      ...(isProtectedVaultRoot(rootVaultPath(props.revealPathRequest!.path)) ? { __kernels__: true } : {}),
    }));
    scheduleVaultPathReveal(props.revealPathRequest.path);
  }, [props.revealPathRequest]);

  useEffect(() => {
    if (!props.focusedKnowledgeId || !focusedVaultPath || !focusedFolderPath) return;
    const focusKey = `${props.focusedKnowledgeId}:${focusedVaultPath}`;
    if (focusKey === lastFocusedKnowledgePathRef.current) return;
    lastFocusedKnowledgePathRef.current = focusKey;
    const parentPaths = [...parentVaultPathsFromTreePath(focusedFolderPath), focusedFolderPath];
    setOpenPaths((current) => ({
      ...current,
      ...Object.fromEntries(parentPaths.map((path) => [path, true])),
      ...(isProtectedVaultRoot(rootVaultPath(focusedFolderPath)) ? { __kernels__: true } : {}),
    }));
    scheduleVaultPathReveal(focusedVaultPath);
  }, [focusedFolderPath, focusedVaultPath, props.focusedKnowledgeId]);

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

  const treeLabels = {
    more: t("conversation.more"),
    newFile: t("vault.newNote"),
    newFolder: t("vault.newFolder"),
    rename: t("vault.rename"),
    delete: t("common.delete"),
  };

  const renderTree = (nodes: VaultTreeNode[], initialDepth = 0) => (
    <DirectoryTree
      asFragment
      initialDepth={initialDepth}
      nodes={nodes}
      labels={treeLabels}
      openPaths={openPaths}
      dragSourcePath={dragSourcePath}
      dropTargetPath={dropTargetPath}
      editingPath={props.editingPath}
      forceOpen={props.forceOpen}
      menuState={menuState}
      pathDataAttribute="data-vault-path"
      canModify={(node, depth) => node.kind !== "folder" || depth > 0 || !isProtectedVaultRoot(node.name)}
      canDropOn={(sourcePath, target) => canReorderVaultEntry(sourcePath, target.path) || (target.kind === "folder" && isDroppableVaultTarget(sourcePath, target.path))}
      defaultOpen={(_, depth) => depth < 1}
      displayName={(node) => node.kind === "file" ? displayVaultFileName(node.name) : node.name}
      isActive={(node) => {
        const document = vaultTreeDocument(node);
        return document?.id === props.focusedKnowledgeId || node.path === focusedVaultPath;
      }}
      renderIcon={({ node }) => (
        node.kind === "folder"
          ? <ThemedPixelIcon pixelIcon="folder" professionalIcon={Folder} professionalSize={13} pixelSize={15} />
          : <ThemedPixelIcon pixelIcon="document" professionalIcon={FileText} professionalSize={13} pixelSize={15} />
      )}
      renderMenuIcon={(action) => {
        if (action === "new-file") return <ThemedPixelIcon pixelIcon="document" professionalIcon={FilePlus2} professionalSize={13} pixelSize={15} />;
        if (action === "new-folder") return <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderPlus} professionalSize={13} pixelSize={15} />;
        if (action === "rename") return <Pencil size={13} />;
        return <Trash2 size={13} />;
      }}
      onCancelRename={props.onCancelRename}
      onCreateFile={(parentPath) => props.onCreateNote(parentPath)}
      onCreateFolder={(parentPath) => props.onCreateFolder(parentPath)}
      onDeleteEntry={(node, displayName) => props.onDeleteEntry(node.path, node.kind, displayName)}
      onDrop={(sourcePath, target) => {
        if (canReorderVaultEntry(sourcePath, target.path)) {
          reorderEntry(sourcePath, target.path);
          return;
        }
        if (target.kind === "folder") {
          moveEntryToFolder(sourcePath, target.path);
        }
      }}
      onOpenMenu={openMenu}
      onRenameEntry={(sourcePath, name) => props.onRenameEntry(sourcePath, name)}
      onSelectFile={(node) => {
        const document = vaultTreeDocument(node);
        setSelectedFolderPath(parentVaultPath(document));
        if (document?.id) props.onFocusKnowledge(document.id);
      }}
      onSelectFolder={(node) => setSelectedFolderPath(node.path)}
      onSetDropTarget={setDropTargetPath}
      onSetDragSource={setDragSourcePath}
      onStartRename={(sourcePath) => props.onStartRename(sourcePath)}
      onToggleFolder={(path, currentlyOpen) => toggleNode(path, currentlyOpen)}
    />
  );

  return (
    <section className="sidebar-library-panel" aria-label={t("vault.files")}>
      <div className="sidebar-library-files">
        {userNodes.length ? renderTree(userNodes) : null}
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
                {renderTree(kernelNodes, 1)}
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
        if (shouldUseVaultTreeDocument(child.document, document)) {
          child.document = document;
        }
      }
      current = child;
    });
  }
  sortVaultTree(root.children, "", order);
  return root.children;
}

function shouldUseVaultTreeDocument(existing: any, next: any): boolean {
  if (!existing) return true;
  if (next?.type === "skill" && existing?.type !== "skill") return true;
  if (existing?.type === "skill" && next?.type !== "skill") return false;
  const existingImported = existing?.metadata?.createdBy === "opengrove.import-folder";
  const nextImported = next?.metadata?.createdBy === "opengrove.import-folder";
  if (existingImported !== nextImported) return !nextImported;
  return false;
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

function vaultTreeDocument(node: DirectoryTreeNode<any>): any {
  return (node as VaultTreeNode).document ?? node.data;
}

function parentVaultPathsFromTreePath(path: string): string[] {
  return parentDirectoryPaths(path);
}

function scheduleVaultPathReveal(path: string): void {
  const targetPath = safeVaultTreePath(path);
  if (!targetPath || typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const target = findVaultTreeElement(targetPath) || findVaultTreeElement(parentVaultPathFromTreePath(targetPath));
      target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    });
  });
}

function findVaultTreeElement(path: string): HTMLElement | undefined {
  return findDirectoryTreeElement(path, "data-vault-path");
}

function parentVaultPathFromTreePath(path: string): string {
  return parentDirectoryPath(path);
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
  return safeDirectoryTreePath(path);
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
