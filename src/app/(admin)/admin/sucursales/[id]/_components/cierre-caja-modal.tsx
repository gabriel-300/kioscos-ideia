"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Button } from "@/components/ui";
import { cerrarCaja } from "../cierre-actions";
import { type MovimientoCierre, type UltimoCierre } from "./cierre-caja-button";
import { fechaHoyAR } from "@/lib/fecha";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

interface Props {
  open:           boolean;
  onClose:        () => void;
  sucursalId:     string;
  sucursalNombre: string;
  movimientos:    MovimientoCierre[];
  cajaAbierta:    boolean;
  ultimoCierre:   UltimoCierre;
  aperturaActual?: { fondo_inicial: number; created_at: string } | null;
  retiros?:        { monto: number; created_at: string }[];
  role?:           string | null;
  abiertaPorNombre?: string | null;
  puedeCerrarCaja?:  boolean;
}

function MontoInput({ label, icon, value, onChange, sugerido, hint, inputRef, readOnly }: {
  label:     string;
  icon:      React.ReactNode;
  value:     string;
  onChange:  (v: string) => void;
  sugerido?: number;
  hint?:     string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">
          {icon}{label}
        </span>
        {readOnly ? (
          <span className="text-xs text-neutral-400">Calculado por el sistema</span>
        ) : sugerido !== undefined && sugerido > 0 && (
          <span className="text-xs text-neutral-400">Sugerido: {AR.format(sugerido)}</span>
        )}
      </label>
      {hint && <p className="text-xs text-neutral-400 mb-1.5">{hint}</p>}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-neutral-400">$</span>
        <input
          ref={inputRef}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          min={0}
          readOnly={readOnly}
          className={`w-full h-12 pl-8 pr-4 rounded-xl border-2 text-lg font-bold tabular-nums focus:outline-none transition-colors ${
            readOnly
              ? "border-neutral-200 bg-neutral-50 text-neutral-500 cursor-not-allowed"
              : "border-neutral-300 text-neutral-900 focus:border-tierra-700"
          }`}
        />
      </div>
    </div>
  );
}

