"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fechaHoyAR } from "@/lib/fecha";
import type { ACobrarPeya } from "@/lib/tesoreria/peya";
import type { ArchivoPeya, LiquidacionPeya, PedidoGuardado } from "@/lib/tesoreria/peya-consultas";
import { candidatosAcreditacionMp, conciliarPedidoPeya, registrarAcreditacionPeya, urlArchivoPeya, type CandidatoAcreditacion } from "../peya-actions";
import { ImportarPeya } from "./importar-peya";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const m = (n: number | null | undefined) => (n === null || n === undefined ? "—" : AR.format(n));
const dma = (f: string | null | undefined) => (f ? f.split("-").reverse().join("/") : "—");
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export interface VentaSinPeya { id: string; creado_en: string; total: number; canal: string }

export interface PeyaData {
  liquidaciones: LiquidacionPeya[];
  nombreLocal:   Record<string, string>;
  aCobrar:       ACobrarPeya;
  detalle: {
    liquidacion: LiquidacionPeya;
    pedidos:     PedidoGuardado[];
    archivos:    ArchivoPeya[];
    ventasSinPeya: VentaSinPeya[];     // ventas del kiosco en el período que no se cruzaron con ningún pedido
  } | null;
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  estimado:   { texto: "Estimado",   clase: "bg-amber-50 text-amber-800 border-amber-200" },
  confirmado: { texto: "Confirmado por PedidosYa", clase: "bg-blue-50 text-blue-700 border-blue-200" },
  acreditado: { texto: "Acreditado", clase: "bg-selva-50 text-selva-700 border-selva-200" },
  conciliado: { texto: "Conciliado con Mercado Pago", clase: "bg-selva-50 text-selva-700 border-selva-200" },
};
const CRUCE: Record<string, { texto: string; clase: string }> = {
  conciliado:         { texto: "Cruzado con una venta",           clase: "text-selva-700" },
  sin_venta:          { texto: "Sin venta en el sistema",         clase: "text-amber-800 font-medium" },
  importe_distinto:   { texto: "Importe distinto",                clase: "text-amber-800 font-medium" },
  efectivo_pendiente: { texto: "Efectivo: pendiente de validar",  clase: "text-neutral-600" },
  no_aplica:          { texto: "No aplica (cancelado)",           clase: "text-neutral-400" },
  sin_revisar:        { texto: "Sin revisar",                     clase: "text-neutral-400" },
};
function Etiqueta({ estado }: { estado: string }) {
  const e = ESTADO[estado] ?? ESTADO.estimado;
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${e.clase}`}>{e.texto}</span>;
}

function Tarjeta({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">{titulo}</p>
      <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{valor}</p>
      {pie && <p className="text-xs text-neutral-400 mt-0.5">{pie}</p>}
    </div>
  );
}

// Los cobros, para llevarlos a una planilla.
function exportarCsv(liqs: LiquidacionPeya[], nombreLocal: Record<string, string>) {
  const num = (n: number | null) => (n === null ? "" : n.toFixed(2).replace(".", ","));
  const filas = [
    ["Período desde", "Período hasta", "Local", "Estado", "Pedidos entregados", "Total liquidado", "Ingreso estimado de los pedidos", "Fecha de pago", "Fecha de pago estimada", "Acreditación hasta", "Acreditación real", "Monto acreditado", "Diferencia de cobro"],
    ...liqs.map((l) => [
      l.periodo_desde, l.periodo_hasta, nombreLocal[l.sucursal_id ?? ""] ?? "", l.estado, String(l.pedidos_entregados), num(l.total_liquidado), num(l.ingreso_estimado),
      l.fecha_pago_procesado ?? "", l.fecha_pago_estimada ?? "", l.fecha_acreditacion_hasta ?? "", l.fecha_acreditacion_real ?? "", num(l.monto_acreditado),
      l.monto_acreditado !== null && l.total_liquidado !== null ? num(Math.round((l.monto_acreditado - l.total_liquidado) * 100) / 100) : "",
    ]),
  ];
  const csv = "﻿" + filas.map((f) => f.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `cobros-pedidosya-${fechaHoyAR()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ── Detalle de una liquidación ───────────────────────────────────────────────
function Linea({ texto, valor, fuerte = false, nota }: { texto: string; valor: number | null; fuerte?: boolean; nota?: string }) {
  return (
    <li className={`flex justify-between gap-3 text-sm ${fuerte ? "pt-1.5 border-t border-neutral-200 font-semibold" : ""}`}>
      <span className={fuerte ? "" : "text-neutral-600"}>{texto}{nota && <span className="block text-xs text-neutral-400 font-normal">{nota}</span>}</span>
      <span className="tabular-nums whitespace-nowrap">{m(valor)}</span>
    </li>
  );
}

function RegistrarCobro({ liq }: { liq: LiquidacionPeya }) {
  const router = useRouter();
  const [fecha, setFecha] = useState(fechaHoyAR());
  const [monto, setMonto] = useState(liq.total_liquidado !== null ? String(liq.total_liquidado) : "");
  const [candidatos, setCandidatos] = useState<CandidatoAcreditacion[]>([]);
  const [elegido, setElegido] = useState<string>("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();

  useEffect(() => {
    let vivo = true;
    candidatosAcreditacionMp(liq.id).then((r) => { if (vivo && r.candidatos) setCandidatos(r.candidatos); });
    return () => { vivo = false; };
  }, [liq.id]);

  function elegir(c: CandidatoAcreditacion) {
    setElegido(c.operation_id); setFecha(c.fecha); setMonto(String(c.monto));
  }
  function guardar() {
    setError("");
    empezar(async () => {
      const r = await registrarAcreditacionPeya({ id: liq.id, fecha, monto: Number(monto.replace(",", ".")), mp_operation_id: elegido || null });
      if (r.error) { setError(r.error); return; }
      router.refresh();
    });
  }
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-3">
      <p className="text-sm font-medium text-neutral-900">Registrar que el cobro llegó</p>
      {candidatos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-neutral-500">Movimientos de Mercado Pago que podrían ser este pago (la PeYa Wallet transfiere cada semana a Mercado Pago):</p>
          {candidatos.map((c) => (
            <label key={c.operation_id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="mp" checked={elegido === c.operation_id} onChange={() => elegir(c)} />
              <span>{m(c.monto)} el {dma(c.fecha)}{c.igual ? <span className="ml-1 text-selva-700 text-xs">· coincide con lo esperado</span> : <span className="ml-1 text-amber-800 text-xs">· el monto es distinto</span>}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm text-neutral-500"><input type="radio" name="mp" checked={elegido === ""} onChange={() => setElegido("")} />Ninguno / otra cuenta</label>
        </div>
      )}
      <div className="flex gap-2 flex-wrap items-end">
        <div><label className="text-xs text-neutral-500 block mb-1">Fecha en que entró</label><input type="date" value={fecha} max={fechaHoyAR()} onChange={(e) => setFecha(e.target.value)} className="h-10 rounded-lg border border-neutral-300 px-3 text-sm" /></div>
        <div><label className="text-xs text-neutral-500 block mb-1">Monto que entró</label><input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" className="h-10 w-40 rounded-lg border border-neutral-300 px-3 text-sm" /></div>
        <button type="button" onClick={guardar} disabled={pendiente || !monto} className="h-10 rounded-lg bg-tierra-700 px-4 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">{pendiente ? "Guardando…" : "Registrar"}</button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function PedidoFila({ p, ventas, puedeCargar }: { p: PedidoGuardado; ventas: VentaSinPeya[]; puedeCargar: boolean }) {
  const router = useRouter();
  const [venta, setVenta] = useState("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();
  const c = CRUCE[p.conciliacion] ?? CRUCE.sin_revisar;
  const sinResolver = p.estado === "entregado" && (p.conciliacion === "sin_venta" || p.conciliacion === "importe_distinto");

  function cruzar(id: string | null) {
    setError("");
    empezar(async () => {
      const r = await conciliarPedidoPeya(p.id, id);
      if (r.error) { setError(r.error); return; }
      router.refresh();
    });
  }
  return (
    <tr className="border-b border-neutral-50 align-top">
      <td className="px-3 py-2 whitespace-nowrap tabular-nums text-xs">{p.nro_pedido}</td>
      <td className="px-3 py-2 whitespace-nowrap text-xs">{hora(p.fecha_pedido)}</td>
      <td className="px-3 py-2 text-xs">{p.estado}{p.motivo_rechazo ? ` · ${p.motivo_rechazo}` : ""}</td>
      <td className="px-3 py-2 text-right tabular-nums">{m(p.total_parcial)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{m(p.ingreso_estimado)}</td>
      <td className="px-3 py-2 text-xs">
        <span className={c.clase}>{c.texto}</span>
        {p.conciliacion === "importe_distinto" && p.diferencia_importe !== null && <span className="text-neutral-500"> ({m(p.diferencia_importe)})</span>}
        {sinResolver && puedeCargar && (
          <div className="mt-1 flex gap-1.5 flex-wrap items-center">
            <select value={venta} onChange={(e) => setVenta(e.target.value)} className="h-8 rounded border border-neutral-300 px-1 text-xs max-w-56">
              <option value="">Cruzar con una venta…</option>
              {ventas.map((v) => <option key={v.id} value={v.id}>{hora(v.creado_en)} · {m(v.total)}</option>)}
            </select>
            <button type="button" disabled={!venta || pendiente} onClick={() => cruzar(venta)} className="text-xs font-semibold text-tierra-700 hover:underline disabled:opacity-50">Cruzar</button>
          </div>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </td>
    </tr>
  );
}

function Detalle({ d, nombreLocal, puedeCargar }: { d: NonNullable<PeyaData["detalle"]>; nombreLocal: Record<string, string>; puedeCargar: boolean }) {
  const { liquidacion: l, pedidos, archivos, ventasSinPeya } = d;
  const cancelados = pedidos.filter((p) => p.estado === "cancelado");
  const cancelSinIva = cancelados.reduce((s, p) => s + p.gastos_operativos, 0);
  const ivaPublicidad = l.iva_comisiones !== null ? Math.round((l.iva_comisiones + l.impuestos_pedidos) * 100) / 100 : null;
  const [errorArchivo, setErrorArchivo] = useState("");

  async function abrir(id: string) {
    setErrorArchivo("");
    const r = await urlArchivoPeya(id);
    if ("error" in r) setErrorArchivo(r.error); else window.open(r.url, "_blank", "noopener");
  }
  const puedeAcreditar = puedeCargar && l.estado !== "estimado" && l.estado !== "conciliado";

  return (
    <section className="rounded-xl border border-tierra-700/30 bg-white p-4 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Liquidación del {dma(l.periodo_desde)} al {dma(l.periodo_hasta)} · {nombreLocal[l.sucursal_id ?? ""] ?? `tienda ${l.tienda_id}`}</h2>
          <p className="text-xs text-neutral-500 mt-0.5">{l.pedidos_entregados} pedidos entregados · {l.pedidos_cancelados} cancelados</p>
        </div>
        <div className="flex items-center gap-3"><Etiqueta estado={l.estado} /><Link href="/admin/tesoreria?vista=pedidosya" className="text-xs text-neutral-500 underline">Volver a la lista</Link></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Cómo se arma lo que se cobra</h3>
          <ul className="space-y-1.5">
            <Linea texto="Ventas netas" valor={l.ventas_netas} />
            <Linea texto="− Comisión por ventas" valor={-l.servicio_ventas} />
            <Linea texto="− Comisión por pago en línea" valor={-l.servicio_pago_linea} />
            <Linea texto="− Cargo por pedidos con Plus" valor={-l.cargo_plus} />
            {cancelSinIva > 0 && <Linea texto="− Cargos por cancelar pedidos" valor={-cancelSinIva} />}
            <Linea texto="− IVA de esas comisiones y cargos" valor={-l.impuestos_pedidos} />
            <Linea texto="= Ingreso estimado de los pedidos" valor={l.ingreso_estimado} fuerte />
            {l.estado !== "estimado" && (
              <>
                <Linea texto="Publicidad dentro de la aplicación" valor={l.publicidad} />
                <Linea texto="IVA de la publicidad" valor={ivaPublicidad} nota="Sale del «Impuesto en comisiones - IVA» del estado de cuenta menos el IVA de los pedidos" />
                <Linea texto="Retenciones fiscales (SIRTAC)" valor={l.retenciones_sirtac} />
                {(l.reintegros ?? 0) !== 0 && <Linea texto="Reintegros" valor={l.reintegros} />}
                {(l.ajustes ?? 0) !== 0 && <Linea texto="Ajustes de liquidación" valor={l.ajustes} nota={l.ajustes_nota ?? undefined} />}
                {(l.saldo_anterior ?? 0) !== 0 && <Linea texto="Saldo pendiente de la liquidación anterior" valor={l.saldo_anterior} />}
                <Linea texto="= Total liquidado (a la billetera)" valor={l.total_liquidado} fuerte />
              </>
            )}
          </ul>
          {l.estado === "estimado" && <p className="text-xs text-amber-800 mt-2">Estimado: faltan la publicidad y las retenciones. Cuando tengas el estado de cuenta, importá de nuevo esta semana para confirmarla.</p>}
        </div>

        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Cuándo se cobra</h3>
          <ul className="space-y-1 text-sm text-neutral-700">
            <li>Fecha de pago: <b>{dma(l.fecha_pago_procesado ?? l.fecha_pago_estimada)}</b> {l.fecha_pago_procesado ? <span className="text-xs text-selva-700">confirmada por PedidosYa</span> : l.fecha_pago_estimada ? <span className="text-xs text-amber-800">estimada</span> : <span className="text-xs text-neutral-400">sin dato</span>}</li>
            <li>La acreditación puede demorar hasta: <b>{dma(l.fecha_acreditacion_hasta)}</b> <span className="text-xs text-neutral-400">(72 hs hábiles, sin contar feriados)</span></li>
            {l.cuenta_destino && <li>Cuenta destino: {l.cuenta_destino}</li>}
            {l.fecha_acreditacion_real && (
              <li>
                Llegó el <b>{dma(l.fecha_acreditacion_real)}</b>: {m(l.monto_acreditado)}
                {l.total_liquidado !== null && l.monto_acreditado !== null && Math.round((l.monto_acreditado - l.total_liquidado) * 100) !== 0 &&
                  <span className="text-danger font-medium"> — diferencia con lo esperado: {m(Math.round((l.monto_acreditado - l.total_liquidado) * 100) / 100)}</span>}
              </li>
            )}
          </ul>
          {l.alerta_plazo && <p className="text-sm text-amber-800 font-medium">{l.alerta_plazo}</p>}
          {puedeAcreditar && <RegistrarCobro liq={l} />}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Pedidos</h3>
        <div className="rounded-lg border border-neutral-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
              <th className="px-3 py-2 font-semibold">Pedido</th><th className="px-3 py-2 font-semibold">Fecha</th><th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 font-semibold text-right">Venta</th><th className="px-3 py-2 font-semibold text-right">Ingreso estimado</th><th className="px-3 py-2 font-semibold">Contra las ventas del kiosco</th>
            </tr></thead>
            <tbody>{pedidos.map((p) => <PedidoFila key={p.id} p={p} ventas={ventasSinPeya} puedeCargar={puedeCargar} />)}</tbody>
          </table>
        </div>
        {pedidos.some((p) => p.conciliacion === "efectivo_pendiente") && (
          <p className="text-xs text-amber-800 mt-2">Los pedidos en efectivo quedan «pendiente de validar»: todavía no hay una regla contable confirmada para lo que PedidosYa descuenta de otros pagos.</p>
        )}
      </div>

      {ventasSinPeya.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Ventas del kiosco sin pedido en PedidosYa</h3>
          <ul className="rounded-lg border border-neutral-200 divide-y divide-neutral-100 text-sm">
            {ventasSinPeya.map((v) => <li key={v.id} className="px-3 py-2 flex justify-between gap-3"><span>{hora(v.creado_en)} · {v.canal.replace(/_/g, " ")}</span><span className="tabular-nums">{m(v.total)}</span></li>)}
          </ul>
        </div>
      )}

      {archivos.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">Archivos originales</h3>
          <ul className="text-sm space-y-1">
            {archivos.map((a) => (
              <li key={a.id} className="flex gap-3 flex-wrap">
                <button type="button" onClick={() => abrir(a.id)} className="text-tierra-700 underline">{a.nombre}</button>
                <span className="text-xs text-neutral-400">{a.tipo} · subido {hora(a.subido_en)}</span>
              </li>
            ))}
          </ul>
          {errorArchivo && <p role="alert" className="text-xs text-danger mt-1">{errorArchivo}</p>}
        </div>
      )}
    </section>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────
export function PeyaView({ data, puedeCargar }: { data: PeyaData; puedeCargar: boolean }) {
  const { liquidaciones, nombreLocal, aCobrar, detalle } = data;
  const hoy = fechaHoyAR();
  const pendientes = liquidaciones.filter((l) => l.estado === "estimado" || l.estado === "confirmado");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tarjeta titulo="A cobrar, confirmado" valor={m(aCobrar.confirmado)} pie="Total liquidado por PedidosYa, todavía sin acreditar" />
        <Tarjeta titulo="A cobrar, estimado" valor={m(aCobrar.estimado)} pie="Semanas sin estado de cuenta (faltan publicidad y retenciones)" />
        <Tarjeta titulo="Próximo cobro" valor={aCobrar.proxima ? dma(aCobrar.proxima.fecha) : "—"}
          pie={aCobrar.proxima ? (aCobrar.proxima.confirmada ? "Fecha confirmada por PedidosYa" : "Fecha estimada") + (aCobrar.proxima.fecha < hoy ? " · ya pasó" : "") : "Sin liquidaciones pendientes"} />
        <Tarjeta titulo="Liquidaciones pendientes" valor={String(aCobrar.cantidad)} pie="Se cobran en la billetera de PedidosYa y pasan a Mercado Pago" />
      </div>
      <p className="text-xs text-neutral-500 -mt-3">El «a cobrar» de PedidosYa es informativo: no suma a «Tengo menos debo» hasta que la plata llega a Mercado Pago.</p>

      {detalle ? (
        <Detalle d={detalle} nombreLocal={nombreLocal} puedeCargar={puedeCargar} />
      ) : (
        <>
          <ImportarPeya puedeCargar={puedeCargar} />

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold text-neutral-900">Liquidaciones y calendario de cobros</h2>
              {liquidaciones.length > 0 && <button type="button" onClick={() => exportarCsv(liquidaciones, nombreLocal)} className="text-xs font-semibold text-tierra-700 hover:underline">Exportar a CSV</button>}
            </div>
            {liquidaciones.length === 0 ? (
              <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">Todavía no se importó ninguna liquidación de PedidosYa.</p>
            ) : (
              <div className="rounded-xl border border-neutral-200 bg-white overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                    <th className="px-3 py-2 font-semibold">Período</th><th className="px-3 py-2 font-semibold">Local</th><th className="px-3 py-2 font-semibold">Estado</th>
                    <th className="px-3 py-2 font-semibold text-right">Pedidos</th><th className="px-3 py-2 font-semibold text-right">A la billetera</th>
                    <th className="px-3 py-2 font-semibold">Cobro</th><th className="px-3 py-2" />
                  </tr></thead>
                  <tbody>
                    {liquidaciones.map((l) => {
                      const fecha = l.fecha_acreditacion_real ?? l.fecha_pago_procesado ?? l.fecha_pago_estimada;
                      return (
                        <tr key={l.id} className="border-b border-neutral-50 last:border-0">
                          <td className="px-3 py-2 whitespace-nowrap">{dma(l.periodo_desde)} al {dma(l.periodo_hasta)}</td>
                          <td className="px-3 py-2">{nombreLocal[l.sucursal_id ?? ""] ?? l.tienda_id}</td>
                          <td className="px-3 py-2"><Etiqueta estado={l.estado} /></td>
                          <td className="px-3 py-2 text-right tabular-nums">{l.pedidos_entregados}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{l.total_liquidado !== null ? m(l.total_liquidado) : <span className="text-amber-800">~{m(l.ingreso_estimado)}</span>}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">
                            {dma(fecha)}{" "}
                            <span className="text-neutral-400">{l.fecha_acreditacion_real ? "llegó" : l.fecha_pago_procesado ? "confirmada" : l.fecha_pago_estimada ? "estimada" : ""}</span>
                            {l.alerta_plazo && <span className="block text-amber-800">cambió el plazo</span>}
                          </td>
                          <td className="px-3 py-2 text-right"><Link href={`/admin/tesoreria?vista=pedidosya&liq=${l.id}`} className="text-xs font-semibold text-tierra-700 hover:underline">Ver</Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pendientes.length > 0 && <p className="text-xs text-neutral-400">El cobro lo informa PedidosYa en el estado de cuenta; hasta entonces se estima con el plazo de la última liquidación.</p>}
          </section>
        </>
      )}
    </div>
  );
}
