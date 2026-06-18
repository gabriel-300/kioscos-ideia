"use client";

import { useState, useTransition, useMemo } from "react";
import { Button } from "@/components/ui";
import { crearMovimiento } from "@/app/(admin)/admin/movimientos/actions";
import type { Database } from "@/types/database";

type Product  = Database["public"]["Tables"]["products"]["Row"];
type Category = { id: string; name: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type PayMethod = "efectivo" | "mp" | "tarjeta" | "transferencia";

const PAY_METHODS: { id: PayMethod; label: string; short: string; icon: React.ReactNode }[] = [
  {
    id: "efectivo", label: "Efectivo", short: "Efec.",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
      </svg>
    ),
  },
  {
    id: "mp", label: "Mercado Pago", short: "MP",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3" />
      </svg>
    ),
  },
  {
    id: "tarjeta", label: "Tarjeta", short: "Tarj.",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
      </svg>
    ),
  },
  {
    id: "transferencia", label: "Transferencia", short: "Trans.",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
];

interface Props {
  open:        boolean;
  onClose:     () => void;
  sucursalId:  string;
  products:    Product[];
  stockMap?:   Record<string, number>;
  categories?: Category[];
}

export function VentaRapidaForm({ open, onClose, sucursalId, products, stockMap, categories }: Props) {
  const [cantidades,   setCantidades]  = useState<Record<string, number>>({});
  const [fecha,        setFecha]       = useState(() => new Date().toISOString().slice(0, 10));
  const [notas,        setNotas]       = useState("");
  const [catFilter,    setCatFilter]   = useState("all");
  const [search,       setSearch]      = useState("");
  const [activeMethods, setActiveMethods] = useState<Set<PayMethod>>(new Set<PayMethod>(["efectivo"]));
  const [montos,       setMontos]      = useState<Record<PayMethod, string>>({ efectivo: "", mp: "", tarjeta: "", transferencia: "" });
  const [pending, startTransition]     = useTransition();
  const [error,   setError]            = useState<string | null>(null);

  const catsConProductos = useMemo(() => {
    if (!categories?.length) return [];
    const ids = new Set(products.map((p) => p.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [categories, products]);

  const filtered = useMemo(() => {
    let list = catFilter === "all" ? products : products.filter((p) => p.category_id === catFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [products, catFilter, search]);

  const seleccionados = useMemo(
    () => Object.entries(cantidades).filter(([, qty]) => qty > 0),
    [cantidades]
  );

  const totalPrecio   = seleccionados.reduce((s, [id, qty]) => {
    const p = products.find((p) => p.id === id);
    return s + qty * (p?.precio_dist ?? 0);
  }, 0);
  const totalUnidades = seleccionados.reduce((s, [, qty]) => s + qty, 0);

  const totalRecibido = Array.from(activeMethods).reduce((s, m) => s + (parseFloat(montos[m]) || 0), 0);
  const montoEfectivo = parseFloat(montos.efectivo) || 0;
  const cambio = activeMethods.has("efectivo") && totalRecibido > 0 ? totalRecibido - totalPrecio : null;

  function set(id: string, value: number) {
    setCantidades((prev) => ({ ...prev, [id]: Math.max(0, value) }));
  }

  function toggleMethod(m: PayMethod) {
    setActiveMethods((prev) => {
      const next = new Set(prev);
      if (next.has(m)) {
        if (next.size > 1) next.delete(m);
      } else {
        next.add(m);
      }
      return next;
    });
  }

  function setMonto(m: PayMethod, val: string) {
    setMontos((prev) => ({ ...prev, [m]: val }));
  }

  function fillJusto(m: PayMethod) {
    const alreadyPaid = Array.from(activeMethods)
      .filter((x) => x !== m)
      .reduce((s, x) => s + (parseFloat(montos[x]) || 0), 0);
    const resta = Math.max(0, totalPrecio - alreadyPaid);
    setMontos((prev) => ({ ...prev, [m]: String(resta) }));
  }

  function handleClose() {
    setCantidades({});
    setFecha(new Date().toISOString().slice(0, 10));
    setNotas(""); setSearch(""); setError(null);
    setCatFilter("all");
    setActiveMethods(new Set<PayMethod>(["efectivo"]));
    setMontos({ efectivo: "", mp: "", tarjeta: "", transferencia: "" });
    onClose();
  }

  function buildNotasConMedios(): string | null {
    const partes: string[] = [];
    for (const m of activeMethods) {
      const val = parseFloat(montos[m]) || 0;
      if (val > 0) partes.push(`${PAY_METHODS.find((x) => x.id === m)!.short} ${AR.format(val)}`);
    }
    const medioStr = partes.length ? `[Cobro: ${partes.join(" + ")}]` : null;
    return [medioStr, notas || null].filter(Boolean).join(" — ") || null;
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await crearMovimiento({
          sucursal_id: sucursalId,
          fecha,
          tipo:  "venta",
          notas: buildNotasConMedios(),
          items: seleccionados.map(([product_id, cantidad]) => ({
            product_id,
            cantidad,
            precio_unitario: products.find((p) => p.id === product_id)?.precio_dist ?? null,
          })),
        });
        handleClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="relative z-10 bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-neutral-200 shrink-0">
          <h2 className="text-sm font-semibold font-display text-neutral-900 shrink-0">Registrar venta</h2>

          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar producto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded-lg border border-neutral-300 text-xs focus:outline-none focus:border-tierra-700"
            />
          </div>

          <div className="flex-1" />

          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="h-8 rounded-lg border border-neutral-300 px-2 text-xs focus:outline-none focus:border-tierra-700 w-32"
          />
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* BODY */}
        <div className="flex flex-1 min-h-0">

          {/* PANEL IZQUIERDO: productos */}
          <div className="flex flex-col flex-1 min-w-0 border-r border-neutral-200">

            {/* Tabs de categoría */}
            {catsConProductos.length > 0 && (
              <div className="flex gap-1.5 px-4 pt-3 pb-2 overflow-x-auto shrink-0" style={{ scrollbarWidth: "none" }}>
                <button
                  onClick={() => setCatFilter("all")}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === "all" ? "bg-tierra-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                >
                  Todos
                </button>
                {catsConProductos.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCatFilter(cat.id)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === cat.id ? "bg-tierra-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}

            {/* Grilla */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {filtered.length === 0 ? (
                <p className="text-sm text-center text-neutral-400 py-10">
                  {search ? `Sin resultados para "${search}"` : "Sin productos en esta categoría"}
                </p>
              ) : (
                <div className="grid grid-cols-3 xl:grid-cols-4 gap-2.5 pt-1">
                  {filtered.map((prod) => {
                    const qty      = cantidades[prod.id] ?? 0;
                    const stock    = stockMap?.[prod.id] ?? null;
                    const sinStock = stock !== null && stock <= 0;
                    const initials = prod.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
                    return (
                      <div
                        key={prod.id}
                        className={`rounded-xl border overflow-hidden select-none transition-all ${
                          qty > 0
                            ? "border-tierra-600 ring-1 ring-tierra-600 shadow-sm"
                            : sinStock
                            ? "border-neutral-100 opacity-40"
                            : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"
                        }`}
                      >
                        <div
                          onClick={() => set(prod.id, qty + 1)}
                          className={`relative aspect-square overflow-hidden ${sinStock ? "" : "cursor-pointer"}`}
                        >
                          {prod.cover_image_url ? (
                            <img src={prod.cover_image_url} alt={prod.name} loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-neutral-100">
                              <span className="text-xl font-bold text-neutral-300">{initials}</span>
                            </div>
                          )}

                          {qty > 0 && (
                            <div className="absolute top-1 right-1 min-w-[1.25rem] h-5 px-1 bg-tierra-700 text-white rounded-full flex items-center justify-center text-[11px] font-bold leading-none">
                              {qty}
                            </div>
                          )}

                          {sinStock && (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                              <span className="text-[10px] font-semibold text-neutral-400 bg-white px-2 py-0.5 rounded-full border border-neutral-200">sin stock</span>
                            </div>
                          )}
                        </div>

                        <div className="p-2">
                          <p
                            onClick={() => set(prod.id, qty + 1)}
                            className={`text-[11px] font-medium text-neutral-800 leading-tight line-clamp-2 min-h-[1.625rem] ${sinStock ? "" : "cursor-pointer"}`}
                          >
                            {prod.name}
                          </p>
                          <div className="flex items-center justify-between mt-0.5">
                            {prod.precio_dist
                              ? <p className="text-[11px] text-neutral-400 tabular-nums">{AR.format(prod.precio_dist)}</p>
                              : <span />}
                            {stock !== null && stock > 0 && (
                              <span className="text-[10px] text-neutral-300">{stock}u</span>
                            )}
                          </div>

                          {qty > 0 && (
                            <div className="mt-1.5 flex items-center justify-between">
                              <button
                                onClick={() => set(prod.id, qty - 1)}
                                className="size-6 rounded-full border border-neutral-300 bg-white flex items-center justify-center text-sm text-neutral-600 hover:bg-neutral-100 transition-colors"
                              >−</button>
                              <span className="text-sm font-bold text-neutral-900 w-6 text-center tabular-nums">{qty}</span>
                              <button
                                onClick={() => set(prod.id, qty + 1)}
                                className="size-6 rounded-full bg-tierra-700 text-white flex items-center justify-center text-sm hover:bg-tierra-800 transition-colors"
                              >+</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* PANEL DERECHO: carrito + cobro */}
          <div className="w-72 shrink-0 flex flex-col bg-neutral-50/50">

            {/* Lista del carrito */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
              {seleccionados.length === 0 ? (
                <p className="text-xs text-center text-neutral-300 pt-10">Tocá un producto para agregar</p>
              ) : (
                seleccionados.map(([id, qty]) => {
                  const p   = products.find((p) => p.id === id);
                  const sub = qty * (p?.precio_dist ?? 0);
                  return (
                    <div key={id} className="group flex items-center gap-2 py-2 border-b border-neutral-100">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-neutral-800 truncate leading-tight">{p?.name ?? "—"}</p>
                        {sub > 0 && <p className="text-[11px] text-neutral-400 tabular-nums mt-0.5">{AR.format(sub)}</p>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => set(id, qty - 1)}
                          className="size-5 rounded-full border border-neutral-200 flex items-center justify-center text-xs text-neutral-500 hover:bg-neutral-100 transition-colors"
                        >−</button>
                        <span className="text-xs font-bold w-5 text-center tabular-nums">{qty}</span>
                        <button
                          onClick={() => set(id, qty + 1)}
                          className="size-5 rounded-full border border-neutral-200 flex items-center justify-center text-xs text-neutral-500 hover:bg-neutral-100 transition-colors"
                        >+</button>
                      </div>
                      <button
                        onClick={() => set(id, 0)}
                        className="text-neutral-200 hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="Quitar"
                      >
                        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Total + cobro + botón */}
            <div className="border-t border-neutral-200 px-4 py-4 shrink-0 space-y-3 bg-white">

              {/* Total */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {totalUnidades > 0 ? `${totalUnidades} un.` : "Total"}
                </span>
                <span className="text-2xl font-bold font-display tabular-nums text-neutral-900">
                  {AR.format(totalPrecio)}
                </span>
              </div>

              {/* Medios de pago — toggle chips */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-2">Medio de pago</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {PAY_METHODS.map((m) => {
                    const active = activeMethods.has(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleMethod(m.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                          active
                            ? "bg-tierra-700 border-tierra-700 text-white shadow-sm"
                            : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                        }`}
                      >
                        {m.icon}
                        {m.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Inputs por método activo */}
              <div className="space-y-2">
                {PAY_METHODS.filter((m) => activeMethods.has(m.id)).map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500 w-14 shrink-0 truncate">{m.short}</span>
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400">$</span>
                      <input
                        type="number"
                        value={montos[m.id]}
                        onChange={(e) => setMonto(m.id, e.target.value)}
                        placeholder="0"
                        min={0}
                        className="w-full h-8 pl-5 pr-2 rounded-lg border border-neutral-200 text-xs font-semibold tabular-nums bg-white focus:outline-none focus:border-tierra-700 transition-colors"
                      />
                    </div>
                    <button
                      onClick={() => fillJusto(m.id)}
                      disabled={totalPrecio === 0}
                      className="shrink-0 h-8 px-2 rounded-lg border border-neutral-200 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 transition-colors"
                    >
                      Justo
                    </button>
                  </div>
                ))}
              </div>

              {/* Vuelto / Falta */}
              {cambio !== null && (
                <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${
                  cambio >= 0 ? "bg-selva-50 border border-selva-200" : "bg-danger/5 border border-danger/20"
                }`}>
                  <span className={`text-xs font-semibold ${cambio >= 0 ? "text-selva-700" : "text-danger"}`}>
                    {cambio >= 0 ? "Vuelto" : "Falta"}
                  </span>
                  <span className={`text-lg font-bold tabular-nums font-display ${cambio >= 0 ? "text-selva-700" : "text-danger"}`}>
                    {AR.format(Math.abs(cambio))}
                  </span>
                </div>
              )}

              {/* Notas */}
              <textarea
                placeholder="Notas…"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={1}
                className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs focus:outline-none focus:border-tierra-700 resize-none"
              />

              {error && <p className="text-xs text-danger">{error}</p>}

              <Button
                variant="primary"
                size="sm"
                loading={pending}
                disabled={seleccionados.length === 0}
                onClick={handleSubmit}
                className="w-full"
              >
                Registrar venta
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
