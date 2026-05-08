import clsx from "clsx";
import {
  BookOpenText,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { ViewId } from "../../bridge";
import { useI18n } from "../../i18n";

export type RailSectionId = "chat" | "library" | "settings";

type NavItem = { id: ViewId; labelKey: "app.library"; icon: LucideIcon };

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "library", labelKey: "app.library", icon: BookOpenText },
];

export function railSectionForView(view: ViewId): RailSectionId {
  if (view === "settings") return "settings";
  if (view === "library") return "library";
  return "chat";
}

export function AppRail(props: {
  activeSection: RailSectionId;
  onOpenSection(section: RailSectionId): void;
  onOpenSettings(): void;
}) {
  const { t } = useI18n();
  return (
    <aside className="app-rail" aria-label={t("app.mainNav")}>
      <nav className="app-rail-nav">
        <RailButton
          active={props.activeSection === "chat"}
          label={t("app.chat")}
          icon={MessageSquare}
          onClick={() => props.onOpenSection("chat")}
        />
        <RailButton
          active={props.activeSection === "library"}
          label={t("app.library")}
          icon={BookOpenText}
          onClick={() => props.onOpenSection("library")}
        />
      </nav>
      <div className="app-rail-bottom">
        <RailButton
          active={props.activeSection === "settings"}
          label={t("app.settings")}
          icon={Settings}
          onClick={props.onOpenSettings}
        />
      </div>
    </aside>
  );
}

export function MobileNav(props: {
  activeView: ViewId;
  onSelect(view: ViewId): void;
}) {
  const { t } = useI18n();
  return (
    <nav className="mobile-nav" aria-label={t("app.mobileNav")}>
      <button
        className={clsx("mobile-nav-item", props.activeView === "chat" && "active")}
        type="button"
        onClick={() => props.onSelect("chat")}
      >
        <MessageSquare size={15} />
        <span>{t("app.chat")}</span>
      </button>
      {PRIMARY_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const label = t(item.labelKey);
        return (
          <button
            className={clsx("mobile-nav-item", props.activeView === item.id && "active")}
            key={item.id}
            type="button"
            onClick={() => props.onSelect(item.id)}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function RailButton(props: {
  active?: boolean;
  label: string;
  icon: LucideIcon;
  onClick(): void;
}) {
  const Icon = props.icon;
  return (
    <button
      className="app-rail-button"
      data-active={props.active ? "true" : "false"}
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      <Icon size={19} />
    </button>
  );
}
