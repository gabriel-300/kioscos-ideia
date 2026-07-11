"use client";

import { useState, useTransition, useMemo } from "react";
import { toggleProductoActivo } from "../actions";
import { ProductoDrawer } from "./producto-drawer";
import { AjustePreciosDrawer } from "./ajuste-precios-drawer";
import { CostearVentaDrawer } from "./costear-venta-drawer";
import type { Database } from "@/types/database";
import { Badge, Button } from "@/components/ui";

type Product  = Database["public"]["Tables"]["products"]["Row"];
type Category = Database["public"]["Tables"]["categories"]["Row"];
type ProductWithCat = Product & { category: Category | null };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function ToggleActivo({ id, activo }: { id: string; activo: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => toggleProductoActivo(id, activo))}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tierra-700 disabled:opacity-50 ${activo ? "bg-tierra-700" : "bg-neutral-300"}`}
      aria-label={activo ? "Desactivar" : "Activar"}
    >
      <span className={`inline-block size-4 mt-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${activo ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function ProductsTable({ products, categories, role }: { products: ProductWithCat[]; categories: Category[]; role?: string }) {
  const esAdmin = role === "admin";
  const [search, setSearch]         = useState("");
  const [catFilter, setCat]         = useState("all");
  const [status, setStatus]         = useState<"all" | "activo" | "inactivo">("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<Product | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.sku.toLowerCase().includes(q)) return false;
      if (catFilter !== "all" && p.category_id !== catFilter) return false;
      if (status === "activo"   && !p.is_active) return false;
      if (status === "inactivo" && p.is_active)  return false;
      return true;
    });
  }, [products, search, catFilter, status]);

  function openNew()              { setEditing(null); setDrawerOpen(true); }
  function openEdit(p: Product)   { setEditing(p);    setDrawerOpen(true); }
  function closeDrawer()          { setDrawerOpen(false); setEditing(null); }

  return (
    <>
      <div className="space-y-4">
        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="search"
            placeholder="Buscar por nombre o SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 w-64"
          />
          <select
            value={catFilter}
            onChange={(e) => setCat(e.target.value)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
          >
            <option value="all">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
          >
            <option value="all">Todos</option>
            <option value="activo">Activos</option>
            <option value="inactivo">Inactivos</option>
          </select>
          <span className="text-sm text-neutral-400 mr-auto">{filtered.length} productos</span>
          {esAdmin && <CostearVentaDrawer categories={categories} />}
          <AjustePreciosDrawer categories={categories} soloVenta={!esAdmin} />
          <Button size="sm" onClick={openNew}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo producto
          </Button>
        </div>

        {/* Mobile: tarjetas apiladas */}
        <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-400">
              {products.length === 0 ? "Todavía no hay productos." : "No hay productos con esos filtros."}
            </p>
          ) : (
            filtered.map((p) => {
              const margen = p.costo != null && p.precio_dist != null && p.costo > 0
                ? Math.round(((p.precio_dist - p.costo) / p.costo) * 100)
                : null;
              return (
                <div key={p.id} className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    {p.cover_image_url ? (
                      <img src={p.cover_image_url} alt="" className="size-10 rounded-lg object-cover shrink-0 border border-neutral-100" />
                    ) : (
                      <div className="size-10 rounded-lg bg-neutral-100 shrink-0 flex items-center justify-center">
                        <span className="text-xs font-bold text-neutral-300 uppercase">{p.name.slice(0, 2)}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-neutral-900 truncate">
                        {p.name}
                        {p.unit_label && <span className="ml-1.5 text-xs text-neutral-400">/ {p.unit_label}</span>}
                        {!p.vendible_pos && (
                          <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Insumo</span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-400 font-mono">{p.sku}</p>
                    </div>
                    <ToggleActivo id={p.id} activo={p.is_active} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      {p.category && <Badge>{p.category.name}</Badge>}
                      <span className="tabular-nums text-neutral-700">
                        {p.precio_dist != null ? AR.format(p.precio_dist) : "—"}
                      </span>
                      {esAdmin && margen != null && (
                        <span className={`font-semibold tabular-nums ${margen > 0 ? "text-selva-700" : margen < 0 ? "text-red-600" : "text-neutral-500"}`}>
                          {margen}%
                        </span>
                      )}
                    </div>
                    <button onClick={() => openEdit(p)} className="text-tierra-700 hover:underline font-medium shrink-0">
                      Editar
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop: tabla */}
        <div className="hidden md:block rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">SKU</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden md:table-cell">Categoría</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">P. Kiosco</th>
                  {esAdmin && <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden lg:table-cell">Costo</th>}
                  {esAdmin && <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden lg:table-cell">Margen</th>}
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Activo</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={esAdmin ? 8 : 6} className="px-4 py-10 text-center text-sm text-neutral-400">
                      {products.length === 0 ? "Todavía no hay productos." : "No hay productos con esos filtros."}
                    </td>
                  </tr>
                )}
                {filtered.map((p) => {
                  const margen = p.costo != null && p.precio_dist != null && p.costo > 0
                    ? Math.round(((p.precio_dist - p.costo) / p.costo) * 100)
                    : null;
                  return (
                  <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{p.sku}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.cover_image_url ? (
                          <img src={p.cover_image_url} alt="" className="size-9 rounded-lg object-cover shrink-0 border border-neutral-100" />
                        ) : (
                          <div className="size-9 rounded-lg bg-neutral-100 shrink-0 flex items-center justify-center">
                            <span className="text-xs font-bold text-neutral-300 uppercase">{p.name.slice(0, 2)}</span>
                          </div>
                        )}
                        <div>
                          <span className="font-medium text-neutral-900">{p.name}</span>
                          {p.unit_label && <span className="ml-1.5 text-xs text-neutral-400">/ {p.unit_label}</span>}
                          {!p.vendible_pos && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Insumo</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {p.category ? <Badge>{p.category.name}</Badge> : <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-700">
                      {p.precio_dist != null ? AR.format(p.precio_dist) : <span className="text-neutral-300">—</span>}
                    </td>
                    {esAdmin && (
                      <td className="px-4 py-3 text-right tabular-nums text-neutral-700 hidden lg:table-cell">
                        {p.costo != null ? AR.format(p.costo) : <span className="text-neutral-300">—</span>}
                      </td>
                    )}
                    {esAdmin && (
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        {margen != null
                          ? <span className={`font-semibold tabular-nums ${margen > 0 ? "text-selva-700" : margen < 0 ? "text-red-600" : "text-neutral-500"}`}>{margen}%</span>
                          : <span className="text-neutral-300">—</span>
                        }
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <ToggleActivo id={p.id} activo={p.is_active} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(p)} className="text-xs text-tierra-700 hover:underline font-medium">
                        Editar
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ProductoDrawer
        open={drawerOpen}
        product={editing}
        categories={categories}
        existingSkus={products.map((p) => p.sku)}
        onClose={closeDrawer}
        role={role}
      />
    </>
  );
}
