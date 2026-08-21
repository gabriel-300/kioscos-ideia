"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarRetiroSocio, registrarDevolucionSocio, eliminarRetiroSocio, eliminarDevolucionSocio } from "../actions";
import { Button } from "@/components/ui";
import { fechaHoyAR } from "@/lib/fecha";

type Tab = "retiro" | "devolucion";

export function DeleteMovSocioBtn({ id, sucursalId }: { id: string; sucursalId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Eliminar este retiro?")) return;
        startTransition(async () => { await eliminarRetiroSocio(id, sucursalId); router.refresh(); });
      }}
      className="ml-2 text-neutral-300 hover:text-red-400 transition-colors disabled:opacity-50"
    >
      ✕
    </button>
  );
}

export function DeletePagoSocioBtn({ id, sucursalId }: { id: string; sucursalId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Eliminar esta devolución?")) return;
        startTransition(async () => { await eliminarDevolucionSocio(id, sucursalId); router.refresh(); });
      }}
      className="ml-2 text-neutral-300 hover:text-red-400 transition-colors disabled:opacity-50"
    >
      ✕
    </button>
  );
}

export function RetiroSocioBtn({ sucursalId, socioId, nombre }: { sucursalId: string; socioId: string; nombre: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState<Tab>("retiro");

  // Retiro
  const [tipo, setTipo]     = useState<"retiro_temporal" | "retiro_ganancias">("retiro_temporal");
  const [monto, setMonto]   = useState("");

  // Devolución
  const [efectivo, setEfectivo]   = useState("");
  const [billetera, setBilletera] = useState("");

  const [fecha, setFecha] = useState(fechaHoyAR());
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setOpen(false); setError(null);
    setMonto(""); setEfectivo(""); setBilletera(""); setNotas("");
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      if (tab === "retiro") {
        const montoNum = parseFloat(monto.replace(",", ".")) || 0;
        if (montoNum <= 0) { setError("Ingresá un monto válido mayor a cero"); return; }
        const res = await registrarRetiroSocio({
          sucursal_id: sucursalId, socio_id: socioId, tipo, monto: montoNum, fecha, notas: notas.trim() || undefined,
        });
        if (res.error) { setError(res.error); return; }
      } else {
        const efectivoNum  = parseFloat(efectivo.replace(",", ".")) || 0;
        const billeteraNum = parseFloat(billetera.replace(",", ".")) || 0;
        if (efectivoNum + billeteraNum <= 0) { setError("Ingresá un monto válido mayor a cero"); return; }
        const res = await registrarDevolucionSocio({
          sucursal_id: sucursalId, socio_id: socioId, monto_efectivo: efectivoNum, monto_billetera: billeteraNum, fecha, notas: notas.trim() || undefined,
        });
        if (res.error) { setError(res.error); return; }
      }
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="px-4 py-2.5 border-t border-neutral-100">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-tierra-700 hover:text-tierra-900 transition-colors"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Retiro / devolución
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2.5 border-t border-neutral-100 bg-neutral-50">
      <div className="flex gap-1">
        <button
          onClick={() => setTab("retiro")}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${tab === "retiro" ? "bg-tierra-700 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
        >
          Retiro de {nombre}
        </button>
        <button
          onClick={() => setTab("devolucion")}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${tab === "devolucion" ? "bg-selva-700 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}
        >
          Devolución de {nombre}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        {tab === "retiro" ? (
          <>
            <div>
              <label className="block text-xs text-neutral-500 mb-0.5">Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as typeof tipo)}
                className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:border-tierra-700"
              >
                <option value="retiro_temporal">Temporal (a devolver)</option>
                <option value="retiro_ganancias">Reparto de ganancias</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-0.5">Monto</label>
              <input
                type="number" min="0" step="any" value={monto} onChange={(e) => setMonto(e.target.value)}
                placeholder="0" autoFocus
                className="h-8 w-28 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm tabular-nums focus:outline-none focus:border-tierra-700"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs text-neutral-500 mb-0.5">Efectivo</label>
              <input
                type="number" min="0" step="any" value={efectivo} onChange={(e) => setEfectivo(e.target.value)}
                placeholder="0" autoFocus
                className="h-8 w-28 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm tabular-nums focus:outline-none focus:border-selva-600"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-0.5">Billetera</label>
              <input
                type="number" min="0" step="any" value={billetera} onChange={(e) => setBilletera(e.target.value)}
                placeholder="0"
                className="h-8 w-28 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm tabular-nums focus:outline-none focus:border-selva-600"
              />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs text-neutral-500 mb-0.5">Fecha</label>
          <input
            type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="h-8 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <div className="flex-1 min-w-28">
          <label className="block text-xs text-neutral-500 mb-0.5">Notas</label>
          <input
            type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="Opcional"
            className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit}>Guardar</Button>
          <Button variant="ghost"   size="sm" onClick={reset}>Cancelar</Button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
