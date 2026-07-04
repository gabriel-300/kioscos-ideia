"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

type Sucursal = { id: string; nombre: string };
type Product  = { id: string; name: string; sku: string; category_id: string | null; unit_label: string; stock_minimo: number };
type Category = { id: string; name: string };

type Status = "ok" | "low" | "empty" | "negative" | "none";

function getStatus(qty: number, min: number, hasData: boolean): Status {
  if (!hasData) return "none";
  if (qty < 0)  return "negative";
  if (qty === 0) return "empty";
  if (min > 0 && qty <= min) return "low";
  if (qty <= 5 && min === 0) return "low";
  return "ok";
}

const STATUS_BADGE: Record<Exclude<Status, "none">, { label: string; cls: string }> = {
  ok:       { label: "En Stock",    cls: "bg-emerald-50 text-emerald-700" },
  low:      { label: "Bajo Stock",  cls: "bg-amber-50 text-amber-600" },
  empty:    { label: "Sin Stock",   cls: "bg-red-50 text-red-600" },
  negative: { label: "Negativo",    cls: "bg-red-100 text-red-700 font-bold" },
};

const STATUS_BAR: Record<Status, string> = {
  ok:       "bg-emerald-400",
  low:      "bg-amber-400",
  empty:    "bg-red-300",
  negative: "bg-red-500",
  none:     "bg-neutral-100",
};

function fmtQty(qty: number, unit: string) {
  if (unit === "kg") {
    return qty % 1 === 0
      ? `${qty} kg`
      : `${qty.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;
  }
  return `${qty} ${unit === "unidad" ? "u." : unit}`;
}

function barWidth(qty: number, min: number, status: Status): number {
  if (status === "none") return 0;
  if (status === "negative") return 100;
  if (status === "empty") return 0;
  if (min > 0) return Math.min(100, Math.round((qty / (min * 4)) * 100));
  return Math.min(100, Math.round((qty / 20) * 100));
}

/* ─── Filtros compartidos ─────────────────────────────────── */
function Filters({
  search, setSearch, catFilter, setCat, statusFilter, setStatus,
  hideEmpty, setHideEmpty, categories, count,
}: {
  search: string; setSearch: (v: string) => void;
  catFilter: string; setCat: (v: string) => void;
  statusFilter: string; setStatus: (v: string) => void;
  hideEmpty: boolean; setHideEmpty: (v: boolean) => void;
  categories: Category[];
  count: number;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input type="text" placeholder="Buscar SKU o nombre…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-8 pr-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-tierra-700 w-52" />
      </div>
      <select value={catFilter} onChange={(e) => setCat(e.target.value)}
        className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
        <option value="all">Todas las categorías</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select value={statusFilter} onChange={(e) => setStatus(e.target.value)}
        className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
        <option value="all">Todos los estados</option>
        <option value="ok">En Stock</option>
        <option value="low">Bajo Stock</option>
        <option value="empty">Sin Stock</option>
        <option value="alert">Con alerta</option>
      </select>
      <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none">
        <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)}
          className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20" />
        Solo con stock
      </label>
      <span className="text-sm text-neutral-400">{count} productos</span>
      <div className="flex items-center gap-3 ml-auto text-xs text-neutral-500">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-400" />En Stock</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-400" />Bajo Stock</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-300" />Sin Stock</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" />Negativo</span>
      </div>
    </div>
  );
}

/* ─── Vista plana (encargado/vendedor — una sucursal) ────── */
function FlatStockTable({ products, categories, flatStockMap, entradaMap, salidaMap }: {
  products:     Product[];
  categories:   Category[];
  flatStockMap: Record<string, number>;
  entradaMap:   Record<string, number>;
  salidaMap:    Record<string, number>;
}) {
  const [catFilter,    setCat]      = useState("all");
  const [statusFilter, setStatus]   = useState("all");
  const [search,       setSearch]   = useState("");
  const [hideEmpty,    setHideEmpty] = useState(false);

  const filtered = useMemo(() => products.filter((p) => {
    if (catFilter !== "all" && p.category_id !== catFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
    }
    const qty     = flatStockMap[p.id] ?? 0;
    const hasData = p.id in flatStockMap;
    if (hideEmpty && qty <= 0) return false;
    if (statusFilter !== "all") {
      const st = getStatus(qty, p.stock_minimo, hasData);
      if (statusFilter === "ok"    && st !== "ok")    return false;
      if (statusFilter === "low"   && st !== "low")   return false;
      if (statusFilter === "empty" && st !== "empty") return false;
      if (statusFilter === "alert" && !["low","empty","negative"].includes(st)) return false;
    }
    return true;
  }), [products, catFilter, search, hideEmpty, statusFilter, flatStockMap]);

  const negatives = useMemo(() =>
    products.filter((p) => (flatStockMap[p.id] ?? 0) < 0),
    [products, flatStockMap]
  );

  return (
    <div className="space-y-4">
      {negatives.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex gap-3">
          <svg className="size-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.95 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-red-600 mb-1">Stock negativo — revisá las entregas registradas</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {negatives.map((p) => (
                <span key={p.id} className="text-xs text-red-500/80">
                  {p.name}: {fmtQty(flatStockMap[p.id], p.unit_label)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <Filters search={search} setSearch={setSearch} catFilter={catFilter} setCat={setCat}
        statusFilter={statusFilter} setStatus={setStatus} hideEmpty={hideEmpty} setHideEmpty={setHideEmpty}
        categories={categories} count={filtered.length} />

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 w-28">Entradas</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 w-28">Salidas</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 w-32">Stock actual</th>
              <th className="px-4 py-3 w-36"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-neutral-400">Sin productos para mostrar.</td>
              </tr>
            ) : filtered.map((p) => {
              const qty     = flatStockMap[p.id] ?? 0;
              const hasData = p.id in flatStockMap;
              const ent     = entradaMap[p.id] ?? 0;
              const sal     = salidaMap[p.id]  ?? 0;
              const status  = getStatus(qty, p.stock_minimo, hasData);
              const badge   = status !== "none" ? STATUS_BADGE[status as Exclude<Status, "none">] : null;
              const bw      = barWidth(qty, p.stock_minimo, status);

              return (
                <tr key={p.id} className="hover:bg-neutral-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-800 leading-tight">{p.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-neutral-400 font-mono">{p.sku}</span>
                      <span className="text-[10px] text-neutral-300">·</span>
                      <span className="text-[10px] text-neutral-400 capitalize">{p.unit_label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {ent > 0
                      ? <span className="text-emerald-700 font-medium">+{fmtQty(ent, p.unit_label)}</span>
                      : <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {sal > 0
                      ? <span className="text-neutral-500">{fmtQty(sal, p.unit_label)}</span>
                      : <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!hasData ? (
                      <span className="text-neutral-200 text-xs">—</span>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <span className="font-bold text-neutral-900 tabular-nums">{fmtQty(qty, p.unit_label)}</span>
                        {p.stock_minimo > 0 && (
                          <span className="text-[10px] text-neutral-300">mín {fmtQty(p.stock_minimo, p.unit_label)}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {badge && (
                      <div className="flex flex-col gap-1.5">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls} whitespace-nowrap`}>
                          {badge.label}
                        </span>
                        <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                          <div className={`h-full rounded-full ${STATUS_BAR[status]}`} style={{ width: `${bw}%` }} />
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-400">Stock estimado desde el historial: entregas menos devoluciones y ventas.</p>
    </div>
  );
}

