"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { vincularTransferenciaMercadoPago } from "../mercadopago-actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type PagoSinAsignar = { id: string; monto: number; recibidoEn: string };
export type VentaCandidata = { movimientoId: string; monto: number; fecha: string; hora: string };

function haceTiempo(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)  return "recién";
  if (min < 60) return `hace ${min} min`;
  const hs = Math.floor(min / 60);
  if (hs < 24)  return `hace ${hs} h`;
  return `hace ${Math.floor(hs / 24)} d`;
}

// El cliente transfirió al alias/CVU de Mercado Pago (en vez de escanear el
// QR, ej. porque falló la cámara) -- el webhook ya detectó el pago solo,
// pero no sabe a qué venta corresponde si hay más de una por el mismo
// monto. Es un vínculo manual de un clic, no automático -- ver el plan de
// esta feature (conciliación de pagos con Mercado Pago).
export function PagosTransferenciaSinConciliar({
  sucursalId, pagos, ventasCandidatas,
}: {
  sucursalId:       string;
  pagos:            PagoSinAsignar[];
  ventasCandidatas: VentaCandidata[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seleccion, setSeleccion] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  if (pagos.length === 0) return null;

  function handleVincular(pagoId: string) {
    const movimientoId = seleccion[pagoId];
    if (!movimientoId) { setError("Elegí a qué venta corresponde antes de vincular"); return; }
    setError(null);
    startTransition(async () => {
      const res = await vincularTransferenciaMercadoPago({ transferencia_id: pagoId, movimiento_id: movimientoId, sucursal_id: sucursalId });
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 mb-6">
      <p className="text-sm font-semibold text-sky-800 mb-1">
        {pagos.length === 1 ? "1 pago por transferencia sin conciliar" : `${pagos.length} pagos por transferencia sin conciliar`}
      </p>
      <p className="text-xs text-sky-700 mb-3">
        Mercado Pago detectó estas transferencias a la cuenta -- elegí a qué venta corresponde cada una.
      </p>
      <div className="space-y-2">
        {pagos.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white border border-sky-200 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-bold text-neutral-900 tabular-nums">{AR.format(p.monto)}</p>
              <p className="text-xs text-neutral-400">{haceTiempo(p.recibidoEn)}</p>
            </div>
            <select
              value={seleccion[p.id] ?? ""}
              onChange={(e) => setSeleccion((s) => ({ ...s, [p.id]: e.target.value }))}
              className="h-9 flex-1 min-w-[200px] rounded-lg border border-neutral-300 bg-white px-2 text-sm focus:outline-none focus:border-tierra-700"
            >
              <option value="">Elegir venta…</option>
              {ventasCandidatas.map((v) => (
                <option key={v.movimientoId} value={v.movimientoId}>
                  {AR.format(v.monto)} · {v.fecha} {v.hora}
                </option>
              ))}
            </select>
            <Button size="sm" variant="primary" loading={pending} onClick={() => handleVincular(p.id)}>
              Vincular
            </Button>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </div>
  );
}
