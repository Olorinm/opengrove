import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JsonValue, MessagePart, ModelId, StoredMessage, ViewId } from "./bridge";
import type { MessageContext } from "./bridge";
import { createClientId, supportedModel, supportedView } from "./bridge";
import { clamp } from "./format";
import {
  APP_DEFAULT_PROJECT_ID,
  APP_DEFAULT_PROJECT_TITLE,
  APP_STORAGE_KEYS,
} from "./identity";

const MAX_RENDERED_MESSAGES = 80;
const MAX_STORED_JSON_STRING = 8_000;
const MIN_COMPOSER_HEIGHT = 56;
const MAX_COMPOSER_HEIGHT = 88;
const DEFAULT_PROJECT_ID = APP_DEFAULT_PROJECT_ID;
const DEFAULT_PROJECT_TITLE = APP_DEFAULT_PROJECT_TITLE;

export interface UiProject {
  id: string;
  title: string;
  workspaceRoot?: string;
  updatedAt: string;
}

export interface UiThread {
  id: string;
  projectId: string;
  title: string;
  updatedAt: string;
  messages: StoredMessage[];
}

interface UiState {
  model: ModelId;
  messages: StoredMessage[];
  sending: boolean;
  activeView: ViewId;
  projectId: string;
  projects: UiProject[];
  threads: UiThread[];
  threadId: string;
  composerHeight: number;
  contextText: string;
  setModel(model: string): void;
  setView(view: string): void;
  setSending(sending: boolean): void;
  setComposerHeight(height: number): void;
  setContextText(text: string): void;
  clearContext(): void;
  appendMessage(
    role: StoredMessage["role"],
    text: string,
    context?: MessageContext | null,
    options?: { parts?: MessagePart[]; pending?: boolean; runId?: string },
  ): string;
  appendMessageToThread(
    threadId: string,
    role: StoredMessage["role"],
    text: string,
    context?: MessageContext | null,
    options?: { parts?: MessagePart[]; pending?: boolean; runId?: string },
  ): string;
  appendAssistantMessage(): string;
  appendAssistantMessageToThread(threadId: string): string;
  updateMessage(messageId: string, updater: (message: StoredMessage) => void): void;
  updateThreadMessage(threadId: string, messageId: string, updater: (message: StoredMessage) => void): void;
  replaceMessages(messages: StoredMessage[]): void;
  startNewThread(projectId?: string): string;
  startNewProject(options?: { title?: string; workspaceRoot?: string }): string;
  renameProject(projectId: string, title: string): void;
  setProjectWorkspaceRoot(projectId: string, workspaceRoot: string): void;
  selectThread(threadId: string): void;
  deleteThread(threadId: string): void;
  deleteProject(projectId: string): void;
}

function createThreadId(): string {
  return `standalone:${Date.now().toString(36)}:${Math.random().toString(16).slice(2)}`;
}

function trimMessages(messages: StoredMessage[]): StoredMessage[] {
  return sanitizeMessages(messages.slice(-MAX_RENDERED_MESSAGES));
}

function sanitizeMessages(messages: StoredMessage[]): StoredMessage[] {
  return messages
    .filter((message): message is StoredMessage => Boolean(message && typeof message === "object"))
    .map((message) => ({
      ...message,
      text: typeof message.text === "string" ? message.text : "",
      context: message.context ? { ...message.context } : null,
      parts: Array.isArray(message.parts) ? message.parts.map(sanitizeMessagePart) : [],
      pending: Boolean(message.pending),
      runId: typeof message.runId === "string" ? message.runId : "",
      startedAt: typeof message.startedAt === "string" ? message.startedAt : undefined,
      finishedAt: typeof message.finishedAt === "string" ? message.finishedAt : undefined,
    }));
}

function sanitizeMessagePart(part: MessagePart): MessagePart {
  if (part?.type !== "tool") {
    return part;
  }
  return {
    ...part,
    input: sanitizeJsonValue(part.input),
    result: sanitizeJsonValue(part.result),
    approvalInput: sanitizeJsonValue(part.approvalInput),
  };
}

function sanitizeJsonValue(value: JsonValue | undefined, key = ""): JsonValue | undefined {
  if (typeof value === "string") {
    if ((key === "result" || value.length > MAX_STORED_JSON_STRING) && value.length > 512) {
      return `[omitted ${value.length.toLocaleString()} chars]`;
    }
    return value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item) ?? null);
  }
  const object: Record<string, JsonValue> = {};
  for (const [childKey, child] of Object.entries(value)) {
    object[childKey] = sanitizeJsonValue(child as JsonValue, childKey) ?? null;
  }
  return object;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createProjectId(): string {
  return `project:${Date.now().toString(36)}:${Math.random().toString(16).slice(2)}`;
}

