"use client";

import { useState } from "react";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type DiaChart = { fecha: string; fechaDisplay: string; totalVentas: number };

const ALTURA_PX  = 180;
const LABEL_PX   = 24;   // alto reservado para la etiqueta de fecha debajo de la barra
const TOOLTIP_PX = 56;   // headroom arriba para que el tooltip nunca quede tapado por el overflow-x-auto
const BAR_W = 28;        // ancho de cada columna (coincide con el style width de abajo)
const GAP   = 8;         // gap fijo (no responsive) para poder calcular la posición X de la tendencia en JS

// Regresión lineal simple (mínimos cuadrados) sobre el índice de cada día --
// da la "línea de tendencia" al estilo Excel, no un promedio móvil. Devuelve
// null con menos de 2 puntos (no hay tendencia que trazar).
function calcularTendencia(valores: number[]): number[] | null {
  const n = valores.length;
  if (n < 2) return null;
  const sumX  = valores.reduce((s, _, i) => s + i, 0);
  const sumY  = valores.reduce((s, v) => s + v, 0);
  const sumXY = valores.reduce((s, v, i) => s + i * v, 0);
  const sumXX = valores.reduce((s, _, i) => s + i * i, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const pendiente  = (n * sumXY - sumX * sumY) / denom;
  const ordenada   = (sumY - pendiente * sumX) / n;
  return valores.map((_, i) => ordenada + pendiente * i);
}

// overflow-x: auto en el contenedor hace que overflow-y compute a auto también
// (regla de CSS: si un eje no es "visible", el otro pasa de "visible" a "auto"),
// así que un tooltip position:absolute que sobresalga del contenedor queda
// recortado -- por eso el contenedor es más alto que las barras+label, dejando
// TOOLTIP_PX de aire arriba en vez de depender de que el tooltip "se escape".
export function VentasPorDiaChart({ dias }: { dias: DiaChart[] }) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = Math.max(...dias.map((d) => d.totalVentas), 1);
  const tendencia = calcularTendencia(dias.map((d) => d.totalVentas));

  const anchoTotal = dias.length * BAR_W + Math.max(0, dias.length - 1) * GAP;
  const altoTotal  = ALTURA_PX + LABEL_PX + TOOLTIP_PX;

  function yDeValor(valor: number) {
    const alturaPx = Math.min(ALTURA_PX, Math.max(0, Math.round((valor / max) * ALTURA_PX)));
    return TOOLTIP_PX + (ALTURA_PX - alturaPx);
  }

  const puntosTendencia = tendencia?.map((v, i) => ({
    x: i * (BAR_W + GAP) + BAR_W / 2,
    y: yDeValor(v),
  })) ?? null;

  // Variación de la tendencia entre el primer y último día del período, para
  // el badge de arriba (no es "cuánto vendí hoy vs ayer", es hacia dónde
  // apunta la recta ajustada a todo el rango).
  const variacionTendencia = tendencia && tendencia[0] > 0
    ? ((tendencia[tendencia.length - 1] - tendencia[0]) / tendencia[0]) * 100
    : null;

  return (
    <div>
      {puntosTendencia && (
        <div className="flex items-center gap-2 mb-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-neutral-500">
            <span className="w-4 border-t-2 border-dashed" style={{ borderColor: "#334155" }} />
            Tendencia
          </span>
          {variacionTendencia !== null && (
            <span className={`font-semibold tabular-nums ${variacionTendencia >= 0 ? "text-selva-600" : "text-danger"}`}>
              {variacionTendencia >= 0 ? "↑" : "↓"} {Math.abs(variacionTendencia).toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div className="relative overflow-x-auto pb-1" style={{ height: altoTotal }}>
        {puntosTendencia && (
          <svg
            width={anchoTotal} height={altoTotal}
            className="absolute top-0 left-0 pointer-events-none"
          >
            <polyline
              points={puntosTendencia.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" stroke="#334155" strokeWidth={2} strokeDasharray="5,4" strokeLinecap="round"
            />
          </svg>
        )}
        <div className="flex items-end gap-2" style={{ height: altoTotal, width: anchoTotal }}>
          {dias.map((d, i) => {
            const alturaBarra = Math.max(2, Math.round((d.totalVentas / max) * ALTURA_PX));
            const esActivo = activo === i;
            return (
              <div
                key={d.fecha}
                className="relative flex flex-col items-center justify-end shrink-0"
                style={{ width: BAR_W, height: ALTURA_PX + LABEL_PX }}
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
      </div>
    </div>
  );
}
