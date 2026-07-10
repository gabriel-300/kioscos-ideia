"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  crearGastoFijo, actualizarGastoFijo, toggleGastoFijoActivo, eliminarGastoFijo, marcarGastoFijoPagado,
  type GastoFijoInput, type Categoria,
} from "../actions";

export type GastoFijoRow = {
  id:              string;
  categoria:       Categoria;
  descripcion:     string;
  monto_estimado:  number;
  dia_vencimiento: number;
  sucursal_id:     string | null;
  sucursal:        { id: string; nombre: string } | null;
  pago:            { id: string; monto: number; fecha: string } | null;
};

type Sucursal  = { id: string; nombre: string };
type Proveedor = { id: string; nombre: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const CATEGORIAS: { value: Categoria; label: string }[] = [
  { value: "mercaderia", label: "Mercadería" },
  { value: "sueldos",    label: "Sueldos" },
  { value: "alquiler",   label: "Alquiler" },
  { value: "servicios",  label: "Servicios" },
  { value: "otro",       label: "Otro" },
];
const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS.map((c) => [c.value, c.label])) as Record<Categoria, string>;

function emptyForm(): GastoFijoInput {
  return { categoria: "alquiler", descripcion: "", monto_estimado: 0, dia_vencimiento: 1, sucursal_id: null };
}

