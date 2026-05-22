import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, FileText, Folder, FolderPlus, ImageIcon, ListChevronsDownUp, ListChevronsUpDown, Loader2, Video } from "lucide-react";
import { apiUrl } from "../../api-base";
import {
  createMountedAppFileSystemEntry,
  deleteMountedAppFileSystemEntry,
  getMountedAppFile,
  listMountedAppFiles,
  moveMountedAppFileSystemEntry,
  renameMountedAppFileSystemEntry,
  type ExtensionItemRecord,
  type MountedAppFileEntry,
  type MountedAppFileResponse,
  type MountedAppFileSystemResponse,
  type MountedAppFilesResponse,
} from "../../bridge";
import { DirectoryPanel } from "../shared/directory-panel";
import { FilePreviewPanel } from "../shared/file-preview-panel";
import { WorkspaceWorkbenchLayout } from "../shared/workspace-workbench-layout";
import {
  DirectoryTree,
  findDirectoryTreeElement,
  parentDirectoryPath,
  parentDirectoryPaths,
  type DirectoryTreeMenuAnchor,
  type DirectoryTreeMenuState,
  type DirectoryTreeNode,
} from "../shared/directory-tree";

type MountedAppTreeNode = DirectoryTreeNode<MountedAppFileEntry>;

export function MountedAppWorkbench(props: {
  app: ExtensionItemRecord | undefined;
  selectedPath: string;
  corePanel: ReactNode;
  onSelectedPathChange(path: string): void;
}) {
  const appId = props.app?.name || "";
  const queryClient = useQueryClient();
  const [editingPath, setEditingPath] = useState("");
  const [openPaths, setOpenPaths] = useState<Record<string, boolean>>(() => readStoredMountedAppOpenPaths(appId));
  const filesQuery = useQuery<MountedAppFilesResponse>({
    queryKey: ["mounted-app-files", appId],
    queryFn: () => listMountedAppFiles(appId),
    enabled: Boolean(appId),
    refetchInterval: 2_000,
  });
  const fileQuery = useQuery<MountedAppFileResponse>({
    queryKey: ["mounted-app-file", appId, props.selectedPath],
    queryFn: () => getMountedAppFile(appId, props.selectedPath),
    enabled: Boolean(appId && props.selectedPath),
    refetchInterval: 3_000,
  });
  const selectedEntry = useMemo(
    () => findEntry(filesQuery.data?.entries ?? [], props.selectedPath),
    [filesQuery.data?.entries, props.selectedPath],
  );

  function mergeFileSystemResult(result: MountedAppFileSystemResponse) {
    queryClient.setQueryData<MountedAppFilesResponse>(["mounted-app-files", appId], (previous) => previous
      ? { ...previous, entries: result.entries, truncated: result.truncated }
      : previous);
    void queryClient.invalidateQueries({ queryKey: ["mounted-app-file", appId] });
  }

  const createEntryMutation = useMutation({
    mutationFn: (payload: { kind: "file" | "folder"; parentPath: string }) =>
      createMountedAppFileSystemEntry(appId, {
        kind: payload.kind,
        parentPath: payload.parentPath,
        name: payload.kind === "folder" ? "新建文件夹" : "未命名.md",
        content: payload.kind === "file" ? "# 未命名\n" : undefined,
      }),
    onSuccess(result) {
      mergeFileSystemResult(result);
      if (result.entry?.path) {
        setEditingPath(result.entry.path);
        if (result.entry.kind === "file") props.onSelectedPathChange(result.entry.path);
      }
    },
  });

  const renameEntryMutation = useMutation({
    mutationFn: (payload: { sourcePath: string; name: string }) =>
      renameMountedAppFileSystemEntry(appId, payload),
    onSuccess(result, payload) {
      mergeFileSystemResult(result);
      setEditingPath("");
      if (props.selectedPath === payload.sourcePath && result.entry?.path) {
        props.onSelectedPathChange(result.entry.path);
      }
    },
    onError() {
      setEditingPath("");
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (payload: { sourcePath: string }) => deleteMountedAppFileSystemEntry(appId, payload),
    onSuccess(result, payload) {
      mergeFileSystemResult(result);
      if (props.selectedPath === payload.sourcePath || props.selectedPath.startsWith(`${payload.sourcePath}/`)) {
        props.onSelectedPathChange("");
      }
    },
  });

  const moveEntryMutation = useMutation({
    mutationFn: (payload: { sourcePath: string; targetParentPath: string }) =>
      moveMountedAppFileSystemEntry(appId, payload),
    onSuccess(result, payload) {
      mergeFileSystemResult(result);
      if (result.entry?.path && (props.selectedPath === payload.sourcePath || props.selectedPath.startsWith(`${payload.sourcePath}/`))) {
        props.onSelectedPathChange(`${result.entry.path}${props.selectedPath.slice(payload.sourcePath.length)}`);
      }
    },
  });

  useEffect(() => {
    props.onSelectedPathChange("");
  }, [appId]);

  useEffect(() => {
    setOpenPaths(readStoredMountedAppOpenPaths(appId));
  }, [appId]);

  useEffect(() => {
    writeStoredMountedAppOpenPaths(appId, openPaths);
  }, [appId, openPaths]);

  if (!props.app) {
    return (
      <div className="mounted-app-empty">
        <strong>选择一个 App</strong>
        <p>挂载的业务 App 会出现在左侧用户 App 区域。</p>
      </div>
    );
  }

  const appInfo = filesQuery.data?.app;
  const entries = filesQuery.data?.entries ?? [];
  const folderPaths = collectFolderPaths(entries);
  const allFoldersOpen = folderPaths.length > 0 && folderPaths.every((path) => openPaths[path] ?? defaultFolderOpen(path));

  function setAllFolders(open: boolean) {
    setOpenPaths((current) => ({
      ...current,
      ...Object.fromEntries(folderPaths.map((path) => [path, open])),
    }));
  }

  return (
    <WorkspaceWorkbenchLayout className="mounted-app-workbench"
      directory={
      <aside className="mounted-app-tree-pane" aria-label={`${props.app.title} 文件目录`}>
        <DirectoryPanel
          title={props.app.title}
          kicker="App"
          className="mounted-app-directory-panel"
          bodyClassName="mounted-app-tree-scroll"
          status={appInfo ? <span title={appInfo.workspaceRoot}>workspace: {appInfo.workspaceRoot}</span> : null}
          actions={(
            <>
              <button
                className="sidebar-mini-action"
                type="button"
                onClick={() => createEntryMutation.mutate({ kind: "file", parentPath: "" })}
                aria-label="新建 Markdown"
                title="新建 Markdown"
              >
                <FilePlus2 size={15} />
              </button>
              <button
                className="sidebar-mini-action"
                type="button"
                onClick={() => createEntryMutation.mutate({ kind: "folder", parentPath: "" })}
                aria-label="新建文件夹"
                title="新建文件夹"
              >
                <FolderPlus size={15} />
              </button>
              <button
                className="sidebar-mini-action"
                type="button"
                disabled={!folderPaths.length}
                onClick={() => setAllFolders(!allFoldersOpen)}
                aria-label={allFoldersOpen ? "全部折叠" : "全部展开"}
                title={allFoldersOpen ? "全部折叠" : "全部展开"}
              >
                {allFoldersOpen ? <ListChevronsDownUp size={13} /> : <ListChevronsUpDown size={13} />}
              </button>
            </>
          )}
        >
          {filesQuery.isLoading ? (
            <div className="mounted-app-tree-state">
              <Loader2 size={15} />
              <span>读取中</span>
            </div>
          ) : entries.length ? (
            <FileTree
              appId={appId}
              editingPath={editingPath}
              entries={entries}
              openPaths={openPaths}
              selectedPath={props.selectedPath}
              onCancelRename={() => setEditingPath("")}
              onCreateEntry={(kind, parentPath) => createEntryMutation.mutate({ kind, parentPath })}
              onDeleteEntry={(entry) => {
                if (!window.confirm(`删除 ${entry.name}？`)) return;
                deleteEntryMutation.mutate({ sourcePath: entry.path });
              }}
              onMoveEntry={(sourcePath, targetParentPath) => moveEntryMutation.mutate({ sourcePath, targetParentPath })}
              onOpenPathsChange={(update) => setOpenPaths(update)}
              onRenameEntry={(sourcePath, name) => renameEntryMutation.mutate({ sourcePath, name })}
              onSelect={props.onSelectedPathChange}
              onStartRename={setEditingPath}
            />
          ) : (
            <div className="mounted-app-tree-state">
              <Folder size={15} />
              <span>还没有文件</span>
            </div>
          )}
        </DirectoryPanel>
      </aside>
      }
      preview={
      <section className="mounted-app-preview-pane" aria-label="文件预览">
        <header className="mounted-app-preview-header">
          <div>
            <span>{selectedEntry?.mimeType || "Preview"}</span>
            <h2>{props.selectedPath || "选择文件预览"}</h2>
          </div>
        </header>
        <div className="mounted-app-preview-body">
          <FilePreviewPanel
            file={fileQuery.data?.file}
            loading={fileQuery.isLoading && Boolean(props.selectedPath)}
            rawUrl={props.selectedPath ? apiUrl(`/apps/${encodeURIComponent(appId)}/raw?${new URLSearchParams({ path: props.selectedPath }).toString()}`) : undefined}
            selectedPath={props.selectedPath}
          />
        </div>
      </section>
      }
      chat={
      <aside className="mounted-app-chat-pane" aria-label={`${props.app.title} 对话`}>
        {props.corePanel}
      </aside>
      }
    />
  );
}

function FileTree(props: {
  appId: string;
  editingPath: string;
  entries: MountedAppFileEntry[];
  openPaths: Record<string, boolean>;
  selectedPath: string;
  onCancelRename(): void;
  onCreateEntry(kind: "file" | "folder", parentPath: string): void;
  onDeleteEntry(entry: MountedAppFileEntry): void;
  onMoveEntry(sourcePath: string, targetParentPath: string): void;
  onOpenPathsChange(update: (current: Record<string, boolean>) => Record<string, boolean>): void;
  onRenameEntry(sourcePath: string, name: string): void;
  onSelect(path: string): void;
  onStartRename(path: string): void;
}) {
  const [menuState, setMenuState] = useState<DirectoryTreeMenuState | null>(null);
  const [dragSourcePath, setDragSourcePath] = useState("");
  const [dropTargetPath, setDropTargetPath] = useState("");
  const nodes = useMemo(() => mountedAppEntriesToNodes(props.entries), [props.entries]);

  useEffect(() => {
    if (!props.selectedPath) return;
    const parents = parentPathsFromMountedAppPath(props.selectedPath);
    if (parents.length) {
      props.onOpenPathsChange((current) => ({
        ...current,
        ...Object.fromEntries(parents.map((path) => [path, true])),
      }));
    }
    scheduleMountedAppPathReveal(props.selectedPath);
  }, [props.selectedPath]);

  function toggleFolder(path: string, currentlyOpen: boolean) {
    props.onOpenPathsChange((current) => ({ ...current, [path]: !currentlyOpen }));
  }

  function openMenu(path: string, anchor?: DirectoryTreeMenuAnchor) {
    if (!path || !anchor) {
      setMenuState(null);
      return;
    }
    setMenuState({ path, ...anchor });
  }

  function moveEntry(sourcePath: string, targetParentPath: string) {
    if (!canMoveMountedAppEntry(sourcePath, targetParentPath)) return;
    setDragSourcePath("");
    setDropTargetPath("");
    props.onMoveEntry(sourcePath, targetParentPath);
  }

  return (
    <div className="mounted-app-file-tree">
      <DirectoryTree
        className="sidebar-library-files mounted-app-sidebar-tree"
        childrenClassName="sidebar-vault-tree-children mounted-app-tree-children"
        itemClassName="mounted-app-file-node"
        rowClassName="mounted-app-tree-row"
        pathDataAttribute="data-mounted-app-path"
        nodes={nodes}
        labels={{
          more: "更多",
          newFile: "新建 Markdown",
          newFolder: "新建文件夹",
          rename: "重命名",
          delete: "删除",
        }}
        openPaths={props.openPaths}
        dragSourcePath={dragSourcePath}
        dropTargetPath={dropTargetPath}
        editingPath={props.editingPath}
        menuState={menuState}
        canDropOn={(sourcePath, target) => target.kind === "folder" && canMoveMountedAppEntry(sourcePath, target.path)}
        defaultOpen={(node) => defaultFolderOpen(node.path)}
        isActive={(node) => node.path === props.selectedPath || (node.kind === "folder" && Boolean(props.selectedPath) && props.selectedPath.startsWith(`${node.path}/`))}
        renderIcon={({ node }) => node.kind === "folder" ? <Folder size={13} /> : fileIcon(node.data)}
        onCancelRename={props.onCancelRename}
        onCreateFile={(parentPath) => props.onCreateEntry("file", parentPath)}
        onCreateFolder={(parentPath) => props.onCreateEntry("folder", parentPath)}
        onDeleteEntry={(node) => {
          if (node.data) props.onDeleteEntry(node.data);
        }}
        onDrop={(sourcePath, target) => moveEntry(sourcePath, target.path)}
        onOpenMenu={openMenu}
        onRenameEntry={(sourcePath, name) => props.onRenameEntry(sourcePath, name)}
        onSelectFile={(node) => props.onSelect(node.path)}
        onSetDragSource={setDragSourcePath}
        onSetDropTarget={setDropTargetPath}
        onStartRename={(sourcePath) => props.onStartRename(sourcePath)}
        onToggleFolder={(path, currentlyOpen) => toggleFolder(path, currentlyOpen)}
      />
    </div>
  );
}

function findEntry(entries: MountedAppFileEntry[], path: string): MountedAppFileEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const child = findEntry(entry.children ?? [], path);
    if (child) return child;
  }
  return undefined;
}