function createProject(title: string, workspaceRoot?: string): UiProject {
  return {
    id: createProjectId(),
    title,
    workspaceRoot: normalizeWorkspaceRoot(workspaceRoot),
    updatedAt: nowIso(),
  };
}

function createDefaultProject(): UiProject {
  return {
    id: DEFAULT_PROJECT_ID,
    title: DEFAULT_PROJECT_TITLE,
    updatedAt: nowIso(),
  };
}

function createThread(threadId: string, projectId: string, messages: StoredMessage[] = []): UiThread {
  return {
    id: threadId,
    projectId,
    title: deriveThreadTitle(messages),
    updatedAt: nowIso(),
    messages: trimMessages(messages),
  };
}

function normalizeWorkspaceRoot(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function deriveThreadTitle(messages: StoredMessage[], fallback = "新线程"): string {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.text.trim());
  if (!firstUserMessage) {
    return fallback;
  }
  const singleLine = firstUserMessage.text.replace(/\s+/g, " ").trim();
  return singleLine.length > 28 ? `${singleLine.slice(0, 28)}...` : singleLine;
}

function syncActiveThread(state: UiState, messages: StoredMessage[]): Pick<UiState, "messages" | "threads"> {
  return syncThreadMessages(state, state.threadId, messages, state.projectId) as Pick<UiState, "messages" | "threads">;
}

function syncThreadMessages(
  state: UiState,
  threadId: string,
  messages: StoredMessage[],
  targetProjectId?: string,
): Partial<Pick<UiState, "messages" | "threads">> {
  const trimmedMessages = trimMessages(messages);
  const updatedAt = nowIso();
  const existing = state.threads.find((thread) => thread.id === threadId);
  const projectId = targetProjectId || existing?.projectId || (threadId === state.threadId ? state.projectId : "") || DEFAULT_PROJECT_ID;
  const nextThread: UiThread = {
    id: threadId,
    projectId,
    title: deriveThreadTitle(trimmedMessages, existing?.title || "新线程"),
    updatedAt,
    messages: trimmedMessages,
  };
  const threads = [nextThread, ...state.threads.filter((thread) => thread.id !== threadId)];
  return threadId === state.threadId ? { messages: trimmedMessages, threads } : { threads };
}

function messagesForThread(state: UiState, threadId: string): StoredMessage[] {
  if (threadId === state.threadId) {
    return state.messages;
  }
  return state.threads.find((thread) => thread.id === threadId)?.messages ?? [];
}

function normalizeProjects(value: unknown): UiProject[] {
  const projects = Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === "object")
        .filter((item: any) => item.kind !== "folder" && item.id !== "folder:code-projects")
        .map((item: any) => ({
          id: typeof item.id === "string" && item.id ? item.id : createProjectId(),
          title: typeof item.title === "string" && item.title ? item.title : DEFAULT_PROJECT_TITLE,
          workspaceRoot: normalizeWorkspaceRoot(item.workspaceRoot),
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : nowIso(),
        }))
    : [];
  return projects.length ? projects : [createDefaultProject()];
}

