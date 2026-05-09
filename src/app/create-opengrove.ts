import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { APP_CONFIG_DIR, APP_PRODUCT_NAME } from "../identity.js";
import {
  ApprovalInbox,
  ArtifactStore,
  CapabilityRegistry,
  ExecutionStore,
  EventLog,
  MemoryLedger,
  PackRegistry,
  RoutineRegistry,
  SessionStore,
  ToolRegistry,
  WorkingStateStore,
  type AgentEvent,
  type AgentContext,
  type ActivitySpace,
  type AgentRuntime,
  type InvokedSkillRecord,
  type PolicyRule,
  type ResponseSpeed,
  type RuntimeAccessMode,
  type SkillCatalog,
  type SkillManifest,
} from "../core.js";
import {
  browserActCapability,
  createBrowserActTools,
} from "../capabilities/browser-act/index.js";
import {
  computerUseCapability,
  createComputerUseTools,
} from "../capabilities/computer-use/index.js";
import {
  createWereadCompanionTools,
  wereadCompanionCapability,
} from "../capabilities/weread-companion/index.js";
import {
  createDefaultContextAssembler,
  type ContextAssembler,
} from "../context/context-assembler.js";
import {
  createReadOnlyBrowserAdapter,
  type BrowserEnvironmentAdapter,
} from "../environment/browser-adapter.js";
import {
  createStagedComputerAdapter,
  hasComputerState,
  normalizeComputerSnapshot,
  type ComputerEnvironmentAdapter,
} from "../environment/computer-adapter.js";
import type { BrowserPageReader, BrowserPageSnapshot } from "../tools/browser.js";
import type { ComputerStateReader, ComputerStateSnapshot } from "../tools/computer.js";
import { createRequestChoicesTool } from "../tools/host-ui.js";
import { createSkillInvokeTool } from "../tools/skill.js";
import { createPackRegistry } from "../packs/catalog.js";
import {
  createKernelRuntime,
  createRuntimeKernelAdapter,
} from "../kernel/adapter.js";
import { PI_KERNEL_CONTRACT } from "../kernel/adapters/pi.js";
import type { KernelAdapter } from "../kernel/types.js";
import { createKnowledgeBackedArtifactStore } from "../knowledge/artifact-view.js";
import { createKnowledgeBackedMemoryLedger } from "../knowledge/memory-view.js";
import {
  createKnowledgeFeedbackScorer,
  type KnowledgeFeedbackScorer,
} from "../knowledge/feedback-scorer.js";
import {
  createKnowledgeOrganizer,
  type KnowledgeOrganizer,
} from "../knowledge/organizer.js";
import {
  createKnowledgeSkillCatalogView,
  skillKnowledgeId,
} from "../knowledge/skill-view.js";
import { skillFileKnowledgeDocuments, skillTreeMetadata } from "./skill-tree.js";
import { createKnowledgeStore, type KnowledgeStore } from "../knowledge/store.js";
import { PiAgentRuntime, type PiAgentRuntimeOptions } from "../runtime/pi-runtime.js";
import { createSkillCatalog } from "../skills/catalog.js";
import {
  nativeSkillPublicationsToMetadata,
  publishNativeSkills,
  shouldExposeSkillTool,
} from "../skills/native-publisher.js";
import {
  clearActiveSkillState,
  createInvokedSkillRecord,
  recordInvokedSkill,
} from "../skills/runtime.js";

export interface OpenGroveApp {
  events: EventLog;
  approvals: ApprovalInbox;
  capabilities: CapabilityRegistry;
  memory: MemoryLedger;
  artifacts: ArtifactStore;
  knowledge: KnowledgeStore;
  knowledgeOrganizer: KnowledgeOrganizer;
  knowledgeFeedbackScorer: KnowledgeFeedbackScorer;
  skills: SkillCatalog;
  packs: PackRegistry;
  sessions: SessionStore;
  executions: ExecutionStore;
  workingState: WorkingStateStore;
  routines: RoutineRegistry;
  tools: ToolRegistry;
  recordEvent(event: AgentEvent, options?: RecordEventOptions): AgentEvent;
  runTurn(input: string, options?: AgentTurnOptions): AsyncIterable<AgentEvent>;
}

