"use client";

import { useState, useTransition } from "react";
import { guardarDestacadosOnline } from "../actions";
import type { GrupoElegible } from "./catalogo-online-form";

const inputCls = "h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20";
const CANTIDAD = 3;

type Hueco = { itemId: string; titulo: string };

// Los banners grandes de la tienda ("el combo del día"): hasta 3 productos o promos CON FOTO, que rotan solos
// arriba con un botón para pedirlos. Cada uno puede llevar un título corto. Sin elegir ninguno, rotan los más
// pedidos. (Migración 121.)
export function DestacadoForm({ sucursalId, grupos, inicial }: {
  sucursalId: string;
  grupos:     GrupoElegible[];
  inicial:    { itemId: string; titulo: string | null }[];
}) {
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [huecos, setHuecos] = useState<Hueco[]>(() =>
    Array.from({ length: CANTIDAD }, (_, i) => ({ itemId: inicial[i]?.itemId ?? "", titulo: inicial[i]?.titulo ?? "" })),
  );

  const conFoto = grupos.map((g) => ({ ...g, items: g.items.filter((i) => i.conFoto) })).filter((g) => g.items.length > 0);

  function cambiar(i: number, parcial: Partial<Hueco>) {
    setMensaje(null);
    setHuecos((prev) => prev.map((h, j) => (j === i ? { ...h, ...parcial } : h)));
  }

  function guardar(automatico = false) {
    setMensaje(null);
    const lista = automatico ? [] : huecos.filter((h) => h.itemId).map((h) => ({ itemId: h.itemId, titulo: h.titulo }));
    startTransition(async () => {
      const res = await guardarDestacadosOnline(sucursalId, lista);
      if (res.error) { setMensaje({ ok: false, texto: res.error }); return; }
      if (automatico) setHuecos(Array.from({ length: CANTIDAD }, () => ({ itemId: "", titulo: "" })));
      setMensaje({ ok: true, texto: automatico ? "Listo: los banners rotan lo más pedido" : "Guardado" });
    });
  }

  const hayElegidos = huecos.some((h) => h.itemId);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Banners grandes de la tienda</h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          Es lo primero que ve el cliente: fotos grandes que rotan solas, con un botón para pedir. Elegí hasta 3 productos o promos que quieras empujar
          (por ejemplo, el combo del día) y, si querés, un título corto para cada uno. Si no elegís ninguno, rotan automáticamente los más pedidos.
          Solo se pueden elegir productos con foto.
        </p>
      </div>

      <div className="space-y-3">
        {huecos.map((h, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Banner {i + 1}</label>
              <select value={h.itemId} onChange={(e) => cambiar(i, { itemId: e.target.value })} className={`${inputCls} w-full`}>
                <option value="">{i === 0 ? "Automático: lo más pedido" : "— Ninguno —"}</option>
                {conFoto.map((g) => (
                  <optgroup key={g.id} label={g.nombre}>
                    {g.items.map((it) => <option key={it.id} value={it.id}>{it.nombre}{it.esPromo ? " (promo)" : ""}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Título (opcional)</label>
              <input value={h.titulo} onChange={(e) => cambiar(i, { titulo: e.target.value })} maxLength={40} placeholder="Combo del día" disabled={!h.itemId} className={`${inputCls} w-full disabled:opacity-50`} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => guardar(false)} disabled={pending} className="h-10 px-5 rounded-lg bg-tierra-700 text-white text-sm font-semibold disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar banners"}
        </button>
        {(inicial.length > 0 || hayElegidos) && (
          <button type="button" onClick={() => guardar(true)} disabled={pending} className="text-sm text-neutral-500 hover:underline disabled:opacity-50">
            Volver a automático
          </button>
        )}
        {mensaje && <span className={`text-sm ${mensaje.ok ? "text-emerald-600" : "text-danger"}`}>{mensaje.texto}</span>}
      </div>
    </div>
  );
}
