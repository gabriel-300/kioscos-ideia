"use client";

import { useState } from "react";
import type { ItemCatalogo } from "../_lib/tipos";
import { fmt } from "../_lib/tema";
import { Foto, QtyStepper } from "./producto-ui";
import { IconAtras, IconChevron } from "./iconos";

// Detalle de producto: foto grande, precio y "Agregar $X". No hay variantes
// (cada tamaño es un producto propio en este sistema, con su stock y precio
// por sucursal) ni descripción cargada, así que el detalle es corto.
export function ProductSheet({ item, puedePedir, onCerrar, onAgregar }: {
  item: ItemCatalogo; puedePedir: boolean; onCerrar: () => void; onAgregar: (cantidad: number) => void;
}) {
  const [cantidad, setCantidad] = useState(1);

  return (
    <div className="pd-slideup fixed inset-0 z-50 flex flex-col bg-pd-paper" role="dialog" aria-modal="true" aria-label={item.name}>
      <div className="flex-1 overflow-y-auto">
        <div className="relative h-[300px] w-full">
          <Foto item={item} className="absolute inset-0 size-full bg-white !object-contain" eager textoClase="text-[26px]" />
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Volver"
            className="absolute left-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/95 text-pd-ink-900 shadow-md"
          >
            <IconAtras className="size-5" />
          </button>
          {item.badge && (
            <span className="absolute bottom-3 left-4 rounded-[7px] bg-pd-ink px-2.5 py-1 text-[11px] font-bold tracking-[0.07em] text-pd-cream">{item.badge}</span>
          )}
        </div>
        <div className="px-4 pb-8 pt-5">
          <h2 className="text-[25px] text-pd-ink-900">{item.name}</h2>
          <p className="pd-display mt-2 text-[26px] font-extrabold text-pd-ember">
            {fmt(item.price)}{item.unit && <span className="ml-1.5 text-[13px] font-medium text-pd-ink-400">{item.unit}</span>}
          </p>
        </div>
      </div>

      {puedePedir && (
        <div className="flex gap-3 border-t border-pd-line bg-white px-4 pb-6 pt-3.5">
          <QtyStepper
            qty={cantidad}
            onInc={() => setCantidad((c) => Math.min(c + 1, 50))}
            onDec={() => setCantidad((c) => Math.max(c - 1, 1))}
            alto={56}
            className="w-[132px] shrink-0"
          />
          <button
            type="button"
            onClick={() => onAgregar(cantidad)}
            className="pd-display flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-pd-ember text-[16px] font-bold text-white active:bg-pd-ember-dark"
          >
            Agregar <span className="tabular-nums">{fmt(item.price * cantidad)}</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function CartBar({ cantidad, total, onAbrir }: { cantidad: number; total: number; onAbrir: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[18px] z-30 px-4">
      <button
        type="button"
        onClick={onAbrir}
        className="pd-popin pointer-events-auto mx-auto flex h-[60px] w-full max-w-[560px] items-center justify-between rounded-[19px] bg-pd-ember px-3.5 text-white active:bg-pd-ember-dark"
        style={{ boxShadow: "0 16px 30px -12px rgba(217,63,30,.75)" }}
      >
        <span className="flex items-center gap-2.5 text-[15px] font-bold">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-white/20 text-[14px] tabular-nums" aria-live="polite">{cantidad}</span>
          Ver pedido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="pd-display text-[20px] font-extrabold tabular-nums" aria-live="polite">{fmt(total)}</span>
          <IconChevron className="size-[18px] opacity-80" />
        </span>
      </button>
    </div>
  );
}

// Aviso al entrar con el local cerrado: una sola vez por sesión, nunca
// bloquea el catálogo (se puede armar el pedido igual).
export function ClosedSheet({ proxima, onCerrar }: { proxima: string | null; onCerrar: () => void }) {
  return (
    <div className="pd-fadein fixed inset-0 z-[60] flex items-end bg-black/45" role="dialog" aria-modal="true" aria-label="Local cerrado">
      <div className="pd-slideup w-full rounded-t-[28px] bg-pd-paper px-5 pb-8 pt-6">
        <span className="inline-block rounded-full bg-pd-warn px-3 py-1.5 text-[11.5px] font-bold tracking-[0.06em] text-pd-warn-ink">CERRADO AHORA</span>
        <h2 className="mt-3 text-[26px] text-pd-ink-900">{proxima ? `Abrimos ${proxima}` : "Ahora estamos cerrados"}</h2>
        <p className="mt-2 text-[14.5px] text-pd-ink-600">Podés mirar el menú y dejar el pedido armado: lo preparamos apenas abrimos.</p>
        <button
          type="button"
          onClick={onCerrar}
          className="pd-display mt-5 h-14 w-full rounded-2xl bg-pd-ink-900 text-[16px] font-bold text-pd-cream"
        >
          Ver el menú igual
        </button>
      </div>
    </div>
  );
}
