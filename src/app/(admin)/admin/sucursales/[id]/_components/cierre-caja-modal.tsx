"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Button } from "@/components/ui";
import { cerrarCaja } from "../cierre-actions";
import { type MovimientoCierre, type UltimoCierre } from "./cierre-caja-button";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

interface Props {
  open:           boolean;
  onClose:        () => void;
  sucursalId:     string;
  sucursalNombre: string;
  movimientos:    MovimientoCierre[];
  cajaAbierta:    boolean;
  ultimoCierre:   UltimoCierre;
  aperturaActual?: { fondo_inicial: number } | null;
}

function MontoInput({ label, icon, value, onChange, sugerido, inputRef }: {
  label:     string;
  icon:      React.ReactNode;
  value:     string;
  onChange:  (v: string) => void;
  sugerido?: number;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <label className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">
          {icon}{label}
        </span>
        {sugerido !== undefined && sugerido > 0 && (
          <span className="text-xs text-neutral-400">Sugerido: {AR.format(sugerido)}</span>
        )}
      </label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-neutral-400">$</span>
        <input
          ref={inputRef}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          min={0}
          className="w-full h-12 pl-8 pr-4 rounded-xl border-2 border-neutral-300 text-lg font-bold tabular-nums text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors"
        />
      </div>
    </div>
  );
}

