"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { ajustarPrecios } from "../actions";
import type { Database } from "@/types/database";

type Category = Database["public"]["Tables"]["categories"]["Row"];

const CAMPOS = [
  { key: "precio_dist", label: "Precio a kioscos" },
  { key: "costo",       label: "Costo" },
] as const;

type Campo = typeof CAMPOS[number]["key"];

export function AjustePreciosDrawer({ categories }: { categories: Category[] }) {
  const [open,        setOpen]       = useState(false);
  const [pending,     startTransition] = useTransition();
  const [porcentaje,  setPorcentaje] = useState("");
  const [campos,      setCampos]     = useState<Campo[]>(["precio_dist"]);
  const [categoriaId, setCategoria]  = useState("");
  const [resultado,   setResultado]  = useState<number | null>(null);
  const [error,       setError]      = useState<string | null>(null);

  function toggleCampo(campo: Campo) {
    setCampos((prev) =>
      prev.includes(campo) ? prev.filter((c) => c !== campo) : [...prev, campo]
    );
  }

  function handleClose() {
    setOpen(false);
    setPorcentaje("");
    setCampos(["precio_dist"]);
    setCategoria("");
    setResultado(null);
    setError(null);
  }

  function handleSubmit() {
    const pct = parseFloat(porcentaje);
    if (isNaN(pct) || pct === 0) { setError("Ingresá un porcentaje válido distinto de 0"); return; }
    if (campos.length === 0)      { setError("Seleccioná al menos un campo de precio"); return; }

    const label = pct > 0 ? `+${pct}%` : `${pct}%`;
    const scope = categoriaId
      ? categories.find((c) => c.id === categoriaId)?.name ?? "la categoría"
      : "todos los productos";
    if (!confirm(`¿Aplicar ${label} a ${scope}?`)) return;

    setError(null);
    startTransition(async () => {
      try {
        const { actualizados } = await ajustarPrecios({
          porcentaje: pct,
          campos,
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
        </svg>
        Ajustar precios
      </Button>

      {open && <><div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={handleClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold font-display text-neutral-900">Ajustar precios</h2>
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
              <p className="font-semibold text-neutral-900">Precios actualizados</p>
              <p className="text-sm text-neutral-500 mt-1">Se actualizaron <span className="font-medium text-neutral-700">{resultado} productos</span>.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleClose}>Cerrar</Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Porcentaje */}
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">
                  Porcentaje de ajuste *
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    placeholder="Ej: 15 para subir 15%"
                    value={porcentaje}
                    onChange={(e) => setPorcentaje(e.target.value)}
                    className="h-10 w-full rounded-lg border border-neutral-300 bg-white pl-3 pr-8 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 tabular-nums"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 text-sm font-medium">%</span>
                </div>
                <p className="mt-1 text-xs text-neutral-400">
                  Positivo para aumentar, negativo para bajar. Los valores se redondean al peso.
                </p>
              </div>

              {/* Campos */}
              <div>
                <p className="text-sm font-medium text-neutral-700 mb-2">Campos a actualizar *</p>
                <div className="space-y-2">
                  {CAMPOS.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={campos.includes(key)}
                        onChange={() => toggleCampo(key)}
                        className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20"
                      />
                      <span className="text-sm text-neutral-700 group-hover:text-neutral-900">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Categoría */}
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
                Aplicar ajuste
              </Button>
            </div>
          </>
        )}
      </aside></>}
    </>
  );
}
