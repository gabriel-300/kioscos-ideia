"use client";

import { useState } from "react";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type DiaChart = { fecha: string; fechaDisplay: string; totalVentas: number };

const ALTURA_PX  = 180;
const LABEL_PX   = 24;   // alto reservado para la etiqueta de fecha debajo de la barra
const TOOLTIP_PX = 56;   // headroom arriba para que el tooltip nunca quede tapado por el overflow-x-auto

// overflow-x: auto en el contenedor hace que overflow-y compute a auto también
// (regla de CSS: si un eje no es "visible", el otro pasa de "visible" a "auto"),
// así que un tooltip position:absolute que sobresalga del contenedor queda
// recortado -- por eso el contenedor es más alto que las barras+label, dejando
// TOOLTIP_PX de aire arriba en vez de depender de que el tooltip "se escape".
export function VentasPorDiaChart({ dias }: { dias: DiaChart[] }) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = Math.max(...dias.map((d) => d.totalVentas), 1);

  return (
    <div
      className="flex items-end gap-1.5 md:gap-2 overflow-x-auto pb-1"
      style={{ height: ALTURA_PX + LABEL_PX + TOOLTIP_PX }}
    >
      {dias.map((d, i) => {
        const alturaBarra = Math.max(2, Math.round((d.totalVentas / max) * ALTURA_PX));
        const esActivo = activo === i;
        return (
          <div
            key={d.fecha}
            className="relative flex flex-col items-center justify-end shrink-0"
            style={{ width: 28, height: ALTURA_PX + LABEL_PX }}
            onMouseEnter={() => setActivo(i)}
            onMouseLeave={() => setActivo(null)}
            onClick={() => setActivo(esActivo ? null : i)}
          >
            {esActivo && (
              <div
                className="absolute bottom-full mb-1 z-10 rounded-lg bg-neutral-900 text-white text-xs px-2.5 py-1.5 whitespace-nowrap shadow-lg pointer-events-none"
                style={{ left: "50%", transform: "translateX(-50%)" }}
              >
                <p className="font-semibold tabular-nums">{AR.format(d.totalVentas)}</p>
                <p className="text-neutral-300 capitalize">{d.fechaDisplay}</p>
              </div>
            )}
            <div
              className={`w-3.5 rounded-t-md transition-colors cursor-pointer ${esActivo ? "bg-tierra-800" : "bg-tierra-700"}`}
              style={{ height: alturaBarra }}
            />
            <span className="text-[10px] text-neutral-400 mt-1.5 whitespace-nowrap">{d.fechaDisplay}</span>
          </div>
        );
      })}
    </div>
  );
}
