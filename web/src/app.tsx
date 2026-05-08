import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, ChevronDown, FilePlus2, FolderPlus, ListChevronsDownUp, ListChevronsUpDown, PanelRightClose, PanelRightOpen, Search, SquarePen, X } from "lucide-react";
import type {
  AttachmentPayload,
  ApprovalsResponse,
  BridgeSettingsResponse,
  BridgeSettings,
  ContextArtifactPayload,
  HealthResponse,
  KernelPreference,
  KnowledgeDocumentRecord,
  KnowledgeFolderRecord,
  MessageContext,
  ReasoningEffort,
  RuntimeAccessMode,
  ResponseSpeed,
  SkillRecord,
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
  getMatchingSkills,
  mergeFinalDataIntoCache,
  mimeTypeFromAssetUri,
  parseComposerSkillInvocation,
  parseSlashSkillQuery,
  pickCodexSkills,
  readComposerAttachment,
  readStoredAccessMode,
  resolveCurrentSession,
  resolveLatestRun,
  resolveLatestRuntimeBlocker,
  skillInvocationName,
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
import { SkillCommandMenu } from "./components/chat/skill-command-menu";
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
import { WorkspaceInspector } from "./components/workspace/workspace-views";
import { useUiStore, type UiProject, type UiThread } from "./store";

const DEFAULT_SIDEBAR_WIDTH = 284;
const MIN_SIDEBAR_WIDTH = 244;
const MAX_SIDEBAR_WIDTH = 520;
const DEFAULT_LIBRARY_AI_PANEL_WIDTH = 420;
const MIN_LIBRARY_AI_PANEL_WIDTH = 340;
const MAX_LIBRARY_AI_PANEL_WIDTH = 680;

function readStoredSidebarWidth(): number {
  const raw = window.localStorage.getItem(APP_STORAGE_KEYS.sidebarWidth);
  const value = raw ? Number(raw) : DEFAULT_SIDEBAR_WIDTH;
  return clamp(Number.isFinite(value) ? value : DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
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
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [modelMenuKind, setModelMenuKind] = useState<ComposerMenuKind | null>(null);
  const [modelMenuPlacement, setModelMenuPlacement] = useState<"up" | "down">("up");
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort>(() => readStoredReasoningEffort());
  const [responseSpeed, setResponseSpeedState] = useState<ResponseSpeed>(() => readStoredResponseSpeed());
  const [accessMode, setAccessModeState] = useState<RuntimeAccessMode>(() => readStoredAccessMode());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [libraryAiOpen, setLibraryAiOpen] = useState(false);
  const [libraryAiThreadMenuOpen, setLibraryAiThreadMenuOpen] = useState(false);
  const [isComposingText, setIsComposingText] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [libraryAiPanelWidth, setLibraryAiPanelWidth] = useState(readStoredLibraryAiPanelWidth);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const libraryAiResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const threadScrollRef = useRef<HTMLElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queuedChoicePromptRef = useRef<string | null>(null);
  const activeTurnAbortRef = useRef<AbortController | null>(null);

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

  const {
    model,
    messages,
    sending,
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
    appendAssistantMessage,
    updateMessage,
    replaceMessages,
    startNewThread,
    startNewProject,
    renameProject,
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
  const currentThreadRunIds = useMemo(() => collectMessageRunIds(messages), [messages]);
  const hasThreadActivity = messages.length > 0 || sending;
  const latestRun = resolveLatestRun(runs, workingState.sessionId, currentThreadRunIds, hasThreadActivity);
  const currentSession = resolveCurrentSession(sessions, workingState, threadId, latestRun, hasThreadActivity);
  const runtimeBlocker = resolveLatestRuntimeBlocker(executions, latestRun?.sessionId || currentSession?.id || "");
  const activeKernel = healthQuery.data?.kernel;
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
  const skillQuery = parseSlashSkillQuery(question);
  const slashSkillCandidates = useMemo(
    () => (isCodexKernel ? pickCodexSkills(skills) : skills),
    [isCodexKernel, skills],
  );
  const matchingSkills = useMemo(
    () => getMatchingSkills(slashSkillCandidates, skillQuery.keyword),
    [slashSkillCandidates, skillQuery.keyword],
  );

  const showSkillPalette = skillQuery.active && matchingSkills.length > 0 && !modelMenuKind;
  const composerSkillInvocation = useMemo(
    () => parseComposerSkillInvocation(question, slashSkillCandidates),
    [question, slashSkillCandidates],
  );
  const composerQuestionValue = composerSkillInvocation ? composerSkillInvocation.args : question;

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
    const availableModels = modelOptionsForKernel(activeKernel, healthQuery.data?.runtimeControls);
    if (!availableModels.some((item) => item.id === model)) {
      setModel(availableModels[0]?.id ?? "gpt-5.4");
    }
  }, [activeKernel, healthQuery.data?.runtimeControls, model, setModel]);

  useEffect(() => {
    if (composerHeight > 64) {
      setComposerHeight(MIN_COMPOSER_HEIGHT);
    }
  }, [composerHeight, setComposerHeight]);

  useEffect(() => {
    if (activeView !== "chat") {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      const scrollEl = threadScrollRef.current;
      if (!scrollEl) {
        return;
      }
      scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeView, messages, sending]);

  const settingsMutation = useMutation({
    mutationFn: (payload: {
      kernel: KernelPreference;
      providerHttpCaptureEnabled: boolean;
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
            }
          : previous,
      );
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError(error) {
      appendMessage("system", t("system.saveSettingsFailed", { message: error instanceof Error ? error.message : String(error) }));
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
    if (sending) {
      return;
    }
    startNewThread(targetProjectId);
    setProjectMenuOpenId("");
    setQuestion("");
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
    setInspectorOpen(false);
  }

  function clearComposerDraft() {
    setQuestion("");
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
  }

  function openLibraryAiPanel() {
    if (!libraryAiOpen && !sending && messages.length > 0) {
      startNewThread(projectId);
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
    if (sending) {
      return;
    }
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
    if (sending) {
      return;
    }
    startNewProject();
    setQuestion("");
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
    setInspectorOpen(false);
  }

  function openThread(nextThreadId: string) {
    if (sending && nextThreadId !== threadId) {
      appendMessage("system", t("system.replyInProgress"));
      return;
    }
    selectThread(nextThreadId);
    setProjectMenuOpenId("");
    setQuestion("");
    setAttachments([]);
    setContextArtifacts([]);
    setModelMenuKind(null);
    setInspectorOpen(false);
  }

  function deleteThreadWithConfirm(thread: UiThread) {
    if (thread.id.startsWith("empty:") || sending) {
      return;
    }
    const ok = window.confirm(t("conversation.deleteThreadConfirm", { title: thread.title || t("conversation.newThreadFallback") }));
    if (!ok) {
      return;
    }
    deleteThreadFromStore(thread.id);
  }

  function deleteProjectWithConfirm(project: UiProject & { threads: UiThread[] }) {
    if (sending) {
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

  function applySkillSuggestion(skill: SkillRecord) {
    insertPrompt(`/${skillInvocationName(skill)} `);
    setActiveSkillIndex(0);
    setModelMenuKind(null);
  }

  function insertPrompt(prompt: string) {
    setQuestion(prompt);
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

  async function runAskTurn(userPrompt: string, userContext: MessageContext | null, turnAttachments: AttachmentPayload[]) {
    appendMessage("user", userPrompt, userContext);
    setSending(true);
    const assistantId = appendAssistantMessage();
    const abortController = new AbortController();
    activeTurnAbortRef.current = abortController;

    try {
      const finalData = await runThreadTurn(
        {
          question: userPrompt,
          model,
          effort: reasoningEffort,
          responseSpeed,
          accessMode,
          threadId,
          snapshot: createSnapshot(userContext, turnAttachments, currentVaultFileContext),
          computerSnapshot: {},
          allowMemory: false,
          saveCandidateNote: false,
        },
        {
          signal: abortController.signal,
          onAgentEvent(runtimeEvent) {
          updateMessage(assistantId, (message) => {
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

      updateMessage(assistantId, (message) => {
        finalizeAssistantMessage(message, { answer: finalData.answer, events: finalData.events });
      });
      mergeFinalDataIntoCache(queryClient, finalData);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (error) {
      updateMessage(assistantId, (message) => {
        const messageText = error instanceof Error ? error.message : String(error);
        markAssistantMessageError(message, abortController.signal.aborted ? t("system.stopped") : messageText);
      });
    } finally {
      if (activeTurnAbortRef.current === abortController) {
        activeTurnAbortRef.current = null;
      }
      setSending(false);
      const queuedPrompt = queuedChoicePromptRef.current;
      if (queuedPrompt) {
        queuedChoicePromptRef.current = null;
        window.setTimeout(() => {
          void runAskTurn(queuedPrompt, null, []);
        }, 0);
      }
    }
  }

  function stopActiveTurn() {
    activeTurnAbortRef.current?.abort();
  }

  async function submitPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (sending) {
      queuedChoicePromptRef.current = trimmedPrompt;
      return;
    }
    setQuestion("");
    setModelMenuKind(null);
    await runAskTurn(trimmedPrompt, null, []);
  }

  async function sendAsk() {
    if (sending) {
      return;
    }
    const trimmedQuestion = question.trim();
    const turnAttachments = attachments;
    const turnArtifacts = contextArtifacts;
    const contextPayload = buildContextPayload(contextText, turnAttachments, turnArtifacts);
    if (!trimmedQuestion && !contextPayload.text.trim() && !turnAttachments.length && !turnArtifacts.length) {
      appendMessage("system", t("system.inputRequired"));
      return;
    }

    const userContext = contextPayload.text.trim() || turnAttachments.length || turnArtifacts.length ? contextPayload : null;
    const userPrompt = trimmedQuestion || (turnAttachments.length || turnArtifacts.length ? t("system.defaultAttachmentPrompt") : t("system.defaultTextPrompt"));
    clearContext();
    setAttachments([]);
    setContextArtifacts([]);
    setQuestion("");
    setModelMenuKind(null);
    await runAskTurn(userPrompt, userContext, turnAttachments);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isComposingText || event.nativeEvent.isComposing || event.key === "Process") {
      return;
    }
    if (composerSkillInvocation && event.key === "Backspace" && !composerQuestionValue) {
      event.preventDefault();
      setQuestion("");
      setActiveSkillIndex(0);
      return;
    }
    if (showSkillPalette && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSkillIndex((current) => (current + 1) % matchingSkills.length);
      return;
    }
    if (showSkillPalette && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSkillIndex((current) => (current - 1 + matchingSkills.length) % matchingSkills.length);
      return;
    }
    if (showSkillPalette && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
      event.preventDefault();
      const selected = matchingSkills[clamp(activeSkillIndex, 0, matchingSkills.length - 1)];
      if (selected) {
        applySkillSuggestion(selected);
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendAsk();
    }
    if (event.key === "Escape" && showSkillPalette) {
      setQuestion("");
    }
  }

  function handleQuestionChange(nextValue: string) {
    const nextQuestion = composerSkillInvocation
      ? composeSkillPrompt(composerSkillInvocation.name, nextValue)
      : nextValue;
    setQuestion(nextQuestion);
    setModelMenuKind(null);
    const parsed = parseSlashSkillQuery(nextQuestion);
    if (!parsed.active) {
      setActiveSkillIndex(0);
      return;
    }
    setActiveSkillIndex(0);
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
      sending={sending}
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
      runtimeControls={healthQuery.data?.runtimeControls}
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
        setModelMenuKind(null);
      }}
      onSetEffort={setReasoningEffort}
      onSetResponseSpeed={setResponseSpeed}
      onSetAccessMode={setAccessMode}
      onSubmitOrStop={() => (sending ? stopActiveTurn() : void sendAsk())}
      onRemoveSkillInvocation={() => {
        setQuestion(composerSkillInvocation?.args ?? "");
        requestAnimationFrame(() => composerInputRef.current?.focus());
      }}
      onUseSuggestion={setQuestion}
      skillMenu={showSkillPalette ? (
        <SkillCommandMenu
          skills={matchingSkills}
          activeIndex={activeSkillIndex}
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
      style={{ "--opengrove-sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
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
                  <div className="sidebar-space-kicker">Vault</div>
                  <div className="sidebar-space-title">{t("app.library")}</div>
                </div>
                <div className="sidebar-space-actions" aria-label={t("vault.actions")}>
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
              sending={sending}
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
              onOpenNewThread={openNewThread}
              onOpenThread={openThread}
              onToggleProjectMenu={(projectId) => setProjectMenuOpenId((current) => (current === projectId ? "" : projectId))}
              onRenameProject={renameProjectWithPrompt}
              onDeleteProject={deleteProjectWithConfirm}
              onDeleteThread={deleteThreadWithConfirm}
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
                  <span className="codex-mark" aria-hidden="true"></span>
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
                  {inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
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
                    sending={sending}
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
                      disabled={sending}
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
                      disabled={sending}
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
                <section className="library-ai-thread chat-thread-scroll" aria-live="polite">
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
            error={settingsQuery.error instanceof Error ? settingsQuery.error.message : ""}
            onClose={() => setView("chat")}
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
