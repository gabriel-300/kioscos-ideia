"use client";

import { useMemo, useState } from "react";
import { filtrarFacturas, numeroImpreso, type FilaFactura } from "@/lib/arca/buscar";
import { lineasParaReimprimir } from "@/lib/arca/ticket-datos";
import { abrirTicket, armarTicketHtml, esReimpresion, letraCbte } from "@/lib/arca/ticket-html";
import { conRetencion } from "@/lib/arca/tipos";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

/**
 * Facturas emitidas de esta sucursal, para buscar y volver a imprimir. Muestra las facturas de las mismas ventas que
 * el historial (cada empleado ve las de su turno; el administrador y el concesionario, todas). Las reimpresiones salen
 * marcadas COPIA cuando pasaron más de unos minutos desde que ARCA aprobó la factura.
 */
export function FacturasSucursal({ sucursalNombre, facturas }: { sucursalNombre: string; facturas: FilaFactura[] }) {
  const [consulta, setConsulta] = useState("");
  const visibles = useMemo(() => filtrarFacturas(facturas, consulta), [facturas, consulta]);

  const imprimir = (f: FilaFactura) => {
    const c = f.comprobante;
    abrirTicket(armarTicketHtml({
      lineas: lineasParaReimprimir(f.lineas.map((l) => ({ cantidad: l.cantidad, precio_unitario: l.precio, subtotal: l.subtotal, product: { name: l.nombre } })), Number(c.imp_total)),
      total: Number(c.imp_total),
      fecha: f.fecha,
      id: f.movimientoId.slice(-8).toUpperCase(),
      sucursalNombre,
      factura: c,
      copia: esReimpresion(c.emitido_en),
    }));
  };

  return (
    <details className="rounded-xl border border-neutral-200 bg-white">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3">
        <span className="text-sm font-semibold text-neutral-900">Facturas emitidas — buscar y reimprimir</span>
        <span className="text-xs text-neutral-400">{facturas.length} {facturas.length === 1 ? "factura" : "facturas"}</span>
      </summary>
      <div className="border-t border-neutral-100 p-4">
        <input
          type="search" value={consulta} onChange={(e) => setConsulta(e.target.value)}
          placeholder="Buscar por número, importe, CUIT/DNI del cliente o producto…"
          className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:border-tierra-700 focus:outline-none"
        />
        {facturas.length === 0 ? (
          <p className="mt-4 text-center text-sm text-neutral-400">Todavía no hay facturas emitidas en lo que podés ver de esta sucursal.</p>
        ) : visibles.length === 0 ? (
          <p className="mt-4 text-center text-sm text-neutral-400">Ninguna factura coincide con «{consulta}».</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {visibles.map((f) => {
              const c = f.comprobante;
              const doc = c.doc_nro && c.doc_nro !== "0" ? `${c.doc_tipo === 80 ? "CUIT" : "DNI"} ${c.doc_nro}` : "Consumidor Final";
              return (
                <li key={f.movimientoId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium text-neutral-900">
                      Factura {letraCbte(c)}{conRetencion(c.cbte_tipo) ? " (sujeta a retención)" : ""} · <span className="tabular-nums">{numeroImpreso(c)}</span>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {new Date(f.creadaEn).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {doc}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums text-neutral-800">{AR.format(Number(c.imp_total))}</span>
                    <button
                      onClick={() => imprimir(f)}
                      className="h-9 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
                      title="Volver a imprimir esta factura"
                    >
                      Imprimir
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
