"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

type Sucursal = { id: string; nombre: string };
type Product  = { id: string; name: string; sku: string; category_id: string | null };
type Category = { id: string; name: string };

type Status = "ok" | "low" | "empty" | "negative" | "none";

function getStatus(qty: number, hasData: boolean): Status {
  if (!hasData) return "none";
  if (qty < 0)  return "negative";
  if (qty === 0) return "empty";
  if (qty <= 5)  return "low";
  return "ok";
}

const STATUS_DOT: Record<Status, string> = {
  ok:       "bg-selva-500",
  low:      "bg-amber-400",
  empty:    "bg-neutral-300",
  negative: "bg-danger",
  none:     "bg-transparent",
};

const STATUS_NUM: Record<Status, string> = {
  ok:       "text-selva-700 font-semibold",
  low:      "text-amber-600 font-semibold",
  empty:    "text-neutral-300 font-normal",
  negative: "text-danger font-bold",
  none:     "text-neutral-200 font-normal",
};

function StockCell({ qty, hasData }: { qty: number; hasData: boolean }) {
  const status = getStatus(qty, hasData);
  if (status === "none") {
    return <span className="text-neutral-200 text-xs">—</span>;
  }
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
      <span className={`tabular-nums text-sm ${STATUS_NUM[status]}`}>
        {status === "negative" ? (
          <span className="flex items-center gap-0.5">
            <svg className="size-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.95 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            {qty}
          </span>
        ) : status === "empty" ? (
          <span className="text-xs">0</span>
        ) : (
          qty
        )}
      </span>
    </div>
  );
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
  const [catFilter,  setCat]      = useState("all");
  const [hideEmpty,  setHideEmpty] = useState(false);

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

  const alerts = useMemo(() => {
    const neg: { nombre: string; product: string; qty: number }[] = [];
    for (const s of sucursales) {
      for (const p of products) {
        const qty = stockMap[s.id]?.[p.id];
        if (qty !== undefined && qty < 0) {
          neg.push({ nombre: s.nombre, product: p.name, qty });
        }
      }
    }
    return neg;
  }, [sucursales, products, stockMap]);

  if (sucursales.length === 0) {
    return <p className="text-sm text-neutral-400">No hay sucursales activas.</p>;
  }

  const grandTotal = filtered.reduce(
    (sum, p) => sum + sucursales.reduce((s2, s) => s2 + Math.max(0, stockMap[s.id]?.[p.id] ?? 0), 0),
    0
  );

  return (
    <div className="space-y-4">
      {/* Alertas stock negativo */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 flex gap-3">
          <svg className="size-4 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.95 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-danger mb-1">Stock negativo — revisá las entregas registradas</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {alerts.map((a, i) => (
                <span key={i} className="text-xs text-danger/80">
                  {a.product} en <span className="font-medium">{a.nombre}</span>: {a.qty} u.
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

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

        {/* Leyenda compacta */}
        <div className="flex items-center gap-3 ml-auto text-xs text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-selva-500" />Ok (&gt;5)</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" />Bajo (1–5)</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-neutral-300" />Sin stock</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-danger" />Negativo</span>
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table
            className="text-sm border-collapse w-full"
            style={{ minWidth: `${220 + sucursales.length * 150}px` }}
          >
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 min-w-56 border-r border-neutral-100">
                  Producto
                </th>
                {sucursales.map((s) => (
                  <th key={s.id} className="px-4 py-3 text-center text-xs font-semibold text-neutral-500 whitespace-nowrap min-w-36">
                    <Link href={`/admin/sucursales/${s.id}`} className="hover:text-tierra-700 transition-colors">
                      {s.nombre}
                    </Link>
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500 whitespace-nowrap min-w-20 border-l border-neutral-100">
                  Total
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={sucursales.length + 2} className="px-4 py-12 text-center text-sm text-neutral-400">
                    Sin productos para mostrar.
                  </td>
                </tr>
              ) : (
                filtered.map((p) => {
                  const rowTotal = sucursales.reduce(
                    (sum, s) => sum + (stockMap[s.id]?.[p.id] ?? 0), 0
                  );
                  const rowHasAny = sucursales.some(
                    (s) => stockMap[s.id]?.[p.id] !== undefined
                  );
                  return (
                    <tr key={p.id} className="hover:bg-neutral-50/80 transition-colors group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-neutral-50/80 px-4 py-3 border-r border-neutral-100 transition-colors">
                        <p className="font-medium text-neutral-800 leading-tight">{p.name}</p>
                        <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">{p.sku}</p>
                      </td>
                      {sucursales.map((s) => {
                        const qty     = stockMap[s.id]?.[p.id];
                        const hasData = qty !== undefined;
                        return (
                          <td key={s.id} className="px-4 py-3 text-center">
                            <StockCell qty={qty ?? 0} hasData={hasData} />
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center border-l border-neutral-100">
                        {rowHasAny ? (
                          <span className={`tabular-nums font-bold text-sm ${rowTotal > 0 ? "text-neutral-700" : rowTotal < 0 ? "text-danger" : "text-neutral-300"}`}>
                            {rowTotal > 0 ? rowTotal : rowTotal < 0 ? rowTotal : "0"}
                          </span>
                        ) : (
                          <span className="text-neutral-200 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-neutral-200 bg-neutral-50">
                <td className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 border-r border-neutral-100">
                  Total unidades
                </td>
                {sucursales.map((s) => {
                  const totalSuc = filtered.reduce(
                    (sum, p) => sum + (stockMap[s.id]?.[p.id] ?? 0), 0
                  );
                  const hasSuc = filtered.some((p) => stockMap[s.id]?.[p.id] !== undefined);
                  return (
                    <td key={s.id} className="px-4 py-3 text-center">
                      {hasSuc ? (
                        <span className={`tabular-nums font-bold text-sm ${totalSuc > 0 ? "text-neutral-700" : totalSuc < 0 ? "text-danger" : "text-neutral-400"}`}>
                          {totalSuc}
                        </span>
                      ) : (
                        <span className="text-neutral-300 text-xs">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-center border-l border-neutral-100">
                  <span className="tabular-nums font-bold text-sm text-tierra-700">
                    {grandTotal > 0 ? grandTotal : <span className="text-neutral-300 font-normal">—</span>}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-xs text-neutral-400">
        Stock estimado desde el historial: entregas menos devoluciones y ventas. Los ajustes no modifican el stock automáticamente.
      </p>
    </div>
  );
}
