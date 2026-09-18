"use client";

import { useEffect, useState } from "react";
import type { ConfigTienda, ItemCatalogo } from "../_lib/tipos";
import { fmt } from "../_lib/tema";
import { sugerirUpsellPublico } from "@/lib/pedidos/actions";
import { Foto, QtyStepper } from "./producto-ui";
import { IconAtras } from "./iconos";

type Upsell = { id: string; name: string; price: number; mensaje: string };

export function CartScreen({ config, lineas, subtotal, onVolver, onAgregarMas, onContinuar, onInc, onDec, onAgregarItem, itemsPorId }: {
  config:        ConfigTienda;
  lineas:        { item: ItemCatalogo; qty: number }[];
  subtotal:      number;
  onVolver:      () => void;
  onAgregarMas:  () => void;
  onContinuar:   () => void;
  onInc:         (id: string) => void;
  onDec:         (id: string) => void;
  onAgregarItem: (id: string) => void;
  itemsPorId:    Map<string, ItemCatalogo>;
}) {
  const [upsell, setUpsell] = useState<Upsell | null>(null);
  const idsClave = lineas.map((l) => l.item.id).sort().join(",");

  // Sugerencia de IA para subir el ticket (mejor esfuerzo: si falla o no hay
  // nada útil, simplemente no se muestra). Se pide una vez por combinación
  // de productos en el carrito.
  useEffect(() => {
    let vigente = true;
    setUpsell(null);
    if (!idsClave) return;
    sugerirUpsellPublico(config.sucursalId, idsClave.split(","))
      .then((res) => { if (vigente && res && itemsPorId.has(res.id)) setUpsell(res); })
      .catch(() => {});
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsClave, config.sucursalId]);

  const enviosDisponibles = config.deliveryHabilitado && config.zonas.length > 0;
  const desde = enviosDisponibles ? Math.min(...config.zonas.map((z) => z.costo)) : null;

  return (
    <div className="pd-slideup fixed inset-0 z-40 flex flex-col bg-pd-paper">
      <div className="flex items-center gap-3 border-b border-pd-line bg-white px-4 pb-3 pt-5">
        <button type="button" onClick={onVolver} aria-label="Volver" className="flex size-11 items-center justify-center rounded-[14px] border border-pd-line bg-pd-tint text-pd-ink-900">
          <IconAtras className="size-5" />
        </button>
        <h2 className="text-[22px] text-pd-ink-900">Tu pedido</h2>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {lineas.map(({ item, qty }) => (
          <div key={item.id} className="flex gap-3 rounded-[18px] border border-pd-line bg-white p-3">
            <Foto item={item} className="size-[66px] shrink-0 rounded-[14px]" textoClase="text-[9px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold leading-tight">{item.name}</p>
              <p className="mt-0.5 text-[12px] text-pd-ink-400">{fmt(item.price)} c/u</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <QtyStepper qty={qty} onInc={() => onInc(item.id)} onDec={() => onDec(item.id)} alto={38} className="w-[112px]" />
                <span className="pd-display text-[18px] font-extrabold tabular-nums">{fmt(item.price * qty)}</span>
              </div>
            </div>
          </div>
        ))}

        {upsell && (
          <div className="pd-popin flex items-center gap-3 rounded-[18px] border border-pd-tint-line bg-pd-tint p-3">
            <span className="text-[18px]" aria-hidden>💡</span>
            <p className="flex-1 text-[13px] leading-snug text-pd-ink-900">{upsell.mensaje}</p>
            <button
              type="button"
              onClick={() => { onAgregarItem(upsell.id); setUpsell(null); }}
              className="shrink-0 rounded-full bg-pd-ember px-3.5 py-2 text-[12.5px] font-bold text-white"
            >
              Agregar {fmt(upsell.price)}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onAgregarMas}
          className="h-12 w-full rounded-[18px] border-[1.5px] border-dashed border-pd-line-strong text-[13.5px] font-semibold text-pd-ink-600"
        >
          + Agregar algo más
        </button>
      </div>

      <div className="border-t border-pd-line bg-white px-4 pb-6 pt-3.5">
        <div className="flex justify-between text-[13.5px] text-pd-ink-600">
          <span>Subtotal</span><span className="pd-display font-bold tabular-nums text-pd-ink-900">{fmt(subtotal)}</span>
        </div>
        {desde != null && (
          <div className="mt-1 flex justify-between text-[13.5px] text-pd-ink-600">
            <span>Envío (se elige en el próximo paso)</span><span className="pd-display font-bold tabular-nums text-pd-ink-900">desde {fmt(desde)}</span>
          </div>
        )}
        <button
          type="button"
          onClick={onContinuar}
          className="pd-display mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-pd-ember text-[17px] font-bold text-white active:bg-pd-ember-dark"
          style={{ boxShadow: "0 16px 30px -14px rgba(217,63,30,.75)" }}
        >
          Continuar <span className="tabular-nums">{fmt(subtotal)}</span>
        </button>
      </div>
    </div>
  );
}
