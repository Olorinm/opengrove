import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  Activity,
  BookOpenText,
  Camera,
  ChevronRight,
  Code2,
  LogOut,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useIconStylePreference } from "../../appearance";
import type { ExtensionItemRecord, ViewId } from "../../bridge";
import {
  MOBILE_APPS,
  RAIL_APPS,
  railSectionForView as catalogRailSectionForView,
  type AppIconName,
  type RailSectionId,
} from "../../apps/catalog";
import { useI18n, type TranslationFn } from "../../i18n";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export type PixelIconName = AppIconName;
export type { RailSectionId } from "../../apps/catalog";

const PROFESSIONAL_ICONS: Record<PixelIconName, LucideIcon> = {
  chat: MessageSquare,
  rooms: MessagesSquare,
  messages: MessagesSquare,
  contacts: UserRound,
  library: BookOpenText,
  folder: BookOpenText,
  document: BookOpenText,
  search: BookOpenText,
  plus: Plus,
  settings: Settings,
  user: UserRound,
  ops: Activity,
  extensions: Package,
};

const USER_PROFILE_STORAGE_KEY = "opengrove.userProfile.v1";
const PRIMARY_RAIL_APPS = RAIL_APPS.filter((app) => app.layer !== "user");
const CONFIGURATION_RAIL_APPS = PRIMARY_RAIL_APPS.filter((app) => app.section === "extensions");
const NATIVE_RAIL_APPS = PRIMARY_RAIL_APPS.filter((app) => app.section !== "extensions");

type UserProfile = {
  displayName: string;
  username: string;
  avatarDataUrl?: string;
};

function readUserProfile(): UserProfile {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USER_PROFILE_STORAGE_KEY) || "{}") as Partial<UserProfile>;
    return normalizeUserProfile(parsed);
  } catch {
    return normalizeUserProfile({});
  }
}

function normalizeUserProfile(input: Partial<UserProfile>): UserProfile {
  return {
    displayName: String(input.displayName || "我").trim() || "我",
    username: String(input.username || "me").trim() || "me",
    avatarDataUrl: typeof input.avatarDataUrl === "string" && input.avatarDataUrl.startsWith("data:image/")
      ? input.avatarDataUrl
      : undefined,
  };
}

function profileInitial(profile: UserProfile): string {
  const name = profile.displayName.trim();
  if (!name) return "我";
  if (/^[a-z]/i.test(name)) return name.slice(0, 2).toUpperCase();
  return name.slice(0, 1);
}

export function railSectionForView(view: ViewId): RailSectionId {
  return catalogRailSectionForView(view);
}

