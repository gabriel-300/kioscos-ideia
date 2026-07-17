"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { crearProveedor, actualizarProveedor, toggleProveedorActivo } from "../actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type ModoFacturacion = "costo" | "precio_sugerido";
export type ProveedorRow = {
  id: string; nombre: string; contacto: string | null; is_active: boolean;
  modo_facturacion: ModoFacturacion; porcentaje_descuento: number | null;
};
type Proveedor = ProveedorRow;

function ToggleActivo({ id, activo }: { id: string; activo: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => startTransition(() => toggleProveedorActivo(id, activo))}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tierra-700 disabled:opacity-50 ${activo ? "bg-tierra-700" : "bg-neutral-300"}`}
      aria-label={activo ? "Desactivar" : "Activar"}
    >
      <span className={`inline-block size-4 mt-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${activo ? "translate-x-4.5" : "translate-x-0.5"}`} />
    </button>
  );
}

function ProveedorForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { nombre: string; contacto: string; modoFacturacion: ModoFacturacion; porcentajeDescuento: number | null };
  onSave: (nombre: string, contacto: string, modoFacturacion: ModoFacturacion, porcentajeDescuento: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [nombre,   setNombre]   = useState(initial?.nombre   ?? "");
  const [contacto, setContacto] = useState(initial?.contacto ?? "");
  const [modo,     setModo]     = useState<ModoFacturacion>(initial?.modoFacturacion ?? "costo");
  const [descuento, setDescuento] = useState(initial?.porcentajeDescuento != null ? String(initial.porcentajeDescuento) : "");
  const [pending,  startTransition] = useTransition();
  const [error,    setError]    = useState<string | null>(null);

  function handleSave() {
    if (!nombre.trim()) { setError("El nombre es requerido"); return; }
    setError(null);
    const pct = modo === "precio_sugerido" && descuento ? parseFloat(descuento) : null;
    startTransition(async () => {
      try { await onSave(nombre, contacto, modo, pct); }
      catch (e) { setError((e as Error).message); }
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-neutral-600 block mb-1">Nombre *</label>
        <input
          type="text"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Distribuidora Norte"
          className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-neutral-600 block mb-1">Contacto (opcional)</label>
        <input
          type="text"
          value={contacto}
          onChange={(e) => setContacto(e.target.value)}
          placeholder="Teléfono o email"
          className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-neutral-600 block mb-1">Cómo factura</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setModo("costo")}
            className={`flex-1 h-9 rounded-lg border text-xs font-medium transition-colors ${
              modo === "costo" ? "border-tierra-700 bg-tierra-50 text-tierra-900" : "border-neutral-200 text-neutral-500 hover:border-neutral-300"
            }`}
          >
            Costo directo
          </button>
          <button
            type="button"
            onClick={() => setModo("precio_sugerido")}
            className={`flex-1 h-9 rounded-lg border text-xs font-medium transition-colors ${
              modo === "precio_sugerido" ? "border-tierra-700 bg-tierra-50 text-tierra-900" : "border-neutral-200 text-neutral-500 hover:border-neutral-300"
            }`}
          >
            Precio sugerido
          </button>
        </div>
      </div>
      {modo === "precio_sugerido" && (
        <div>
          <label className="text-xs font-medium text-neutral-600 block mb-1">% de descuento que nos hace</label>
          <input
            type="number" min="0" max="100" step="0.1"
            value={descuento}
            onChange={(e) => setDescuento(e.target.value)}
            placeholder="Ej: 30"
            className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <p className="text-[11px] text-neutral-400 mt-1">El remito viene con el precio sugerido de venta; a eso se le resta este % para calcular el costo real.</p>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" loading={pending} onClick={handleSave}>Guardar</Button>
        <Button variant="ghost"   size="sm" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}

export function ProveedoresList({ proveedores, comprasMap = {} }: { proveedores: Proveedor[]; comprasMap?: Record<string, number> }) {
  const [showNew,  setShowNew]  = useState(false);
  const [editing,  setEditing]  = useState<string | null>(null);

  async function handleCreate(nombre: string, contacto: string, modo: ModoFacturacion, pct: number | null) {
    await crearProveedor(nombre, contacto, modo, pct);
    setShowNew(false);
  }

  async function handleUpdate(id: string, nombre: string, contacto: string, modo: ModoFacturacion, pct: number | null) {
    await actualizarProveedor(id, nombre, contacto, modo, pct);
    setEditing(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">{proveedores.length} proveedores</p>
        {!showNew && (
          <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo proveedor
          </Button>
        )}
      </div>

      {showNew && (
        <div className="rounded-xl border border-tierra-200 bg-tierra-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-tierra-600 mb-3">Nuevo proveedor</p>
          <ProveedorForm
            onSave={handleCreate}
            onCancel={() => setShowNew(false)}
          />
        </div>
      )}

      {proveedores.length === 0 && !showNew ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-10 text-center text-sm text-neutral-400">
          No hay proveedores todavía. Creá el primero.
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-neutral-400">Nombre</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-neutral-400 hidden sm:table-cell">Contacto</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-neutral-400 hidden md:table-cell">Total comprado</th>
                <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-neutral-400">Activo</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {proveedores.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3" colSpan={editing === p.id ? 4 : 1}>
                    {editing === p.id ? (
                      <ProveedorForm
                        initial={{
                          nombre: p.nombre, contacto: p.contacto ?? "",
                          modoFacturacion: p.modo_facturacion, porcentajeDescuento: p.porcentaje_descuento,
                        }}
                        onSave={(nombre, contacto, modo, pct) => handleUpdate(p.id, nombre, contacto, modo, pct)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-medium ${p.is_active ? "text-neutral-900" : "text-neutral-400"}`}>
                          {p.nombre}
                        </span>
                        {p.modo_facturacion === "precio_sugerido" && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            Precio sugerido{p.porcentaje_descuento != null ? ` -${p.porcentaje_descuento}%` : ""}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  {editing !== p.id && (
                    <>
                      <td className="px-4 py-3 text-neutral-500 hidden sm:table-cell">
                        {p.contacto ?? <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">
                        {comprasMap[p.nombre]
                          ? <span className="text-sm font-medium text-neutral-700">{AR.format(comprasMap[p.nombre])}</span>
                          : <span className="text-neutral-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ToggleActivo id={p.id} activo={p.is_active} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setEditing(p.id)}
                          className="text-xs text-tierra-700 hover:underline font-medium"
                        >
                          Editar
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