export interface AgentTurnOptions {
  sessionId?: string;
  requestedModelId?: string;
  requestedEffort?: string;
  requestedSkillName?: string;
  requestedSkillArgs?: string;
  responseSpeed?: ResponseSpeed;
  accessMode?: RuntimeAccessMode;
  policy?: PolicyRule[];
  signal?: AbortSignal;
}

export interface RecordEventOptions {
  sessionId?: string;
  activity?: ActivitySpace;
  input?: string;
}

export interface CreateOpenGroveOptions {
  readPage: BrowserPageReader;
  readComputer?: ComputerStateReader;
  browserAdapter?: BrowserEnvironmentAdapter;
  computerAdapter?: ComputerEnvironmentAdapter;
  createSession?: PiAgentRuntimeOptions["createSession"];
  runtime?: AgentRuntime;
  kernel?: KernelAdapter;
  assembleContext?: ContextAssembler;
  policy?: PolicyRule[];
  sessionId?: string;
  userId?: string;
  cwd?: string;
  workspaceRoot?: string;
  includeCodexSkills?: boolean;
}

export function createOpenGrove(options: CreateOpenGroveOptions): OpenGroveApp {
  const workspaceRoot = options.workspaceRoot ?? options.cwd;
  const events = new EventLog();
  const approvals = new ApprovalInbox();
  const capabilities = new CapabilityRegistry()
    .register(wereadCompanionCapability)
    .register(browserActCapability)
    .register(computerUseCapability);
  const knowledge = createKnowledgeStore();
  const knowledgeOrganizer = createKnowledgeOrganizer({ store: knowledge });
  const knowledgeFeedbackScorer = createKnowledgeFeedbackScorer({ store: knowledge });
  const memory = createKnowledgeBackedMemoryLedger(knowledge);
  const artifacts = createKnowledgeBackedArtifactStore(knowledge);
  const baseSkills = createSkillCatalog({
    cwd: options.cwd,
    workspaceRoot,
    includeCodexSkills: options.includeCodexSkills === true,
  });
  const nativeSkillPublications = options.kernel?.capabilities.knowledge?.nativeSkills
    ? publishNativeSkills({
        cwd: workspaceRoot,
        kernelId: options.kernel.id,
        kernelCapabilities: options.kernel.capabilities,
        skills: baseSkills.list(),
      })
    : new Map();
  const skills = createKnowledgeSkillCatalogView(
    baseSkills,
    knowledge,
    {
      extraMetadata(skill) {
        return {
          ...nativeSkillPublicationsToMetadata(
            nativeSkillPublications.get(skill.id) ?? nativeSkillPublications.get(skillKnowledgeId(skill.id)),
          ),
          ...skillTreeMetadata(skill),
        };
      },
      extraDocuments: skillFileKnowledgeDocuments,
    },
  );
  const packs = createPackRegistry({ cwd: options.cwd });
  const sessions = new SessionStore();
  const executions = new ExecutionStore();
  const workingState = new WorkingStateStore();
  const routines = new RoutineRegistry();
  const tools = new ToolRegistry();
  const browserAdapter = options.browserAdapter ?? createReadOnlyBrowserAdapter(options.readPage);
  const computerAdapter = options.computerAdapter ?? createStagedComputerAdapter(options.readComputer ?? (() => ({})));
  for (const tool of createWereadCompanionTools(options.readPage)) {
    tools.register(tool);
  }
  for (const tool of createBrowserActTools(browserAdapter)) {
    tools.register(tool);
  }
  for (const tool of createComputerUseTools(computerAdapter)) {
    tools.register(tool);
  }
  if (shouldExposeSkillTool(options.kernel)) {
    tools.register(
      createSkillInvokeTool({
        id: "skill.invoke",
        title: "Invoke skill",
        description: "Load a skill by name with progressive disclosure. Returns the skill instructions for the next step instead of keeping every skill body in the base prompt.",
        activity: "local",
        risk: "read",
        input: {
          type: "json-schema",
          schema: {
            type: "object",
            required: ["skill"],
            properties: {
              skill: { type: "string" },
              args: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        permission: {
          mode: "allow",
          reason: "Loading a local skill is read-only.",
        },
      }),
    );
  }
  tools.register(
    createRequestChoicesTool({
      id: "host.ui.requestChoices",
      title: "Request structured choices",
      description: "Ask the OpenGrove host UI to render structured multiple-choice input. Prefer one question per call for step-by-step flows; after calling it, stop so the host submit button can send the user's choice as the next user turn.",
      activity: "chat",
      risk: "read",
      input: {
        type: "json-schema",
        schema: {
          type: "object",
          required: ["questions"],
          properties: {
            formId: { type: "string" },
            title: { type: "string" },
            instructions: { type: "string" },
            submitLabel: { type: "string" },
            questions: {
              type: "array",
              items: {
                type: "object",
                required: ["prompt", "options"],
                properties: {
                  id: { type: "string" },
                  prompt: { type: "string" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["label"],
                      properties: {
                        value: { type: "string" },
                        label: { type: "string" },
                        description: { type: "string" },
                      },
                      additionalProperties: false,
                    },
                  },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
      permission: {
        mode: "allow",
        reason: "Rendering a local choice form is read-only and does not send data externally.",
      },
    }),
  );

  const runtime = createRuntime(options);
  const assembleContext = options.assembleContext ?? createDefaultContextAssembler();

  const app: OpenGroveApp = {
    events,
    approvals,
    capabilities,
    memory,
    artifacts,
    knowledge,
    knowledgeOrganizer,
    knowledgeFeedbackScorer,
    skills,
    packs,
    sessions,
    executions,
    workingState,
    routines,
    tools,
    recordEvent(event, recordOptions = {}) {
      const recorded = events.append(event);
      const fallbackSessionId =
        recordOptions.sessionId ??
        workingState.get().sessionId ??
        options.sessionId ??
        "local";
      const run = sessions.recordEvent(recorded, {
        sessionId: fallbackSessionId,
        activity: recordOptions.activity,
        input: recordOptions.input,
      });
      executions.appendFromEvent(recorded, {
        sessionId: run?.sessionId ?? fallbackSessionId,
      });
      return recorded;
    },
    async *runTurn(input, turnOptions = {}) {
      const page = await options.readPage();
      const computer = await (options.readComputer?.() ?? Promise.resolve({} as ComputerStateSnapshot));
      const sessionId = turnOptions.sessionId ?? options.sessionId ?? "local";
      const activity: ActivitySpace = hasComputerState(computer) ? "computer" : browserAdapter.kind;
      const runId = createRunId();
      const availableSkills = skills.list();
      const discoveryPatch = {
        discoveredSkillIds: availableSkills.map((skill) => skill.id),
        discoveredSkillNames: availableSkills.map((skill) => skill.name),
      };
      const preparedInput = prepareTurnInput(input, {
        runId,
        sessionId,
        cwd: workspaceRoot,
        skills,
        workingState,
        kernel: options.kernel,
        requestedSkillName: turnOptions.requestedSkillName,
        requestedSkillArgs: turnOptions.requestedSkillArgs,
      });
      const context: AgentContext = {
        sessionId,
        userId: options.userId,
        activity,
        memory,
        artifacts,
        skills,
        packs,
        sessions,
        executions,
        workingState,
        approvals,
        page: toAgentPageContext(page),
        computer: toAgentComputerContext(computer),
      };
      const assembledContext = assembleContext(preparedInput.contextInput, context, {
        runId,
        kernelId: options.kernel?.id,
        kernelCapabilities: options.kernel?.capabilities,
      });
      recordRequestedSkillDelivery({
        knowledge,
        invocation: preparedInput.invocation,
        runId,
        sessionId,
        kernel: options.kernel,
      });
      sessions.startRun({
        id: runId,
        sessionId,
        activity,
        input: preparedInput.originalInput,
      });

      let seededSkillEvents = false;
      let runPaused = false;
      for await (const event of runtime.runTurn({
        input: preparedInput.runtimeInput,
        runId,
        context,
        assembledContext,
        requestedModelId: turnOptions.requestedModelId ?? preparedInput.requestedModelId,
        requestedEffort: turnOptions.requestedEffort ?? preparedInput.requestedEffort,
        responseSpeed: turnOptions.responseSpeed,
        accessMode: turnOptions.accessMode,
        requestedSkillInvocation: preparedInput.invocation,
        signal: turnOptions.signal,
        tools: tools.list(),
        capabilities: capabilities.list(),
        skills: availableSkills,
        packs: packs.list(),
        policy: [...(options.policy ?? []), ...(turnOptions.policy ?? []), ...capabilities.policy()],
      })) {
        workingState.update({
          sessionId,
          ...discoveryPatch,
        });
        if (event.type === "skill.cleared") {
          workingState.update({
            ...clearActiveSkillState(workingState.get(), event.reason),
          });
        }
        if (event.type === "run.paused") {
          runPaused = true;
        }
        app.recordEvent(event, {
          sessionId,
          activity,
          input: preparedInput.originalInput,
        });
        yield event;
        if (!seededSkillEvents && event.type === "turn.started") {
          seededSkillEvents = true;
          if (availableSkills.length > 0) {
            const discovered: AgentEvent = {
              type: "skill.discovered",
              runId,
              skills: availableSkills,
            };
            app.recordEvent(discovered, {
              sessionId,
              activity,
              input: preparedInput.originalInput,
            });
            yield discovered;
          }
          for (const extra of preparedInput.prefixEvents) {
            app.recordEvent(extra, {
              sessionId,
              activity,
              input: preparedInput.originalInput,
            });
            yield extra;
          }
        }
        if (event.type === "compaction.started") {
          const record = memory.write({
            scope: "session",
            kind: "compaction_snapshot",
            text: createCompactionSnapshotText(preparedInput.originalInput, assembledContext),
            confidence: "observed",
            source: {
              kind: "agent",
              ref: {
                title: "Codex compaction",
                locator: `run:${runId}`,
              },
            },
            tags: ["compaction", "context"],
            data: {
              runId,
              sessionId,
            },
          });
          const memoryEvent: AgentEvent = { type: "memory.written", runId, record };
          app.recordEvent(memoryEvent, {
            sessionId,
            activity,
            input: preparedInput.originalInput,
          });
          yield memoryEvent;
        }
      }
      if (!runPaused) {
        const nextWorkingState = workingState.get();
        if (nextWorkingState.activeSkillId || nextWorkingState.activePackId) {
          workingState.update({
            ...clearActiveSkillState(nextWorkingState, "turn-complete"),
          });
        }
      }
    },
  };

  return app;
}

function createRuntime(options: CreateOpenGroveOptions): AgentRuntime {
  if (options.kernel) {
    return createKernelRuntime(options.kernel);
  }
  if (options.runtime) {
    return createKernelRuntime(
      createRuntimeKernelAdapter({
        id: "agent-runtime",
        title: "Agent Runtime",
        runtime: options.runtime,
      }),
    );
  }
  return createDefaultRuntime(options);
}

function createDefaultRuntime(options: CreateOpenGroveOptions): AgentRuntime {
  if (!options.createSession) {
    throw new Error("createOpenGrove requires either runtime or createSession.");
  }
  return createKernelRuntime(
    createRuntimeKernelAdapter({
      id: "pi",
      title: "Pi",
      runtime: new PiAgentRuntime({
        createSession: options.createSession,
      }),
      capabilities: {
        streaming: true,
        toolCalls: true,
        hostTools: true,
        approvals: true,
        elicitation: false,
        artifacts: true,
        compaction: false,
        authRefresh: false,
        sandbox: ["danger-full-access"],
      },
      contract: PI_KERNEL_CONTRACT,
    }),
  );
}

function toAgentPageContext(page: BrowserPageSnapshot) {
  return {
    url: page.url,
    title: page.title,
    selection: page.selection,
    visibleText: page.visibleText,
    locator: page.locator,
    vaultFile: page.vaultFile,
    attachments: Array.isArray(page.attachments) ? page.attachments : [],
  };
}

function toAgentComputerContext(computer: ComputerStateSnapshot) {
  return normalizeComputerSnapshot(computer);
}

function createRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function recordRequestedSkillDelivery(options: {
  knowledge: KnowledgeStore;
  invocation?: InvokedSkillRecord;
  runId: string;
  sessionId: string;
  kernel?: KernelAdapter;
}): void {
  const { invocation } = options;
  if (!invocation) {
    return;
  }

  const mode = options.kernel?.capabilities.knowledge?.nativeSkills ? "native_skill" : "loaded_skill";
  options.knowledge.recordDelivery({
    id: `skill_delivery_${options.runId}`,
    runId: options.runId,
    sessionId: options.sessionId,
    kernelId: options.kernel?.id,
    createdAt: new Date().toISOString(),
    query: invocation.args || invocation.skillName,
    decisions: [
      {
        knowledgeId: skillKnowledgeId(invocation.skillId),
        knowledgeType: "skill",
        title: invocation.title || invocation.skillName,
        mode,
        reason:
          mode === "native_skill"
            ? "Skill is available through the native kernel skill loader."
            : "Skill body is delivered through requestedSkillInvocation, not duplicated in assembled context.",
        score: 1,
        includeInPrompt: false,
        metadata: {
          skillId: invocation.skillId,
          skillName: invocation.skillName,
          origin: invocation.origin,
          source: invocation.source,
        },
      },
    ],
    metadata: {
      source: "requested_skill",
      promptItemCount: 0,
    },
  });
}

function prepareTurnInput(
  input: string,
  options: {
    runId: string;
    sessionId: string;
    cwd?: string;
    skills: SkillCatalog;
    workingState: WorkingStateStore;
    kernel?: KernelAdapter;
    requestedSkillName?: string;
    requestedSkillArgs?: string;
  },
): {
  originalInput: string;
  contextInput: string;
  runtimeInput: string;
  requestedModelId?: string;
  requestedEffort?: string;
  invocation?: InvokedSkillRecord;
  prefixEvents: AgentEvent[];
} {
  const originalInput = input.trim();
  const currentWorkingState = options.workingState.get();
  const prefixEvents: AgentEvent[] = [];
  const requestedSkillName = options.requestedSkillName?.trim();

  if (requestedSkillName) {
    const manifest = options.skills.resolve(requestedSkillName, { includeDisabled: true });
    if (manifest) {
      const requestedSkillArgs = resolveRequestedSkillArgs({
        originalInput,
        requestedSkillName: manifest.name,
        requestedSkillArgs: options.requestedSkillArgs,
      });
      const useNativeSkill = options.kernel?.capabilities.knowledge?.nativeSkills === true;
      const invocation = useNativeSkill
        ? createNativeSkillInvocation(manifest, requestedSkillArgs, {
            kernelId: options.kernel?.id,
            cwd: options.cwd,
          })
        : createInvokedSkillRecord(options.skills.load(manifest.name, requestedSkillArgs, options.sessionId), "user");
      options.workingState.update({
        ...recordInvokedSkill(currentWorkingState, invocation),
      });
      prefixEvents.push({
        type: "skill.invoked",
        runId: options.runId,
        skill: manifest,
        invocation,
      });
      prefixEvents.push({
        type: "skill.loaded",
        runId: options.runId,
        skillId: manifest.id,
        contentPreview: invocation.contentPreview,
        allowedTools: [...manifest.allowedTools],
        model: manifest.model,
        effort: manifest.effort,
        context: manifest.context,
      });

      const runtimeInput = useNativeSkill
        ? nativeSkillRuntimeInput(options.kernel?.id, manifest.name, requestedSkillArgs)
        : requestedSkillArgs || `Use /${manifest.name} and continue with the loaded instructions.`;
      return {
        originalInput: originalInput || (requestedSkillArgs ? `/${manifest.name} ${requestedSkillArgs}` : `/${manifest.name}`),
        contextInput: requestedSkillArgs || manifest.whenToUse || manifest.description,
        runtimeInput,
        requestedModelId: manifest.model,
        requestedEffort: manifest.effort,
        invocation,
        prefixEvents,
      };
    }
  }

  options.workingState.update({
    ...clearActiveSkillState(currentWorkingState, "new-turn"),
  });
  return {
    originalInput,
    contextInput: originalInput,
    runtimeInput: originalInput,
    requestedModelId: undefined,
    requestedEffort: undefined,
    invocation: undefined,
    prefixEvents,
  };
}

function nativeSkillRuntimeInput(
  kernelId: string | undefined,
  skillName: string,
  args: string | undefined,
): string {
  if (kernelId === "claude-code") {
    return args
      ? `Use the ${skillName} skill for this task:\n${args}`
      : `Use the ${skillName} skill for this task.`;
  }
  return args ? `$${skillName} ${args}` : `$${skillName}`;
}

function resolveRequestedSkillArgs(options: {
  originalInput: string;
  requestedSkillName: string;
  requestedSkillArgs?: string;
}): string | undefined {
  if (options.requestedSkillArgs !== undefined) {
    return options.requestedSkillArgs.trim() || undefined;
  }

  const parsed = parseSkillSlashInput(options.originalInput);
  if (parsed?.skill === options.requestedSkillName) {
    return parsed.args;
  }

  if (options.originalInput && !options.originalInput.startsWith("/")) {
    return options.originalInput;
  }

  return undefined;
}

function createNativeSkillInvocation(
  manifest: NonNullable<ReturnType<SkillCatalog["resolve"]>>,
  args: string | undefined,
  options: { kernelId?: string; cwd?: string },
): InvokedSkillRecord {
  const normalizedArgs = args?.trim() || undefined;
  return {
    skillId: manifest.id,
    skillName: manifest.name,
    title: manifest.title,
    content: "",
    contentPreview: `Native skill /${manifest.name} is published to the kernel skill directory; ${APP_PRODUCT_NAME} did not inject the skill body.`,
    sourcePath: nativeSkillEntryPath(manifest, options),
    source: manifest.source,
    trust: manifest.trust,
    context: manifest.context,
    args: normalizedArgs,
    allowedTools: [...manifest.allowedTools],
    model: manifest.model,
    effort: manifest.effort,
    packId: manifest.packId,
    capabilityId: manifest.capabilityId,
    invokedAt: new Date().toISOString(),
    origin: "user",
  };
}

function nativeSkillEntryPath(
  manifest: NonNullable<ReturnType<SkillCatalog["resolve"]>>,
  options: { kernelId?: string; cwd?: string },
): string {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (isNativeSkillEntryForKernel(manifest.entry, options.kernelId)) {
    return manifest.entry;
  }
  if (options.kernelId === "codex") {
    const target = join(cwd, ".codex", "skills", manifest.name, "SKILL.md");
    return existsSync(target) ? target : manifest.entry;
  }
  if (options.kernelId === "claude-code") {
    const target = join(cwd, ".claude", "skills", manifest.name, "SKILL.md");
    return existsSync(target) ? target : manifest.entry;
  }
  if (options.kernelId === "hermes") {
    const target = join(cwd, APP_CONFIG_DIR, "native-skills", "hermes", manifest.name, "SKILL.md");
    return existsSync(target) ? target : manifest.entry;
  }
  return manifest.entry;
}

function isNativeSkillEntryForKernel(entry: string, kernelId?: string): boolean {
  const normalized = entry.replace(/\\/g, "/");
  if (kernelId === "codex") {
    return normalized.includes("/.codex/skills/");
  }
  if (kernelId === "claude-code") {
    return normalized.includes("/.claude/skills/");
  }
  if (kernelId === "hermes") {
    return normalized.includes(`/${APP_CONFIG_DIR}/native-skills/hermes/`);
  }
  return false;
}

function createCompactionSnapshotText(
  input: string,
  context: { summary?: string; promptBlock?: string },
): string {
  const sections = [
    `User request before compaction:\n${input}`,
    context.summary ? `Context summary:\n${context.summary}` : "",
    context.promptBlock ? `Host context snapshot:\n${truncateContextSnapshot(context.promptBlock)}` : "",
  ];
  return sections.filter(Boolean).join("\n\n");
}

function truncateContextSnapshot(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 4_000 ? `${trimmed.slice(0, 4_000)}\n...` : trimmed;
}

function parseSkillSlashInput(input: string): { skill: string; args?: string } | undefined {
  if (!input.startsWith("/")) {
    return undefined;
  }

  const trimmed = input.slice(1).trim();
  if (!trimmed) {
    return undefined;
  }

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace < 0) {
    return {
      skill: trimmed,
    };
  }

  return {
    skill: trimmed.slice(0, firstSpace),
    args: trimmed.slice(firstSpace + 1).trim() || undefined,
  };
}
