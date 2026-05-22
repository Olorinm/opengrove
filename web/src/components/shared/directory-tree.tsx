import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, FilePlus2, FileText, Folder, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export type DirectoryTreeNode<TData = unknown> = {
  id: string;
  name: string;
  kind: "folder" | "file";
  path: string;
  children?: Array<DirectoryTreeNode<TData>>;
  data?: TData;
};

export type DirectoryTreeMenuAnchor = {
  left: number;
  top: number;
};

export type DirectoryTreeMenuState = DirectoryTreeMenuAnchor & {
  path: string;
};

export type DirectoryTreeLabels = {
  more: string;
  newFile: string;
  newFolder: string;
  rename: string;
  delete: string;
};

export type DirectoryTreeMenuAction = "new-file" | "new-folder" | "rename" | "delete";

type DirectoryTreeNodeContext<TData> = {
  depth: number;
  displayName: string;
  isOpen: boolean;
  node: DirectoryTreeNode<TData>;
};

export type DirectoryTreeProps<TData = unknown> = {
  nodes: Array<DirectoryTreeNode<TData>>;
  labels: DirectoryTreeLabels;
  openPaths: Record<string, boolean>;
  dragSourcePath: string;
  dropTargetPath: string;
  editingPath?: string;
  forceOpen?: boolean;
  menuState: DirectoryTreeMenuState | null;
  asFragment?: boolean;
  initialDepth?: number;
  className?: string;
  itemClassName?: string | ((node: DirectoryTreeNode<TData>, depth: number) => string);
  rowClassName?: string | ((node: DirectoryTreeNode<TData>, depth: number) => string);
  childrenClassName?: string;
  pathDataAttribute?: string;
  defaultOpen?(node: DirectoryTreeNode<TData>, depth: number): boolean;
  displayName?(node: DirectoryTreeNode<TData>): string;
  isActive?(node: DirectoryTreeNode<TData>, depth: number): boolean;
  canCreateIn?(node: DirectoryTreeNode<TData>, depth: number): boolean;
  canModify?(node: DirectoryTreeNode<TData>, depth: number): boolean;
  canDrag?(node: DirectoryTreeNode<TData>, depth: number): boolean;
  canDropOn?(sourcePath: string, target: DirectoryTreeNode<TData>, depth: number): boolean;
  renderIcon?(context: DirectoryTreeNodeContext<TData>): ReactNode;
  renderMenuIcon?(action: DirectoryTreeMenuAction, node: DirectoryTreeNode<TData>): ReactNode;
  onCancelRename(): void;
  onCreateFile(parentPath: string, node: DirectoryTreeNode<TData>): void;
  onCreateFolder(parentPath: string, node: DirectoryTreeNode<TData>): void;
  onDeleteEntry(node: DirectoryTreeNode<TData>, displayName: string): void;
  onDrop(sourcePath: string, target: DirectoryTreeNode<TData>, depth: number): void;
  onOpenMenu(path: string, anchor?: DirectoryTreeMenuAnchor): void;
  onRenameEntry(sourcePath: string, name: string, node: DirectoryTreeNode<TData>): void;
  onSelectFile(node: DirectoryTreeNode<TData>): void;
  onSelectFolder?(node: DirectoryTreeNode<TData>): void;
  onSetDragSource(path: string): void;
  onSetDropTarget(path: string): void;
  onStartRename(sourcePath: string, node: DirectoryTreeNode<TData>): void;
  onToggleFolder(path: string, currentlyOpen: boolean, node: DirectoryTreeNode<TData>): void;
};

export function DirectoryTree<TData = unknown>(props: DirectoryTreeProps<TData>) {
  const menuPath = props.menuState?.path ?? "";

  useEffect(() => {
    if (!menuPath) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(".sidebar-tree-menu") || target?.closest(".sidebar-tree-more")) return;
      props.onOpenMenu("");
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") props.onOpenMenu("");
    };
    window.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuPath, props.onOpenMenu]);

  const nodes = props.nodes.map((node) => (
    <DirectoryTreeNodeView
      {...props}
      depth={props.initialDepth ?? 0}
      key={node.id || node.path}
      node={node}
    />
  ));
  if (props.asFragment) {
    return <>{nodes}</>;
  }
  return <div className={props.className ?? "sidebar-library-files"}>{nodes}</div>;
}

