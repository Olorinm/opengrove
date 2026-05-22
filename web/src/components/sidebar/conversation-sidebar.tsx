import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ListChecks,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { UiThread } from "../../store";
import { useI18n } from "../../i18n";
import { ThemedPixelIcon } from "./app-navigation";
import {
  ConversationSortMenu,
  formatSidebarThreadMeta,
  type ConversationSortKey,
  type SidebarProject,
} from "./conversation-sidebar-model";

type SidebarMenuAnchor = {
  left: number;
  top: number;
};

export interface ConversationSidebarProps {
  projects: SidebarProject[];
  activeThreadId: string;
  activeView: string;
  runningThreadIds?: string[];
  pendingApprovalCount: number;
  collapsedProjectIds: Set<string>;
  allProjectsCollapsed: boolean;
  projectMenuOpenId: string;
  conversationSortMenuOpen: boolean;
  conversationSortKey: ConversationSortKey;
  onToggleAllProjectsCollapsed(): void;
  onOpenConversationSortMenu(): void;
  onCloseConversationSortMenu(): void;
  onSortKeyChange(key: ConversationSortKey): void;
  onOpenNewProject(): void;
  onOpenFolderProject(): void;
  onOpenNewThread(projectId?: string): void;
  onOpenThread(threadId: string): void;
  onToggleProjectCollapsed(projectId: string): void;
  onToggleProjectMenu(projectId: string): void;
  onCloseProjectMenu(): void;
  onRenameProject(project: SidebarProject): void;
  onChangeProjectFolder(project: SidebarProject): void;
  onDeleteProject(project: SidebarProject): void;
  onDeleteThread(thread: UiThread): void;
  folderProjectPending?: boolean;
}

