"use client";

import { useState } from "react";

const AR  = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR");

export type CeldaHeatmap = { diaIdx: number; hora: number; facturado: number; cantidadVentas: number };

const DIAS_LABEL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
// diaIdx acá es 0=domingo..6=sábado (mismo criterio que diaSemanaIdxAR) -- se
// reordena para mostrar la semana empezando el lunes, más natural para leer.
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

// Rampa secuencial de un solo hue (tierra, de más claro a más oscuro) -- misma
// paleta que ya usa el resto de la app para magnitud, nunca un arcoíris.
const RAMPA = ["#EAF3FB", "#C4DCF2", "#8DBDE0", "#4D8EC8", "#2A64AB", "#1C4585", "#153464", "#0E2544"];

function colorDeValor(valor: number, max: number): string {
  if (valor <= 0 || max <= 0) return "#F5F7FA"; // neutral-50, sin ventas
  const paso = Math.min(RAMPA.length - 1, Math.floor((valor / max) * (RAMPA.length - 1)) + 1);
  return RAMPA[paso];
}

export function HeatmapHorario({ celdas, horaMin, horaMax }: { celdas: CeldaHeatmap[]; horaMin: number; horaMax: number }) {
  const [activa, setActiva] = useState<string | null>(null);

  const mapa = new Map(celdas.map((c) => [`${c.diaIdx}-${c.hora}`, c]));
  const horas = Array.from({ length: horaMax - horaMin + 1 }, (_, i) => horaMin + i);
  const max = Math.max(...celdas.map((c) => c.facturado), 1);

  const CELL = 30;
  const GAP  = 2;
  const LABEL_W = 76;

  return (
    <div className="overflow-x-auto pb-2">
      <div style={{ minWidth: LABEL_W + horas.length * (CELL + GAP) }}>
        {/* Encabezado de horas */}
        <div className="flex" style={{ gap: GAP, marginLeft: LABEL_W }}>
          {horas.map((h) => (
            <div key={h} className="text-[10px] text-neutral-400 text-center shrink-0" style={{ width: CELL }}>
              {h}
            </div>
          ))}
        </div>
        <div className="flex flex-col mt-1" style={{ gap: GAP }}>
          {ORDEN_DIAS.map((diaIdx) => (
            <div key={diaIdx} className="flex items-center" style={{ gap: GAP }}>
              <div className="text-xs text-neutral-500 shrink-0 text-right pr-2" style={{ width: LABEL_W }}>
                {DIAS_LABEL[ORDEN_DIAS.indexOf(diaIdx)]}
              </div>
              {horas.map((h) => {
                const key = `${diaIdx}-${h}`;
                const celda = mapa.get(key);
                const valor = celda?.facturado ?? 0;
                const esActiva = activa === key;
                return (
                  <div
                    key={h}
                    className="relative shrink-0 rounded-[3px] cursor-default transition-[outline]"
                    style={{
                      width: CELL, height: CELL,
                      background: colorDeValor(valor, max),
                      outline: esActiva ? "2px solid #0E2544" : "none",
                      outlineOffset: -2,
                    }}
                    onMouseEnter={() => setActiva(key)}
                    onMouseLeave={() => setActiva((a) => (a === key ? null : a))}
                  >
                    {esActiva && (
                      <div
                        className="absolute z-10 bottom-full mb-1.5 left-1/2 -translate-x-1/2 rounded-lg bg-neutral-900 text-white text-xs px-2.5 py-1.5 whitespace-nowrap shadow-lg pointer-events-none"
                      >
                        <p className="font-semibold tabular-nums">{AR.format(valor)}</p>
                        <p className="text-neutral-300">
                          {DIAS_LABEL[ORDEN_DIAS.indexOf(diaIdx)]} {h}hs · {NUM.format(celda?.cantidadVentas ?? 0)} venta{celda?.cantidadVentas === 1 ? "" : "s"}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Leyenda de la escala */}
        <div className="flex items-center gap-1.5 mt-4" style={{ marginLeft: LABEL_W }}>
          <span className="text-[10px] text-neutral-400">Menos</span>
          {RAMPA.map((c) => (
            <div key={c} className="rounded-[2px]" style={{ width: 14, height: 10, background: c }} />
          ))}
          <span className="text-[10px] text-neutral-400">Más</span>
        </div>
      </div>
    </div>
  );
}
