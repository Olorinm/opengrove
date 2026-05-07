import clsx from "clsx";
import {
  BookOpenText,
  Globe2,
  MessageSquare,
  Settings,
  SlidersHorizontal,
  ClipboardPlus,
  type LucideIcon,
} from "lucide-react";
import type { ViewId } from "../../bridge";

export type RailSectionId = "chat" | "library" | "wiki" | "system";

type NavItem = { id: ViewId; label: string; icon: LucideIcon };

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "library", label: "资料库", icon: BookOpenText },
  { id: "wiki", label: "Wiki", icon: Globe2 },
];

const ADVANCED_NAV_ITEMS: NavItem[] = [
  { id: "context", label: "原始上下文", icon: ClipboardPlus },
];

export function isAdvancedView(view: ViewId): boolean {
  return ADVANCED_NAV_ITEMS.some((item) => item.id === view);
}

export function railSectionForView(view: ViewId): RailSectionId {
  if (view === "wiki") return "wiki";
  if (isAdvancedView(view)) return "system";
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
        <RailButton
          active={props.activeSection === "wiki"}
          label="Wiki"
          icon={Globe2}
          onClick={() => props.onOpenSection("wiki")}
        />
        <RailButton
          active={props.activeSection === "system"}
          label="系统视图"
          icon={SlidersHorizontal}
          onClick={() => props.onOpenSection("system")}
        />
      </nav>
      <div className="app-rail-bottom">
        <RailButton label="设置" icon={Settings} onClick={props.onOpenSettings} />
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

export function SystemSidebar(props: {
  activeView: ViewId;
  onSelect(view: ViewId): void;
}) {
  return (
    <section className="sidebar-panel-space" aria-label="系统视图">
      <div className="sidebar-space-header">
        <div>
          <div className="sidebar-space-kicker">System</div>
          <div className="sidebar-space-title">系统视图</div>
        </div>
      </div>
      <NavSection items={ADVANCED_NAV_ITEMS} activeView={props.activeView} onSelect={props.onSelect} />
    </section>
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

function NavSection(props: {
  items: NavItem[];
  activeView: ViewId;
  onSelect(view: ViewId): void;
}) {
  return (
    <div className="nav-section">
      {props.items.map((item) => {
        const Icon = item.icon;
        return (
          <div className="nav-item-block" key={item.id}>
            <button
              className={clsx("nav-item", props.activeView === item.id && "active")}
              type="button"
              onClick={() => props.onSelect(item.id)}
            >
              <span className="nav-item-label">
                <Icon size={14} />
                {item.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
