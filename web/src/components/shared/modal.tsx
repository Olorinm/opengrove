import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export function Modal(props: {
  title: string;
  value: string;
  placeholder: string;
  onChange(value: string): void;
  onClose(): void;
  onConfirm(): void;
  confirmLabel: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
      <DialogContent aria-label={props.title}>
        <DialogTitle>{props.title}</DialogTitle>
        <textarea
          className="modal-textarea"
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
        ></textarea>
        <div className="modal-actions">
          <Button onClick={props.onClose}>取消</Button>
          <Button variant="primary" onClick={props.onConfirm}>
            {props.confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
