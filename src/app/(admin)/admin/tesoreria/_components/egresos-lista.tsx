"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { EgresoForm } from "./egreso-form";
import { anularEgreso, marcarEgresoPagado, urlComprobante } from "../actions";
import { ORIGENES, etiquetaCategoria, etiquetaOrigen, type Egreso } from "@/lib/tesoreria/tipos";
import { fechaHoyAR } from "@/lib/fecha";
import { friendlyError } from "@/lib/utils";

type Opcion = { id: string; nombre: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fechaCorta = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

type Accion = { tipo: "pagar" | "anular"; egreso: Egreso } | null;

export function EgresosLista({ egresos, pendientes, sucursales, proveedores, puedeCargar }: {
  egresos: Egreso[]; pendientes: Egreso[]; sucursales: Opcion[]; proveedores: Opcion[]; puedeCargar: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nuevo, setNuevo]       = useState(false);
  const [accion, setAccion]     = useState<Accion>(null);
  const [error, setError]       = useState<string | null>(null);
  const [origen, setOrigen]     = useState("");
  const [fechaPago, setFechaPago] = useState("");
  const [motivo, setMotivo]     = useState("");

  const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
  const nombreProveedor = new Map(proveedores.map((p) => [p.id, p.nombre]));

  function abrirAccion(tipo: "pagar" | "anular", egreso: Egreso) {
    setAccion({ tipo, egreso }); setError(null); setOrigen(""); setMotivo(""); setFechaPago(fechaHoyAR());
  }

  function confirmar() {
    if (!accion) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = accion.tipo === "pagar"
          ? await marcarEgresoPagado(accion.egreso.id, { origen, fecha_pago: fechaPago })
          : await anularEgreso(accion.egreso.id, motivo);
        if (r.error) { setError(r.error); return; }
        setAccion(null);
        router.refresh();
      } catch (e) { setError(friendlyError(e)); }
    });
  }

  // La pestaña se abre en el mismo clic y recién después se le pone la dirección firmada: si se abriera después de
  // esperar al servidor, el navegador la tomaría por una ventana emergente y la bloquearía.
  async function verComprobante(id: string) {
    const pestana = window.open("", "_blank");
    const r = await urlComprobante(id);
    if ("error" in r) { pestana?.close(); alert(r.error); return; }
    if (pestana) pestana.location.href = r.url; else window.open(r.url, "_blank", "noopener,noreferrer");
  }

  function fila(e: Egreso) {
    return (
      <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-neutral-800">{e.descripcion}</span>
            <span className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-600">
              {etiquetaCategoria(e.categoria)}
            </span>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${e.comprobante === "con" ? "border-selva-200 bg-selva-50 text-selva-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              {e.comprobante === "con" ? `Con factura${e.comprobante_numero ? ` ${e.comprobante_numero}` : ""}` : "Sin factura"}
            </span>
            {!e.pagado && (
              <span className="inline-flex rounded-full border border-danger/30 bg-danger/5 px-2 py-0.5 text-xs font-semibold text-danger">Se debe</span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            {fechaCorta(e.fecha)} · {e.sucursal_id ? (nombreSucursal.get(e.sucursal_id) ?? "—") : "General"}
            {e.proveedor_id && ` · ${nombreProveedor.get(e.proveedor_id) ?? "Proveedor"}`}
            {e.pagado && e.origen && ` · ${etiquetaOrigen(e.origen)}`}
            {e.nota && ` · ${e.nota}`}
          </p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-sm font-semibold tabular-nums text-neutral-900">{AR.format(e.monto)}</span>
          <div className="flex items-center gap-3 text-xs">
            {e.comprobante_path && <button onClick={() => verComprobante(e.id)} className="text-tierra-700 hover:underline font-medium">Ver archivo</button>}
            {puedeCargar && !e.pagado && <button onClick={() => abrirAccion("pagar", e)} className="text-selva-700 hover:underline font-semibold">Marcar pagado</button>}
            {puedeCargar && <button onClick={() => abrirAccion("anular", e)} className="text-danger hover:underline font-medium">Anular</button>}
          </div>
        </div>
      </div>
    );
  }

  const idsPendientes = new Set(pendientes.map((p) => p.id));
  const delMes = egresos.filter((e) => !idsPendientes.has(e.id));   // los pendientes van arriba, una sola vez

  return (
    <div className="space-y-4">
      {puedeCargar && (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => setNuevo(true)}>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo egreso
          </Button>
        </div>
      )}

      {pendientes.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-neutral-900 mb-2">Se debe <span className="font-normal text-neutral-400">— pendientes de pago de cualquier mes</span></h2>
          <div className="rounded-xl border border-amber-200 bg-white overflow-hidden divide-y divide-neutral-100">
            {pendientes.map((e) => fila(e))}
          </div>
        </section>
      )}

      <section>
        {pendientes.length > 0 && <h2 className="text-sm font-semibold text-neutral-900 mb-2">Del mes</h2>}
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
          {delMes.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-neutral-400">No hay egresos cargados en este mes.</p>
          ) : delMes.map((e) => fila(e))}
        </div>
      </section>

      <EgresoForm open={nuevo} titulo="Nuevo egreso" borrador={null} sucursales={sucursales} proveedores={proveedores} onClose={() => setNuevo(false)} />

      {accion && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setAccion(null)} />
          <div className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <h2 className="text-base font-semibold font-display text-neutral-900">
              {accion.tipo === "pagar" ? "Marcar como pagado" : "Anular egreso"}
            </h2>
            <p className="text-sm text-neutral-600">{accion.egreso.descripcion} — {AR.format(accion.egreso.monto)}</p>

            {accion.tipo === "pagar" ? (
              <>
                <div>
                  <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">¿Cómo se pagó? *</label>
                  <select value={origen} onChange={(ev) => setOrigen(ev.target.value)}
                    className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
                    <option value="">— Elegí —</option>
                    {ORIGENES.filter((o) => o.valor !== "retiro_caja").map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Fecha de pago *</label>
                  <input type="date" value={fechaPago} onChange={(ev) => setFechaPago(ev.target.value)}
                    className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700" />
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5">Motivo *</label>
                <input type="text" maxLength={200} placeholder="Ej: lo cargué dos veces" value={motivo} onChange={(ev) => setMotivo(ev.target.value)}
                  className="h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700" />
                <p className="text-xs text-neutral-400 mt-1.5">No se borra: queda anulado con tu nombre. Si venía de un retiro o de una entrega del kiosco, vuelve a «Para registrar».</p>
              </div>
            )}

            {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
            <div className="flex gap-3">
              <Button variant="ghost" size="sm" onClick={() => setAccion(null)} className="flex-1">Cancelar</Button>
              <Button variant="primary" size="sm" loading={pending} onClick={confirmar} className="flex-1">
                {accion.tipo === "pagar" ? "Confirmar pago" : "Anular"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
