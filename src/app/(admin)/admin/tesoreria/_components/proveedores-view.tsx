"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fechaHoyAR } from "@/lib/fecha";
import { ORIGENES_PAGO, type CuentaProveedor, type Imputacion, type MovimientoProveedor } from "@/lib/tesoreria/proveedores-cuenta";
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
  imputaciones:  Imputacion[];                  // a qué remito o factura se imputó cada pago (migración 112)
}

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";

type Borrador = { tipo: "pago" | "saldo_inicial"; proveedor_id: string; sucursal_id: string; egreso_id?: string };

function Formulario({ borrador, proveedores, sucursales, cuentas, onClose }: {
  borrador: Borrador; proveedores: Opcion[]; sucursales: Opcion[]; cuentas: CuentaProveedor[]; onClose: () => void;
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState("");
  const [exceso, setExceso] = useState(false);   // el pago supera el saldo: se pide confirmación antes de registrarlo
  // «Pagar este» llega con un remito o factura elegido: se imputa por lo que le falta y el monto del pago acompaña.
  const preseleccion = borrador.egreso_id ? cuentas.flatMap((c) => c.detalleCompras).find((x) => x.compra.id === borrador.egreso_id) : undefined;
  const [f, setF] = useState({
    proveedor_id: borrador.proveedor_id, sucursal_id: borrador.sucursal_id, fecha: fechaHoyAR(), monto: preseleccion ? String(preseleccion.resta) : "",
    origen: "efectivo_tesoreria", nota: "",
  });
  const esPago = borrador.tipo === "pago";
  // Remitos y facturas de la cuenta elegida que todavía no están cubiertos: el pago se puede imputar a uno o varios (migración 112).
  const abiertas = esPago
    ? (cuentas.find((c) => c.proveedor_id === f.proveedor_id && c.sucursal_id === f.sucursal_id)?.detalleCompras ?? []).filter((d) => d.resta > 0)
    : [];
  const [imp, setImp] = useState<Record<string, string>>(() => (preseleccion ? { [preseleccion.compra.id]: String(preseleccion.resta) } : {}));
  const numero = (t: string) => Number(t.replace(",", "."));
  const imputado = abiertas.reduce((t, d) => t + (d.compra.id in imp ? (numero(imp[d.compra.id]) || 0) : 0), 0);
  const cambiarCuenta = (k: "proveedor_id" | "sucursal_id") => (e: React.ChangeEvent<HTMLSelectElement>) => { setImp({}); setF({ ...f, [k]: e.target.value }); };
  // El monto acompaña a lo imputado mientras no se haya escrito a mano otra cosa.
  function imputar(nuevo: Record<string, string>) {
    const suma = (r: Record<string, string>) => abiertas.reduce((t, d) => t + (d.compra.id in r ? (numero(r[d.compra.id]) || 0) : 0), 0);
    const montoActual = numero(f.monto) || 0;
    setImp(nuevo);
    if (montoActual === 0 || montoActual === suma(imp)) setF({ ...f, monto: suma(nuevo) > 0 ? String(suma(nuevo)) : "" });
  }
  // Pago parcial: con un solo remito marcado, lo imputado acompaña al monto que se escribe (sin pasarse de lo que le falta).
  function cambiarMonto(e: React.ChangeEvent<HTMLInputElement>) {
    const texto = e.target.value;
    const marcados = abiertas.filter((d) => d.compra.id in imp);
    const nuevo = numero(texto);
    if (marcados.length === 1 && nuevo > 0) setImp({ [marcados[0].compra.id]: String(Math.min(nuevo, marcados[0].resta)) });
    setF({ ...f, monto: texto });
  }
  function marcar(d: (typeof abiertas)[number]) {
    const n = { ...imp };
    if (d.compra.id in n) delete n[d.compra.id]; else n[d.compra.id] = String(d.resta);
    imputar(n);
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  function guardar(confirmarExceso = false) {
    setError("");
    setExceso(false);
    const monto = Number(f.monto.replace(",", "."));
    empezar(async () => {
      const r = await registrarMovimientoProveedor({
        tipo: borrador.tipo, proveedor_id: f.proveedor_id, sucursal_id: f.sucursal_id, fecha: f.fecha,
        monto, origen: esPago ? f.origen : null, nota: f.nota || null,
      }, confirmarExceso, abiertas.filter((d) => d.compra.id in imp).map((d) => ({ egreso_id: d.compra.id, monto: numero(imp[d.compra.id]) })));
      if (r.error) { setError(r.error); setExceso(!!r.confirmar); return; }
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
            ? "El pago baja lo que se le debe a ese proveedor en ese local. Podés imputarlo a los remitos o facturas que paga; lo que no imputes queda a cuenta y cubre lo más viejo. No es un gasto nuevo."
            : "Lo que ya se le debía a ese proveedor antes de empezar a usar Tesorería. Se carga una sola vez por proveedor y local."}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={etiqueta}>Proveedor</label>
          <select value={f.proveedor_id} onChange={cambiarCuenta("proveedor_id")} className={campo}>
            <option value="">Elegí…</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className={etiqueta}>Local</label>
          <select value={f.sucursal_id} onChange={cambiarCuenta("sucursal_id")} className={campo}>
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
          <input inputMode="decimal" value={f.monto} onChange={esPago ? cambiarMonto : set("monto")} placeholder="0" className={campo} />
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
      {esPago && f.proveedor_id && f.sucursal_id && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">¿Qué remitos o facturas paga? (opcional)</p>
          {abiertas.length === 0 ? (
            <p className="text-xs text-neutral-500">Esta cuenta no tiene remitos ni facturas sin cubrir: el pago queda a cuenta.</p>
          ) : (
            <ul className="space-y-1.5">
              {abiertas.map((d) => {
                const marcado = d.compra.id in imp;
                return (
                  <li key={d.compra.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={marcado} onChange={() => marcar(d)} id={`imp-${d.compra.id}`} className="h-4 w-4 shrink-0" />
                    <label htmlFor={`imp-${d.compra.id}`} className="flex-1 min-w-0">
                      <span className="text-neutral-900">{d.compra.comprobante_numero ? `N° ${d.compra.comprobante_numero} · ` : ""}{d.compra.descripcion}</span>
                      <span className="block text-xs text-neutral-500">{dma(d.compra.fecha)} · falta {AR.format(d.resta)}{d.resta < d.compra.monto ? ` de ${AR.format(d.compra.monto)}` : ""}</span>
                    </label>
                    {marcado && (
                      <input inputMode="decimal" aria-label="Monto imputado" value={imp[d.compra.id]} onChange={(e) => imputar({ ...imp, [d.compra.id]: e.target.value })}
                        className="h-9 w-28 rounded-lg border border-neutral-300 bg-white px-2 text-sm text-right" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {imputado > 0 && (
            <p className="text-xs text-neutral-600">
              Imputado a remitos y facturas: <b>{AR.format(imputado)}</b>
              {numero(f.monto) > imputado ? <> · el resto (<b>{AR.format(numero(f.monto) - imputado)}</b>) queda a cuenta</> : null}
              {numero(f.monto) > 0 && numero(f.monto) < imputado ? <span className="text-danger"> · supera el monto del pago: bajá lo imputado a algún remito o subí el monto</span> : null}
            </p>
          )}
        </div>
      )}
      {error && !exceso && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {error && exceso && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 space-y-2">
          <p>{error}</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => guardar(true)} disabled={pendiente}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              {pendiente ? "Guardando…" : "Sí, registrar igual"}
            </button>
            <button type="button" onClick={() => { setError(""); setExceso(false); }} disabled={pendiente}
              className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100">Corregir el monto</button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => guardar()} disabled={pendiente || !f.proveedor_id || !f.sucursal_id || !f.monto}
          className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
          {pendiente ? "Guardando…" : esPago ? "Registrar pago" : "Cargar saldo inicial"}
        </button>
        <button type="button" onClick={onClose} disabled={pendiente}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Cancelar</button>
      </div>
    </div>
  );
}

function MovimientoFila({ m, puedeCargar, imputadoA }: { m: MovimientoProveedor; puedeCargar: boolean; imputadoA: string[] }) {
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
          {imputadoA.length > 0 && <span className="block text-xs text-neutral-500">Imputado a: {imputadoA.join(" · ")}</span>}
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
  const { cuentas, totales, sinProveedor, nombreProveedor, nombreLocal, imputaciones } = data;
  const [form, setForm] = useState<Borrador | null>(null);
  // Remito o factura de un proveedor: es una compra (el mismo formulario de egresos) que se carga «todavía se debe» y suma a su cuenta.
  const [compra, setCompra] = useState<BorradorEgreso | null>(null);
  const cargarCompra = (proveedor_id = "", sucursal_id = "") =>
    setCompra({ categoria: "mercaderia", pagado: false, proveedor_id: proveedor_id || null, sucursal_id: sucursal_id || null });
  const [abierta, setAbierta] = useState<string | null>(null);
  // Los remitos ya cubiertos por pagos se esconden para que la lista muestre lo que falta pagar; se pueden ver cuenta por cuenta.
  const [conCubiertas, setConCubiertas] = useState<string | null>(null);
  const local = (id: string | null) => (id ? nombreLocal[id] ?? "—" : "Sin local");
  // Un proveedor dado de baja con deuda pendiente tiene que poder cobrarse/pagarse: se suma a los selects, marcado.
  const opcionesProveedor: Opcion[] = [
    ...proveedores,
    ...[...new Set(cuentas.map((c) => c.proveedor_id))]
      .filter((id) => !proveedores.some((p) => p.id === id))
      .map((id) => ({ id, nombre: `${nombreProveedor[id] ?? "Proveedor"} (desactivado)` })),
  ];

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
        2) <b>registrá los pagos</b> a medida que se hacen y, si querés, <b>imputalos a los remitos o facturas que pagan</b> (un pago puede repartirse entre varios). Lo que no imputes queda a cuenta y cubre lo más viejo.
      </p>

      {form && (
        <Formulario key={`${form.tipo}|${form.proveedor_id}|${form.sucursal_id}|${form.egreso_id ?? ""}`} borrador={form} proveedores={opcionesProveedor} sucursales={sucursales} cuentas={cuentas} onClose={() => setForm(null)} />
      )}

      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Cuenta por proveedor y local</h2>
          <p className="text-xs text-neutral-500">
            Saldo = saldo inicial + compras que todavía se deben − pagos. Cada pago cubre los remitos o facturas a los que se imputó; lo que no se imputó cubre primero el saldo inicial y después lo más viejo.
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
                      {c.detalleCompras.length > 0 && (() => {
                        const cubiertas = c.detalleCompras.filter((d) => d.estado === "cubierta").length;
                        const verTodas = conCubiertas === c.clave;
                        const lista = verTodas ? c.detalleCompras : c.detalleCompras.filter((d) => d.estado !== "cubierta");
                        return (
                        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 border-b border-neutral-100">Remitos y facturas que se deben</p>
                          {lista.length === 0 && <p className="px-4 py-3 text-sm text-neutral-500">Todos los remitos y facturas están cubiertos por pagos.</p>}
                          <ul className="divide-y divide-neutral-100">
                            {lista.map((d) => (
                              <li key={d.compra.id} className="px-4 py-2 text-sm flex justify-between gap-3 flex-wrap">
                                <span>
                                  {AR.format(d.compra.monto)} · {d.compra.descripcion}
                                  {d.compra.comprobante_numero && <span className="text-neutral-500"> · N° {d.compra.comprobante_numero}</span>}
                                </span>
                                <span className="text-xs text-neutral-400">
                                  {puedeCargar && c.sucursal_id && d.resta > 0 && (
                                    <button type="button" onClick={() => setForm({ tipo: "pago", proveedor_id: c.proveedor_id, sucursal_id: c.sucursal_id as string, egreso_id: d.compra.id })}
                                      className="mr-3 underline text-tierra-700 hover:text-tierra-800">Pagar este</button>
                                  )}
                                  {dma(d.compra.fecha)}{" "}
                                  <span className={`ml-2 rounded-full border px-2 py-0.5 ${ESTADO[d.estado].clase}`}>
                                    {ESTADO[d.estado].texto}{d.estado === "parcial" ? ` (resta ${AR.format(d.resta)})` : ""}
                                  </span>
                                </span>
                              </li>
                            ))}
                          </ul>
                          {cubiertas > 0 && (
                            <button type="button" onClick={() => setConCubiertas(verTodas ? null : c.clave)}
                              className="w-full border-t border-neutral-100 px-4 py-2 text-left text-xs text-neutral-500 underline hover:text-neutral-800">
                              {verTodas ? "Esconder los cubiertos por pagos" : `Ver ${cubiertas} ${cubiertas === 1 ? "cubierto" : "cubiertos"} por pagos`}
                            </button>
                          )}
                        </div>
                        );
                      })()}
                      {c.movimientos.length > 0 && (
                        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                          <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 border-b border-neutral-100">Pagos y saldo inicial</p>
                          <ul className="divide-y divide-neutral-100">
                            {c.movimientos.map((m) => (
                              <MovimientoFila key={m.id} m={m} puedeCargar={puedeCargar}
                                imputadoA={imputaciones.filter((i) => i.pago_id === m.id).map((i) => {
                                  const compra = c.detalleCompras.find((d) => d.compra.id === i.egreso_id)?.compra;
                                  return `${compra?.comprobante_numero ? `N° ${compra.comprobante_numero}` : compra?.descripcion ?? "una compra"} (${AR.format(i.monto)})`;
                                })} />
                            ))}
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
