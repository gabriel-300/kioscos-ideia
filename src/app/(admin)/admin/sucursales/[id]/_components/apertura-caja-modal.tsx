"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Button } from "@/components/ui";
import { abrirCaja } from "../apertura-actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type AperturaActual = { fondo_inicial: number; notas: string | null; created_at: string };

interface Props {
  open:           boolean;
  onClose:        () => void;
  sucursalId:     string;
  sucursalNombre: string;
  cajaAbierta:    boolean;
  aperturaActual: AperturaActual | null;
}

export function AperturaCajaModal({ open, onClose, sucursalId, sucursalNombre, cajaAbierta, aperturaActual }: Props) {
  const hoy = new Date().toISOString().slice(0, 10);

  const [fondo,  setFondo]  = useState("");
  const [notas,  setNotas]  = useState("");
  const [error,  setError]  = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fondoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !cajaAbierta) setTimeout(() => fondoRef.current?.focus(), 80);
  }, [open, cajaAbierta]);

  function handleClose() {
    setFondo(""); setNotas(""); setError(null);
    onClose();
  }

  function handleSubmit() {
    const fondoNum = parseFloat(fondo) || 0;
    setError(null);
    startTransition(async () => {
      try {
        await abrirCaja({
          sucursal_id:   sucursalId,
          fecha:         hoy,
          fondo_inicial: fondoNum,
          notas:         notas || null,
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
        className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <div>
            <h2 className="text-base font-semibold font-display text-neutral-900">Apertura de caja</h2>
            <p className="text-xs text-neutral-400 mt-0.5">{sucursalNombre} · {fechaLabel}</p>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {cajaAbierta ? (
            /* Caja actualmente abierta */
            <div className="space-y-3">
              <div className="rounded-xl border border-selva-200 bg-selva-50 p-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-full bg-selva-100 flex items-center justify-center">
                    <svg className="size-4 text-selva-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-selva-800">Caja abierta</p>
                    <p className="text-xs text-selva-600">Fondo inicial registrado</p>
                  </div>
                </div>
                <span className="text-xl font-bold font-display tabular-nums text-selva-700">
                  {aperturaActual ? AR.format(aperturaActual.fondo_inicial) : "—"}
                </span>
              </div>
              {aperturaActual?.notas && (
                <p className="text-xs text-neutral-400 italic px-1">{aperturaActual.notas}</p>
              )}
              <p className="text-xs text-center text-neutral-400">La caja está abierta. Cerrala antes de iniciar un nuevo turno.</p>
            </div>
          ) : (
            /* Formulario */
            <>
              <p className="text-sm text-neutral-500">
                Registrá el fondo inicial de caja: el efectivo disponible al inicio del turno.
              </p>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
                  </svg>
                  Fondo inicial (efectivo)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-neutral-400">$</span>
                  <input
                    ref={fondoRef}
                    type="number"
                    value={fondo}
                    onChange={(e) => setFondo(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full h-12 pl-8 pr-4 rounded-xl border-2 border-neutral-300 text-lg font-bold tabular-nums text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors"
                  />
                </div>
              </div>

              <textarea
                placeholder="Observaciones opcionales…"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 resize-none"
              />

              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          )}
        </div>

        {!cajaAbierta && (
          <div className="px-6 pb-5">
            <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="w-full">
              Registrar apertura
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
