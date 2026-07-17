"use client";

import { Fragment, useState } from "react";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type TurnoFila = {
  id:                 string;
  numeroLiquidacion:  number | null;
  hora:               string;
  sucursalNombre:     string;
  encargado:          string;
  ventas:             number;
  diferencia:         number | null;
};

export type DiaFila = {
  fecha:        string;
  fechaDisplay: string;
  totalVentas:  number;
  turnos:       TurnoFila[];
};

function DiferenciaBadge({ d }: { d: number | null }) {
  if (d === null) return <span className="text-neutral-300 text-xs">—</span>;
  if (d === 0)
    return <span className="text-xs font-semibold text-selva-600 bg-selva-50 px-2 py-0.5 rounded-full">Exacto</span>;
  if (d > 0)
    return <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">+{AR.format(d)}</span>;
  return <span className="text-xs font-semibold text-danger bg-danger/5 px-2 py-0.5 rounded-full">{AR.format(d)}</span>;
}

function TurnosDetalle({ turnos }: { turnos: TurnoFila[] }) {
  return (
    <div className="space-y-2">
      {turnos.map((t) => (
        <div key={t.id} className="flex items-center justify-between gap-3 text-xs bg-white rounded-lg px-3 py-2 border border-neutral-100">
          <div className="min-w-0">
            <span className="font-medium text-neutral-800">
              {t.sucursalNombre}{t.numeroLiquidacion != null ? ` · #${t.numeroLiquidacion}` : ""}
            </span>
            <p className="text-neutral-400 mt-0.5">{t.hora} · {t.encargado}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="tabular-nums font-semibold text-neutral-800">{AR.format(t.ventas)}</span>
            <DiferenciaBadge d={t.diferencia} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiasTable({ dias }: { dias: DiaFila[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (dias.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-400">
        Sin cierres en el período seleccionado.
      </div>
    );
  }

  return (
    <>
      {/* Mobile: tarjetas apiladas */}
      <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {dias.map((d) => {
          const isOpen = expanded === d.fecha;
          return (
            <div key={d.fecha}>
              <button
                type="button"
                className="w-full text-left px-3 py-3 active:bg-neutral-50"
                onClick={() => setExpanded(isOpen ? null : d.fecha)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-neutral-800 capitalize">{d.fechaDisplay}</span>
                    <p className="text-xs text-neutral-400">{d.turnos.length} {d.turnos.length === 1 ? "turno" : "turnos"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums font-semibold text-neutral-800">{AR.format(d.totalVentas)}</span>
                    <svg
                      className={`size-4 text-neutral-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </div>
              </button>
              {isOpen && (
                <div className="bg-neutral-50 px-3 py-3">
                  <TurnosDetalle turnos={d.turnos} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Turnos</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Ventas</th>
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {dias.map((d) => {
              const isOpen = expanded === d.fecha;
              return (
                <Fragment key={d.fecha}>
                  <tr
                    className="hover:bg-neutral-50/80 transition-colors cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : d.fecha)}
                  >
                    <td className="px-3 py-2.5 font-medium text-neutral-800 capitalize">{d.fechaDisplay}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-500">{d.turnos.length}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800">{AR.format(d.totalVentas)}</td>
                    <td className="px-3 py-2.5 text-neutral-400">
                      <svg
                        className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={4} className="bg-neutral-50 px-4 py-4">
                        <TurnosDetalle turnos={d.turnos} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
