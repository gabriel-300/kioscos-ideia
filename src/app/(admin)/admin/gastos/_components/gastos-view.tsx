"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { crearGasto, actualizarGasto, eliminarGasto, type GastoInput, type Categoria } from "../actions";

export type GastoRow = {
  id:          string;
  categoria:   Categoria;
  monto:       number;
  fecha:       string;
  proveedor:   string | null;
  sucursal_id: string | null;
  notas:       string | null;
  sucursal:    { id: string; nombre: string } | null;
};

type Sucursal  = { id: string; nombre: string };
type Proveedor = { id: string; nombre: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const CATEGORIAS: { value: Categoria; label: string; color: string }[] = [
  { value: "mercaderia", label: "Mercadería", color: "bg-selva-50 text-selva-700 border-selva-200" },
  { value: "sueldos",    label: "Sueldos",    color: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "alquiler",   label: "Alquiler",   color: "bg-purple-50 text-purple-700 border-purple-200" },
  { value: "servicios",  label: "Servicios",  color: "bg-amber-50 text-amber-700 border-amber-200" },
  { value: "otro",       label: "Otro",       color: "bg-neutral-100 text-neutral-600 border-neutral-200" },
];
const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS.map((c) => [c.value, c.label])) as Record<Categoria, string>;
const CATEGORIA_COLOR = Object.fromEntries(CATEGORIAS.map((c) => [c.value, c.color])) as Record<Categoria, string>;

function emptyForm(): GastoInput {
  return { categoria: "mercaderia", monto: 0, fecha: "", proveedor: null, sucursal_id: null, notas: null };
}

