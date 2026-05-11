import { useEffect, useRef, useState, type ChangeEvent } from "react";
import clsx from "clsx";
import {
  BookOpenText,
  Camera,
  ChevronLeft,
  ChevronRight,
  ContactRound,
  MessageSquare,
  MessagesSquare,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useIconStylePreference } from "../../appearance";
import type { ViewId } from "../../bridge";
import { useI18n } from "../../i18n";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export type RailSectionId = "chat" | "rooms" | "contacts" | "library" | "settings";
export type PixelIconName = "chat" | "rooms" | "messages" | "contacts" | "library" | "folder" | "document" | "search" | "plus" | "settings" | "user";

type NavItem = { id: ViewId; labelKey: "app.rooms" | "app.library"; icon: PixelIconName; professionalIcon: LucideIcon };

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "rooms", labelKey: "app.rooms", icon: "rooms", professionalIcon: MessagesSquare },
  { id: "library", labelKey: "app.library", icon: "library", professionalIcon: BookOpenText },
];

const USER_PROFILE_STORAGE_KEY = "opengrove.userProfile.v1";

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
  if (view === "settings") return "settings";
  if (view === "rooms") return "rooms";
  if (view === "contacts") return "contacts";
  if (view === "library") return "library";
  return "chat";
}

export function AppRail(props: {
  activeSection: RailSectionId;
  expanded: boolean;
  onOpenSection(section: RailSectionId): void;
  onOpenSettings(): void;
  onSetExpanded(expanded: boolean): void;
}) {
  const { t } = useI18n();
  const { preference: iconStyle } = useIconStylePreference();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const profileAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => readUserProfile());
  const [profileDraft, setProfileDraft] = useState<UserProfile>(() => readUserProfile());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

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

  function openSettingsFromMenu() {
    setProfileMenuOpen(false);
    props.onOpenSettings();
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
          onClick={() => {
            if (!props.expanded) props.onSetExpanded(true);
          }}
          aria-label={props.expanded ? "OpenGrove" : "展开 OpenGrove 侧边栏"}
          title={props.expanded ? "OpenGrove" : "展开 OpenGrove 侧边栏"}
        >
          <OpenGroveSaplingMark />
        </button>
        <span className="app-rail-wordmark" aria-hidden="true">
          Open<span>Grove</span>
        </span>
        <button className="app-rail-collapse" type="button" onClick={() => props.onSetExpanded(false)} aria-label="收起 OpenGrove 侧边栏" title="收起">
          <ChevronLeft size={14} />
        </button>
      </div>
      <nav className="app-rail-nav">
        <RailButton
          active={props.activeSection === "chat"}
          label={t("app.chat")}
          icon="chat"
          professionalIcon={MessageSquare}
          iconStyle={iconStyle}
          onClick={() => props.onOpenSection("chat")}
        />
        <RailButton
          active={props.activeSection === "rooms"}
          label={t("app.rooms")}
          icon="rooms"
          professionalIcon={MessagesSquare}
          iconStyle={iconStyle}
          onClick={() => props.onOpenSection("rooms")}
        />
        <RailButton
          active={props.activeSection === "contacts"}
          label="通讯录"
          icon="contacts"
          professionalIcon={ContactRound}
          iconStyle={iconStyle}
          onClick={() => props.onOpenSection("contacts")}
        />
        <RailButton
          active={props.activeSection === "library"}
          label={t("app.library")}
          icon="library"
          professionalIcon={BookOpenText}
          iconStyle={iconStyle}
          onClick={() => props.onOpenSection("library")}
        />
      </nav>
      <div className="app-rail-bottom" ref={menuRef}>
        <button
          className="app-user-button"
          data-active={profileMenuOpen || props.activeSection === "settings" ? "true" : "false"}
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
            <div className="app-user-menu-divider" />
            <button className="app-user-menu-item" type="button" role="menuitem" onClick={openProfileDialog}>
              <ThemedPixelIcon pixelIcon="user" professionalIcon={UserRound} professionalSize={18} pixelSize={18} />
              <span>个人资料</span>
            </button>
            <button className="app-user-menu-item" type="button" role="menuitem" onClick={openSettingsFromMenu}>
              <ThemedPixelIcon pixelIcon="settings" professionalIcon={Settings} professionalSize={18} pixelSize={18} />
              <span>{t("app.settings")}</span>
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

export function MobileNav(props: {
  activeView: ViewId;
  onSelect(view: ViewId): void;
}) {
  const { t } = useI18n();
  const { preference: iconStyle } = useIconStylePreference();
  return (
    <nav className="mobile-nav" aria-label={t("app.mobileNav")}>
      <button
        className={clsx("mobile-nav-item", props.activeView === "chat" && "active")}
        type="button"
        onClick={() => props.onSelect("chat")}
      >
        <RailIcon iconStyle={iconStyle} pixelIcon="chat" professionalIcon={MessageSquare} />
        <span>{t("app.chat")}</span>
      </button>
      {PRIMARY_NAV_ITEMS.map((item) => {
        const label = t(item.labelKey);
        return (
          <button
            className={clsx("mobile-nav-item", props.activeView === item.id && "active")}
            key={item.id}
            type="button"
            onClick={() => props.onSelect(item.id)}
          >
            <RailIcon iconStyle={iconStyle} pixelIcon={item.icon} professionalIcon={item.professionalIcon} />
            <span>{label}</span>
          </button>
        );
      })}
      <button
        className={clsx("mobile-nav-item", props.activeView === "contacts" && "active")}
        type="button"
        onClick={() => props.onSelect("contacts")}
      >
        <RailIcon iconStyle={iconStyle} pixelIcon="contacts" professionalIcon={ContactRound} />
        <span>通讯录</span>
      </button>
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
