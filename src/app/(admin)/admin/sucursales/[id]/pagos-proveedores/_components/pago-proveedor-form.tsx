"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarPagoProveedor, eliminarPagoProveedor } from "../actions";
import { Button } from "@/components/ui";
import { fechaHoyAR } from "@/lib/fecha";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type Pago    = { id: string; monto: number; fecha: string; notas: string | null };
type Entrega = { id: string; fecha: string; total: number };

function DeletePagoBtn({ id, sucursalId }: { id: string; sucursalId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Eliminar este pago?")) return;
        startTransition(async () => {
          await eliminarPagoProveedor(id, sucursalId);
          router.refresh();
        });
      }}
      className="text-xs text-neutral-300 hover:text-red-400 transition-colors disabled:opacity-50"
    >
      ✕
    </button>
  );
}

export function PagoProveedorBtn({
  sucursalId,
  proveedorId,
  nombre,
  pagos,
  entregas,
}: {
  sucursalId:  string;
  proveedorId: string;
  nombre:      string;
  pagos:       Pago[];
  entregas:    Entrega[];
}) {
  const [open, setOpen]           = useState(false);
  const [efectivo, setEfectivo]   = useState("");
  const [billetera, setBilletera] = useState("");
  const [fecha, setFecha]         = useState(fechaHoyAR());
  const [movimientoId, setMovimientoId] = useState("");
  const [nota, setNota]           = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const totalPagado = pagos.reduce((s, p) => s + p.monto, 0);

  function handleSubmit() {
    const efectivoNum  = parseFloat(efectivo.replace(",", ".")) || 0;
    const billeteraNum = parseFloat(billetera.replace(",", ".")) || 0;
    if (efectivoNum + billeteraNum <= 0) {
      setError("Ingresá un monto válido mayor a cero");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await registrarPagoProveedor({
        sucursal_id:     sucursalId,
        proveedor_id:    proveedorId,
        monto_efectivo:  efectivoNum,
        monto_billetera: billeteraNum,
        fecha_pago:      fecha,
        movimiento_id:   movimientoId || null,
        nota:            nota.trim() || undefined,
      });
      if (res.error) { setError(res.error); return; }
      setOpen(false);
      setEfectivo("");
      setBilletera("");
      setMovimientoId("");
      setNota("");
      router.refresh();
    });
  }

  return (
    <div className="border-t border-selva-100 bg-selva-50">
      {pagos.length > 0 && (
        <div className="px-4 pt-3 pb-1 space-y-1">
          <p className="text-xs font-semibold text-selva-700 uppercase tracking-wider mb-1.5">
            Pagos registrados — {AR.format(totalPagado)}
          </p>
          {pagos.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-xs">
              <span className="text-neutral-500">
                {new Date(p.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                {p.notas && <span className="ml-1.5 text-neutral-400 italic">{p.notas}</span>}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums text-selva-700">{AR.format(p.monto)}</span>
                <DeletePagoBtn id={p.id} sucursalId={sucursalId} />
              </div>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <div className="px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-selva-700 uppercase tracking-wider">Registrar pago a {nombre}</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs text-neutral-500 mb-0.5">Efectivo</label>
              <input
                type="number" min="0" step="any" value={efectivo}
                onChange={(e) => setEfectivo(e.target.value)}
                placeholder="0" autoFocus
                className="h-8 w-28 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm tabular-nums focus:outline-none focus:border-selva-600"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-0.5">Billetera</label>
              <input
                type="number" min="0" step="any" value={billetera}
                onChange={(e) => setBilletera(e.target.value)}
                placeholder="0"
                className="h-8 w-28 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm tabular-nums focus:outline-none focus:border-selva-600"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-0.5">Fecha</label>
              <input
                type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                className="h-8 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-selva-600"
              />
            </div>
            {entregas.length > 0 && (
              <div>
                <label className="block text-xs text-neutral-500 mb-0.5">Entrega (opcional)</label>
                <select
                  value={movimientoId}
                  onChange={(e) => setMovimientoId(e.target.value)}
                  className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:border-selva-600"
                >
                  <option value="">Pago a cuenta (sin asociar)</option>
                  {entregas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {new Date(e.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })} — {AR.format(e.total)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex-1 min-w-28">
              <label className="block text-xs text-neutral-500 mb-0.5">Nota</label>
              <input
                type="text" value={nota} onChange={(e) => setNota(e.target.value)}
                placeholder="Opcional"
                className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-selva-600"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit}>Guardar</Button>
              <Button variant="ghost"   size="sm" onClick={() => { setOpen(false); setError(null); }}>Cancelar</Button>
            </div>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="px-4 py-2.5">
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-selva-700 hover:text-selva-900 transition-colors"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Registrar pago
          </button>
        </div>
      )}
    </div>
  );
}
