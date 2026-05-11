import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type RoomInlineSelectOption = {
  id: string;
  label: string;
  icon?: ReactNode;
};

export function RoomInlineSelect(props: {
  value: string;
  options: RoomInlineSelectOption[];
  onChange(value: string): void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const selected = props.options.find((option) => option.id === props.value) ?? props.options[0] ?? { id: props.value, label: props.value };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className={`settings-inline-select contacts-inline-select ${props.className || ""}`.trim()} ref={rootRef}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="settings-inline-select-value">
          {selected.icon ? <span className="settings-inline-select-icon">{selected.icon}</span> : null}
          <span>{selected.label}</span>
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <span className="settings-inline-menu contacts-inline-menu" role="listbox">
          {props.options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === props.value}
              onClick={() => {
                props.onChange(option.id);
                setOpen(false);
              }}
            >
              <span className="settings-inline-select-value">
                {option.icon ? <span className="settings-inline-select-icon">{option.icon}</span> : null}
                <span>{option.label}</span>
              </span>
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
