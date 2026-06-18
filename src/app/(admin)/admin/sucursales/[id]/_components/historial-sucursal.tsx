"use client";

import { useState, useMemo } from "react";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

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

type Movimiento = {
  id: string;
  fecha: string;
  tipo: "entrega" | "devolucion" | "ajuste" | "venta";
  notas: string | null;
  created_at: string;
  movimiento_items: Item[];
};

export function HistorialSucursal({ movimientos }: { movimientos: Movimiento[] }) {
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [mesFilter, setMesFilter] = useState("");
  const [tipoFilter, setTipo]     = useState("all");

  const mesesDisponibles = useMemo(() => {
    const set = new Set(movimientos.map((m) => m.fecha.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [movimientos]);

  const filtered = useMemo(() => {
    return movimientos.filter((m) => {
      if (mesFilter && !m.fecha.startsWith(mesFilter)) return false;
      if (tipoFilter !== "all" && m.tipo !== tipoFilter) return false;
      return true;
    });
  }, [movimientos, mesFilter, tipoFilter]);

  if (movimientos.length === 0) {
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
        </select>
        <span className="text-sm text-neutral-400">{filtered.length} registros</span>
      </div>

    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 bg-neutral-50">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Tipo</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden md:table-cell">Notas</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Total</th>
            <th className="px-4 py-3 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {filtered.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-400">Sin registros para el filtro seleccionado.</td></tr>
          ) : filtered.map((m) => {
            const total = m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
            const isOpen = expanded === m.id;
            return (
              <>
                <tr
                  key={m.id}
                  className="hover:bg-neutral-50 transition-colors cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : m.id)}
                >
                  <td className="px-4 py-3 font-medium text-neutral-800 tabular-nums">
                    {new Date(m.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIPO_COLOR[m.tipo]}`}>
                      {TIPO_LABEL[m.tipo]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-500 hidden md:table-cell">
                    {m.notas ?? <span className="text-neutral-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-800">
                    {total > 0 ? AR.format(total) : <span className="text-neutral-300 font-normal text-xs">—</span>}
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
                  <tr key={`${m.id}-detail`}>
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
                                {item.product?.sku && (
                                  <span className="ml-1.5 text-neutral-400">{item.product.sku}</span>
                                )}
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
              </>
            );
          })}
        </tbody>
      </table>
    </div>
    </div>
  );
}
