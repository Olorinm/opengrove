import type { ChangeEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject } from "react";
import {
  ArrowUp,
  ClipboardPlus,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Package,
  Plus,
  Shield,
  X,
  Zap,
} from "lucide-react";
import type {
  AttachmentPayload,
  ContextArtifactPayload,
  ModelId,
  ReasoningEffort,
  ResponseSpeed,
  RuntimeControls,
  RuntimeAccessMode,
} from "../../bridge";
import { MODEL_OPTIONS } from "../../bridge";
import { clamp, summarize } from "../../format";
import { useI18n, type TranslationFn } from "../../i18n";
import {
  MAX_COMPOSER_HEIGHT,
  MIN_COMPOSER_HEIGHT,
  attachmentIcon,
  formatAttachmentMeta,
  formatComposerSkillTitle,
  type ComposerSkillInvocation,
} from "../../runtime/ui-model";

const ACCESS_PRESETS: Array<{
  id: RuntimeAccessMode;
  labelKey: "composer.defaultAccess" | "composer.autoReview" | "composer.fullAccess";
  danger?: boolean;
}> = [
  { id: "default", labelKey: "composer.defaultAccess" },
  { id: "auto-review", labelKey: "composer.autoReview" },
  { id: "full-access", labelKey: "composer.fullAccess", danger: true },
];

const EFFORT_OPTIONS: Array<{ id: ReasoningEffort; labelKey: "composer.effortLow" | "composer.effortMedium" | "composer.effortHigh" | "composer.effortXHigh" }> = [
  { id: "low", labelKey: "composer.effortLow" },
  { id: "medium", labelKey: "composer.effortMedium" },
  { id: "high", labelKey: "composer.effortHigh" },
  { id: "xhigh", labelKey: "composer.effortXHigh" },
];

const SPEED_OPTIONS: Array<{ id: ResponseSpeed; labelKey: "composer.speedStandard" | "composer.speedFast"; descriptionKey: "composer.speedStandardDescription" | "composer.speedFastDescription" }> = [
  { id: "standard", labelKey: "composer.speedStandard", descriptionKey: "composer.speedStandardDescription" },
  { id: "fast", labelKey: "composer.speedFast", descriptionKey: "composer.speedFastDescription" },
];

const CODEX_MODEL_LABELS: Record<string, string> = {
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2": "GPT-5.2",
  "claude-opus-4-6": "Claude Opus 4.6",
  "MiMo-V2-Pro": "MiMo-V2-Pro",
};

export type ComposerMenuKind = "access" | "model";

type ComposerModelOption = { id: string; label: string; description?: string };
type ComposerEffortOption = { id: ReasoningEffort; label: string; description?: string };
type ComposerSpeedOption = { id: ResponseSpeed; label: string; description?: string };