export function AppRail(props: {
  activeSection: RailSectionId;
  expanded: boolean;
  onOpenSection(section: RailSectionId): void;
  onOpenSettings(): void;
  onCreateApp(): void;
  onSelectMountedApp?(appId: string): void;
  onEnterMountedAppDeveloperMode?(appId: string): void;
  onExitMountedAppDeveloperMode?(appId: string): void;
  onDeleteMountedApp?(appId: string): void;
  onSetExpanded(expanded: boolean): void;
  mountedApps?: ExtensionItemRecord[];
  activeMountedAppId?: string;
  mountedAppDeveloperModeIds?: string[];
}) {
  const { t } = useI18n();
  const { preference: iconStyle } = useIconStylePreference();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => readUserProfile());
  const [profileDraft, setProfileDraft] = useState<UserProfile>(() => readUserProfile());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const mountedApps = [...(props.mountedApps ?? [])].sort((a, b) => a.title.localeCompare(b.title));

  useEffect(() => {
    if (!profileMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setProfileMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileMenuOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileMenuOpen]);

  function openProfileDialog() {
    setProfileDraft(profile);
    setProfileDialogOpen(true);
    setProfileMenuOpen(false);
  }

  function saveProfile() {
    const nextProfile = normalizeUserProfile(profileDraft);
    setProfile(nextProfile);
    window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    setProfileDialogOpen(false);
  }

  function handleProfileAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setProfileDraft((current) => ({ ...current, avatarDataUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <aside className="app-rail" data-expanded={props.expanded ? "true" : "false"} aria-label={t("app.mainNav")}>
      <div className="app-rail-brand-row">
        <button
          className="app-rail-brand"
          type="button"
          onClick={() => props.onSetExpanded(!props.expanded)}
          aria-label={props.expanded ? "收起 OpenGrove 侧边栏" : "展开 OpenGrove 侧边栏"}
          title={props.expanded ? "收起" : "展开"}
        >
          <span className="app-rail-brand-icon" aria-hidden="true">
            <span className="app-rail-brand-logo">
              <OpenGroveSaplingMark />
            </span>
            <span className="app-rail-brand-toggle">
              {props.expanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </span>
          </span>
          <span className="app-rail-wordmark" aria-hidden="true">
            Open<span>Grove</span>
          </span>
        </button>
      </div>
      <nav className="app-rail-nav">
        <RailSection title={t("app.nativeApps")}>
          {NATIVE_RAIL_APPS.map((app) => (
            <RailButton
              key={app.id}
              active={props.activeSection === app.section}
              label={appNavLabel(app.view, t)}
              icon={app.icon}
              professionalIcon={PROFESSIONAL_ICONS[app.icon]}
              iconStyle={iconStyle}
              onClick={() => props.onOpenSection(app.section)}
            />
          ))}
        </RailSection>
        <RailSection title={t("app.loadedApps")}>
          <div className="app-rail-user-app-tabs" aria-label={t("app.userApps")}>
            {mountedApps.map((app) => (
              <UserAppRailItem
                key={app.id}
                active={props.activeSection === "apps" && app.name === props.activeMountedAppId}
                id={app.name}
                title={app.title}
                icon="folder"
                professionalIcon={BookOpenText}
                iconStyle={iconStyle}
                onClick={() => props.onSelectMountedApp?.(app.name)}
                developerMode={props.mountedAppDeveloperModeIds?.includes(app.name)}
                onEnterDeveloperMode={props.onEnterMountedAppDeveloperMode}
                onExitDeveloperMode={props.onExitMountedAppDeveloperMode}
                onDelete={props.onDeleteMountedApp}
                deleteLabel="删除"
              />
            ))}
            <RailButton
              active={false}
              label={t("app.createApp")}
              icon="plus"
              professionalIcon={Plus}
              iconStyle={iconStyle}
              onClick={props.onCreateApp}
            />
          </div>
        </RailSection>
        <RailSection title={t("app.configuration")}>
          {CONFIGURATION_RAIL_APPS.map((app) => (
            <RailButton
              key={app.id}
              active={props.activeSection === app.section}
              label={appNavLabel(app.view, t)}
              icon={app.icon}
              professionalIcon={PROFESSIONAL_ICONS[app.icon]}
              iconStyle={iconStyle}
              onClick={() => props.onOpenSection(app.section)}
            />
          ))}
          <RailButton
            active={props.activeSection === "settings"}
            label={t("app.settings")}
            icon="settings"
            professionalIcon={Settings}
            iconStyle={iconStyle}
            onClick={props.onOpenSettings}
          />
        </RailSection>
      </nav>
      <div className="app-rail-bottom" ref={menuRef}>
        <button
          className="app-user-button"
          data-active={profileMenuOpen ? "true" : "false"}
          type="button"
          onClick={() => setProfileMenuOpen((open) => !open)}
          aria-label="我"
          aria-expanded={profileMenuOpen}
          title="我"
        >
          <span>{profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" /> : profileInitial(profile)}</span>
          <strong>{profile.displayName}</strong>
        </button>
        {profileMenuOpen ? (
          <div className="app-user-menu" role="menu" aria-label="我">
            <button className="app-user-menu-profile" type="button" role="menuitem" onClick={openProfileDialog}>
              <span className="app-user-menu-avatar" aria-hidden="true">
                {profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" /> : profileInitial(profile)}
              </span>
              <span className="app-user-menu-copy">
                <strong>{profile.displayName}</strong>
                <small>@{profile.username}</small>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
        ) : null}
      </div>
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="profile-dialog" aria-label="编辑个人资料">
          <DialogTitle>编辑个人资料</DialogTitle>
          <div className="profile-dialog-avatar">
            <span aria-hidden="true">
              {profileDraft.avatarDataUrl ? <img src={profileDraft.avatarDataUrl} alt="" /> : profileInitial(profileDraft)}
            </span>
            <input
              ref={profileAvatarInputRef}
              type="file"
              accept="image/*"
              onChange={handleProfileAvatarChange}
              aria-label="选择个人资料照片"
            />
            <button type="button" onClick={() => profileAvatarInputRef.current?.click()} aria-label="更新个人资料照片" title="更新个人资料照片">
              <Camera size={18} />
            </button>
          </div>
          <label className="profile-dialog-field">
            <span>显示名称</span>
            <input
              value={profileDraft.displayName}
              onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))}
            />
          </label>
          <label className="profile-dialog-field">
            <span>用户名</span>
            <input
              value={profileDraft.username}
              onChange={(event) => setProfileDraft((current) => ({ ...current, username: event.target.value }))}
            />
          </label>
          <p className="profile-dialog-note">你的个人资料有助于大家在群聊中认出你。</p>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => setProfileDialogOpen(false)}>
              取消
            </button>
            <button className="primary-button" type="button" onClick={saveProfile}>
              保存
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function RailSection(props: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="app-rail-section" aria-label={props.title}>
      <h2 className="app-rail-section-title">{props.title}</h2>
      <div className="app-rail-section-items">{props.children}</div>
    </section>
  );
}

export function OpenGroveSaplingMark() {
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

export function MobileNav(props: {
  activeView: ViewId;
  onSelect(view: ViewId): void;
}) {
  const { t } = useI18n();
  const { preference: iconStyle } = useIconStylePreference();
  return (
    <nav className="mobile-nav" aria-label={t("app.mobileNav")}>
      {MOBILE_APPS.map((item) => {
        return (
          <button
            className={clsx("mobile-nav-item", props.activeView === item.view && "active")}
            key={item.id}
            type="button"
            onClick={() => props.onSelect(item.view)}
          >
            <RailIcon iconStyle={iconStyle} pixelIcon={item.icon} professionalIcon={PROFESSIONAL_ICONS[item.icon]} />
            <span>{appNavLabel(item.view, t)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function RailButton(props: {
  active?: boolean;
  label: string;
  icon: PixelIconName;
  professionalIcon: LucideIcon;
  iconStyle: "professional" | "pixel";
  onClick(): void;
}) {
  return (
    <button
      className="app-rail-button"
      data-active={props.active ? "true" : "false"}
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      <RailIcon iconStyle={props.iconStyle} pixelIcon={props.icon} professionalIcon={props.professionalIcon} />
      <span>{props.label}</span>
    </button>
  );
}

function UserAppRailItem(props: {
  active?: boolean;
  id: string;
  title: string;
  icon: PixelIconName;
  professionalIcon: LucideIcon;
  iconStyle: "professional" | "pixel";
  onClick(): void;
  developerMode?: boolean;
  onEnterDeveloperMode?(id: string): void;
  onExitDeveloperMode?(id: string): void;
  onDelete?(id: string): void;
  deleteLabel?: string;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const floatingMenuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<CSSProperties | undefined>(undefined);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      if (target instanceof Node && floatingMenuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function toggleMenu(button: HTMLButtonElement) {
    const opening = !menuOpen;
    setMenuOpen(opening);
    setMenuAnchor(opening ? menuAnchorFromButton(button) : undefined);
  }

  function toggleDeveloperMode() {
    setMenuOpen(false);
    if (props.developerMode) {
      props.onExitDeveloperMode?.(props.id);
      return;
    }
    props.onEnterDeveloperMode?.(props.id);
  }
  const canToggleDeveloperMode = props.developerMode
    ? Boolean(props.onExitDeveloperMode)
    : Boolean(props.onEnterDeveloperMode);

  return (
    <div
      className="app-rail-user-tab-wrap"
      data-developer-mode={props.developerMode ? "true" : "false"}
      data-menu-open={menuOpen ? "true" : "false"}
      ref={menuRef}
    >
      <button
        className="app-rail-button app-rail-user-tab"
        data-active={props.active ? "true" : "false"}
        type="button"
        onClick={props.onClick}
        aria-label={props.title}
        title={props.title}
      >
        <span className="app-rail-user-tab-icon" aria-hidden="true">
          <RailIcon iconStyle={props.iconStyle} pixelIcon={props.icon} professionalIcon={props.professionalIcon} />
          <span className="app-rail-user-tab-marker" />
        </span>
        <span>{props.title}</span>
      </button>
      <button
        className="app-rail-user-tab-menu-button"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu(event.currentTarget);
        }}
        aria-label={`${props.title} 更多操作`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="更多"
      >
        <MoreHorizontal size={15} />
      </button>
      {menuOpen ? createPortal(
        <div
          className="app-rail-user-app-menu"
          data-floating="true"
          role="menu"
          aria-label={`${props.title} 操作`}
          ref={floatingMenuRef}
          style={menuAnchor}
        >
          {canToggleDeveloperMode ? (
            <button type="button" role="menuitem" onClick={toggleDeveloperMode}>
              {props.developerMode ? <LogOut size={15} /> : <Code2 size={15} />}
              <span>{props.developerMode ? "退出开发者模式" : "进入开发者模式"}</span>
            </button>
          ) : null}
          {props.onDelete ? (
            <>
              {canToggleDeveloperMode ? <div className="app-rail-user-app-menu-divider" /> : null}
              <button
                className="app-rail-user-app-menu-danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  props.onDelete?.(props.id);
                }}
              >
                <Trash2 size={15} />
                <span>{props.deleteLabel ?? "删除应用"}</span>
              </button>
            </>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function menuAnchorFromButton(button: HTMLElement): CSSProperties {
  const rect = button.getBoundingClientRect();
  const margin = 8;
  const menuWidth = 176;
  const menuHeight = 84;
  const left = window.innerWidth - rect.right - margin >= menuWidth
    ? rect.right + 8
    : Math.max(margin, rect.left - menuWidth - 8);
  const top = Math.min(
    Math.max(margin, rect.top + rect.height / 2 - menuHeight / 2),
    window.innerHeight - menuHeight - margin,
  );
  return {
    position: "fixed",
    left,
    top,
    zIndex: 1000,
  };
}

function RailIcon(props: {
  iconStyle: "professional" | "pixel";
  pixelIcon: PixelIconName;
  professionalIcon: LucideIcon;
}) {
  if (props.iconStyle === "pixel") {
    return <PixelIcon name={props.pixelIcon} size={27} />;
  }
  const Icon = props.professionalIcon;
  return <Icon size={19} />;
}

function appNavLabel(view: ViewId, t: TranslationFn): string {
  if (view === "chat") return t("app.chat");
  if (view === "app") return t("app.userApps");
  if (view === "rooms" || view === "contacts") return t("app.rooms");
  if (view === "library") return t("app.library");
  if (view === "ops") return t("app.ops");
  if (view === "extensions") return t("app.extensions");
  if (view === "settings") return t("app.settings");
  return t("app.chat");
}

export function ThemedPixelIcon(props: {
  pixelIcon: PixelIconName;
  professionalIcon: LucideIcon;
  professionalSize?: number;
  pixelSize?: number;
}) {
  const { preference: iconStyle } = useIconStylePreference();
  if (iconStyle === "pixel") {
    return <PixelIcon name={props.pixelIcon} size={props.pixelSize} />;
  }
  const Icon = props.professionalIcon;
  return <Icon size={props.professionalSize ?? 16} />;
}

export function PixelIcon(props: { name: PixelIconName; size?: number; className?: string }) {
  return (
    <svg
      className={clsx("pixel-icon", props.className)}
      viewBox="0 0 16 16"
      aria-hidden="true"
      shapeRendering="crispEdges"
      style={props.size ? { width: props.size, height: props.size } : undefined}
    >
      {props.name === "chat" ? (
        <>
          <rect className="pixel-icon__main" x="5" y="3" width="6" height="1" />
          <rect className="pixel-icon__main" x="4" y="4" width="1" height="1" />
          <rect className="pixel-icon__main" x="11" y="4" width="1" height="1" />
          <rect className="pixel-icon__main" x="3" y="5" width="1" height="5" />
          <rect className="pixel-icon__main" x="12" y="5" width="1" height="5" />
          <rect className="pixel-icon__main" x="4" y="10" width="2" height="1" />
          <rect className="pixel-icon__main" x="7" y="10" width="4" height="1" />
          <rect className="pixel-icon__main" x="6" y="11" width="1" height="2" />
          <rect className="pixel-icon__main" x="6" y="7" width="1" height="1" />
          <rect className="pixel-icon__main" x="8" y="7" width="1" height="1" />
          <rect className="pixel-icon__main" x="10" y="7" width="1" height="1" />
        </>
      ) : null}
      {props.name === "rooms" || props.name === "messages" ? (
        <>
          <rect className="pixel-icon__main" x="4" y="4" width="5" height="1" />
          <rect className="pixel-icon__main" x="3" y="5" width="1" height="5" />
          <rect className="pixel-icon__main" x="9" y="5" width="1" height="4" />
          <rect className="pixel-icon__main" x="4" y="10" width="2" height="1" />
          <rect className="pixel-icon__main" x="7" y="9" width="2" height="1" />
          <rect className="pixel-icon__main" x="6" y="11" width="1" height="2" />
          <rect className="pixel-icon__main" x="6" y="7" width="1" height="1" />
          <rect className="pixel-icon__main" x="8" y="7" width="1" height="1" />
          <rect className="pixel-icon__main" x="9" y="6" width="3" height="1" />
          <rect className="pixel-icon__main" x="12" y="7" width="1" height="5" />
          <rect className="pixel-icon__main" x="8" y="12" width="4" height="1" />
          <rect className="pixel-icon__main" x="10" y="13" width="1" height="2" />
          <rect className="pixel-icon__main" x="10" y="9" width="1" height="1" />
          <rect className="pixel-icon__accent" x="11" y="10" width="1" height="1" />
        </>
      ) : null}
      {props.name === "contacts" ? (
        <>
          <rect className="pixel-icon__main" x="5" y="2" width="7" height="1" />
          <rect className="pixel-icon__main" x="4" y="3" width="1" height="10" />
          <rect className="pixel-icon__main" x="12" y="3" width="1" height="10" />
          <rect className="pixel-icon__main" x="5" y="13" width="7" height="1" />
          <rect className="pixel-icon__main" x="3" y="4" width="1" height="1" />
          <rect className="pixel-icon__main" x="3" y="6" width="1" height="1" />
          <rect className="pixel-icon__main" x="3" y="8" width="1" height="1" />
          <rect className="pixel-icon__main" x="3" y="10" width="1" height="1" />
          <rect className="pixel-icon__accent" x="8" y="5" width="2" height="2" />
          <rect className="pixel-icon__accent" x="7" y="8" width="4" height="2" />
          <rect className="pixel-icon__accent" x="6" y="10" width="6" height="1" />
        </>
      ) : null}
      {props.name === "library" ? (
        <>
          <rect className="pixel-icon__main" x="2" y="5" width="1" height="7" />
          <rect className="pixel-icon__main" x="3" y="4" width="4" height="1" />
          <rect className="pixel-icon__main" x="7" y="5" width="1" height="8" />
          <rect className="pixel-icon__main" x="3" y="12" width="4" height="1" />
          <rect className="pixel-icon__main" x="8" y="5" width="1" height="8" />
          <rect className="pixel-icon__main" x="9" y="4" width="4" height="1" />
          <rect className="pixel-icon__main" x="13" y="5" width="1" height="7" />
          <rect className="pixel-icon__main" x="9" y="12" width="4" height="1" />
          <rect className="pixel-icon__accent" x="10" y="5" width="1" height="4" />
          <rect className="pixel-icon__accent" x="11" y="5" width="1" height="3" />
        </>
      ) : null}
      {props.name === "folder" ? (
        <>
          <rect className="pixel-icon__accent" x="2" y="4" width="4" height="1" />
          <rect className="pixel-icon__accent" x="2" y="5" width="5" height="1" />
          <rect className="pixel-icon__main" x="1" y="6" width="1" height="7" />
          <rect className="pixel-icon__main" x="2" y="5" width="4" height="1" />
          <rect className="pixel-icon__main" x="6" y="6" width="8" height="1" />
          <rect className="pixel-icon__main" x="14" y="7" width="1" height="6" />
          <rect className="pixel-icon__main" x="2" y="13" width="12" height="1" />
        </>
      ) : null}
      {props.name === "document" ? (
        <>
          <rect className="pixel-icon__main" x="4" y="2" width="6" height="1" />
          <rect className="pixel-icon__main" x="3" y="3" width="1" height="10" />
          <rect className="pixel-icon__main" x="10" y="3" width="1" height="2" />
          <rect className="pixel-icon__main" x="11" y="5" width="2" height="1" />
          <rect className="pixel-icon__main" x="13" y="6" width="1" height="7" />
          <rect className="pixel-icon__main" x="4" y="13" width="9" height="1" />
          <rect className="pixel-icon__main" x="11" y="4" width="1" height="1" />
          <rect className="pixel-icon__accent" x="6" y="7" width="1" height="1" />
          <rect className="pixel-icon__accent" x="8" y="7" width="3" height="1" />
          <rect className="pixel-icon__accent" x="6" y="9" width="1" height="1" />
          <rect className="pixel-icon__accent" x="8" y="9" width="4" height="1" />
          <rect className="pixel-icon__accent" x="6" y="11" width="1" height="1" />
          <rect className="pixel-icon__accent" x="8" y="11" width="4" height="1" />
        </>
      ) : null}
      {props.name === "search" ? (
        <>
          <rect className="pixel-icon__main" x="5" y="3" width="4" height="1" />
          <rect className="pixel-icon__main" x="4" y="4" width="1" height="1" />
          <rect className="pixel-icon__main" x="9" y="4" width="1" height="1" />
          <rect className="pixel-icon__main" x="3" y="5" width="1" height="4" />
          <rect className="pixel-icon__main" x="10" y="5" width="1" height="4" />
          <rect className="pixel-icon__main" x="4" y="9" width="1" height="1" />
          <rect className="pixel-icon__main" x="9" y="9" width="1" height="1" />
          <rect className="pixel-icon__main" x="5" y="10" width="4" height="1" />
          <rect className="pixel-icon__main" x="10" y="10" width="1" height="1" />
          <rect className="pixel-icon__main" x="11" y="11" width="1" height="1" />
          <rect className="pixel-icon__main" x="12" y="12" width="1" height="2" />
          <rect className="pixel-icon__accent" x="9" y="9" width="1" height="1" />
        </>
      ) : null}
      {props.name === "plus" ? (
        <>
          <rect className="pixel-icon__main" x="4" y="3" width="8" height="1" />
          <rect className="pixel-icon__main" x="3" y="4" width="1" height="8" />
          <rect className="pixel-icon__main" x="12" y="4" width="1" height="8" />
          <rect className="pixel-icon__main" x="4" y="12" width="8" height="1" />
          <rect className="pixel-icon__accent" x="7" y="5" width="2" height="6" />
          <rect className="pixel-icon__accent" x="5" y="7" width="6" height="2" />
        </>
      ) : null}
      {props.name === "ops" ? (
        <>
          <rect className="pixel-icon__main" x="2" y="3" width="12" height="1" />
          <rect className="pixel-icon__main" x="2" y="12" width="12" height="1" />
          <rect className="pixel-icon__main" x="2" y="4" width="1" height="8" />
          <rect className="pixel-icon__main" x="13" y="4" width="1" height="8" />
          <rect className="pixel-icon__accent" x="4" y="9" width="1" height="2" />
          <rect className="pixel-icon__accent" x="6" y="7" width="1" height="4" />
          <rect className="pixel-icon__accent" x="8" y="5" width="1" height="6" />
          <rect className="pixel-icon__accent" x="10" y="8" width="1" height="3" />
          <rect className="pixel-icon__main" x="4" y="5" width="1" height="1" />
          <rect className="pixel-icon__main" x="5" y="6" width="1" height="1" />
          <rect className="pixel-icon__main" x="9" y="6" width="1" height="1" />
          <rect className="pixel-icon__main" x="10" y="5" width="1" height="1" />
        </>
      ) : null}
      {props.name === "extensions" ? (
        <>
          <rect className="pixel-icon__main" x="4" y="2" width="8" height="1" />
          <rect className="pixel-icon__main" x="3" y="3" width="1" height="10" />
          <rect className="pixel-icon__main" x="12" y="3" width="1" height="10" />
          <rect className="pixel-icon__main" x="4" y="13" width="8" height="1" />
          <rect className="pixel-icon__main" x="5" y="5" width="2" height="2" />
          <rect className="pixel-icon__main" x="9" y="5" width="2" height="2" />
          <rect className="pixel-icon__main" x="5" y="9" width="2" height="2" />
          <rect className="pixel-icon__main" x="9" y="9" width="2" height="2" />
          <rect className="pixel-icon__accent" x="7" y="7" width="2" height="2" />
        </>
      ) : null}
      {props.name === "settings" ? (
        <>
          <rect className="pixel-icon__main" x="7" y="2" width="2" height="2" />
          <rect className="pixel-icon__main" x="4" y="3" width="2" height="1" />
          <rect className="pixel-icon__main" x="10" y="3" width="2" height="1" />
          <rect className="pixel-icon__main" x="3" y="4" width="1" height="2" />
          <rect className="pixel-icon__main" x="12" y="4" width="1" height="2" />
          <rect className="pixel-icon__main" x="2" y="7" width="2" height="2" />
          <rect className="pixel-icon__main" x="12" y="7" width="2" height="2" />
          <rect className="pixel-icon__main" x="3" y="10" width="1" height="2" />
          <rect className="pixel-icon__main" x="12" y="10" width="1" height="2" />
          <rect className="pixel-icon__main" x="4" y="12" width="2" height="1" />
          <rect className="pixel-icon__main" x="10" y="12" width="2" height="1" />
          <rect className="pixel-icon__main" x="7" y="12" width="2" height="2" />
          <rect className="pixel-icon__accent" x="7" y="7" width="2" height="2" />
        </>
      ) : null}
      {props.name === "user" ? (
        <>
          <rect className="pixel-icon__main" x="6" y="3" width="4" height="1" />
          <rect className="pixel-icon__main" x="5" y="4" width="1" height="3" />
          <rect className="pixel-icon__main" x="10" y="4" width="1" height="3" />
          <rect className="pixel-icon__main" x="6" y="7" width="4" height="1" />
          <rect className="pixel-icon__main" x="4" y="10" width="1" height="2" />
          <rect className="pixel-icon__main" x="11" y="10" width="1" height="2" />
          <rect className="pixel-icon__main" x="5" y="9" width="6" height="1" />
          <rect className="pixel-icon__main" x="5" y="12" width="6" height="1" />
          <rect className="pixel-icon__accent" x="5" y="10" width="6" height="2" />
        </>
      ) : null}
    </svg>
  );
}
