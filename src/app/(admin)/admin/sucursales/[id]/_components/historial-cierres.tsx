"use client";

import { Fragment, useState, useTransition } from "react";
import { marcarSobreRetirado } from "../cierre-actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type Retiro = { id: string; monto: number; motivo: string; created_at: string };
type Socio  = { id: string; nombre: string };

export type CierreConDetalle = {
  id:                       string;
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
  fondo_siguiente:          number | null;
  sobre_retirado_por:       string | null;
  sobre_retirado_en:        string | null;
};

function SobreRetiro({ cierreId, sucursalId, socios }: { cierreId: string; sucursalId: string; socios: Socio[] }) {
  const [pending, startTransition] = useTransition();
  const [socioId, setSocioId] = useState(socios[0]?.id ?? "");
  const [error, setError]     = useState<string | null>(null);

  function handleClick() {
    if (!socioId) { setError("Elegí quién se lo lleva"); return; }
    setError(null);
    startTransition(async () => {
      try { await marcarSobreRetirado(cierreId, sucursalId, socioId); }
      catch (e) { setError((e as Error).message); }
    });
  }

  if (socios.length === 0) {
    return <p className="text-xs text-amber-600">No hay socios con usuario admin cargados todavía.</p>;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <select
        value={socioId}
        onChange={(e) => setSocioId(e.target.value)}
        className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-xs focus:outline-none focus:border-tierra-700"
      >
        {socios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="h-8 px-3 rounded-lg bg-tierra-700 text-white text-xs font-semibold hover:bg-tierra-800 transition-colors disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Marcar retirado"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export function HistorialCierres({ cierres, sucursalId, socios = [] }: { cierres: CierreConDetalle[]; sucursalId: string; socios?: Socio[] }) {
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
              <Fragment key={c.created_at}>
                <tr
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
                  <tr>
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
                      {(() => {
                        const montoSobre = c.fondo_siguiente != null ? Math.max(0, c.efectivo_declarado - c.fondo_siguiente) : 0;
                        if (montoSobre <= 0) return null;
                        return (
                          <div className="mt-3 pt-3 border-t border-neutral-200">
                            <p className="text-xs text-neutral-400 mb-1.5">
                              En sobre: <span className="font-semibold text-neutral-800">{AR.format(montoSobre)}</span>
                            </p>
                            {c.sobre_retirado_por ? (
                              <p className="text-xs text-selva-700">
                                ✓ Retirado {c.sobre_retirado_en && `el ${new Date(c.sobre_retirado_en).toLocaleDateString("es-AR", { day: "numeric", month: "short" })} a las ${new Date(c.sobre_retirado_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
                              </p>
                            ) : (
                              <SobreRetiro cierreId={c.id} sucursalId={sucursalId} socios={socios} />
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