function isModelId(value: string): value is ModelId {
  return Boolean(value.trim());
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function isResponseSpeed(value: string): value is ResponseSpeed {
  return value === "standard" || value === "fast";
}

export function modelOptionsForKernel(kernelId?: string, runtimeControls?: RuntimeControls): ComposerModelOption[] {
  const discovered = runtimeControls?.models
    ?.filter((item): item is ComposerModelOption => isModelId(item.id))
    .map((item) => ({ id: item.id, label: item.label, description: item.description }));
  if (discovered?.length) {
    return discovered;
  }
  if (kernelId === "codex") {
    return MODEL_OPTIONS.filter((item) => item.id.startsWith("gpt-"));
  }
  if (kernelId === "claude-code") {
    return MODEL_OPTIONS.filter((item) => item.id === "claude-opus-4-6");
  }
  if (kernelId === "pi") {
    return MODEL_OPTIONS.filter((item) => item.id !== "gpt-5.3-codex-spark");
  }
  return [...MODEL_OPTIONS];
}

export function supportsComposerEffort(kernelId?: string): boolean {
  return kernelId === "codex" || kernelId === "pi";
}

export function supportsComposerSpeed(kernelId?: string): boolean {
  return kernelId === "codex";
}

function effortOptionsForRuntime(t: TranslationFn, runtimeControls?: RuntimeControls): ComposerEffortOption[] {
  const discovered = runtimeControls?.reasoningEfforts
    ?.filter((item): item is ComposerEffortOption => isReasoningEffort(item.id))
    .map((item) => ({ id: item.id, label: item.label, description: item.description }));
  return discovered?.length ? discovered : EFFORT_OPTIONS.map((item) => ({ id: item.id, label: t(item.labelKey) }));
}

function speedOptionsForRuntime(t: TranslationFn, runtimeControls?: RuntimeControls): ComposerSpeedOption[] {
  const discovered = runtimeControls?.speedTiers
    ?.filter((item): item is ComposerSpeedOption => isResponseSpeed(item.id))
    .map((item) => ({ id: item.id, label: item.label, description: item.description }));
  return discovered?.length ? discovered : SPEED_OPTIONS.map((item) => ({
    id: item.id,
    label: t(item.labelKey),
    description: t(item.descriptionKey),
  }));
}

export interface ChatComposerProps {
  sending: boolean;
  messagesEmpty: boolean;
  showSuggestions?: boolean;
  contextText: string;
  attachments: AttachmentPayload[];
  contextArtifacts: ContextArtifactPayload[];
  composerSkillInvocation: ComposerSkillInvocation | null;
  composerQuestionValue: string;
  composerHeight: number;
  model: ModelId;
  activeKernel?: string;
  runtimeControls?: RuntimeControls;
  effort: ReasoningEffort;
  responseSpeed: ResponseSpeed;
  accessMode: RuntimeAccessMode;
  modelMenuKind: ComposerMenuKind | null;
  modelMenuPlacement: "up" | "down";
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  modelMenuRef: RefObject<HTMLDivElement | null>;
  onPointerDown(event: PointerEvent<HTMLDivElement>): void;
  onClearContext(): void;
  onRemoveContextArtifact(artifactId: string): void;
  onRemoveAttachment(attachmentId: string): void;
  onQuestionChange(value: string): void;
  onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
  onCompositionStart(): void;
  onCompositionEnd(): void;
  onAttachmentInputChange(event: ChangeEvent<HTMLInputElement>): void;
  onOpenAttachmentPicker(event?: MouseEvent<HTMLButtonElement>): void;
  onToggleModelMenu(kind: ComposerMenuKind): void;
  onSetModel(model: ModelId): void;
  onSetEffort(effort: ReasoningEffort): void;
  onSetResponseSpeed(speed: ResponseSpeed): void;
  onSetAccessMode(mode: RuntimeAccessMode): void;
  onSubmitOrStop(): void;
  onRemoveSkillInvocation(): void;
  onUseSuggestion(prompt: string): void;
  skillMenu?: ReactNode;
}

export function ChatComposer(props: ChatComposerProps) {
  const { t } = useI18n();
  return (
    <section className="composer-region" aria-label={t("composer.placeholder")}>
      {props.skillMenu}

      <div
        className="opengrove-composer"
        data-sending={props.sending ? "true" : "false"}
        data-skill={props.composerSkillInvocation ? "true" : "false"}
        onPointerDown={props.onPointerDown}
      >
        <div className="opengrove-composer-resize-handle" data-action="resize-composer"></div>

        {props.contextText || props.attachments.length || props.contextArtifacts.length ? (
          <ComposerAttachmentBar
            contextText={props.contextText}
            attachments={props.attachments}
            contextArtifacts={props.contextArtifacts}
            onClearContext={props.onClearContext}
            onRemoveAttachment={props.onRemoveAttachment}
            onRemoveContextArtifact={props.onRemoveContextArtifact}
          />
        ) : null}

        <div className="opengrove-question-line" data-skill={props.composerSkillInvocation ? "true" : "false"}>
          {props.composerSkillInvocation ? (
            <button
              className="opengrove-skill-chip"
              type="button"
              onClick={props.onRemoveSkillInvocation}
              aria-label={t("composer.removeSkill", { name: formatComposerSkillTitle(props.composerSkillInvocation.skill) })}
              title={`/${props.composerSkillInvocation.name}`}
            >
              <Package size={15} strokeWidth={2.2} />
              <span>{formatComposerSkillTitle(props.composerSkillInvocation.skill)}</span>
            </button>
          ) : null}

          <textarea
            ref={props.composerInputRef}
            className="opengrove-question"
            rows={3}
            value={props.composerQuestionValue}
            placeholder={props.composerSkillInvocation ? t("composer.skillPlaceholder") : t("composer.placeholder")}
            spellCheck={false}
            onChange={(event) => props.onQuestionChange(event.target.value)}
            onKeyDown={props.onKeyDown}
            onCompositionStart={props.onCompositionStart}
            onCompositionEnd={props.onCompositionEnd}
            style={{ height: `${clamp(props.composerHeight, MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT)}px` }}
          ></textarea>
        </div>

        <div className="opengrove-composer-footer" ref={props.modelMenuRef}>
          <div className="opengrove-composer-footer-left">
            <input
              ref={props.fileInputRef}
              className="opengrove-file-input"
              type="file"
              multiple
              onChange={props.onAttachmentInputChange}
            />
            <button className="opengrove-action opengrove-composer-plus" type="button" onClick={props.onOpenAttachmentPicker} aria-label={t("composer.addAttachment")} title={t("composer.addAttachment")}>
              <Plus size={20} strokeWidth={2.1} />
            </button>
            <div className="opengrove-composer-controls">
              <ComposerAccessPicker
                accessMode={props.accessMode}
                open={props.modelMenuKind === "access"}
                placement={props.modelMenuPlacement}
                onToggle={() => props.onToggleModelMenu("access")}
                onSetAccessMode={props.onSetAccessMode}
              />
            </div>
          </div>
          <div className="opengrove-composer-footer-right">
            <ComposerModelPicker
              model={props.model}
              activeKernel={props.activeKernel}
              runtimeControls={props.runtimeControls}
              effort={props.effort}
              responseSpeed={props.responseSpeed}
              open={props.modelMenuKind === "model"}
              placement={props.modelMenuPlacement}
              onToggle={() => props.onToggleModelMenu("model")}
              onSetModel={props.onSetModel}
              onSetEffort={props.onSetEffort}
              onSetResponseSpeed={props.onSetResponseSpeed}
            />
            <button
              className="opengrove-action opengrove-primary opengrove-send"
              type="button"
              onClick={props.onSubmitOrStop}
              aria-label={props.sending ? t("composer.stop") : t("composer.send")}
              title={props.sending ? t("composer.stop") : t("composer.send")}
            >
              {props.sending ? <X size={18} /> : <ArrowUp size={18} />}
            </button>
          </div>
        </div>
      </div>

      {(props.showSuggestions ?? true) && props.messagesEmpty ? (
        <div className="empty-suggestions" aria-label={t("composer.suggestions")}>
          <button type="button" onClick={() => props.onUseSuggestion("把当前目标拆成下一步可以执行的计划")}>
            <MessageSquare size={15} />
            {t("composer.suggestionPlan")}
          </button>
          <button type="button" onClick={() => props.onUseSuggestion("整理一下当前项目里的关键记忆和资料")}>
            <MessageSquare size={15} />
            {t("composer.suggestionMemory")}
          </button>
          <button type="button" onClick={() => props.onUseSuggestion("看看最近产物、待确认事项和运行状态")}>
            <MessageSquare size={15} />
            {t("composer.suggestionStatus")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ComposerAttachmentBar(props: {
  contextText: string;
  attachments: AttachmentPayload[];
  contextArtifacts: ContextArtifactPayload[];
  onClearContext(): void;
  onRemoveContextArtifact(artifactId: string): void;
  onRemoveAttachment(attachmentId: string): void;
}) {
  const { t } = useI18n();
  return (
    <div className="attachment-bar">
      {props.contextText ? (
        <div className="opengrove-attachment" data-kind="text">
          <span className="opengrove-attachment-icon" aria-hidden="true">
            <ClipboardPlus size={13} />
          </span>
          <span className="opengrove-attachment-name">{t("composer.selectedText")} · {summarize(props.contextText, 90)}</span>
          <button className="opengrove-action opengrove-icon opengrove-attachment-remove" type="button" onClick={props.onClearContext} aria-label={t("composer.removeContext")}>
            ×
          </button>
        </div>
      ) : null}
      {props.contextArtifacts.map((artifact) => (
        <div className="opengrove-attachment" key={artifact.id} data-kind="artifact">
          <span className="opengrove-attachment-icon" aria-hidden="true">
            {artifact.imageUri ? <ImageIcon size={13} /> : <FileText size={13} />}
          </span>
          <span className="opengrove-attachment-name">
            {artifact.title}
            <span className="opengrove-attachment-meta"> · {t("composer.artifact")}</span>
          </span>
          <button
            className="opengrove-action opengrove-icon opengrove-attachment-remove"
            type="button"
            onClick={() => props.onRemoveContextArtifact(artifact.id)}
            aria-label={t("composer.removeArtifact", { title: artifact.title })}
          >
            ×
          </button>
        </div>
      ))}
      {props.attachments.map((attachment) => {
        const Icon = attachmentIcon(attachment);
        return (
          <div className="opengrove-attachment" key={attachment.id} data-kind={attachment.kind}>
            <span className="opengrove-attachment-icon" aria-hidden="true">
              <Icon size={13} />
            </span>
            <span className="opengrove-attachment-name">
              {attachment.name}
              <span className="opengrove-attachment-meta">{formatAttachmentMeta(attachment)}</span>
            </span>
            <button
              className="opengrove-action opengrove-icon opengrove-attachment-remove"
              type="button"
              onClick={() => props.onRemoveAttachment(attachment.id)}
              aria-label={t("composer.removeAttachment", { name: attachment.name })}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ComposerAccessPicker(props: {
  accessMode: RuntimeAccessMode;
  open: boolean;
  placement: "up" | "down";
  onToggle(): void;
  onSetAccessMode(mode: RuntimeAccessMode): void;
}) {
  const { t } = useI18n();
  const activePreset = ACCESS_PRESETS.find((item) => item.id === props.accessMode) ?? ACCESS_PRESETS[0]!;
  return (
    <div className="opengrove-model-picker opengrove-access-picker">
      <button
        className="opengrove-model-button opengrove-access-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        aria-label={t("composer.accessLabel")}
        data-danger={activePreset.danger ? "true" : "false"}
        onClick={props.onToggle}
      >
        <Shield size={15} strokeWidth={2.2} />
        <span className="opengrove-model-label">{t(activePreset.labelKey)}</span>
        <span className="opengrove-chevron" aria-hidden="true"></span>
      </button>
      <div
        className="opengrove-model-menu opengrove-access-menu"
        data-open={props.open ? "true" : "false"}
        data-placement={props.placement}
        role="listbox"
        aria-label={t("composer.accessLabel")}
      >
        <div className="opengrove-model-menu-title">{t("composer.accessLabel")}</div>
        {ACCESS_PRESETS.map((item) => (
          <button
            key={item.id}
            className="opengrove-model-option"
            type="button"
            aria-selected={item.id === activePreset.id}
            data-danger={item.danger ? "true" : "false"}
            onClick={() => props.onSetAccessMode(item.id)}
          >
            <span className="opengrove-model-option-name">{t(item.labelKey)}</span>
            <span className="opengrove-model-option-check" aria-hidden="true"></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ComposerModelPicker(props: {
  model: ModelId;
  activeKernel?: string;
  runtimeControls?: RuntimeControls;
  effort: ReasoningEffort;
  responseSpeed: ResponseSpeed;
  open: boolean;
  placement: "up" | "down";
  onToggle(): void;
  onSetModel(model: ModelId): void;
  onSetEffort(effort: ReasoningEffort): void;
  onSetResponseSpeed(speed: ResponseSpeed): void;
}) {
  const { t } = useI18n();
  const modelOptions = modelOptionsForKernel(props.activeKernel, props.runtimeControls);
  const selectedModel = modelOptions.find((item) => item.id === props.model) ?? modelOptions[0] ?? MODEL_OPTIONS[0];
  const effortOptions = effortOptionsForRuntime(t, props.runtimeControls);
  const speedOptions = speedOptionsForRuntime(t, props.runtimeControls);
  const effortEnabled = Boolean(props.runtimeControls?.reasoningEfforts?.length) || supportsComposerEffort(props.activeKernel);
  const speedEnabled = Boolean(props.runtimeControls?.speedTiers?.length) || supportsComposerSpeed(props.activeKernel);
  const effortLabel = effortEnabled ? effortOptions.find((item) => item.id === props.effort)?.label || t("composer.effortHigh") : t("common.default");
  const compactModelLabel = selectedModel.id.startsWith("gpt-")
    ? selectedModel.id.replace(/^gpt-/, "").replace(/-codex-spark$/, " spark").replace(/-codex$/, " codex").replace(/-mini$/, " mini")
    : CODEX_MODEL_LABELS[selectedModel.id as ModelId] || selectedModel.label;

  return (
    <div className="opengrove-model-picker">
      <button
        className="opengrove-model-button opengrove-runtime-button"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={props.open}
        aria-label={t("composer.modelMenuLabel")}
        data-speed={speedEnabled ? props.responseSpeed : undefined}
        onClick={props.onToggle}
      >
        <Zap size={15} strokeWidth={2.3} />
        <span className="opengrove-model-label">{compactModelLabel}</span>
        <span className="opengrove-model-effort">{effortLabel}</span>
        <span className="opengrove-chevron" aria-hidden="true"></span>
      </button>
      <div
        className="opengrove-model-menu"
        data-open={props.open ? "true" : "false"}
        data-placement={props.placement}
        role="listbox"
        aria-label={t("composer.modelMenuLabel")}
      >
        {effortEnabled ? (
          <>
            <div className="opengrove-model-menu-title">{t("composer.intelligence")}</div>
            {effortOptions.map((item) => (
              <button
                key={item.id}
                className="opengrove-model-option"
                type="button"
                aria-selected={item.id === props.effort}
                onClick={() => props.onSetEffort(item.id)}
              >
                <span className="opengrove-model-option-name">{item.label}</span>
                <span className="opengrove-model-option-check" aria-hidden="true"></span>
              </button>
            ))}
          </>
        ) : (
          <div className="opengrove-model-menu-title">{t("composer.kernelDecidesIntelligence")}</div>
        )}
        <div className="opengrove-model-menu-title">{t("composer.model")}</div>
        {modelOptions.map((item) => (
          <button
            key={item.id}
            className="opengrove-model-option"
            type="button"
            aria-selected={item.id === selectedModel.id}
            onClick={() => props.onSetModel(item.id as ModelId)}
          >
            <span className="opengrove-model-option-name">{CODEX_MODEL_LABELS[item.id as ModelId] || item.label}</span>
            <span className="opengrove-model-option-check" aria-hidden="true"></span>
          </button>
        ))}
        {speedEnabled ? (
          <>
            <div className="opengrove-model-menu-title">{t("composer.speed")}</div>
            {speedOptions.map((item) => (
              <button
                key={item.id}
                className="opengrove-model-option opengrove-model-option-with-description"
                type="button"
                aria-selected={item.id === props.responseSpeed}
                onClick={() => props.onSetResponseSpeed(item.id)}
              >
                <span className="opengrove-model-option-name">
                  {item.label}
                  <span className="opengrove-model-option-description">{item.description}</span>
                </span>
                <span className="opengrove-model-option-check" aria-hidden="true"></span>
              </button>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
