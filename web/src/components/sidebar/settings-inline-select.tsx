import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type InlineSelectOption = { id: string; label: string; icon?: ReactNode };

export function InlineSelect(props: {
  value: string;
  options: InlineSelectOption[];
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const selected = props.options.find((option) => option.id === props.value) ?? props.options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span className="settings-inline-select" ref={rootRef}>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="settings-inline-select-value">
          {selected?.icon ? <span className="settings-inline-select-icon">{selected.icon}</span> : null}
          <span>{selected?.label}</span>
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <span className="settings-inline-menu">
          {props.options.map((option) => (
            <button
              key={option.id || "native"}
              type="button"
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
