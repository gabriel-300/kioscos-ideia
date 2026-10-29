"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import {
  ETIQUETA_ORIGEN_PERSONA, ETIQUETA_TIPO_PERSONA, ORIGENES_PERSONA,
  type MovimientoPersona, type OrigenPersona, type TipoMovimientoPersona,
} from "@/lib/tesoreria/persona-cuenta";
import type { PersonaConCuenta } from "@/lib/tesoreria/persona-cuenta-consultas";
import { registrarMovimientoPersona, anularMovimientoPersona } from "../persona-actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const dma = (f: string) => f.split("-").reverse().join("/");

export interface PersonasData { personas: PersonaConCuenta[] }

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";

function Linea({ texto, valor, fuerte = false }: { texto: string; valor: number; fuerte?: boolean }) {
  return (
    <li className={`flex justify-between gap-3 text-sm ${fuerte ? "pt-1.5 border-t border-neutral-100 font-semibold" : ""}`}>
      <span className={fuerte ? "" : "text-neutral-600"}>{texto}</span>
      <span className="tabular-nums">{AR.format(valor)}</span>
    </li>
  );
}

const AYUDA: Record<TipoMovimientoPersona, string> = {
  saldo_inicial:    "Lo que ya debía reponer al comenzar ese día. Se carga una sola vez y no mueve ninguna cuenta.",
  adelanto:         "Plata que se llevó. Si sale del efectivo de Tesorería o de Mercado Pago, baja ese saldo; por transferencia no toca ninguna cuenta.",
  reposicion:       "Plata que devolvió. Si entra al efectivo de Tesorería o a Mercado Pago, sube ese saldo; por transferencia no toca ninguna cuenta.",
  descuento_sueldo: "Lo que se le descontó del sueldo (el sueldo se carga por el monto final que se pagó). Baja lo que debe y no mueve ninguna cuenta.",
};

