"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { SobreEstado } from "./sobre-estado";
import { NotaBadge } from "./nota-badge";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type FilaCierre = {
  id:                      string;
  fechaDisplay:            string;
  sucursalId:              string | null;
  sucursalNombre:          string | null;
  numeroLiquidacion:       number | null;
  encargado:               string;
  fondoInicial:            number | null;
  ventas:                  number;
  efectivo:                number;
  billetera:               number;
  tarjeta:                 number;
  transferencia:           number;
  diferencia:              number | null;
  retiros:                 { motivo: string; monto: number }[];
  totalRetiros:            number;
  fondoSiguiente:          number | null;
  montoSobre:              number | null;
  sobreRetiradoPorNombre:  string | null;
  sobreRetiradoEn:         string | null;
  sobreMontoVerificado:    number | null;
  sobreVerificadoPorNombre: string | null;
  sobreVerificadoEn:       string | null;
  sobreNotas:              string | null;
  notas:                   string | null;
};

function DiferenciaBadge({ d }: { d: number | null }) {
  if (d === null) return <span className="text-neutral-300 text-xs">—</span>;
  if (d === 0)
    return <span className="text-xs font-semibold text-selva-600 bg-selva-50 px-2 py-0.5 rounded-full">Exacto</span>;
  if (d > 0)
    return <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">+{AR.format(d)}</span>;
  return <span className="text-xs font-semibold text-danger bg-danger/5 px-2 py-0.5 rounded-full">{AR.format(d)}</span>;
}

function DetalleCierre({ f }: { f: FilaCierre }) {
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
        <div>
          <p className="text-xs text-neutral-400 mb-0.5">Fondo inicial</p>
          <p className="text-sm font-semibold text-neutral-800 tabular-nums">
            {f.fondoInicial != null ? AR.format(f.fondoInicial) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-400 mb-0.5">Efectivo contado</p>
          <p className="text-sm font-semibold text-neutral-800 tabular-nums">{AR.format(f.efectivo)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-400 mb-0.5">Billetera</p>
          <p className="text-sm font-semibold text-neutral-800 tabular-nums">{AR.format(f.billetera)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-400 mb-0.5">Tarjeta / Transfer.</p>
          <p className="text-sm font-semibold text-neutral-800 tabular-nums">
            {AR.format(f.tarjeta)} / {AR.format(f.transferencia)}
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-400 mb-0.5">Fondo siguiente</p>
          <p className="text-sm font-semibold text-neutral-800 tabular-nums">
            {f.fondoSiguiente != null ? AR.format(f.fondoSiguiente) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-neutral-400 mb-0.5">Retiros del turno</p>
          <p className="text-sm font-semibold text-amber-700 tabular-nums">
            {f.totalRetiros > 0 ? AR.format(f.totalRetiros) : "—"}
          </p>
        </div>
      </div>

      {f.retiros.length > 0 && (
        <table className="w-full text-xs mb-3">
          <thead>
            <tr className="text-neutral-400">
              <th className="text-left pb-1 font-medium">Motivo del retiro</th>
              <th className="text-right pb-1 font-medium w-24">Monto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {f.retiros.map((r, i) => (
              <tr key={i}>
                <td className="py-1 text-neutral-700">{r.motivo || <span className="text-neutral-300">Sin motivo</span>}</td>
                <td className="py-1 text-right font-semibold tabular-nums text-amber-700">{AR.format(r.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {f.notas && (
        <div className="mb-1">
          <NotaBadge nota={f.notas} />
        </div>
      )}
    </div>
  );
}

export function InformeCierresTable({ filas, totales }: {
  filas: FilaCierre[];
  totales: { ventas: number; efectivo: number; billetera: number; tarjeta: number; transferencia: number; diferencia: number; retiros: number };
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (filas.length === 0) {
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
        {filas.map((f) => {
          const isOpen = expanded === f.id;
          return (
            <div key={f.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-3 active:bg-neutral-50"
                onClick={() => setExpanded(isOpen ? null : f.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-neutral-800 capitalize">{f.fechaDisplay}</span>
                    {f.numeroLiquidacion != null && (
                      <span className="ml-1.5 text-xs text-neutral-400">#{f.numeroLiquidacion}</span>
                    )}
                    {f.sucursalId ? (
                      <Link
                        href={`/admin/sucursales/${f.sucursalId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block text-xs text-tierra-700 hover:underline font-medium truncate"
                      >
                        {f.sucursalNombre}
                      </Link>
                    ) : (
                      <p className="text-xs text-neutral-400">—</p>
                    )}
                    <p className="text-xs text-neutral-500">{f.encargado}</p>
                  </div>
                  <svg
                    className={`size-4 shrink-0 text-neutral-400 transition-transform duration-200 mt-0.5 ${isOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="tabular-nums font-semibold text-neutral-800">{AR.format(f.ventas)}</span>
                  <DiferenciaBadge d={f.diferencia} />
                </div>
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <SobreEstado
                    cierreId={f.id}
                    montoSobre={f.montoSobre}
                    retiradoPorNombre={f.sobreRetiradoPorNombre}
                    retiradoEn={f.sobreRetiradoEn}
                    montoVerificado={f.sobreMontoVerificado}
                    verificadoPorNombre={f.sobreVerificadoPorNombre}
                    verificadoEn={f.sobreVerificadoEn}
                    notas={f.sobreNotas}
                  />
                </div>
              </button>
              {isOpen && (
                <div className="bg-neutral-50 px-4 py-4">
                  <DetalleCierre f={f} />
                </div>
              )}
            </div>
          );
        })}
        <div className="px-3 py-3 bg-neutral-50 font-semibold flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Total ({filas.length} cierres)</span>
          <span className="tabular-nums text-neutral-800">{AR.format(totales.ventas)}</span>
        </div>
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sucursal</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Encargado</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Ventas</th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Diferencia</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Sobre</th>
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {filas.map((f) => {
                const isOpen = expanded === f.id;
                return (
                  <Fragment key={f.id}>
                    <tr
                      className="hover:bg-neutral-50/80 transition-colors cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : f.id)}
                    >
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-neutral-800 capitalize">{f.fechaDisplay}</span>
                        {f.numeroLiquidacion != null && (
                          <span className="ml-1.5 text-xs text-neutral-400">#{f.numeroLiquidacion}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {f.sucursalId ? (
                          <Link
                            href={`/admin/sucursales/${f.sucursalId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-tierra-700 hover:underline font-medium"
                          >
                            {f.sucursalNombre}
                          </Link>
                        ) : <span className="text-neutral-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-neutral-500">{f.encargado}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800">
                        {AR.format(f.ventas)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <DiferenciaBadge d={f.diferencia} />
                      </td>
                      <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        <SobreEstado
                          cierreId={f.id}
                          montoSobre={f.montoSobre}
                          retiradoPorNombre={f.sobreRetiradoPorNombre}
                          retiradoEn={f.sobreRetiradoEn}
                          montoVerificado={f.sobreMontoVerificado}
                          verificadoPorNombre={f.sobreVerificadoPorNombre}
                          verificadoEn={f.sobreVerificadoEn}
                          notas={f.sobreNotas}
                        />
                      </td>
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
                        <td colSpan={7} className="bg-neutral-50 px-4 py-4">
                          <DetalleCierre f={f} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
              <td className="px-3 py-2.5 text-xs uppercase tracking-wide text-neutral-500" colSpan={3}>
                Total ({filas.length} cierres)
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800">{AR.format(totales.ventas)}</td>
              <td className="px-3 py-2.5 text-center">
                <DiferenciaBadge d={totales.diferencia} />
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      </div>
    </>
  );
}
