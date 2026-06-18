"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

type Sucursal = { id: string; nombre: string };
type Product  = { id: string; name: string; sku: string; category_id: string | null };
type Category = { id: string; name: string };

function cellStyle(qty: number): string {
  if (qty <= 0)  return "bg-danger/8 text-danger font-semibold";
  if (qty <= 5)  return "bg-warning-bg text-warning font-semibold";
  return "text-selva-700 font-medium";
}

export function StockTable({
  sucursales,
  products,
  categories,
  stockMap,
}: {
  sucursales: Sucursal[];
  products:   Product[];
  categories: Category[];
  stockMap:   Record<string, Record<string, number>>;
}) {
  const [catFilter, setCat]    = useState("all");
  const [hideEmpty, setHideEmpty] = useState(false);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (catFilter !== "all" && p.category_id !== catFilter) return false;
      if (hideEmpty) {
        const hasStock = sucursales.some((s) => (stockMap[s.id]?.[p.id] ?? 0) > 0);
        if (!hasStock) return false;
      }
      return true;
    });
  }, [products, catFilter, hideEmpty, sucursales, stockMap]);

  if (sucursales.length === 0) {
    return <p className="text-sm text-neutral-400">No hay sucursales activas.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={catFilter}
          onChange={(e) => setCat(e.target.value)}
          className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
        >
          <option value="all">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
            className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20"
          />
          Solo con stock
        </label>

        <span className="text-sm text-neutral-400">{filtered.length} productos</span>
      </div>

      {/* Leyenda */}
      <div className="flex items-center gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-selva-100 border border-selva-300" />
          Buen stock (&gt;5)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-warning-bg border border-warning/30" />
          Stock bajo (1–5)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-danger/10 border border-danger/20" />
          Sin stock (≤0)
        </span>
      </div>

      {/* Tabla scrollable */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse" style={{ minWidth: `${200 + sucursales.length * 140}px` }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 min-w-52 border-r border-neutral-200">
                  Producto
                </th>
                {sucursales.map((s) => (
                  <th key={s.id} className="px-3 py-3 text-center text-xs font-semibold text-neutral-500 whitespace-nowrap min-w-32">
                    <Link
                      href={`/admin/sucursales/${s.id}`}
                      className="hover:text-tierra-700 transition-colors"
                    >
                      {s.nombre}
                    </Link>
                  </th>
                ))}
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap min-w-20 border-l border-neutral-200">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={sucursales.length + 2} className="px-4 py-10 text-center text-sm text-neutral-400">
                    Sin productos para mostrar.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const totalProd = sucursales.reduce(
                    (sum, s) => sum + (stockMap[s.id]?.[p.id] ?? 0), 0
                  );
                  return (
                    <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                      <td className="sticky left-0 z-10 bg-white hover:bg-neutral-50 px-4 py-2.5 border-r border-neutral-100">
                        <p className="font-medium text-neutral-800 leading-tight">{p.name}</p>
                        <p className="text-xs text-neutral-400 mt-0.5">{p.sku}</p>
                      </td>
                      {sucursales.map((s) => {
                        const qty = stockMap[s.id]?.[p.id] ?? 0;
                        return (
                          <td
                            key={s.id}
                            className={`px-3 py-2.5 text-center tabular-nums text-sm ${
                              qty <= 0
                                ? "bg-danger/5"
                                : qty <= 5
                                ? "bg-warning-bg/40"
                                : "bg-selva-50/30"
                            }`}
                          >
                            <span className={cellStyle(qty)}>
                              {qty === 0 ? <span className="text-neutral-300 font-normal">—</span> : qty}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center tabular-nums font-bold text-neutral-700 border-l border-neutral-100">
                        {totalProd > 0 ? totalProd : <span className="text-neutral-300 font-normal">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Fila de totales por sucursal */}
            <tfoot>
              <tr className="border-t-2 border-neutral-200 bg-neutral-50">
                <td className="sticky left-0 z-10 bg-neutral-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 border-r border-neutral-200">
                  Total unidades
                </td>
                {sucursales.map((s) => {
                  const totalSuc = filtered.reduce(
                    (sum, p) => sum + (stockMap[s.id]?.[p.id] ?? 0), 0
                  );
                  return (
                    <td key={s.id} className="px-3 py-2.5 text-center tabular-nums font-bold text-neutral-700 text-sm">
                      {totalSuc > 0 ? totalSuc : <span className="text-neutral-300 font-normal">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-center tabular-nums font-bold text-tierra-700 border-l border-neutral-200 text-sm">
                  {filtered.reduce(
                    (sum, p) => sum + sucursales.reduce((s2, s) => s2 + (stockMap[s.id]?.[p.id] ?? 0), 0),
                    0
                  ) || <span className="text-neutral-300 font-normal">—</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-xs text-neutral-400">
        Stock calculado desde el historial: entregas menos devoluciones y ventas registradas por el encargado.
      </p>
    </div>
  );
}
