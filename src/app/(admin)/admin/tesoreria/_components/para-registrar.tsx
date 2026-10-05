"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { EgresoForm, type Borrador } from "./egreso-form";
import { descartarEntrega, restaurarEntrega } from "../actions";
import type { RetiroPendiente, EntregaPendiente, EntregaDescartada } from "@/lib/tesoreria/consultas";
import { formatKg, friendlyError } from "@/lib/utils";

// «Para registrar» tiene dos cosas muy distintas:
//   * Retiros de caja: plata que de verdad salió del cajón de un kiosco. Es una tarea: hay que explicarla.
//   * Mercadería: la contabilidad nace de la FACTURA o el remito, no de lo que cargó el kiosco (que suele venir sin proveedor
//     y sin importes). Se arranca con «Nueva compra»; los ingresos del kiosco son un CONTROL de conciliación (se pueden
//     vincular a la compra para comparar, o marcar «no corresponde»), no una lista de pendientes.

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

export function ParaRegistrar({ retiros, entregas, descartadas, sucursales, proveedores, puedeCargar }: {
  retiros: RetiroPendiente[]; entregas: EntregaPendiente[]; descartadas: EntregaDescartada[];
  sucursales: Opcion[]; proveedores: Opcion[]; puedeCargar: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [titulo, setTitulo]     = useState("");
  const [abierto, setAbierto]   = useState(false);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [desplegadas, setDesplegadas] = useState<Set<string>>(new Set());
  const [controlAbierto, setControlAbierto] = useState(false);
  const [verDescartadas, setVerDescartadas] = useState(false);
  const [descartando, setDescartando] = useState<EntregaPendiente | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError]   = useState<string | null>(null);

  const nombreSucursal = useMemo(() => new Map(sucursales.map((s) => [s.id, s.nombre])), [sucursales]);
  const seleccion = entregas.filter((e) => elegidas.has(e.id));
  const totalSeleccion = seleccion.reduce((s, e) => s + e.total, 0);

  function registrarRetiro(r: RetiroPendiente) {
    setTitulo("Registrar retiro de caja");
    setBorrador({
      fecha: r.fecha, monto: r.monto, sucursal_id: r.sucursal_id, descripcion: r.motivo ?? "",
      proveedor_id: r.proveedor_id, categoria: r.proveedor_id ? "mercaderia" : undefined,
      retiros_caja_ids: [r.id], origen: "retiro_caja", pagado: true,
    });
    setAbierto(true);
  }

  function nuevaCompra() {
    setTitulo("Nueva compra de mercadería");
    setBorrador({ categoria: "mercaderia" });
    setAbierto(true);
  }

  function registrarCompraDeLaSeleccion() {
    if (seleccion.length === 0) return;
    const sucursalesDeLaSeleccion = new Set(seleccion.map((e) => e.sucursal_id));
    const proveedoresDeLaSeleccion = new Set(seleccion.map((e) => e.proveedor_id).filter(Boolean));
    const textos = [...new Set(seleccion.map((e) => e.proveedor?.trim()).filter(Boolean))] as string[];
    setTitulo("Registrar compra de mercadería");
    setBorrador({
      fecha: seleccion.map((e) => e.fecha).sort().at(-1),   // la más reciente
      categoria: "mercaderia",
      sucursal_id: sucursalesDeLaSeleccion.size === 1 ? [...sucursalesDeLaSeleccion][0] : null,
      proveedor_id: proveedoresDeLaSeleccion.size === 1 ? ([...proveedoresDeLaSeleccion][0] as string) : null,
      descripcion: textos.join(" / "),
      entregas_ids: seleccion.map((e) => e.id),
      // El importe lo escribe el administrativo con la factura en la mano: el del kiosco es solo una referencia que se ve en el formulario.
    });
    setAbierto(true);
  }

  function alternar(conjunto: Set<string>, poner: (s: Set<string>) => void, id: string) {
    const n = new Set(conjunto);
    if (n.has(id)) n.delete(id); else n.add(id);
    poner(n);
  }

  function cerrar() { setAbierto(false); setBorrador(null); setElegidas(new Set()); }

  function confirmarDescarte() {
    if (!descartando) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await descartarEntrega(descartando.id, motivo);
        if (r.error) { setError(r.error); return; }
        setDescartando(null); setMotivo("");
        router.refresh();
      } catch (e) { setError(friendlyError(e)); }
    });
  }

  function restaurar(id: string) {
    startTransition(async () => {
      const r = await restaurarEntrega(id);
      if (r.error) alert(r.error);
      router.refresh();
    });
  }

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
                <p className="text-sm font-medium text-neutral-800">
                  {r.proveedor_id && (
                    <span className="mr-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Pago a proveedor{r.autorizado_por ? ` · autorizó ${r.autorizado_por}` : ""}
                    </span>
                  )}
                  {r.motivo || "Sin motivo"}
                </p>
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
        <h2 className="text-base font-semibold font-display text-neutral-900">Compras de mercadería</h2>
        <p className="text-xs text-neutral-400 mt-0.5 mb-3">
          La compra se carga con la factura o el remito en la mano: proveedor, importe real y si tiene factura. Después, si querés, vinculás los ingresos que cargó el kiosco para comparar.
        </p>
        {puedeCargar ? (
          <Button type="button" size="sm" onClick={nuevaCompra}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nueva compra de mercadería
          </Button>
        ) : (
          <p className="text-sm text-neutral-400">Solo el administrativo carga compras.</p>
        )}
      </section>

      <section>
        <button type="button" aria-expanded={controlAbierto} onClick={() => setControlAbierto(!controlAbierto)}
          className="w-full flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left hover:bg-neutral-50">
          <span>
            <span className="block text-sm font-semibold text-neutral-900">Control: ingresos del kiosco sin compra asociada</span>
            <span className="block text-xs text-neutral-400 mt-0.5">Lo que el kiosco cargó para el stock y todavía no tiene una compra vinculada. Sirve para controlar que no falte registrar nada.</span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <span className="inline-flex min-w-6 h-6 items-center justify-center rounded-full bg-neutral-100 px-2 text-xs font-bold text-neutral-700">{entregas.length}</span>
            <Flecha abierta={controlAbierto} />
          </span>
        </button>

        {controlAbierto && (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
              {entregas.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-neutral-400">No hay ingresos sin compra asociada.</p>
              ) : entregas.map((e) => {
                const desplegada = desplegadas.has(e.id);
                return (
                  <div key={e.id}>
                    <div className="px-4 py-3 flex items-center gap-3 hover:bg-neutral-50">
                      {puedeCargar && (
                        <input type="checkbox" aria-label="Elegir este ingreso" checked={elegidas.has(e.id)}
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
                      {puedeCargar && (
                        <button type="button" onClick={() => { setDescartando(e); setMotivo(""); setError(null); }}
                          className="text-xs text-neutral-500 hover:text-danger hover:underline shrink-0">No corresponde</button>
                      )}
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
                          <p className="text-xs text-amber-700 mt-1">El kiosco no cargó importes en este ingreso: el costo hay que tomarlo de la factura.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {puedeCargar && seleccion.length > 0 && (
              <div className="sticky bottom-4 rounded-xl border border-tierra-200 bg-white shadow-lg px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-sm text-neutral-700">
                  {seleccion.length} {seleccion.length === 1 ? "ingreso" : "ingresos"} · {totalSeleccion > 0 ? `${AR.format(totalSeleccion)} según el kiosco` : "sin importe del kiosco"}
                </p>
                <button onClick={registrarCompraDeLaSeleccion} className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-semibold hover:bg-tierra-800 transition-colors">
                  Registrar compra con estos
                </button>
              </div>
            )}

            {descartadas.length > 0 && (
              <div>
                <button type="button" onClick={() => setVerDescartadas(!verDescartadas)} className="text-xs font-semibold text-neutral-500 hover:underline inline-flex items-center gap-1.5">
                  Marcados «no corresponde» ({descartadas.length}) <Flecha abierta={verDescartadas} />
                </button>
                {verDescartadas && (
                  <div className="mt-2 rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
                    {descartadas.map((d) => (
                      <div key={d.id} className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                        <p className="text-xs text-neutral-600">
                          {d.proveedor || "Sin proveedor"} · {fechaCorta(d.fecha)} · {nombreSucursal.get(d.sucursal_id) ?? "—"} · {d.lineas} {d.lineas === 1 ? "producto" : "productos"}
                          <span className="block text-neutral-400">«{d.motivo}»{d.descartado_por && ` — ${d.descartado_por}`}</span>
                        </p>
                        {puedeCargar && (
                          <button onClick={() => restaurar(d.id)} disabled={pending} className="text-xs font-semibold text-tierra-700 hover:underline disabled:opacity-50">Volver a la lista</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {descartando && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setDescartando(null)} />
          <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold font-display text-neutral-900">Este ingreso no corresponde</h2>
            <p className="text-sm text-neutral-600">{descartando.proveedor || "Sin proveedor"} · {fechaCorta(descartando.fecha)} · {descartando.lineas.length} {descartando.lineas.length === 1 ? "producto" : "productos"}</p>
            <div>
              <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Motivo *</label>
              <input type="text" maxLength={200} placeholder="Ej: se cargó dos veces, es una transferencia entre kioscos" value={motivo} onChange={(ev) => setMotivo(ev.target.value)}
                className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700" />
              <p className="text-xs text-neutral-400 mt-1.5">Es solo una marca de Tesorería: el stock no cambia. Se puede volver a la lista.</p>
            </div>
            {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3">
              <Button variant="ghost" size="sm" onClick={() => setDescartando(null)} className="flex-1">Cancelar</Button>
              <Button variant="primary" size="sm" loading={pending} onClick={confirmarDescarte} className="flex-1">Confirmar</Button>
            </div>
          </div>
        </>
      )}

      <EgresoForm open={abierto} titulo={titulo} borrador={borrador} sucursales={sucursales} proveedores={proveedores}
        entregasDisponibles={entregas} onClose={cerrar} />
    </div>
  );
}
