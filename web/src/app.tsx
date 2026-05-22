import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, ClipboardEvent as ReactClipboardEvent, MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, FilePlus2, FolderInput, FolderPlus, ListChecks, ListChevronsDownUp, ListChevronsUpDown, PanelLeftClose, PanelLeftOpen, Search, SquarePen, X } from "lucide-react";
import type {
  AttachmentPayload,
  ApprovalsResponse,
  BridgeSettingsResponse,
  BridgeSettings,
  ContextArtifactPayload,
  ExtensionItemRecord,
  HealthResponse,
  KernelAuthLoginResponse,
  KernelAuthResponse,
  KernelInstallResponse,
  KernelPreference,
  KnowledgeDocumentRecord,
  KnowledgeFolderRecord,
  MessageContext,
  ReasoningEffort,
  RuntimeAccessMode,
  ResponseSpeed,
  SkillRecord,
  VisualAnnotation,
  DeveloperSession,
  DeveloperSessionCore,
  DeveloperSessionResponse,
  DeveloperSessionsResponse,
  WorkspaceDirectoryResponse,
} from "./bridge";
import {
  addDeveloperSessionAnnotation,
  addDeveloperSessionAnnotationThread,
  cancelAskStream,
  createClientId,
  createDeveloperSession,
  deleteDeveloperSessionAnnotation,
  getJson,
  listDeveloperSessions,
  patchDeveloperSessionAnnotation,
  patchJson,
  patchDeveloperSession as patchDeveloperSessionRequest,
  postJson,
  restartDeveloperPreviewService,
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
import {
  findAttachableAssistantMessageId,
  isActiveRunRecord,
  isFreshRunRecord,
  isRecoverableStreamDisconnect,
  latestPendingAssistantMessage,
  messagesForUiThread,
  modelBindingKey,
  readStoredLibraryLastKnowledgeId,
  readStoredModelBindings,
  readStoredRailExpanded,
  readStoredReasoningEffort,
  readStoredResponseSpeed,
  readStoredSidebarCollapsed,
  runRecordId,
  writeStoredModelBinding,
} from "./runtime/app-shell-state";
import { useAppLayoutResize } from "./runtime/app-layout-resize";
import { attachThreadTurn, runThreadTurn } from "./runtime/thread-runtime";
import {
  MAX_COMPOSER_ATTACHMENTS,
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
import { ChatComposer, type ComposerMenuKind } from "./components/chat/chat-composer";
import { modelOptionsForKernel, resolveDefaultModelForKernel, runtimeControlsForKernel } from "./runtime/kernel-models";
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
  ThemedPixelIcon,
  railSectionForView,
  type RailSectionId,
} from "./components/sidebar/app-navigation";
import { RoomsView } from "./components/rooms/rooms-view";
import { ContactsView } from "./components/rooms/contacts-view";
import { ConversationSidebar } from "./components/sidebar/conversation-sidebar";
import { VaultSidebarPanel } from "./components/sidebar/knowledge-sidebar-panels";
import { buildSidebarProjectTree, sortSidebarThreads, type ConversationSortKey } from "./components/sidebar/conversation-sidebar-model";
import { AppCreateWizard, type AppBuilderRequest, type AppCreateSourceKind, type AppDraftMode } from "./components/apps/app-create-wizard";
import { SettingsDialog, type SettingsSectionId } from "./components/sidebar/settings-dialog";
import { mountedAppId } from "./components/sidebar/settings-model";
import { DirectoryPanel } from "./components/shared/directory-panel";
import { ExtensionsView } from "./components/extensions/extensions-view";
import {
  findMountedAppDeveloperSession,
  isMountedWorkbenchApp,
  mountedAppAgentContext,
  mountedAppDeveloperPreviewUrl,
  mountedAppDeveloperSessionDescription,
  mountedAppDeveloperSessionTitle,
  mountedAppMatchesId,
  mountedAppSourcePath,
} from "./components/apps/mounted-app-model";
import { MountedAppChatPanel } from "./components/apps/mounted-app-chat-panel";
import { MountedAppWorkbench } from "./components/apps/mounted-app-workbench";
import { Dialog, DialogContent, DialogTitle } from "./components/ui/dialog";
import { KernelIcon } from "./components/ui/entity-icons";
import {
  extractVisualAnnotationActions,
  mergeVisualAnnotationArtifacts,
  visualAnnotationContextArtifact,
} from "./components/visual/visual-annotation-context";
import { isOpenGroveMountedAppPreviewUrl } from "./components/visual/visual-url";
import { VisualWorkbench, type VisualAnnotationInput } from "./components/visual/visual-workbench";
import { WorkspaceInspector } from "./components/workspace/workspace-views";
import { useUiStore, type UiProject, type UiThread } from "./store";
import { useVoiceInput } from "./voice/use-voice-input";

type RoomsAppView = "messages" | "contacts";

type RunningTurn = {
  controller: AbortController;
  assistantId: string;
  runId?: string;
};

export function App() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [contextArtifacts, setContextArtifacts] = useState<ContextArtifactPayload[]>([]);
  const [focusedKnowledgeId, setFocusedKnowledgeId] = useState(readStoredLibraryLastKnowledgeId);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [, setVaultActionRootPath] = useState("OpenGrove");
  const [vaultAllFoldersOpen, setVaultAllFoldersOpen] = useState(false);
  const [vaultExpandRequest, setVaultExpandRequest] = useState({ id: 0, open: false });
  const [vaultRevealPathRequest, setVaultRevealPathRequest] = useState({ id: 0, path: "" });
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
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId>("kernels");
  const [appCreateDialogOpen, setAppCreateDialogOpen] = useState(false);
  const [appDraftMode, setAppDraftMode] = useState<AppDraftMode>("choice");
  const [appDraftSourceKind, setAppDraftSourceKind] = useState<AppCreateSourceKind>("local");
  const [appDraftPath, setAppDraftPath] = useState("");
  const [appDraftTitle, setAppDraftTitle] = useState("");
  const [appDraftDescription, setAppDraftDescription] = useState("");
  const [activeDeveloperSessionId, setActiveDeveloperSessionId] = useState("");
  const [activeMountedAppId, setActiveMountedAppId] = useState("");
  const [mountedAppSelectedPath, setMountedAppSelectedPath] = useState("");
  const [mountedAppDeveloperModeIds, setMountedAppDeveloperModeIds] = useState<string[]>([]);
  const [selectedOpsRunId, setSelectedOpsRunId] = useState("");
  const [visualPreviewReloadKeys, setVisualPreviewReloadKeys] = useState<Record<string, number>>({});
  const [libraryAiThreadMenuOpen, setLibraryAiThreadMenuOpen] = useState(false);
  const [isComposingText, setIsComposingText] = useState(false);
  const [railExpanded, setRailExpandedState] = useState(readStoredRailExpanded);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarCollapsed);
  const [sidebarRevealArmed, setSidebarRevealArmed] = useState(true);
  const [runningThreadIds, setRunningThreadIds] = useState<string[]>([]);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const threadScrollRef = useRef<HTMLElement | null>(null);
  const libraryAiScrollRef = useRef<HTMLElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queuedChoicePromptsRef = useRef(new Map<string, string>());
  const runningTurnsRef = useRef(new Map<string, RunningTurn>());
  const visualPreviewRestartRef = useRef(new Map<string, number>());

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

  function setRailExpanded(expanded: boolean) {
    setRailExpandedState(expanded);
    window.localStorage.setItem(APP_STORAGE_KEYS.railExpanded, String(expanded));
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
  const [roomsAppView, setRoomsAppView] = useState<RoomsAppView>("messages");
  const [roomsFocusRoomId, setRoomsFocusRoomId] = useState("");
  const {
    sidebarWidth,
    libraryAiPanelWidth,
    libraryAiRailBottom,
    libraryAiRailDragging,
    onComposerPointerDown,
    onSidebarResizePointerDown,
    onLibraryAiResizePointerDown,
    onLibraryAiRailMouseDown,
    openLibraryAiFromRail,
  } = useAppLayoutResize({
    composerHeight,
    setComposerHeight,
    openLibraryAiPanel,
  });

  const {
    healthQuery,
    settingsQuery,
    inventoryQuery,
    approvalsQuery,
    contextRecordsQuery,
    eventsQuery,
  } = useBridgeQueries();

  const inventory = inventoryQuery.data;
  const copilotAuthQuery = useQuery({
    queryKey: ["kernel-auth", "copilot"],
    queryFn: () => getJson<KernelAuthResponse>("/settings/kernel-auth/copilot"),
    enabled: activeView === "settings" || activeView === "ops",
    refetchInterval: activeView === "settings" || activeView === "ops" ? 2_000 : false,
  });
  const developerSessionsQuery = useQuery({
    queryKey: ["developer-sessions"],
    queryFn: listDeveloperSessions,
    refetchInterval: activeView === "app" ? 2_000 : false,
  });
  const developerSessions = developerSessionsQuery.data?.sessions ?? [];
  const mountedApps = useMemo(
    () => (inventory?.extensions?.items ?? []).filter(isMountedWorkbenchApp),
    [inventory?.extensions?.items],
  );
  const mountedAppSearchParams = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : undefined;
  const embeddedMountedAppMode = mountedAppSearchParams?.get("embedded") === "app";
  const embeddedMountedAppId = mountedAppSearchParams?.get("app") || "";
  const activeMountedApp = useMemo(
    () => {
      if (embeddedMountedAppMode) {
        return mountedApps.find((app) => mountedAppMatchesId(app, embeddedMountedAppId));
      }
      return mountedApps.find((app) => mountedAppMatchesId(app, activeMountedAppId)) ??
        (activeView === "app" ? mountedApps[0] : undefined);
    },
    [activeMountedAppId, activeView, embeddedMountedAppId, embeddedMountedAppMode, mountedApps],
  );
  const activeMountedAppDeveloperMode = Boolean(
    activeMountedApp && mountedAppDeveloperModeIds.includes(activeMountedApp.name),
  );
  const activeMountedAppDeveloperSession = useMemo(
    () => findMountedAppDeveloperSession(activeMountedApp, developerSessions),
    [activeMountedApp, developerSessions],
  );
  const activeDeveloperSession = useMemo(
    () => activeMountedAppDeveloperMode
      ? activeMountedAppDeveloperSession ?? developerSessions.find((session) => session.id === activeDeveloperSessionId)
      : developerSessions.find((session) => session.id === activeDeveloperSessionId),
    [activeMountedAppDeveloperMode, activeMountedAppDeveloperSession, activeDeveloperSessionId, developerSessions],
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "app") {
      const requestedApp = params.get("app");
      if (requestedApp) setActiveMountedAppId(requestedApp);
      setView("app");
      return;
    }
    if (params.get("view") === "rooms" || params.get("roomInvite")) {
      setView("rooms");
    }
  }, [setView]);

  useEffect(() => {
    if (!developerSessions.length) {
      setActiveDeveloperSessionId("");
      return;
    }
    if (activeDeveloperSessionId && !developerSessions.some((session) => session.id === activeDeveloperSessionId)) {
      setActiveDeveloperSessionId("");
    }
  }, [activeDeveloperSessionId, developerSessions]);

  useEffect(() => {
    if (!mountedApps.length) {
      setActiveMountedAppId("");
      return;
    }
    if (activeMountedAppId && mountedApps.some((app) => app.name === activeMountedAppId)) {
      return;
    }
    if (activeView === "app") {
      setActiveMountedAppId(mountedApps[0].name);
    }
  }, [activeMountedAppId, activeView, mountedApps]);

  useEffect(() => {
    if (activeView !== "app" || !activeMountedAppDeveloperSession?.id) return;
    if (isOpenGroveMountedAppPreviewUrl(activeMountedAppDeveloperSession.targetUrl)) return;
    restartDeveloperSessionPreview(activeMountedAppDeveloperSession.id);
  }, [activeView, activeMountedAppDeveloperSession?.id, activeMountedAppDeveloperSession?.targetUrl]);

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
  const runningThreadSet = useMemo(() => {
    const ids = new Set(runningThreadIds);
    for (const run of runs) {
      if (isActiveRunRecord(run) && run.sessionId) {
        ids.add(run.sessionId);
      }
    }
    return ids;
  }, [runningThreadIds, runs]);
  const activeDeveloperSessionIsRunning = Boolean(activeDeveloperSession?.threadId && runningThreadSet.has(activeDeveloperSession.threadId));
  const currentThreadRunIds = useMemo(() => collectMessageRunIds(messages), [messages]);
  const activeThreadIsRunning = runningThreadSet.has(threadId);
  const activeThreadPendingAssistant = useMemo(() => latestPendingAssistantMessage(messages), [messages]);
  const activeThreadCanStop = activeThreadIsRunning || Boolean(activeThreadPendingAssistant);
  const hasThreadActivity = messages.length > 0 || activeThreadIsRunning;
  const latestRun = resolveLatestRun(runs, workingState.sessionId, currentThreadRunIds, hasThreadActivity);
  const currentSession = resolveCurrentSession(sessions, workingState, threadId, latestRun, hasThreadActivity);
  const runtimeBlocker = resolveLatestRuntimeBlocker(executions, latestRun?.sessionId || currentSession?.id || "");
  const activeKernel = healthQuery.data?.kernel;
  const activeWorkspaceRoot = settingsQuery.data?.settings.workspaceRoot || healthQuery.data?.settings?.workspaceRoot || "";
  const roomsRuntimeReady = Boolean(settingsQuery.data || healthQuery.data);
  const activeRuntimeControls = healthQuery.data?.runtimeControls?.kernel === activeKernel
    ? healthQuery.data?.runtimeControls
    : undefined;
  const developerCoreOptions = useMemo<DeveloperSessionCore[]>(() => {
    const kernels = settingsQuery.data?.settings.kernels ?? healthQuery.data?.settings?.kernels ?? [];
    const cores = kernels
      .filter((kernel) => kernel.id !== "auto" && kernel.available)
      .map((kernel) => {
        const controls = runtimeControlsForKernel(kernel.id, activeRuntimeControls, healthQuery.data?.runtimeControlsByKernel);
        const options = modelOptionsForKernel(kernel.id, controls);
        return {
          coreId: kernel.id,
          name: kernel.label || formatKernelLabel(kernel.id),
          kernel: kernel.id,
          model: resolveDefaultModelForKernel({
            kernelId: kernel.id,
            activeKernel,
            activeModel: model,
            runtimeControls: activeRuntimeControls,
            runtimeControlsByKernel: healthQuery.data?.runtimeControlsByKernel,
            options,
          }),
        };
      });
    if (cores.length) {
      return cores;
    }
    const fallbackKernel = activeKernel && activeKernel !== "auto" ? activeKernel : "codex";
    return [{
      coreId: fallbackKernel,
      name: formatKernelLabel(fallbackKernel) || "Codex",
      kernel: fallbackKernel,
      model,
    }];
  }, [
    activeKernel,
    activeRuntimeControls,
    healthQuery.data?.runtimeControlsByKernel,
    healthQuery.data?.settings?.kernels,
    model,
    settingsQuery.data?.settings.kernels,
  ]);
  const activeModelBindingKey = modelBindingKey(activeKernel, activeRuntimeControls?.source);
  const voiceInput = useVoiceInput({
    voiceSettings: settingsQuery.data?.settings.voice ?? healthQuery.data?.settings?.voice,
    copy: {
      browserUnavailable: "浏览器语音转写不可用，请在设置里切换到 OpenAI、Groq 或 Local Whisper。",
      mediaUnavailable: "当前浏览器不能录音，请手动输入，或换用支持 MediaRecorder 的浏览器。",
      transcriptionFailed: (message) => `语音转写失败：${message}`,
      recordingFailed: (message) => `语音录制失败：${message}`,
    },
    onTranscript: appendVoiceTranscript,
    onSystemMessage: (message) => appendMessage("system", message),
  });
  const isCodexKernel = activeKernel === "codex";
  const sidebarProjects = useMemo(() => {
    const conversationThreads = threads.filter((thread) => !thread.id.startsWith("developer_thread") && !thread.id.startsWith("app_thread"));
    const tree = buildSidebarProjectTree(projects, conversationThreads, projectId, threadId, messages);
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
    const realThreads = threads.filter((thread) =>
      !thread.id.startsWith("empty:") && !thread.id.startsWith("developer_thread") && !thread.id.startsWith("app_thread")
    );
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

  useEffect(() => {
    if (!focusedKnowledgeId) return;
    const exists = knowledge.some((document) => document?.id === focusedKnowledgeId);
    if (exists) {
      window.localStorage.setItem(APP_STORAGE_KEYS.libraryLastKnowledgeId, focusedKnowledgeId);
      return;
    }
    if (inventoryQuery.isSuccess) {
      window.localStorage.removeItem(APP_STORAGE_KEYS.libraryLastKnowledgeId);
      setFocusedKnowledgeId("");
    }
  }, [focusedKnowledgeId, inventoryQuery.isSuccess, knowledge]);

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
    function handlePointerDown(event: globalThis.PointerEvent) {
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
    const scrollEl =
      activeView === "chat" || (activeView === "app" && activeMountedAppDeveloperMode)
        ? threadScrollRef.current
        : activeView === "library"
          ? libraryAiScrollRef.current
          : null;
    if (!scrollEl) return;
    const frameId = window.requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeMountedAppDeveloperMode, activeView, activeThreadIsRunning, activeDeveloperSessionIsRunning, activeDeveloperSession?.threadId, messages, threads]);

  useEffect(() => {
    for (const run of runs) {
      const runId = runRecordId(run);
      const runThreadId = String(run.sessionId || "");
      if (!isActiveRunRecord(run) || !runId || !runThreadId || runningTurnsRef.current.has(runThreadId)) {
        continue;
      }
      const threadMessages = messagesForUiThread(threads, threadId, messages, runThreadId);
      const assistantId = findAttachableAssistantMessageId(threadMessages, runId, isFreshRunRecord(run) ? run.input : "");
      if (!assistantId) {
        continue;
      }
      void attachRunningTurn(run, assistantId);
    }
  }, [messages, runs, threadId, threads]);

  useEffect(() => {
    for (const run of runs) {
      const runId = runRecordId(run);
      const runThreadId = String(run.sessionId || "");
      if (isActiveRunRecord(run) || !runId || !runThreadId) {
        continue;
      }
      const runEvents = events.filter((event) => event?.runId === runId);
      if (!runEvents.length) {
        continue;
      }
      const threadMessages = messagesForUiThread(threads, threadId, messages, runThreadId);
      const assistantId = findAttachableAssistantMessageId(threadMessages, runId, isFreshRunRecord(run) ? run.input : "");
      if (!assistantId) {
        continue;
      }
      updateThreadMessage(runThreadId, assistantId, (message) => {
        message.runId = runId;
        message.text = "";
        message.parts = [];
        message.pending = true;
        for (const event of runEvents) {
          applyStreamEventToMessage(message, event);
        }
        finalizeAssistantMessage(message, { events: runEvents });
      });
    }
  }, [events, messages, runs, threadId, threads, updateThreadMessage]);

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
      codexRawEventCaptureEnabled?: boolean;
      mountedApps?: BridgeSettings["mountedApps"];
      kernelProxy?: BridgeSettings["kernelProxy"];
      inviteLanding?: BridgeSettings["inviteLanding"];
      remote?: BridgeSettings["remote"];
      voice?: BridgeSettings["voice"];
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

  const extensionActionMutation = useMutation({
    mutationFn: (payload: { path: string; body: Record<string, unknown> }) =>
      postJson<any>(payload.path, payload.body),
    onSuccess(result) {
      if (result?.extensions) {
        queryClient.setQueryData(["inventory"], (previous: any) =>
          previous ? { ...previous, extensions: result.extensions } : previous,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", `扩展管理操作失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const openExtensionLocalPathMutation = useMutation({
    mutationFn: (path: string) => postJson<any>("/extensions/open-local-path", { path }),
    onError(error) {
      appendMessage("system", `打开本地文件夹失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const createMountedAppDeveloperSessionMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createDeveloperSession>[0] & { appId: string }) =>
      createDeveloperSession(payload),
    onSuccess(result, payload) {
      mergeDeveloperSessionResponse(result);
      if (result.session) {
        setActiveDeveloperSessionId(result.session.id);
        setMountedAppDeveloperModeIds((ids) => ids.includes(payload.appId) ? ids : [...ids, payload.appId]);
        setActiveMountedAppId(payload.appId);
        setView("app");
      }
      queryClient.invalidateQueries({ queryKey: ["developer-sessions"] });
    },
    onError(error) {
      const message = error instanceof Error ? error.message : String(error);
      appendMessage("system", `进入 App 开发者模式失败：${message === "not_found"
        ? "当前 OpenGrove bridge/server 版本缺少 /developer/sessions 路由，请重启或更新正在运行的桌面/本地 bridge。"
        : message}`);
    },
  });

  const addDeveloperSessionAnnotationMutation = useMutation({
    mutationFn: ({ sessionId, annotation }: { sessionId: string; annotation: VisualAnnotationInput }) =>
      addDeveloperSessionAnnotation(sessionId, annotation),
    onSuccess(result) {
      mergeDeveloperSessionResponse(result);
      queryClient.invalidateQueries({ queryKey: ["developer-sessions"] });
    },
    onError(error) {
      appendMessage("system", `保存标注失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const deleteDeveloperSessionAnnotationMutation = useMutation({
    mutationFn: ({ sessionId, annotationId }: { sessionId: string; annotationId: string }) =>
      deleteDeveloperSessionAnnotation(sessionId, annotationId),
    onSuccess(result) {
      mergeDeveloperSessionResponse(result);
      queryClient.invalidateQueries({ queryKey: ["developer-sessions"] });
    },
    onError(error) {
      appendMessage("system", `删除标注失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

  const patchDeveloperSessionMutation = useMutation({
    mutationFn: ({ sessionId, patch }: { sessionId: string; patch: Parameters<typeof patchDeveloperSessionRequest>[1] }) =>
      patchDeveloperSessionRequest(sessionId, patch),
    onSuccess(result) {
      mergeDeveloperSessionResponse(result);
      queryClient.invalidateQueries({ queryKey: ["developer-sessions"] });
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

  const copilotLoginMutation = useMutation({
    mutationFn: () =>
      postJson<KernelAuthLoginResponse>("/settings/kernel-auth/copilot/login", {}),
    onSuccess(result) {
      queryClient.setQueryData(["kernel-auth", "copilot"], result);
      queryClient.invalidateQueries({ queryKey: ["kernel-auth", "copilot"] });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
    onError(error) {
      appendMessage("system", `Copilot 登录终端打开失败：${error instanceof Error ? error.message : String(error)}`);
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

  const importLocalFolderMutation = useMutation({
    mutationFn: async () => {
      const chooseResult = await postJson<any>("/knowledge/file-system/choose-import-folder", {});
      if (chooseResult.cancelled) {
        return null;
      }
      return chooseResult;
    },
    onSuccess(result) {
      if (!result) return;
      mergeFinalDataIntoCache(queryClient, result);
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError(error) {
      appendMessage("system", `导入文件夹失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

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

  function openExtensionSkillEditor(item: ExtensionItemRecord) {
    const paths = [
      String(item.source?.path || ""),
      ...item.deployments.flatMap((deployment) => [
        String(deployment.sourcePath || ""),
        String(deployment.targetPath || ""),
        String(deployment.metadata?.skillFile || ""),
      ]),
    ].filter(Boolean).map((value) => value.replace(/\\/g, "/").toLowerCase());
    const skillName = String(item.name || "").toLowerCase();
    const skillTitle = String(item.title || "").toLowerCase();
    const document = knowledge.find((candidate) => {
      if (candidate?.type !== "skill") return false;
      const metadata = candidate.metadata ?? {};
      const candidateName = String(metadata.skillName || candidate.title || candidate.id || "").toLowerCase();
      const candidateId = String(metadata.skillId || candidate.id || "").toLowerCase();
      if (candidateName === skillName || candidateName === skillTitle || candidateId === item.id || candidateId === skillName) {
        return true;
      }
      const candidatePaths = [
        metadata.skillRoot,
        metadata.entry,
        metadata.sourceFilePath,
        metadata.sourceFileOriginPath,
        knowledgeVaultPath(candidate),
      ].map((value) => String(value || "").replace(/\\/g, "/").toLowerCase()).filter(Boolean);
      return paths.some((path) => candidatePaths.some((candidatePath) =>
        candidatePath === path ||
        candidatePath.includes(`/${skillName}/`) ||
        path.includes(candidatePath) ||
        candidatePath.includes(path)
      ));
    });
    if (!document?.id) {
      appendMessage("system", `资料库里没有找到 skill：${item.title || item.name}`);
      return;
    }
    setFocusedKnowledgeId(document.id);
    setVaultRevealPathRequest((current) => ({
      id: current.id + 1,
      path: knowledgeVaultPath(document),
    }));
    setKnowledgeQuery("");
    setLibrarySearchOpen(false);
    setView("library");
  }

  function mergeDeveloperSessionResponse(result: DeveloperSessionResponse) {
    if (!result.session) return;
    queryClient.setQueryData(["developer-sessions"], (previous: DeveloperSessionsResponse | undefined) => {
      const previousSessions = previous?.sessions ?? [];
      return {
        ok: true,
        sessions: [result.session as DeveloperSession, ...previousSessions.filter((session) => session.id !== result.session?.id)],
      };
    });
  }

  function restartDeveloperSessionPreview(sessionId: string, options: { force?: boolean } = {}) {
    const now = Date.now();
    const lastRestartAt = visualPreviewRestartRef.current.get(sessionId) ?? 0;
    if (!options.force && now - lastRestartAt < 1500) return;
    visualPreviewRestartRef.current.set(sessionId, now);

    void restartDeveloperPreviewService(sessionId)
      .then((result) => {
        mergeDeveloperSessionResponse(result);
        if (result.previewService?.status === "restarted") {
          setVisualPreviewReloadKeys((current) => ({
            ...current,
            [sessionId]: (current[sessionId] ?? 0) + 1,
          }));
        }
      })
      .catch(() => undefined);
  }

  function selectMountedApp(appId: string) {
    setActiveMountedAppId(appId);
    setMountedAppSelectedPath("");
    setView("app");
  }

  function setMountedAppDeveloperMode(appId: string, enabled: boolean) {
    setMountedAppDeveloperModeIds((ids) => {
      const hasApp = ids.includes(appId);
      if (enabled && !hasApp) return [...ids, appId];
      if (!enabled && hasApp) return ids.filter((id) => id !== appId);
      return ids;
    });
    setActiveMountedAppId(appId);
    setView("app");
  }

  function enterMountedAppDeveloperMode(appId: string) {
    const app = mountedApps.find((item) => item.name === appId);
    if (!app) return;
    const targetUrl = mountedAppDeveloperPreviewUrl(app);
    if (!targetUrl) {
      appendMessage("system", `「${app.title}」没有声明可预览的 App UI，不能进入开发者模式。请在 opengrove.app.json 的 ui.developer 里声明 entry 或 targetUrl。`);
      return;
    }
    const existingSession = findMountedAppDeveloperSession(app, developerSessions);
    if (existingSession) {
      const shouldClearMountedAppPreviewError = isOpenGroveMountedAppPreviewUrl(targetUrl) && existingSession.preview.status === "error";
      if (existingSession.targetUrl !== targetUrl || shouldClearMountedAppPreviewError) {
        const patchedSession: DeveloperSession = {
          ...existingSession,
          targetUrl,
          preview: {
            status: "ready",
            lastLoadedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
        mergeDeveloperSessionResponse({ ok: true, session: patchedSession });
        patchDeveloperSessionMutation.mutate({
          sessionId: existingSession.id,
          patch: {
            targetUrl,
            preview: patchedSession.preview,
          },
        });
      }
      setActiveDeveloperSessionId(existingSession.id);
      setMountedAppDeveloperMode(appId, true);
      return;
    }
    createMountedAppDeveloperSessionMutation.mutate({
      appId,
      title: mountedAppDeveloperSessionTitle(app),
      description: mountedAppDeveloperSessionDescription(app),
      targetRoot: mountedAppSourcePath(app),
      targetUrl,
      core: developerCoreOptions[0],
      threadId: createClientId("developer_thread"),
    });
  }

  function exitMountedAppDeveloperMode(appId: string) {
    setMountedAppDeveloperMode(appId, false);
  }

  function deleteMountedAppTab(appId: string) {
    const app = mountedApps.find((item) => item.name === appId);
    if (!app) return;
    const confirmed = window.confirm(`从 OpenGrove 移除「${app.title}」？本地 App 文件不会被删除。`);
    if (!confirmed) return;

    const settings = settingsQuery.data?.settings ?? healthQuery.data?.settings;
    const currentMountedApps = settings?.mountedApps ?? [];
    const appRoot = mountedAppSourcePath(app);
    const nextMountedApps = currentMountedApps.filter((item) => {
      if (item.id === appId) return false;
      if (appRoot && item.path === appRoot) return false;
      return true;
    });

    if (nextMountedApps.length === currentMountedApps.length) {
      appendMessage("system", `没有找到可移除的 App：${app.title}`);
      return;
    }

    settingsMutation.mutate({ mountedApps: nextMountedApps });
    setMountedAppDeveloperModeIds((ids) => ids.filter((id) => id !== appId));
    if (activeMountedAppId === appId || activeMountedApp?.name === appId) {
      const nextActiveAppId = nextMountedApps[0]?.id ?? "";
      setActiveMountedAppId(nextActiveAppId);
      if (!nextActiveAppId) setView("chat");
    }
  }

  function saveDeveloperSessionAnnotation(sessionId: string, annotation: VisualAnnotationInput) {
    void saveDeveloperSessionAnnotationAndAttach(sessionId, annotation);
  }

  async function saveDeveloperSessionAnnotationAndAttach(sessionId: string, annotation: VisualAnnotationInput) {
    try {
      const result = await addDeveloperSessionAnnotationMutation.mutateAsync({ sessionId, annotation });
      const session = result.session;
      const savedAnnotation = session?.annotations.at(-1);
      if (session && savedAnnotation) {
        attachVisualAnnotationToComposer(session, savedAnnotation);
      }
    } catch {
      // The mutation already reports the error through onError.
    }
  }

  function attachVisualAnnotationToComposer(session: DeveloperSession, annotation: VisualAnnotation) {
    const artifact = visualAnnotationContextArtifact(session, annotation);
    setContextArtifacts((current) => [
      ...current.filter((item) => item.id !== artifact.id),
      artifact,
    ]);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  function removeDeveloperSessionAnnotation(sessionId: string, annotationId: string) {
    deleteDeveloperSessionAnnotationMutation.mutate({ sessionId, annotationId });
  }

  function markVisualPreviewLoaded(sessionId: string) {
    patchDeveloperSessionMutation.mutate({
      sessionId,
      patch: {
        preview: {
          status: "ready",
          lastLoadedAt: new Date().toISOString(),
        },
      },
    });
  }

  function markVisualPreviewFailed(sessionId: string, message: string) {
    patchDeveloperSessionMutation.mutate({
      sessionId,
      patch: {
        preview: {
          status: "error",
          error: message,
        },
      },
    });
  }

  async function applyVisualAnnotationActionsFromAnswer(sessionId: string, answer: string | undefined): Promise<string | undefined> {
    if (!answer) return answer;
    const extracted = extractVisualAnnotationActions(answer);
    if (!extracted.actions.length) return answer;

    for (const action of extracted.actions) {
      try {
        const reply = action.reply?.trim();
        const status = action.status ?? (reply ? "replied" : undefined);
        if (reply) {
          const result = await addDeveloperSessionAnnotationThread(sessionId, action.annotationId, {
            role: "agent",
            content: reply,
          });
          mergeDeveloperSessionResponse(result);
        }
        if (status) {
          const result = await patchDeveloperSessionAnnotation(sessionId, action.annotationId, {
            status,
            resolvedBy: status === "resolved" || status === "dismissed" ? "agent" : undefined,
          });
          mergeDeveloperSessionResponse(result);
        }
      } catch (error) {
        appendMessage("system", `同步标注状态失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    queryClient.invalidateQueries({ queryKey: ["developer-sessions"] });
    return extracted.answer;
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

    await addComposerAttachments(files);
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const filesFromItems = Array.from(event.clipboardData.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))
      .filter(isComposerImageFile);
    const filesFromClipboard = Array.from(event.clipboardData.files ?? []).filter(isComposerImageFile);
    const files = filesFromItems.length ? filesFromItems : filesFromClipboard;
    if (!files.length) {
      return;
    }

    event.preventDefault();
    await addComposerAttachments(files);
  }

  function isComposerImageFile(file: File) {
    return file.type.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(file.name);
  }

  async function addComposerAttachments(files: File[]) {
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

  function applyAgentRuntimeEventToAssistant(turnThreadId: string, assistantId: string, runtimeEvent: { event: Record<string, unknown> }) {
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
  }

  async function attachRunningTurn(run: { id?: string; runId?: string; sessionId?: string }, assistantId: string) {
    const runId = runRecordId(run);
    const turnThreadId = String(run.sessionId || "");
    if (!runId || !turnThreadId || runningTurnsRef.current.has(turnThreadId)) {
      return;
    }

    const abortController = new AbortController();
    runningTurnsRef.current.set(turnThreadId, { controller: abortController, assistantId, runId });
    syncRunningTurns();
    updateThreadMessage(turnThreadId, assistantId, (message) => {
      message.runId = runId;
      message.pending = true;
    });

    try {
      let resetForReplay = false;
      const finalData = await attachThreadTurn(
        { runId, threadId: turnThreadId },
        {
          signal: abortController.signal,
          onRuntimeEvent(runtimeEvent) {
            if (runtimeEvent.type === "run.start" && runtimeEvent.runId) {
              updateThreadMessage(turnThreadId, assistantId, (message) => {
                message.runId = runtimeEvent.runId || message.runId;
                message.pending = true;
                if (!resetForReplay) {
                  message.text = "";
                  message.parts = [];
                  message.startedAt = undefined;
                  message.finishedAt = undefined;
                  resetForReplay = true;
                }
              });
            }
          },
          onAgentEvent(runtimeEvent) {
            applyAgentRuntimeEventToAssistant(turnThreadId, assistantId, runtimeEvent);
          },
        },
      );

      updateThreadMessage(turnThreadId, assistantId, (message) => {
        finalizeAssistantMessage(message, { answer: finalData.answer, events: finalData.events });
      });
      mergeFinalDataIntoCache(queryClient, finalData);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (error) {
      if (!abortController.signal.aborted && isRecoverableStreamDisconnect(error)) {
        queryClient.invalidateQueries({ queryKey: ["inventory"] });
        queryClient.invalidateQueries({ queryKey: ["events"] });
        return;
      }
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
    }
  }

  async function runAskTurn(
    userPrompt: string,
    userContext: MessageContext | null,
    turnAttachments: AttachmentPayload[],
    options: {
      requestedSkill?: { name: string; args?: string };
      targetThreadId?: string;
      developerSessionId?: string;
      appId?: string;
      kernel?: string;
      model?: string;
    } = {},
  ) {
    const turnThreadId = options.targetThreadId ?? threadId;
    if (runningTurnsRef.current.has(turnThreadId)) {
      if (!userContext && turnAttachments.length === 0 && !options.requestedSkill) {
        queuedChoicePromptsRef.current.set(turnThreadId, userPrompt);
      }
      return;
    }
    const turnModel = options.model || model;
    const turnKernel = options.kernel;
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
          kernel: turnKernel,
          effort: turnEffort,
          responseSpeed: turnResponseSpeed,
          accessMode: turnAccessMode,
          threadId: turnThreadId,
          appId: options.appId,
          snapshot: createSnapshot(userContext, turnAttachments, turnVaultFileContext),
          computerSnapshot: {},
          allowMemory: false,
          saveCandidateNote: false,
          requestedSkill: options.requestedSkill,
        },
        {
          signal: abortController.signal,
          onRuntimeEvent(runtimeEvent) {
            if (runtimeEvent.type !== "run.start" || !runtimeEvent.runId) {
              return;
            }
            const runningTurn = runningTurnsRef.current.get(turnThreadId);
            if (runningTurn?.controller === abortController) {
              runningTurn.runId = runtimeEvent.runId;
              runningTurnsRef.current.set(turnThreadId, runningTurn);
            }
            updateThreadMessage(turnThreadId, assistantId, (message) => {
              message.runId = runtimeEvent.runId || message.runId;
              message.pending = true;
            });
          },
          onAgentEvent(runtimeEvent) {
            applyAgentRuntimeEventToAssistant(turnThreadId, assistantId, runtimeEvent);
          },
        },
      );

      const answer = options.developerSessionId
        ? await applyVisualAnnotationActionsFromAnswer(options.developerSessionId, finalData.answer)
        : finalData.answer;
      updateThreadMessage(turnThreadId, assistantId, (message) => {
        finalizeAssistantMessage(message, { answer, events: finalData.events });
      });
      mergeFinalDataIntoCache(queryClient, finalData);
      queryClient.invalidateQueries({ queryKey: ["events"] });
    } catch (error) {
      if (!abortController.signal.aborted && isRecoverableStreamDisconnect(error)) {
        queryClient.invalidateQueries({ queryKey: ["inventory"] });
        queryClient.invalidateQueries({ queryKey: ["events"] });
        return;
      }
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
          void runAskTurn(queuedPrompt, null, [], {
            targetThreadId: turnThreadId,
            developerSessionId: options.developerSessionId,
            appId: options.appId,
            kernel: options.kernel,
            model: options.model,
          });
        }, 0);
      }
    }
  }

  function stopActiveTurn() {
    const runningTurn = runningTurnsRef.current.get(threadId);
    runningTurn?.controller.abort();
    const activeRun = runs.find((run) => isActiveRunRecord(run) && run.sessionId === threadId);
    const pendingAssistant = latestPendingAssistantMessage(messages);
    const runId = runningTurn?.runId || runRecordId(activeRun) || pendingAssistant?.runId;
    void cancelAskStream({ runId: runId || undefined, threadId });
    if (!runningTurn && pendingAssistant) {
      updateThreadMessage(threadId, pendingAssistant.id, (message) => {
        markAssistantMessageError(message, t("system.stopped"));
      });
    }
  }

  function stopVisualTurn() {
    const turnThreadId = activeDeveloperSession?.threadId;
    if (!turnThreadId) return;
    const runningTurn = runningTurnsRef.current.get(turnThreadId);
    runningTurn?.controller.abort();
    const activeRun = runs.find((run) => isActiveRunRecord(run) && run.sessionId === turnThreadId);
    const runId = runningTurn?.runId || runRecordId(activeRun);
    void cancelAskStream({ runId: runId || undefined, threadId: turnThreadId });
  }

  async function submitPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    if (activeThreadCanStop) {
      queuedChoicePromptsRef.current.set(threadId, trimmedPrompt);
      return;
    }
    setQuestion("");
    setComposerSkillInvocation(null);
    setActiveSlashIndex(0);
    setModelMenuKind(null);
    await runAskTurn(trimmedPrompt, null, []);
  }

  async function requestAppBuilder(request: AppBuilderRequest) {
    setView("chat");
    await submitPrompt(buildAppBuilderPrompt(request));
  }

  function resetAppCreateDraft() {
    setAppDraftMode("choice");
    setAppDraftSourceKind("local");
    setAppDraftPath("");
    setAppDraftTitle("");
    setAppDraftDescription("");
  }

  function closeAppCreateDialog() {
    setAppCreateDialogOpen(false);
    resetAppCreateDraft();
  }

  function openAppCreateDialog() {
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    resetAppCreateDraft();
    setAppCreateDialogOpen(true);
  }

  function setAppCreateDialogState(open: boolean) {
    if (open) {
      openAppCreateDialog();
    } else {
      closeAppCreateDialog();
    }
  }

  function directMountAppFromDialog() {
    const path = appDraftPath.trim();
    if (!path) return;
    const title = appDraftTitle.trim();
    const currentSettings = settingsQuery.data?.settings ?? healthQuery.data?.settings;
    const currentMountedApps = currentSettings?.mountedApps ?? [];
    const nextApp = {
      id: mountedAppId(path, title, currentMountedApps),
      path,
      enabled: true,
      ...(title ? { title } : {}),
    };
    settingsMutation.mutate(
      { mountedApps: [...currentMountedApps, nextApp] },
      {
        onSuccess() {
          setActiveMountedAppId(nextApp.id);
          setView("app");
        },
      },
    );
    closeAppCreateDialog();
  }

  function requestAppBuilderFromDialog(request: AppBuilderRequest) {
    closeAppCreateDialog();
    void requestAppBuilder(request);
  }

  async function sendAsk() {
    if (activeThreadCanStop) {
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

  async function sendVisualAsk() {
    if (!activeDeveloperSession) {
      appendMessage("system", "请先创建或选择一个任务。");
      return;
    }
    if (activeDeveloperSessionIsRunning) {
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
    const turnArtifacts = mergeVisualAnnotationArtifacts(contextArtifacts, activeDeveloperSession);
    const contextPayload = buildContextPayload(contextText, turnAttachments, turnArtifacts);
    if (!requestedSkill && !trimmedQuestion && !contextPayload.text.trim() && !turnAttachments.length && !turnArtifacts.length) {
      appendMessage("system", "请输入这个任务的补充说明。");
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
    await runAskTurn(userPrompt, userContext, turnAttachments, {
      requestedSkill,
      targetThreadId: activeDeveloperSession.threadId,
      developerSessionId: activeDeveloperSession.id,
      appId: activeMountedAppDeveloperMode ? activeMountedApp?.name : undefined,
      kernel: activeDeveloperSession.core?.kernel,
      model: activeDeveloperSession.core?.model,
    });
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

  function handleVisualComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isComposingText || event.nativeEvent.isComposing || event.key === "Process") {
      return;
    }
    if (composerSkillInvocation && event.key === "Backspace" && !composerQuestionValue) {
      event.preventDefault();
      setComposerSkillInvocation(null);
      setActiveSlashIndex(0);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendVisualAsk();
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

  function appendVoiceTranscript(transcript: string) {
    const normalized = transcript.trim();
    if (!normalized) return;
    setQuestion((current) => {
      const separator = current.trim() ? "\n" : "";
      return `${current.trimEnd()}${separator}${normalized}`;
    });
    requestAnimationFrame(() => composerInputRef.current?.focus());
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

  const activeDeveloperSessionMessages = activeDeveloperSession
    ? messagesForUiThread(threads, threadId, messages, activeDeveloperSession.threadId)
    : [];

  const renderSharedThreadShell = (threadMessages = messages) => (
    <ThreadShell
      messages={threadMessages}
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

  const renderSharedComposer = () => (
    <ChatComposer
      sending={activeThreadCanStop}
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
      onPaste={handleComposerPaste}
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
      onSubmitOrStop={() => (activeThreadCanStop ? stopActiveTurn() : void sendAsk())}
      onRemoveSkillInvocation={() => {
        setComposerSkillInvocation(null);
        setActiveSlashIndex(0);
        requestAnimationFrame(() => composerInputRef.current?.focus());
      }}
      voiceInput={{
        state: voiceInput.state,
        error: voiceInput.error,
        onToggle: () => void voiceInput.toggle(),
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

  const visualComposerKernel = activeDeveloperSession?.core?.kernel || activeKernel;
  const visualComposerModel = activeDeveloperSession?.core?.model || model;
  const visualComposerRuntimeControls = runtimeControlsForKernel(
    visualComposerKernel,
    activeRuntimeControls,
    healthQuery.data?.runtimeControlsByKernel,
  );
  const renderDeveloperSessionComposer = () => (
    <ChatComposer
      sending={activeDeveloperSessionIsRunning}
      contextText={contextText}
      attachments={attachments}
      contextArtifacts={contextArtifacts}
      composerSkillInvocation={composerSkillInvocation}
      composerQuestionValue={composerQuestionValue}
      composerHeight={composerHeight}
      model={visualComposerModel}
      activeKernel={visualComposerKernel}
      runtimeControls={visualComposerRuntimeControls}
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
      onKeyDown={handleVisualComposerKeyDown}
      onPaste={handleComposerPaste}
      onCompositionStart={() => setIsComposingText(true)}
      onCompositionEnd={() => setIsComposingText(false)}
      onAttachmentInputChange={handleAttachmentInputChange}
      onOpenAttachmentPicker={openAttachmentPicker}
      onToggleModelMenu={toggleModelMenu}
      onSetModel={(nextModel) => {
        if (activeDeveloperSession?.core) {
          patchDeveloperSessionMutation.mutate({
            sessionId: activeDeveloperSession.id,
            patch: { core: { ...activeDeveloperSession.core, model: nextModel } },
          });
        } else {
          setModel(nextModel);
          writeStoredModelBinding(activeModelBindingKey, nextModel);
        }
        setModelMenuKind(null);
      }}
      onSetEffort={setReasoningEffort}
      onSetResponseSpeed={setResponseSpeed}
      onSetAccessMode={setAccessMode}
      onSubmitOrStop={() => (activeDeveloperSessionIsRunning ? stopVisualTurn() : void sendVisualAsk())}
      onRemoveSkillInvocation={() => {
        setComposerSkillInvocation(null);
        setActiveSlashIndex(0);
        requestAnimationFrame(() => composerInputRef.current?.focus());
      }}
      voiceInput={{
        state: voiceInput.state,
        error: voiceInput.error,
        onToggle: () => void voiceInput.toggle(),
      }}
    />
  );

  function openRailSection(section: RailSectionId) {
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    if (section === "chat") {
      setView("chat");
    } else if (section === "rooms") {
      setRoomsAppView("messages");
      setView("rooms");
    } else if (section === "library") {
      setView("library");
    } else if (section === "ops") {
      setView("ops");
    } else if (section === "extensions") {
      setView("extensions");
    } else if (section === "apps") {
      if (mountedApps[0]) {
        setActiveMountedAppId(mountedApps[0].name);
        setView("app");
      } else {
        openAppCreateDialog();
      }
    } else if (section === "settings") {
      setSettingsInitialSection("kernels");
      setView("settings");
    }
  }

  function openRoomsMessages(roomId?: string) {
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    setRoomsFocusRoomId(roomId ?? "");
    setRoomsAppView("messages");
    setView("rooms");
  }

  function openRoomsContacts() {
    setProjectMenuOpenId("");
    setConversationSortMenuOpen(false);
    setRoomsAppView("contacts");
    setView("rooms");
  }

  if (embeddedMountedAppMode) {
    return (
      <div className="embedded-mounted-app-shell" data-layout="developer-preview">
        <section className="view-panel mounted-app-view" data-view="app">
          <MountedAppWorkbench
            app={activeMountedApp}
            selectedPath={mountedAppSelectedPath}
            onSelectedPathChange={setMountedAppSelectedPath}
            corePanel={(
              <MountedAppChatPanel
                app={activeMountedApp}
                appContextText={activeMountedApp ? mountedAppAgentContext(activeMountedApp, mountedAppSelectedPath) : ""}
              />
            )}
          />
        </section>
      </div>
    );
  }

  return (
    <div
      className="app-shell react-app"
      data-view={activeView}
      data-rail-expanded={railExpanded ? "true" : "false"}
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      style={{
        "--opengrove-rail-width": railExpanded ? "128px" : "52px",
        "--opengrove-sidebar-width": `${sidebarWidth}px`,
      } as CSSProperties}
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
        expanded={railExpanded}
        mountedApps={mountedApps}
        activeMountedAppId={activeView === "app" ? activeMountedApp?.name : ""}
        mountedAppDeveloperModeIds={mountedAppDeveloperModeIds}
        onCreateApp={openAppCreateDialog}
        onSelectMountedApp={selectMountedApp}
        onEnterMountedAppDeveloperMode={enterMountedAppDeveloperMode}
        onExitMountedAppDeveloperMode={exitMountedAppDeveloperMode}
        onDeleteMountedApp={deleteMountedAppTab}
        onOpenSection={openRailSection}
        onOpenSettings={() => openRailSection("settings")}
        onSetExpanded={setRailExpanded}
      />

      <Dialog open={appCreateDialogOpen} onOpenChange={setAppCreateDialogState}>
        <DialogContent className="app-create-dialog" aria-label="新建应用">
          <DialogTitle>新建应用</DialogTitle>
          <AppCreateWizard
            mode={appDraftMode}
            title={appDraftTitle}
            source={appDraftPath}
            sourceKind={appDraftSourceKind}
            description={appDraftDescription}
            loading={settingsQuery.isLoading}
            saving={settingsMutation.isPending}
            canRequestAgent
            onModeChange={setAppDraftMode}
            onTitleChange={setAppDraftTitle}
            onSourceChange={setAppDraftPath}
            onSourceKindChange={setAppDraftSourceKind}
            onDescriptionChange={setAppDraftDescription}
            onCancel={closeAppCreateDialog}
            onDirectMount={directMountAppFromDialog}
            onRequestAgent={requestAppBuilderFromDialog}
          />
        </DialogContent>
      </Dialog>

      <aside className="sidebar" data-section={activeRailSection} aria-label={t("layout.sidebar")}>
        <nav className="nav-list" aria-label={t("layout.spaceNav")}>
          {activeRailSection === "library" ? (
            <DirectoryPanel
              title={t("app.library")}
              aria-label={t("app.library")}
              actions={(
                <>
                  <button className="sidebar-mini-action" type="button" onClick={() => createVaultEntry("note", "")} aria-label={t("vault.newNote")} title={t("vault.newNote")}>
                    <ThemedPixelIcon pixelIcon="document" professionalIcon={FilePlus2} professionalSize={13} pixelSize={15} />
                  </button>
                  <button className="sidebar-mini-action" type="button" onClick={() => createVaultEntry("folder", "")} aria-label={t("vault.newFolder")} title={t("vault.newFolder")}>
                    <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderPlus} professionalSize={13} pixelSize={15} />
                  </button>
                  <button className="sidebar-mini-action" type="button" onClick={() => importLocalFolderMutation.mutate()} aria-label={t("vault.importLocalFolder")} title={t("vault.importLocalFolder")}>
                    <ThemedPixelIcon pixelIcon="folder" professionalIcon={FolderInput} professionalSize={13} pixelSize={15} />
                  </button>
                  <button
                    className="sidebar-mini-action"
                    type="button"
                    onClick={() => setVaultExpandRequest((current) => ({ id: current.id + 1, open: !vaultAllFoldersOpen }))}
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
                    <ThemedPixelIcon pixelIcon="search" professionalIcon={Search} professionalSize={13} pixelSize={15} />
                  </button>
                </>
              )}
              search={showLibrarySearch ? (
                <label className="sidebar-library-search">
                  <ThemedPixelIcon pixelIcon="search" professionalIcon={Search} professionalSize={13} pixelSize={15} />
                  <input autoFocus value={knowledgeQuery} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder={t("vault.search")} />
                </label>
              ) : null}
            >
              <VaultSidebarPanel
                documents={vaultDocuments}
                folders={knowledgeFolders as KnowledgeFolderRecord[]}
                focusedKnowledgeId={focusedKnowledgeId}
                forceOpen={Boolean(knowledgeQuery.trim())}
                expandRequest={vaultExpandRequest}
                revealPathRequest={vaultRevealPathRequest}
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
            </DirectoryPanel>
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
              onCloseConversationSortMenu={() => setConversationSortMenuOpen(false)}
              onSortKeyChange={setConversationSortKey}
              onOpenNewProject={openNewProject}
              onOpenFolderProject={openFolderProject}
              onOpenNewThread={openNewThread}
              onOpenThread={openThread}
              onToggleProjectCollapsed={(projectId) => setProjectCollapsedIds((ids) => ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId])}
              onToggleProjectMenu={(projectId) => setProjectMenuOpenId((current) => (current === projectId ? "" : projectId))}
              onCloseProjectMenu={() => setProjectMenuOpenId("")}
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

      <MobileNav
        activeView={activeView}
        onSelect={(view) => {
          if (view === "rooms") {
            openRoomsMessages();
            return;
          }
          setView(view);
        }}
      />

      <main className="workspace">
        {activeView === "chat" ? (
          <section className="view-panel chat-view" data-view="chat" data-empty={messages.length === 0 ? "true" : "false"}>
            <div className="workspace-overlay-controls chat-frame-controls" aria-label="当前对话工具">
              <span className="topbar-status-pill" title={formatKernelLabel(healthQuery.data?.kernel) || "Kernel"}>
                <KernelIcon kernelId={healthQuery.data?.kernel} className="topbar-kernel-icon" size={14} />
                <span>{formatKernelLabel(healthQuery.data?.kernel) || "Kernel"}</span>
              </span>
              <button
                className="topbar-icon-button chat-frame-workbench-button"
                data-open={inspectorOpen ? "true" : "false"}
                type="button"
                onClick={() => setInspectorOpen((current) => !current)}
                title={inspectorOpen ? t("layout.closeWorkbench") : t("layout.openWorkbench")}
                aria-label={inspectorOpen ? t("layout.closeWorkbench") : t("layout.openWorkbench")}
              >
                <ListChecks size={17} />
              </button>
            </div>
            <div className="chat-layout" data-inspector={inspectorOpen ? "true" : "false"}>
              <section className="conversation">
                <section ref={threadScrollRef} className="thread chat-thread-scroll" aria-live="polite">
                  {renderSharedThreadShell()}
                </section>

                {renderSharedComposer()}
              </section>
            </div>
            {inspectorOpen ? (
              <aside className="workspace-overlay-panel inspector" aria-label={t("layout.workbench")}>
                <WorkspaceInspector
                  workingState={workingState}
                  currentSession={currentSession}
                  latestRun={latestRun}
                  runtimeBlocker={runtimeBlocker}
                  kernelLabel={formatKernelLabel(healthQuery.data?.kernel)}
                  threadId={threadId}
                  sending={activeThreadCanStop}
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
          </section>
        ) : null}

        {activeView === "app" ? (
          <section
            className={clsx("view-panel", "mounted-app-view", activeMountedAppDeveloperMode ? "mounted-app-developer-view visual-view" : "")}
            data-view="app"
          >
            {activeMountedAppDeveloperMode ? (
              <VisualWorkbench
                activeSession={activeMountedAppDeveloperSession}
                developerMode={true}
                allowAiCollapse={false}
                previewReloadKey={activeMountedAppDeveloperSession ? visualPreviewReloadKeys[activeMountedAppDeveloperSession.id] ?? 0 : 0}
                onAddAnnotation={saveDeveloperSessionAnnotation}
                onDeleteAnnotation={removeDeveloperSessionAnnotation}
                onPreviewLoaded={markVisualPreviewLoaded}
                onPreviewFailed={markVisualPreviewFailed}
                onCreateSession={() => activeMountedApp && enterMountedAppDeveloperMode(activeMountedApp.name)}
                corePanel={(
                  <>
                    <section ref={threadScrollRef} className="library-ai-thread chat-thread-scroll" aria-live="polite">
                      {renderSharedThreadShell(activeDeveloperSessionMessages)}
                    </section>
                    {renderDeveloperSessionComposer()}
                  </>
                )}
              />
            ) : (
              <MountedAppWorkbench
                app={activeMountedApp}
                selectedPath={mountedAppSelectedPath}
                onSelectedPathChange={setMountedAppSelectedPath}
                corePanel={(
                  <MountedAppChatPanel
                    app={activeMountedApp}
                    appContextText={activeMountedApp ? mountedAppAgentContext(activeMountedApp, mountedAppSelectedPath) : ""}
                  />
                )}
              />
            )}
          </section>
        ) : null}

        {activeView === "extensions" ? (
          <ExtensionsView
            extensions={inventory?.extensions}
            settings={settingsQuery.data?.settings ?? healthQuery.data?.settings}
            loading={inventoryQuery.isLoading || settingsQuery.isLoading}
            saving={settingsMutation.isPending}
            actionPending={extensionActionMutation.isPending}
            onEditSkill={openExtensionSkillEditor}
            onOpenLocalPath={(path) => openExtensionLocalPathMutation.mutate(path)}
            onAction={(path, body) => extensionActionMutation.mutate({ path, body })}
          />
        ) : null}

        {activeView === "rooms" && roomsAppView === "messages" && roomsRuntimeReady ? (
          <RoomsView
            activeKernel={activeKernel}
            activeModel={model}
            activeWorkspaceRoot={activeWorkspaceRoot}
            kernelOptions={settingsQuery.data?.settings.kernels ?? healthQuery.data?.settings?.kernels ?? []}
            runtimeControls={activeRuntimeControls}
            runtimeControlsByKernel={healthQuery.data?.runtimeControlsByKernel}
            runtimeEvents={events}
            runs={runs}
            focusRoomId={roomsFocusRoomId}
            pendingApprovalCount={pendingApprovals.length}
            onResolveApproval={(approvalId, action, response) => approvalsMutation.mutateAsync({ approvalId, action, response })}
            onOpenContacts={openRoomsContacts}
            onOpenSettings={() => setView("settings")}
          />
        ) : activeView === "rooms" && roomsAppView === "messages" ? (
          <section className="rooms-view" aria-label="消息" />
        ) : null}

        {activeView === "rooms" && roomsAppView === "contacts" ? (
          <ContactsView
            activeKernel={activeKernel}
            activeModel={model}
            activeWorkspaceRoot={activeWorkspaceRoot}
            extensions={inventory?.extensions}
            kernelOptions={settingsQuery.data?.settings.kernels ?? healthQuery.data?.settings?.kernels ?? []}
            runtimeControls={activeRuntimeControls}
            runtimeControlsByKernel={healthQuery.data?.runtimeControlsByKernel}
            skills={skills}
            onOpenMessages={openRoomsMessages}
          />
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
            {!libraryAiOpen ? (
              <aside className="library-ai-edge-rail" aria-label={`${t("library.aiTitle")} 已收起`}>
                <button
                  className="library-ai-edge-button"
                  type="button"
                  style={{ "--library-ai-rail-bottom": `${libraryAiRailBottom}px` } as CSSProperties}
                  data-dragging={libraryAiRailDragging ? "true" : "false"}
                  onMouseDown={onLibraryAiRailMouseDown}
                  onClick={openLibraryAiFromRail}
                  title={`${t("library.openAi")}；拖动可调整位置`}
                  aria-label={`${t("library.openAi")}，拖动可调整位置`}
                >
                  <span className="library-ai-edge-mark">
                    <OpenGroveSaplingMark />
                  </span>
                  <span className="library-ai-edge-label">{t("library.aiTitle")}</span>
                </button>
              </aside>
            ) : null}
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
                      <ThemedPixelIcon pixelIcon="plus" professionalIcon={SquarePen} professionalSize={14} pixelSize={15} />
                    </button>
                  </div>
                  <button className="library-ai-icon-button" type="button" onClick={() => setLibraryAiOpen(false)} aria-label={t("library.closeAi")} title={t("library.closeAi")}>
                    <X size={15} />
                  </button>
                </header>
                <section ref={libraryAiScrollRef} className="library-ai-thread chat-thread-scroll" aria-live="polite">
                  {renderSharedThreadShell()}
                </section>
                {renderSharedComposer()}
              </aside>
              </>
            ) : null}
          </section>
        ) : null}
        {activeView === "settings" || activeView === "ops" ? (
          <SettingsDialog
            embedded
            initialSection={activeView === "ops" ? "ops" : settingsInitialSection}
            settings={settingsQuery.data?.settings ?? healthQuery.data?.settings}
            loading={settingsQuery.isLoading}
            saving={settingsMutation.isPending}
            installingKernelId={installKernelMutation.isPending ? installKernelMutation.variables?.kernelId : ""}
            copilotAuth={copilotAuthQuery.data?.auth}
            copilotAuthLoading={copilotAuthQuery.isLoading || copilotAuthQuery.isFetching}
            copilotLoginPending={copilotLoginMutation.isPending}
            error={settingsQuery.error instanceof Error ? settingsQuery.error.message : ""}
            onClose={() => setView("chat")}
            onInstallKernel={(kernelId, actionId) => installKernelMutation.mutate({ kernelId, actionId })}
            onRequestAppBuilder={(request) => void requestAppBuilder(request)}
            onStartCopilotLogin={() => copilotLoginMutation.mutate()}
            onSave={(payload) => settingsMutation.mutate(payload)}
            ops={{
              runs,
              executions,
              approvals,
              events,
              skills,
              tools,
              developerSessions,
              selectedRunId: selectedOpsRunId,
              contextRecords,
              onSelectRun: setSelectedOpsRunId,
              onUpdateDiagnostics: (patch) => settingsMutation.mutate(patch),
            }}
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

function buildAppBuilderPrompt(request: AppBuilderRequest): string {
  const titleLine = request.title ? `应用名称：${request.title}` : "应用名称：未指定，请根据功能取一个清晰名称";
  if (request.mode === "import") {
    return [
      "请使用 opengrove-app-builder skill 导入一个 OpenGrove App，并用当前默认 kernel 完成接入。",
      "",
      titleLine,
      `来源类型：${appBuilderSourceKindLabel(request.sourceKind)}`,
      `来源：${request.source || ""}`,
      "",
      "导入边界：",
      "1. 本地普通项目优先用 opengrove app import <source> --target <app-dir> --id <id> 生成 App 包边界；URL 来源先用 opengrove app stage 落到 OpenGrove 托管 staging，再 import staged root。",
      "2. 对 staged/local root 运行 opengrove app inspect；如果来源已有完整前端界面，优先按原界面接入，不重做 UI。",
      "3. 如果来源没有完整界面，根据 App 功能设计一个 OpenGrove 原生工作台，优先复用现有组件，例如共享目录树、Markdown/媒体预览、设置表单和对话面板。",
      "4. 所有文件读写必须限制在 App 目录或 manifest 声明的 workspace 内；不要把用户资料、密钥或缓存复制进 App 包。",
      "5. 若需要命令能力，优先在 App 自己的 bin/ 或 scripts/ 下提供 CLI，并在 manifest/skill 文档里写清楚命令、输入、输出和失败行为。",
      "6. 完成后运行 opengrove app validate 和 opengrove app report；如果报告 readyToMount，再用 opengrove app mount 或 Settings UI 注册。",
      "7. 验证前端构建/类型检查、App 文件浏览与 workspace 写入、至少一个真实 smoke 流程。",
      "",
      "最后请用人话说明：接入了什么、用户从哪里打开、还需要用户配置哪些密钥/模型/本地依赖。",
    ].join("\n");
  }
  return [
    "请使用 opengrove-app-builder skill 根据下面描述创建一个 OpenGrove App，并用当前默认 kernel 完成实现。",
    "",
    titleLine,
    "应用描述：",
    request.description || "",
    "",
    "创建边界：",
    "1. 先用 opengrove app scaffold 建立 App 包边界，再填入真实 manifest、ui、skills、bin/scripts、workspace 示例。",
    "2. 把 App 当成可传递的工作台包：manifest、ui、skills、bin/scripts、workspace 示例和 agent 说明要能说明完整体验。",
    "3. 先判断用户真正的工作流，再决定 UI：能用现有 OpenGrove 组件就复用；只有现有组件表达不了时才新增小而清晰的组件。",
    "4. 业务逻辑不要写死到通用组件里；如果需要目录、预览、表单、任务状态，请通过 adapter 接入共享组件。",
    "5. App 的读写、命令执行和产物输出必须有明确边界，默认写入自己的 workspace/runs 或 manifest 声明的目录。",
    "6. 完成后运行 opengrove app validate 和 opengrove app report；如果报告 readyToMount，再用 opengrove app mount 或 Settings UI 注册。",
    "7. 验证前端构建/类型检查、文件工作台操作、至少一个端到端 smoke 流程。",
    "",
    "最后请用人话说明：这个 App 能干什么、用户怎么用、还缺哪些真实依赖或模型配置。",
  ].join("\n");
}

function appBuilderSourceKindLabel(kind: AppBuilderRequest["sourceKind"]): string {
  if (kind === "git") return "Git / GitHub URL";
  if (kind === "archive") return "压缩包 URL";
  if (kind === "project") return "普通项目或混合项目";
  return "本地文件夹";
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
