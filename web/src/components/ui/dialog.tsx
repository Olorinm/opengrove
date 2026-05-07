import * as DialogPrimitive from "@radix-ui/react-dialog";
import clsx from "clsx";
import type { ComponentPropsWithoutRef } from "react";

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="modal-overlay" />
      <div className="modal-shell">
        <DialogPrimitive.Content className={clsx("modal-card", className)} {...props}>
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={clsx("modal-title", className)} {...props} />;
}
