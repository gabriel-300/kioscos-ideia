"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui";
import { fechaHoyAR, primerDiaMesAR } from "@/lib/fecha";

type Sucursal = { id: string; nombre: string };

export function ExportButton({ sucursales }: { sucursales: Sucursal[] }) {
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [sucursalId, setSucursal] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Mes actual como defaults
  const [desde, setDesde] = useState(primerDiaMesAR());
  const [hasta, setHasta] = useState(fechaHoyAR());

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function handleExport() {
    setLoading(true);
    const params = new URLSearchParams({ desde, hasta });
    if (sucursalId) params.set("sucursal_id", sucursalId);

    const res = await fetch(`/api/export/movimientos?${params}`);
    if (res.ok) {
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "export.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } else {
      alert("Error al generar el archivo.");
    }
    setLoading(false);
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Exportar
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-white rounded-xl border border-neutral-200 shadow-lg p-4 space-y-3">
          <p className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">Exportar Excel</p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="w-full h-8 rounded-lg border border-neutral-200 px-2 text-xs focus:outline-none focus:border-tierra-700"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-500 mb-1">Hasta</label>
              <input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="w-full h-8 rounded-lg border border-neutral-200 px-2 text-xs focus:outline-none focus:border-tierra-700"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-neutral-500 mb-1">Sucursal (opcional)</label>
            <select
              value={sucursalId}
              onChange={(e) => setSucursal(e.target.value)}
              className="w-full h-8 rounded-lg border border-neutral-200 px-2 text-xs focus:outline-none focus:border-tierra-700 bg-white"
            >
              <option value="">Todas las sucursales</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>

          <Button
            variant="primary"
            size="sm"
            loading={loading}
            className="w-full"
            onClick={handleExport}
          >
            Descargar .xlsx
          </Button>
        </div>
      )}
    </div>
  );
}
