"use client";

import { Fragment, useState } from "react";

const AR  = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

const ROLE_LABEL: Record<string, string> = {
  admin:     "Administrador",
  encargado: "Encargado",
  vendedor:  "Vendedor",
};

export type VentaDetalle = {
  id:              string;
  fecha:           string;
  hora:            string;
  sucursalNombre:  string;
  canalLabel:      string;
  monto:           number;
};

export type VendedorFila = {
  vendedorId:  string;
  nombre:      string;
  role:        string | null;
  ventasCount: number;
  facturado:   number;
  unidades:    number;
  ventas:      VentaDetalle[];
};

function VentasDetalle({ ventas }: { ventas: VentaDetalle[] }) {
  return (
    <div className="space-y-2">
      {ventas.map((v) => (
        <div key={v.id} className="flex items-center justify-between gap-3 text-xs bg-white rounded-lg px-3 py-2 border border-neutral-100">
          <div className="min-w-0">
            <span className="font-medium text-neutral-800">{v.sucursalNombre}</span>
            <p className="text-neutral-400 mt-0.5">
              {new Date(v.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })} · {v.hora} · {v.canalLabel}
            </p>
          </div>
          <span className="tabular-nums font-semibold text-neutral-800 shrink-0">{AR.format(v.monto)}</span>
        </div>
      ))}
    </div>
  );
}

export function VendedoresTable({ vendedores }: { vendedores: VendedorFila[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (vendedores.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-400">
        Sin ventas en el período seleccionado.
      </div>
    );
  }

  return (
    <>
      {/* Mobile: tarjetas apiladas */}
      <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {vendedores.map((v, i) => {
          const isOpen = expanded === v.vendedorId;
          return (
            <div key={v.vendedorId}>
              <button
                type="button"
                className="w-full text-left px-3 py-3 active:bg-neutral-50"
                onClick={() => setExpanded(isOpen ? null : v.vendedorId)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="shrink-0 size-5 rounded-full bg-tierra-50 text-tierra-700 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                    <div className="min-w-0">
                      <span className="font-medium text-neutral-800 truncate block">{v.nombre}</span>
                      <p className="text-xs text-neutral-400">
                        {v.role ? `${ROLE_LABEL[v.role] ?? v.role} · ` : ""}{v.ventasCount} {v.ventasCount === 1 ? "venta" : "ventas"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums font-semibold text-neutral-800">{AR.format(v.facturado)}</span>
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
                  <VentasDetalle ventas={v.ventas} />
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
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Vendedor</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Ventas</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Unidades</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Facturado</th>
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {vendedores.map((v, i) => {
              const isOpen = expanded === v.vendedorId;
              return (
                <Fragment key={v.vendedorId}>
                  <tr
                    className="hover:bg-neutral-50/80 transition-colors cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : v.vendedorId)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 size-5 rounded-full bg-tierra-50 text-tierra-700 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                        <div>
                          <span className="font-medium text-neutral-800">{v.nombre}</span>
                          {v.role && <p className="text-xs text-neutral-400">{ROLE_LABEL[v.role] ?? v.role}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-500 tabular-nums">{v.ventasCount}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-500 tabular-nums">{NUM.format(v.unidades)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800">{AR.format(v.facturado)}</td>
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
                      <td colSpan={5} className="bg-neutral-50 px-4 py-4">
                        <VentasDetalle ventas={v.ventas} />
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
