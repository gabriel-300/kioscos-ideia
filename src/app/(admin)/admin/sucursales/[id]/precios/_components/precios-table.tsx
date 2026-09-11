"use client";

import { useMemo, useState, useTransition } from "react";
import { actualizarPrecioProducto } from "../actions";
import { friendlyError } from "@/lib/utils";

export type ProductoPrecio = {
  id:         string;
  nombre:     string;
  sku:        string;
  categoria:  string | null;
  unitLabel:  string;
  precioDist: number | null;
  costo:      number | null;
};

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function PreciosTable({ sucursalId, productos }: { sucursalId: string; productos: ProductoPrecio[] }) {
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guardadoId, setGuardadoId] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    if (!search.trim()) return productos;
    const q = search.trim().toLowerCase();
    return productos.filter((p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [productos, search]);

  const sinPrecio = productos.filter((p) => p.precioDist == null).length;

  function guardar(p: ProductoPrecio, precioDist: string, costo: string) {
    setError(null);
    const precioNum = parseFloat(precioDist);
    const costoNum  = parseFloat(costo);
    if (isNaN(precioNum) || precioNum <= 0) { setError(`${p.nombre}: el precio de venta tiene que ser mayor a 0`); return; }
    if (isNaN(costoNum) || costoNum < 0) { setError(`${p.nombre}: el costo no puede ser negativo`); return; }
    if (precioNum === p.precioDist && costoNum === p.costo) return; // sin cambios, no llamar al servidor

    startTransition(async () => {
      const res = await actualizarPrecioProducto({ product_id: p.id, sucursal_id: sucursalId, precio_dist: precioNum, costo: costoNum });
      if (res.error) { setError(res.error); return; }
      setGuardadoId(p.id);
      setTimeout(() => setGuardadoId((prev) => (prev === p.id ? null : prev)), 1500);
    });
  }

  return (
    <div className="space-y-4">
      {sinPrecio > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {sinPrecio === 1 ? "1 producto sin precio cargado todavía" : `${sinPrecio} productos sin precio cargado todavía`} — no se pueden vender hasta que les pongas un precio.
        </div>
      )}

      <input
        type="text" placeholder="Buscar producto o SKU…" value={search} onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-xs h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
      />

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Categoría</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Costo</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Precio de venta</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Margen</th>
                <th className="px-4 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtrados.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-400">Sin resultados</td></tr>
              ) : filtrados.map((p) => (
                <FilaProducto key={p.id} producto={p} pending={pending} guardado={guardadoId === p.id} onGuardar={guardar} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilaProducto({
  producto, pending, guardado, onGuardar,
}: {
  producto: ProductoPrecio; pending: boolean; guardado: boolean;
  onGuardar: (p: ProductoPrecio, precioDist: string, costo: string) => void;
}) {
  const [precioDist, setPrecioDist] = useState(producto.precioDist != null ? String(producto.precioDist) : "");
  const [costo,      setCosto]      = useState(producto.costo != null ? String(producto.costo) : "");

  const margen = (() => {
    const pv = parseFloat(precioDist);
    const c  = parseFloat(costo);
    if (isNaN(pv) || pv <= 0 || isNaN(c)) return null;
    return ((pv - c) / pv) * 100;
  })();

  function blur() {
    onGuardar(producto, precioDist, costo);
  }

  return (
    <tr className="hover:bg-neutral-50/60 transition-colors">
      <td className="px-4 py-2.5">
        <p className="font-medium text-neutral-800 leading-tight">{producto.nombre}</p>
        <span className="text-[11px] text-neutral-400 font-mono">{producto.sku}</span>
      </td>
      <td className="px-4 py-2.5 text-neutral-500">{producto.categoria ?? "—"}</td>
      <td className="px-4 py-2.5 text-right">
        <input
          type="number" min={0} step="any" value={costo}
          onChange={(e) => setCosto(e.target.value)}
          onBlur={blur}
          disabled={pending}
          className="w-24 h-8 px-2 rounded border border-neutral-300 text-right text-sm tabular-nums focus:outline-none focus:border-tierra-700"
        />
      </td>
      <td className="px-4 py-2.5 text-right">
        <input
          type="number" min={0} step="any" value={precioDist}
          onChange={(e) => setPrecioDist(e.target.value)}
          onBlur={blur}
          disabled={pending}
          placeholder="Sin precio"
          className={`w-24 h-8 px-2 rounded border text-right text-sm tabular-nums focus:outline-none focus:border-tierra-700 ${producto.precioDist == null ? "border-amber-300 bg-amber-50" : "border-neutral-300"}`}
        />
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
        {margen != null ? `${margen.toFixed(0)}%` : "—"}
      </td>
      <td className="px-4 py-2.5 text-center">
        {guardado && (
          <svg className="size-4 text-selva-600 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </td>
    </tr>
  );
}
