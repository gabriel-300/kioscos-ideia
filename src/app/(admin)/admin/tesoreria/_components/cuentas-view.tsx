"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import type { MovimientoMp, SaldoMp } from "@/lib/tesoreria/cuenta-mp";
import { registrarMovimientoMp, anularMovimientoMp } from "../cuentas-actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const dma = (f: string) => f.split("-").reverse().join("/");

export interface CuentasData {
  efectivo:    { efectivo: number; sobres: number; salidas: number; inicial: number };
  mp:          SaldoMp;
  movimientos: MovimientoMp[];
}

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";

function Linea({ texto, valor, fuerte = false, menos = false }: { texto: string; valor: number; fuerte?: boolean; menos?: boolean }) {
  return (
    <li className={`flex justify-between gap-3 text-sm ${fuerte ? "pt-1.5 border-t border-neutral-100 font-semibold" : ""}`}>
      <span className={fuerte ? "" : "text-neutral-600"}>{texto}</span>
      <span className="tabular-nums">{menos && valor > 0 ? "− " : ""}{AR.format(valor)}</span>
    </li>
  );
}

function FormularioMp({ tipo, onClose }: { tipo: "saldo_inicial" | "retiro"; onClose: () => void }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState("");
  const [f, setF] = useState({ fecha: fechaHoyAR(), monto: "", nota: "" });
  const esSaldo = tipo === "saldo_inicial";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function guardar() {
    setError("");
    empezar(async () => {
      const r = await registrarMovimientoMp({ tipo, fecha: f.fecha, monto: Number(f.monto.replace(",", ".")), nota: f.nota || null });
      if (r.error) { setError(r.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="rounded-xl border border-tierra-700/30 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{esSaldo ? "Cargar el saldo inicial de Mercado Pago" : "Registrar un retiro de Mercado Pago"}</h3>
        <p className="text-xs text-neutral-500 mt-0.5">
          {esSaldo
            ? "El saldo que tenía la cuenta al comenzar ese día (lo ves en la app de Mercado Pago). Desde ahí se suman los cobros y se restan los pagos."
            : "Plata que sacaste de la cuenta (por ejemplo, la pasaste a un banco). No es un gasto: solo baja el saldo."}
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className={etiqueta}>{esSaldo ? "Saldo al comenzar el día" : "Fecha"}</label>
          <input type="date" value={f.fecha} max={fechaHoyAR()} onChange={set("fecha")} className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Monto</label>
          <input inputMode="decimal" value={f.monto} onChange={set("monto")} placeholder="0" className={campo} />
        </div>
        <div>
          <label className={etiqueta}>{esSaldo ? "Nota (opcional)" : "A dónde fue"}</label>
          <input value={f.nota} onChange={set("nota")} maxLength={200} placeholder={esSaldo ? "" : "Ej.: pasé a Brubank"} className={campo} />
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={guardar} disabled={pendiente || f.monto === ""}
          className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onClose} disabled={pendiente}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Cancelar</button>
      </div>
    </div>
  );
}

function FilaMovimiento({ m, puedeCargar }: { m: MovimientoMp; puedeCargar: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();

  function anular() {
    setError("");
    empezar(async () => {
      const r = await anularMovimientoMp(m.id, motivo);
      if (r.error) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex justify-between gap-3 flex-wrap">
        <span>
          <b>{m.tipo === "saldo_inicial" ? "Saldo inicial" : "Retiro"}</b> · {AR.format(m.monto)}
          {m.nota && <span className="text-neutral-500"> — {m.nota}</span>}
        </span>
        <span className="text-xs text-neutral-400">
          {m.tipo === "saldo_inicial" ? "al comenzar el " : ""}{dma(m.fecha)}
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

export function CuentasView({ data, puedeCargar }: { data: CuentasData; puedeCargar: boolean }) {
  const { efectivo, mp, movimientos } = data;
  const [form, setForm] = useState<"saldo_inicial" | "retiro" | null>(null);
  const total = efectivo.efectivo + (mp.configurada ? mp.disponible : 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-selva-200 bg-selva-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Tengo disponible</p>
        <p className="text-2xl font-bold font-display tabular-nums text-selva-700">{AR.format(total)}</p>
        <p className="text-xs text-neutral-500 mt-0.5">
          Efectivo de Tesorería{mp.configurada ? " + lo disponible en Mercado Pago" : ""}.
          {!mp.configurada && " Falta cargar el saldo inicial de Mercado Pago para sumarlo."}
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Efectivo de Tesorería</h2>
          <ul className="space-y-1.5">
            <Linea texto="Efectivo con el que arrancó" valor={efectivo.inicial} />
            <Linea texto="+ Sobres retirados de los kioscos" valor={efectivo.sobres} />
            <Linea texto="− Pagado en efectivo de Tesorería" valor={efectivo.salidas} />
            <Linea texto="= Efectivo en mano" valor={efectivo.efectivo} fuerte />
          </ul>
          <p className="text-xs text-neutral-400 mt-3">El efectivo inicial se corrige desde el Resumen.</p>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Mercado Pago</h2>
          {!mp.configurada ? (
            <div className="space-y-3">
              <p className="text-sm text-neutral-500">
                Todavía no se cargó el saldo inicial. Sin él no se puede saber cuánto hay en la cuenta: cargá el saldo que muestra la app de
                Mercado Pago al comenzar un día, y desde ahí el sistema suma los cobros que importes y resta lo que pagues desde esa cuenta.
              </p>
              {puedeCargar && (
                <button type="button" onClick={() => setForm("saldo_inicial")}
                  className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800">Cargar el saldo inicial</button>
              )}
            </div>
          ) : (
            <>
              <ul className="space-y-1.5">
                <Linea texto={`Saldo al comenzar el ${dma(mp.desde as string)}`} valor={mp.saldoInicial} />
                <Linea texto="+ Cobros importados (neto de comisión)" valor={mp.cobros} />
                {mp.ingresos > 0 && <Linea texto="+ Ingresos clasificados (traspasos, aportes)" valor={mp.ingresos} />}
                <Linea texto="− Pagos hechos desde Mercado Pago" valor={mp.pagos} menos />
                <Linea texto="− Retiros de la cuenta" valor={mp.retiros} menos />
                <Linea texto="= Saldo de la cuenta" valor={mp.total} fuerte />
                {mp.aLiberar > 0 && <Linea texto="De eso, todavía a liberar" valor={mp.aLiberar} />}
                <Linea texto="Disponible" valor={mp.disponible} fuerte />
              </ul>
              {mp.sinClasificar.cantidad > 0 && (
                <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Hay {mp.sinClasificar.cantidad} {mp.sinClasificar.cantidad === 1 ? "movimiento" : "movimientos"} de Mercado Pago por {AR.format(mp.sinClasificar.monto)} sin clasificar:
                  no suman al saldo hasta que digas qué son.{" "}
                  <Link href="/admin/tesoreria?vista=mercadopago" className="font-semibold underline">Clasificarlos</Link>
                </p>
              )}
              <p className="text-xs text-neutral-400 mt-3">
                El saldo es una estimación: lo que Mercado Pago no informa a este sistema (retiros, comisiones de otros servicios) solo entra si lo
                cargás. Contralo con la app de vez en cuando.
              </p>
              {puedeCargar && (
                <button type="button" onClick={() => setForm("retiro")} className="mt-3 text-xs font-semibold text-tierra-700 hover:underline">
                  Registrar un retiro de la cuenta
                </button>
              )}
            </>
          )}
        </section>
      </div>

      {form && <FormularioMp key={form} tipo={form} onClose={() => setForm(null)} />}

      {movimientos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-900">Saldo inicial y retiros de Mercado Pago</h2>
          <ul className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {[...movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha)).map((m) => <FilaMovimiento key={m.id} m={m} puedeCargar={puedeCargar} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
