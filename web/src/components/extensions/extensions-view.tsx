import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, CircleSlash, PlugZap, Plus, RefreshCw, Settings2, Terminal, Wrench } from "lucide-react";
import type {
  BridgeSettings,
  ExtensionDeploymentRecord,
  ExtensionInventoryRecord,
  ExtensionItemRecord,
  KernelPreference,
} from "../../bridge";
import { useI18n, type TranslationFn } from "../../i18n";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { KernelIcon } from "../ui/entity-icons";

const EXTENSION_WORKSPACES = [
  {
    id: "skills",
    icon: BookOpen,
    kinds: ["skill"],
    labelKey: "settings.extensionWorkspaceSkills",
    copyKey: "settings.extensionWorkspaceSkillsCopy",
  },
  {
    id: "mcp",
    icon: PlugZap,
    kinds: ["mcp"],
    labelKey: "settings.extensionWorkspaceMcp",
    copyKey: "settings.extensionWorkspaceMcpCopy",
  },
  {
    id: "plugins",
    icon: Settings2,
    kinds: ["plugin"],
    labelKey: "settings.extensionWorkspacePlugins",
    copyKey: "settings.extensionWorkspacePluginsCopy",
  },
  {
    id: "hooks",
    icon: Wrench,
    kinds: ["hook"],
    labelKey: "settings.extensionWorkspaceHooks",
    copyKey: "settings.extensionWorkspaceHooksCopy",
  },
  {
    id: "tools",
    icon: Wrench,
    kinds: ["tool"],
    labelKey: "settings.extensionWorkspaceTools",
    copyKey: "settings.extensionWorkspaceToolsCopy",
  },
  {
    id: "cli",
    icon: Terminal,
    kinds: ["cli"],
    labelKey: "settings.extensionWorkspaceCli",
    copyKey: "settings.extensionWorkspaceCliCopy",
  },
] as const;

const MAX_VISIBLE_TARGET_ICONS = 5;

type ExtensionWorkspaceId = (typeof EXTENSION_WORKSPACES)[number]["id"];

type KernelTarget = {
  id: Exclude<KernelPreference, "auto"> | string;
  label: string;
};

type SourceCategory = {
  kind: "native" | "user" | "unknown";
  label: string;
};

