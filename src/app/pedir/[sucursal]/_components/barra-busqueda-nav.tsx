"use client";

import { useEffect, useRef } from "react";
import type { CategoriaCatalogo } from "../_lib/tipos";
import { IconBuscar, IconCerrar } from "./iconos";

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <IconBuscar className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-pd-ink-400" />
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Buscar en el menú"
        // 16px: evita el zoom automático de iOS al enfocar
        className="h-[46px] w-full rounded-2xl border-[1.5px] border-pd-line-strong bg-white pl-10 pr-11 text-[16px] text-pd-ink-900 placeholder:text-pd-ink-300 focus:border-pd-ember focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-pd-warm text-pd-ink-600"
        >
          <IconCerrar className="size-4" />
        </button>
      )}
    </div>
  );
}

export function CategoryNav({ categorias, activaId, onElegir }: {
  categorias: CategoriaCatalogo[]; activaId: string; onElegir: (id: string) => void;
}) {
  const navRef = useRef<HTMLDivElement>(null);

  // La pill activa se auto-centra en el nav cuando cambia (por scroll o tap).
  useEffect(() => {
    const nav = navRef.current;
    const pill = nav?.querySelector<HTMLElement>(`[data-cat="${activaId}"]`);
    if (nav && pill) nav.scrollTo({ left: pill.offsetLeft - 16, behavior: "smooth" });
  }, [activaId]);

  return (
    <div ref={navRef} role="tablist" aria-label="Categorías" className="pd-noscroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-3 pt-2.5">
      {categorias.map((c) => {
        const activa = c.id === activaId;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={activa}
            data-cat={c.id}
            onClick={() => onElegir(c.id)}
            className={`h-11 shrink-0 rounded-full border-[1.5px] px-[18px] text-[14px] font-bold whitespace-nowrap transition-colors ${
              activa ? "border-pd-ink-900 bg-pd-ink-900 text-pd-cream" : "border-pd-line-strong bg-white text-pd-ink-900"
            }`}
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