/* ─── Vista matriz (admin — todas las sucursales) ─────────── */
function StockCell({ qty, hasData, unit, min, sucursalId, productId }: {
  qty: number; hasData: boolean; unit: string; min: number; sucursalId: string; productId: string;
}) {
  const status = getStatus(qty, min, hasData);
  if (status === "none") return <span className="text-neutral-200 text-xs">—</span>;
  const badge = STATUS_BADGE[status as Exclude<Status, "none">];
  const bw    = barWidth(qty, min, status);
  const badgeEl = (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${badge.cls} ${status === "negative" ? "hover:ring-2 hover:ring-red-300 transition-shadow" : ""}`}
      title={status === "negative" ? "Ir a Ajuste de stock" : undefined}
    >
      {fmtQty(qty, unit)}
    </span>
  );
  return (
    <div className="flex flex-col items-center gap-1.5">
      {status === "negative" ? (
        <Link href={`/admin/sucursales/${sucursalId}?ajuste=${productId}`}>{badgeEl}</Link>
      ) : badgeEl}
      {min > 0 && <span className="text-[10px] text-neutral-300">mín {fmtQty(min, unit)}</span>}
      <div className="w-full h-1 rounded-full bg-neutral-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${STATUS_BAR[status]}`} style={{ width: `${bw}%` }} />
      </div>
    </div>
  );
}

