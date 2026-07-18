"use client";

import { useState, useTransition } from "react";
import { aprobarAjuste, marcarRevisadoSinAjustar } from "../../sucursales/[id]/auditoria-actions";

export function DiferenciaRow({
  itemId, fecha, sucursalNombre, auditadoPor, productoNombre, sku,
  diferenciaTexto, diferenciaPositiva, stockSistemaTexto, stockContadoTexto,
  observacion, revisado, ajusteAplicado, notaAdmin,
}: {
  itemId:             string;
  fecha:              string;
  sucursalNombre:     string;
  auditadoPor:        string;
  productoNombre:     string;
  sku:                string;
  diferenciaTexto:    string;
  diferenciaPositiva: boolean;
  stockSistemaTexto:  string;
  stockContadoTexto:  string;
  observacion:        string | null;
  revisado:           boolean;
  ajusteAplicado:     boolean;
  notaAdmin:          string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [nota, setNota]   = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleAprobar() {
    setError(null);
    startTransition(async () => {
      const res = await aprobarAjuste(itemId, nota.trim() || undefined);
      if (res.error) setError(res.error);
    });
  }
  function handleRechazar() {
    setError(null);
    startTransition(async () => {
      const res = await marcarRevisadoSinAjustar(itemId, nota.trim() || undefined);
      if (res.error) setError(res.error);
    });
  }

  const fechaDisplay = new Date(fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" });

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-medium text-neutral-900">{productoNombre} <span className="text-xs text-neutral-400 font-mono">{sku}</span></p>
          <p className="text-xs text-neutral-400 mt-0.5">{sucursalNombre} · {fechaDisplay} · Auditó: {auditadoPor}</p>
          <p className="text-xs text-neutral-500 mt-1">
            Sistema: {stockSistemaTexto} · Contado: {stockContadoTexto}
          </p>
          {observacion && <p className="text-xs text-neutral-600 mt-1 italic">"{observacion}"</p>}
        </div>
        <span className={`tabular-nums font-semibold text-sm shrink-0 ${diferenciaPositiva ? "text-blue-600" : "text-danger"}`}>
          {diferenciaTexto}
        </span>
      </div>

      {revisado ? (
        <p className="text-xs mt-2">
          {ajusteAplicado
            ? <span className="text-selva-700 font-medium">✓ Ajuste aprobado</span>
            : <span className="text-neutral-400 font-medium">Revisado sin ajustar</span>}
          {notaAdmin && <span className="text-neutral-500"> — {notaAdmin}</span>}
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Nota (opcional)"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            className="h-8 flex-1 min-w-[160px] rounded-lg border border-neutral-300 bg-white px-2.5 text-xs focus:outline-none focus:border-tierra-700"
          />
          <button
            type="button"
            disabled={pending}
            onClick={handleAprobar}
            className="h-8 px-3 rounded-lg bg-tierra-700 text-white text-xs font-semibold hover:bg-tierra-800 transition-colors disabled:opacity-50"
          >
            Aprobar ajuste
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleRechazar}
            className="h-8 px-3 rounded-lg border border-neutral-300 text-neutral-600 text-xs font-medium hover:bg-neutral-50 transition-colors disabled:opacity-50"
          >
            Revisado sin ajustar
          </button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      )}
    </div>
  );
}
