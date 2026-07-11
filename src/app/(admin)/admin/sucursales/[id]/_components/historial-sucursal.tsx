"use client";

import { Fragment, useState, useMemo } from "react";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type Retiro = { id: string; fecha: string; monto: number; motivo: string; created_at: string; comprobante_image_url?: string | null };

const TIPO_LABEL: Record<string, string> = { entrega: "Entrega", devolucion: "Devolución", venta: "Venta", ajuste: "Ajuste" };
const TIPO_COLOR: Record<string, string> = {
  entrega:    "bg-selva-100 text-selva-700",
  devolucion: "bg-warning-bg text-warning",
  venta:      "bg-blue-50 text-blue-700",
  ajuste:     "bg-neutral-100 text-neutral-500",
};

type Item = {
  id: string;
  cantidad: number;
  precio_unitario: number | null;
  subtotal: number | null;
  product: { name: string; sku: string } | null;
};

// "pedido_ya" (sin sufijo) queda para ventas históricas de antes del split en
// dos canales -- no se reescribe la data vieja, solo se sigue mostrando.
const CANAL_LABEL: Record<string, string> = {
  consumidor_final:     "Consumidor Final",
  pedido_ya:             "Pedido Ya",
  pedido_ya_efectivo:    "Pedido Ya Efectivo",
  pedido_ya_plataforma:  "Pedido Ya Plataforma",
  cuenta_corriente:      "Cta. Cte.",
  ambulante:              "Ambulante",
};
const CANAL_COLOR: Record<string, string> = {
  consumidor_final:     "bg-blue-50 text-blue-700",
  pedido_ya:             "bg-orange-50 text-orange-700",
  pedido_ya_efectivo:    "bg-orange-50 text-orange-700",
  pedido_ya_plataforma:  "bg-sky-50 text-sky-700",
  cuenta_corriente:      "bg-purple-50 text-purple-700",
  ambulante:              "bg-emerald-50 text-emerald-700",
};

type Movimiento = {
  id: string;
  fecha: string;
  tipo: "entrega" | "devolucion" | "ajuste" | "venta";
  notas: string | null;
  canal?: string | null;
  personal_id?: string | null;
  created_at: string;
  movimiento_items: Item[];
};

