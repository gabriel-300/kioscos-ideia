"use client";

import { Fragment, useState } from "react";

const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

export type TransferenciaItemFila = {
  id:                string;
  productoNombre:    string;
  unitLabel:         string | null;
  cantidadEnviada:   number;
  cantidadRecibida:  number | null;
};

export type TransferenciaFila = {
  id:              string;
  fecha:           string;
  estado:          "enviada" | "recibida";
  origenNombre:    string;
  destinoNombre:   string;
  enviadoPor:      string;
  recibidoPor:     string | null;
  notasEnvio:      string | null;
  notasRecepcion:  string | null;
  items:           TransferenciaItemFila[];
};

function EstadoBadge({ estado }: { estado: TransferenciaFila["estado"] }) {
  return estado === "recibida"
    ? <span className="text-xs font-semibold text-selva-700 bg-selva-50 px-2 py-0.5 rounded-full">Recibida</span>
    : <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Pendiente</span>;
}

function ItemsDetalle({ items }: { items: TransferenciaItemFila[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        <div key={i.id} className="flex items-center justify-between gap-3 text-xs bg-white rounded-lg px-3 py-2 border border-neutral-100">
          <span className="font-medium text-neutral-800">{i.productoNombre}</span>
          <span className="tabular-nums text-neutral-600">
            Enviado: {NUM.format(i.cantidadEnviada)} {i.unitLabel === "kg" ? "kg" : "u."}
            {i.cantidadRecibida != null && (
              <>
                {" · "}Recibido:{" "}
                <span className={i.cantidadRecibida < i.cantidadEnviada ? "text-danger font-semibold" : ""}>
                  {NUM.format(i.cantidadRecibida)} {i.unitLabel === "kg" ? "kg" : "u."}
                </span>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TransferenciasTable({ transferencias }: { transferencias: TransferenciaFila[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (transferencias.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-4 py-12 text-center text-sm text-neutral-400">
        Sin transferencias en el período seleccionado.
      </div>
    );
  }

  return (
    <>
      {/* Mobile: tarjetas apiladas */}
      <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {transferencias.map((t) => {
          const isOpen = expanded === t.id;
          return (
            <div key={t.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-3 active:bg-neutral-50"
                onClick={() => setExpanded(isOpen ? null : t.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-neutral-800">{t.origenNombre} → {t.destinoNombre}</span>
                    <p className="text-xs text-neutral-400">
                      {new Date(t.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })} · {t.items.length} {t.items.length === 1 ? "producto" : "productos"}
                    </p>
                  </div>
                  <EstadoBadge estado={t.estado} />
                </div>
              </button>
              {isOpen && (
                <div className="bg-neutral-50 px-3 py-3 space-y-2">
                  <p className="text-xs text-neutral-500">Envió: {t.enviadoPor}{t.recibidoPor && ` · Recibió: ${t.recibidoPor}`}</p>
                  <ItemsDetalle items={t.items} />
                  {t.notasEnvio && <p className="text-xs text-neutral-500 italic">Envío: "{t.notasEnvio}"</p>}
                  {t.notasRecepcion && <p className="text-xs text-neutral-500 italic">Recepción: "{t.notasRecepcion}"</p>}
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
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Origen → Destino</th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Productos</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Estado</th>
              <th className="px-3 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {transferencias.map((t) => {
              const isOpen = expanded === t.id;
              return (
                <Fragment key={t.id}>
                  <tr
                    className="hover:bg-neutral-50/80 transition-colors cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : t.id)}
                  >
                    <td className="px-3 py-2.5 text-neutral-600 tabular-nums">
                      {new Date(t.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-neutral-800">{t.origenNombre} → {t.destinoNombre}</td>
                    <td className="px-3 py-2.5 text-right text-neutral-500 tabular-nums">{t.items.length}</td>
                    <td className="px-3 py-2.5"><EstadoBadge estado={t.estado} /></td>
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
                        <p className="text-xs text-neutral-500 mb-2">
                          Envió: {t.enviadoPor}{t.recibidoPor && ` · Recibió: ${t.recibidoPor}`}
                        </p>
                        <ItemsDetalle items={t.items} />
                        {t.notasEnvio && <p className="text-xs text-neutral-500 italic mt-2">Envío: "{t.notasEnvio}"</p>}
                        {t.notasRecepcion && <p className="text-xs text-neutral-500 italic mt-1">Recepción: "{t.notasRecepcion}"</p>}
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
