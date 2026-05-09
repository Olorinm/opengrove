import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, ChevronDown, FilePlus2, FolderPlus, ListChecks, ListChevronsDownUp, ListChevronsUpDown, PanelLeftClose, PanelLeftOpen, Search, SquarePen, X } from "lucide-react";
import type {
  AttachmentPayload,
  ApprovalsResponse,
  BridgeSettingsResponse,
  BridgeSettings,
  ContextArtifactPayload,
  HealthResponse,
  KernelInstallResponse,
  KernelPreference,
  KnowledgeDocumentRecord,
  KnowledgeFolderRecord,
  MessageContext,
  ReasoningEffort,
  RuntimeAccessMode,
  ResponseSpeed,
  SkillRecord,
  WorkspaceDirectoryResponse,
} from "./bridge";
import {
  patchJson,
  postJson,
  viewTitle,
} from "./bridge";
import {
  clamp,
  createEmptyWorkingState,
  normalizeWorkingState,
} from "./format";
import { APP_PRODUCT_NAME, APP_STORAGE_KEYS } from "./identity";
import { useI18n } from "./i18n";
import {
  applyApprovalResultToMessages,
  applyStreamEventToMessage,
  finalizeAssistantMessage,
  markAssistantMessageError,
} from "./messages";
import { buildContextPayload, createSnapshot } from "./runtime/composer-context";
import { runThreadTurn } from "./runtime/thread-runtime";
import {
  MAX_COMPOSER_ATTACHMENTS,
  MIN_COMPOSER_HEIGHT,
  buildApprovalResolutionMessage,
  cloneMessage,
  composeSkillPrompt,
  collectMessageRunIds,
  fileNameFromAssetUri,
  formatKernelLabel,
  getKernelSlashCommands,
  getMatchingSkills,
  getMatchingSlashCommands,
  mergeFinalDataIntoCache,
  mimeTypeFromAssetUri,
  parseSlashSkillQuery,
  pickCodexSkills,
  readComposerAttachment,
  readStoredAccessMode,
  resolveCurrentSession,
  resolveLatestRun,
  resolveLatestRuntimeBlocker,
  skillInvocationName,
  type ComposerSkillInvocation,
} from "./runtime/ui-model";
import { useBridgeQueries } from "./runtime/use-bridge-queries";
import { ChatComposer, modelOptionsForKernel, type ComposerMenuKind } from "./components/chat/chat-composer";
import { KnowledgeLibraryView } from "./components/knowledge/knowledge-views";
import {
  emptyKnowledgeLedgers,
  feedbackSignalLabel,
  filterVaultDocuments,
  knowledgeVaultPath,
} from "./components/knowledge/knowledge-model";
import { SlashCommandMenu } from "./components/chat/skill-command-menu";
import { ThreadShell } from "./components/chat/thread-shell";
import {
  AppRail,
  MobileNav,
  railSectionForView,
  type RailSectionId,
} from "./components/sidebar/app-navigation";
import { ConversationSidebar } from "./components/sidebar/conversation-sidebar";
import { VaultSidebarPanel } from "./components/sidebar/knowledge-sidebar-panels";
import { buildSidebarProjectTree, sortSidebarThreads, type ConversationSortKey } from "./components/sidebar/conversation-sidebar-model";
import { SettingsDialog } from "./components/sidebar/settings-dialog";
import { KernelIcon } from "./components/ui/entity-icons";
import { WorkspaceInspector } from "./components/workspace/workspace-views";
import { useUiStore, type UiProject, type UiThread } from "./store";

const DEFAULT_SIDEBAR_WIDTH = 284;
const MIN_SIDEBAR_WIDTH = 244;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_LIBRARY_AI_PANEL_WIDTH = 420;
const MIN_LIBRARY_AI_PANEL_WIDTH = 340;
const MAX_LIBRARY_AI_PANEL_WIDTH = 680;

type RunningTurn = {
  controller: AbortController;
  assistantId: string;
};

function readStoredSidebarWidth(): number {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.sidebarWidth);
  const value = raw ? Number(raw) : DEFAULT_SIDEBAR_WIDTH;
  return clamp(Number.isFinite(value) ? value : DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

function readStoredSidebarCollapsed(): boolean {
  return window.localStorage.getItem(APP_STORAGE_KEYS.sidebarCollapsed) === "true";
}

function readStoredLibraryAiPanelWidth(): number {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.libraryAiPanelWidth);
  const value = raw ? Number(raw) : DEFAULT_LIBRARY_AI_PANEL_WIDTH;
  return clamp(
    Number.isFinite(value) ? value : DEFAULT_LIBRARY_AI_PANEL_WIDTH,
    MIN_LIBRARY_AI_PANEL_WIDTH,
    MAX_LIBRARY_AI_PANEL_WIDTH,
  );
}

function modelBindingKey(kernel: string | undefined, source: string | undefined): string {
  return `${kernel || "unknown"}:${source || "native"}`;
}

function readStoredModelBindings(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(APP_STORAGE_KEYS.uiModelByBinding) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function writeStoredModelBinding(key: string, modelId: string): void {
  const current = readStoredModelBindings();
  current[key] = modelId;
  window.localStorage.setItem(APP_STORAGE_KEYS.uiModelByBinding, JSON.stringify(current));
}

function readStoredReasoningEffort(): ReasoningEffort {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.reasoningEffort);
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "xhigh") {
    return raw;
  }
  return "high";
}

function readStoredResponseSpeed(): ResponseSpeed {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.responseSpeed);
  return raw === "fast" ? "fast" : "standard";
}

