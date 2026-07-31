"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { confirmarTransferencia, type RecepcionItemInput } from "../transferencia-actions";
import { fechaHoyAR } from "@/lib/fecha";

const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

export type PendienteItem = {
  id:               string;
  product_id:       string;
  product_name:     string;
  unit_label:       string | null;
  cantidad_enviada: number;
};

export type Pendiente = {
  id:             string;
  origenNombre:   string;
  fecha:          string;
  notasEnvio:     string | null;
  items:          PendienteItem[];
};

// Cualquiera del staff de la sucursal destino puede confirmar (vendedor
// incluido) -- es quien físicamente abre la caja que llegó.
export function TransferenciasPendientes({ transferencias }: { transferencias: Pendiente[] }) {
  const [confirmando, setConfirmando] = useState<Pendiente | null>(null);

  if (transferencias.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-6">
      <p className="text-sm font-semibold text-amber-800 mb-3">
        {transferencias.length === 1 ? "1 transferencia pendiente de recibir" : `${transferencias.length} transferencias pendientes de recibir`}
      </p>
      <div className="space-y-2">
        {transferencias.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg bg-white border border-amber-200 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-800">Desde {t.origenNombre}</p>
              <p className="text-xs text-neutral-400">
                {new Date(t.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                {" · "}{t.items.length} {t.items.length === 1 ? "producto" : "productos"}
              </p>
            </div>
            <Button size="sm" variant="primary" onClick={() => setConfirmando(t)} className="shrink-0">
              Confirmar recepción
            </Button>
          </div>
        ))}
      </div>

      {confirmando && (
        <ConfirmarRecepcionModal transferencia={confirmando} onClose={() => setConfirmando(null)} />
      )}
    </div>
  );
}

function ConfirmarRecepcionModal({ transferencia, onClose }: { transferencia: Pendiente; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cantidades, setCantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(transferencia.items.map((i) => [i.id, String(i.cantidad_enviada)]))
  );
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    setError(null);
    const items: RecepcionItemInput[] = transferencia.items.map((i) => ({
      transferencia_item_id: i.id,
      cantidad_recibida:     parseFloat(cantidades[i.id]) || 0,
    }));
    startTransition(async () => {
      const res = await confirmarTransferencia({
        transferencia_id: transferencia.id,
        fecha: fechaHoyAR(),
        notas: notas.trim() || null,
        items,
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
            <h2 className="text-base font-semibold font-display text-neutral-900">Confirmar recepción</h2>
            <p className="text-xs text-neutral-400 mt-0.5">Desde {transferencia.origenNombre}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors shrink-0">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {transferencia.notasEnvio && (
            <p className="text-xs text-neutral-500 italic bg-neutral-50 rounded-lg px-3 py-2">"{transferencia.notasEnvio}"</p>
          )}
          <p className="text-xs text-neutral-400">
            Contá lo que realmente llegó -- si algo se rompió o faltó en el camino, corregí la cantidad acá.
          </p>
          <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100">
            {transferencia.items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-800 truncate">{i.product_name}</p>
                  <p className="text-xs text-neutral-400">
                    Enviado: {NUM.format(i.cantidad_enviada)} {i.unit_label === "kg" ? "kg" : "u."}
                  </p>
                </div>
                <input
                  type="number" min="0" step="0.01"
                  value={cantidades[i.id] ?? ""}
                  onChange={(e) => setCantidades((c) => ({ ...c, [i.id]: e.target.value }))}
                  className="h-10 w-24 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-right tabular-nums focus:outline-none focus:border-tierra-700"
                />
              </div>
            ))}
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-neutral-400 block mb-1.5">Notas de recepción</label>
            <textarea
              placeholder="Ej: llegó una unidad rota (opcional)…"
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
            Confirmar recepción
          </Button>
        </div>
      </aside>
    </>
  );
}