function Formulario({ persona, tipo, onClose }: { persona: PersonaConCuenta; tipo: TipoMovimientoPersona; onClose: () => void }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState("");
  const [f, setF] = useState({ fecha: fechaHoyAR(), monto: "", origen: "efectivo_tesoreria" as OrigenPersona, nota: "" });
  const conOrigen = tipo === "adelanto" || tipo === "reposicion";
  const esSaldo = tipo === "saldo_inicial";

  function guardar() {
    setError("");
    empezar(async () => {
      const r = await registrarMovimientoPersona({
        persona_id: persona.id, tipo, fecha: f.fecha, monto: Number(f.monto.replace(",", ".")), origen: conOrigen ? f.origen : null, nota: f.nota || null,
      });
      if (r.error) { setError(r.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <div className="rounded-xl border border-tierra-700/30 bg-neutral-50 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{ETIQUETA_TIPO_PERSONA[tipo]} · {persona.nombre}</h3>
        <p className="text-xs text-neutral-500 mt-0.5">{AYUDA[tipo]}</p>
      </div>
      <div className="grid sm:grid-cols-4 gap-3">
        <div>
          <label className={etiqueta}>{esSaldo ? "Saldo al comenzar el día" : "Fecha"}</label>
          <input type="date" value={f.fecha} max={fechaHoyAR()} onChange={(e) => setF({ ...f, fecha: e.target.value })} className={campo} />
        </div>
        <div>
          <label className={etiqueta}>Monto</label>
          <input inputMode="decimal" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0" className={campo} />
        </div>
        {conOrigen && (
          <div>
            <label className={etiqueta}>{tipo === "adelanto" ? "De dónde salió" : "Adónde entró"}</label>
            <select value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value as OrigenPersona })} className={campo}>
              {ORIGENES_PERSONA.map((o) => <option key={o} value={o}>{ETIQUETA_ORIGEN_PERSONA[o]}</option>)}
            </select>
          </div>
        )}
        <div className={conOrigen ? "" : "sm:col-span-2"}>
          <label className={etiqueta}>Nota (opcional)</label>
          <input value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} maxLength={200} className={campo} />
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

function FilaMovimiento({ m, puedeCargar }: { m: MovimientoPersona; puedeCargar: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();

  function anular() {
    setError("");
    empezar(async () => {
      const r = await anularMovimientoPersona(m.id, motivo);
      if (r.error) { setError(r.error); return; }
      router.refresh();
    });
  }

  const suma = m.tipo === "adelanto";
  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex justify-between gap-3 flex-wrap">
        <span>
          <b>{ETIQUETA_TIPO_PERSONA[m.tipo]}</b> ·{" "}
          <span className={m.tipo === "saldo_inicial" ? "" : suma ? "text-danger" : "text-selva-700"}>{m.tipo === "saldo_inicial" ? "" : suma ? "+ " : "− "}{AR.format(m.monto)}</span>
          {m.origen && <span className="text-neutral-500"> · {ETIQUETA_ORIGEN_PERSONA[m.origen]}</span>}
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

// `conFicha`: muestra el enlace a la ficha (en la propia ficha se oculta).
export function TarjetaPersona({ persona, puedeCargar, conFicha = true }: { persona: PersonaConCuenta; puedeCargar: boolean; conFicha?: boolean }) {
  const [form, setForm] = useState<TipoMovimientoPersona | null>(null);
  const { cuenta } = persona;
  const sinSaldoInicial = cuenta.desde === null;
  const botones: TipoMovimientoPersona[] = [...(sinSaldoInicial ? ["saldo_inicial" as const] : []), "adelanto", "reposicion", "descuento_sueldo"];

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 space-y-4">
      <div className="flex justify-between gap-3 flex-wrap items-start">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">{persona.nombre}</h2>
          <p className="text-xs text-neutral-400">{persona.esSocio ? "Socio" : "Personal"}{cuenta.desde ? ` · cuenta desde el ${dma(cuenta.desde)}` : " · todavía sin saldo inicial"}{conFicha && <> · <Link href={`/admin/staff/${persona.id}`} className="font-semibold text-tierra-700 hover:underline">Ver ficha</Link></>}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{cuenta.debe < 0 ? "A favor" : "Debe reponer"}</p>
          <p className={`text-2xl font-bold font-display tabular-nums ${cuenta.debe > 0 ? "text-red-700" : cuenta.debe < 0 ? "text-selva-700" : "text-neutral-700"}`}>{AR.format(Math.abs(cuenta.debe))}</p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {!sinSaldoInicial && <Linea texto={`Saldo inicial (al comenzar el ${dma(cuenta.desde as string)})`} valor={cuenta.saldoInicial} />}
        <Linea texto="+ Adelantos" valor={cuenta.adelantos} />
        <Linea texto="− Reposiciones" valor={cuenta.reposiciones} />
        <Linea texto="− Descuentos de sueldo" valor={cuenta.descuentos} />
        <Linea texto={cuenta.debe < 0 ? "= A favor de la persona" : "= Debe reponer"} valor={Math.abs(cuenta.debe)} fuerte />
      </ul>

      {puedeCargar && !form && (
        <div className="flex gap-2 flex-wrap">
          {botones.map((t) => (
            <button key={t} type="button" onClick={() => setForm(t)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:border-tierra-700 hover:text-tierra-700">
              {t === "saldo_inicial" ? "Cargar saldo inicial" : `Registrar ${ETIQUETA_TIPO_PERSONA[t].toLowerCase()}`}
            </button>
          ))}
        </div>
      )}
      {form && <Formulario key={form} persona={persona} tipo={form} onClose={() => setForm(null)} />}

      {persona.movimientos.length > 0 && (
        <ul className="rounded-xl border border-neutral-200 divide-y divide-neutral-100">
          {persona.movimientos.map((m) => <FilaMovimiento key={m.id} m={m} puedeCargar={puedeCargar} />)}
        </ul>
      )}
    </section>
  );
}

export function PersonasView({ data, puedeCargar }: { data: PersonasData; puedeCargar: boolean }) {
  const { personas } = data;
  const deben = personas.reduce((s, p) => s + Math.max(0, p.cuenta.debe), 0);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Falta reponer</p>
        <p className="text-2xl font-bold font-display tabular-nums text-neutral-900">{AR.format(deben)}</p>
        <p className="text-xs text-neutral-500 mt-0.5">
          Lo que los socios se adelantaron y todavía no repusieron (devolviendo la plata o con un descuento de sueldo). Es informativo: no entra en «Tengo menos debo».
        </p>
      </div>
      {personas.length === 0 ? (
        <p className="text-sm text-neutral-500">No hay socios marcados. Se marcan en Staff.</p>
      ) : (
        personas.map((p) => <TarjetaPersona key={p.id} persona={p} puedeCargar={puedeCargar} />)
      )}
    </div>
  );
}
