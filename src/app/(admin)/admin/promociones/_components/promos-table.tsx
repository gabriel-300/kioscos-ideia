"use client";

import { useState, useTransition } from "react";
import { togglePromoActiva, eliminarPromo } from "../actions";
import { PromoDrawer } from "./promo-drawer";
import { Button } from "@/components/ui";

export type PromoWithItems = {
  id:              string;
  name:            string;
  price:           number;
  is_active:       boolean;
  tipo:            "promo" | "receta";
  cover_image_url: string | null;
  promo_items: {
    id:         string;
    product_id: string;
    cantidad:   number;
    product:    { id: string; name: string; unit_label: string } | null;
  }[];
};

type ProductOption = { id: string; name: string; unit_label: string };

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

export function PromosTable({ promos, products }: { promos: PromoWithItems[]; products: ProductOption[] }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<PromoWithItems | null>(null);
  const [, startTransition]         = useTransition();

  function openNew()             { setEditing(null); setDrawerOpen(true); }
  function openEdit(p: PromoWithItems) { setEditing(p); setDrawerOpen(true); }
  function closeDrawer()         { setDrawerOpen(false); setEditing(null); }

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta promoción? Esta acción no se puede deshacer.")) return;
    startTransition(() => eliminarPromo(id));
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-400">{promos.length} promociones</span>
          <Button size="sm" onClick={openNew}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva promoción
          </Button>
        </div>

        {/* Mobile: tarjetas apiladas */}
        <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
          {promos.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-400">Todavía no hay promociones.</p>
          ) : (
            promos.map((p) => (
              <div key={p.id} className="px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-medium text-neutral-900">{p.name}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                      p.tipo === "receta" ? "bg-amber-50 text-amber-700" : "bg-tierra-50 text-tierra-700"
                    }`}>
                      {p.tipo === "receta" ? "Receta" : "Promo"}
                    </span>
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
                <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                  <span className="tabular-nums text-neutral-700 font-semibold">{AR.format(p.price)}</span>
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
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Precio</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Activa</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {promos.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-400">
                      Todavía no hay promociones.
                    </td>
                  </tr>
                )}
                {promos.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900">{p.name}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          p.tipo === "receta" ? "bg-amber-50 text-amber-700" : "bg-tierra-50 text-tierra-700"
                        }`}>
                          {p.tipo === "receta" ? "Receta" : "Promo"}
                        </span>
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
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-700">{AR.format(p.price)}</td>
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
        onClose={closeDrawer}
      />
    </>
  );
}
