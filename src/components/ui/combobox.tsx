"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface Props {
  options:      ComboboxOption[];
  value:        string;
  onChange:     (value: string) => void;
  placeholder?: string;
  className?:   string;
}

export function Combobox({ options, value, onChange, placeholder = "Seleccioná…", className }: Props) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function selectOption(opt: ComboboxOption) {
    onChange(opt.value);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <input
        type="text"
        value={open ? query : (selected?.label ?? "")}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); setQuery(""); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Enter")  { e.preventDefault(); if (filtered[0]) selectOption(filtered[0]); }
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700"
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-neutral-400">Sin resultados</div>
          ) : (
            filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => selectOption(opt)}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 transition-colors ${
                  opt.value === value ? "bg-tierra-50 text-tierra-700 font-medium" : "text-neutral-700"
                }`}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
