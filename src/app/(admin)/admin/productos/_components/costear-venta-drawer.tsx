"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { costearDesdePrecioVenta } from "../actions";
import type { Database } from "@/types/database";

type Category = Database["public"]["Tables"]["categories"]["Row"];

export function CostearVentaDrawer({ categories }: { categories: Category[] }) {
  const [open,        setOpen]       = useState(false);
  const [pending,     startTransition] = useTransition();
  const [porcentaje,  setPorcentaje] = useState("");
  const [categoriaId, setCategoria]  = useState("");
  const [resultado,   setResultado]  = useState<number | null>(null);
  const [error,       setError]      = useState<string | null>(null);

  function handleClose() {
    setOpen(false);
    setPorcentaje("");
    setCategoria("");
    setResultado(null);
    setError(null);
  }

  function handleSubmit() {
    const pct = parseFloat(porcentaje);
    if (isNaN(pct) || pct <= 0 || pct > 100) { setError("Ingresá un porcentaje entre 1 y 100"); return; }

    const scope = categoriaId
      ? categories.find((c) => c.id === categoriaId)?.name ?? "la categoría"
      : "todos los productos con precio de venta cargado";
    if (!confirm(`¿Calcular el costo como ${pct}% del precio de venta para ${scope}? Esto pisa el costo actual.`)) return;

    setError(null);
    startTransition(async () => {
      try {
        const { actualizados } = await costearDesdePrecioVenta({
          porcentajePago: pct,
          categoria_id: categoriaId || null,
        });
        setResultado(actualizados);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
        </svg>
        Costear desde precio de venta
      </Button>

      {open && <><div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold font-display text-neutral-900">Costear desde precio de venta</h2>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {resultado !== null ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="size-14 rounded-full bg-selva-100 flex items-center justify-center">
              <svg className="size-7 text-selva-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-semibold text-neutral-900">Costos actualizados</p>
              <p className="text-sm text-neutral-500 mt-1">Se recalculó el costo de <span className="font-medium text-neutral-700">{resultado} productos</span>.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClose}>Cerrar</Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <p className="text-sm text-neutral-500">
                Para proveedores que facturan al precio de venta al público (ej. panificados), en vez de un costo fijo. Calcula:
                <span className="block mt-1.5 font-mono text-xs bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-neutral-600">
                  costo = precio de venta × % que pagan
                </span>
              </p>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  ¿Qué % del precio de venta pagan ustedes? *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="100"
                    placeholder="Ej: 60"
                    value={porcentaje}
                    onChange={(e) => setPorcentaje(e.target.value)}
                    className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-3 pr-8 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm font-medium">%</span>
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  Ej: si el proveedor factura a precio de venta y ustedes pagan un 40% menos, poné 60.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Categoría (opcional)</label>
                <select
                  value={categoriaId}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
                >
                  <option value="">Todos los productos</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {error && (
                <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-neutral-200 flex gap-3">
              <Button variant="ghost" size="sm" onClick={handleClose} className="flex-1">Cancelar</Button>
              <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">
                Aplicar
              </Button>
            </div>
          </>
        )}
      </aside></>}
    </>
  );
}
