"use client";

import { useState } from "react";
import type { ItemCatalogo } from "../_lib/tipos";
import { fmt } from "../_lib/tema";
import { Foto, QtyStepper } from "./producto-ui";
import { IconAtras, IconChevron } from "./iconos";
import { Panel } from "./panel";
import { INICIAL_KG, OPCIONES_RAPIDAS_KG, PASO_KG, precioPor100g, redondearKg, sumarKg, textoCantidad } from "@/lib/pedidos/cantidad-peso";

// Detalle de producto: foto grande, precio y "Agregar $X". No hay variantes
// (cada tamaño es un producto propio en este sistema, con su stock y precio
// por sucursal) ni descripción cargada, así que el detalle es corto.
export function ProductSheet({ item, puedePedir, onCerrar, onAgregar }: {
  item: ItemCatalogo; puedePedir: boolean; onCerrar: () => void; onAgregar: (cantidad: number) => void;
}) {
  const porPeso = !!item.unit;
  const [cantidad, setCantidad] = useState(porPeso ? INICIAL_KG : 1);

  return (
    <Panel z="z-50" ancho="md:max-w-[900px]"><div role="dialog" aria-modal="true" aria-label={item.name} className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* Foto: arriba en celular, a la izquierda en computadora */}
      <div className="relative h-[250px] w-full shrink-0 md:h-auto md:min-h-[520px] md:w-[46%]">
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

      {/* Información y botón de agregar */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-5 md:px-8 md:pt-9">
          <h2 className="text-[25px] text-pd-ink-900 md:text-[30px]">{item.name}</h2>
          {item.descripcion && <p className="mt-2 text-[14.5px] leading-relaxed text-pd-ink-600">{item.descripcion}</p>}
          {porPeso ? (
            <>
              <p className="pd-display mt-3 text-[26px] font-extrabold text-pd-ember">
                {fmt(precioPor100g(item.price))}<span className="ml-1.5 text-[13px] font-medium text-pd-ink-400">cada 100 g</span>
              </p>
              <p className="text-[12.5px] text-pd-ink-400">({fmt(item.price)} el kilo)</p>

              <p className="mt-5 text-[13.5px] font-bold text-pd-ink-900">¿Cuánto querés?</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Cantidad">
                {OPCIONES_RAPIDAS_KG.map((kg) => {
                  const activa = redondearKg(cantidad) === kg;
                  return (
                    <button
                      key={kg}
                      type="button"
                      onClick={() => setCantidad(kg)}
                      aria-pressed={activa}
                      className={`flex min-w-[78px] flex-col items-center rounded-[14px] border-[1.5px] px-3 py-2 ${activa ? "border-pd-ember bg-pd-tint" : "border-pd-line bg-white"}`}
                    >
                      <span className="pd-display text-[15px] font-bold text-pd-ink-900">{textoCantidad(kg, true)}</span>
                      <span className="text-[12px] tabular-nums text-pd-ink-600">{fmt(item.price * kg)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 rounded-[14px] bg-pd-tint px-3.5 py-3 text-[14.5px] text-pd-ink-900">
                Vas a pedir <strong>{textoCantidad(cantidad, true)}</strong> de {item.name}: <strong>{fmt(item.price * cantidad)}</strong>
              </p>
              <p className="mt-2 text-[12px] text-pd-ink-400">Podés sumar o restar de a 100 g con los botones de abajo.</p>
            </>
          ) : (
            <p className="pd-display mt-3 text-[26px] font-extrabold text-pd-ember">{fmt(item.price)}</p>
          )}
        </div>

        {puedePedir && (
          <div className="flex gap-3 border-t border-pd-line bg-white px-4 pb-6 pt-3.5 md:px-8">
            <QtyStepper
              qty={cantidad}
              porPeso={porPeso}
              onInc={() => setCantidad((c) => Math.min(porPeso ? sumarKg(c, PASO_KG) : c + 1, 50))}
              onDec={() => setCantidad((c) => Math.max(porPeso ? sumarKg(c, -PASO_KG) : c - 1, porPeso ? PASO_KG : 1))}
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
    </div></Panel>
  );
}

export function CartBar({ cantidad, total, onAbrir }: { cantidad: number; total: number; onAbrir: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[18px] z-30 px-4">
      <button
        type="button"
        onClick={onAbrir}
        className="pd-popin pointer-events-auto mx-auto flex h-[60px] w-full max-w-[520px] items-center justify-between rounded-[19px] bg-pd-ember px-3.5 text-white active:bg-pd-ember-dark"
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
    <div className="pd-fadein fixed inset-0 z-[60] flex items-end justify-center bg-black/45 md:items-center md:p-6" role="dialog" aria-modal="true" aria-label="Local cerrado">
      <div className="pd-slideup w-full max-w-[480px] rounded-t-[28px] bg-pd-paper px-5 pb-8 pt-6 md:rounded-[28px]">
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
