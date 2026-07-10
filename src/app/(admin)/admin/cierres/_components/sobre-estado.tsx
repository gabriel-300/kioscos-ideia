"use client";

import { useState, useTransition } from "react";
import { verificarSobre } from "../actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

interface Props {
  cierreId:             string;
  montoSobre:           number | null;
  retiradoPorNombre:    string | null;
  retiradoEn:           string | null;
  montoVerificado:      number | null;
  verificadoPorNombre:  string | null;
  verificadoEn:         string | null;
  notas:                string | null;
}

function fmtFechaHora(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-AR", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
}

function VerificarModal({ cierreId, montoSobre, montoInicial, notasIniciales, onClose }: {
  cierreId: string; montoSobre: number; montoInicial?: number; notasIniciales?: string | null; onClose: () => void;
}) {
  const esCorreccion = montoInicial != null;
  const [pending, startTransition] = useTransition();
  const [monto, setMonto] = useState(esCorreccion ? String(montoInicial) : "");
  const [notas, setNotas] = useState(notasIniciales ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    const montoNum = parseFloat(monto);
    if (isNaN(montoNum) || montoNum < 0) { setError("Ingresá un monto válido"); return; }
    setError(null);
    startTransition(async () => {
      try {
        await verificarSobre(cierreId, { montoVerificado: montoNum, notas: notas || null });
        onClose();
      } catch (e) { setError((e as Error).message); }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-base font-semibold font-display text-neutral-900 mb-1">
            {esCorreccion ? "Corregir verificación" : "Verificar sobre"}
          </h3>
          <p className="text-xs text-neutral-400 mb-4">
            {esCorreccion
              ? "Corregí el monto contado (ej. si se cargó al revés entre dos cierres) y guardá de nuevo."
              : 'Contá la plata y cargá lo que encontraste — a propósito no se muestra el monto declarado acá, así el conteo es a ciegas y no queda influido por lo que "debería" dar.'}
          </p>

          <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Monto contado *</label>
          <div className="relative mb-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
            <input
              type="number" min="0" step="0.01" autoFocus
              placeholder="0"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white pl-6 pr-3 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
            />
          </div>

          <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5 mt-3">Notas (opcional)</label>
          <textarea
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ej: motivo de la diferencia…"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-tierra-700 resize-none mb-3"
          />

          {error && <p className="text-xs text-danger mb-3">{error}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors">
              Cancelar
            </button>
            <button
              type="button" disabled={pending} onClick={handleSubmit}
              className="flex-1 h-10 rounded-lg bg-tierra-700 text-white text-sm font-semibold hover:bg-tierra-800 transition-colors disabled:opacity-50"
            >
              {pending ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function SobreEstado({ cierreId, montoSobre, retiradoPorNombre, retiradoEn, montoVerificado, verificadoPorNombre, verificadoEn, notas }: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  if (!montoSobre || montoSobre <= 0) return <span className="text-neutral-200 text-xs">—</span>;

  const monto = <span className="tabular-nums text-xs font-medium text-neutral-700">{AR.format(montoSobre)}</span>;

  if (montoVerificado != null) {
    const diferencia = montoVerificado - montoSobre;
    const ok = diferencia === 0;
    return (
      <div className="flex flex-col items-end gap-0.5">
        {monto}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-75 ${ok ? "bg-selva-50 text-selva-700" : "bg-danger/5 text-danger"}`}
          title={`Verificado por ${verificadoPorNombre ?? "—"}${verificadoEn ? ` el ${fmtFechaHora(verificadoEn)}` : ""}${notas ? ` — ${notas}` : ""} · click para corregir`}
        >
          {ok ? "OK ✓" : `${diferencia > 0 ? "+" : ""}${AR.format(diferencia)}`}
        </button>
        {modalOpen && (
          <VerificarModal
            cierreId={cierreId}
            montoSobre={montoSobre}
            montoInicial={montoVerificado}
            notasIniciales={notas}
            onClose={() => setModalOpen(false)}
          />
        )}
      </div>
    );
  }

  if (retiradoPorNombre) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        {/* No se muestra el monto declarado acá a propósito -- quien verifica
            tiene que contar a ciegas, sin ver antes cuánto "debería" haber. */}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-semibold hover:bg-blue-100 transition-colors"
          title={`Retirado por ${retiradoPorNombre}${retiradoEn ? ` el ${fmtFechaHora(retiradoEn)}` : ""}`}
        >
          Verificar
        </button>
        {modalOpen && <VerificarModal cierreId={cierreId} montoSobre={montoSobre} onClose={() => setModalOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center rounded-full bg-neutral-100 text-neutral-500 px-2 py-0.5 text-xs font-medium">
        Sin retirar
      </span>
    </div>
  );
}
