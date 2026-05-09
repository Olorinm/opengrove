import clsx from "clsx";
import {
  Folder,
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
import {
  ConversationSortMenu,
  formatSidebarThreadMeta,
  type ConversationSortKey,
  type SidebarProject,
} from "./conversation-sidebar-model";

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
  onSortKeyChange(key: ConversationSortKey): void;
  onOpenNewProject(): void;
  onOpenNewThread(projectId?: string): void;
  onOpenThread(threadId: string): void;
  onToggleProjectMenu(projectId: string): void;
  onRenameProject(project: SidebarProject): void;
  onDeleteProject(project: SidebarProject): void;
  onDeleteThread(thread: UiThread): void;
}

export function ConversationSidebar(props: ConversationSidebarProps) {
  const { t } = useI18n();
  const runningThreadSet = new Set(props.runningThreadIds ?? []);
  return (
    <div className="project-section" aria-label={t("app.chat")}>
      <div className="thread-heading-row">
        <span>{t("app.chat")}</span>
        <span className={clsx("thread-heading-actions", props.conversationSortMenuOpen && "active")}>
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
            onClick={props.onOpenConversationSortMenu}
            aria-expanded={props.conversationSortMenuOpen}
            aria-label={t("conversation.sortProjects")}
            title={t("conversation.sort")}
          >
            <ListChecks size={13} />
          </button>
          <button className="sidebar-mini-action" type="button" onClick={props.onOpenNewProject} aria-label={t("conversation.newProject")} title={t("conversation.newProject")}>
            <FolderPlus size={13} />
          </button>
          {props.conversationSortMenuOpen ? (
            <ConversationSortMenu
              sortKey={props.conversationSortKey}
              onSortKeyChange={props.onSortKeyChange}
            />
          ) : null}
        </span>
      </div>
      <div className="project-tree">
        {props.projects.map((project) => (
          <div className="project-group" data-active={project.active ? "true" : "false"} key={project.id}>
            <div className="project-row" data-menu-open={props.projectMenuOpenId === project.id ? "true" : "false"}>
              <button
                className="project-item"
                type="button"
                onClick={() => {
                  const firstThread = project.threads[0];
                  if (!firstThread || firstThread.id.startsWith("empty:")) {
                    props.onOpenNewThread(project.id);
                    return;
                  }
                  props.onOpenThread(firstThread.id);
                }}
              >
                <span className="project-item-main">
                  <Folder size={17} />
                  <span className="project-item-copy">
                    <span className="project-item-title">{project.title}</span>
                  </span>
                </span>
                <span className="project-item-count">{project.threads.length}</span>
              </button>
              <span className="project-row-actions">
                <button
                  className="project-row-action"
                  type="button"
                  onClick={() => props.onOpenNewThread(project.id)}
                  aria-label={`${project.title} · ${t("conversation.newThread")}`}
                  title={t("conversation.newThread")}
                >
                  <SquarePen size={14} />
                </button>
                <button
                  className="project-row-action"
                  type="button"
                  onClick={() => props.onToggleProjectMenu(project.id)}
                  aria-expanded={props.projectMenuOpenId === project.id}
                  aria-label={`${project.title} · ${t("conversation.more")}`}
                  title={t("conversation.more")}
                >
                  <MoreHorizontal size={14} />
                </button>
              </span>
              {props.projectMenuOpenId === project.id ? (
                <div className="project-row-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => props.onRenameProject(project)}>
                    <Pencil size={14} />
                    {t("conversation.renameProject")}
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
                </div>
              ) : null}
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
