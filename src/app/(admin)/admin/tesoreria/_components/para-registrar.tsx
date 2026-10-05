"use client";

import { useMemo, useState } from "react";
import { EgresoForm, type Borrador } from "./egreso-form";
import type { RetiroPendiente, EntregaPendiente } from "@/lib/tesoreria/consultas";
import { formatKg } from "@/lib/utils";

// Bandeja de lo que ya cargó el kiosco y todavía no está en la contabilidad. El kiosco carga para el stock y para
// la caja; el administrativo lo registra acá con el comprobante real en la mano (el monto del kiosco es solo una
// sugerencia: el personal suele equivocarse al cargarlo, y a veces ni lo carga). Cada ingreso de mercadería se
// despliega para ver qué productos y cuántos entraron, quién lo cargó y cuándo.

type Opcion = { id: string; nombre: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fechaCorta = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
const horaCorta = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });

function Flecha({ abierta }: { abierta: boolean }) {
  return (
    <svg className={`size-3.5 shrink-0 text-neutral-400 transition-transform ${abierta ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

export function ParaRegistrar({ retiros, entregas, sucursales, proveedores, puedeCargar }: {
  retiros: RetiroPendiente[]; entregas: EntregaPendiente[]; sucursales: Opcion[]; proveedores: Opcion[]; puedeCargar: boolean;
}) {
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [titulo, setTitulo]     = useState("");
  const [abierto, setAbierto]   = useState(false);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [desplegadas, setDesplegadas] = useState<Set<string>>(new Set());

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
      monto: totalSeleccion > 0 ? Math.round(totalSeleccion * 100) / 100 : undefined,   // sin importes del kiosco: se escribe el de la factura
      categoria: "mercaderia",
      sucursal_id: sucursalesDeLaSeleccion.size === 1 ? [...sucursalesDeLaSeleccion][0] : null,
      proveedor_id: proveedoresDeLaSeleccion.size === 1 ? ([...proveedoresDeLaSeleccion][0] as string) : null,
      descripcion: textos.join(" / "),
      entregas_ids: seleccion.map((e) => e.id),
    });
    setAbierto(true);
  }

  function alternar(conjunto: Set<string>, poner: (s: Set<string>) => void, id: string) {
    const n = new Set(conjunto);
    if (n.has(id)) n.delete(id); else n.add(id);
    poner(n);
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
                  {fechaCorta(r.fecha)} {horaCorta(r.created_at)} · {nombreSucursal.get(r.sucursal_id) ?? "—"}
                  {r.creado_por && ` · lo cargó ${r.creado_por}`}
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
          Lo cargó el kiosco para el stock. Tocá una para ver qué productos entraron. Marcá las que correspondan a una misma factura y registrá la compra con el importe real.
        </p>
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
          {entregas.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">No hay mercadería sin registrar.</p>
          ) : entregas.map((e) => {
            const desplegada = desplegadas.has(e.id);
            return (
              <div key={e.id}>
                <div className="px-4 py-3 flex items-center gap-3 hover:bg-neutral-50">
                  {puedeCargar && (
                    <input type="checkbox" aria-label="Elegir esta entrega" checked={elegidas.has(e.id)}
                      onChange={() => alternar(elegidas, setElegidas, e.id)}
                      className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20" />
                  )}
                  <button type="button" aria-expanded={desplegada} onClick={() => alternar(desplegadas, setDesplegadas, e.id)}
                    className="min-w-0 flex-1 flex items-center justify-between gap-3 text-left">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                        {e.proveedor || "Sin proveedor"} <Flecha abierta={desplegada} />
                      </span>
                      <span className="block text-xs text-neutral-400 mt-0.5">
                        {fechaCorta(e.fecha)} {horaCorta(e.created_at)} · {nombreSucursal.get(e.sucursal_id) ?? "—"} · {e.lineas.length} {e.lineas.length === 1 ? "producto" : "productos"}
                      </span>
                    </span>
                    {e.total > 0 ? (
                      <span className="text-sm tabular-nums text-neutral-500 shrink-0" title="Importe que cargó el kiosco (puede estar mal)">{AR.format(e.total)}</span>
                    ) : (
                      <span className="text-xs text-amber-700 shrink-0">Sin importe cargado</span>
                    )}
                  </button>
                </div>

                {desplegada && (
                  <div className="px-4 pb-4 pt-1 bg-neutral-50 border-t border-neutral-100">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
                            <th className="py-2 font-medium">Producto</th>
                            <th className="py-2 font-medium text-right">Cantidad</th>
                            <th className="py-2 font-medium text-right">Costo unit.</th>
                            <th className="py-2 font-medium text-right">Importe</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200">
                          {e.lineas.map((l, i) => (
                            <tr key={i}>
                              <td className="py-1.5 text-neutral-700">{l.producto}</td>
                              <td className="py-1.5 text-right tabular-nums text-neutral-700">{formatKg(l.cantidad)}{l.unidad ? ` ${l.unidad}` : ""}</td>
                              <td className="py-1.5 text-right tabular-nums text-neutral-500">{l.precio_unitario != null ? AR.format(l.precio_unitario) : "—"}</td>
                              <td className="py-1.5 text-right tabular-nums text-neutral-700">{l.subtotal != null ? AR.format(l.subtotal) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-neutral-500 mt-3">
                      {e.creado_por ? `Lo cargó ${e.creado_por}` : "Cargado en el kiosco"} el {fechaCorta(e.fecha)} a las {horaCorta(e.created_at)}
                      {e.nro_remito && ` · Remito N° ${e.nro_remito}`}
                      {e.notas && ` · Nota: ${e.notas}`}
                      {e.remito_image_url && (
                        <> · <a href={e.remito_image_url} target="_blank" rel="noopener noreferrer" className="text-tierra-700 hover:underline font-medium">ver foto del remito</a></>
                      )}
                    </p>
                    {e.total === 0 && (
                      <p className="text-xs text-amber-700 mt-1">El kiosco no cargó importes en esta entrega: el costo hay que tomarlo de la factura.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {puedeCargar && seleccion.length > 0 && (
          <div className="sticky bottom-4 mt-4 rounded-xl border border-tierra-200 bg-white shadow-lg px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-neutral-700">
              {seleccion.length} {seleccion.length === 1 ? "entrega" : "entregas"} · {totalSeleccion > 0 ? `${AR.format(totalSeleccion)} según el kiosco` : "sin importe del kiosco"}
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
