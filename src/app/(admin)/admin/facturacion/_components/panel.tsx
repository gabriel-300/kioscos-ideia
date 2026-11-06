"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configurarSucursalArca, datosTicketComprobante, reintentarComprobante, reintentarPendientesAhora } from "../actions";
import { abrirTicketDespues, armarTicketHtml } from "@/lib/arca/ticket-html";
import { Emisores } from "./emisores";
import type { ComprobanteListado, EmisorRow, SucursalArca } from "../page";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const TIPO: Record<number, string> = { 1: "Factura A", 3: "Nota de crédito A", 6: "Factura B", 8: "Nota de crédito B" };
const ESTADO_CLASE: Record<string, string> = {
  emitido: "bg-selva-100 text-selva-700",
  pendiente: "bg-amber-100 text-amber-700",
  error: "bg-danger/10 text-danger",
};
const nro = (c: { punto_venta: number; numero: number | null }) =>
  c.numero ? `${String(c.punto_venta).padStart(5, "0")}-${String(c.numero).padStart(8, "0")}` : "—";

const input = "h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";
const boton = "h-9 rounded-lg bg-tierra-700 px-4 text-sm font-medium text-white hover:bg-tierra-800 disabled:opacity-50";

export function Panel({ emisores, sucursales, comprobantes }: { emisores: EmisorRow[]; sucursales: SucursalArca[]; comprobantes: ComprobanteListado[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const correr = (fn: () => Promise<{ error?: string }>, ok?: string) =>
    start(async () => { const r = await fn(); setMsg(r.error ?? ok ?? null); if (!r.error) router.refresh(); });

  const abiertos = comprobantes.filter((c) => c.estado !== "emitido");

  // La ventana se abre dentro del clic y se completa cuando llegan los datos (si no, el navegador bloquea el popup).
  const reimprimir = async (id: string) => {
    setMsg(null);
    const abierta = await abrirTicketDespues(async () => {
      const r = await datosTicketComprobante(id);
      if (r.error || !r.ticket) { setMsg(r.error ?? "No se pudo preparar el ticket."); return null; }
      return armarTicketHtml(r.ticket);
    });
    if (!abierta) setMsg((m) => m ?? "No se pudo abrir la ventana de impresión: revisá que el navegador permita ventanas emergentes para este sitio.");
  };


  return (
    <div className="space-y-6">
      {msg && <div className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700">{msg}</div>}

      {/* Pendientes y errores */}
      {abiertos.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-amber-900">Para revisar ({abiertos.length})</h2>
            <button disabled={pending} className={boton} onClick={() =>
              start(async () => { const r = await reintentarPendientesAhora(); setMsg(r.error ?? `Se intentaron ${r.intentados} y se emitieron ${r.emitidos}.`); router.refresh(); })}>
              Reintentar pendientes
            </button>
          </div>
          <ul className="mt-3 divide-y divide-amber-200 text-sm">
            {abiertos.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_CLASE[c.estado]}`}>{c.estado}</span>
                  {TIPO[c.cbte_tipo]} · {c.sucursal?.nombre} · {AR.format(c.imp_total)} · {c.fecha}
                  <div className="text-xs text-neutral-600">{c.error ?? "Esperando a ARCA"} (intentos: {c.intentos})</div>
                </div>
                <button disabled={pending} className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-50"
                  onClick={() => correr(() => reintentarComprobante(c.id), "Listo.")}>Reintentar</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Emisores emisores={emisores} />

      {/* Sucursales */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="font-semibold text-neutral-900">Sucursales</h2>
        <p className="text-xs text-neutral-500">Cada kiosco necesita su punto de venta de tipo «Factura electrónica – Web Services» dado de alta en ARCA.</p>
        <div className="mt-3 space-y-2">
          {sucursales.map((s) => <FilaSucursal key={s.id} s={s} emisores={emisores} pending={pending} onGuardar={(d) => correr(() => configurarSucursalArca({ sucursalId: s.id, ...d }), `${s.nombre}: guardado.`)} />)}
        </div>
      </section>

      {/* Últimos comprobantes */}
      <section className="rounded-xl border border-neutral-200 bg-white">
        <h2 className="p-4 pb-2 font-semibold text-neutral-900">Últimos comprobantes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-y border-neutral-100 bg-neutral-50 text-left text-xs uppercase text-neutral-500">
              <th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Comprobante</th><th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Sucursal</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2">CAE</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {comprobantes.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-neutral-400">Todavía no se emitió ninguno.</td></tr>}
              {comprobantes.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 tabular-nums">{c.fecha}</td>
                  <td className="px-4 py-2">{TIPO[c.cbte_tipo]}{c.ambiente === "homologacion" && <span className="ml-1 text-xs text-amber-700">(prueba)</span>}</td>
                  <td className="px-4 py-2 tabular-nums">{nro(c)}</td>
                  <td className="px-4 py-2">{c.sucursal?.nombre}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{AR.format(c.imp_total)}</td>
                  <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_CLASE[c.estado]}`}>{c.estado}</span></td>
                  <td className="px-4 py-2 tabular-nums text-xs text-neutral-500">{c.cae ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {c.estado === "emitido" && (c.cbte_tipo === 1 || c.cbte_tipo === 6) && (
                      <button className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-50"
                        title="Volver a imprimir esta factura" onClick={() => reimprimir(c.id)}>Imprimir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FilaSucursal({ s, emisores, pending, onGuardar }: {
  s: SucursalArca; emisores: EmisorRow[]; pending: boolean;
  onGuardar: (d: { modo: "desactivado" | "digital"; emisorId: string | null; puntoVenta: number | null }) => void;
}) {
  const [modo, setModo] = useState(s.arca_modo);
  const [emisor, setEmisor] = useState(s.arca_emisor_id ?? "");
  const [pv, setPv] = useState(s.arca_punto_venta?.toString() ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-48 font-medium text-neutral-800">{s.nombre}</span>
      <select className={input} value={modo} onChange={(e) => setModo(e.target.value as typeof modo)}>
        <option value="desactivado">No factura</option>
        <option value="digital">Factura lo digital</option>
      </select>
      <select className={input} value={emisor} onChange={(e) => setEmisor(e.target.value)}>
        <option value="">— Emisor —</option>
        {emisores.map((e) => <option key={e.id} value={e.id}>{e.razon_social} ({e.ambiente === "produccion" ? "prod" : "prueba"})</option>)}
      </select>
      <input className={`${input} w-28`} placeholder="Pto. venta" inputMode="numeric" value={pv} onChange={(e) => setPv(e.target.value.replace(/\D/g, ""))} />
      <button disabled={pending} className={boton} onClick={() => onGuardar({ modo, emisorId: emisor || null, puntoVenta: pv ? Number(pv) : null })}>Guardar</button>
    </div>
  );
}
