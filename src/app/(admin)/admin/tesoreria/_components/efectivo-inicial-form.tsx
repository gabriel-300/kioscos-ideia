"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarEfectivoInicial } from "../actions";
import { friendlyError } from "@/lib/utils";

// El efectivo con el que arrancó Tesorería. Mueve «efectivo en mano», así que cada cambio queda en el Historial con el valor
// anterior y el nuevo. La primera carga es libre; desde la segunda hace falta decir por qué cambia.
export function EfectivoInicialForm({ valorActual, requiereMotivo }: { valorActual: number; requiereMotivo: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [monto, setMonto] = useState(String(valorActual));
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function guardar() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await guardarEfectivoInicial(parseFloat(monto), motivo);
        if (r.error) { setError(r.error); return; }
        setEditando(false);
        setMotivo("");
        router.refresh();
      } catch (e) { setError(friendlyError(e)); }
    });
  }

  if (!editando) {
    return (
      <button onClick={() => setEditando(true)} className="text-xs font-semibold text-tierra-700 hover:underline">
        {requiereMotivo ? "Corregir efectivo inicial" : "Cargar efectivo inicial"}
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} aria-label="Efectivo inicial"
          className="h-9 w-36 rounded-lg border border-neutral-300 bg-white px-3 text-sm tabular-nums focus:outline-none focus:border-tierra-700" />
        <input type="text" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo del cambio"
          placeholder={requiereMotivo ? "Motivo del cambio (obligatorio)" : "Motivo (opcional)"}
          className="h-9 min-w-56 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700" />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={guardar} disabled={pending} className="h-9 px-3 rounded-lg bg-tierra-700 text-white text-xs font-semibold disabled:opacity-50">Guardar</button>
        <button onClick={() => { setEditando(false); setError(null); }} className="text-xs text-neutral-500 hover:underline">Cancelar</button>
        {requiereMotivo && <p className="text-xs text-neutral-400">Queda en el Historial con el valor anterior.</p>}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
