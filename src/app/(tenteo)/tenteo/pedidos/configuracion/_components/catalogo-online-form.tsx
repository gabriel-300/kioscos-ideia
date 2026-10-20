"use client";

import { useMemo, useState, useTransition } from "react";
import { guardarCatalogoOnline } from "../actions";

export type ItemElegible = { id: string; esPromo: boolean; nombre: string; precio: number; sinStock: boolean };
export type GrupoElegible = { id: string; nombre: string; items: ItemElegible[] };

const clave = (i: ItemElegible) => `${i.esPromo ? "m" : "p"}:${i.id}`;
const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Qué se ofrece en los pedidos online de esta sucursal. Todo lo que tiene precio y stock se ofrece
// salvo lo que se esconde acá; el kiosco no se entera. (Migración 119.)
export function CatalogoOnlineForm({ sucursalId, grupos, ocultosInicial }: {
  sucursalId:     string;
  grupos:         GrupoElegible[];
  ocultosInicial: string[]; // claves "p:<id>" / "m:<id>"
}) {
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocultos, setOcultos] = useState(() => new Set(ocultosInicial));
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState("");
  const [abierto, setAbierto] = useState(false);

  const consulta = sinTildes(busqueda.trim());
  const visibles = useMemo(
    () => grupos
      .filter((g) => !categoria || g.id === categoria)
      .map((g) => ({ ...g, items: g.items.filter((i) => !consulta || sinTildes(i.nombre).includes(consulta)) }))
      .filter((g) => g.items.length > 0),
    [grupos, categoria, consulta],
  );

  const total = grupos.reduce((s, g) => s + g.items.length, 0);
  const nOcultos = grupos.reduce((s, g) => s + g.items.filter((i) => ocultos.has(clave(i))).length, 0);

  function cambiar(items: ItemElegible[], ocultar: boolean) {
    setMensaje(null);
    setOcultos((prev) => {
      const sig = new Set(prev);
      for (const i of items) { if (ocultar) sig.add(clave(i)); else sig.delete(clave(i)); }
      return sig;
    });
  }

  function guardar() {
    setMensaje(null);
    const productos: string[] = [], promos: string[] = [];
    for (const k of ocultos) (k.startsWith("m:") ? promos : productos).push(k.slice(2));
    startTransition(async () => {
      const res = await guardarCatalogoOnline(sucursalId, productos, promos);
      setMensaje(res.error ? { ok: false, texto: res.error } : { ok: true, texto: "Guardado" });
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <button type="button" onClick={() => setAbierto((a) => !a)} className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={abierto}>
        <span>
          <span className="block text-sm font-semibold text-neutral-900">Qué se ofrece online</span>
          <span className="mt-0.5 block text-xs text-neutral-400">
            Se ofrece todo lo que tiene precio y stock en este local. Acá podés esconder productos o promos puntuales (por ejemplo, no mandar churros por delivery); la caja del kiosco no cambia.
          </span>
          <span className="mt-1.5 block text-xs font-medium text-neutral-600">
            {nOcultos === 0 ? `Se ofrecen todos (${total})` : `${nOcultos} escondidos de ${total}`}
          </span>
        </span>
        <span aria-hidden className="mt-0.5 text-neutral-400">{abierto ? "▲" : "▼"}</span>
      </button>

      {abierto && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto o promo…"
              className="h-10 min-w-[200px] flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:border-tierra-700 focus:outline-none focus:ring-2 focus:ring-tierra-700/20"
            />
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm"
              aria-label="Filtrar por categoría"
            >
              <option value="">Todas las categorías</option>
              {grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>

          {visibles.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-400">No hay productos que coincidan.</p>
          ) : (
            <div className="max-h-[560px] space-y-5 overflow-y-auto pr-1">
              {visibles.map((g) => (
                <section key={g.id}>
                  <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-neutral-100 bg-white py-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{g.nombre} <span className="font-normal text-neutral-400">({g.items.length})</span></h3>
                    <div className="flex gap-3 text-xs">
                      <button type="button" onClick={() => cambiar(g.items, false)} className="text-tierra-700 hover:underline">Mostrar todos</button>
                      <button type="button" onClick={() => cambiar(g.items, true)} className="text-neutral-500 hover:underline">Esconder todos</button>
                    </div>
                  </div>
                  <ul className="divide-y divide-neutral-50">
                    {g.items.map((i) => {
                      const escondido = ocultos.has(clave(i));
                      return (
                        <li key={clave(i)}>
                          <label className="flex cursor-pointer items-center gap-3 py-2">
                            <input
                              type="checkbox"
                              checked={!escondido}
                              onChange={(e) => cambiar([i], !e.target.checked)}
                              className="size-4 shrink-0 rounded border-neutral-300"
                            />
                            <span className={`min-w-0 flex-1 text-sm ${escondido ? "text-neutral-400 line-through" : "text-neutral-800"}`}>
                              {i.nombre}
                              {i.esPromo && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 no-underline">PROMO</span>}
                              {i.sinStock && <span className="ml-1.5 text-[11px] text-neutral-400 no-underline">sin stock ahora</span>}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-neutral-400">{PESOS.format(i.precio)}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={pending}
          className="h-10 rounded-lg bg-tierra-700 px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar lo que se ofrece"}
        </button>
        {mensaje && <span className={`text-sm ${mensaje.ok ? "text-emerald-600" : "text-danger"}`}>{mensaje.texto}</span>}
      </div>
    </div>
  );
}
