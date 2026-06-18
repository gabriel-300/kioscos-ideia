"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { SucursalDrawer } from "./sucursal-drawer";
import { toggleSucursalActiva } from "../actions";
import { Button, Badge } from "@/components/ui";
import type { Database } from "@/types/database";

type Sucursal = Database["public"]["Tables"]["sucursales"]["Row"];
type EncargadoUser = { id: string; email: string; nombre: string };

function ToggleActiva({ id, activa }: { id: string; activa: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => toggleSucursalActiva(id, activa))}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tierra-700 disabled:opacity-50 ${activa ? "bg-tierra-700" : "bg-neutral-300"}`}
      aria-label={activa ? "Desactivar" : "Activar"}
    >
      <span className={`inline-block size-4 mt-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${activa ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

export function SucursalesList({ sucursales, encargadoUsers }: { sucursales: Sucursal[]; encargadoUsers: EncargadoUser[] }) {
  const [search, setSearch]         = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<Sucursal | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sucursales.filter((s) =>
      !q ||
      s.nombre.toLowerCase().includes(q) ||
      (s.localidad?.toLowerCase().includes(q)) ||
      (s.encargado_nombre?.toLowerCase().includes(q))
    );
  }, [sucursales, search]);

  function openNew()         { setEditing(null); setDrawerOpen(true); }
  function openEdit(s: Sucursal) { setEditing(s);   setDrawerOpen(true); }
  function closeDrawer()     { setDrawerOpen(false); setEditing(null); }

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center">
          <input
            type="search"
            placeholder="Buscar sucursal…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20 w-64"
          />
          <span className="text-sm text-neutral-400 mr-auto">{filtered.length} sucursales</span>
          <Button size="sm" onClick={openNew}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva sucursal
          </Button>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center">
            <p className="text-sm text-neutral-400">
              {sucursales.length === 0
                ? "Todavía no hay sucursales cargadas."
                : "No hay sucursales con ese filtro."}
            </p>
            {sucursales.length === 0 && (
              <Button size="sm" variant="ghost" className="mt-4" onClick={openNew}>
                Crear la primera
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Nombre</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden md:table-cell">Localidad</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden lg:table-cell">Encargado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden lg:table-cell">Teléfono</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Activa</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/admin/sucursales/${s.id}`} className="font-medium text-neutral-900 hover:text-tierra-700 transition-colors">
                          {s.nombre}
                        </Link>
                        {!s.is_active && (
                          <Badge className="ml-2 text-neutral-400 border-neutral-200 bg-neutral-50">Inactiva</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-600 hidden md:table-cell">{s.localidad}</td>
                      <td className="px-4 py-3 text-neutral-600 hidden lg:table-cell">{s.encargado_nombre ?? <span className="text-neutral-300">—</span>}</td>
                      <td className="px-4 py-3 text-neutral-600 hidden lg:table-cell">{s.encargado_telefono ?? <span className="text-neutral-300">—</span>}</td>
                      <td className="px-4 py-3 text-center">
                        <ToggleActiva id={s.id} activa={s.is_active} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEdit(s)}
                          className="text-xs text-tierra-700 hover:underline font-medium"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <SucursalDrawer
        open={drawerOpen}
        sucursal={editing}
        onClose={closeDrawer}
        encargadoUsers={encargadoUsers}
      />
    </>
  );
}