function printTicket(m: Movimiento, sucursalNombre: string) {
  const total = m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
  const fecha = new Date(m.fecha + "T00:00:00").toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const id = m.id.slice(-8).toUpperCase();

  const rows = m.movimiento_items.map((item) => `
    <tr>
      <td style="padding:4px 0;border-bottom:1px solid #eee">${item.product?.name ?? "Producto"}</td>
      <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:center">${item.cantidad}</td>
      <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right">${AR.format(item.precio_unitario ?? 0)}</td>
      <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${item.subtotal != null ? AR.format(item.subtotal) : "—"}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Ticket ${id}</title>
  <style>
    body { font-family: monospace; font-size: 12px; width: 280px; margin: 0 auto; padding: 12px; }
    h1 { font-size: 15px; font-weight: 800; margin: 0 0 2px; }
    .sub { color: #666; margin-bottom: 10px; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #999; padding-bottom: 4px; border-bottom: 2px solid #000; }
    th:nth-child(2),th:nth-child(3),th:nth-child(4){text-align:right}
    .total { font-size: 16px; font-weight: 800; text-align: right; margin-top: 10px; border-top: 2px solid #000; padding-top: 6px; }
    .footer { text-align: center; color: #999; font-size: 10px; margin-top: 12px; border-top: 1px dashed #ccc; padding-top: 8px; }
    @media print { body { width: 100%; } }
  </style></head><body>
  <h1>Kioscos IDEIA</h1>
  <div class="sub">${sucursalNombre}</div>
  <div class="sub">${fecha} · #${id}</div>
  <table>
    <thead><tr><th>Producto</th><th style="text-align:right">Cant</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">TOTAL: ${AR.format(total)}</div>
  <div class="footer">En Minutas — Kioscos IDEIA</div>
  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}<\/script>
  </body></html>`;

  const w = window.open("", "_blank", "width=340,height=500");
  w?.document.write(html);
  w?.document.close();
}

export function HistorialSucursal({
  movimientos,
  sucursalNombre = "",
  retiros = [],
  personalMap = {},
}: {
  movimientos:    Movimiento[];
  sucursalNombre?: string;
  retiros?:       Retiro[];
  personalMap?:   Record<string, string>;
}) {
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [mesFilter, setMesFilter] = useState("");
  const [tipoFilter, setTipo]     = useState("all");

  const mesesDisponibles = useMemo(() => {
    const set = new Set([
      ...movimientos.map((m) => m.fecha.slice(0, 7)),
      ...retiros.map((r) => r.fecha.slice(0, 7)),
    ]);
    return Array.from(set).sort().reverse();
  }, [movimientos, retiros]);

  const filtered = useMemo(() => {
    return movimientos.filter((m) => {
      if (mesFilter && !m.fecha.startsWith(mesFilter)) return false;
      if (tipoFilter !== "all" && m.tipo !== tipoFilter) return false;
      return true;
    });
  }, [movimientos, mesFilter, tipoFilter]);

  const filteredRetiros = useMemo(() => {
    if (tipoFilter !== "all" && tipoFilter !== "retiro") return [];
    return retiros.filter((r) => {
      if (mesFilter && !r.fecha.startsWith(mesFilter)) return false;
      return true;
    });
  }, [retiros, mesFilter, tipoFilter]);

  if (movimientos.length === 0 && retiros.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
        Todavía no hay movimientos para esta sucursal.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={mesFilter}
          onChange={(e) => setMesFilter(e.target.value)}
          className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
        >
          <option value="">Todos los períodos</option>
          {mesesDisponibles.map((m) => {
            const [y, mo] = m.split("-");
            const label = new Date(+y, +mo - 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
            return <option key={m} value={m}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>;
          })}
        </select>
        <select
          value={tipoFilter}
          onChange={(e) => setTipo(e.target.value)}
          className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
        >
          <option value="all">Todos los tipos</option>
          <option value="entrega">Entregas</option>
          <option value="venta">Ventas</option>
          <option value="devolucion">Devoluciones</option>
          <option value="ajuste">Ajustes</option>
          <option value="retiro">Retiros de efectivo</option>
        </select>
        <span className="text-sm text-neutral-400">{filtered.length + filteredRetiros.length} registros</span>
      </div>

    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 bg-neutral-50">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Tipo</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden md:table-cell">Notas</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Total</th>
            <th className="px-4 py-3 w-16" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {filtered.length === 0 && filteredRetiros.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-400">Sin registros para el filtro seleccionado.</td></tr>
          ) : (
            <>
              {/* Retiros */}
              {filteredRetiros.map((r) => (
                <tr key={`retiro-${r.id}`} className="bg-amber-50/40 hover:bg-amber-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-neutral-800 tabular-nums">
                    {new Date(r.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                    <span className="block text-[11px] font-normal text-neutral-400">
                      {new Date(r.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                      Retiro efectivo
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 hidden md:table-cell">
                    {r.motivo || <span className="text-neutral-300">Sin motivo</span>}
                    {r.comprobante_image_url && (
                      <a
                        href={r.comprobante_image_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 text-xs text-tierra-700 hover:underline"
                      >
                        Ver comprobante
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">
                    {AR.format(r.monto)}
                  </td>
                  <td className="px-4 py-3 w-16" />
                </tr>
              ))}
              {/* Movimientos */}
              {filtered.map((m) => {
                const total  = m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
                const isOpen = expanded === m.id;
                return (
                  <Fragment key={m.id}>
                    <tr
                      className="hover:bg-neutral-50 transition-colors cursor-pointer"
                      onClick={() => setExpanded(isOpen ? null : m.id)}
                    >
                      <td className="px-4 py-3 font-medium text-neutral-800 tabular-nums">
                        {new Date(m.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                        <span className="block text-[11px] font-normal text-neutral-400">
                          {new Date(m.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${TIPO_COLOR[m.tipo]}`}>
                            {TIPO_LABEL[m.tipo]}
                          </span>
                          {m.tipo === "venta" && m.canal && m.canal !== "consumidor_final" && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-fit ${CANAL_COLOR[m.canal] ?? "bg-neutral-100 text-neutral-500"}`}>
                              {CANAL_LABEL[m.canal] ?? m.canal}
                            </span>
                          )}
                          {m.canal === "cuenta_corriente" && m.personal_id && personalMap[m.personal_id] && (
                            <span className="text-xs text-purple-700 font-semibold">
                              {personalMap[m.personal_id]}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-500 hidden md:table-cell">
                        {m.notas ?? <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-800">
                        {total > 0 ? AR.format(total) : <span className="text-neutral-300 font-normal text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-neutral-400">
                        <div className="flex items-center justify-end gap-1">
                          {m.tipo === "venta" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); printTicket(m, sucursalNombre); }}
                              className="p-1 rounded hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                              title="Imprimir ticket"
                            >
                              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" />
                              </svg>
                            </button>
                          )}
                          <svg
                            className={`size-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="bg-neutral-50 px-4 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-neutral-400">
                                <th className="text-left pb-1 font-medium">Producto</th>
                                <th className="text-right pb-1 font-medium w-16">Cant.</th>
                                <th className="text-right pb-1 font-medium w-24 hidden sm:table-cell">Precio unit.</th>
                                <th className="text-right pb-1 font-medium w-24">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-neutral-100">
                              {m.movimiento_items.map((item) => (
                                <tr key={item.id}>
                                  <td className="py-1 text-neutral-700">
                                    {item.product?.name ?? <span className="text-neutral-400 italic">Producto eliminado</span>}
                                    {item.product?.sku && <span className="ml-1.5 text-neutral-400">{item.product.sku}</span>}
                                  </td>
                                  <td className="py-1 text-right tabular-nums text-neutral-600">{item.cantidad}</td>
                                  <td className="py-1 text-right tabular-nums text-neutral-600 hidden sm:table-cell">
                                    {item.precio_unitario != null ? AR.format(item.precio_unitario) : <span className="text-neutral-300">—</span>}
                                  </td>
                                  <td className="py-1 text-right tabular-nums font-medium text-neutral-700">
                                    {item.subtotal != null ? AR.format(item.subtotal) : <span className="text-neutral-300">—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </>
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}
