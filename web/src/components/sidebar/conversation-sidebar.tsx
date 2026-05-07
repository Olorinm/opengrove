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
import {
  ConversationSortMenu,
  formatSidebarThreadMeta,
  projectSidebarContextLabel,
  type ConversationSortKey,
  type SidebarProject,
} from "./conversation-sidebar-model";

export interface ConversationSidebarProps {
  projects: SidebarProject[];
  activeThreadId: string;
  activeView: string;
  sending: boolean;
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
  return (
    <div className="project-section" aria-label="对话">
      <div className="thread-heading-row">
        <span>对话</span>
        <span className="thread-heading-actions">
          <button
            className="sidebar-mini-action"
            type="button"
            onClick={props.onToggleAllProjectsCollapsed}
            aria-label={props.allProjectsCollapsed ? "展开所有项目" : "收起所有项目"}
            title={props.allProjectsCollapsed ? "展开所有项目" : "收起所有项目"}
          >
            {props.allProjectsCollapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          <button
            className={clsx("sidebar-mini-action", props.conversationSortMenuOpen && "active")}
            type="button"
            onClick={props.onOpenConversationSortMenu}
            aria-expanded={props.conversationSortMenuOpen}
            aria-label="项目排序"
            title="排序"
          >
            <ListChecks size={13} />
          </button>
          <button className="sidebar-mini-action" type="button" onClick={props.onOpenNewProject} disabled={props.sending} aria-label="新建项目" title="新建项目">
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
                    <span className="project-item-context">{projectSidebarContextLabel(project)}</span>
                  </span>
                </span>
                <span className="project-item-count">{project.threads.length}</span>
              </button>
              <span className="project-row-actions">
                <button
                  className="project-row-action"
                  type="button"
                  onClick={() => props.onOpenNewThread(project.id)}
                  disabled={props.sending}
                  aria-label={`在 ${project.title} 中新建对话`}
                  title="新对话"
                >
                  <SquarePen size={14} />
                </button>
                <button
                  className="project-row-action"
                  type="button"
                  onClick={() => props.onToggleProjectMenu(project.id)}
                  aria-expanded={props.projectMenuOpenId === project.id}
                  aria-label={`${project.title} 更多操作`}
                  title="更多"
                >
                  <MoreHorizontal size={14} />
                </button>
              </span>
              {props.projectMenuOpenId === project.id ? (
                <div className="project-row-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => props.onRenameProject(project)}>
                    <Pencil size={14} />
                    重命名项目
                  </button>
                  <button type="button" role="menuitem" onClick={() => props.onDeleteProject(project)} disabled={props.sending}>
                    <Trash2 size={13} />
                    移除
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
                    pendingApprovalCount={props.pendingApprovalCount}
                    sending={props.sending}
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
  pendingApprovalCount: number;
  sending: boolean;
  onOpenThread(threadId: string): void;
  onOpenNewThread(projectId?: string): void;
  onDeleteThread(thread: UiThread): void;
}) {
  const empty = props.thread.id.startsWith("empty:");
  return (
    <div className="thread-row">
      <button
        className={clsx("thread-item", props.active && "active")}
        type="button"
        onClick={() => (empty ? props.onOpenNewThread(props.thread.projectId) : props.onOpenThread(props.thread.id))}
      >
        <span>{props.thread.title || "新线程"}</span>
        <span>
          {props.active && props.pendingApprovalCount
            ? `${props.pendingApprovalCount} 待确认`
            : formatSidebarThreadMeta(props.thread)}
        </span>
      </button>
      {!empty ? (
        <button
          className="sidebar-delete-action"
          type="button"
          onClick={() => props.onDeleteThread(props.thread)}
          disabled={props.sending}
          aria-label={`删除对话 ${props.thread.title || "新线程"}`}
        >
          <Trash2 size={13} />
        </button>
      ) : null}
    </div>
  );
}
