"use client";

import { useState, useTransition, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { Button, Input, Textarea } from "@/components/ui";
import { crearCategoria, actualizarCategoria, toggleCategoriaActiva, reordenarCategoria } from "../actions";
import type { Database } from "@/types/database";

type Category = Database["public"]["Tables"]["categories"]["Row"];

const schema = z.object({
  name:        z.string().min(2, "Mínimo 2 caracteres"),
  description: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

function ToggleActiva({ id, activa }: { id: string; activa: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => toggleCategoriaActiva(id, activa))}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tierra-700 disabled:opacity-50 ${activa ? "bg-tierra-700" : "bg-neutral-300"}`}
    >
      <span className={`inline-block size-4 mt-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${activa ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

function OrderInput({ id, value }: { id: string; value: number }) {
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(String(value));
  return (
    <input
      type="number"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n !== value) startTransition(() => reordenarCategoria(id, n));
      }}
      disabled={pending}
      className="w-14 h-8 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-center focus:outline-none focus:border-tierra-700 tabular-nums disabled:opacity-50"
    />
  );
}

function CategoriaDrawer({
  open, category, onClose,
}: { open: boolean; category: Category | null; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (!open) return;
    reset(category ? { name: category.name, description: category.description ?? "" } : { name: "", description: "" });
  }, [open, category, reset]);

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      try {
        if (category) {
          await actualizarCategoria(category.id, values);
        } else {
          await crearCategoria(values);
        }
        onClose();
      } catch (e) {
        alert((e as Error).message);
      }
    });
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold font-display text-neutral-900">
            {category ? "Editar categoría" : "Nueva categoría"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 p-6 space-y-4">
          <Input label="Nombre *" placeholder="Ej: Congelados" error={errors.name?.message} {...register("name")} />
          <Textarea label="Descripción" placeholder="Descripción opcional de la categoría…" {...register("description")} />
        </form>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} type="button" className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit(onSubmit)} className="flex-1">
            {category ? "Guardar" : "Crear categoría"}
          </Button>
        </div>
      </aside>
    </>
  );
}

export function CategoriasList({ categories }: { categories: Category[] }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<Category | null>(null);

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-400">{categories.length} categorías</span>
          <Button size="sm" onClick={() => { setEditing(null); setDrawerOpen(true); }}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva categoría
          </Button>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          {categories.length === 0 ? (
            <div className="p-10 text-center text-sm text-neutral-400">
              Todavía no hay categorías.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Nombre</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden md:table-cell">Descripción</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Orden</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Activa</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-neutral-900">{c.name}</td>
                    <td className="px-4 py-3 text-neutral-500 hidden md:table-cell">
                      {c.description ?? <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <OrderInput id={c.id} value={c.sort_order} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ToggleActiva id={c.id} activa={c.is_active} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { setEditing(c); setDrawerOpen(true); }}
                        className="text-xs text-tierra-700 hover:underline font-medium"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-neutral-400">
          El número de orden determina cómo aparecen las categorías en el catálogo. Menor número = primero.
        </p>
      </div>

      <CategoriaDrawer
        open={drawerOpen}
        category={editing}
        onClose={() => { setDrawerOpen(false); setEditing(null); }}
      />
    </>
  );
}
