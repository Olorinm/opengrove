import { Check, Clock, Plus } from "lucide-react";
import type { StoredMessage } from "../../bridge";
import { formatDate, summarize } from "../../format";
import { APP_DEFAULT_PROJECT_ID, APP_DEFAULT_PROJECT_TITLE } from "../../identity";
import type { UiProject, UiThread } from "../../store";

export type ConversationSortKey = "createdAt" | "updatedAt";
export type SidebarProject = UiProject & { active: boolean; threads: UiThread[] };

export function ConversationSortMenu(props: {
  sortKey: ConversationSortKey;
  onSortKeyChange(key: ConversationSortKey): void;
}) {
  return (
    <div className="conversation-sort-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => props.onSortKeyChange("createdAt")}>
        <Plus size={14} />
        <span>按创建时间</span>
        {props.sortKey === "createdAt" ? <Check size={14} /> : null}
      </button>
      <button type="button" role="menuitem" onClick={() => props.onSortKeyChange("updatedAt")}>
        <Clock size={14} />
        <span>按更新时间</span>
        {props.sortKey === "updatedAt" ? <Check size={14} /> : null}
      </button>
    </div>
  );
}



export function buildSidebarProjectTree(
  projects: UiProject[],
  threads: UiThread[],
  activeProjectId: string,
  activeThreadId: string,
  activeMessages: StoredMessage[],
): SidebarProject[] {
  const normalizedProjects: UiProject[] = projects.length
    ? projects
    : [
        {
          id: APP_DEFAULT_PROJECT_ID,
          title: APP_DEFAULT_PROJECT_TITLE,
          updatedAt: new Date().toISOString(),
        },
      ];
  const normalizedThreads = threads.length
    ? threads
    : [
        {
          id: activeThreadId,
          projectId: activeProjectId || normalizedProjects[0].id,
          title: deriveSidebarThreadTitle(activeMessages),
          updatedAt: new Date().toISOString(),
          messages: activeMessages,
        },
      ];

  return normalizedProjects.map((project) => {
    const projectThreads = normalizedThreads
      .filter((thread) => thread.projectId === project.id)
      .sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
    return {
      ...project,
      active: project.id === activeProjectId || projectThreads.some((thread) => thread.id === activeThreadId),
      threads: projectThreads.length ? projectThreads : [createSidebarEmptyThread(project.id)],
    };
  });
}



export function sortSidebarThreads(threads: UiThread[], sortKey: ConversationSortKey): UiThread[] {
  return [...threads].sort((left, right) => {
    const delta = getSidebarThreadSortTime(left, sortKey) - getSidebarThreadSortTime(right, sortKey);
    if (delta === 0) {
      return String(left.title || "").localeCompare(String(right.title || ""));
    }
    return -delta;
  });
}



export function getSidebarThreadSortTime(thread: UiThread, sortKey: ConversationSortKey): number {
  if (sortKey === "createdAt") {
    return getSidebarThreadCreatedAt(thread);
  }
  const updatedAt = Date.parse(thread.updatedAt || "");
  return Number.isFinite(updatedAt) ? updatedAt : getSidebarThreadCreatedAt(thread);
}



export function getSidebarThreadCreatedAt(thread: UiThread): number {
  const match = /^standalone:([a-z0-9]+):/.exec(thread.id);
  if (match?.[1]) {
    const timestamp = Number.parseInt(match[1], 36);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  const updatedAt = Date.parse(thread.updatedAt || "");
  return Number.isFinite(updatedAt) ? updatedAt : 0;
}



export function createSidebarEmptyThread(projectId: string): UiThread {
  return {
    id: `empty:${projectId}`,
    projectId,
    title: "新线程",
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}



export function deriveSidebarThreadTitle(messages: StoredMessage[]): string {
  const userMessage = messages.find((message) => message.role === "user" && message.text.trim());
  if (!userMessage) {
    return "新线程";
  }
  return summarize(userMessage.text, 28);
}



export function projectSidebarContextLabel(project: UiProject): string {
  if (project.title === APP_DEFAULT_PROJECT_TITLE) {
    return "代码项目";
  }
  return "本地项目";
}



export function formatSidebarThreadMeta(thread: UiThread): string {
  const updatedAt = Date.parse(thread.updatedAt || "");
  if (!Number.isFinite(updatedAt)) {
    return "本地";
  }
  const ageMs = Date.now() - updatedAt;
  if (ageMs < 0 || ageMs < 24 * 60 * 60 * 1000) {
    return "今天";
  }
  const days = Math.max(1, Math.round(ageMs / (24 * 60 * 60 * 1000)));
  if (days <= 30) {
    return `${days} 天`;
  }
  return formatDate(thread.updatedAt);
}
