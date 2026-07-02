"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { MovimientoForm } from "./movimiento-form";
import { ExportButton } from "./export-button";
import { eliminarMovimiento } from "../actions";
import { Button, Badge } from "@/components/ui";
import type { Database } from "@/types/database";

type Sucursal = Pick<Database["public"]["Tables"]["sucursales"]["Row"], "id" | "nombre">;
type Product  = Database["public"]["Tables"]["products"]["Row"];

type MovimientoRow = Database["public"]["Tables"]["movimientos"]["Row"] & {
  sucursal: Pick<Sucursal, "id" | "nombre"> | null;
  movimiento_items: {
    id: string;
    cantidad: number;
    precio_unitario: number | null;
    subtotal: number | null;
    product: Pick<Product, "id" | "name" | "sku"> | null;
  }[];
};

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const TIPO_COLOR: Record<string, string> = {
  entrega:    "bg-selva-100 text-selva-700 border-selva-300",
  devolucion: "bg-warning-bg text-warning border-warning/30",
  venta:      "bg-blue-50 text-blue-700 border-blue-200",
  ajuste:     "bg-neutral-100 text-neutral-600 border-neutral-200",
};

const TIPO_LABEL: Record<string, string> = {
  entrega: "Entrega", devolucion: "Devolución", venta: "Venta", ajuste: "Ajuste",
};

function DeleteBtn({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Eliminar este movimiento?")) return;
        startTransition(() => eliminarMovimiento(id));
      }}
      className="text-xs text-neutral-400 hover:text-danger transition-colors disabled:opacity-50"
    >
      Eliminar
    </button>
  );
}

type Proveedor = { id: string; nombre: string };

export function MovimientosList({
  movimientos, sucursales, products, proveedores = [],
}: {
  movimientos: MovimientoRow[];
  sucursales:  Sucursal[];
  products:    Product[];
  proveedores?: Proveedor[];
}) {
  const hoy   = new Date();
  const mesDefault = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;

  const [formOpen,   setFormOpen]   = useState(false);
  const [search,     setSearch]     = useState("");
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [tipoFilter, setTipo]       = useState<"all" | "entrega" | "devolucion" | "venta" | "ajuste">("all");
  const [mes,        setMes]        = useState(mesDefault);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return movimientos.filter((m) => {
      if (q) {
        const matchesSucursal = m.sucursal?.nombre.toLowerCase().includes(q);
        const matchesFecha    = m.fecha.includes(q);
        const matchesProducto = m.movimiento_items.some(
          (i) => i.product?.name.toLowerCase().includes(q) || i.product?.sku.toLowerCase().includes(q)
        );
        if (!matchesSucursal && !matchesFecha && !matchesProducto) return false;
      }
      if (tipoFilter !== "all" && m.tipo !== tipoFilter) return false;
      if (mes && !m.fecha.startsWith(mes)) return false;
      return true;
    });
  }, [movimientos, search, tipoFilter, mes]);

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
          />
          <select
            value={tipoFilter}
            onChange={(e) => setTipo(e.target.value as typeof tipoFilter)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
          >
            <option value="all">Todos los tipos</option>
            <option value="entrega">Entregas</option>
            <option value="devolucion">Devoluciones</option>
            <option value="venta">Ventas</option>
            <option value="ajuste">Ajustes</option>
          </select>
          <input
            type="search"
            placeholder="Sucursal o producto…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 w-44"
          />
          <span className="text-sm text-neutral-400 mr-auto">{filtered.length} movimientos</span>
          <ExportButton sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))} />
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo movimiento
          </Button>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
            <p className="text-sm text-neutral-400">
              {movimientos.length === 0 ? "Todavía no hay movimientos registrados." : "No hay movimientos con ese filtro."}
            </p>
            {movimientos.length === 0 && (
              <Button size="sm" variant="ghost" className="mt-4" onClick={() => setFormOpen(true)}>
                Registrar primera entrega
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
            {filtered.map((m) => {
              const total = m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
              const isOpen = expanded === m.id;
              return (
                <div key={m.id}>
                  <div
                    className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : m.id)}
                  >
                    <svg className={`size-4 text-neutral-400 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      {m.sucursal ? (
                        <Link
                          href={`/admin/sucursales/${m.sucursal.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-neutral-900 text-sm hover:text-tierra-700 transition-colors"
                        >
                          {m.sucursal.nombre}
                        </Link>
                      ) : <span className="text-neutral-400 text-sm">—</span>}
                      <span className="mx-2 text-neutral-300">·</span>
                      <span className="text-sm text-neutral-500">
                        {new Date(m.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <Badge className={TIPO_COLOR[m.tipo]}>{TIPO_LABEL[m.tipo]}</Badge>
                    <span className="text-sm font-semibold text-neutral-700 tabular-nums">
                      {total > 0 ? AR.format(total) : <span className="text-neutral-300 font-normal">Sin precio</span>}
                    </span>
                    <DeleteBtn id={m.id} />
                  </div>

                  {isOpen && (
                    <div className="px-10 pb-3 bg-neutral-50 border-t border-neutral-100">
                      <table className="w-full text-sm mt-2">
                        <thead>
                          <tr>
                            <th className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-400 py-1.5">Producto</th>
                            <th className="text-right text-xs font-semibold uppercase tracking-wide text-neutral-400 py-1.5">Cant.</th>
                            <th className="text-right text-xs font-semibold uppercase tracking-wide text-neutral-400 py-1.5">Precio unit.</th>
                            <th className="text-right text-xs font-semibold uppercase tracking-wide text-neutral-400 py-1.5">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                          {m.movimiento_items.map((item) => (
                            <tr key={item.id}>
                              <td className="py-1.5 text-neutral-700">{item.product?.name ?? "—"}</td>
                              <td className="py-1.5 text-right tabular-nums text-neutral-600">{item.cantidad}</td>
                              <td className="py-1.5 text-right tabular-nums text-neutral-600">
                                {item.precio_unitario != null ? AR.format(item.precio_unitario) : <span className="text-neutral-300">—</span>}
                              </td>
                              <td className="py-1.5 text-right tabular-nums font-medium text-neutral-800">
                                {item.subtotal != null ? AR.format(item.subtotal) : <span className="text-neutral-300">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {m.notas && (
                        <p className="mt-2 text-xs text-neutral-500 italic">{m.notas}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <MovimientoForm
        open={formOpen}
        sucursales={sucursales}
        products={products}
        proveedores={proveedores}
        onClose={() => setFormOpen(false)}
      />
    </>
  );
}