function GastoDrawer({ open, gasto, sucursales, proveedores, onClose }: {
  open: boolean; gasto: GastoRow | null; sucursales: Sucursal[]; proveedores: Proveedor[]; onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form,  setForm]  = useState<GastoInput & { montoStr: string }>({ ...emptyForm(), montoStr: "" });
  const [error, setError] = useState<string | null>(null);

  // Re-sincroniza el form cada vez que se abre el drawer (nuevo gasto o editando uno distinto)
  useEffect(() => {
    if (!open) return;
    if (gasto) {
      setForm({ categoria: gasto.categoria, monto: gasto.monto, montoStr: String(gasto.monto), fecha: gasto.fecha, proveedor: gasto.proveedor, sucursal_id: gasto.sucursal_id, notas: gasto.notas });
    } else {
      setForm({ ...emptyForm(), montoStr: "" });
    }
    setError(null);
  }, [open, gasto]);

  function handleSubmit() {
    setError(null);
    const monto = parseFloat(form.montoStr);
    if (!monto || monto <= 0) { setError("Ingresá un monto válido"); return; }
    if (!form.fecha) { setError("Ingresá una fecha"); return; }

    const payload: GastoInput = { ...form, monto };

    startTransition(async () => {
      try {
        if (gasto) await actualizarGasto(gasto.id, payload);
        else       await crearGasto(payload);
        onClose();
      } catch (e) { setError((e as Error).message); }
    });
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <h2 className="text-base font-semibold font-display text-neutral-900">{gasto ? "Editar gasto" : "Nuevo gasto"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Categoría *</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIAS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, categoria: c.value }))}
                  className={`text-sm rounded-lg border-2 px-2 py-2 transition-colors ${
                    form.categoria === c.value ? "border-tierra-700 bg-tierra-50 font-semibold text-tierra-900" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Monto *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
                <input
                  type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.montoStr}
                  onChange={(e) => setForm((f) => ({ ...f, montoStr: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white pl-6 pr-3 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Fecha *</label>
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Proveedor / a quién se le pagó</label>
            {proveedores.length > 0 ? (
              <select
                value={form.proveedor ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, proveedor: e.target.value || null }))}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              >
                <option value="">—</option>
                {proveedores.map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
              </select>
            ) : (
              <input
                type="text" placeholder="Ej: Panadería López"
                value={form.proveedor ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, proveedor: e.target.value || null }))}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              />
            )}
          </div>

          <div>
            <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Sucursal (opcional)</label>
            <select
              value={form.sucursal_id ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, sucursal_id: e.target.value || null }))}
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
            >
              <option value="">General (no es de un kiosco puntual)</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Notas</label>
            <textarea
              rows={2}
              value={form.notas ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value || null }))}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-tierra-700 resize-none"
            />
          </div>

          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">
            {gasto ? "Guardar cambios" : "Registrar gasto"}
          </Button>
        </div>
      </aside>
    </>
  );
}

export function GastosView({ mes, ingresos, gastos, sucursales, proveedores }: {
  mes: string; ingresos: number; gastos: GastoRow[]; sucursales: Sucursal[]; proveedores: Proveedor[];
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState<GastoRow | null>(null);
  const [, startTransition]         = useTransition();

  const totalGastos = gastos.reduce((s, g) => s + g.monto, 0);
  const resultado    = ingresos - totalGastos;

  const porCategoria = CATEGORIAS.map((c) => ({
    ...c,
    total: gastos.filter((g) => g.categoria === c.value).reduce((s, g) => s + g.monto, 0),
  })).filter((c) => c.total > 0);

  function openNew()               { setEditing(null); setDrawerOpen(true); }
  function openEdit(g: GastoRow)   { setEditing(g);     setDrawerOpen(true); }
  function closeDrawer()           { setDrawerOpen(false); setEditing(null); router.refresh(); }

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar este gasto? Esta acción no se puede deshacer.")) return;
    startTransition(async () => { await eliminarGasto(id); router.refresh(); });
  }

  const mesLabel = new Date(mes + "-01T12:00:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      {/* Selector de mes */}
      <form method="GET" className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Mes</label>
          <input
            type="month" name="mes" defaultValue={mes}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Ver mes
        </button>
        <Button size="sm" onClick={openNew} className="ml-auto">
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nuevo gasto
        </Button>
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Ingresos — {mesLabel}</p>
          <p className="text-2xl font-bold font-display tabular-nums text-neutral-900">{AR.format(ingresos)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">Facturado, sin contar fiado sin cobrar</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Gastos</p>
          <p className="text-2xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalGastos)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{gastos.length} {gastos.length === 1 ? "registro" : "registros"}</p>
        </div>
        <div className={`rounded-xl border p-4 ${resultado >= 0 ? "border-selva-200 bg-selva-50" : "border-danger/20 bg-danger/5"}`}>
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Resultado del mes</p>
          <p className={`text-2xl font-bold font-display tabular-nums ${resultado >= 0 ? "text-selva-700" : "text-danger"}`}>
            {resultado >= 0 ? "+" : ""}{AR.format(resultado)}
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">Ingresos − Gastos</p>
        </div>
      </div>

      {/* Desglose por categoría */}
      {porCategoria.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {porCategoria.map((c) => (
            <span key={c.value} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${c.color}`}>
              {c.label}: {AR.format(c.total)}
            </span>
          ))}
        </div>
      )}

      {/* Tabla de gastos */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Categoría</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Proveedor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 hidden md:table-cell">Sucursal</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Monto</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {gastos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-400">
                    Sin gastos cargados en {mesLabel}.
                  </td>
                </tr>
              ) : gastos.map((g) => (
                <tr key={g.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-4 py-3 text-neutral-600 tabular-nums">
                    {new Date(g.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CATEGORIA_COLOR[g.categoria]}`}>
                      {CATEGORIA_LABEL[g.categoria]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{g.proveedor ?? <span className="text-neutral-300">—</span>}</td>
                  <td className="px-4 py-3 text-neutral-500 hidden md:table-cell">
                    {g.sucursal ? (
                      <Link href={`/admin/sucursales/${g.sucursal.id}`} className="text-tierra-700 hover:underline">{g.sucursal.nombre}</Link>
                    ) : <span className="text-neutral-300">General</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-neutral-800">{AR.format(g.monto)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(g)} className="text-xs text-tierra-700 hover:underline font-medium mr-3">Editar</button>
                    <button onClick={() => handleDelete(g.id)} className="text-xs text-danger hover:underline font-medium">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {gastos.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
                  <td className="px-4 py-3 text-xs uppercase tracking-wide text-neutral-500" colSpan={4}>Total</td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-800">{AR.format(totalGastos)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <GastoDrawer
        open={drawerOpen}
        gasto={editing}
        sucursales={sucursales}
        proveedores={proveedores}
        onClose={closeDrawer}
      />
    </div>
  );
}