function mountedAppEntriesToNodes(entries: MountedAppFileEntry[]): MountedAppTreeNode[] {
  return entries.map((entry) => ({
    id: entry.path,
    name: entry.name,
    kind: entry.kind === "directory" ? "folder" : "file",
    path: entry.path,
    data: entry,
    children: mountedAppEntriesToNodes(entry.children ?? []),
  }));
}

function fileIcon(entry: MountedAppFileEntry | undefined) {
  const mimeType = entry?.mimeType || "";
  if (mimeType.startsWith("image/")) return <ImageIcon size={14} />;
  if (mimeType.startsWith("video/")) return <Video size={14} />;
  return <FileText size={14} />;
}

function mountedAppOpenPathsStorageKey(appId: string): string {
  return `opengroveMountedAppOpenPaths:${appId || "default"}`;
}

function readStoredMountedAppOpenPaths(appId: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(mountedAppOpenPathsStorageKey(appId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const stored: Record<string, boolean> = {};
    for (const [path, open] of Object.entries(parsed)) {
      if (typeof path === "string" && path && typeof open === "boolean") {
        stored[path] = open;
      }
    }
    return stored;
  } catch {
    return {};
  }
}

function writeStoredMountedAppOpenPaths(appId: string, openPaths: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(mountedAppOpenPathsStorageKey(appId), JSON.stringify(openPaths));
  } catch {
    // The tree remains usable for the current session even if storage is full.
  }
}

function defaultFolderOpen(path: string): boolean {
  return parentPathsFromMountedAppPath(path).length < 1;
}

function parentPathsFromMountedAppPath(path: string): string[] {
  return parentDirectoryPaths(path);
}

function collectFolderPaths(entries: MountedAppFileEntry[]): string[] {
  const output: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "directory") continue;
    output.push(entry.path);
    output.push(...collectFolderPaths(entry.children ?? []));
  }
  return output;
}

function canMoveMountedAppEntry(sourcePath: string, targetParentPath: string): boolean {
  if (!sourcePath || !targetParentPath || sourcePath === targetParentPath) return false;
  const sourceParent = parentMountedAppPath(sourcePath);
  if (sourceParent === targetParentPath) return false;
  return !targetParentPath.startsWith(`${sourcePath}/`);
}

function parentMountedAppPath(path: string): string {
  return parentDirectoryPath(path);
}

function scheduleMountedAppPathReveal(path: string): void {
  if (!path || typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const target = findDirectoryTreeElement(path, "data-mounted-app-path");
      target?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    });
  });
}
