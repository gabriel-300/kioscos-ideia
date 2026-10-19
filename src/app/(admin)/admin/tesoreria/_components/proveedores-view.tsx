"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fechaHoyAR } from "@/lib/fecha";
import { ORIGENES_PAGO, type CuentaProveedor, type MovimientoProveedor } from "@/lib/tesoreria/proveedores-cuenta";
import type { Deuda } from "@/lib/tesoreria/calculos";
import { etiquetaOrigen } from "@/lib/tesoreria/tipos";
import { registrarMovimientoProveedor, anularMovimientoProveedor } from "../proveedores-actions";
import { EgresoForm, type Borrador as BorradorEgreso } from "./egreso-form";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const dma = (f: string) => f.split("-").reverse().join("/");

type Opcion = { id: string; nombre: string };

export interface ProveedoresData {
  cuentas:       CuentaProveedor[];
  totales:       { debe: number; aFavor: number; neto: number };
  sinProveedor:  Deuda[];                       // compras que se deben sin proveedor de la lista (no tienen cuenta corriente)
  nombreProveedor: Record<string, string>;
  nombreLocal:   Record<string, string>;
}

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";

type Borrador = { tipo: "pago" | "saldo_inicial"; proveedor_id: string; sucursal_id: string };

function Formulario({ borrador, proveedores, sucursales, onClose }: {
  borrador: Borrador; proveedores: Opcion[]; sucursales: Opcion[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState("");
  const [f, setF] = useState({
    proveedor_id: borrador.proveedor_id, sucursal_id: borrador.sucursal_id, fecha: fechaHoyAR(), monto: "",
    origen: "efectivo_tesoreria", nota: "",
  });
  const esPago = borrador.tipo === "pago";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  function guardar() {
    setError("");
    const monto = Number(f.monto.replace(",", "."));
    empezar(async () => {
      const r = await registrarMovimientoProveedor({
        tipo: borrador.tipo, proveedor_id: f.proveedor_id, sucursal_id: f.sucursal_id, fecha: f.fecha,
        monto, origen: esPago ? f.origen : null, nota: f.nota || null,
      });
      if (r.error) { setError(r.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="rounded-xl border border-tierra-700/30 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{esPago ? "Registrar un pago a proveedor" : "Cargar el saldo inicial de un proveedor"}</h3>
        <p className="text-xs text-neutral-500 mt-0.5">
          {esPago
            ? "El pago baja lo que se le debe a ese proveedor en ese local. No hace falta decir a qué remito corresponde: se resta del saldo. No es un gasto nuevo."
            : "Lo que ya se le debía a ese proveedor antes de empezar a usar Tesorería. Se carga una sola vez por proveedor y local."}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={etiqueta}>Proveedor</label>
          <select value={f.proveedor_id} onChange={set("proveedor_id")} className={campo}>
            <option value="">Elegí…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Local</label>
          <select value={f.sucursal_id} onChange={set("sucursal_id")} className={campo}>
            <option value="">Elegí…</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={etiqueta}>{esPago ? "Fecha del pago" : "Fecha de corte"}</label>
          <input type="date" value={f.fecha} max={fechaHoyAR()} onChange={set("fecha")} className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Monto</label>
          <input inputMode="decimal" value={f.monto} onChange={set("monto")} placeholder="0" className={campo} />
        </div>
        {esPago && (
          <div>
            <label className={etiqueta}>De dónde salió la plata</label>
            <select value={f.origen} onChange={set("origen")} className={campo}>
              {ORIGENES_PAGO.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>
          </div>
        )}
        <div className={esPago ? "" : "sm:col-span-1"}>
          <label className={etiqueta}>Nota (opcional)</label>
          <input value={f.nota} onChange={set("nota")} maxLength={200} placeholder={esPago ? "Ej.: remitos 204 y 210" : "Ej.: saldo al 30/9"} className={campo} />
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={guardar} disabled={pendiente || !f.proveedor_id || !f.sucursal_id || !f.monto}
          className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
          {pendiente ? "Guardando…" : esPago ? "Registrar pago" : "Cargar saldo inicial"}
        </button>
        <button type="button" onClick={onClose} disabled={pendiente}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Cancelar</button>
      </div>
    </div>
  );
}

function MovimientoFila({ m, puedeCargar }: { m: MovimientoProveedor; puedeCargar: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();

  function anular() {
    setError("");
    empezar(async () => {
      const r = await anularMovimientoProveedor(m.id, motivo);
      if (r.error) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex justify-between gap-3 flex-wrap">
        <span>
          <b>{m.tipo === "pago" ? "Pago" : "Saldo inicial"}</b> · {AR.format(m.monto)}
          {m.origen && <span className="text-neutral-500"> · {etiquetaOrigen(m.origen)}</span>}
          {m.nota && <span className="text-neutral-500"> — {m.nota}</span>}
        </span>
        <span className="text-xs text-neutral-400">
          {dma(m.fecha)}
          {puedeCargar && !abierto && <button type="button" onClick={() => setAbierto(true)} className="ml-3 underline hover:text-danger">Anular</button>}
        </span>
      </div>
      {abierto && (
        <div className="mt-2 flex gap-2 flex-wrap items-center">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Motivo de la anulación"
            className="flex-1 min-w-48 h-9 rounded-lg border border-neutral-300 px-2 text-sm" />
          <button type="button" onClick={anular} disabled={pendiente || motivo.trim().length < 3}
            className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{pendiente ? "Anulando…" : "Anular"}</button>
          <button type="button" onClick={() => setAbierto(false)} className="text-sm text-neutral-500 underline">Cancelar</button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </li>
  );
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Sin cubrir", clase: "bg-amber-50 text-amber-800 border-amber-200" },
  parcial:   { texto: "Cubierta en parte", clase: "bg-blue-50 text-blue-700 border-blue-200" },
  cubierta:  { texto: "Cubierta por pagos", clase: "bg-selva-50 text-selva-700 border-selva-200" },
};

export function ProveedoresView({ data, proveedores, sucursales, puedeCargar }: {
  data: ProveedoresData; proveedores: Opcion[]; sucursales: Opcion[]; puedeCargar: boolean;
}) {
  const { cuentas, totales, sinProveedor, nombreProveedor, nombreLocal } = data;
  const [form, setForm] = useState<Borrador | null>(null);
  // Remito o factura de un proveedor: es una compra (el mismo formulario de egresos) que se carga «todavía se debe» y suma a su cuenta.
  const [compra, setCompra] = useState<BorradorEgreso | null>(null);
  const cargarCompra = (proveedor_id = "", sucursal_id = "") =>
    setCompra({ categoria: "mercaderia", pagado: false, proveedor_id: proveedor_id || null, sucursal_id: sucursal_id || null });
  const [abierta, setAbierta] = useState<string | null>(null);
  const local = (id: string | null) => (id ? nombreLocal[id] ?? "—" : "Sin local");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Se debe a proveedores</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{AR.format(totales.debe)}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{cuentas.filter((c) => c.saldo > 0).length} cuentas con saldo</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Saldo a favor</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">{AR.format(totales.aFavor)}</p>
          <p className="mt-0.5 text-xs text-neutral-500">pagado de más o por adelantado</p>
        </div>
        {puedeCargar && (
          <div className="col-span-2 lg:col-span-1 rounded-xl border border-neutral-200 bg-white p-4 flex flex-col gap-2 justify-center">
            <button type="button" onClick={() => cargarCompra()}
              className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800">Cargar un remito o factura</button>
            <button type="button" onClick={() => setForm({ tipo: "pago", proveedor_id: "", sucursal_id: "" })}
              className="rounded-lg border border-tierra-700 px-4 py-2 text-sm font-semibold text-tierra-700 hover:bg-tierra-50">Registrar un pago</button>
            <button type="button" onClick={() => setForm({ tipo: "saldo_inicial", proveedor_id: "", sucursal_id: "" })}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Cargar un saldo inicial</button>
          </div>
        )}
      </div>

      <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-600">
        <b>Cómo se lleva la cuenta de un proveedor:</b> 1) <b>cargá cada remito o factura</b> que llega (suma a lo que se le debe, con su número);
        2) <b>registrá los pagos</b> a medida que se hacen, aunque cubran varios remitos juntos (se restan del saldo).
      </p>

      {form && (
        <Formulario key={`${form.tipo}|${form.proveedor_id}|${form.sucursal_id}`} borrador={form} proveedores={proveedores} sucursales={sucursales} onClose={() => setForm(null)} />
      )}

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Cuenta por proveedor y local</h2>
          <p className="text-xs text-neutral-500">
            Saldo = saldo inicial + compras que todavía se deben − pagos. Los pagos cubren primero el saldo inicial y después las compras más viejas.
          </p>
        </div>
        {cuentas.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">
            Todavía no hay compras que se deban ni pagos cargados.
          </p>
        ) : (
          <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {cuentas.map((c) => {
              const nombre = nombreProveedor[c.proveedor_id] ?? "Proveedor";
              const esta = abierta === c.clave;
              return (
                <div key={c.clave}>
                  <button type="button" onClick={() => setAbierta(esta ? null : c.clave)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-neutral-50">
                    <span>
                      <span className="text-sm font-semibold text-neutral-900">{nombre}</span>
                      <span className="text-sm text-neutral-500"> · {local(c.sucursal_id)}</span>
                    </span>
                    <span className="text-right">
                      <span className={`text-sm font-semibold ${c.saldo > 0 ? "text-neutral-900" : c.saldo < 0 ? "text-selva-700" : "text-neutral-400"}`}>
                        {c.saldo < 0 ? `${AR.format(-c.saldo)} a favor` : AR.format(c.saldo)}
                      </span>
                    </span>
                  </button>
                  {esta && (
                    <div className="border-t border-neutral-100 bg-neutral-50/50 px-4 py-3 space-y-3">
                      <p className="text-xs text-neutral-500">
                        Saldo inicial {AR.format(c.saldoInicial)} + compras {AR.format(c.compras)} − pagos {AR.format(c.pagos)}
                      </p>
                      {puedeCargar && c.sucursal_id && (
                        <div className="flex gap-2 flex-wrap">
                          <button type="button" onClick={() => cargarCompra(c.proveedor_id, c.sucursal_id as string)}
                            className="rounded-lg bg-tierra-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-tierra-800">Cargar un remito o factura de {nombre}</button>
                          <button type="button" onClick={() => setForm({ tipo: "pago", proveedor_id: c.proveedor_id, sucursal_id: c.sucursal_id as string })}
                            className="rounded-lg border border-tierra-700 px-3 py-1.5 text-sm font-semibold text-tierra-700 hover:bg-tierra-50">Registrar un pago a {nombre}</button>
                        </div>
                      )}
                      {c.detalleCompras.length > 0 && (
                        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 border-b border-neutral-100">Compras que se deben</p>
                          <ul className="divide-y divide-neutral-100">
                            {c.detalleCompras.map((d) => (
                              <li key={d.compra.id} className="px-4 py-2 text-sm flex justify-between gap-3 flex-wrap">
                                <span>
                                  {AR.format(d.compra.monto)} · {d.compra.descripcion}
                                  {d.compra.comprobante_numero && <span className="text-neutral-500"> · N° {d.compra.comprobante_numero}</span>}
                                </span>
                                <span className="text-xs text-neutral-400">
                                  {dma(d.compra.fecha)}{" "}
                                  <span className={`ml-2 rounded-full border px-2 py-0.5 ${ESTADO[d.estado].clase}`}>
                                    {ESTADO[d.estado].texto}{d.estado === "parcial" ? ` (resta ${AR.format(d.resta)})` : ""}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {c.movimientos.length > 0 && (
                        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 border-b border-neutral-100">Pagos y saldo inicial</p>
                          <ul className="divide-y divide-neutral-100">
                            {c.movimientos.map((m) => <MovimientoFila key={m.id} m={m} puedeCargar={puedeCargar} />)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <EgresoForm open={!!compra} titulo="Remito o factura de proveedor" borrador={compra} sucursales={sucursales} proveedores={proveedores}
        onClose={() => setCompra(null)} />

      {sinProveedor.length > 0 && (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Compras que se deben sin proveedor de la lista</h2>
            <p className="text-xs text-neutral-500">
              No tienen cuenta corriente porque no se les asignó un proveedor. Para llevarles la cuenta, asignales uno al cargar la compra.
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {sinProveedor.map((d) => (
              <div key={d.clave} className="px-4 py-2 text-sm flex justify-between gap-3">
                <span>{d.nombre}</span>
                <span><b>{AR.format(d.monto)}</b> <span className="text-xs text-neutral-400">({d.cantidad})</span></span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
