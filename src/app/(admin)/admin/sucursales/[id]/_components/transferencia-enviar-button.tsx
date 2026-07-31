"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Combobox } from "@/components/ui";
import { enviarTransferencia, type TransferenciaItemInput } from "../transferencia-actions";
import { fechaHoyAR } from "@/lib/fecha";

type Sucursal = { id: string; nombre: string };
type Product  = { id: string; name: string; unit_label: string };

interface LineItem { product_id: string; cantidad: string; }
const emptyLine = (): LineItem => ({ product_id: "", cantidad: "" });

export function TransferenciaEnviarButton({
  sucursalId, sucursales, products, stockMap,
}: {
  sucursalId: string;
  sucursales: Sucursal[];
  products:   Product[];
  stockMap:   Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
        Enviar transferencia
      </Button>
      {open && (
        <TransferenciaEnviarForm
          sucursalId={sucursalId}
          sucursales={sucursales}
          products={products}
          stockMap={stockMap}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function TransferenciaEnviarForm({
  sucursalId, sucursales, products, stockMap, onClose,
}: {
  sucursalId: string;
  sucursales: Sucursal[];
  products:   Product[];
  stockMap:   Record<string, number>;
  onClose:    () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [destino, setDestino] = useState("");
  const [fecha,   setFecha]   = useState(() => fechaHoyAR());
  const [notas,   setNotas]   = useState("");
  const [items,   setItems]   = useState<LineItem[]>([emptyLine()]);
  const [error,   setError]   = useState<string | null>(null);

  const destinoOptions = sucursales.filter((s) => s.id !== sucursalId);

  function addLine()              { setItems((p) => [...p, emptyLine()]); }
  function removeLine(i: number)  { setItems((p) => p.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, field: keyof LineItem, value: string) {
    setItems((p) => p.map((it, idx) => idx === i ? { ...it, [field]: value } : it));
  }

  function handleSubmit() {
    setError(null);
    if (!destino) { setError("Elegí la sucursal destino"); return; }
    const validas = items.filter((i) => i.product_id && parseFloat(i.cantidad) > 0);
    if (validas.length === 0) { setError("Agregá al menos un producto con cantidad"); return; }

    const payload: TransferenciaItemInput[] = validas.map((i) => ({
      product_id: i.product_id,
      cantidad:   parseFloat(i.cantidad),
    }));

    startTransition(async () => {
      const res = await enviarTransferencia({
        sucursal_origen_id:  sucursalId,
        sucursal_destino_id: destino,
        fecha,
        notas: notas.trim() || null,
        items: payload,
      });
      if (res.error) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold font-display text-neutral-900">Enviar transferencia</h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              El stock sale de acá al confirmar -- recién entra al destino cuando confirmen que lo recibieron.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors shrink-0">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-400 block mb-1.5">Sucursal destino *</label>
              <select
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              >
                <option value="" disabled>Elegir sucursal…</option>
                {destinoOptions.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-400 block mb-1.5">Fecha</label>
              <input
                type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Productos</p>
              <button onClick={addLine} className="text-xs text-tierra-700 hover:underline font-medium">+ Agregar línea</button>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => {
                const prod = products.find((p) => p.id === item.product_id);
                const stock = prod ? stockMap[prod.id] ?? 0 : null;
                return (
                  <div key={i} className="grid gap-2 items-end grid-cols-[1fr_110px_auto]">
                    <div>
                      {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Producto</p>}
                      <Combobox
                        options={products.map((p) => ({ value: p.id, label: p.name }))}
                        value={item.product_id}
                        onChange={(v) => updateLine(i, "product_id", v)}
                      />
                      {prod && (
                        <p className="text-[11px] text-neutral-400 mt-1">
                          Stock actual: {stock} {prod.unit_label === "kg" ? "kg" : "u."}
                        </p>
                      )}
                    </div>
                    <div>
                      {i === 0 && <p className="text-xs font-medium uppercase tracking-wide text-neutral-400 mb-1.5">Cant.</p>}
                      <input
                        type="number" min="0" step="0.01" placeholder="0"
                        value={item.cantidad}
                        onChange={(e) => updateLine(i, "cantidad", e.target.value)}
                        className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                      />
                    </div>
                    <button
                      onClick={() => removeLine(i)}
                      disabled={items.length === 1}
                      className="h-10 w-8 flex items-center justify-center text-neutral-300 hover:text-danger transition-colors disabled:opacity-30"
                      aria-label="Quitar línea"
                    >
                      <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-neutral-400 block mb-1.5">Notas</label>
            <textarea
              placeholder="Observaciones (opcional)…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 resize-none"
            />
          </div>

          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} type="button" className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">
            Enviar transferencia
          </Button>
        </div>
      </aside>
    </>
  );
}