export function CierreCajaModal({ open, onClose, sucursalId, sucursalNombre, movimientos, cajaAbierta, ultimoCierre, aperturaActual, retiros = [], role, abiertaPorNombre, puedeCerrarCaja = true }: Props) {
  const hoy = fechaHoyAR();
  const puedeEditarMedios = role === "admin";

  const [efectivo,       setEfectivo]       = useState("");
  const [mp,             setMp]             = useState("");
  const [tarjeta,        setTarjeta]        = useState("");
  const [transferencia,  setTransferencia]  = useState("");
  const [fondoSiguiente, setFondoSiguiente] = useState("");
  const [notas,          setNotas]          = useState("");
  const [error,          setError]          = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const efectivoRef = useRef<HTMLInputElement>(null);

  // En multi-turno filtramos por created_at >= apertura actual para no sumar turnos anteriores
  const ventasHoy = movimientos.filter((m) => {
    if (m.tipo !== "venta") return false;
    if (aperturaActual) return m.created_at >= aperturaActual.created_at;
    return m.fecha === hoy;
  });

  // Las ventas a Cta. Corriente no se cobran en el momento -- no tienen ninguna
  // contraparte en efectivo/billetera/tarjeta/transferencia, así que no deben
  // sumar a lo que se concilia contra la caja (si no, generan un faltante ficticio
  // por el mismo monto fiado).
  const ventasCobradas = ventasHoy.filter((m) => m.canal !== "cuenta_corriente");
  const ventasFiado     = ventasHoy.filter((m) => m.canal === "cuenta_corriente");

  const sugeridoEfectivo      = ventasCobradas.reduce((s, m) => s + (m.pago_efectivo      ?? 0), 0);
  const sugeridoBilletera     = ventasCobradas.reduce((s, m) => s + (m.pago_billetera     ?? 0), 0);
  const sugeridoTarjeta       = ventasCobradas.reduce((s, m) => s + (m.pago_tarjeta       ?? 0), 0);
  const sugeridoTransferencia = ventasCobradas.reduce((s, m) => s + (m.pago_transferencia ?? 0), 0);

  const totalVentas  = ventasCobradas.reduce((s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0);
  const totalFiado   = ventasFiado.reduce((s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0);
  const registrosHoy = ventasHoy.length;

  const fondo = aperturaActual?.fondo_inicial ?? 0;

  // Retiros del turno actual — se restan del efectivo esperado (mismo criterio que la RPC cerrar_caja)
  const retirosTurno = retiros
    .filter((r) => aperturaActual ? r.created_at >= aperturaActual.created_at : r.created_at.slice(0, 10) === hoy)
    .reduce((s, r) => s + r.monto, 0);

  useEffect(() => {
    if (open && cajaAbierta) {
      const efectivoTotal = sugeridoEfectivo + fondo - retirosTurno;
      if (efectivoTotal > 0)         setEfectivo(String(efectivoTotal));
      if (sugeridoBilletera > 0)     setMp(String(sugeridoBilletera));
      if (sugeridoTarjeta > 0)       setTarjeta(String(sugeridoTarjeta));
      if (sugeridoTransferencia > 0) setTransferencia(String(sugeridoTransferencia));
      // Por defecto sugiere dejar el mismo fondo con el que se abrió — editable si se deja otra cosa.
      if (fondo > 0) setFondoSiguiente(String(fondo));
      setTimeout(() => efectivoRef.current?.focus(), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cajaAbierta]);

  function handleClose() {
    setEfectivo(""); setMp(""); setTarjeta(""); setTransferencia(""); setFondoSiguiente(""); setNotas(""); setError(null);
    onClose();
  }

  const efectivoNum      = parseFloat(efectivo)      || 0;
  const mpNum            = parseFloat(mp)            || 0;
  const tarjetaNum       = parseFloat(tarjeta)       || 0;
  const transferenciaNum = parseFloat(transferencia) || 0;
  const totalDeclarado   = efectivoNum + mpNum + tarjetaNum + transferenciaNum;
  const hayAlgo          = totalDeclarado > 0;
  // diferencia = (efectivo − fondo + retiros del turno) + resto − ventas (espejea la RPC cerrar_caja)
  const diferencia       = hayAlgo ? (efectivoNum - fondo + retirosTurno) + mpNum + tarjetaNum + transferenciaNum - totalVentas : null;

  function handleSubmit() {
    if (!hayAlgo) { setError("Ingresá al menos un monto"); return; }
    setError(null);
    startTransition(async () => {
      try {
        await cerrarCaja({
          sucursal_id:              sucursalId,
          fecha:                    hoy,
          fondo_inicial:           fondo,
          total_ventas:            totalVentas,
          efectivo_declarado:      efectivoNum,
          billetera_declarada:     mpNum,
          tarjeta_declarada:       tarjetaNum,
          transferencia_declarada: transferenciaNum,
          notas:                    notas || null,
          fondo_siguiente:          fondoSiguiente ? parseFloat(fondoSiguiente) : null,
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
        className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
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

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
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
            {totalFiado > 0 && (
              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-neutral-200">
                <span className="text-xs font-medium text-purple-600">Cta. Corriente (no concilia contra caja)</span>
                <span className="text-xs font-semibold tabular-nums text-purple-600">{AR.format(totalFiado)}</span>
              </div>
            )}
          </div>

          {/* Fondo inicial */}
          {aperturaActual && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Fondo inicial</p>
                <span className="text-sm font-bold tabular-nums text-neutral-700">{AR.format(aperturaActual.fondo_inicial)}</span>
              </div>
              {retirosTurno > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-500">Retiros del turno</p>
                  <span className="text-sm font-bold tabular-nums text-amber-600">−{AR.format(retirosTurno)}</span>
                </div>
              )}
            </div>
          )}

          {cajaAbierta && !puedeCerrarCaja ? (
            /* ── Turno abierto por otra persona: no puede cerrarlo ── */
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">
                Esta caja la abrió {abiertaPorNombre ?? "otra persona"}.
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Pedile que la cierre ella, o hacelo como encargado o admin.
              </p>
            </div>
          ) : cajaAbierta ? (
            /* ── Formulario de cierre ── */
            <>
              <MontoInput
                label="Efectivo en cajón"
                icon={<span className="text-base">💵</span>}
                value={efectivo}
                onChange={setEfectivo}
                sugerido={sugeridoEfectivo + fondo - retirosTurno}
                hint={fondo > 0 ? `Contá todo el efectivo del cajón (incluye fondo inicial de ${AR.format(fondo)})` : undefined}
                inputRef={efectivoRef}
              />
              <MontoInput
                label="Billetera virtual"
                icon={<span className="text-base">📱</span>}
                value={mp}
                onChange={setMp}
                sugerido={sugeridoBilletera}
                readOnly={!puedeEditarMedios}
              />
              <MontoInput
                label="Tarjeta"
                icon={<span className="text-base">💳</span>}
                value={tarjeta}
                onChange={setTarjeta}
                sugerido={sugeridoTarjeta}
                readOnly={!puedeEditarMedios}
              />
              <MontoInput
                label="Transferencia"
                icon={<span className="text-base">🏦</span>}
                value={transferencia}
                onChange={setTransferencia}
                sugerido={sugeridoTransferencia}
                readOnly={!puedeEditarMedios}
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

              <div>
                <label className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400">
                    <span className="text-base">🔄</span>Dejás en el cajón (próximo turno)
                  </span>
                </label>
                <p className="text-xs text-neutral-400 mb-1.5">
                  Cuánto de ese efectivo se queda adentro como fondo para el que abra después — el resto se entiende que se retira/entrega.
                </p>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-neutral-400">$</span>
                  <input
                    type="number"
                    value={fondoSiguiente}
                    onChange={(e) => setFondoSiguiente(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full h-12 pl-8 pr-4 rounded-xl border-2 border-neutral-300 text-lg font-bold tabular-nums text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors"
                  />
                </div>
                {efectivoNum > 0 && fondoSiguiente !== "" && (
                  <p className="text-xs text-neutral-400 mt-1.5">
                    Se entrega/retira: <span className="font-semibold text-neutral-600">{AR.format(Math.max(0, efectivoNum - (parseFloat(fondoSiguiente) || 0)))}</span>
                  </p>
                )}
              </div>

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
                {ultimoCierre.numero_liquidacion != null && (
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Liquidación</span>
                    <span className="text-sm font-bold tabular-nums text-neutral-700">N° {ultimoCierre.numero_liquidacion}</span>
                  </div>
                )}
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

                {ultimoCierre.fondo_siguiente != null && (
                  <>
                    <p className="text-xs text-neutral-500 px-1">
                      📦 Va en el sobre: <span className="font-semibold text-neutral-700">
                        {AR.format(Math.max(0, ultimoCierre.efectivo_declarado - ultimoCierre.fondo_siguiente))}
                      </span>
                    </p>
                    <p className="text-xs text-neutral-500 px-1">
                      🔄 Dejó <span className="font-semibold">{AR.format(ultimoCierre.fondo_siguiente)}</span> en el cajón para el próximo turno.
                    </p>
                  </>
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

        {cajaAbierta && puedeCerrarCaja && (
          <div className="px-6 py-4 border-t border-neutral-200 shrink-0">
            <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="w-full">
              Cerrar caja
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
