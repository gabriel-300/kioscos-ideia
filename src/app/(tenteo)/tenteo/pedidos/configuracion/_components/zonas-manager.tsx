"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarZona, eliminarZona } from "../actions";

export type ZonaFila = { id: string; nombre: string; costo: number; eta_min: number; eta_max: number; is_active: boolean };

const inputCls = "h-9 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20";

function FilaZona({ sucursalId, zona, onCambio }: { sucursalId: string; zona: ZonaFila | null; onCambio: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState(zona?.nombre ?? "");
  const [costo, setCosto] = useState(zona ? String(zona.costo) : "");
  const [etaMin, setEtaMin] = useState(zona ? String(zona.eta_min) : "30");
  const [etaMax, setEtaMax] = useState(zona ? String(zona.eta_max) : "45");
  const [activa, setActiva] = useState(zona?.is_active ?? true);

  function guardar() {
    setError(null);
    startTransition(async () => {
      const res = await guardarZona({
        id:          zona?.id,
        sucursal_id: sucursalId,
        nombre,
        costo:       parseFloat(costo) || 0,
        eta_min:     parseInt(etaMin, 10) || 0,
        eta_max:     parseInt(etaMax, 10) || 0,
        is_active:   activa,
      });
      if (res.error) { setError(res.error); return; }
      if (!zona) { setNombre(""); setCosto(""); }
      onCambio();
    });
  }

  function borrar() {
    if (!zona || !confirm(`¿Borrar la zona "${zona.nombre}"? Los pedidos anteriores no se modifican.`)) return;
    startTransition(async () => {
      const res = await eliminarZona(zona.id);
      if (res.error) setError(res.error); else onCambio();
    });
  }

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <input placeholder="Nombre de la zona" value={nombre} onChange={(e) => setNombre(e.target.value)} className={`${inputCls} w-52`} />
        <div className="flex items-center gap-1">
          <span className="text-sm text-neutral-400">$</span>
          <input type="number" min="0" step="any" placeholder="Costo" value={costo} onChange={(e) => setCosto(e.target.value)} className={`${inputCls} w-24`} />
        </div>
        <div className="flex items-center gap-1">
          <input type="number" min="0" value={etaMin} onChange={(e) => setEtaMin(e.target.value)} className={`${inputCls} w-16`} />
          <span className="text-sm text-neutral-400">a</span>
          <input type="number" min="0" value={etaMax} onChange={(e) => setEtaMax(e.target.value)} className={`${inputCls} w-16`} />
          <span className="text-xs text-neutral-400">min</span>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer">
          <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} className="size-4 rounded border-neutral-300" />
          Activa
        </label>
        <button type="button" onClick={guardar} disabled={pending} className="h-9 px-3 rounded-lg bg-tierra-700 text-white text-xs font-semibold disabled:opacity-50">
          {pending ? "…" : zona ? "Guardar" : "Agregar zona"}
        </button>
        {zona && (
          <button type="button" onClick={borrar} disabled={pending} className="text-xs text-neutral-400 hover:text-red-600 hover:underline disabled:opacity-50">
            Borrar
          </button>
        )}
      </div>
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}

export function ZonasManager({ sucursalId, zonas }: { sucursalId: string; zonas: ZonaFila[] }) {
  const router = useRouter();
  const refrescar = () => router.refresh();

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="text-sm font-semibold text-neutral-900">Zonas de envío</p>
      <p className="text-xs text-neutral-400 mt-0.5 mb-2">El cliente elige una zona en el checkout y el costo de envío sale de acá. Sin zonas activas, el envío no se ofrece.</p>
      <div className="divide-y divide-neutral-100">
        {zonas.map((z) => (
          <FilaZona key={`${z.id}:${z.nombre}:${z.costo}:${z.eta_min}:${z.eta_max}:${z.is_active}`} sucursalId={sucursalId} zona={z} onCambio={refrescar} />
        ))}
        <FilaZona key="nueva" sucursalId={sucursalId} zona={null} onCambio={refrescar} />
      </div>
    </div>
  );
}
