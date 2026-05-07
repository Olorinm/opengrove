import type { ReactNode } from "react";

export function PanelSection(props: {
  title: string;
  count?: number;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel-section">
      <div className="panel-header">
        <div className="panel-header-copy">
          <div className="panel-title">{props.title}</div>
          {props.subtitle ? <div className="panel-subtitle">{props.subtitle}</div> : null}
        </div>
        <div className="panel-header-meta">
          {props.actions}
          <span className="panel-count">{props.count ?? 0}</span>
        </div>
      </div>
      <div className="panel-list">{props.children}</div>
    </section>
  );
}
