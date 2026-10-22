"use client";

import { useEffect, useRef, useState } from "react";
import type { TramoHorario } from "@/lib/pedidos/horario";

// Editor de horario semanal compartido por el horario de atención del local y el horario de envíos: un día
// abierto tiene uno o más horarios (turno partido: 08:00–12:00 y 16:00–20:00). Avisa cada cambio con
// onChange: null = "sin horario propio" (la casilla de arriba), o la lista de tramos.

// Orden de la semana como la piensa el local (lunes primero); dia = valor de Date.getDay() (0 = domingo),
// que es lo que se guarda.
const DIAS: { dia: number; nombre: string }[] = [
  { dia: 1, nombre: "Lunes" }, { dia: 2, nombre: "Martes" }, { dia: 3, nombre: "Miércoles" },
  { dia: 4, nombre: "Jueves" }, { dia: 5, nombre: "Viernes" }, { dia: 6, nombre: "Sábado" }, { dia: 0, nombre: "Domingo" },
];

type Franja = { abre: string; cierra: string };
type FilaDia = { abierto: boolean; franjas: Franja[] };
const MAX_FRANJAS = 3;

function filasDesdeHorario(horario: TramoHorario[] | null): Record<number, FilaDia> {
  const filas: Record<number, FilaDia> = {};
  const sinHorarioCargado = !horario;
  for (const { dia } of DIAS) {
    const delDia = (horario ?? [])
      .filter((x) => x.dia === dia)
      .map((t) => ({ abre: t.abre.padStart(5, "0"), cierra: t.cierra.padStart(5, "0") }))
      .sort((a, b) => a.abre.localeCompare(b.abre));
    // Sin horario cargado, al tildar "tengo horario" arrancan todos los días abiertos (más fácil de
    // ajustar que tener que tildar siete).
    filas[dia] = delDia.length > 0
      ? { abierto: true, franjas: delDia }
      : { abierto: sinHorarioCargado, franjas: [{ abre: "08:00", cierra: sinHorarioCargado ? "22:00" : "00:00" }] };
  }
  return filas;
}

function tramosDesdeFilas(filas: Record<number, FilaDia>): TramoHorario[] {
  return DIAS.filter(({ dia }) => filas[dia].abierto).flatMap(({ dia }) => filas[dia].franjas.map((f) => ({ dia, abre: f.abre, cierra: f.cierra })));
}

const inputCls = "h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20";

export function EditorHorario({ titulo, textoSin, inicial, onChange }: {
  titulo:   string;
  textoSin: string;                                  // la casilla de "sin horario propio" (ej. "Sin horario (siempre abierto)")
  inicial:  TramoHorario[] | null;                   // null = sin horario propio
  onChange: (horario: TramoHorario[] | null) => void;
}) {
  const [sinHorario, setSinHorario] = useState(!inicial);
  const [filas, setFilas] = useState(() => filasDesdeHorario(inicial));

  // Avisa hacia arriba cada cambio (sin disparar de más si quien lo usa cambia la función de lugar).
  const avisar = useRef(onChange);
  avisar.current = onChange;
  useEffect(() => { avisar.current(sinHorario ? null : tramosDesdeFilas(filas)); }, [sinHorario, filas]);

  function cambiarFila(dia: number, parcial: Partial<FilaDia>) {
    setFilas((prev) => ({ ...prev, [dia]: { ...prev[dia], ...parcial } }));
  }

  function cambiarFranja(dia: number, i: number, parcial: Partial<Franja>) {
    setFilas((prev) => ({ ...prev, [dia]: { ...prev[dia], franjas: prev[dia].franjas.map((f, j) => (j === i ? { ...f, ...parcial } : f)) } }));
  }

  function agregarFranja(dia: number) {
    setFilas((prev) => {
      const franjas = prev[dia].franjas;
      if (franjas.length >= MAX_FRANJAS) return prev;
      // La nueva arranca dos horas después del cierre de la última, para que no se pise.
      const ultima = franjas[franjas.length - 1];
      const [h, m] = ultima.cierra.split(":").map((n) => parseInt(n, 10));
      const abre = h >= 20 ? ultima.cierra : `${String(h + 2).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      return { ...prev, [dia]: { ...prev[dia], franjas: [...franjas, { abre, cierra: "23:00" }] } };
    });
  }

  function quitarFranja(dia: number, i: number) {
    setFilas((prev) => ({ ...prev, [dia]: { ...prev[dia], franjas: prev[dia].franjas.filter((_, j) => j !== i) } }));
  }

  function copiarLunesATodos() {
    const lunes = filas[1];
    setFilas(Object.fromEntries(DIAS.map(({ dia }) => [dia, { abierto: lunes.abierto, franjas: lunes.franjas.map((f) => ({ ...f })) }])) as Record<number, FilaDia>);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{titulo}</p>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
            <input type="checkbox" checked={sinHorario} onChange={(e) => setSinHorario(e.target.checked)} className="size-3.5 rounded border-neutral-300" />
            {textoSin}
          </label>
          {!sinHorario && (
            <button type="button" onClick={copiarLunesATodos} className="text-xs text-tierra-700 hover:underline">Copiar el lunes a todos los días</button>
          )}
        </div>
      </div>
      {!sinHorario && (
        <div className="space-y-1.5">
          {DIAS.map(({ dia, nombre }) => {
            const fila = filas[dia];
            return (
              <div key={dia} className="flex items-start gap-3 flex-wrap">
                <label className="flex h-10 items-center gap-2 w-28 text-sm text-neutral-700 cursor-pointer">
                  <input type="checkbox" checked={fila.abierto} onChange={(e) => cambiarFila(dia, { abierto: e.target.checked })} className="size-4 rounded border-neutral-300" />
                  {nombre}
                </label>
                <div className="space-y-1.5">
                  {fila.franjas.map((f, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <input type="time" disabled={!fila.abierto} value={f.abre} onChange={(e) => cambiarFranja(dia, i, { abre: e.target.value })} className={`${inputCls} w-32 disabled:opacity-40`} />
                      <span className="text-sm text-neutral-400">a</span>
                      <input type="time" disabled={!fila.abierto} value={f.cierra} onChange={(e) => cambiarFranja(dia, i, { cierra: e.target.value })} className={`${inputCls} w-32 disabled:opacity-40`} />
                      {fila.abierto && fila.franjas.length > 1 && (
                        <button type="button" onClick={() => quitarFranja(dia, i)} aria-label="Quitar este horario" className="size-8 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-red-600">✕</button>
                      )}
                    </div>
                  ))}
                  {fila.abierto && fila.franjas.length < MAX_FRANJAS && (
                    <button type="button" onClick={() => agregarFranja(dia)} className="text-xs text-tierra-700 hover:underline">+ Agregar otro horario (turno partido)</button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-neutral-400 pt-1">Si cierra después de medianoche, poné la hora de cierre de la madrugada (ej. 08:00 a 00:30). Eso solo se puede en el último horario del día.</p>
        </div>
      )}
    </div>
  );
}