export function ExtensionsView(props: {
  extensions?: ExtensionInventoryRecord;
  settings?: BridgeSettings;
  loading?: boolean;
  saving?: boolean;
  actionPending?: boolean;
  onEditSkill?(item: ExtensionItemRecord): void;
  onOpenLocalPath?(path: string): void;
  onAction(path: string, payload: Record<string, unknown>): void;
}) {
  const { t } = useI18n();
  const [workspaceId, setWorkspaceId] = useState<ExtensionWorkspaceId>("skills");
  const extensionItems = props.extensions?.items ?? [];
  const activeWorkspace = EXTENSION_WORKSPACES.find((workspace) => workspace.id === workspaceId) ?? EXTENSION_WORKSPACES[0];
  const workspaceCounts = useMemo(
    () => Object.fromEntries(EXTENSION_WORKSPACES.map((workspace) => [
      workspace.id,
      extensionItems.filter((item) => workspace.kinds.includes(item.kind as never)).length,
    ])) as Record<ExtensionWorkspaceId, number>,
    [extensionItems],
  );
  const visibleExtensionItems = useMemo(
    () => extensionItems
      .filter((item) => activeWorkspace.kinds.includes(item.kind as never))
      .sort(compareExtensionItems),
    [extensionItems, activeWorkspace],
  );
  const kernelTargets = useMemo(
    () => buildKernelTargets(props.settings, extensionItems),
    [props.settings, extensionItems],
  );
  const actionDisabled = Boolean(props.loading || props.saving || props.actionPending);

  return (
    <section className="view-panel tab-view extensions-view" data-view="extensions">
      <div className="extensions-page">
        <header className="extensions-header">
          <span className="settings-screen-kicker">Extensions</span>
          <div className="extensions-header-main">
            <div>
              <h1>{t("settings.extensionManager")}</h1>
              <p>{t("settings.extensionsDescription")}</p>
            </div>
            <span className="settings-status-pill">
              {t("settings.extensionDeploymentsCount", { count: props.extensions?.summary?.deploymentCount ?? 0 })}
            </span>
          </div>
        </header>

        <section className="settings-list-section settings-extension-console">
          <div className="settings-extension-workspace-tabs" role="tablist" aria-label="Extension workspaces">
            {EXTENSION_WORKSPACES.map((workspace) => (
              <button
                key={workspace.id}
                className={workspaceId === workspace.id ? "active" : ""}
                type="button"
                role="tab"
                aria-selected={workspaceId === workspace.id}
                onClick={() => setWorkspaceId(workspace.id)}
              >
                <span>{t(workspace.labelKey)}</span>
                <small>{workspaceCounts[workspace.id] ?? 0}</small>
              </button>
            ))}
          </div>

          {workspaceId === "skills" ? (
            <SkillLibraryWorkspace
              disabled={actionDisabled}
              items={visibleExtensionItems}
              kernelTargets={kernelTargets}
              onAction={props.onAction}
              onEditSkill={props.onEditSkill}
              t={t}
            />
          ) : workspaceId === "mcp" ? (
            <ExtensionManagementWorkspace
              disabled={actionDisabled}
              emptyKind={t("settings.extensionWorkspaceMcp")}
              items={visibleExtensionItems}
              kernelTargets={kernelTargets}
              onAction={props.onAction}
              onOpenLocalPath={props.onOpenLocalPath}
              mode="mcp"
              t={t}
            />
          ) : workspaceId === "plugins" ? (
            <ExtensionManagementWorkspace
              disabled={actionDisabled}
              emptyKind={t("settings.extensionWorkspacePlugins")}
              items={visibleExtensionItems}
              kernelTargets={kernelTargets}
              onAction={props.onAction}
              onOpenLocalPath={props.onOpenLocalPath}
              mode="plugin"
              t={t}
            />
          ) : workspaceId === "hooks" ? (
            <ExtensionManagementWorkspace
              disabled={actionDisabled}
              emptyKind={t("settings.extensionWorkspaceHooks")}
              items={visibleExtensionItems}
              kernelTargets={kernelTargets}
              onAction={props.onAction}
              onOpenLocalPath={props.onOpenLocalPath}
              mode="hook"
              t={t}
            />
          ) : workspaceId === "tools" ? (
            <ExtensionManagementWorkspace
              disabled={actionDisabled}
              emptyKind={t("settings.extensionWorkspaceTools")}
              items={visibleExtensionItems}
              kernelTargets={kernelTargets}
              mode="tool"
              onAction={props.onAction}
              onOpenLocalPath={props.onOpenLocalPath}
              t={t}
            />
          ) : workspaceId === "cli" ? (
            <ExtensionManagementWorkspace
              disabled={actionDisabled}
              emptyKind={t("settings.extensionWorkspaceCli")}
              items={visibleExtensionItems}
              kernelTargets={kernelTargets}
              mode="cli"
              onAction={props.onAction}
              onOpenLocalPath={props.onOpenLocalPath}
              t={t}
            />
          ) : null}
        </section>
      </div>
    </section>
  );
}

function SkillLibraryWorkspace(props: {
  items: ExtensionItemRecord[];
  kernelTargets: KernelTarget[];
  disabled: boolean;
  t: TranslationFn;
  onEditSkill?(item: ExtensionItemRecord): void;
  onAction(path: string, payload: Record<string, unknown>): void;
}) {
  const [targetPickerItemId, setTargetPickerItemId] = useState("");

  if (!props.items.length) {
    return <ExtensionEmptyState kind={props.t("settings.extensionWorkspaceSkills")} t={props.t} />;
  }

  return (
      <div className="settings-extension-table settings-extension-skill-table">
        <div className="settings-extension-table-header" aria-hidden="true">
          <span>{props.t("settings.extensionTableExtension")}</span>
          <span>{props.t("settings.extensionTableTargets")}</span>
        </div>
        {props.items.map((item) => {
          const deployments = sortedDeployments(item);
          const libraryDeployment = deployments.find((deployment) => deployment.scope === "managed" && deployment.managedByOpenGrove);
          const primaryDeployment = libraryDeployment ?? deployments[0];
          const publishedDeployments = uniquePublishedKernelDeployments(deployments);
          const outdatedDeployments = publishedDeployments.filter(isOutdatedSkillDeployment);
          const publishedKernelIds = new Set(publishedDeployments.map((deployment) => deployment.kernelId).filter(Boolean));
          const candidateTargets = props.kernelTargets.filter((kernel) => !publishedKernelIds.has(kernel.id));
          return (
            <article className="settings-extension-table-row" key={item.id}>
              <ExtensionIdentityCell
                item={item}
                modified={outdatedDeployments.length > 0}
                onEditSkill={props.onEditSkill}
                primaryDeployment={primaryDeployment}
                t={props.t}
              />
              <SkillPublishedTargets
                candidateTargets={candidateTargets}
                disabled={props.disabled}
                item={item}
                kernelTargets={props.kernelTargets}
                libraryDeployment={libraryDeployment}
                onClosePicker={() => setTargetPickerItemId("")}
                onTogglePicker={() => setTargetPickerItemId((current) => current === item.id ? "" : item.id)}
                outdatedDeployments={outdatedDeployments}
                primaryDeployment={primaryDeployment}
                publishedDeployments={publishedDeployments}
                pickerOpen={targetPickerItemId === item.id}
                onAction={props.onAction}
                t={props.t}
              />
          </article>
        );
      })}
    </div>
  );
}

