"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Button } from "@/components/ui";
import { cerrarCaja } from "../cierre-actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type CierreExistente = {
  fecha:                 string;
  total_ventas:          number;
  efectivo_declarado:    number;
  mercadopago_declarado: number;
  diferencia:            number | null;
  notas:                 string | null;
};

type AperturaExistente = {
  fondo_inicial: number;
};

type Movimiento = {
  fecha:            string;
  tipo:             string;
  movimiento_items: { subtotal: number | null }[];
};

interface Props {
  open:           boolean;
  onClose:        () => void;
  sucursalId:     string;
  sucursalNombre: string;
  movimientos:    Movimiento[];
  cierreHoy:      CierreExistente | null;
  aperturaHoy?:   AperturaExistente | null;
}

function MontoInput({ label, icon, value, onChange, inputRef }: {
  label:     string;
  icon:      React.ReactNode;
  value:     string;
  onChange:  (v: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">
        {icon}{label}
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

export function CierreCajaModal({ open, onClose, sucursalId, sucursalNombre, movimientos, cierreHoy, aperturaHoy }: Props) {
  const hoy = new Date().toISOString().slice(0, 10);

  const [efectivo, setEfectivo] = useState("");
  const [mp,       setMp]       = useState("");
  const [notas,    setNotas]    = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const efectivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !cierreHoy) setTimeout(() => efectivoRef.current?.focus(), 80);
  }, [open, cierreHoy]);

  function handleClose() {
    setEfectivo(""); setMp(""); setNotas(""); setError(null);
    onClose();
  }

  const ventasHoy   = movimientos.filter((m) => m.tipo === "venta" && m.fecha === hoy);
  const totalVentas = ventasHoy.reduce(
    (s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0),
    0
  );
  const registrosHoy = ventasHoy.length;

  const efectivoNum  = parseFloat(efectivo) || 0;
  const mpNum        = parseFloat(mp)        || 0;
  const totalDeclarado = efectivoNum + mpNum;
  const diferencia     = (efectivoNum > 0 || mpNum > 0) ? totalDeclarado - totalVentas : null;

  function handleSubmit() {
    if (efectivoNum === 0 && mpNum === 0) { setError("Ingresá al menos un monto"); return; }
    setError(null);
    startTransition(async () => {
      try {
        await cerrarCaja({
          sucursal_id:           sucursalId,
          fecha:                 hoy,
          total_ventas:          totalVentas,
          efectivo_declarado:    efectivoNum,
          mercadopago_declarado: mpNum,
          notas:                 notas || null,
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
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Ventas de hoy</p>
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
          {aperturaHoy && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Fondo inicial</p>
              <span className="text-sm font-bold tabular-nums text-neutral-700">{AR.format(aperturaHoy.fondo_inicial)}</span>
            </div>
          )}

          {cierreHoy ? (
            /* ── Cierre ya realizado ── */
            <div className="space-y-3">
              <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-neutral-500 flex items-center gap-2">
                    <span className="text-base">💵</span> Efectivo
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{AR.format(cierreHoy.efectivo_declarado)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-neutral-500 flex items-center gap-2">
                    <span className="text-base">📱</span> Mercado Pago
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{AR.format(cierreHoy.mercadopago_declarado)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-neutral-50">
                  <span className="text-sm font-semibold text-neutral-700">Total declarado</span>
                  <span className="text-sm font-bold tabular-nums">{AR.format(cierreHoy.efectivo_declarado + cierreHoy.mercadopago_declarado)}</span>
                </div>
              </div>

              {cierreHoy.diferencia !== null && (
                <div className={`rounded-xl p-3 flex items-center justify-between ${
                  cierreHoy.diferencia === 0
                    ? "bg-selva-50 border border-selva-200"
                    : Math.abs(cierreHoy.diferencia) < 500
                    ? "bg-warning-bg border border-warning/30"
                    : "bg-danger/5 border border-danger/20"
                }`}>
                  <span className={`text-sm font-semibold ${cierreHoy.diferencia === 0 ? "text-selva-700" : cierreHoy.diferencia > 0 ? "text-blue-700" : "text-danger"}`}>
                    {cierreHoy.diferencia === 0 ? "Cuadró exacto ✓" : cierreHoy.diferencia > 0 ? "Sobrante" : "Faltante"}
                  </span>
                  <span className={`text-base font-bold tabular-nums ${cierreHoy.diferencia === 0 ? "text-selva-700" : cierreHoy.diferencia > 0 ? "text-blue-700" : "text-danger"}`}>
                    {cierreHoy.diferencia > 0 ? "+" : ""}{AR.format(cierreHoy.diferencia)}
                  </span>
                </div>
              )}

              {cierreHoy.notas && (
                <p className="text-xs text-neutral-400 italic px-1">{cierreHoy.notas}</p>
              )}
              <p className="text-xs text-center text-neutral-400">La caja de hoy ya fue cerrada.</p>
            </div>
          ) : (
            /* ── Formulario de cierre ── */
            <>
              <MontoInput
                label="Efectivo en cajón"
                icon={<span className="text-base">💵</span>}
                value={efectivo}
                onChange={setEfectivo}
                inputRef={efectivoRef}
              />
              <MontoInput
                label="Cobrado por Mercado Pago"
                icon={<span className="text-base">📱</span>}
                value={mp}
                onChange={setMp}
              />

              {/* Total declarado + diferencia */}
              {(efectivoNum > 0 || mpNum > 0) && (
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
          )}
        </div>

        {!cierreHoy && (
          <div className="px-6 pb-5">
            <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="w-full">
              Cerrar caja del día
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
