import type { ReactNode } from "react";
import clsx from "clsx";

export function DirectoryPanel(props: {
  title: ReactNode;
  kicker?: ReactNode;
  actions?: ReactNode;
  search?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  "aria-label"?: string;
}) {
  return (
    <section className={clsx("directory-panel", "sidebar-panel-space", props.className)} aria-label={props["aria-label"]}>
      <div className="sidebar-space-header directory-panel-header">
        <div className="directory-panel-title-block">
          {props.kicker ? <div className="sidebar-space-kicker directory-panel-kicker">{props.kicker}</div> : null}
          <div className="sidebar-space-title directory-panel-title">{props.title}</div>
        </div>
        {props.actions ? (
          <div className="sidebar-space-actions directory-panel-actions active" aria-label="目录操作">
            {props.actions}
          </div>
        ) : null}
      </div>
      {props.status ? <div className="directory-panel-status">{props.status}</div> : null}
      {props.search}
      <div className={clsx("directory-panel-body", props.bodyClassName)}>
        {props.children}
      </div>
    </section>
  );
}