function MatrixStockTable({ sucursales, products, categories, stockMap }: {
  sucursales: Sucursal[];
  products:   Product[];
  categories: Category[];
  stockMap:   Record<string, Record<string, number>>;
}) {
  const [catFilter,    setCat]      = useState("all");
  const [statusFilter, setStatus]   = useState("all");
  const [search,       setSearch]   = useState("");
  const [hideEmpty,    setHideEmpty] = useState(false);

  const filtered = useMemo(() => products.filter((p) => {
    if (catFilter !== "all" && p.category_id !== catFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
    }
    if (hideEmpty) {
      const hasStock = sucursales.some((s) => (stockMap[s.id]?.[p.id] ?? 0) > 0);
      if (!hasStock) return false;
    }
    if (statusFilter !== "all") {
      const worst = sucursales.reduce<Status>((acc, s) => {
        const qty = stockMap[s.id]?.[p.id];
        if (qty === undefined) return acc;
        const st = getStatus(qty, p.stock_minimo, true);
        const order: Status[] = ["negative", "empty", "low", "ok", "none"];
        return order.indexOf(st) < order.indexOf(acc) ? st : acc;
      }, "none");
      if (statusFilter === "ok"    && worst !== "ok")    return false;
      if (statusFilter === "low"   && worst !== "low")   return false;
      if (statusFilter === "empty" && worst !== "empty") return false;
      if (statusFilter === "alert" && !["low","empty","negative"].includes(worst)) return false;
    }
    return true;
  }), [products, catFilter, search, hideEmpty, statusFilter, sucursales, stockMap]);

  const alerts = useMemo(() => {
    const neg: { sucursalId: string; productId: string; nombre: string; product: string; qty: number; unit: string }[] = [];
    for (const s of sucursales) {
      for (const p of products) {
        const qty = stockMap[s.id]?.[p.id];
        if (qty !== undefined && qty < 0) neg.push({ sucursalId: s.id, productId: p.id, nombre: s.nombre, product: p.name, qty, unit: p.unit_label });
      }
    }
    return neg;
  }, [sucursales, products, stockMap]);

  if (sucursales.length === 0) return <p className="text-sm text-neutral-400">No hay sucursales activas.</p>;

  return (
    <div className="space-y-4">
      {alerts.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex gap-3">
          <svg className="size-4 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.95 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-red-600 mb-1">Stock negativo — revisá las entregas registradas</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {alerts.map((a, i) => (
                <Link
                  key={i}
                  href={`/admin/sucursales/${a.sucursalId}?ajuste=${a.productId}`}
                  className="text-xs text-red-500/80 hover:text-red-700 hover:underline"
                >
                  {a.product} en <span className="font-medium">{a.nombre}</span>: {fmtQty(a.qty, a.unit)} →
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <Filters search={search} setSearch={setSearch} catFilter={catFilter} setCat={setCat}
        statusFilter={statusFilter} setStatus={setStatus} hideEmpty={hideEmpty} setHideEmpty={setHideEmpty}
        categories={categories} count={filtered.length} />

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full" style={{ minWidth: `${240 + sucursales.length * 170}px` }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 min-w-60 border-r border-neutral-100">
                  Producto
                </th>
                {sucursales.map((s) => (
                  <th key={s.id} className="px-4 py-3 text-center text-xs font-semibold text-neutral-500 whitespace-nowrap min-w-44">
                    <Link href={`/admin/sucursales/${s.id}`} className="hover:text-tierra-700 transition-colors">{s.nombre}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={sucursales.length + 1} className="px-4 py-12 text-center text-sm text-neutral-400">Sin productos para mostrar.</td>
                </tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50/80 transition-colors group">
                  <td className="sticky left-0 z-10 bg-white group-hover:bg-neutral-50/80 px-4 py-3 border-r border-neutral-100 transition-colors">
                    <p className="font-medium text-neutral-800 leading-tight">{p.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-[11px] text-neutral-400 font-mono">{p.sku}</p>
                      <span className="text-[10px] text-neutral-300">·</span>
                      <span className="text-[10px] text-neutral-400 capitalize">{p.unit_label}</span>
                    </div>
                  </td>
                  {sucursales.map((s) => {
                    const qty     = stockMap[s.id]?.[p.id];
                    const hasData = qty !== undefined;
                    return (
                      <td key={s.id} className="px-4 py-3">
                        <StockCell qty={qty ?? 0} hasData={hasData} unit={p.unit_label} min={p.stock_minimo} sucursalId={s.id} productId={p.id} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-neutral-400">Stock estimado desde el historial: entregas menos devoluciones y ventas.</p>
    </div>
  );
}

/* ─── Export principal ────────────────────────────────────── */
export function StockTable(props:
  | {
      products: Product[]; categories: Category[];
      flatStockMap: Record<string, number>;
      entradaMap: Record<string, number>;
      salidaMap:  Record<string, number>;
      sucursales?: undefined; stockMap?: undefined; readOnly?: undefined;
    }
  | {
      sucursales: Sucursal[]; products: Product[]; categories: Category[];
      stockMap: Record<string, Record<string, number>>;
      readOnly?: boolean;
      flatStockMap?: undefined; entradaMap?: undefined; salidaMap?: undefined;
    }
) {
  if (props.flatStockMap !== undefined) {
    return (
      <FlatStockTable
        products={props.products}
        categories={props.categories}
        flatStockMap={props.flatStockMap}
        entradaMap={props.entradaMap}
        salidaMap={props.salidaMap}
      />
    );
  }
  return (
    <MatrixStockTable
      sucursales={props.sucursales}
      products={props.products}
      categories={props.categories}
      stockMap={props.stockMap}
    />
  );
}