export function App() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [contextArtifacts, setContextArtifacts] = useState<ContextArtifactPayload[]>([]);
  const [focusedKnowledgeId, setFocusedKnowledgeId] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [vaultActionRootPath, setVaultActionRootPath] = useState("OpenGrove");
  const [vaultAllFoldersOpen, setVaultAllFoldersOpen] = useState(false);
  const [vaultExpandRequest, setVaultExpandRequest] = useState({ id: 0, open: false });
  const [vaultEditingPath, setVaultEditingPath] = useState("");
  const [vaultDeleteDialog, setVaultDeleteDialog] = useState<null | {
    path: string;
    kind: "folder" | "file";
    name: string;
  }>(null);
  const [projectMenuOpenId, setProjectMenuOpenId] = useState("");
  const [projectCollapsedIds, setProjectCollapsedIds] = useState<string[]>([]);
  const [projectCollapseSnapshotIds, setProjectCollapseSnapshotIds] = useState<string[]>([]);
  const [conversationSortMenuOpen, setConversationSortMenuOpen] = useState(false);
  const [conversationSortKey, setConversationSortKey] = useState<ConversationSortKey>("updatedAt");
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [composerSkillInvocation, setComposerSkillInvocation] = useState<ComposerSkillInvocation | null>(null);
  const [modelMenuKind, setModelMenuKind] = useState<ComposerMenuKind | null>(null);
  const [modelMenuPlacement, setModelMenuPlacement] = useState<"up" | "down">("up");
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort>(() => readStoredReasoningEffort());
  const [responseSpeed, setResponseSpeedState] = useState<ResponseSpeed>(() => readStoredResponseSpeed());
  const [accessMode, setAccessModeState] = useState<RuntimeAccessMode>(() => readStoredAccessMode());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [workspacePickerPending, setWorkspacePickerPending] = useState(false);
  const [libraryAiOpen, setLibraryAiOpen] = useState(false);
  const [libraryAiThreadMenuOpen, setLibraryAiThreadMenuOpen] = useState(false);
  const [isComposingText, setIsComposingText] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const [sidebarRevealArmed, setSidebarRevealArmed] = useState(true);
  const [libraryAiPanelWidth, setLibraryAiPanelWidth] = useState(readStoredLibraryAiPanelWidth);
  const [runningThreadIds, setRunningThreadIds] = useState<string[]>([]);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const libraryAiResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const threadScrollRef = useRef<HTMLElement | null>(null);
  const libraryAiScrollRef = useRef<HTMLElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queuedChoicePromptsRef = useRef(new Map<string, string>());
  const runningTurnsRef = useRef(new Map<string, RunningTurn>());

  function setAccessMode(value: RuntimeAccessMode) {
    setAccessModeState(value);
    window.localStorage.setItem(APP_STORAGE_KEYS.accessMode, value);
  }

  function setReasoningEffort(value: ReasoningEffort) {
    setReasoningEffortState(value);
    window.localStorage.setItem(APP_STORAGE_KEYS.reasoningEffort, value);
  }

  function setResponseSpeed(value: ResponseSpeed) {
    setResponseSpeedState(value);
    window.localStorage.setItem(APP_STORAGE_KEYS.responseSpeed, value);
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(APP_STORAGE_KEYS.sidebarCollapsed, String(next));
      setSidebarRevealArmed(!next);
      return next;
    });
  }

  const {
    model,
    messages,
    activeView,
    projectId,
    projects,
    threads,
    threadId,
    composerHeight,
    contextText,
    setModel,
    setView,
    setSending,
    setComposerHeight,
    clearContext,
    appendMessage,
    appendMessageToThread,
    appendAssistantMessageToThread,
    updateThreadMessage,
    replaceMessages,
    startNewThread,
    startNewProject,
    renameProject,
    setProjectWorkspaceRoot,
    selectThread,
    deleteThread: deleteThreadFromStore,
    deleteProject: deleteProjectFromStore,
  } = useUiStore();

  const {
    healthQuery,
    settingsQuery,
    inventoryQuery,
    approvalsQuery,
    contextRecordsQuery,
    eventsQuery,
  } = useBridgeQueries();

  const inventory = inventoryQuery.data;
  const approvals = approvalsQuery.data?.approvals ?? [];
  const pendingApprovals = useMemo(
    () => approvals.filter((approval) => approval?.status === "pending"),
    [approvals],
  );
  const contextRecords = contextRecordsQuery.data?.records ?? [];
  const events = eventsQuery.data?.events ?? [];
  const artifacts = inventory?.artifacts ?? [];
  const knowledge = inventory?.knowledge ?? [];
  const knowledgeFolders = inventory?.knowledgeFolders ?? [];
  const knowledgeLedgers = inventory?.knowledgeLedgers ?? emptyKnowledgeLedgers();
  const skills = inventory?.skills ?? [];
  const tools = inventory?.tools ?? [];
  const sessions = inventory?.sessions ?? [];
  const runs = inventory?.runs ?? [];
  const executions = inventory?.executions ?? [];
  const workingState = normalizeWorkingState(inventory?.workingState ?? createEmptyWorkingState());
  const runningThreadSet = useMemo(() => new Set(runningThreadIds), [runningThreadIds]);
  const currentThreadRunIds = useMemo(() => collectMessageRunIds(messages), [messages]);
  const activeThreadIsRunning = runningThreadSet.has(threadId);
  const hasThreadActivity = messages.length > 0 || activeThreadIsRunning;
  const latestRun = resolveLatestRun(runs, workingState.sessionId, currentThreadRunIds, hasThreadActivity);
  const currentSession = resolveCurrentSession(sessions, workingState, threadId, latestRun, hasThreadActivity);
  const runtimeBlocker = resolveLatestRuntimeBlocker(executions, latestRun?.sessionId || currentSession?.id || "");
  const activeKernel = healthQuery.data?.kernel;
  const activeWorkspaceRoot = settingsQuery.data?.settings.workspaceRoot || healthQuery.data?.settings?.workspaceRoot || "";
  const activeRuntimeControls = healthQuery.data?.runtimeControls?.kernel === activeKernel
    ? healthQuery.data?.runtimeControls
    : undefined;
  const activeModelBindingKey = modelBindingKey(activeKernel, activeRuntimeControls?.source);
  const isCodexKernel = activeKernel === "codex";
  const sidebarProjects = useMemo(() => {
    const tree = buildSidebarProjectTree(projects, threads, projectId, threadId, messages);
    return tree.map((project) => ({
      ...project,
      threads: sortSidebarThreads(project.threads, conversationSortKey),
    }));
  }, [projects, threads, projectId, threadId, messages, conversationSortKey]);
  const projectCollapsedSet = useMemo(() => new Set(projectCollapsedIds), [projectCollapsedIds]);
  const allProjectsCollapsed =
    sidebarProjects.length > 0 && sidebarProjects.every((project) => projectCollapsedSet.has(project.id));
  const vaultDocuments = useMemo(
    () => filterVaultDocuments(knowledge, knowledgeQuery),
    [knowledge, knowledgeQuery],
  );
  const currentProjectTitle = useMemo(
    () => projects.find((project) => project.id === projectId)?.title || APP_PRODUCT_NAME,
    [projectId, projects],
  );
  const libraryAiThreadOptions = useMemo(() => {
    const realThreads = threads.filter((thread) => !thread.id.startsWith("empty:"));
    if (realThreads.some((thread) => thread.id === threadId)) {
      return realThreads;
    }
    return [
      {
        id: threadId,
        projectId,
        title: t("conversation.newThreadFallback"),
        updatedAt: new Date().toISOString(),
        messages,
      },
      ...realThreads,
    ];
  }, [messages, projectId, t, threadId, threads]);
  const currentLibraryAiThreadTitle = useMemo(
    () => libraryAiThreadOptions.find((thread) => thread.id === threadId)?.title || t("conversation.newThreadFallback"),
    [libraryAiThreadOptions, t, threadId],
  );

  function syncRunningTurns() {
    const nextThreadIds = [...runningTurnsRef.current.keys()];
    setRunningThreadIds(nextThreadIds);
    setSending(nextThreadIds.length > 0);
  }
  const currentVaultFileContext = useMemo(() => {
    if (activeView !== "library" || !libraryAiOpen || !focusedKnowledgeId) {
      return null;
    }
    const document = knowledge.find((item) => item?.id === focusedKnowledgeId);
    const vaultPath = document ? knowledgeVaultPath(document) : "";
    return vaultPath
      ? {
          knowledgeId: String(document?.id || ""),
          vaultPath,
        }
      : null;
  }, [activeView, focusedKnowledgeId, knowledge, libraryAiOpen]);
  const slashSkillCandidates = useMemo(
    () => (isCodexKernel ? pickCodexSkills(skills) : skills),
    [isCodexKernel, skills],
  );
  const skillQuery = parseSlashSkillQuery(composerSkillInvocation ? "" : question);
  const kernelSlashCommands = useMemo(
    () => getKernelSlashCommands(activeKernel, workingState),
    [activeKernel, workingState],
  );
  const matchingSlashCommands = useMemo(
    () => getMatchingSlashCommands(kernelSlashCommands, skillQuery.keyword),
    [kernelSlashCommands, skillQuery.keyword],
  );
  const matchingSkills = useMemo(
    () => getMatchingSkills(slashSkillCandidates, skillQuery.keyword),
    [slashSkillCandidates, skillQuery.keyword],
  );
  const slashMenuItemCount = matchingSlashCommands.length + matchingSkills.length;
  const showSlashPalette = skillQuery.active && slashMenuItemCount > 0 && !modelMenuKind;
  const composerQuestionValue = question;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!modelMenuRef.current || !(target instanceof Node)) {
        return;
      }
      if (!modelMenuRef.current.contains(target)) {
        setModelMenuKind(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModelMenuKind(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const availableModels = modelOptionsForKernel(activeKernel, activeRuntimeControls);
    const storedModel = readStoredModelBindings()[activeModelBindingKey];
    if (storedModel && availableModels.some((item) => item.id === storedModel)) {
      if (model !== storedModel) setModel(storedModel);
      return;
    }
    if (!availableModels.some((item) => item.id === model)) {
      const fallback = availableModels[0]?.id ?? "gpt-5.4";
      setModel(fallback);
      writeStoredModelBinding(activeModelBindingKey, fallback);
      return;
    }
    writeStoredModelBinding(activeModelBindingKey, model);
  }, [activeKernel, activeRuntimeControls, activeModelBindingKey, model, setModel]);

  useEffect(() => {
    if (composerHeight > 64) {
      setComposerHeight(MIN_COMPOSER_HEIGHT);
    }
  }, [composerHeight, setComposerHeight]);

  useEffect(() => {
    const scrollEl =
      activeView === "chat"
        ? threadScrollRef.current
        : activeView === "library"
          ? libraryAiScrollRef.current
          : null;
    if (!scrollEl) return;
    const frameId = window.requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeView, activeThreadIsRunning, messages]);

  useEffect(() => {
    if (activeView === "library" && libraryAiOpen && threadId && !threadId.startsWith("empty:")) {
      window.localStorage.setItem(APP_STORAGE_KEYS.libraryAiLastThreadId, threadId);
    }
  }, [activeView, libraryAiOpen, threadId]);

  const settingsMutation = useMutation({
    mutationFn: (payload: {
      kernel?: KernelPreference;
      workspaceRoot?: BridgeSettings["workspaceRoot"];
      providerHttpCaptureEnabled?: boolean;
      kernelProxy?: BridgeSettings["kernelProxy"];
      kernelPathOverrides?: BridgeSettings["kernelPathOverrides"];
      kernelKnowledgeSourceEnabled?: Record<string, Record<string, boolean>>;
      kernelProviderBindings?: Record<string, string>;
      customProviders?: BridgeSettings["customProviders"];
    }) =>
      patchJson<BridgeSettingsResponse>("/settings", payload),
    onSuccess(result) {
      queryClient.setQueryData(["settings"], result);
      queryClient.setQueryData(["health"], (previous: HealthResponse | undefined) =>
        previous
          ? {
              ...previous,
              kernel: result.settings.activeKernel,
              settings: result.settings,
              runtimeControls: undefined,
            }
          : previous,
      );
      queryClient.invalidateQueries({ queryKey: ["health"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError(error) {
      appendMessage("system", t("system.saveSettingsFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  async function pickWorkspaceDirectory(): Promise<string | undefined> {
    setWorkspacePickerPending(true);
    try {
      const result = await postJson<WorkspaceDirectoryResponse>("/workspace/choose-directory", {});
      if (result.cancelled) {
        return undefined;
      }
      if (!result.ok || !result.path) {
        throw new Error(result.error || "directory_picker_failed");
      }
      return result.path;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendMessage("system", message === "not_found"
        ? t("system.chooseWorkspaceBridgeOutdated")
        : t("system.chooseWorkspaceFailed", { message }));
      return undefined;
    } finally {
      setWorkspacePickerPending(false);
    }
  }

  function folderTitleFromPath(path: string): string {
    const normalized = path.replace(/[\\/]+$/, "");
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || normalized || t("conversation.newProject");
  }

  function syncProjectWorkspace(projectIdToSync: string | undefined) {
    const workspaceRoot = projects.find((project) => project.id === projectIdToSync)?.workspaceRoot;
    if (workspaceRoot && workspaceRoot !== activeWorkspaceRoot) {
      settingsMutation.mutate({ workspaceRoot });
    }
  }

  const installKernelMutation = useMutation({
    mutationFn: (payload: { kernelId: string; actionId: string }) =>
      postJson<KernelInstallResponse>("/settings/install-kernel", payload),
    onSuccess(result, variables) {
      if (result.settings) {
        queryClient.setQueryData(["settings"], { ok: true, settings: result.settings });
        queryClient.setQueryData(["health"], (previous: HealthResponse | undefined) =>
          previous
            ? {
                ...previous,
                kernel: result.settings?.activeKernel,
                settings: result.settings,
              }
            : previous,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      appendMessage("system", `安装完成：${variables.kernelId}`);
    },
    onError(error, variables) {
      appendMessage("system", `安装失败：${variables.kernelId} · ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const approvalsMutation = useMutation({
    mutationFn: async ({ approvalId, action, response }: { approvalId: string; action: "approve" | "reject"; response?: unknown }) =>
      postJson<any>(`/approvals/${encodeURIComponent(approvalId)}/${action}`, response !== undefined ? { response } : {}),
    onSuccess(result, variables) {
      queryClient.setQueryData(["approvals"], { ok: true, approvals: result.approvals || [] });
      mergeFinalDataIntoCache(queryClient, result);
      const currentMessages = useUiStore.getState().messages.map(cloneMessage);
      const updated = applyApprovalResultToMessages(currentMessages, variables.approvalId, result, variables.action);
      if (updated) {
        replaceMessages(currentMessages);
      } else {
        appendMessage("system", buildApprovalResolutionMessage(result, variables.action));
      }
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError(error) {
      appendMessage("system", `处理确认失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const createArtifactMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => postJson<any>("/artifacts", payload),
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });

  const knowledgeFeedbackMutation = useMutation({
    mutationFn: ({ knowledgeId, signal, note }: { knowledgeId: string; signal: string; note?: string }) =>
      postJson<any>(`/knowledge/${encodeURIComponent(knowledgeId)}/feedback`, {
        signal,
        note,
      }),
    onSuccess(result, variables) {
      mergeFinalDataIntoCache(queryClient, result);
      appendMessage("system", `已记录资料反馈：${feedbackSignalLabel(variables.signal).replace(/^反馈：/, "")}`);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", `记录知识反馈失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const patchKnowledgeMutation = useMutation({
    mutationFn: ({ knowledgeId, patch }: { knowledgeId: string; patch: Record<string, unknown>; silent?: boolean }) =>
      patchJson<any>(`/knowledge/${encodeURIComponent(knowledgeId)}/file`, {
        content: typeof patch.body === "string" ? patch.body : "",
        title: typeof patch.title === "string" ? patch.title : undefined,
        tags: Array.isArray(patch.tags) ? patch.tags : undefined,
      }),
    onSuccess(result, variables) {
      mergeFinalDataIntoCache(queryClient, result);
      if (result.document?.id) {
        setFocusedKnowledgeId(result.document.id);
        queryClient.invalidateQueries({ queryKey: ["knowledge-file", result.document.id] });
      }
      if (!variables.silent) {
        appendMessage("system", t("system.savedLocalFile", { name: result.file?.vaultPath || result.document?.title || result.document?.id || t("system.unnamedPage") }));
      }
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", t("system.saveLibraryPageFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const createKnowledgeFileSystemMutation = useMutation({
    mutationFn: (payload: { kind: "note" | "folder"; parentPath?: string; name?: string; startRename?: boolean }) =>
      postJson<any>("/knowledge/file-system", payload),
    onSuccess(result, variables) {
      mergeFinalDataIntoCache(queryClient, result);
      if (result.document?.id) {
        setFocusedKnowledgeId(result.document.id);
        queryClient.invalidateQueries({ queryKey: ["knowledge-file", result.document.id] });
      }
      if (variables.startRename && typeof result.entry?.path === "string") {
        setVaultEditingPath(result.entry.path);
      }
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", t("system.createLocalFileFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const moveKnowledgeFileSystemMutation = useMutation({
    mutationFn: (payload: { sourcePath: string; targetParentPath: string }) =>
      postJson<any>("/knowledge/file-system/move", payload),
    onSuccess(result) {
      mergeFinalDataIntoCache(queryClient, result);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", t("system.moveLocalFileFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const renameKnowledgeFileSystemMutation = useMutation({
    mutationFn: (payload: { sourcePath: string; name: string }) =>
      postJson<any>("/knowledge/file-system/rename", payload),
    onSuccess(result) {
      setVaultEditingPath("");
      mergeFinalDataIntoCache(queryClient, result);
      const renamedPath = typeof result.entry?.path === "string" ? result.entry.path : "";
      const renamedDocument = Array.isArray(result.knowledge)
        ? result.knowledge.find((document: KnowledgeDocumentRecord) => document?.metadata?.vaultPath === renamedPath)
        : undefined;
      if (renamedDocument?.id) {
        setFocusedKnowledgeId(String(renamedDocument.id));
        queryClient.invalidateQueries({ queryKey: ["knowledge-file", renamedDocument.id] });
      }
      queryClient.invalidateQueries({ queryKey: ["knowledge-file"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", t("system.renameLocalFileFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const deleteKnowledgeFileSystemMutation = useMutation({
    mutationFn: (payload: { sourcePath: string }) =>
      postJson<any>("/knowledge/file-system/delete", payload),
    onSuccess(result) {
      const deletedIds = Array.isArray(result.deletedKnowledgeIds) ? result.deletedKnowledgeIds : [];
      if (deletedIds.includes(focusedKnowledgeId)) {
        setFocusedKnowledgeId("");
      }
      setVaultDeleteDialog(null);
      mergeFinalDataIntoCache(queryClient, result);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", t("system.deleteLocalFileFailed", { message: error instanceof Error ? error.message : String(error) }));
    },
  });

  const bridgeStatus = healthQuery.data?.ok
    ? {
        status: "online",
        label: t("system.connected"),
        detail: healthQuery.data.tokenRequired ? t("system.tokenRequired") : t("system.localReady"),
        kernel: formatKernelLabel(healthQuery.data.kernel),
      }
    : { status: "offline", label: t("system.disconnected"), detail: healthQuery.isFetching ? t("system.checking") : "Failed to fetch" };

  function openAttachmentPicker(event?: MouseEvent<HTMLButtonElement>) {
    event?.currentTarget.blur();
    fileInputRef.current?.click();
  }

  function sendKnowledgeFeedback(knowledgeId: string, signal: string, note?: string) {
    knowledgeFeedbackMutation.mutate({ knowledgeId, signal, note });
  }

  async function patchKnowledgePage(knowledgeId: string, patch: Record<string, unknown>, options: { silent?: boolean } = {}) {
    await patchKnowledgeMutation.mutateAsync({ knowledgeId, patch, silent: options.silent });
  }

  function createVaultEntry(kind: "note" | "folder", parentPath: string) {
    createKnowledgeFileSystemMutation.mutate({
      kind,
      parentPath,
      name: t("system.unnamed"),
      startRename: true,
    });
  }

  function moveVaultEntry(sourcePath: string, targetParentPath: string) {
    if (!sourcePath || !targetParentPath || sourcePath === targetParentPath) return;
    moveKnowledgeFileSystemMutation.mutate({ sourcePath, targetParentPath });
  }

  function renameVaultEntry(sourcePath: string, name: string) {
    if (!sourcePath || !name.trim()) {
      setVaultEditingPath("");
      return;
    }
    renameKnowledgeFileSystemMutation.mutate({ sourcePath, name: name.trim() });
  }

  function requestDeleteVaultEntry(path: string, kind: "folder" | "file", name: string) {
    if (!path) return;
    setVaultDeleteDialog({ path, kind, name });
  }

  async function handleAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) {
      return;
    }

    const remainingSlots = Math.max(0, MAX_COMPOSER_ATTACHMENTS - attachments.length);
    if (remainingSlots <= 0) {
      appendMessage("system", t("system.maxAttachments", { count: MAX_COMPOSER_ATTACHMENTS }));
      return;
    }

    const selected = files.slice(0, remainingSlots);
    const loaded = await Promise.all(selected.map(readComposerAttachment));
    setAttachments((current) => [...current, ...loaded].slice(0, MAX_COMPOSER_ATTACHMENTS));
    if (files.length > selected.length) {
      appendMessage("system", t("system.partialAttachments", { selected: selected.length, count: MAX_COMPOSER_ATTACHMENTS }));
    }
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }

  function removeContextArtifact(artifactId: string) {
    setContextArtifacts((current) => current.filter((artifact) => artifact.id !== artifactId));
  }

  function toggleModelMenu(kind: ComposerMenuKind) {
    const picker = modelMenuRef.current;
    if (picker) {
      const rect = picker.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
      const gap = 8;
      const viewportPadding = 12;
      const availableBelow = Math.max(220, viewportHeight - rect.bottom - gap - viewportPadding);
      const availableAbove = Math.max(220, rect.top - gap - viewportPadding);
      const idealMenuHeight = 440;
      const placement = availableBelow >= idealMenuHeight || availableBelow >= availableAbove ? "down" : "up";
      const availableHeight = placement === "down" ? availableBelow : availableAbove;
      picker.style.setProperty("--opengrove-model-menu-max-height", `${Math.max(220, Math.min(420, availableHeight))}px`);
      setModelMenuPlacement(placement);
    }
    setModelMenuKind((current) => (current === kind ? null : kind));
  }

  function openNewThread(targetProjectId?: string) {
    const nextProjectId = targetProjectId || projectId;
    startNewThread(nextProjectId);
    syncProjectWorkspace(nextProjectId);
    setProjectMenuOpenId("");
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
    setInspectorOpen(false);
  }

  function clearComposerDraft() {
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
  }

  function openLibraryAiPanel() {
    if (!libraryAiOpen && messages.length > 0) {
      const lastLibraryThreadId = window.localStorage.getItem(APP_STORAGE_KEYS.libraryAiLastThreadId);
      const lastThread = lastLibraryThreadId
        ? threads.find((t) => t.id === lastLibraryThreadId)
        : undefined;
      if (lastThread) {
        openThread(lastThread.id);
      } else {
        startNewThread(projectId);
      }
      setView("library");
      clearComposerDraft();
    }
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    setInspectorOpen(false);
    setLibraryAiThreadMenuOpen(false);
    setLibraryAiOpen(true);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function createLibraryAiThread() {
    openNewThread(projectId);
    setView("library");
    setLibraryAiOpen(true);
    setLibraryAiThreadMenuOpen(false);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function selectLibraryAiThread(nextThreadId: string) {
    if (!nextThreadId || nextThreadId === threadId) {
      return;
    }
    openThread(nextThreadId);
    setView("library");
    setLibraryAiOpen(true);
    setLibraryAiThreadMenuOpen(false);
  }

  function openNewProject() {
    startNewProject({ workspaceRoot: activeWorkspaceRoot || undefined });
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
    setInspectorOpen(false);
  }

  async function openFolderProject() {
    const workspaceRoot = await pickWorkspaceDirectory();
    if (!workspaceRoot) {
      return;
    }
    startNewProject({
      title: folderTitleFromPath(workspaceRoot),
      workspaceRoot,
    });
    settingsMutation.mutate({ workspaceRoot });
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
    setInspectorOpen(false);
  }

  function openThread(nextThreadId: string) {
    const nextProjectId = threads.find((thread) => thread.id === nextThreadId)?.projectId;
    selectThread(nextThreadId);
    syncProjectWorkspace(nextProjectId);
    setProjectMenuOpenId("");
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
    setInspectorOpen(false);
  }

  function deleteThreadWithConfirm(thread: UiThread) {
    if (thread.id.startsWith("empty:") || runningThreadSet.has(thread.id)) {
      return;
    }
    const ok = window.confirm(t("conversation.deleteThreadConfirm", { title: thread.title || t("conversation.newThreadFallback") }));
    if (!ok) {
      return;
    }
    deleteThreadFromStore(thread.id);
  }

  function deleteProjectWithConfirm(project: UiProject & { threads: UiThread[] }) {
    if (project.threads.some((thread) => runningThreadSet.has(thread.id))) {
      return;
    }
    const realThreadCount = project.threads.filter((thread) => !thread.id.startsWith("empty:")).length;
    const ok = window.confirm(t("conversation.deleteProjectConfirm", { title: project.title, count: realThreadCount }));
    if (!ok) {
      return;
    }
    setProjectMenuOpenId("");
    deleteProjectFromStore(project.id);
  }

  function renameProjectWithPrompt(project: UiProject) {
    const nextTitle = window.prompt(t("conversation.renameProject"), project.title);
    if (!nextTitle) {
      return;
    }
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === project.title) {
      setProjectMenuOpenId("");
      return;
    }
    renameProject(project.id, trimmedTitle);
    setProjectMenuOpenId("");
  }

  async function changeProjectFolder(project: UiProject) {
    const workspaceRoot = await pickWorkspaceDirectory();
    if (!workspaceRoot) {
      setProjectMenuOpenId("");
      return;
    }
    setProjectWorkspaceRoot(project.id, workspaceRoot);
    if (project.id === projectId) {
      settingsMutation.mutate({ workspaceRoot });
    }
    setProjectMenuOpenId("");
  }

  async function saveImageAsArtifact(image: { src: string; alt: string }) {
    try {
      const title = image.alt || fileNameFromAssetUri(image.src) || t("system.imageArtifact");
      const result = await createArtifactMutation.mutateAsync({
        type: "image",
        title,
        tags: ["image", "chat-image"],
        data: {
          imageUri: image.src,
          alt: image.alt,
          fileName: fileNameFromAssetUri(image.src),
          mimeType: mimeTypeFromAssetUri(image.src),
        },
        assets: [
          {
            kind: "image",
            uri: image.src,
            title,
            mimeType: mimeTypeFromAssetUri(image.src),
          },
        ],
        preview: {
          title,
          text: image.alt,
          imageUri: image.src,
          status: "saved",
        },
        provenance: {
          source: "chat-message",
          threadId,
        },
      });
      appendMessage("system", t("system.savedArtifact", { title: result.artifact?.title || title }));
      mergeFinalDataIntoCache(queryClient, result);
    } catch (error) {
      appendMessage("system", t("system.saveImageFailed", { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  function onComposerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const handle = event.target as HTMLElement;
    if (!handle.closest("[data-action='resize-composer']")) {
      return;
    }
    resizeRef.current = {
      startY: event.clientY,
      startHeight: composerHeight,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onPointerMove(event: PointerEvent) {
    if (!resizeRef.current) {
      return;
    }
    setComposerHeight(resizeRef.current.startHeight + resizeRef.current.startY - event.clientY);
  }

  function onPointerUp() {
    resizeRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
  }

  function onSidebarResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    document.body.dataset.sidebarResizing = "true";
    window.addEventListener("pointermove", onSidebarResizePointerMove);
    window.addEventListener("pointerup", onSidebarResizePointerUp, { once: true });
  }

  function onSidebarResizePointerMove(event: PointerEvent) {
    if (!sidebarResizeRef.current) {
      return;
    }
    const nextWidth = clamp(
      sidebarResizeRef.current.startWidth + event.clientX - sidebarResizeRef.current.startX,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    );
    setSidebarWidth(nextWidth);
    window.localStorage.setItem(APP_STORAGE_KEYS.sidebarWidth, String(Math.round(nextWidth)));
  }

  function onSidebarResizePointerUp() {
    sidebarResizeRef.current = null;
    delete document.body.dataset.sidebarResizing;
    window.removeEventListener("pointermove", onSidebarResizePointerMove);
  }

  function onLibraryAiResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    libraryAiResizeRef.current = {
      startX: event.clientX,
      startWidth: libraryAiPanelWidth,
    };
    document.body.dataset.sidebarResizing = "true";
    window.addEventListener("pointermove", onLibraryAiResizePointerMove);
    window.addEventListener("pointerup", onLibraryAiResizePointerUp, { once: true });
  }

  function onLibraryAiResizePointerMove(event: PointerEvent) {
    if (!libraryAiResizeRef.current) {
      return;
    }
    const nextWidth = clamp(
      libraryAiResizeRef.current.startWidth - (event.clientX - libraryAiResizeRef.current.startX),
      MIN_LIBRARY_AI_PANEL_WIDTH,
      MAX_LIBRARY_AI_PANEL_WIDTH,
    );
    setLibraryAiPanelWidth(nextWidth);
    window.localStorage.setItem(APP_STORAGE_KEYS.libraryAiPanelWidth, String(Math.round(nextWidth)));
  }

  function onLibraryAiResizePointerUp() {
    libraryAiResizeRef.current = null;
    delete document.body.dataset.sidebarResizing;
    window.removeEventListener("pointermove", onLibraryAiResizePointerMove);
  }

  function applySlashCommand(command: { name: string }) {
    insertPrompt(`/${command.name} `);
  }

  function applySkillSuggestion(skill: SkillRecord) {
    setComposerSkillInvocation({
      name: skillInvocationName(skill),
      skill,
      args: "",
    });
    setQuestion("");
    setView("chat");
    setActiveSlashIndex(0);
    setModelMenuKind(null);
    requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      const scrollEl = threadScrollRef.current;
      if (scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
      }
    });
  }

  function insertPrompt(prompt: string) {
    setQuestion(prompt);
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setView("chat");
    setModelMenuKind(null);
    requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      const scrollEl = threadScrollRef.current;
      if (scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
      }
    });
  }

  async function runAskTurn(
    userPrompt: string,
    userContext: MessageContext | null,
    turnAttachments: AttachmentPayload[],
    options: { requestedSkill?: { name: string; args?: string }; targetThreadId?: string } = {},
  ) {
    const turnThreadId = options.targetThreadId ?? threadId;
    if (runningTurnsRef.current.has(turnThreadId)) {
      if (!userContext && turnAttachments.length === 0 && !options.requestedSkill) {
        queuedChoicePromptsRef.current.set(turnThreadId, userPrompt);
      }
      return;
    }
    const turnModel = model;
    const turnEffort = reasoningEffort;
    const turnResponseSpeed = responseSpeed;
    const turnAccessMode = accessMode;
    const turnVaultFileContext = currentVaultFileContext;
    appendMessageToThread(turnThreadId, "user", userPrompt, userContext);
    const assistantId = appendAssistantMessageToThread(turnThreadId);
    const abortController = new AbortController();
    runningTurnsRef.current.set(turnThreadId, { controller: abortController, assistantId });
    syncRunningTurns();

    try {
      const finalData = await runThreadTurn(
        {
          question: userPrompt,
          model: turnModel,
          effort: turnEffort,
          responseSpeed: turnResponseSpeed,
          accessMode: turnAccessMode,
          threadId: turnThreadId,
          snapshot: createSnapshot(userContext, turnAttachments, turnVaultFileContext),
          computerSnapshot: {},
          allowMemory: false,
          saveCandidateNote: false,
          requestedSkill: options.requestedSkill,
        },
        {
          signal: abortController.signal,
          onAgentEvent(runtimeEvent) {
            updateThreadMessage(turnThreadId, assistantId, (message) => {
              const { approvalRequest } = applyStreamEventToMessage(message, runtimeEvent.event);
              if (approvalRequest) {
                queryClient.setQueryData(["approvals"], (previous: ApprovalsResponse | undefined) => ({
                  ok: true,
                  approvals: [
                    ...(previous?.approvals || []).filter((item) => item.id !== approvalRequest.id),
                    approvalRequest,
                  ],
                }));
              }
            });
          },
        },
      );

      updateThreadMessage(turnThreadId, assistantId, (message) => {
        finalizeAssistantMessage(message, { answer: finalData.answer, events: finalData.events });
      });
      mergeFinalDataIntoCache(queryClient, finalData);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (error) {
      updateThreadMessage(turnThreadId, assistantId, (message) => {
        const messageText = error instanceof Error ? error.message : String(error);
        markAssistantMessageError(message, abortController.signal.aborted ? t("system.stopped") : messageText);
      });
    } finally {
      const runningTurn = runningTurnsRef.current.get(turnThreadId);
      if (runningTurn?.controller === abortController) {
        runningTurnsRef.current.delete(turnThreadId);
        syncRunningTurns();
      }
      const queuedPrompt = queuedChoicePromptsRef.current.get(turnThreadId);
      if (queuedPrompt) {
        queuedChoicePromptsRef.current.delete(turnThreadId);
        window.setTimeout(() => {
          void runAskTurn(queuedPrompt, null, [], { targetThreadId: turnThreadId });
        }, 0);
      }
    }
  }

  function stopActiveTurn() {
    runningTurnsRef.current.get(threadId)?.controller.abort();
  }

  async function submitPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (activeThreadIsRunning) {
      queuedChoicePromptsRef.current.set(threadId, trimmedPrompt);
      return;
    }
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setModelMenuKind(null);
    await runAskTurn(trimmedPrompt, null, []);
  }

  async function sendAsk() {
    if (activeThreadIsRunning) {
      return;
    }
    const trimmedQuestion = question.trim();
    const requestedSkill = composerSkillInvocation
      ? {
          name: composerSkillInvocation.name,
          args: trimmedQuestion,
        }
      : undefined;
    const turnAttachments = attachments;
    const turnArtifacts = contextArtifacts;
    const contextPayload = buildContextPayload(contextText, turnAttachments, turnArtifacts);
    if (!requestedSkill && !trimmedQuestion && !contextPayload.text.trim() && !turnAttachments.length && !turnArtifacts.length) {
      appendMessage("system", t("system.inputRequired"));
      return;
    }

    const userContext = contextPayload.text.trim() || turnAttachments.length || turnArtifacts.length ? contextPayload : null;
    const userPrompt = requestedSkill
      ? composeSkillPrompt(requestedSkill.name, trimmedQuestion).trim()
      : trimmedQuestion || (turnAttachments.length || turnArtifacts.length ? t("system.defaultAttachmentPrompt") : t("system.defaultTextPrompt"));
    clearContext();
    setAttachments([]);
    setContextArtifacts([]);
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setModelMenuKind(null);
    await runAskTurn(userPrompt, userContext, turnAttachments, { requestedSkill });
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isComposingText || event.nativeEvent.isComposing || event.key === "Process") {
      return;
    }
    if (composerSkillInvocation && event.key === "Backspace" && !composerQuestionValue) {
      event.preventDefault();
      setComposerSkillInvocation(null);
      setActiveSlashIndex(0);
      return;
    }
    if (showSlashPalette && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSlashIndex((current) => (current + 1) % slashMenuItemCount);
      return;
    }
    if (showSlashPalette && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSlashIndex((current) => (current - 1 + slashMenuItemCount) % slashMenuItemCount);
      return;
    }
    if (showSlashPalette && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
      event.preventDefault();
      const selectedIndex = clamp(activeSlashIndex, 0, slashMenuItemCount - 1);
      if (selectedIndex < matchingSlashCommands.length) {
        const selectedCommand = matchingSlashCommands[selectedIndex];
        if (selectedCommand) {
          applySlashCommand(selectedCommand);
        }
      } else {
        const selectedSkill = matchingSkills[selectedIndex - matchingSlashCommands.length];
        if (selectedSkill) {
          applySkillSuggestion(selectedSkill);
        }
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendAsk();
    }
    if (event.key === "Escape" && showSlashPalette) {
      event.preventDefault();
      setQuestion("");
      setActiveSlashIndex(0);
    }
  }

  function handleQuestionChange(nextValue: string) {
    setQuestion(nextValue);
    setModelMenuKind(null);
    if (composerSkillInvocation) {
      setActiveSlashIndex(0);
      return;
    }
    setActiveSlashIndex(0);
  }

  function toggleLibrarySearch() {
    setLibrarySearchOpen((current) => {
      if (current) {
        setKnowledgeQuery("");
      }
      return !current;
    });
  }

  function toggleAllProjectsCollapsed() {
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    if (allProjectsCollapsed) {
      setProjectCollapsedIds(projectCollapseSnapshotIds.filter((id) => sidebarProjects.some((project) => project.id === id)));
      return;
    }
    setProjectCollapseSnapshotIds(projectCollapsedIds);
    setProjectCollapsedIds(sidebarProjects.map((project) => project.id));
  }

  function openConversationSortMenu() {
    setProjectMenuOpenId("");
    setConversationSortMenuOpen((current) => !current);
  }

  const showLibrarySearch = librarySearchOpen || Boolean(knowledgeQuery.trim());
  const activeRailSection = railSectionForView(activeView);

  const renderSharedThreadShell = () => (
    <ThreadShell
      messages={messages}
      projectTitle={currentProjectTitle}
      skills={skills}
      runtimeEvents={events}
      runs={runs}
      onResolveApproval={(approvalId, action, response) => approvalsMutation.mutate({ approvalId, action, response })}
      onInsertPrompt={insertPrompt}
      onSubmitPrompt={(prompt) => void submitPrompt(prompt)}
      onSaveImageArtifact={saveImageAsArtifact}
    />
  );

  const renderSharedComposer = (options: { messagesEmpty: boolean; showSuggestions?: boolean }) => (
    <ChatComposer
      sending={activeThreadIsRunning}
      messagesEmpty={options.messagesEmpty}
      showSuggestions={options.showSuggestions}
      contextText={contextText}
      attachments={attachments}
      contextArtifacts={contextArtifacts}
      composerSkillInvocation={composerSkillInvocation}
      composerQuestionValue={composerQuestionValue}
      composerHeight={composerHeight}
      model={model}
      activeKernel={activeKernel}
      runtimeControls={activeRuntimeControls}
      effort={reasoningEffort}
      responseSpeed={responseSpeed}
      accessMode={accessMode}
      modelMenuKind={modelMenuKind}
      modelMenuPlacement={modelMenuPlacement}
      composerInputRef={composerInputRef}
      fileInputRef={fileInputRef}
      modelMenuRef={modelMenuRef}
      onPointerDown={onComposerPointerDown}
      onClearContext={clearContext}
      onRemoveContextArtifact={removeContextArtifact}
      onRemoveAttachment={removeAttachment}
      onQuestionChange={handleQuestionChange}
      onKeyDown={handleComposerKeyDown}
      onCompositionStart={() => setIsComposingText(true)}
      onCompositionEnd={() => setIsComposingText(false)}
      onAttachmentInputChange={handleAttachmentInputChange}
      onOpenAttachmentPicker={openAttachmentPicker}
      onToggleModelMenu={toggleModelMenu}
      onSetModel={(nextModel) => {
        setModel(nextModel);
        writeStoredModelBinding(activeModelBindingKey, nextModel);
        setModelMenuKind(null);
      }}
      onSetEffort={setReasoningEffort}
      onSetResponseSpeed={setResponseSpeed}
      onSetAccessMode={setAccessMode}
      onSubmitOrStop={() => (activeThreadIsRunning ? stopActiveTurn() : void sendAsk())}
      onRemoveSkillInvocation={() => {
        setComposerSkillInvocation(null);
        setActiveSlashIndex(0);
        requestAnimationFrame(() => composerInputRef.current?.focus());
      }}
      onUseSuggestion={(suggestion) => {
        setComposerSkillInvocation(null);
        setActiveSlashIndex(0);
        setQuestion(suggestion);
      }}
      skillMenu={showSlashPalette ? (
        <SlashCommandMenu
          commands={matchingSlashCommands}
          skills={matchingSkills}
          activeIndex={activeSlashIndex}
          onSelectCommand={applySlashCommand}
          onSelect={applySkillSuggestion}
        />
      ) : null}
    />
  );

  function openRailSection(section: RailSectionId) {
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    if (section === "chat") {
      setView("chat");
    } else if (section === "library") {
      setView("library");
    } else if (section === "settings") {
      setView("settings");
    }
  }

  return (
    <div
      className="app-shell react-app"
      data-view={activeView}
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      style={{ "--opengrove-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <div className="app-sidebar-header">
        <span className="sidebar-brand-main" aria-label={APP_PRODUCT_NAME} title={APP_PRODUCT_NAME}>
          <span className="sidebar-brand-mark" aria-hidden="true">
            <OpenGroveSaplingMark />
          </span>
          <span className="sidebar-brand-word">
            Open<span>Grove</span>
          </span>
        </span>
        <button
          className="sidebar-collapse-button"
          data-hover-reveal={sidebarCollapsed && sidebarRevealArmed ? "true" : "false"}
          type="button"
          onClick={toggleSidebarCollapsed}
          onMouseLeave={() => {
            if (sidebarCollapsed) {
              setSidebarRevealArmed(true);
            }
          }}
          onBlur={() => {
            if (sidebarCollapsed) {
              setSidebarRevealArmed(true);
            }
          }}
          aria-label={sidebarCollapsed ? t("layout.expandSidebar") : t("layout.collapseSidebar")}
          title={sidebarCollapsed ? t("layout.expandSidebar") : t("layout.collapseSidebar")}
        >
          {sidebarCollapsed ? (
            <>
              <span className="sidebar-collapse-logo" aria-hidden="true">
                <OpenGroveSaplingMark />
              </span>
              <PanelLeftOpen className="sidebar-collapse-icon" size={16} aria-hidden="true" />
            </>
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
      </div>
      <AppRail
        activeSection={activeRailSection}
        onOpenSection={openRailSection}
        onOpenSettings={() => openRailSection("settings")}
      />

      <aside className="sidebar" data-section={activeRailSection} aria-label={t("layout.sidebar")}>
        <nav className="nav-list" aria-label={t("layout.spaceNav")}>
          {activeRailSection === "library" ? (
            <section className="sidebar-panel-space" aria-label={t("app.library")}>
              <div className="sidebar-space-header">
                <div>
                  <div className="sidebar-space-title">{t("app.library")}</div>
                </div>
                <div className={clsx("sidebar-space-actions", showLibrarySearch && "active")} aria-label={t("vault.actions")}>
                  <button
                    className="sidebar-mini-action"
                    type="button"
                    onClick={() => createVaultEntry("note", vaultActionRootPath)}
                    aria-label={t("vault.newNote")}
                    title={t("vault.newNoteInRoot", { root: vaultActionRootPath })}
                  >
                    <FilePlus2 size={13} />
                  </button>
                  <button
                    className="sidebar-mini-action"
                    type="button"
                    onClick={() => createVaultEntry("folder", vaultActionRootPath)}
                    aria-label={t("vault.newFolder")}
                    title={t("vault.newFolderInRoot", { root: vaultActionRootPath })}
                  >
                    <FolderPlus size={13} />
                  </button>
                  <button
                    className="sidebar-mini-action"
                    type="button"
                    onClick={() => setVaultExpandRequest((current) => ({
                      id: current.id + 1,
                      open: !vaultAllFoldersOpen,
                    }))}
                    aria-label={vaultAllFoldersOpen ? t("vault.collapseAll") : t("vault.expandAll")}
                    title={vaultAllFoldersOpen ? t("vault.collapseAll") : t("vault.expandAll")}
                  >
                    {vaultAllFoldersOpen ? <ListChevronsDownUp size={13} /> : <ListChevronsUpDown size={13} />}
                  </button>
                  <button
                    className={clsx("sidebar-mini-action", showLibrarySearch && "active")}
                    type="button"
                    onClick={toggleLibrarySearch}
                    aria-label={showLibrarySearch ? t("vault.searchClose") : t("vault.search")}
                    title={showLibrarySearch ? t("vault.searchClose") : t("vault.search")}
                  >
                    <Search size={13} />
                  </button>
                </div>
              </div>
              {showLibrarySearch ? (
                <label className="sidebar-library-search">
                  <Search size={13} />
                  <input
                    autoFocus
                    value={knowledgeQuery}
                    onChange={(event) => setKnowledgeQuery(event.target.value)}
                    placeholder={t("vault.search")}
                  />
                </label>
              ) : null}
              <VaultSidebarPanel
                documents={vaultDocuments}
                folders={knowledgeFolders as KnowledgeFolderRecord[]}
                focusedKnowledgeId={focusedKnowledgeId}
                forceOpen={Boolean(knowledgeQuery.trim())}
                expandRequest={vaultExpandRequest}
                editingPath={vaultEditingPath}
                onActiveRootChange={setVaultActionRootPath}
                onAllFoldersOpenChange={setVaultAllFoldersOpen}
                onCancelRename={() => setVaultEditingPath("")}
                onCreateFolder={(parentPath) => createVaultEntry("folder", parentPath)}
                onCreateNote={(parentPath) => createVaultEntry("note", parentPath)}
                onDeleteEntry={requestDeleteVaultEntry}
                onMoveEntry={moveVaultEntry}
                onRenameEntry={renameVaultEntry}
                onStartRename={setVaultEditingPath}
                onFocusKnowledge={(knowledgeId) => {
                  setFocusedKnowledgeId(knowledgeId);
                  setView("library");
                }}
              />
            </section>
          ) : null}

          {activeRailSection === "chat" ? (
            <ConversationSidebar
              projects={sidebarProjects}
              activeThreadId={threadId}
              activeView={activeView}
              runningThreadIds={runningThreadIds}
              pendingApprovalCount={pendingApprovals.length}
              collapsedProjectIds={projectCollapsedSet}
              allProjectsCollapsed={allProjectsCollapsed}
              projectMenuOpenId={projectMenuOpenId}
              conversationSortMenuOpen={conversationSortMenuOpen}
              conversationSortKey={conversationSortKey}
              onToggleAllProjectsCollapsed={toggleAllProjectsCollapsed}
              onOpenConversationSortMenu={openConversationSortMenu}
              onSortKeyChange={setConversationSortKey}
              onOpenNewProject={openNewProject}
              onOpenFolderProject={openFolderProject}
              onOpenNewThread={openNewThread}
              onOpenThread={openThread}
              onToggleProjectCollapsed={(projectId) => setProjectCollapsedIds((ids) => ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId])}
              onToggleProjectMenu={(projectId) => setProjectMenuOpenId((current) => (current === projectId ? "" : projectId))}
              onRenameProject={renameProjectWithPrompt}
              onChangeProjectFolder={changeProjectFolder}
              onDeleteProject={deleteProjectWithConfirm}
              onDeleteThread={deleteThreadWithConfirm}
              folderProjectPending={workspacePickerPending || settingsMutation.isPending}
            />
          ) : null}
        </nav>
      </aside>

      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label={t("layout.resizeSidebar")}
        aria-orientation="vertical"
        onPointerDown={onSidebarResizePointerDown}
      />

      <MobileNav activeView={activeView} onSelect={setView} />

      <main className="workspace">
        <header className="topbar" data-view={activeView}>
          <div>
            {activeView === "chat" ? null : (
              <>
                <div className="topbar-title">{viewTitle(activeView)}</div>
                <div className="topbar-subtitle">
                  <span className="status-dot" data-status={bridgeStatus.status}></span>
                  <span>{t("layout.localBridge")}</span>
                  <span>{bridgeStatus.label}</span>
                  <span>{bridgeStatus.detail}</span>
                  {"kernel" in bridgeStatus && bridgeStatus.kernel ? <span>{bridgeStatus.kernel}</span> : null}
                </div>
              </>
            )}
          </div>
          <div className="app-topbar-actions">
            {activeView === "chat" ? (
              <>
                <div className="topbar-status-pill kernel-button" title={formatKernelLabel(healthQuery.data?.kernel) || "Codex"}>
                  <KernelIcon kernelId={healthQuery.data?.kernel} className="topbar-kernel-icon" size={13} />
                  <span>{formatKernelLabel(healthQuery.data?.kernel) || "Codex"}</span>
                </div>
                <button
                  className="topbar-icon-button"
                  data-open={inspectorOpen ? "true" : "false"}
                  type="button"
                  onClick={() => setInspectorOpen((current) => !current)}
                  title={inspectorOpen ? t("layout.closeWorkbench") : t("layout.openWorkbench")}
                  aria-label={inspectorOpen ? t("layout.closeWorkbench") : t("layout.openWorkbench")}
                >
                  <ListChecks size={16} />
                </button>
              </>
            ) : null}
            {activeView === "library" ? (
              <button
                className="topbar-icon-button library-ai-topbar-button"
                data-open={libraryAiOpen ? "true" : "false"}
                type="button"
                onClick={() => (libraryAiOpen ? setLibraryAiOpen(false) : openLibraryAiPanel())}
                title={libraryAiOpen ? t("library.closeAi") : t("library.openAi")}
                aria-label={libraryAiOpen ? t("library.closeAi") : t("library.openAi")}
              >
                <Bot size={16} />
                <span>{t("library.ai")}</span>
              </button>
            ) : null}
          </div>
        </header>

        {activeView === "chat" ? (
          <section className="view-panel chat-view" data-view="chat" data-empty={messages.length === 0 ? "true" : "false"}>
            <div className="chat-layout" data-inspector={inspectorOpen ? "true" : "false"}>
              <section className="conversation">
                <section ref={threadScrollRef} className="thread chat-thread-scroll" aria-live="polite">
                  {renderSharedThreadShell()}
                </section>

                {renderSharedComposer({ messagesEmpty: messages.length === 0 })}
              </section>

              {inspectorOpen ? (
                <aside className="inspector" aria-label={t("layout.workbench")}>
                  <WorkspaceInspector
                    workingState={workingState}
                    currentSession={currentSession}
                    latestRun={latestRun}
                    runtimeBlocker={runtimeBlocker}
                    kernelLabel={formatKernelLabel(healthQuery.data?.kernel)}
                    threadId={threadId}
                    sending={activeThreadIsRunning}
                    messages={messages}
                    artifacts={artifacts}
                    skills={skills}
                    tools={tools}
                    events={events}
                    pendingApprovals={pendingApprovals}
                    onOpenChat={() => {
                      setView("chat");
                      setInspectorOpen(false);
                    }}
                  />
                </aside>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeView === "library" ? (
          <section
            className="view-panel tab-view knowledge-product-view library-ai-layout"
            data-view="library"
            data-ai-open={libraryAiOpen ? "true" : "false"}
            style={{ "--opengrove-library-ai-width": `${libraryAiPanelWidth}px` } as CSSProperties}
          >
            <div className="library-document-pane">
              <KnowledgeLibraryView
                embedded
                documents={knowledge}
                ledgers={knowledgeLedgers}
                artifacts={artifacts}
                skills={skills}
                filteredDocuments={vaultDocuments}
                focusedKnowledgeId={focusedKnowledgeId}
                onFocusKnowledge={setFocusedKnowledgeId}
                onPatch={patchKnowledgePage}
                onFeedback={sendKnowledgeFeedback}
              />
            </div>
            <button
              className="library-ai-edge-button"
              data-open={libraryAiOpen ? "true" : "false"}
              type="button"
              onClick={openLibraryAiPanel}
              title={libraryAiOpen ? t("library.closeAi") : t("library.openAi")}
              aria-label={libraryAiOpen ? t("library.closeAi") : t("library.openAi")}
            >
              <Bot size={15} />
              <span>{t("library.ai")}</span>
            </button>
            {libraryAiOpen ? (
              <>
              <div
                className="library-ai-resize-handle"
                role="separator"
                aria-label={t("layout.resizeSidebar")}
                aria-orientation="vertical"
                onPointerDown={onLibraryAiResizePointerDown}
              />
              <aside className="library-ai-panel" aria-label={t("library.aiTitle")}>
                <header className="library-ai-header">
                  <div
                    className="library-ai-conversation-controls"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setLibraryAiThreadMenuOpen(false);
                      }
                    }}
                  >
                    <button
                      className="library-ai-thread-button"
                      type="button"
                      onClick={() => setLibraryAiThreadMenuOpen((current) => !current)}
                      aria-expanded={libraryAiThreadMenuOpen}
                      aria-label={t("library.selectAiConversation")}
                      title={t("library.selectAiConversation")}
                    >
                      <span>{currentLibraryAiThreadTitle}</span>
                      <ChevronDown size={13} />
                    </button>
                    {libraryAiThreadMenuOpen ? (
                      <div className="library-ai-thread-menu" role="menu" aria-label={t("library.selectAiConversation")}>
                        {libraryAiThreadOptions.map((thread) => (
                          <button
                            key={thread.id}
                            className="library-ai-thread-menu-item"
                            data-active={thread.id === threadId ? "true" : "false"}
                            type="button"
                            role="menuitem"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectLibraryAiThread(thread.id)}
                          >
                            <span>{thread.title || t("conversation.newThreadFallback")}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <button
                      className="library-ai-icon-button"
                      type="button"
                      onClick={createLibraryAiThread}
                      aria-label={t("library.newAiConversation")}
                      title={t("library.newAiConversation")}
                    >
                      <SquarePen size={14} />
                    </button>
                  </div>
                  <button className="library-ai-icon-button" type="button" onClick={() => setLibraryAiOpen(false)} aria-label={t("library.closeAi")} title={t("library.closeAi")}>
                    <X size={15} />
                  </button>
                </header>
                <section ref={libraryAiScrollRef} className="library-ai-thread chat-thread-scroll" aria-live="polite">
                  {renderSharedThreadShell()}
                </section>
                {renderSharedComposer({ messagesEmpty: messages.length === 0, showSuggestions: false })}
              </aside>
              </>
            ) : null}
          </section>
        ) : null}
        {activeView === "settings" ? (
          <SettingsDialog
            embedded
            settings={settingsQuery.data?.settings ?? healthQuery.data?.settings}
            contextRecords={contextRecords}
            loading={settingsQuery.isLoading}
            saving={settingsMutation.isPending}
            installingKernelId={installKernelMutation.isPending ? installKernelMutation.variables?.kernelId : ""}
            error={settingsQuery.error instanceof Error ? settingsQuery.error.message : ""}
            onClose={() => setView("chat")}
            onInstallKernel={(kernelId, actionId) => installKernelMutation.mutate({ kernelId, actionId })}
            onSave={(payload) => settingsMutation.mutate(payload)}
          />
        ) : null}
      </main>

      {vaultDeleteDialog ? (
        <>
          <div className="modal-overlay" onClick={() => setVaultDeleteDialog(null)} />
          <div className="modal-shell" role="presentation">
            <div className="modal-card vault-create-dialog">
              <div>
                <div className="modal-title">{vaultDeleteDialog.kind === "folder" ? t("vault.deleteFolder") : t("vault.deleteNote")}</div>
                <div className="vault-create-dialog-subtitle">
                  {t("vault.deleteCopy", { name: vaultDeleteDialog.name })}
                </div>
              </div>
              <div className="modal-actions">
                <button className="ghost-button" type="button" onClick={() => setVaultDeleteDialog(null)}>
                  {t("common.cancel")}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => deleteKnowledgeFileSystemMutation.mutate({ sourcePath: vaultDeleteDialog.path })}
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function OpenGroveSaplingMark() {
  return (
    <svg viewBox="0 0 128 128" aria-hidden="true" shapeRendering="crispEdges">
      <g transform="translate(24 18) scale(0.72)">
        <rect x="0" y="0" width="31" height="31" fill="#7BCB57" />
        <rect x="16" y="16" width="31" height="31" fill="#5FB24A" />
        <rect x="79" y="15" width="31" height="31" fill="#7BCB57" />
        <rect x="63" y="31" width="31" height="31" fill="#5FB24A" />
        <rect x="47" y="47" width="17" height="58" fill="#202424" />
        <rect x="60" y="47" width="4" height="58" fill="#343A38" />
        <rect x="32" y="105" width="47" height="15" fill="#202424" />
        <rect x="32" y="105" width="47" height="3" fill="#343A38" />
      </g>
    </svg>
  );
}
