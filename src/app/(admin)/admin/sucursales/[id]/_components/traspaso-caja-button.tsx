"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { registrarTraspaso } from "../traspaso-actions";
import { friendlyError } from "@/lib/utils";
import type { MovimientoCierre } from "./cierre-caja-button";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

interface Props {
  sucursalId:     string;
  sucursalNombre: string;
  aperturaActual: { fondo_inicial: number; created_at: string };
  tenedorActualNombre?: string | null;
  movimientos:    MovimientoCierre[];
  retiros?:        { monto: number; created_at: string }[];
  pagosProveedor?: { monto_efectivo: number; created_at: string }[];
  pagosCtc?:       { monto_efectivo: number; created_at: string }[];
  retirosSocio?:   { monto: number; created_at: string }[];
  pagosSocio?:     { monto_efectivo: number; created_at: string }[];
}

// Checkpoint liviano de custodia: NO cierra la caja (a diferencia de
// CierreCajaButton) -- solo deja registro de que alguien la recibió, con
// cuánto contó y si hubo diferencia. El cálculo de acá es solo un preview
// client-side (mismos arrays ya cargados que usa CierreCajaModal, mismo
// criterio de filtrado por turno); la RPC registrar_traspaso_caja
// (migración 083) recalcula todo esto de nuevo server-side antes de guardar
// -- nunca se confía en este número para la decisión real.
export function TraspasoCajaButton({
  sucursalId, sucursalNombre, aperturaActual, tenedorActualNombre,
  movimientos, retiros = [], pagosProveedor = [], pagosCtc = [],
  retirosSocio = [], pagosSocio = [],
}: Props) {
  const [open, setOpen]     = useState(false);
  const [real, setReal]     = useState("");
  const [notas, setNotas]   = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const realRef = useRef<HTMLInputElement>(null);

  function filtradoPorTurno<T extends { created_at: string }>(rows: T[]): T[] {
    return rows.filter((r) => r.created_at >= aperturaActual.created_at);
  }
  const ventasEfectivoTurno = movimientos
    .filter((m) => m.tipo === "venta" && !m.anulado_en && m.created_at >= aperturaActual.created_at)
    .filter((m) => m.canal !== "cuenta_corriente" && m.canal !== "pedido_ya_plataforma")
    .reduce((s, m) => s + (m.pago_efectivo ?? 0), 0);
  const retirosTurno        = filtradoPorTurno(retiros).reduce((s, r) => s + r.monto, 0);
  const retirosSocioTurno   = filtradoPorTurno(retirosSocio).reduce((s, r) => s + r.monto, 0);
  const pagosProveedorTurno = filtradoPorTurno(pagosProveedor).reduce((s, p) => s + p.monto_efectivo, 0);
  const pagosCtcTurno       = filtradoPorTurno(pagosCtc).reduce((s, p) => s + p.monto_efectivo, 0);
  const pagosSocioTurno     = filtradoPorTurno(pagosSocio).reduce((s, p) => s + p.monto_efectivo, 0);

  const efectivoEsperado = aperturaActual.fondo_inicial
    + ventasEfectivoTurno
    - retirosTurno
    - retirosSocioTurno
    - pagosProveedorTurno
    + pagosCtcTurno
    + pagosSocioTurno;

  useEffect(() => {
    if (open) setTimeout(() => realRef.current?.focus(), 80);
  }, [open]);

  function handleClose() {
    setReal(""); setNotas(""); setError(null);
    setOpen(false);
  }

  const realNum         = parseFloat(real) || 0;
  const hayMonto         = real.trim() !== "";
  const diferencia       = hayMonto ? realNum - efectivoEsperado : null;
  const notaObligatoria  = diferencia !== null && diferencia !== 0 && !notas.trim();

  function handleSubmit() {
    if (!hayMonto)       { setError("Contá el efectivo del cajón"); return; }
    if (notaObligatoria) { setError("Contá qué pasó con la diferencia antes de recibir la caja"); return; }
    setError(null);
    startTransition(async () => {
      try {
        const result = await registrarTraspaso({
          sucursal_id:   sucursalId,
          efectivo_real: realNum,
          notas:         notas || null,
        });
        if (result.error) { setError(result.error); return; }
        handleClose();
      } catch (e) {
        setError(friendlyError(e));
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border border-neutral-300 bg-white text-neutral-600 text-sm font-medium hover:bg-neutral-50 hover:border-neutral-400 transition-colors"
      >
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
        Traspaso de turno
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-0.5">Caja</p>
                <h2 className="text-base font-semibold font-display text-neutral-900">Recibir turno</h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {sucursalNombre}{tenedorActualNombre ? ` · entregás vos: ${tenedorActualNombre}` : ""}
                </p>
              </div>
              <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-neutral-500">
                La caja no se cierra — sigue siendo el mismo turno. Contá el efectivo del cajón para dejar registro de que lo recibís.
              </p>

              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Efectivo esperado</span>
                <span className="text-lg font-bold font-display tabular-nums text-neutral-700">{AR.format(efectivoEsperado)}</span>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2 block">
                  Contás en el cajón
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-neutral-400">$</span>
                  <input
                    ref={realRef}
                    type="number"
                    value={real}
                    onChange={(e) => setReal(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full h-12 pl-8 pr-4 rounded-xl border-2 border-neutral-300 text-lg font-bold tabular-nums text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors"
                  />
                </div>
              </div>

              {diferencia !== null && (
                <div className={`rounded-xl p-3.5 flex items-center justify-between ${
                  diferencia === 0 ? "bg-selva-50 border border-selva-200"
                  : diferencia > 0 ? "bg-blue-50 border border-blue-200"
                  : "bg-danger/5 border border-danger/20"
                }`}>
                  <span className={`text-sm font-semibold ${diferencia === 0 ? "text-selva-700" : diferencia > 0 ? "text-blue-700" : "text-danger"}`}>
                    {diferencia === 0 ? "Cuadra exacto ✓" : diferencia > 0 ? "Sobrante en caja" : "Faltante en caja"}
                  </span>
                  <span className={`text-xl font-bold font-display tabular-nums ${diferencia === 0 ? "text-selva-700" : diferencia > 0 ? "text-blue-700" : "text-danger"}`}>
                    {diferencia > 0 ? "+" : ""}{AR.format(diferencia)}
                  </span>
                </div>
              )}

              <div>
                {diferencia !== null && diferencia !== 0 && (
                  <p className="text-xs font-semibold text-danger mb-1.5">
                    Hay diferencia — contá qué pasó antes de recibir la caja *
                  </p>
                )}
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder={diferencia !== null && diferencia !== 0 ? "Ej: faltó contar una venta, error de vuelto, etc." : "Observaciones (opcional)…"}
                  rows={2}
                  className={`w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none ${
                    notaObligatoria
                      ? "border-danger/40 focus:border-danger focus:ring-danger/20"
                      : "border-neutral-300 focus:border-tierra-700 focus:ring-tierra-700/20"
                  }`}
                />
              </div>

              {error && <p className="text-xs text-danger font-medium">{error}</p>}
            </div>

            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 h-10 rounded-xl border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={pending}
                className="flex-1 h-10 rounded-xl bg-tierra-700 text-white text-sm font-semibold hover:bg-tierra-800 disabled:opacity-50 transition-colors"
              >
                {pending ? "Guardando…" : "Confirmar recepción"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
