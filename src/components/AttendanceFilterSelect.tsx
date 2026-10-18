"use client";

import { useEffect, useId, useRef, useState } from "react";

type Option = { value: string; label: string };
type Props = { id?: string; label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; title?: string };

export function AttendanceFilterSelect({ id, label, value, options, onChange, disabled, title }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.findIndex((option) => option.value === value);
  const expanded = open && !disabled && options.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [expanded]);

  useEffect(() => {
    if (expanded) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, listId]);

  function choose(index: number) {
    if (!options[index]) return;
    onChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  }

  return <div className="rd-select-wrap acd-custom-select" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button id={id} ref={trigger} className="rd-select acd-select-trigger" type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded ? `${listId}-${active}` : undefined} disabled={disabled || options.length === 0} title={title}
      onClick={() => { setActive(Math.max(0, selected)); setOpen((current) => !current); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
          setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : !expanded ? Math.max(0, selected) : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (expanded) choose(active); else { setActive(Math.max(0, selected)); setOpen(true); }
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const next = options.findIndex((option, index) => index > active && option.label.toLocaleLowerCase("bg").startsWith(event.key.toLocaleLowerCase("bg")));
          const fallback = options.findIndex((option) => option.label.toLocaleLowerCase("bg").startsWith(event.key.toLocaleLowerCase("bg")));
          if (next >= 0 || fallback >= 0) { event.preventDefault(); setActive(next >= 0 ? next : fallback); setOpen(true); }
        }
      }}>
      <span>{options[selected]?.label ?? options[0]?.label ?? "Няма групи"}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {expanded && <ul id={listId} role="listbox" aria-label={label} className="acd-select-options">
      {options.map((option, index) => <li key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value} className={`acd-select-option${index === active ? " acd-select-option--active" : ""}`} onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>{option.label}</li>)}
    </ul>}
  </div>;
}
