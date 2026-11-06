"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearEmisor, editarEmisor, probarConexionArca } from "../actions";
import type { PruebaEmisor } from "@/lib/arca/probar";
import { datosFaltantesEmisor } from "@/lib/arca/reglas";
import type { EmisorRow } from "../page";

const input = "h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";
const boton = "h-9 rounded-lg bg-tierra-700 px-4 text-sm font-medium text-white hover:bg-tierra-800 disabled:opacity-50";
const botonSecundario = "h-9 rounded-lg border border-neutral-300 bg-white px-4 text-sm hover:bg-neutral-50 disabled:opacity-50";

const faltantes = (e: EmisorRow) => datosFaltantesEmisor(e);

export function Emisores({ emisores }: { emisores: EmisorRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [pruebas, setPruebas] = useState<PruebaEmisor[] | null>(null);
  const [probando, setProbando] = useState(false);

  // formulario de edición
  const [razon, setRazon] = useState(""); const [dom, setDom] = useState(""); const [iibb, setIibb] = useState(""); const [inicio, setInicio] = useState(""); const [activo, setActivo] = useState(true); const [conRet, setConRet] = useState(false);
  // emisor nuevo
  const [cuit, setCuit] = useState(""); const [razonN, setRazonN] = useState(""); const [domN, setDomN] = useState(""); const [iibbN, setIibbN] = useState(""); const [inicioN, setInicioN] = useState("");
  const [amb, setAmb] = useState<"homologacion" | "produccion">("homologacion");

  const abrirEdicion = (e: EmisorRow) => {
    setEditando(e.id); setRazon(e.razon_social); setDom(e.domicilio ?? ""); setIibb(e.ingresos_brutos ?? ""); setInicio(e.inicio_actividades ?? ""); setActivo(e.activo); setConRet(e.factura_a_con_retencion);
  };
  const correr = (fn: () => Promise<{ error?: string }>, ok: string, alExito?: () => void) =>
    start(async () => { const r = await fn(); setMsg(r.error ?? ok); if (!r.error) { alExito?.(); router.refresh(); } });

  const probar = async () => {
    setProbando(true); setMsg(null); setPruebas(null);
    try {
      const r = await probarConexionArca();
      if (r.error) setMsg(r.error); else setPruebas(r.resultados ?? []);
    } catch (e) { setMsg(e instanceof Error ? e.message : "No se pudo hacer la prueba."); }
    setProbando(false);
  };

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-neutral-900">Emisores (a nombre de quién se factura)</h2>
        <button disabled={probando || pending} className={botonSecundario} onClick={probar}
          title="Solo lectura: pide el ticket de acceso y consulta los puntos de venta. No emite nada.">
          {probando ? "Probando…" : "Probar conexión con ARCA"}
        </button>
      </div>
      {msg && <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{msg}</p>}

      {pruebas && (
        <div className="mt-3 space-y-3">
          {pruebas.map((p) => (
            <div key={p.emisorId} className="rounded-lg border border-neutral-200 p-3 text-sm">
              <div className="font-medium text-neutral-900">
                {p.razonSocial} · CUIT {p.cuit} · <span className={p.ambiente === "produccion" ? "text-selva-700" : "text-amber-700"}>{p.ambiente === "produccion" ? "PRODUCCIÓN" : "homologación"}</span>
              </div>
              {p.ticket.ok
                ? <p className="text-selva-700">✓ Ticket de acceso OK ({p.ticket.ms} ms), vence {new Date(p.ticket.vence!).toLocaleString("es-AR")}</p>
                : <p className="text-danger">✗ No se pudo obtener el ticket de acceso: {p.ticket.error}</p>}
              {p.errorPuntosVenta && <p className="text-danger">✗ Puntos de venta: {p.errorPuntosVenta}</p>}
              {p.errorPuntosVenta && p.ambiente === "produccion" && p.errorPuntosVenta.includes("fetch failed") && (
                <p className="text-xs text-neutral-500">Si estás probando desde tu computadora (npm run dev) esto es normal: el servidor de ARCA producción solo responde desde Cloudflare. Probá desde la página publicada.</p>
              )}
              {p.ticket.ok && !p.errorPuntosVenta && p.puntosVenta.length === 0 && <p className="text-amber-700">ARCA no informa puntos de venta habilitados para facturar por sistema.</p>}
              {p.puntosVenta.length > 0 && (
                <ul className="mt-1 text-neutral-700">
                  {p.puntosVenta.map((pv) => (
                    <li key={pv.nro}>
                      Punto de venta {pv.nro} · {pv.emision}
                      {pv.bloqueado ? " · BLOQUEADO" : pv.baja ? " · de baja" : ` · último comprobante: B ${pv.ultimaFacturaB ?? "—"} · A ${pv.ultimaFacturaA ?? "—"} · A c/retención ${pv.ultimaFacturaARet ?? "—"}`}
                      {pv.error && <span className="text-danger"> ({pv.error})</span>}
                    </li>
                  ))}
                </ul>
              )}
              {p.sucursales.length > 0 && (
                <ul className="mt-2 border-t border-neutral-100 pt-2">
                  {p.sucursales.map((s) => (
                    <li key={s.nombre} className={s.estado === "ok" ? "text-selva-700" : "text-danger"}>
                      {s.estado === "ok" ? "✓" : "✗"} {s.nombre.trim()}{s.puntoVenta ? ` (punto de venta ${s.puntoVenta})` : ""}: {s.detalle}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <ul className="mt-3 divide-y divide-neutral-100 text-sm text-neutral-700">
        {emisores.length === 0 && <li className="py-2 text-neutral-400">Todavía no hay ninguno.</li>}
        {emisores.map((e) => (
          <li key={e.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {e.razon_social} · CUIT {e.cuit} · <span className={e.ambiente === "produccion" ? "font-semibold text-selva-700" : "text-amber-700"}>{e.ambiente === "produccion" ? "PRODUCCIÓN" : "homologación (pruebas)"}</span>
                {!e.activo && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">inactivo</span>}
                {e.factura_a_con_retencion && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Factura A sujeta a retención</span>}
                {faltantes(e).length > 0 && (
                  <div className="text-xs text-amber-700">Faltan datos para el ticket: {faltantes(e).join(", ")}. No se puede activar una sucursal con este emisor hasta completarlos.</div>
                )}
              </div>
              {editando !== e.id && <button className={botonSecundario} onClick={() => abrirEdicion(e)}>Editar</button>}
            </div>
            {editando === e.id && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 p-3">
                <input className={`${input} min-w-48`} placeholder="Razón social" value={razon} onChange={(x) => setRazon(x.target.value)} />
                <input className={`${input} min-w-64`} placeholder="Domicilio comercial" value={dom} onChange={(x) => setDom(x.target.value)} />
                <input className={input} placeholder="Ingresos Brutos" value={iibb} onChange={(x) => setIibb(x.target.value)} />
                <label className="flex items-center gap-1 text-xs text-neutral-500">Inicio de actividades
                  <input className={input} type="date" value={inicio} onChange={(x) => setInicio(x.target.value)} />
                </label>
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={activo} onChange={(x) => setActivo(x.target.checked)} /> Activo</label>
                <label className="flex w-full items-center gap-1 text-sm" title="ARCA no le habilita la Factura A común: emite la A con la leyenda «Operación sujeta a retención» (código 51). El cliente que la recibe retiene.">
                  <input type="checkbox" checked={conRet} onChange={(x) => setConRet(x.target.checked)} /> Su Factura A sale «sujeta a retención» (código 51)
                </label>
                <button disabled={pending} className={boton} onClick={() => correr(() => editarEmisor(e.id, { razon_social: razon, domicilio: dom, ingresos_brutos: iibb, inicio_actividades: inicio, activo, factura_a_con_retencion: conRet }), "Emisor actualizado.", () => setEditando(null))}>Guardar</button>
                <button disabled={pending} className={botonSecundario} onClick={() => setEditando(null)}>Cancelar</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
        <input className={input} placeholder="CUIT" value={cuit} onChange={(e) => setCuit(e.target.value)} />
        <input className={`${input} min-w-56`} placeholder="Razón social" value={razonN} onChange={(e) => setRazonN(e.target.value)} />
        <select className={input} value={amb} onChange={(e) => setAmb(e.target.value as typeof amb)}>
          <option value="homologacion">Homologación (pruebas)</option>
          <option value="produccion">Producción</option>
        </select>
        <input className={`${input} min-w-64`} placeholder="Domicilio comercial" value={domN} onChange={(e) => setDomN(e.target.value)} />
        <input className={input} placeholder="Ingresos Brutos" value={iibbN} onChange={(e) => setIibbN(e.target.value)} />
        <input className={input} type="date" title="Inicio de actividades" value={inicioN} onChange={(e) => setInicioN(e.target.value)} />
        <button disabled={pending} className={boton} onClick={() => correr(() => crearEmisor({ cuit, razon_social: razonN, ambiente: amb, domicilio: domN, ingresos_brutos: iibbN, inicio_actividades: inicioN }), "Emisor agregado.", () => { setCuit(""); setRazonN(""); setDomN(""); setIibbN(""); setInicioN(""); })}>Agregar emisor</button>
      </div>
    </section>
  );
}
