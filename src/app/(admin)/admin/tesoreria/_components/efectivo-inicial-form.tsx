"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarEfectivoInicial } from "../actions";
import { friendlyError } from "@/lib/utils";

// El efectivo con el que arrancó Tesorería (se carga una vez). Sin este número, «Efectivo en mano» no coincide
// con lo que hay realmente en el sobre o la caja fuerte.
export function EfectivoInicialForm({ valorActual }: { valorActual: number }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [monto, setMonto] = useState(String(valorActual));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function guardar() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await guardarEfectivoInicial(parseFloat(monto));
        if (r.error) { setError(r.error); return; }
        setEditando(false);
        router.refresh();
      } catch (e) { setError(friendlyError(e)); }
    });
  }

  if (!editando) {
    return <button onClick={() => setEditando(true)} className="text-xs font-semibold text-tierra-700 hover:underline">Cambiar efectivo inicial</button>;
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)}
        className="h-9 w-36 rounded-lg border border-neutral-300 bg-white px-3 text-sm tabular-nums focus:outline-none focus:border-tierra-700" />
      <button onClick={guardar} disabled={pending} className="h-9 px-3 rounded-lg bg-tierra-700 text-white text-xs font-semibold disabled:opacity-50">Guardar</button>
      <button onClick={() => setEditando(false)} className="text-xs text-neutral-500 hover:underline">Cancelar</button>
      {error && <p className="text-xs text-danger w-full">{error}</p>}
    </div>
  );
}
