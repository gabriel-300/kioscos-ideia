"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MovimientoForm } from "./movimiento-form";
import { ExportButton } from "./export-button";
import { eliminarMovimiento, actualizarMovimientoMetadata } from "../actions";
import { Button, Badge } from "@/components/ui";
import { fechaHoyAR } from "@/lib/fecha";
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

function EditMetadataForm({ m, onDone }: { m: MovimientoRow; onDone: () => void }) {
  const [fecha,     setFecha]     = useState(m.fecha);
  const [notas,     setNotas]     = useState(m.notas ?? "");
  const [proveedor, setProveedor] = useState((m as any).proveedor ?? "");
  const [nroRemito, setNroRemito] = useState((m as any).nro_remito ?? "");
  const [pending,   startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    startTransition(async () => {
      try {
        await actualizarMovimientoMetadata(m.id, {
          fecha,
          notas:      notas     || null,
          proveedor:  proveedor || null,
          nro_remito: nroRemito || null,
        });
        router.refresh();
        onDone();
      } catch (e) { alert((e as Error).message); }
    });
  }

  return (
    <div className="px-10 py-3 bg-blue-50 border-t border-blue-100 space-y-2">
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Editar datos</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-neutral-500 block mb-0.5">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700" />
        </div>
        {m.tipo === "entrega" && (
          <div>
            <label className="text-xs text-neutral-500 block mb-0.5">Proveedor</label>
            <input type="text" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="—"
              className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700" />
          </div>
        )}
        {m.tipo === "entrega" && (
          <div>
            <label className="text-xs text-neutral-500 block mb-0.5">N° Remito</label>
            <input type="text" value={nroRemito} onChange={(e) => setNroRemito(e.target.value)} placeholder="—"
              className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700" />
          </div>
        )}
        <div className={m.tipo === "entrega" ? "col-span-2" : ""}>
          <label className="text-xs text-neutral-500 block mb-0.5">Notas</label>
          <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="—"
            className="h-8 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button variant="primary" size="sm" loading={pending} onClick={handleSave}>Guardar</Button>
        <Button variant="ghost"   size="sm" onClick={onDone}>Cancelar</Button>
      </div>
    </div>
  );
}

function DeleteBtn({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        const motivo = window.prompt("Motivo de la eliminación (obligatorio):");
        if (motivo === null) return;
        if (!motivo.trim()) { window.alert("El motivo es obligatorio para eliminar un movimiento."); return; }
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
  const mesDefault = fechaHoyAR().slice(0, 7);

  const [formOpen,        setFormOpen]        = useState(false);
  const [search,          setSearch]          = useState("");
  const [expanded,        setExpanded]        = useState<string | null>(null);
  const [editingId,       setEditingId]       = useState<string | null>(null);
  const [tipoFilter,      setTipo]            = useState<"all" | "entrega" | "devolucion" | "venta" | "ajuste">("all");
  const [mes,             setMes]             = useState(mesDefault);
  const [proveedorFilter, setProveedorFilter] = useState("all");
  const [sucursalFilter,  setSucursalFilter]  = useState("all");

  const proveedoresEnMovs = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const m of movimientos) {
      const p = (m as any).proveedor as string | null;
      if (p && !seen.has(p)) { seen.add(p); list.push(p); }
    }
    return list.sort();
  }, [movimientos]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return movimientos.filter((m) => {
      if (q) {
        const matchesFecha    = m.fecha.includes(q);
        const matchesProducto = m.movimiento_items.some(
          (i) => i.product?.name.toLowerCase().includes(q) || i.product?.sku.toLowerCase().includes(q)
        );
        if (!matchesFecha && !matchesProducto) return false;
      }
      if (tipoFilter !== "all" && m.tipo !== tipoFilter) return false;
      if (mes && !m.fecha.startsWith(mes)) return false;
      if (proveedorFilter !== "all" && (m as any).proveedor !== proveedorFilter) return false;
      if (sucursalFilter !== "all" && m.sucursal?.id !== sucursalFilter) return false;
      return true;
    });
  }, [movimientos, search, tipoFilter, mes, proveedorFilter, sucursalFilter]);

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
          {sucursales.length > 1 && (
            <select
              value={sucursalFilter}
              onChange={(e) => setSucursalFilter(e.target.value)}
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
            >
              <option value="all">Todos los kioscos</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          )}
          {proveedoresEnMovs.length > 0 && (
            <select
              value={proveedorFilter}
              onChange={(e) => setProveedorFilter(e.target.value)}
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
            >
              <option value="all">Todos los proveedores</option>
              {proveedoresEnMovs.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
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
                    {(m as any).remito_image_url && (
                      <svg className="size-4 text-neutral-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                      </svg>
                    )}
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
                      {((m as any).proveedor || (m as any).nro_remito) && (
                        <p className="mt-2 text-xs text-neutral-500">
                          {(m as any).proveedor && <><span className="font-semibold text-neutral-700">Proveedor:</span> {(m as any).proveedor}</>}
                          {(m as any).proveedor && (m as any).nro_remito && <span className="mx-2 text-neutral-300">·</span>}
                          {(m as any).nro_remito && <><span className="font-semibold text-neutral-700">Remito:</span> {(m as any).nro_remito}</>}
                        </p>
                      )}
                      {(m as any).remito_image_url && (
                        <div className="mt-3">
                          <a href={(m as any).remito_image_url} target="_blank" rel="noopener noreferrer" className="inline-block">
                            <img
                              src={(m as any).remito_image_url}
                              alt="Imagen del remito"
                              className="max-h-40 max-w-xs rounded-lg border border-neutral-200 object-contain hover:opacity-80 transition-opacity"
                            />
                          </a>
                          <p className="text-xs text-neutral-400 mt-1">Click para ver en tamaño completo</p>
                        </div>
                      )}
                      {m.notas && (
                        <p className="mt-1.5 text-xs text-neutral-500 italic">{m.notas}</p>
                      )}
                      <div className="mt-2 pt-2 border-t border-neutral-100">
                        <button
                          onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                          className="text-xs text-tierra-700 hover:underline font-medium"
                        >
                          {editingId === m.id ? "Cancelar edición" : "Editar datos"}
                        </button>
                      </div>
                    </div>
                  )}
                  {isOpen && editingId === m.id && (
                    <EditMetadataForm m={m} onDone={() => setEditingId(null)} />
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
