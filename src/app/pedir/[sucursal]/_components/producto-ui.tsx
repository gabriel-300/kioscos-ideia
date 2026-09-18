"use client";

import { useState } from "react";
import type { ItemCatalogo } from "../_lib/tipos";
import { estiloGradiente, fmt } from "../_lib/tema";
import { IconMas, IconMenos } from "./iconos";

// Foto del producto. Si no tiene (o falla la carga) se usa el degradé de la
// categoría con el nombre centrado -- nunca un círculo con iniciales.
export function Foto({ item, className = "", eager = false, textoClase = "text-[15px]" }: {
  item: ItemCatalogo; className?: string; eager?: boolean; textoClase?: string;
}) {
  const [fallo, setFallo] = useState(false);
  if (item.image && !fallo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={item.image}
        alt={item.name}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFallo(true)}
        className={`object-cover ${className}`}
      />
    );
  }
  return (
    <div className={`flex items-center justify-center p-3 text-center ${className}`} style={estiloGradiente(item.categoriaNombre)} role="img" aria-label={item.name}>
      <span className={`pd-display font-bold leading-tight text-pd-cream [text-wrap:balance] ${textoClase}`}>{item.name}</span>
    </div>
  );
}

export function QtyStepper({ qty, onInc, onDec, alto = 44, className = "" }: {
  qty: number; onInc: () => void; onDec: () => void; alto?: number; className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-[13px] border border-pd-tint-line bg-pd-tint ${className}`}
      style={{ height: alto }}
    >
      <button type="button" aria-label="Quitar uno" onClick={onDec} className="h-full px-3.5 text-pd-ember">
        <IconMenos className="size-[22px]" />
      </button>
      <span className="pd-display text-[17px] font-bold tabular-nums text-pd-ink-900" aria-live="polite">{qty}</span>
      <button type="button" aria-label="Agregar uno" onClick={onInc} className="h-full px-3.5 text-pd-ember">
        <IconMas className="size-[22px]" />
      </button>
    </div>
  );
}

export function ProductCard({ item, qty, puedePedir, eager, onAdd, onDec, onOpen }: {
  item: ItemCatalogo; qty: number; puedePedir: boolean; eager: boolean;
  onAdd: () => void; onDec: () => void; onOpen: () => void;
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-[20px] border border-pd-line bg-white">
      <button type="button" onClick={onOpen} className="relative block aspect-square w-full" aria-label={`Ver ${item.name}`}>
        <Foto item={item} className="absolute inset-0 size-full" eager={eager} />
        {item.badge && (
          <span className="absolute left-[9px] top-[9px] rounded-[7px] bg-pd-ink px-2 py-[3px] text-[10.5px] font-bold tracking-[0.07em] text-pd-cream">
            {item.badge}
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col p-3">
        <button type="button" onClick={onOpen} className="text-left">
          <p className="text-[14px] font-semibold leading-[1.25] min-h-[2.5em] line-clamp-2">{item.name}</p>
        </button>
        <p className="pd-display mt-1.5 text-[18px] font-extrabold text-pd-ink-900">
          {fmt(item.price)}{item.unit && <span className="ml-1 text-[11px] font-medium text-pd-ink-400">{item.unit}</span>}
        </p>
        {puedePedir && (
          <div className="mt-2.5">
            {qty > 0 ? (
              <QtyStepper qty={qty} onInc={onAdd} onDec={onDec} />
            ) : (
              <button
                type="button"
                onClick={onAdd}
                className="h-11 w-full rounded-[13px] bg-pd-ink-900 text-[14px] font-bold text-pd-cream transition-colors hover:bg-pd-ember active:bg-pd-ember-dark"
              >
                Agregar
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
