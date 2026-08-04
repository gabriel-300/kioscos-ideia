"use client";

import { useState, useTransition } from "react";
import { togglePromoActiva, eliminarPromo } from "../actions";
import { PromoDrawer } from "./promo-drawer";
import { Button } from "@/components/ui";

export type PromoWithItems = {
  id:              string;
  name:            string;
  price:           number | null;
  is_active:       boolean;
  tipo:            "promo" | "receta";
  cover_image_url: string | null;
  category_id:     string | null;
  requiere_termo:  boolean;
  promo_prices: {
    sucursal_id: string;
    price:       number;
  }[];
  promo_items: {
    id:         string;
    product_id: string;
    cantidad:   number;
    product:    { id: string; name: string; unit_label: string } | null;
  }[];
};

type ProductOption  = { id: string; name: string; unit_label: string };
type CategoryOption = { id: string; name: string };
type SucursalOption = { id: string; nombre: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function ToggleActiva({ id, activa }: { id: string; activa: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => togglePromoActiva(id, activa))}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tierra-700 disabled:opacity-50 ${activa ? "bg-tierra-700" : "bg-neutral-300"}`}
      aria-label={activa ? "Desactivar" : "Activar"}
    >
      <span className={`inline-block size-4 mt-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${activa ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function PromosTable({ promos, products, categories, sucursales }: {
  promos: PromoWithItems[]; products: ProductOption[]; categories: CategoryOption[]; sucursales: SucursalOption[];
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<PromoWithItems | null>(null);
  const [, startTransition]         = useTransition();
  const [search,     setSearch]     = useState("");
  const [tipoFiltro, setTipoFiltro] = useState<"todos" | "promo" | "receta">("todos");
  const [catFiltro,  setCatFiltro]  = useState("all");
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  function openNew()             { setEditing(null); setDrawerOpen(true); }
  function openEdit(p: PromoWithItems) { setEditing(p); setDrawerOpen(true); }
  function closeDrawer()         { setDrawerOpen(false); setEditing(null); }

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta promoción? Esta acción no se puede deshacer.")) return;
    startTransition(() => eliminarPromo(id));
  }

  function precioDe(p: PromoWithItems, sucursalId: string): number | null {
    return p.promo_prices.find((pp) => pp.sucursal_id === sucursalId)?.price ?? null;
  }

  const filtered = promos.filter((p) => {
    if (tipoFiltro !== "todos" && p.tipo !== tipoFiltro) return false;
    if (catFiltro !== "all" && p.category_id !== catFiltro) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchNombre = p.name.toLowerCase().includes(q);
      const matchItem   = p.promo_items.some((i) => i.product?.name.toLowerCase().includes(q));
      if (!matchNombre && !matchItem) return false;
    }
    return true;
  });

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button size="sm" onClick={openNew}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva promoción
          </Button>
        </div>

        {/* Buscador + filtros */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar por nombre o producto…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 pr-3 rounded-lg border border-neutral-300 bg-white text-sm focus:outline-none focus:border-tierra-700 w-64"
            />
          </div>
          <div className="flex gap-1.5">
            {([
              ["todos", "Todos"], ["promo", "Promos"], ["receta", "Recetas"],
            ] as const).map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setTipoFiltro(valor)}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
                  tipoFiltro === valor
                    ? "bg-tierra-700 text-white border-tierra-700"
                    : "bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <select value={catFiltro} onChange={(e) => setCatFiltro(e.target.value)}
              className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
              <option value="all">Todas las categorías</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <span className="text-sm text-neutral-400">{filtered.length} de {promos.length}</span>
        </div>

        {/* Mobile: tarjetas apiladas */}
        <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-400">
              {promos.length === 0 ? "Todavía no hay promociones." : "Sin resultados para este filtro."}
            </p>
          ) : (
            filtered.map((p) => (
              <div key={p.id} className="px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-medium text-neutral-900">{p.name}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                      p.tipo === "receta" ? "bg-amber-50 text-amber-700" : "bg-tierra-50 text-tierra-700"
                    }`}>
                      {p.tipo === "receta" ? "Receta" : "Promo"}
                    </span>
                    {p.category_id && (
                      <span className="text-xs text-neutral-400">{categoryMap.get(p.category_id) ?? "—"}</span>
                    )}
                  </div>
                  <ToggleActiva id={p.id} activa={p.is_active} />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.promo_items.map((i) => (
                    <span key={i.id} className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
                      {i.cantidad}× {i.product?.name ?? "—"}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs tabular-nums text-neutral-700">
                  {sucursales.map((s) => (
                    <span key={s.id}>
                      <span className="text-neutral-400">{s.nombre}:</span>{" "}
                      <span className="font-semibold">{precioDe(p, s.id) != null ? AR.format(precioDe(p, s.id)!) : "—"}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                  <div>
                    <button onClick={() => openEdit(p)} className="text-tierra-700 hover:underline font-medium mr-3">
                      Editar
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-danger hover:underline font-medium">
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop: tabla */}
        <div className="hidden md:block rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Promoción</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Composición</th>
                  {sucursales.map((s) => (
                    <th key={s.id} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      {s.nombre}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Activa</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4 + sucursales.length} className="px-4 py-10 text-center text-sm text-neutral-400">
                      {promos.length === 0 ? "Todavía no hay promociones." : "Sin resultados para este filtro."}
                    </td>
                  </tr>
                )}
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900">{p.name}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          p.tipo === "receta" ? "bg-amber-50 text-amber-700" : "bg-tierra-50 text-tierra-700"
                        }`}>
                          {p.tipo === "receta" ? "Receta" : "Promo"}
                        </span>
                        {p.category_id && (
                          <span className="text-xs text-neutral-400">{categoryMap.get(p.category_id) ?? "—"}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {p.promo_items.map((i) => (
                          <span key={i.id} className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600">
                            {i.cantidad}× {i.product?.name ?? "—"}
                          </span>
                        ))}
                      </div>
                    </td>
                    {sucursales.map((s) => {
                      const precio = precioDe(p, s.id);
                      return (
                        <td key={s.id} className="px-4 py-3 text-right tabular-nums text-neutral-700">
                          {precio != null ? AR.format(precio) : <span className="text-neutral-300">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center">
                      <ToggleActiva id={p.id} activa={p.is_active} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(p)} className="text-xs text-tierra-700 hover:underline font-medium mr-3">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(p.id)} className="text-xs text-danger hover:underline font-medium">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PromoDrawer
        open={drawerOpen}
        promo={editing}
        products={products}
        categories={categories}
        sucursales={sucursales}
        onClose={closeDrawer}
      />
    </>
  );
}