export function CierreCajaModal({ open, onClose, sucursalId, sucursalNombre, movimientos, cajaAbierta, ultimoCierre, aperturaActual }: Props) {
  const hoy = new Date().toISOString().slice(0, 10);

  const [efectivo,       setEfectivo]       = useState("");
  const [mp,             setMp]             = useState("");
  const [tarjeta,        setTarjeta]        = useState("");
  const [transferencia,  setTransferencia]  = useState("");
  const [notas,          setNotas]          = useState("");
  const [error,          setError]          = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const efectivoRef = useRef<HTMLInputElement>(null);

  const ventasHoy = movimientos.filter((m) => m.tipo === "venta" && m.fecha === hoy);

  const sugeridoEfectivo      = ventasHoy.reduce((s, m) => s + (m.pago_efectivo      ?? 0), 0);
  const sugeridoBilletera     = ventasHoy.reduce((s, m) => s + (m.pago_billetera     ?? 0), 0);
  const sugeridoTarjeta       = ventasHoy.reduce((s, m) => s + (m.pago_tarjeta       ?? 0), 0);
  const sugeridoTransferencia = ventasHoy.reduce((s, m) => s + (m.pago_transferencia ?? 0), 0);

  const totalVentas  = ventasHoy.reduce((s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0);
  const registrosHoy = ventasHoy.length;

  useEffect(() => {
    if (open && cajaAbierta) {
      if (sugeridoEfectivo > 0)      setEfectivo(String(sugeridoEfectivo));
      if (sugeridoBilletera > 0)     setMp(String(sugeridoBilletera));
      if (sugeridoTarjeta > 0)       setTarjeta(String(sugeridoTarjeta));
      if (sugeridoTransferencia > 0) setTransferencia(String(sugeridoTransferencia));
      setTimeout(() => efectivoRef.current?.focus(), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cajaAbierta]);

  function handleClose() {
    setEfectivo(""); setMp(""); setTarjeta(""); setTransferencia(""); setNotas(""); setError(null);
    onClose();
  }

  const efectivoNum      = parseFloat(efectivo)      || 0;
  const mpNum            = parseFloat(mp)            || 0;
  const tarjetaNum       = parseFloat(tarjeta)       || 0;
  const transferenciaNum = parseFloat(transferencia) || 0;
  const totalDeclarado   = efectivoNum + mpNum + tarjetaNum + transferenciaNum;
  const hayAlgo          = totalDeclarado > 0;
  const diferencia       = hayAlgo ? totalDeclarado - totalVentas : null;

  function handleSubmit() {
    if (!hayAlgo) { setError("Ingresá al menos un monto"); return; }
    setError(null);
    startTransition(async () => {
      try {
        await cerrarCaja({
          sucursal_id:              sucursalId,
          fecha:                    hoy,
          total_ventas:            totalVentas,
          efectivo_declarado:      efectivoNum,
          billetera_declarada:     mpNum,
          tarjeta_declarada:       tarjetaNum,
          transferencia_declarada: transferenciaNum,
          notas:                    notas || null,
        });
        handleClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  if (!open) return null;

  const fechaLabel = new Date(hoy + "T00:00:00").toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <div>
            <h2 className="text-base font-semibold font-display text-neutral-900">Cierre de caja</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{sucursalNombre} · {fechaLabel}</p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Ventas del día */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Ventas del turno</p>
            {registrosHoy === 0 ? (
              <p className="text-sm text-neutral-400">No hay ventas registradas hoy.</p>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">{registrosHoy} {registrosHoy === 1 ? "registro" : "registros"}</span>
                <span className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalVentas)}</span>
              </div>
            )}
          </div>

          {/* Fondo inicial */}
          {aperturaActual && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Fondo inicial</p>
              <span className="text-sm font-bold tabular-nums text-neutral-700">{AR.format(aperturaActual.fondo_inicial)}</span>
            </div>
          )}

          {cajaAbierta ? (
            /* ── Formulario de cierre ── */
            <>
              <MontoInput
                label="Efectivo en cajón"
                icon={<span className="text-base">💵</span>}
                value={efectivo}
                onChange={setEfectivo}
                sugerido={sugeridoEfectivo}
                inputRef={efectivoRef}
              />
              <MontoInput
                label="Billetera virtual"
                icon={<span className="text-base">📱</span>}
                value={mp}
                onChange={setMp}
                sugerido={sugeridoBilletera}
              />
              <MontoInput
                label="Tarjeta"
                icon={<span className="text-base">💳</span>}
                value={tarjeta}
                onChange={setTarjeta}
                sugerido={sugeridoTarjeta}
              />
              <MontoInput
                label="Transferencia"
                icon={<span className="text-base">🏦</span>}
                value={transferencia}
                onChange={setTransferencia}
                sugerido={sugeridoTransferencia}
              />

              {/* Total declarado + diferencia */}
              {hayAlgo && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1 text-sm text-neutral-500">
                    <span>Total declarado</span>
                    <span className="font-semibold text-neutral-800 tabular-nums">{AR.format(totalDeclarado)}</span>
                  </div>
                  {diferencia !== null && (
                    <div className={`rounded-xl p-3.5 flex items-center justify-between ${
                      diferencia === 0
                        ? "bg-selva-50 border border-selva-200"
                        : diferencia > 0
                        ? "bg-blue-50 border border-blue-200"
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
                </div>
              )}

              <textarea
                placeholder="Observaciones del cierre (opcional)…"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 resize-none"
              />

              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          ) : (
            /* ── Último cierre registrado ── */
            ultimoCierre ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden">
                  {[
                    { icon: "💵", label: "Efectivo",          v: ultimoCierre.efectivo_declarado },
                    { icon: "📱", label: "Billetera virtual", v: ultimoCierre.billetera_declarada },
                    { icon: "💳", label: "Tarjeta",           v: ultimoCierre.tarjeta_declarada ?? 0 },
                    { icon: "🏦", label: "Transferencia",     v: ultimoCierre.transferencia_declarada ?? 0 },
                  ].filter((r) => r.v > 0).map((r) => (
                    <div key={r.label} className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm text-neutral-500 flex items-center gap-2">
                        <span className="text-base">{r.icon}</span> {r.label}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{AR.format(r.v)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-3 bg-neutral-50">
                    <span className="text-sm font-semibold text-neutral-700">Total declarado</span>
                    <span className="text-sm font-bold tabular-nums">{AR.format(
                      ultimoCierre.efectivo_declarado + ultimoCierre.billetera_declarada +
                      (ultimoCierre.tarjeta_declarada ?? 0) + (ultimoCierre.transferencia_declarada ?? 0)
                    )}</span>
                  </div>
                </div>

                {ultimoCierre.diferencia !== null && (
                  <div className={`rounded-xl p-3 flex items-center justify-between ${
                    ultimoCierre.diferencia === 0
                      ? "bg-selva-50 border border-selva-200"
                      : Math.abs(ultimoCierre.diferencia) < 500
                      ? "bg-warning-bg border border-warning/30"
                      : "bg-danger/5 border border-danger/20"
                  }`}>
                    <span className={`text-sm font-semibold ${ultimoCierre.diferencia === 0 ? "text-selva-700" : ultimoCierre.diferencia > 0 ? "text-blue-700" : "text-danger"}`}>
                      {ultimoCierre.diferencia === 0 ? "Cuadró exacto ✓" : ultimoCierre.diferencia > 0 ? "Sobrante" : "Faltante"}
                    </span>
                    <span className={`text-base font-bold tabular-nums ${ultimoCierre.diferencia === 0 ? "text-selva-700" : ultimoCierre.diferencia > 0 ? "text-blue-700" : "text-danger"}`}>
                      {ultimoCierre.diferencia > 0 ? "+" : ""}{AR.format(ultimoCierre.diferencia)}
                    </span>
                  </div>
                )}

                {ultimoCierre.notas && (
                  <p className="text-xs text-neutral-400 italic px-1">{ultimoCierre.notas}</p>
                )}
                <p className="text-xs text-center text-neutral-400">La caja está cerrada. Abrí un nuevo turno para continuar.</p>
              </div>
            ) : (
              <p className="text-sm text-neutral-400 text-center py-2">No hay cierre registrado hoy.</p>
            )
          )}
        </div>

        {cajaAbierta && (
          <div className="px-6 pb-5">
            <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="w-full">
              Cerrar caja
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
