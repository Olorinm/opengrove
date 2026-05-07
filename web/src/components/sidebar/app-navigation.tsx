import clsx from "clsx";
import {
  BookOpenText,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { ViewId } from "../../bridge";

export type RailSectionId = "chat" | "library" | "settings";

type NavItem = { id: ViewId; label: string; icon: LucideIcon };

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "library", label: "资料库", icon: BookOpenText },
];

export function isAdvancedView(view: ViewId): boolean {
  return view === "context";
}

export function railSectionForView(view: ViewId): RailSectionId {
  if (view === "settings") return "settings";
  if (isAdvancedView(view)) return "settings";
  if (view === "library" || view === "inbox" || view === "artifacts") return "library";
  return "chat";
}

export function AppRail(props: {
  activeSection: RailSectionId;
  onOpenSection(section: RailSectionId): void;
  onOpenSettings(): void;
}) {
  return (
    <aside className="app-rail" aria-label="主空间">
      <nav className="app-rail-nav">
        <RailButton
          active={props.activeSection === "chat"}
          label="对话"
          icon={MessageSquare}
          onClick={() => props.onOpenSection("chat")}
        />
        <RailButton
          active={props.activeSection === "library"}
          label="资料库"
          icon={BookOpenText}
          onClick={() => props.onOpenSection("library")}
        />
      </nav>
      <div className="app-rail-bottom">
        <RailButton
          active={props.activeSection === "settings"}
          label="设置"
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
  return (
    <nav className="mobile-nav" aria-label="移动端入口">
      <button
        className={clsx("mobile-nav-item", props.activeView === "chat" && "active")}
        type="button"
        onClick={() => props.onSelect("chat")}
      >
        <MessageSquare size={15} />
        <span>对话</span>
      </button>
      {PRIMARY_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <button
            className={clsx("mobile-nav-item", props.activeView === item.id && "active")}
            key={item.id}
            type="button"
            onClick={() => props.onSelect(item.id)}
          >
            <Icon size={15} />
            <span>{item.label}</span>
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