function DirectoryTreeNodeView<TData>(props: DirectoryTreeProps<TData> & {
  depth: number;
  node: DirectoryTreeNode<TData>;
}) {
  const isFolder = props.node.kind === "folder";
  const displayName = props.displayName?.(props.node) ?? props.node.name;
  const nodeOpen = Boolean(props.forceOpen || (props.openPaths[props.node.path] ?? (props.defaultOpen?.(props.node, props.depth) ?? props.depth < 1)));
  const isEditing = props.editingPath === props.node.path;
  const menuOpen = props.menuState?.path === props.node.path;
  const isActive = props.isActive?.(props.node, props.depth) ?? false;
  const canCreate = isFolder && (props.canCreateIn?.(props.node, props.depth) ?? true);
  const canModify = props.canModify?.(props.node, props.depth) ?? true;
  const canDrag = !isEditing && (props.canDrag?.(props.node, props.depth) ?? true);
  const style: CSSProperties = { paddingLeft: `${7 + props.depth * 12 + (isFolder ? 0 : 17)}px` };
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

  function commitRename() {
    const nextName = draftName.trim();
    if (!nextName || nextName === displayName) {
      props.onCancelRename();
      return;
    }
    props.onRenameEntry(props.node.path, nextName, props.node);
  }

  function startDrag(event: DragEvent<HTMLElement>) {
    if (!canDrag) {
      event.preventDefault();
      return;
    }
    props.onSetDragSource(props.node.path);
    event.dataTransfer.setData("text/plain", props.node.path);
    event.dataTransfer.effectAllowed = "move";
  }

  function dragSourceFromEvent(event: DragEvent<HTMLElement>): string {
    return props.dragSourcePath || event.dataTransfer.getData("text/plain");
  }

  function finishDrag() {
    props.onSetDragSource("");
    props.onSetDropTarget("");
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    const sourcePath = dragSourceFromEvent(event);
    if (!props.canDropOn?.(sourcePath, props.node, props.depth)) {
      props.onSetDropTarget("");
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    props.onSetDropTarget(props.node.path);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    const sourcePath = dragSourceFromEvent(event);
    if (!props.canDropOn?.(sourcePath, props.node, props.depth)) {
      finishDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    props.onDrop(sourcePath, props.node, props.depth);
    finishDrag();
  }

  function selectOrToggle() {
    if (isEditing) return;
    if (isFolder) {
      props.onSelectFolder?.(props.node);
      props.onToggleFolder(props.node.path, Boolean(nodeOpen), props.node);
      return;
    }
    props.onSelectFile(props.node);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isEditing) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectOrToggle();
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

  const hasMenuActions = canCreate || canModify;
  const actionMenuContent = (
    <div
      className="sidebar-tree-menu"
      role="menu"
      style={props.menuState ? { left: props.menuState.left, top: props.menuState.top } : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      {canCreate ? (
        <>
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onCreateFile(props.node.path, props.node);
          }}>
            {props.renderMenuIcon?.("new-file", props.node) ?? <FilePlus2 size={13} />}
            <span>{props.labels.newFile}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onCreateFolder(props.node.path, props.node);
          }}>
            {props.renderMenuIcon?.("new-folder", props.node) ?? <FolderPlus size={13} />}
            <span>{props.labels.newFolder}</span>
          </button>
        </>
      ) : null}
      {canCreate && canModify ? <div className="sidebar-tree-menu-separator" /> : null}
      {canModify ? (
        <>
          <button type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onStartRename(props.node.path, props.node);
          }}>
            {props.renderMenuIcon?.("rename", props.node) ?? <Pencil size={13} />}
            <span>{props.labels.rename}</span>
          </button>
          <button className="danger" type="button" role="menuitem" onClick={() => {
            props.onOpenMenu("");
            props.onDeleteEntry(props.node, displayName);
          }}>
            {props.renderMenuIcon?.("delete", props.node) ?? <Trash2 size={13} />}
            <span>{props.labels.delete}</span>
          </button>
        </>
      ) : null}
    </div>
  );
  const actionMenu = menuOpen && typeof document !== "undefined"
    ? createPortal(actionMenuContent, document.body)
    : null;

  const icon = props.renderIcon?.({ depth: props.depth, displayName, isOpen: nodeOpen, node: props.node }) ?? (
    isFolder ? <Folder size={13} /> : <FileText size={14} />
  );
  const rowClassName = [
    "sidebar-library-file",
    isFolder ? "sidebar-tree-folder" : "sidebar-tree-file",
    typeof props.rowClassName === "function" ? props.rowClassName(props.node, props.depth) : props.rowClassName,
  ].filter(Boolean).join(" ");
  const itemClassName = [
    "sidebar-vault-tree-item",
    typeof props.itemClassName === "function" ? props.itemClassName(props.node, props.depth) : props.itemClassName,
  ].filter(Boolean).join(" ");
  const pathAttribute = props.pathDataAttribute ? { [props.pathDataAttribute]: props.node.path } : {};

  const moreButton = hasMenuActions ? (
    <button
      className="sidebar-tree-more"
      type="button"
      aria-label={`${displayName} ${props.labels.more}`}
      aria-expanded={menuOpen}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onOpenMenu(menuOpen ? "" : props.node.path, menuAnchorFromButton(event.currentTarget));
      }}
    >
      <MoreHorizontal size={13} />
    </button>
  ) : null;

  const row = (
    <div
      className={rowClassName}
      data-active={isActive ? "true" : "false"}
      data-drop-target={props.dropTargetPath === props.node.path ? "true" : "false"}
      draggable={canDrag}
      role="button"
      style={style}
      tabIndex={0}
      title={props.node.path}
      onClick={selectOrToggle}
      onDragEnd={finishDrag}
      onDragLeave={() => props.onSetDropTarget("")}
      onDragOver={handleDragOver}
      onDragStart={startDrag}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
      aria-expanded={isFolder ? nodeOpen : undefined}
      {...pathAttribute}
    >
      {isFolder ? <ChevronRight className="sidebar-tree-chevron" size={13} data-open={nodeOpen ? "true" : "false"} /> : null}
      {icon}
      {label}
      {moreButton}
      {actionMenu}
    </div>
  );

  if (!isFolder) {
    return row;
  }

  return (
    <div className={itemClassName}>
      {row}
      {nodeOpen && props.node.children?.length ? (
        <div className={props.childrenClassName ?? "sidebar-vault-tree-children"}>
          {props.node.children.map((child) => (
            <DirectoryTreeNodeView
              {...props}
              depth={props.depth + 1}
              key={child.id || child.path}
              node={child}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function menuAnchorFromButton(button: HTMLElement): DirectoryTreeMenuAnchor {
  const rect = button.getBoundingClientRect();
  const menuWidth = 176;
  const menuHeight = 188;
  const margin = 8;
  const left = Math.min(Math.max(margin, rect.right - menuWidth), window.innerWidth - menuWidth - margin);
  const top = window.innerHeight - rect.bottom - margin >= menuHeight
    ? rect.bottom + 6
    : Math.max(margin, rect.top - menuHeight - 6);
  return { left, top };
}

export function parentDirectoryPaths(path: string): string[] {
  const segments = safeDirectoryTreePath(path).split("/").filter(Boolean);
  const parents: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join("/"));
  }
  return parents;
}

export function parentDirectoryPath(path: string): string {
  const segments = safeDirectoryTreePath(path).split("/").filter(Boolean);
  if (segments.length <= 1) return "";
  return segments.slice(0, -1).join("/");
}

export function safeDirectoryTreePath(path: unknown): string {
  if (typeof path !== "string") return "";
  return path.replace(/\\/g, "/").split("/").map((segment) => segment.trim()).filter(Boolean).join("/");
}

export function findDirectoryTreeElement(path: string, dataAttribute = "data-directory-path"): HTMLElement | undefined {
  const targetPath = safeDirectoryTreePath(path);
  if (!targetPath || typeof document === "undefined") return undefined;
  return Array
    .from(document.querySelectorAll<HTMLElement>(`.sidebar-library-file[${dataAttribute}]`))
    .find((element) => element.getAttribute(dataAttribute) === targetPath);
}