function SkillPublishedTargets(props: {
  item: ExtensionItemRecord;
  kernelTargets: KernelTarget[];
  candidateTargets: KernelTarget[];
  publishedDeployments: ExtensionDeploymentRecord[];
  outdatedDeployments: ExtensionDeploymentRecord[];
  libraryDeployment?: ExtensionDeploymentRecord;
  primaryDeployment?: ExtensionDeploymentRecord;
  pickerOpen: boolean;
  disabled: boolean;
  onTogglePicker(): void;
  onClosePicker(): void;
  t: TranslationFn;
  onAction(path: string, payload: Record<string, unknown>): void;
}) {
  const [unpublishTarget, setUnpublishTarget] = useState<{ deployment: ExtensionDeploymentRecord; label: string } | null>(null);
  const [republishDialogOpen, setRepublishDialogOpen] = useState(false);
  const outdatedKernelIds = uniqueStrings(props.outdatedDeployments.map((deployment) => deployment.kernelId ?? "").filter(Boolean));
  const outdatedDeploymentIds = props.outdatedDeployments.map((deployment) => deployment.id).filter(Boolean);
  const outdatedKernelLabels = props.outdatedDeployments
    .map((deployment) => props.kernelTargets.find((kernel) => kernel.id === deployment.kernelId)?.label ?? titleFromId(deployment.kernelId ?? ""))
    .filter(Boolean);
  const itemTitle = props.item.title || props.item.name;
  const publishPayload = props.libraryDeployment
    ? { librarySkillId: props.item.name }
    : props.primaryDeployment
      ? { deploymentId: props.primaryDeployment.id }
      : { itemId: props.item.id };
  return (
    <div className="settings-extension-published-targets">
      {props.publishedDeployments.length ? props.publishedDeployments.slice(0, MAX_VISIBLE_TARGET_ICONS).map((deployment) => {
        const label = props.kernelTargets.find((kernel) => kernel.id === deployment.kernelId)?.label ?? titleFromId(deployment.kernelId ?? "");
        return (
          <PublishedKernelBadge
            disabled={props.disabled}
            deployment={deployment}
            key={deployment.id}
            label={label}
            onRequestUnpublish={() => setUnpublishTarget({ deployment, label })}
            t={props.t}
          />
        );
      }) : (
        <span className="settings-extension-target-empty">{props.t("settings.extensionNotPublished")}</span>
      )}
      {props.publishedDeployments.length > MAX_VISIBLE_TARGET_ICONS ? (
        <span
          className="settings-extension-target-overflow"
          title={props.publishedDeployments
            .slice(MAX_VISIBLE_TARGET_ICONS)
            .map((deployment) => props.kernelTargets.find((kernel) => kernel.id === deployment.kernelId)?.label ?? titleFromId(deployment.kernelId ?? ""))
            .join(", ")}
        >
          +{props.publishedDeployments.length - MAX_VISIBLE_TARGET_ICONS}
        </span>
      ) : null}
      {outdatedKernelIds.length ? (
        <button
          aria-label={props.t("settings.extensionRepublishModified")}
          className="settings-extension-target-sync"
          title={props.t("settings.extensionRepublishModifiedTooltip")}
          type="button"
          disabled={props.disabled}
          onClick={() => setRepublishDialogOpen(true)}
        >
          <RefreshCw size={13} aria-hidden="true" />
          <span className="settings-extension-target-tooltip settings-extension-sync-tooltip">
            {props.t("settings.extensionRepublishModifiedTooltip")}
          </span>
        </button>
      ) : null}
      {props.kernelTargets.length ? (
        <button
          aria-label={props.t("settings.extensionPublishToKernel")}
          className="settings-extension-target-add"
          title={props.t("settings.extensionPublishToKernel")}
          type="button"
          disabled={props.disabled || props.candidateTargets.length === 0}
          onClick={props.onTogglePicker}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      ) : null}
      <Dialog open={props.pickerOpen} onOpenChange={(open) => {
        if (!open) props.onClosePicker();
      }}>
        <DialogContent className="settings-extension-target-dialog" aria-label={props.t("settings.extensionPublishDialogTitle")}>
          <DialogTitle>{props.t("settings.extensionPublishDialogTitle")}</DialogTitle>
          <div className="settings-extension-target-dialog-skill">
            <strong>{itemTitle}</strong>
            <small>{props.item.description || props.item.name}</small>
          </div>
          <div className="settings-extension-target-dialog-list" role="listbox">
            {props.candidateTargets.length ? props.candidateTargets.map((kernel) => (
              <button
                className="settings-extension-target-dialog-option"
                key={kernel.id}
                type="button"
                disabled={props.disabled}
                onClick={() => {
                  props.onAction("/extensions/skills/publish", {
                    ...publishPayload,
                    targetKernelIds: [kernel.id],
                    scope: "user",
                    replace: false,
                  });
                  props.onClosePicker();
                }}
              >
                <KernelIcon kernelId={kernel.id} size={22} />
                <span>{kernel.label}</span>
              </button>
            )) : (
              <span className="settings-extension-target-dialog-empty">{props.t("settings.extensionNoTargets")}</span>
            )}
          </div>
          <div className="modal-actions">
            <Button type="button" onClick={props.onClosePicker}>{props.t("common.cancel")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={republishDialogOpen} onOpenChange={setRepublishDialogOpen}>
        <DialogContent className="settings-confirm-dialog settings-extension-republish-dialog" aria-label={props.t("settings.extensionRepublishDialogTitle")}>
          <DialogTitle>{props.t("settings.extensionRepublishDialogTitle")}</DialogTitle>
          <p className="settings-confirm-copy">
            {props.t("settings.extensionRepublishDialogCopy", {
              kernels: outdatedKernelLabels.join("、"),
              name: itemTitle,
            })}
          </p>
          <div className="modal-actions">
            <Button type="button" onClick={() => setRepublishDialogOpen(false)}>{props.t("common.cancel")}</Button>
            <Button
              type="button"
              variant="primary"
              disabled={props.disabled || outdatedDeploymentIds.length === 0}
              onClick={() => {
                props.onAction("/extensions/skills/republish", {
                  deploymentIds: outdatedDeploymentIds,
                });
                setRepublishDialogOpen(false);
              }}
            >
              {props.t("settings.extensionRepublishConfirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(unpublishTarget)} onOpenChange={(open) => {
        if (!open) setUnpublishTarget(null);
      }}>
        <DialogContent className="settings-confirm-dialog settings-extension-unpublish-dialog" aria-label={props.t("settings.extensionUnpublishDialogTitle")}>
          <DialogTitle>{props.t("settings.extensionUnpublishDialogTitle")}</DialogTitle>
          <p className="settings-confirm-copy">
            {props.t(
              unpublishTarget?.deployment.managedByOpenGrove
                ? "settings.extensionUnpublishDialogCopy"
                : "settings.extensionUnpublishNativeDialogCopy",
              { kernel: unpublishTarget?.label ?? "", name: itemTitle },
            )}
          </p>
          <div className="modal-actions">
            <Button type="button" onClick={() => setUnpublishTarget(null)}>{props.t("common.cancel")}</Button>
            <button
              className="danger-button"
              type="button"
              disabled={props.disabled}
              onClick={() => {
                if (!unpublishTarget) return;
                props.onAction("/extensions/skills/unpublish", {
                  deploymentIds: [unpublishTarget.deployment.id],
                  forceExternal: !unpublishTarget.deployment.managedByOpenGrove,
                });
                setUnpublishTarget(null);
              }}
            >
              {props.t("common.delete")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PublishedKernelBadge(props: {
  deployment: ExtensionDeploymentRecord;
  disabled: boolean;
  label: string;
  t: TranslationFn;
  onRequestUnpublish(): void;
}) {
  const canUnpublish = !props.deployment.readonly && !props.deployment.system;
  const statusLabel = props.deployment.enabled ? props.t("common.enabled") : props.t("common.disabled");
  return (
    <button
      aria-label={canUnpublish ? `${props.t("settings.extensionUnpublishFromKernel")} ${props.label} ${statusLabel}` : `${props.label} ${statusLabel}`}
      className="settings-extension-target-icon"
      data-enabled={props.deployment.enabled ? "true" : "false"}
      data-selected="true"
      disabled={props.disabled || !canUnpublish}
      title={`${props.label} · ${statusLabel}`}
      type="button"
      onClick={canUnpublish ? props.onRequestUnpublish : undefined}
    >
      <KernelIcon kernelId={props.deployment.kernelId} size={20} />
      <span className="settings-extension-target-tooltip">{props.label}</span>
    </button>
  );
}

function ExtensionManagementWorkspace(props: {
  items: ExtensionItemRecord[];
  kernelTargets: KernelTarget[];
  disabled: boolean;
  emptyKind: string;
  mode: "mcp" | "plugin" | "hook" | "tool" | "cli";
  t: TranslationFn;
  onOpenLocalPath?(path: string): void;
  onAction(path: string, payload: Record<string, unknown>): void;
}) {
  if (!props.items.length) {
    return <ExtensionEmptyState kind={props.emptyKind} t={props.t} />;
  }

  return (
    <div className="settings-extension-manager-list" data-mode={props.mode}>
      {props.items.map((item) => {
        const deployments = sortedDeployments(item);
        const primaryDeployment = deployments[0];
        const targetDeployments = deployments.filter((deployment) => deployment.kernelId);
        const source = sourceCategory(item, primaryDeployment, props.t);
        const sourcePath = String(item.source?.path || locationForDeployment(primaryDeployment) || "");
        const titleHover = sourceHoverTitle(source, sourcePath);
        const openPath = localPathForExtension(item, primaryDeployment);
        const policy = managementPolicy(item, primaryDeployment, props.t);
        return (
          <article className="settings-extension-manager-row" key={item.id}>
            <div className="settings-extension-manager-main">
              <span className="settings-extension-kind-icon">
                {kindIcon(item.kind)}
              </span>
              <div className="settings-extension-manager-copy">
                <div className="settings-extension-manager-title-line">
                  {openPath && props.onOpenLocalPath ? (
                    <span className="settings-extension-title-tooltip" data-local-path={sourcePath || openPath}>
                      <button
                        className="settings-extension-title-button settings-extension-manager-title-button"
                        type="button"
                        onClick={() => props.onOpenLocalPath?.(openPath)}
                      >
                        {item.title || item.name}
                      </button>
                    </span>
                  ) : (
                    sourcePath ? (
                      <span className="settings-extension-title-tooltip" data-local-path={sourcePath}>
                        <strong>{item.title || item.name}</strong>
                      </span>
                    ) : (
                      <strong title={titleHover}>{item.title || item.name}</strong>
                    )
                  )}
                  <span className="settings-extension-mini-badge">{extensionKindLabel(item.kind, props.t)}</span>
                  <span className="settings-extension-source-tag" data-source={source.kind} title={titleHover}>
                    {source.label}
                  </span>
                  {item.readonly ? <span className="settings-extension-mini-badge muted">{props.t("settings.extensionReadonly")}</span> : null}
                </div>
                <small>{managementDescription(item, primaryDeployment, props.t)}</small>
                {policy ? (
                  <div className="settings-extension-manager-meta">
                    <span title={policy}>
                      {props.t("settings.extensionTablePolicy")}
                      <strong>{policy}</strong>
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="settings-extension-manager-targets">
              {targetDeployments.length ? targetDeployments.map((deployment) => (
                <ManagementDeploymentTarget
                  deployment={deployment}
                  disabled={props.disabled}
                  key={deployment.id}
                  kernelLabel={props.kernelTargets.find((kernel) => kernel.id === deployment.kernelId)?.label ?? titleFromId(deployment.kernelId ?? "")}
                  onAction={props.onAction}
                  t={props.t}
                />
              )) : (
                <span className="settings-extension-manager-local-target">
                  {item.kind === "tool" ? props.t("settings.extensionOpenGroveTool") : props.t("settings.extensionNoTargets")}
                </span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ManagementDeploymentTarget(props: {
  deployment: ExtensionDeploymentRecord;
  kernelLabel: string;
  disabled: boolean;
  t: TranslationFn;
  onAction(path: string, payload: Record<string, unknown>): void;
}) {
  const deployment = props.deployment;
  if (deployment.readonly || deployment.system) {
    return (
      <span
        className="settings-extension-target-icon settings-extension-manager-target-icon"
        data-enabled={deployment.enabled ? "true" : "false"}
        data-selected="true"
        title={`${props.kernelLabel} · ${deployment.enabled ? props.t("common.enabled") : props.t("common.disabled")}`}
      >
        <KernelIcon kernelId={deployment.kernelId} size={20} />
        <span className="settings-extension-target-tooltip">{props.kernelLabel}</span>
      </span>
    );
  }
  return (
    <button
      className="settings-extension-target-icon settings-extension-manager-target-icon"
      data-enabled={deployment.enabled ? "true" : "false"}
      data-selected="true"
      type="button"
      title={`${props.kernelLabel} · ${deployment.enabled ? props.t("common.enabled") : props.t("common.disabled")}`}
      disabled={props.disabled}
      onClick={() => props.onAction(
        deployment.enabled ? "/extensions/deployments/disable" : "/extensions/deployments/enable",
        { deploymentIds: [deployment.id] },
      )}
    >
      <KernelIcon kernelId={deployment.kernelId} size={20} />
      <span className="settings-extension-target-tooltip">{props.kernelLabel}</span>
    </button>
  );
}

function ExtensionIdentityCell(props: {
  item: ExtensionItemRecord;
  modified?: boolean;
  primaryDeployment?: ExtensionDeploymentRecord;
  onEditSkill?(item: ExtensionItemRecord): void;
  t: TranslationFn;
}) {
  const item = props.item;
  const showBadges = item.kind !== "skill" || item.readonly || item.system;
  const source = sourceCategory(item, props.primaryDeployment, props.t);
  const sourcePath = String(item.source?.path || locationForDeployment(props.primaryDeployment) || "");
  const titleHover = sourceHoverTitle(source, sourcePath);
  return (
    <div className="settings-extension-identity" data-kind={item.kind}>
      {item.kind !== "skill" ? (
        <span className="settings-extension-kind-icon">
          {kindIcon(item.kind)}
        </span>
      ) : null}
      <span className="settings-extension-title">
        <span className="settings-extension-title-main">
          {item.kind === "skill" && props.onEditSkill ? (
            <span className="settings-extension-title-tooltip" data-local-path={sourcePath || titleHover}>
              <button
                className="settings-extension-title-button"
                type="button"
                onClick={() => props.onEditSkill?.(item)}
                aria-label={`${props.t("common.edit")} ${item.title || item.name}`}
              >
                {item.title || item.name}
              </button>
            </span>
          ) : (
            sourcePath ? (
              <span className="settings-extension-title-tooltip" data-local-path={sourcePath}>
                <strong>{item.title || item.name}</strong>
              </span>
            ) : (
              <strong title={titleHover}>{item.title || item.name}</strong>
            )
          )}
          <span className="settings-extension-source-tag" data-source={source.kind} title={titleHover}>
            {source.label}
          </span>
          {props.modified ? (
            <span className="settings-extension-modified-tag" title={props.t("settings.extensionRepublishModifiedTooltip")}>
              {props.t("settings.extensionModified")}
            </span>
          ) : null}
        </span>
        <small>{item.description || locationForDeployment(props.primaryDeployment) || item.name}</small>
      </span>
      {showBadges ? (
        <span className="settings-extension-badges">
          {item.kind !== "skill" ? <span className="settings-extension-badge">{extensionKindLabel(item.kind, props.t)}</span> : null}
          {item.readonly ? <span className="settings-extension-badge readonly">{props.t("settings.extensionReadonly")}</span> : null}
          {item.system ? <span className="settings-extension-badge system">{props.t("settings.extensionOriginSystem")}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function ExtensionEmptyState(props: {
  kind: string;
  t: TranslationFn;
}) {
  return (
    <div className="settings-extension-empty">
      <CircleSlash size={18} aria-hidden="true" />
      <span>
        <strong>{props.t("settings.extensionNoEntries", { kind: props.kind })}</strong>
        <small>{props.t("settings.extensionNoEntriesCopy")}</small>
      </span>
    </div>
  );
}

function managementDescription(
  item: ExtensionItemRecord,
  deployment: ExtensionDeploymentRecord | undefined,
  t: TranslationFn,
): string {
  if (item.description) return item.description;
  if (item.kind === "mcp") {
    if (deployment?.metadata?.url) return `Remote MCP: ${String(deployment.metadata.url)}`;
    if (deployment?.command) return `MCP server: ${deployment.command}`;
  }
  if (item.kind === "hook") {
    return [String(deployment?.metadata?.event || ""), String(deployment?.metadata?.matcher || ""), deployment?.command || ""]
      .filter(Boolean)
      .join(" · ") || t("settings.extensionKindHook");
  }
  if (item.kind === "app") return appCapabilitiesDescription(item, deployment, t);
  if (item.kind === "plugin") return locationForDeployment(deployment) || t("settings.extensionKindPlugin");
  if (item.kind === "cli") return deployment?.command ? `${t("settings.extensionCommand")}: ${deployment.command}` : t("settings.extensionKindCli");
  if (item.kind === "tool") return item.tags.filter(Boolean).join(" · ") || t("settings.extensionOpenGroveTool");
  return item.name;
}

function appCapabilitiesDescription(
  item: ExtensionItemRecord,
  deployment: ExtensionDeploymentRecord | undefined,
  t: TranslationFn,
): string {
  const capabilities = Array.isArray(item.metadata?.capabilities)
    ? item.metadata.capabilities.map(String).filter(Boolean)
    : item.tags.filter((tag) => tag !== "app");
  const capabilityText = uniqueStrings(capabilities).join(" · ");
  return capabilityText || locationForDeployment(deployment) || t("settings.extensionKindApp");
}

function managementPolicy(
  item: ExtensionItemRecord,
  deployment: ExtensionDeploymentRecord | undefined,
  t: TranslationFn,
): string {
  const permissions = item.permissions
    .map((permission) => {
      const values = Array.isArray(permission.values) ? permission.values.map(String).filter(Boolean).join(", ") : "";
      return [String(permission.type || ""), values].filter(Boolean).join(": ");
    })
    .filter(Boolean);
  if (permissions.length) return permissions.slice(0, 2).join(" · ");
  if (deployment?.envKeys?.length) return `env: ${deployment.envKeys.join(", ")}`;
  if (deployment?.status === "missing") return t("common.unavailable");
  return item.readonly ? t("settings.extensionReadonly") : "";
}

function buildKernelTargets(settings: BridgeSettings | undefined, items: ExtensionItemRecord[]): KernelTarget[] {
  const targets = new Map<string, KernelTarget>();
  for (const kernel of settings?.kernels ?? []) {
    if (kernel.id === "auto") continue;
    targets.set(kernel.id, { id: kernel.id, label: kernel.label || titleFromId(kernel.id) });
  }
  for (const item of items) {
    for (const deployment of item.deployments ?? []) {
      if (!deployment.kernelId || targets.has(deployment.kernelId)) continue;
      targets.set(deployment.kernelId, { id: deployment.kernelId, label: titleFromId(deployment.kernelId) });
    }
  }
  return Array.from(targets.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function sortedDeployments(item: ExtensionItemRecord): ExtensionDeploymentRecord[] {
  return [...(item.deployments ?? [])].sort(compareExtensionDeployments);
}

function uniquePublishedKernelDeployments(deployments: ExtensionDeploymentRecord[]): ExtensionDeploymentRecord[] {
  const byKernel = new Map<string, ExtensionDeploymentRecord>();
  for (const deployment of deployments) {
    if (!deployment.kernelId || !deployment.enabled) continue;
    const existing = byKernel.get(deployment.kernelId);
    if (!existing || isBetterKernelDeployment(deployment, existing)) {
      byKernel.set(deployment.kernelId, deployment);
    }
  }
  return Array.from(byKernel.values()).sort(compareExtensionDeployments);
}

function isOutdatedSkillDeployment(deployment: ExtensionDeploymentRecord): boolean {
  return deployment.kind === "skill" &&
    deployment.enabled &&
    deployment.managedByOpenGrove &&
    Boolean(deployment.kernelId) &&
    deployment.metadata?.outOfDate === true;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isBetterKernelDeployment(candidate: ExtensionDeploymentRecord, current: ExtensionDeploymentRecord): boolean {
  if (candidate.managedByOpenGrove !== current.managedByOpenGrove) {
    return candidate.managedByOpenGrove;
  }
  if (candidate.scope !== current.scope) {
    return candidate.scope === "user" || (candidate.scope === "project" && current.scope !== "user");
  }
  return candidate.id.localeCompare(current.id) < 0;
}

function locationForDeployment(deployment: ExtensionDeploymentRecord | undefined): string {
  return deployment?.targetPath || deployment?.sourcePath || deployment?.configPath || deployment?.command || "";
}

function localPathForExtension(item: ExtensionItemRecord, deployment: ExtensionDeploymentRecord | undefined): string {
  return [
    item.source?.path,
    deployment?.targetPath,
    deployment?.sourcePath,
    deployment?.configPath,
    deployment?.metadata?.pluginRoot,
    deployment?.metadata?.manifestPath,
  ].map((value) => String(value || "")).find(isLocalPath) ?? "";
}

function isLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function compareExtensionItems(left: ExtensionItemRecord, right: ExtensionItemRecord): number {
  return Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name);
}

function compareExtensionDeployments(left: ExtensionDeploymentRecord, right: ExtensionDeploymentRecord): number {
  return (
    Number(right.enabled) - Number(left.enabled) ||
    (left.kernelId ?? "").localeCompare(right.kernelId ?? "") ||
    left.scope.localeCompare(right.scope) ||
    left.id.localeCompare(right.id)
  );
}

function extensionKindLabel(kind: string, t: TranslationFn): string {
  if (kind === "app") return t("settings.extensionKindApp");
  if (kind === "skill") return t("settings.extensionKindSkill");
  if (kind === "mcp") return t("settings.extensionKindMcp");
  if (kind === "plugin") return t("settings.extensionKindPlugin");
  if (kind === "hook") return t("settings.extensionKindHook");
  if (kind === "tool") return t("settings.extensionKindTool");
  if (kind === "cli") return t("settings.extensionKindCli");
  return titleFromId(kind);
}

function sourceCategory(
  item: ExtensionItemRecord,
  deployment: ExtensionDeploymentRecord | undefined,
  t: TranslationFn,
): SourceCategory {
  const origin = String(item.source?.origin || deployment?.metadata?.sourceOrigin || "unknown");
  if (item.system || deployment?.system || origin === "system") {
    return { kind: "native", label: t("settings.extensionOriginNative") };
  }
  if (
    item.managedByOpenGrove ||
    deployment?.managedByOpenGrove ||
    origin === "opengrove" ||
    origin === "kernel" ||
    origin === "plugin" ||
    origin === "local"
  ) {
    return { kind: "user", label: t("settings.extensionOriginUser") };
  }
  return { kind: "unknown", label: t("common.unknown") };
}

function sourceHoverTitle(source: SourceCategory, sourcePath: string): string {
  return sourcePath ? `${source.label} · ${sourcePath}` : source.label;
}

function kindIcon(kind: string) {
  if (kind === "app") return <PlugZap size={15} aria-hidden="true" />;
  if (kind === "skill") return <BookOpen size={15} aria-hidden="true" />;
  if (kind === "mcp") return <PlugZap size={15} aria-hidden="true" />;
  if (kind === "plugin" || kind === "hook") return <Settings2 size={15} aria-hidden="true" />;
  if (kind === "tool") return <Wrench size={15} aria-hidden="true" />;
  if (kind === "cli") return <Terminal size={15} aria-hidden="true" />;
  return <CheckCircle2 size={15} aria-hidden="true" />;
}

function titleFromId(value: string): string {
  return value
    .split(/[-_.\s]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
