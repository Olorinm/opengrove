import type { ReactNode } from "react";
import clsx from "clsx";

export function WorkspaceWorkbenchLayout(props: {
  directory: ReactNode;
  preview: ReactNode;
  chat?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("workspace-workbench-layout", props.className)}>
      {props.directory}
      {props.preview}
      {props.chat}
    </div>
  );
}
