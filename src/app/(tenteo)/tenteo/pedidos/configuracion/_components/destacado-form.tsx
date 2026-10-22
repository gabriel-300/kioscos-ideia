"use client";

import { useState, useTransition } from "react";
import { guardarDestacadoOnline } from "../actions";
import type { GrupoElegible } from "./catalogo-online-form";

const inputCls = "h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20";

// El banner grande de la tienda ("el combo del día"): se elige un producto o promo CON FOTO y, si se quiere,
// un título corto. Sin elegir, muestra lo más pedido. (Migración 121.)
export function DestacadoForm({ sucursalId, grupos, inicial }: {
  sucursalId: string;
  grupos:     GrupoElegible[];
  inicial:    { itemId: string | null; titulo: string | null };
}) {
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [itemId, setItemId] = useState(inicial.itemId ?? "");
  const [titulo, setTitulo] = useState(inicial.titulo ?? "");

  const conFoto = grupos.map((g) => ({ ...g, items: g.items.filter((i) => i.conFoto) })).filter((g) => g.items.length > 0);

  function guardar(automatico = false) {
    setMensaje(null);
    startTransition(async () => {
      const res = await guardarDestacadoOnline(sucursalId, automatico ? null : itemId || null, automatico ? "" : titulo);
      if (res.error) { setMensaje({ ok: false, texto: res.error }); return; }
      if (automatico) { setItemId(""); setTitulo(""); }
      setMensaje({ ok: true, texto: automatico ? "Listo: el banner muestra lo más pedido" : "Guardado" });
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Banner grande de la tienda</h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          Es lo primero que ve el cliente, con la foto grande y un botón para pedirlo. Elegí el producto o promo que quieras empujar (por ejemplo, el combo del día).
          Si no elegís ninguno, muestra automáticamente lo más pedido. Solo se pueden elegir productos con foto.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px]">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Producto o promo</label>
          <select value={itemId} onChange={(e) => { setItemId(e.target.value); setMensaje(null); }} className={`${inputCls} w-full`}>
            <option value="">Automático: lo más pedido</option>
            {conFoto.map((g) => (
              <optgroup key={g.id} label={g.nombre}>
                {g.items.map((i) => <option key={i.id} value={i.id}>{i.nombre}{i.esPromo ? " (promo)" : ""}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Título (opcional)</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={40} placeholder="Combo del día" disabled={!itemId} className={`${inputCls} w-full disabled:opacity-50`} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => guardar(false)} disabled={pending} className="h-10 px-5 rounded-lg bg-tierra-700 text-white text-sm font-semibold disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar banner"}
        </button>
        {inicial.itemId && (
          <button type="button" onClick={() => guardar(true)} disabled={pending} className="text-sm text-neutral-500 hover:underline disabled:opacity-50">
            Volver a automático
          </button>
        )}
        {mensaje && <span className={`text-sm ${mensaje.ok ? "text-emerald-600" : "text-danger"}`}>{mensaje.texto}</span>}
      </div>
    </div>
  );
}
