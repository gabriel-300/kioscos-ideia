"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { registrarRetiro } from "../retiro-actions";

interface Props {
  sucursalId: string;
}

export function RetiroEfectivoButton({ sucursalId }: Props) {
  const [open, setOpen]     = useState(false);
  const [monto, setMonto]   = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const montoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => montoRef.current?.focus(), 80);
  }, [open]);

  function handleClose() {
    setMonto(""); setMotivo(""); setError(null);
    setOpen(false);
  }

  function handleSubmit() {
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) { setError("El monto es obligatorio"); return; }
    if (!motivo.trim())             { setError("El motivo es obligatorio"); return; }
    setError(null);

    startTransition(async () => {
      try {
        await registrarRetiro({ sucursal_id: sucursalId, monto: montoNum, motivo: motivo.trim() });
        handleClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-neutral-300 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50 transition-colors"
      >
        <svg className="size-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0 3.182-5.511m-3.182 5.51-5.511-3.181" />
        </svg>
        Retiro
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 mb-0.5">Caja</p>
                <h2 className="text-base font-semibold font-display text-neutral-900">Registrar egreso / retiro</h2>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
              >
                <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-neutral-500">
                Ingresá el monto y el motivo del retiro de efectivo.
              </p>

              {/* Monto */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2 block">
                  Monto a retirar
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-semibold text-neutral-400">$</span>
                  <input
                    ref={montoRef}
                    type="number"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="0"
                    min={0}
                    className="w-full h-12 pl-8 pr-4 rounded-xl border-2 border-neutral-300 text-lg font-bold tabular-nums text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors"
                  />
                </div>
              </div>

              {/* Motivo */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2 block">
                  Observación / Motivo
                </label>
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Pago a proveedor, Retiro parcial, etc."
                  rows={3}
                  className="w-full rounded-xl border-2 border-neutral-300 px-4 py-3 text-sm text-neutral-900 focus:outline-none focus:border-tierra-700 transition-colors resize-none"
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
                {pending ? "Guardando…" : "Confirmar retiro"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
