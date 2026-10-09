"use client";

import { useMemo, useState } from "react";

type Item = { id: string; nombre: string; precio: number };
type Categoria = { id: string; nombre: string; items: Item[] };
export type OpcionSucursal = { sucursalId: string; nombre: string; categorias: Categoria[]; omitidosPorKg: string[] };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const sinAcentos = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Arma el pedido de descarga de la comandera offline: nombre del evento, de qué sucursal salen los
// precios y qué productos lleva. Se envía por POST (formulario nativo) para que el navegador descargue el archivo.
export function EventoForm({ opciones }: { opciones: OpcionSucursal[] }) {
  const [sucursalId, setSucursalId] = useState(opciones[0]?.sucursalId ?? "");
  const [evento, setEvento] = useState("");
  const [busca, setBusca] = useState("");
  const opcion = opciones.find((o) => o.sucursalId === sucursalId) ?? opciones[0];

  const todos = useMemo(() => (opcion?.categorias ?? []).flatMap((c) => c.items.map((i) => i.id)), [opcion]);
  // Por defecto, todo tildado. Se guardan los DESTILDADOS por sucursal: cambiar de lista no arrastra selecciones ajenas.
  const [quitados, setQuitados] = useState<Record<string, Set<string>>>({});
  const fuera = quitados[opcion?.sucursalId ?? ""] ?? new Set<string>();
  const elegidos = todos.filter((id) => !fuera.has(id));

  // Stock del evento (opcional) por producto, como texto del input: vacío = sin límite, 0 = agotado.
  const [stocks, setStocks] = useState<Record<string, string>>({});
  const stockElegido: Record<string, number> = {};
  for (const id of elegidos) {
    const t = (stocks[id] ?? "").trim();
    if (/^\d{1,5}$/.test(t)) stockElegido[id] = Number(t);
  }
  const conStock = Object.keys(stockElegido).length;
  const stockInvalido = elegidos.some((id) => (stocks[id] ?? "").trim() !== "" && !(id in stockElegido));

  function cambiar(ids: string[], marcar: boolean) {
    const s = new Set(fuera);
    ids.forEach((id) => (marcar ? s.delete(id) : s.add(id)));
    setQuitados({ ...quitados, [opcion.sucursalId]: s });
  }

  if (!opcion) return <p className="text-sm text-neutral-600">No tenés sucursales con productos para vender.</p>;
  const q = sinAcentos(busca.trim());
  const listo = evento.trim().length > 0 && elegidos.length > 0 && !stockInvalido;

  return (
    <form method="post" action="/api/comandera-offline" className="space-y-5">
      <input type="hidden" name="sucursal_id" value={opcion.sucursalId} />
      <input type="hidden" name="ids" value={JSON.stringify(elegidos)} />
      <input type="hidden" name="stock" value={JSON.stringify(stockElegido)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-800">Nombre del evento</span>
          <input
            name="evento" value={evento} onChange={(e) => setEvento(e.target.value)} maxLength={40} required
            placeholder="Ej: Fiesta Villa Sarita"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <span className="block text-xs text-neutral-500">Sale en la pantalla y en el encabezado del ticket.</span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-800">Precios de</span>
          <select
            value={sucursalId} onChange={(e) => { setSucursalId(e.target.value); setBusca(""); }}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            {opciones.map((o) => <option key={o.sucursalId} value={o.sucursalId}>{o.nombre}</option>)}
          </select>
          <span className="block text-xs text-neutral-500">Solo se toma la lista de precios; el evento no usa la caja ni el stock de esa sucursal.</span>
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold text-neutral-900">
            Productos del evento <span className="font-normal text-neutral-500">({elegidos.length} de {todos.length})</span>
          </h2>
          <input
            type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…"
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          />
          <button type="button" onClick={() => cambiar(todos, true)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">Todos</button>
          <button type="button" onClick={() => cambiar(todos, false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">Ninguno</button>
        </div>

        {opcion.categorias.map((c) => {
          const visibles = c.items.filter((i) => !q || sinAcentos(i.nombre).includes(q));
          if (visibles.length === 0) return null;
          const idsCat = c.items.map((i) => i.id);
          const marcados = idsCat.filter((id) => !fuera.has(id)).length;
          return (
            <fieldset key={c.id} className="rounded-xl border border-neutral-200 bg-white">
              <legend className="sr-only">{c.nombre}</legend>
              <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2">
                <input
                  type="checkbox" checked={marcados === idsCat.length} aria-label={`Marcar toda la categoría ${c.nombre}`}
                  ref={(el) => { if (el) el.indeterminate = marcados > 0 && marcados < idsCat.length; }}
                  onChange={(e) => cambiar(idsCat, e.target.checked)}
                />
                <span className="text-sm font-semibold text-neutral-900">{c.nombre}</span>
                <span className="text-xs text-neutral-500">{marcados}/{idsCat.length}</span>
              </div>
              <ul className="divide-y divide-neutral-100">
                {visibles.map((i) => (
                  <li key={i.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm">
                      <input type="checkbox" checked={!fuera.has(i.id)} onChange={(e) => cambiar([i.id], e.target.checked)} />
                      <span className="flex-1 text-neutral-800">{i.nombre}</span>
                      <span className="tabular-nums text-neutral-600">{AR.format(i.precio)}</span>
                      <input
                        type="text" inputMode="numeric" placeholder="Stock" aria-label={`Stock de ${i.nombre} en el evento`}
                        value={stocks[i.id] ?? ""} disabled={fuera.has(i.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setStocks({ ...stocks, [i.id]: e.target.value })}
                        className={`w-20 rounded-md border px-2 py-1 text-right text-sm tabular-nums disabled:opacity-40 ${
                          (stocks[i.id] ?? "").trim() !== "" && !/^\d{1,5}$/.test((stocks[i.id] ?? "").trim()) ? "border-red-400" : "border-neutral-300"
                        }`}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}

        <p className="text-xs text-neutral-500">
          Stock: cuántas unidades llevás al evento. Vacío = sin límite; 0 = agotado. Si lo cargás, la comandera lo muestra
          debajo del producto, lo descuenta con cada venta y no deja vender más cuando llega a 0. Se maneja solo dentro del
          archivo: no toca el stock de ninguna sucursal. Si descargás de nuevo el mismo evento, cargá el stock inicial
          completo (se le restan las ventas ya hechas).
        </p>

        {opcion.omitidosPorKg.length > 0 && (
          <p className="text-xs text-amber-700">
            No incluye los que se venden por kg (la comandera cobra unidades a precio fijo): {opcion.omitidosPorKg.join(", ")}.
          </p>
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <p className="mr-auto text-sm text-neutral-600">
          {stockInvalido
            ? "El stock tiene que ser un número entero (o dejalo vacío)."
            : listo
              ? `${elegidos.length} productos · precios de hoy${conStock ? ` · ${conStock} con stock` : ""}`
              : evento.trim() ? "Elegí al menos un producto." : "Poné el nombre del evento."}
        </p>
        <button
          type="submit" disabled={!listo}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          Descargar comandera
        </button>
      </div>
    </form>
  );
}
