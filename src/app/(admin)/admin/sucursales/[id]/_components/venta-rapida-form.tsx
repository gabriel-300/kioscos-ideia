"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui";
import { crearMovimiento } from "@/app/(admin)/admin/movimientos/actions";
import type { Database } from "@/types/database";

type Product  = Database["public"]["Tables"]["products"]["Row"];
type Category = { id: string; name: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

interface Props {
  open:        boolean;
  onClose:     () => void;
  sucursalId:  string;
  products:    Product[];
  stockMap?:   Record<string, number>;
  categories?: Category[];
}

type Step = "seleccion" | "pago";

export function VentaRapidaForm({ open, onClose, sucursalId, products, stockMap, categories }: Props) {
  const [step,       setStep]       = useState<Step>("seleccion");
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [fecha,      setFecha]      = useState(() => new Date().toISOString().slice(0, 10));
  const [notas,      setNotas]      = useState("");
  const [catFilter,  setCatFilter]  = useState("all");
  const [monto,      setMonto]      = useState("");
  const [pending, startTransition]  = useTransition();
  const [error,  setError]          = useState<string | null>(null);
  const montoRef = useRef<HTMLInputElement>(null);

  // Focus al campo de monto cuando abre el paso 2
  useEffect(() => {
    if (step === "pago") setTimeout(() => montoRef.current?.focus(), 80);
  }, [step]);

  const catsConProductos = useMemo(() => {
    if (!categories?.length) return [];
    const ids = new Set(products.map((p) => p.category_id));
    return categories.filter((c) => ids.has(c.id));
  }, [categories, products]);

  const filtered = useMemo(() => {
    if (catFilter === "all") return products;
    return products.filter((p) => p.category_id === catFilter);
  }, [products, catFilter]);

  const seleccionados = useMemo(
    () => Object.entries(cantidades).filter(([, qty]) => qty > 0),
    [cantidades]
  );

  const totalPrecio = seleccionados.reduce((s, [id, qty]) => {
    const p = products.find((p) => p.id === id);
    return s + qty * (p?.precio_dist ?? 0);
  }, 0);

  const totalUnidades = seleccionados.reduce((s, [, qty]) => s + qty, 0);

  const montoNum = parseFloat(monto.replace(/\./g, "").replace(",", ".")) || 0;
  const cambio   = montoNum > 0 ? montoNum - totalPrecio : null;

  function set(productId: string, value: number) {
    setCantidades((prev) => ({ ...prev, [productId]: Math.max(0, value) }));
  }

  function handleClose() {
    setCantidades({});
    setFecha(new Date().toISOString().slice(0, 10));
    setNotas(""); setMonto(""); setError(null);
    setCatFilter("all"); setStep("seleccion");
    onClose();
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await crearMovimiento({
          sucursal_id: sucursalId,
          fecha,
          tipo:  "venta",
          notas: notas || null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="relative z-10 bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── PASO 1: SELECCIÓN ── */}
        {step === "seleccion" && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
              <div>
                <h2 className="text-base font-semibold font-display text-neutral-900">Registrar venta</h2>
                {totalUnidades > 0 && (
                  <p className="text-xs text-tierra-700 font-medium mt-0.5">{totalUnidades} unidades · {AR.format(totalPrecio)}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-xs focus:outline-none focus:border-tierra-700 w-32"
                />
                <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
                  <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs de categoría */}
            {catsConProductos.length > 0 && (
              <div className="px-5 pt-3 shrink-0">
                <div className="flex flex-wrap gap-1.5 pb-2">
                  <button
                    onClick={() => setCatFilter("all")}
                    className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === "all" ? "bg-tierra-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                  >
                    Todos
                  </button>
                  {catsConProductos.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCatFilter(cat.id)}
                      className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${catFilter === cat.id ? "bg-tierra-700 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Grilla */}
            <div className="flex-1 overflow-y-auto px-5 pb-3">
              {filtered.length === 0 ? (
                <p className="text-sm text-center text-neutral-400 py-10">Sin productos en esta categoría</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {filtered.map((prod) => {
                    const qty      = cantidades[prod.id] ?? 0;
                    const stock    = stockMap?.[prod.id] ?? null;
                    const sinStock = stock !== null && stock <= 0;
                    return (
                      <div
                        key={prod.id}
                        onClick={() => set(prod.id, qty + 1)}
                        className={`rounded-xl border p-3 cursor-pointer select-none transition-all ${
                          qty > 0
                            ? "border-tierra-600 bg-tierra-50 shadow-sm"
                            : sinStock
                            ? "border-neutral-100 bg-neutral-50 opacity-50"
                            : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"
                        }`}
                      >
                        <p className="text-sm font-medium text-neutral-800 leading-tight line-clamp-2">{prod.name}</p>
                        <div className="flex items-center justify-between mt-1 min-h-[1.25rem]">
                          {prod.precio_dist
                            ? <p className="text-xs text-neutral-400">{AR.format(prod.precio_dist)}</p>
                            : <span />}
                          {stock !== null && stock > 0 && <span className="text-xs text-neutral-300 font-medium">{stock}u</span>}
                          {sinStock && <span className="text-[10px] font-medium text-danger/70 bg-danger/10 px-1.5 py-0.5 rounded-full">sin stock</span>}
                        </div>
                        {qty > 0 && (
                          <div className="mt-2.5 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => set(prod.id, qty - 1)} className="size-7 rounded-full border border-neutral-300 bg-white flex items-center justify-center text-base text-neutral-600 hover:bg-neutral-100 transition-colors font-medium">−</button>
                            <input
                              type="number" value={qty} min={0}
                              onChange={(e) => set(prod.id, parseInt(e.target.value) || 0)}
                              className="w-10 text-center text-base font-bold text-neutral-900 bg-transparent focus:outline-none"
                            />
                            <button onClick={() => set(prod.id, qty + 1)} className="size-7 rounded-full bg-tierra-700 text-white flex items-center justify-center text-base hover:bg-tierra-800 transition-colors font-medium">+</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chips resumen */}
            {seleccionados.length > 0 && (
              <div className="border-t border-neutral-100 bg-neutral-50 px-5 py-2 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                  {seleccionados.map(([id, qty]) => {
                    const p = products.find((p) => p.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1 text-xs bg-tierra-100 text-tierra-800 px-2 py-1 rounded-full font-medium">
                        {p?.name ?? id} × {qty}
                        <button onClick={() => set(id, 0)} className="ml-0.5 text-tierra-500 hover:text-tierra-700">×</button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Footer paso 1 */}
            <div className="border-t border-neutral-200 px-6 py-4 shrink-0 flex items-center justify-between gap-4">
              <p className="text-sm text-neutral-400">
                {seleccionados.length === 0 ? "Tocá un producto para agregar" : `${totalUnidades} unidades · ${AR.format(totalPrecio)}`}
              </p>
              <Button
                variant="primary" size="sm"
                onClick={() => setStep("pago")}
              >
                Continuar al cobro →
              </Button>
            </div>
          </>
        )}

        {/* ── PASO 2: COBRO ── */}
        {step === "pago" && (
          <>
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
              <button
                onClick={() => setStep("seleccion")}
                className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
              >
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                Volver
              </button>
              <h2 className="text-base font-semibold font-display text-neutral-900">Cobro</h2>
              <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Resumen de items */}
              <div className="rounded-xl border border-neutral-200 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-neutral-100">
                    {seleccionados.map(([id, qty]) => {
                      const p = products.find((p) => p.id === id);
                      const sub = qty * (p?.precio_dist ?? 0);
                      return (
                        <tr key={id} className="px-4">
                          <td className="px-4 py-2.5 text-neutral-700">{p?.name ?? "—"}</td>
                          <td className="px-4 py-2.5 text-neutral-400 text-right tabular-nums">× {qty}</td>
                          <td className="px-4 py-2.5 font-medium text-neutral-800 text-right tabular-nums">
                            {sub > 0 ? AR.format(sub) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Total */}
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">Total</p>
                <p className="text-2xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalPrecio)}</p>
              </div>

              {/* Monto recibido */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">
                  Monto recibido
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-neutral-400">$</span>
                  <input
                    ref={montoRef}
                    type="number"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full h-14 pl-8 pr-4 rounded-xl border-2 border-neutral-300 text-xl font-bold tabular-nums text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors"
                  />
                </div>
              </div>

              {/* Cambio */}
              {cambio !== null && (
                <div className={`rounded-xl p-4 flex items-center justify-between ${cambio >= 0 ? "bg-selva-50 border border-selva-200" : "bg-danger/5 border border-danger/20"}`}>
                  <p className={`text-sm font-semibold ${cambio >= 0 ? "text-selva-700" : "text-danger"}`}>
                    {cambio >= 0 ? "Cambio a entregar" : "Falta cobrar"}
                  </p>
                  <p className={`text-2xl font-bold font-display tabular-nums ${cambio >= 0 ? "text-selva-700" : "text-danger"}`}>
                    {AR.format(Math.abs(cambio))}
                  </p>
                </div>
              )}

              {/* Notas */}
              <textarea
                placeholder="Notas opcionales…"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 resize-none"
              />
            </div>

            {/* Footer paso 2 */}
            <div className="border-t border-neutral-200 px-6 py-4 shrink-0">
              {error && <p className="text-xs text-danger mb-3">{error}</p>}
              <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="w-full">
                Registrar venta
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
