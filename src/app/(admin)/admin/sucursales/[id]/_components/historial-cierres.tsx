"use client";

import { useState } from "react";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type Retiro = { id: string; monto: number; motivo: string; created_at: string };

export type CierreConDetalle = {
  fecha:                    string;
  created_at:               string;
  fondo_inicial:            number;
  total_ventas:             number;
  efectivo_declarado:       number;
  billetera_declarada:      number;
  tarjeta_declarada:        number | null;
  transferencia_declarada:  number | null;
  diferencia:               number | null;
  notas:                    string | null;
  retiros:                  Retiro[];
};

export function HistorialCierres({ cierres }: { cierres: CierreConDetalle[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (cierres.length === 0) {
    return <p className="text-sm text-neutral-400">No hay cierres registrados.</p>;
  }

  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-neutral-50 text-neutral-400 text-xs uppercase tracking-wider border-b border-neutral-200">
            <th className="px-4 py-2.5 text-left font-semibold">Fecha</th>
            <th className="px-4 py-2.5 text-right font-semibold">Ventas</th>
            <th className="px-4 py-2.5 text-right font-semibold hidden sm:table-cell">Efectivo</th>
            <th className="px-4 py-2.5 text-right font-semibold hidden sm:table-cell">Billetera</th>
            <th className="px-4 py-2.5 text-right font-semibold hidden md:table-cell">Tarjeta</th>
            <th className="px-4 py-2.5 text-right font-semibold hidden md:table-cell">Transfer.</th>
            <th className="px-4 py-2.5 text-right font-semibold">Diferencia</th>
            <th className="px-4 py-2.5 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {cierres.map((c) => {
            const isOpen = expanded === c.created_at;
            return (
              <>
                <tr
                  key={c.created_at}
                  className="hover:bg-neutral-50 transition-colors cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : c.created_at)}
                >
                  <td className="px-4 py-3 text-neutral-700 font-medium">
                    {new Date(c.fecha + "T00:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                    {AR.format(c.total_ventas)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden sm:table-cell">
                    {c.efectivo_declarado > 0 ? AR.format(c.efectivo_declarado) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden sm:table-cell">
                    {(c.billetera_declarada ?? 0) > 0 ? AR.format(c.billetera_declarada) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden md:table-cell">
                    {(c.tarjeta_declarada ?? 0) > 0 ? AR.format(c.tarjeta_declarada!) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden md:table-cell">
                    {(c.transferencia_declarada ?? 0) > 0 ? AR.format(c.transferencia_declarada!) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.diferencia !== null ? (
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${
                        c.diferencia === 0
                          ? "bg-selva-50 text-selva-700"
                          : c.diferencia > 0
                          ? "bg-blue-50 text-blue-700"
                          : "bg-red-50 text-red-600"
                      }`}>
                        {c.diferencia > 0 ? "+" : ""}{AR.format(c.diferencia)}
                      </span>
                    ) : (
                      <span className="text-neutral-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    <svg
                      className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${c.created_at}-detail`}>
                    <td colSpan={8} className="bg-neutral-50 px-4 py-3">
                      <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-neutral-600 mb-2">
                        <span><span className="text-neutral-400">Fondo inicial:</span> <span className="font-semibold text-neutral-800">{AR.format(c.fondo_inicial)}</span></span>
                        <span><span className="text-neutral-400">Cerrado:</span> <span className="font-semibold text-neutral-800">{new Date(c.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span></span>
                        {c.notas && (
                          <span><span className="text-neutral-400">Notas:</span> <span className="text-neutral-700">{c.notas}</span></span>
                        )}
                      </div>
                      {c.retiros.length > 0 ? (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-neutral-400">
                              <th className="text-left pb-1 font-medium">Retiro efectivo</th>
                              <th className="text-left pb-1 font-medium">Motivo</th>
                              <th className="text-right pb-1 font-medium w-24">Monto</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100">
                            {c.retiros.map((r) => (
                              <tr key={r.id}>
                                <td className="py-1 text-neutral-500">
                                  {new Date(r.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                                </td>
                                <td className="py-1 text-neutral-700">{r.motivo || <span className="text-neutral-300">Sin motivo</span>}</td>
                                <td className="py-1 text-right font-semibold tabular-nums text-amber-700">{AR.format(r.monto)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-xs text-neutral-400">Sin retiros de efectivo en este turno.</p>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