function normalizeThreads(value: unknown, threadId: string, projectId: string, messages: StoredMessage[]): UiThread[] {
  const threads = Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === "object")
        .map((item: any) => ({
          id: typeof item.id === "string" && item.id ? item.id : createThreadId(),
          projectId: typeof item.projectId === "string" && item.projectId ? item.projectId : projectId,
          title: typeof item.title === "string" && item.title ? item.title : deriveThreadTitle(item.messages || []),
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : nowIso(),
          messages: trimMessages(Array.isArray(item.messages) ? item.messages : []),
        }))
    : [];
  if (threads.some((thread) => thread.id === threadId)) {
    return threads;
  }
  return [createThread(threadId, projectId, messages), ...threads];
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      model: supportedModel(localStorage.getItem(APP_STORAGE_KEYS.uiModel) || "gpt-5.4"),
      messages: [],
      sending: false,
      activeView: supportedView(localStorage.getItem(APP_STORAGE_KEYS.uiView) || "chat"),
      projectId: DEFAULT_PROJECT_ID,
      projects: [createDefaultProject()],
      threads: [],
      threadId: localStorage.getItem(APP_STORAGE_KEYS.uiThreadId) || createThreadId(),
      composerHeight: MIN_COMPOSER_HEIGHT,
      contextText: "",
      setModel(model) {
        set({ model: supportedModel(model) });
      },
      setView(view) {
        set({ activeView: supportedView(view) });
      },
      setSending(sending) {
        set({ sending });
      },
      setComposerHeight(height) {
        set({ composerHeight: clamp(height, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT) });
      },
      setContextText(text) {
        set({ contextText: text });
      },
      clearContext() {
        set({ contextText: "" });
      },
      appendMessage(role, text, context, options) {
        const id = createClientId("msg");
        set((state) => ({
          ...syncActiveThread(state, [
            ...state.messages,
            {
              id,
              role,
              text,
              context: context || null,
              parts: options?.parts || [],
              pending: options?.pending === true,
              runId: options?.runId || "",
              startedAt: undefined,
              finishedAt: undefined,
            },
          ]),
        }));
        return id;
      },
      appendMessageToThread(threadId, role, text, context, options) {
        const id = createClientId("msg");
        set((state) => ({
          ...syncThreadMessages(state, threadId, [
            ...messagesForThread(state, threadId),
            {
              id,
              role,
              text,
              context: context || null,
              parts: options?.parts || [],
              pending: options?.pending === true,
              runId: options?.runId || "",
              startedAt: undefined,
              finishedAt: undefined,
            },
          ]),
        }));
        return id;
      },
      appendAssistantMessage() {
        const id = createClientId("msg");
        set((state) => ({
          ...syncActiveThread(state, [
            ...state.messages,
            {
              id,
              role: "assistant",
              text: "",
              context: null,
              parts: [],
              pending: true,
              runId: "",
              startedAt: undefined,
              finishedAt: undefined,
            },
          ]),
        }));
        return id;
      },
      appendAssistantMessageToThread(threadId) {
        const id = createClientId("msg");
        set((state) => ({
          ...syncThreadMessages(state, threadId, [
            ...messagesForThread(state, threadId),
            {
              id,
              role: "assistant",
              text: "",
              context: null,
              parts: [],
              pending: true,
              runId: "",
              startedAt: undefined,
              finishedAt: undefined,
            },
          ]),
        }));
        return id;
      },
      updateMessage(messageId, updater) {
        set((state) => ({
          ...syncActiveThread(
            state,
            state.messages.map((message) => {
              if (message.id !== messageId) {
                return message;
              }
              const next = {
                ...message,
                context: message.context ? { ...message.context } : null,
                parts: [...message.parts],
              };
              updater(next);
              return next;
            }),
          ),
        }));
      },
      updateThreadMessage(threadId, messageId, updater) {
        set((state) => {
          let updated = false;
          const messages = messagesForThread(state, threadId).map((message) => {
            if (message.id !== messageId) {
              return message;
            }
            updated = true;
            const next = {
              ...message,
              context: message.context ? { ...message.context } : null,
              parts: [...message.parts],
            };
            updater(next);
            return next;
          });
          return updated ? syncThreadMessages(state, threadId, messages) : {};
        });
      },
      replaceMessages(messages) {
        set((state) => syncActiveThread(state, messages));
      },
      startNewThread(targetProjectId) {
        const id = createThreadId();
        set((state) => {
          const projectId = targetProjectId || state.projectId || DEFAULT_PROJECT_ID;
          return {
            activeView: "chat",
            contextText: "",
            projectId,
            threadId: id,
            messages: [],
            threads: [createThread(id, projectId), ...state.threads.filter((thread) => thread.id !== id)],
          };
        });
        return id;
      },
      startNewProject(options = {}) {
        const defaultTitle = `新项目 ${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}`;
        const project = createProject(options.title?.trim() || defaultTitle, options.workspaceRoot);
        const threadId = createThreadId();
        set((state) => ({
          activeView: "chat",
          contextText: "",
          projectId: project.id,
          projects: [project, ...state.projects],
          threadId,
          messages: [],
          threads: [createThread(threadId, project.id), ...state.threads],
        }));
        return project.id;
      },
      renameProject(targetProjectId, title) {
        const nextTitle = title.trim();
        if (!nextTitle) {
          return;
        }
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === targetProjectId
              ? {
                  ...project,
                  title: nextTitle,
                  updatedAt: nowIso(),
                }
              : project,
          ),
        }));
      },
      setProjectWorkspaceRoot(targetProjectId, workspaceRoot) {
        const normalized = normalizeWorkspaceRoot(workspaceRoot);
        if (!normalized) {
          return;
        }
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === targetProjectId
              ? {
                  ...project,
                  workspaceRoot: normalized,
                  updatedAt: nowIso(),
                }
              : project,
          ),
        }));
      },
      selectThread(nextThreadId) {
        set((state) => {
          const thread = state.threads.find((item) => item.id === nextThreadId);
          if (!thread) {
            return { activeView: "chat" };
          }
          return {
            activeView: "chat",
            projectId: thread.projectId,
            threadId: thread.id,
            messages: trimMessages(thread.messages),
          };
        });
      },
      deleteThread(targetThreadId) {
        set((state) => {
          const nextThreads = state.threads.filter((thread) => thread.id !== targetThreadId);
          if (targetThreadId !== state.threadId) {
            return { threads: nextThreads };
          }

          const fallbackThread = nextThreads.find((thread) => thread.projectId === state.projectId) ?? nextThreads[0];
          if (fallbackThread) {
            return {
              activeView: "chat",
              contextText: "",
              projectId: fallbackThread.projectId,
              threadId: fallbackThread.id,
              messages: trimMessages(fallbackThread.messages),
              threads: nextThreads,
            };
          }

          const projectId = state.projectId || state.projects[0]?.id || DEFAULT_PROJECT_ID;
          const threadId = createThreadId();
          return {
            activeView: "chat",
            contextText: "",
            projectId,
            threadId,
            messages: [],
            threads: [createThread(threadId, projectId)],
          };
        });
      },
      deleteProject(targetProjectId) {
        set((state) => {
          const nextProjects = state.projects.filter((project) => project.id !== targetProjectId);
          const projects = nextProjects.length ? nextProjects : [createDefaultProject()];
          const nextThreads = state.threads.filter((thread) => thread.projectId !== targetProjectId);
          const activeProjectDeleted = state.projectId === targetProjectId;
          const activeThreadDeleted = state.threads.some(
            (thread) => thread.id === state.threadId && thread.projectId === targetProjectId,
          );

          if (!activeProjectDeleted && !activeThreadDeleted) {
            return { projects, threads: nextThreads };
          }

          const fallbackProject = projects[0];
          const fallbackThread = nextThreads.find((thread) => thread.projectId === fallbackProject.id);
          if (fallbackThread) {
            return {
              activeView: "chat",
              contextText: "",
              projectId: fallbackProject.id,
              projects,
              threadId: fallbackThread.id,
              messages: trimMessages(fallbackThread.messages),
              threads: nextThreads,
            };
          }

          const threadId = createThreadId();
          const thread = createThread(threadId, fallbackProject.id);
          return {
            activeView: "chat",
            contextText: "",
            projectId: fallbackProject.id,
            projects,
            threadId,
            messages: [],
            threads: [thread, ...nextThreads],
          };
        });
      },
    }),
    {
      name: APP_STORAGE_KEYS.uiState,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        model: state.model,
        messages: sanitizeMessages(state.messages),
        activeView: state.activeView,
        projectId: state.projectId,
        projects: state.projects,
        threads: state.threads.map((thread) => ({
          ...thread,
          messages: sanitizeMessages(thread.messages),
        })),
        threadId: state.threadId,
        composerHeight: state.composerHeight,
      }),
      merge(persisted, current) {
        const saved = (persisted || {}) as Partial<UiState>;
        const projectId = typeof saved.projectId === "string" && saved.projectId ? saved.projectId : DEFAULT_PROJECT_ID;
        const threadId = typeof saved.threadId === "string" && saved.threadId ? saved.threadId : current.threadId;
        const messages = trimMessages(Array.isArray(saved.messages) ? saved.messages : current.messages);
        return {
          ...current,
          ...saved,
          model: supportedModel(String(saved.model || current.model)),
          activeView: supportedView(String(saved.activeView || current.activeView)),
          projectId,
          projects: normalizeProjects(saved.projects),
          threads: normalizeThreads(saved.threads, threadId, projectId, messages),
          threadId,
          messages,
          composerHeight: clamp(Number(saved.composerHeight || current.composerHeight), MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT),
          sending: false,
          contextText: "",
        };
      },
    },
  ),
);