function GastoFijoDrawer({ open, gastoFijo, sucursales, onClose }: {
  open: boolean; gastoFijo: GastoFijoRow | null; sucursales: Sucursal[]; onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [form,  setForm]  = useState<GastoFijoInput & { montoStr: string; diaStr: string }>({ ...emptyForm(), montoStr: "", diaStr: "1" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (gastoFijo) {
      setForm({
        categoria: gastoFijo.categoria, descripcion: gastoFijo.descripcion,
        monto_estimado: gastoFijo.monto_estimado, montoStr: String(gastoFijo.monto_estimado),
        dia_vencimiento: gastoFijo.dia_vencimiento, diaStr: String(gastoFijo.dia_vencimiento),
        sucursal_id: gastoFijo.sucursal_id,
      });
    } else {
      setForm({ ...emptyForm(), montoStr: "", diaStr: "1" });
    }
    setError(null);
  }, [open, gastoFijo]);

  function handleSubmit() {
    setError(null);
    const monto_estimado = parseFloat(form.montoStr);
    const dia_vencimiento = parseInt(form.diaStr, 10);
    if (!form.descripcion.trim()) { setError("Ingresá una descripción"); return; }
    if (!monto_estimado || monto_estimado <= 0) { setError("Ingresá un monto válido"); return; }
    if (!dia_vencimiento || dia_vencimiento < 1 || dia_vencimiento > 31) { setError("El día de vencimiento debe estar entre 1 y 31"); return; }

    const payload: GastoFijoInput = { ...form, monto_estimado, dia_vencimiento };

    startTransition(async () => {
      try {
        if (gastoFijo) await actualizarGastoFijo(gastoFijo.id, payload);
        else           await crearGastoFijo(payload);
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
          <h2 className="text-base font-semibold font-display text-neutral-900">{gastoFijo ? "Editar gasto fijo" : "Nuevo gasto fijo"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Descripción *</label>
            <input
              type="text" placeholder="Ej: Alquiler local, Sueldo Damián"
              value={form.descripcion}
              onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
              className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
            />
          </div>

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
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Monto estimado *</label>
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
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Día de vencimiento *</label>
              <input
                type="number" min="1" max="31" placeholder="1-31"
                value={form.diaStr}
                onChange={(e) => setForm((f) => ({ ...f, diaStr: e.target.value }))}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
              />
            </div>
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

          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">
            {gastoFijo ? "Guardar cambios" : "Crear gasto fijo"}
          </Button>
        </div>
      </aside>
    </>
  );
}

function PagarDrawer({ open, gastoFijo, proveedores, onClose }: {
  open: boolean; gastoFijo: GastoFijoRow | null; proveedores: Proveedor[]; onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [montoStr,   setMontoStr]   = useState("");
  const [fecha,       setFecha]     = useState("");
  const [proveedor,   setProveedor] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !gastoFijo) return;
    setMontoStr(String(gastoFijo.monto_estimado));
    setFecha(new Date().toISOString().slice(0, 10));
    setProveedor("");
    setError(null);
  }, [open, gastoFijo]);

  function handleSubmit() {
    if (!gastoFijo) return;
    setError(null);
    const monto = parseFloat(montoStr);
    if (!monto || monto <= 0) { setError("Ingresá un monto válido"); return; }
    if (!fecha) { setError("Ingresá una fecha"); return; }

    startTransition(async () => {
      try {
        await marcarGastoFijoPagado({
          gasto_fijo_id: gastoFijo.id,
          categoria:     gastoFijo.categoria,
          monto,
          fecha,
          proveedor:     proveedor || null,
          sucursal_id:   gastoFijo.sucursal_id,
        });
        onClose();
      } catch (e) { setError((e as Error).message); }
    });
  }

  if (!open || !gastoFijo) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <h2 className="text-base font-semibold font-display text-neutral-900">Marcar como pagado</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-sm text-neutral-600">{gastoFijo.descripcion} — estimado {AR.format(gastoFijo.monto_estimado)}</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Monto pagado *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={montoStr}
                  onChange={(e) => setMontoStr(e.target.value)}
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white pl-6 pr-3 text-sm focus:outline-none focus:border-tierra-700 tabular-nums"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Fecha de pago *</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Proveedor / a quién se le pagó</label>
            {proveedores.length > 0 ? (
              <select
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              >
                <option value="">—</option>
                {proveedores.map((p) => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
              </select>
            ) : (
              <input
                type="text" placeholder="Ej: Panadería López"
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              />
            )}
          </div>

          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">Confirmar pago</Button>
        </div>
      </aside>
    </>
  );
}

export function GastosFijosView({ mes, items, sucursales, proveedores }: {
  mes: string; items: GastoFijoRow[]; sucursales: Sucursal[]; proveedores: Proveedor[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState<GastoFijoRow | null>(null);
  const [pagando,    setPagando]    = useState<GastoFijoRow | null>(null);

  const estimado     = items.reduce((s, i) => s + i.monto_estimado, 0);
  const ejecutado     = items.reduce((s, i) => s + (i.pago?.monto ?? 0), 0);
  const comprometido = items.filter((i) => !i.pago).reduce((s, i) => s + i.monto_estimado, 0);

  function openNew()             { setEditing(null); setDrawerOpen(true); }
  function openEdit(g: GastoFijoRow) { setEditing(g);     setDrawerOpen(true); }
  function closeDrawer()         { setDrawerOpen(false); setEditing(null); router.refresh(); }
  function closePagar()          { setPagando(null); router.refresh(); }

  function handleDesactivar(id: string) {
    if (!confirm("¿Desactivar este gasto fijo? Va a dejar de aparecer en los meses siguientes.")) return;
    startTransition(async () => { await toggleGastoFijoActivo(id, true); router.refresh(); });
  }

  function handleEliminar(id: string) {
    if (!confirm("¿Eliminar este gasto fijo? Esta acción no se puede deshacer.")) return;
    startTransition(async () => { await eliminarGastoFijo(id); router.refresh(); });
  }

  const mesLabel = new Date(mes + "-01T12:00:00").toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold font-display text-neutral-900">Presupuesto de gastos fijos</h2>
          <p className="text-xs text-neutral-400 mt-0.5">Alquiler, sueldos y servicios previstos para {mesLabel}</p>
        </div>
        <Button type="button" size="sm" onClick={openNew}>
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nuevo gasto fijo
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Estimado</p>
          <p className="text-2xl font-bold font-display tabular-nums text-neutral-900">{AR.format(estimado)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{items.length} {items.length === 1 ? "gasto fijo activo" : "gastos fijos activos"}</p>
        </div>
        <div className={`rounded-xl border p-4 ${comprometido > 0 ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-white"}`}>
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Comprometido</p>
          <p className={`text-2xl font-bold font-display tabular-nums ${comprometido > 0 ? "text-amber-700" : "text-neutral-900"}`}>{AR.format(comprometido)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">Previsto, todavía sin pagar</p>
        </div>
        <div className="rounded-xl border border-selva-200 bg-selva-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Ejecutado</p>
          <p className="text-2xl font-bold font-display tabular-nums text-selva-700">{AR.format(ejecutado)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">Ya pagado este mes</p>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400">No hay gastos fijos cargados todavía.</p>
        ) : (
          items
            .slice()
            .sort((a, b) => a.dia_vencimiento - b.dia_vencimiento)
            .map((g) => (
              <div key={g.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-neutral-800 truncate">{g.descripcion}</span>
                    <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-600">
                      {CATEGORIA_LABEL[g.categoria]}
                    </span>
                    <span className="text-xs text-neutral-400">vence día {g.dia_vencimiento}</span>
                    {g.sucursal && <span className="text-xs text-neutral-400">· {g.sucursal.nombre}</span>}
                  </div>
                  <div className="mt-1 text-xs">
                    {g.pago ? (
                      <span className="text-selva-700 font-medium">
                        Pagado {AR.format(g.pago.monto)} el {new Date(g.pago.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                      </span>
                    ) : (
                      <span className="text-amber-700 font-medium">Pendiente — estimado {AR.format(g.monto_estimado)}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  {!g.pago && (
                    <button onClick={() => setPagando(g)} className="text-selva-700 hover:underline font-semibold">Marcar pagado</button>
                  )}
                  <button onClick={() => openEdit(g)} className="text-tierra-700 hover:underline font-medium">Editar</button>
                  <button onClick={() => handleDesactivar(g.id)} className="text-neutral-500 hover:underline font-medium">Desactivar</button>
                  <button onClick={() => handleEliminar(g.id)} className="text-danger hover:underline font-medium">Eliminar</button>
                </div>
              </div>
            ))
        )}
      </div>

      <GastoFijoDrawer open={drawerOpen} gastoFijo={editing} sucursales={sucursales} onClose={closeDrawer} />
      <PagarDrawer open={!!pagando} gastoFijo={pagando} proveedores={proveedores} onClose={closePagar} />
    </div>
  );
}
