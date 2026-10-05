"use client";

import { useMemo, useState } from "react";
import { EgresoForm, type Borrador } from "./egreso-form";
import type { RetiroPendiente, EntregaPendiente } from "@/lib/tesoreria/consultas";

// Bandeja de lo que ya cargó el kiosco y todavía no está en la contabilidad. El kiosco carga para el stock y para
// la caja; el administrativo lo registra acá con el comprobante real en la mano (el monto del kiosco es solo una
// sugerencia: el personal suele equivocarse al cargarlo).

type Opcion = { id: string; nombre: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fechaCorta = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

export function ParaRegistrar({ retiros, entregas, sucursales, proveedores, puedeCargar }: {
  retiros: RetiroPendiente[]; entregas: EntregaPendiente[]; sucursales: Opcion[]; proveedores: Opcion[]; puedeCargar: boolean;
}) {
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [titulo, setTitulo]     = useState("");
  const [abierto, setAbierto]   = useState(false);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());

  const nombreSucursal = useMemo(() => new Map(sucursales.map((s) => [s.id, s.nombre])), [sucursales]);
  const seleccion = entregas.filter((e) => elegidas.has(e.id));
  const totalSeleccion = seleccion.reduce((s, e) => s + e.total, 0);

  function registrarRetiro(r: RetiroPendiente) {
    setTitulo("Registrar retiro de caja");
    setBorrador({
      fecha: r.fecha, monto: r.monto, sucursal_id: r.sucursal_id, descripcion: r.motivo ?? "",
      retiros_caja_ids: [r.id], origen: "retiro_caja", pagado: true,
    });
    setAbierto(true);
  }

  function registrarCompra() {
    if (seleccion.length === 0) return;
    const sucursalesDeLaSeleccion = new Set(seleccion.map((e) => e.sucursal_id));
    const proveedoresDeLaSeleccion = new Set(seleccion.map((e) => e.proveedor_id).filter(Boolean));
    const textos = [...new Set(seleccion.map((e) => e.proveedor?.trim()).filter(Boolean))] as string[];
    setTitulo("Registrar compra de mercadería");
    setBorrador({
      fecha: seleccion.map((e) => e.fecha).sort().at(-1),   // la más reciente
      monto: Math.round(totalSeleccion * 100) / 100,
      categoria: "mercaderia",
      sucursal_id: sucursalesDeLaSeleccion.size === 1 ? [...sucursalesDeLaSeleccion][0] : null,
      proveedor_id: proveedoresDeLaSeleccion.size === 1 ? ([...proveedoresDeLaSeleccion][0] as string) : null,
      descripcion: textos.join(" / "),
      entregas_ids: seleccion.map((e) => e.id),
    });
    setAbierto(true);
  }

  function alternar(id: string) {
    setElegidas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function cerrar() { setAbierto(false); setBorrador(null); setElegidas(new Set()); }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-base font-semibold font-display text-neutral-900">Retiros de caja</h2>
        <p className="text-xs text-neutral-400 mt-0.5 mb-3">Plata que un kiosco sacó del cajón. Registrá en qué se gastó.</p>
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
          {retiros.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">No hay retiros sin registrar.</p>
          ) : retiros.map((r) => (
            <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800">{r.motivo || "Sin motivo"}</p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {fechaCorta(r.fecha)} · {nombreSucursal.get(r.sucursal_id) ?? "—"}
                  {r.comprobante_image_url && (
                    <> · <a href={r.comprobante_image_url} target="_blank" rel="noopener noreferrer" className="text-tierra-700 hover:underline">ver foto</a></>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-sm font-semibold tabular-nums text-neutral-900">{AR.format(r.monto)}</span>
                {puedeCargar && (
                  <button onClick={() => registrarRetiro(r)} className="text-xs font-semibold text-tierra-700 hover:underline">Registrar</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold font-display text-neutral-900">Mercadería que ingresó</h2>
        <p className="text-xs text-neutral-400 mt-0.5 mb-3">
          Lo cargó el kiosco para el stock. Marcá las que correspondan a una misma factura y registrá la compra con el importe real.
        </p>
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
          {entregas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">No hay mercadería sin registrar.</p>
          ) : entregas.map((e) => (
            <label key={e.id} className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-neutral-50">
              {puedeCargar && (
                <input type="checkbox" checked={elegidas.has(e.id)} onChange={() => alternar(e.id)}
                  className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-800">{e.proveedor || "Sin proveedor"}</p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {fechaCorta(e.fecha)} · {nombreSucursal.get(e.sucursal_id) ?? "—"}
                  {e.remito_image_url && (
                    <> · <a href={e.remito_image_url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} className="text-tierra-700 hover:underline">ver remito</a></>
                  )}
                </p>
              </div>
              <span className="text-sm tabular-nums text-neutral-500 shrink-0" title="Importe que cargó el kiosco (puede estar mal)">{AR.format(e.total)}</span>
            </label>
          ))}
        </div>

        {puedeCargar && seleccion.length > 0 && (
          <div className="sticky bottom-4 mt-4 rounded-xl border border-tierra-200 bg-white shadow-lg px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-700">
              {seleccion.length} {seleccion.length === 1 ? "entrega" : "entregas"} · {AR.format(totalSeleccion)} según el kiosco
            </p>
            <button onClick={registrarCompra} className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-semibold hover:bg-tierra-800 transition-colors">
              Registrar compra
            </button>
          </div>
        )}
      </section>

      <EgresoForm open={abierto} titulo={titulo} borrador={borrador} sucursales={sucursales} proveedores={proveedores} onClose={cerrar} />
    </div>
  );
}