export function ConversationSidebar(props: ConversationSidebarProps) {
  const { t } = useI18n();
  const [projectMenuAnchor, setProjectMenuAnchor] = useState<SidebarMenuAnchor | null>(null);
  const [sortMenuAnchor, setSortMenuAnchor] = useState<SidebarMenuAnchor | null>(null);
  const runningThreadSet = new Set(props.runningThreadIds ?? []);

  useEffect(() => {
    if (!props.projectMenuOpenId) setProjectMenuAnchor(null);
  }, [props.projectMenuOpenId]);

  useEffect(() => {
    if (!props.conversationSortMenuOpen) setSortMenuAnchor(null);
  }, [props.conversationSortMenuOpen]);

  useEffect(() => {
    if (!props.projectMenuOpenId && !props.conversationSortMenuOpen) return;
    const closeMenus = () => {
      if (props.projectMenuOpenId) props.onCloseProjectMenu();
      if (props.conversationSortMenuOpen) props.onCloseConversationSortMenu();
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest(".project-row-menu, .conversation-sort-menu, .project-row-action, .sidebar-mini-action")) return;
      closeMenus();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeMenus, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeMenus, true);
    };
  }, [props.projectMenuOpenId, props.conversationSortMenuOpen, props.onCloseProjectMenu, props.onCloseConversationSortMenu]);

  const sortMenu = props.conversationSortMenuOpen && sortMenuAnchor && typeof document !== "undefined"
    ? createPortal(
        <ConversationSortMenu
          sortKey={props.conversationSortKey}
          style={menuAnchorStyle(sortMenuAnchor)}
          onSortKeyChange={props.onSortKeyChange}
        />,
        document.body,
      )
    : null;

  return (
    <div className="project-section" aria-label={t("app.chat")}>
      <div className="thread-heading-row">
        <span>{t("app.chat")}</span>
        <span className={clsx("thread-heading-actions", props.conversationSortMenuOpen && "active")}>
          <button
            className="sidebar-mini-action"
            type="button"
            onClick={props.onOpenFolderProject}
            disabled={props.folderProjectPending}
            aria-label={t("conversation.newFolderProject")}
            title={t("conversation.newFolderProject")}
          >
            <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderOpen} professionalSize={13} pixelSize={15} />
          </button>
          <button
            className="sidebar-mini-action"
            type="button"
            onClick={props.onToggleAllProjectsCollapsed}
            aria-label={props.allProjectsCollapsed ? t("conversation.expandAll") : t("conversation.collapseAll")}
            title={props.allProjectsCollapsed ? t("conversation.expandAll") : t("conversation.collapseAll")}
          >
            {props.allProjectsCollapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          <button
            className={clsx("sidebar-mini-action", props.conversationSortMenuOpen && "active")}
            type="button"
            onClick={(event) => {
              setSortMenuAnchor(menuAnchorFromButton(event.currentTarget, 164, 78));
              props.onOpenConversationSortMenu();
            }}
            aria-expanded={props.conversationSortMenuOpen}
            aria-label={t("conversation.sortProjects")}
            title={t("conversation.sort")}
          >
            <ListChecks size={13} />
          </button>
          <button className="sidebar-mini-action" type="button" onClick={props.onOpenNewProject} aria-label={t("conversation.newProject")} title={t("conversation.newProject")}>
            <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderPlus} professionalSize={13} pixelSize={15} />
          </button>
          {sortMenu}
        </span>
      </div>
      <div className="project-tree">
        {props.projects.map((project) => (
          <div className="project-group" data-active={project.active ? "true" : "false"} key={project.id}>
            <div className="project-row" data-menu-open={props.projectMenuOpenId === project.id ? "true" : "false"}>
              <button
                className="project-item"
                type="button"
                onClick={() => props.onToggleProjectCollapsed(project.id)}
              >
                <span className="project-item-main">
                  {props.collapsedProjectIds.has(project.id) ? (
                    <ThemedPixelIcon pixelIcon="folder" professionalIcon={Folder} professionalSize={17} pixelSize={20} />
                  ) : (
                    <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderOpen} professionalSize={17} pixelSize={20} />
                  )}
                  <span className="project-item-copy">
                    <span className="project-item-title">{project.title}</span>
                    {project.workspaceRoot ? (
                      <span className="project-item-context" title={t("conversation.projectFolder", { path: project.workspaceRoot })}>
                        {folderNameFromPath(project.workspaceRoot)}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="project-item-count">
                  {project.threads.filter((thread) => !thread.id.startsWith("empty:")).length}
                </span>
              </button>
              <span className="project-row-actions">
                <button
                  className="project-row-action"
                  type="button"
                  onClick={() => props.onOpenNewThread(project.id)}
                  aria-label={`${project.title} · ${t("conversation.newThread")}`}
                  title={t("conversation.newThread")}
                >
                  <ThemedPixelIcon pixelIcon="plus" professionalIcon={SquarePen} professionalSize={14} pixelSize={15} />
                </button>
                <button
                  className="project-row-action"
                  type="button"
                  onClick={(event) => {
                    const opening = props.projectMenuOpenId !== project.id;
                    setProjectMenuAnchor(opening ? menuAnchorFromButton(event.currentTarget, 190, 132) : null);
                    props.onToggleProjectMenu(project.id);
                  }}
                  aria-expanded={props.projectMenuOpenId === project.id}
                  aria-label={`${project.title} · ${t("conversation.more")}`}
                  title={t("conversation.more")}
                >
                  <MoreHorizontal size={14} />
                </button>
              </span>
              {props.projectMenuOpenId === project.id && projectMenuAnchor && typeof document !== "undefined"
                ? createPortal(
                    <div className="project-row-menu" role="menu" style={menuAnchorStyle(projectMenuAnchor)}>
                      <button type="button" role="menuitem" onClick={() => props.onRenameProject(project)}>
                        <Pencil size={14} />
                        {t("conversation.renameProject")}
                      </button>
                      <button type="button" role="menuitem" onClick={() => props.onChangeProjectFolder(project)}>
                        <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderOpen} professionalSize={14} pixelSize={15} />
                        {t("conversation.changeProjectFolder")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => props.onDeleteProject(project)}
                        disabled={project.threads.some((thread) => runningThreadSet.has(thread.id))}
                      >
                        <Trash2 size={13} />
                        {t("common.remove")}
                      </button>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
            {!props.collapsedProjectIds.has(project.id) ? (
              <div className="project-thread-list">
                {project.threads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === props.activeThreadId && props.activeView === "chat"}
                    running={runningThreadSet.has(thread.id)}
                    pendingApprovalCount={props.pendingApprovalCount}
                    onOpenThread={props.onOpenThread}
                    onOpenNewThread={props.onOpenNewThread}
                    onDeleteThread={props.onDeleteThread}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function folderNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function menuAnchorStyle(anchor: SidebarMenuAnchor): CSSProperties {
  return { left: anchor.left, top: anchor.top };
}

function menuAnchorFromButton(button: HTMLElement, menuWidth: number, menuHeight: number): SidebarMenuAnchor {
  const rect = button.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(Math.max(margin, rect.right - menuWidth), window.innerWidth - menuWidth - margin);
  const top = window.innerHeight - rect.bottom - margin >= menuHeight
    ? rect.bottom + 6
    : Math.max(margin, rect.top - menuHeight - 6);
  return { left, top };
}

function ThreadRow(props: {
  thread: UiThread;
  active: boolean;
  running: boolean;
  pendingApprovalCount: number;
  onOpenThread(threadId: string): void;
  onOpenNewThread(projectId?: string): void;
  onDeleteThread(thread: UiThread): void;
}) {
  const empty = props.thread.id.startsWith("empty:");
  const { t } = useI18n();
  const title = props.thread.title || t("conversation.newThreadFallback");
  return (
    <div className="thread-row">
      <button
        className={clsx("thread-item", props.active && "active", props.running && "running")}
        type="button"
        onClick={() => (empty ? props.onOpenNewThread(props.thread.projectId) : props.onOpenThread(props.thread.id))}
      >
        <span>{title}</span>
        <span className="thread-item-meta">
          {props.running ? (
            <span className="thread-running-indicator" aria-label={t("settings.running")} />
          ) : props.active && props.pendingApprovalCount ? (
            `${props.pendingApprovalCount} ${t("conversation.pendingApproval")}`
          ) : (
            formatSidebarThreadMeta(props.thread, t)
          )}
        </span>
      </button>
      {!empty ? (
        <button
          className="sidebar-delete-action"
          type="button"
          onClick={() => props.onDeleteThread(props.thread)}
          disabled={props.running}
          aria-label={`${t("conversation.deleteThread")} ${title}`}
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </div>
  );
}
