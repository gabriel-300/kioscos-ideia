"use client";

import { useState } from "react";
import Link from "next/link";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type PosicionData = {
  posicionConsolidada:      number;
  efectivoTotal:            number;
  sobresTotal:              number;
  deudaProveedoresTotal:    number;
  deudaSociosTotal:         number;
  ctaCorrientePendienteTotal: number;
  efectivoPorSucursal:      { sucursalId: string; nombre: string; monto: number; estado: "abierta" | "cerrada" | "sin_datos" }[];
  sobresPorSucursal:        { sucursalId: string; nombre: string; monto: number }[];
  deudaProveedores:         { id: string; nombre: string; monto: number }[];
  deudaSocios:              { id: string; nombre: string; monto: number }[];
  ctaCorrientePendiente:    { id: string; nombre: string; monto: number }[];
  hayAlgunSocioCargado:     boolean;
};

const ESTADO_LABEL: Record<string, string> = { abierta: "Caja abierta", cerrada: "Caja cerrada", sin_datos: "Sin datos" };
const ESTADO_COLOR: Record<string, string> = {
  abierta:   "bg-selva-50 text-selva-700",
  cerrada:   "bg-neutral-100 text-neutral-500",
  sin_datos: "bg-amber-50 text-amber-700",
};

function Tarjeta({ label, monto, color, expandida, onToggle, children, subLabel }: {
  label: string; monto: number; color: "tierra" | "selva" | "danger"; expandida: boolean; onToggle: () => void;
  children: React.ReactNode; subLabel?: string;
}) {
  const colorClasses = {
    tierra: "border-tierra-200 bg-tierra-50 text-tierra-700",
    selva:  "border-selva-200 bg-selva-50 text-selva-700",
    danger: "border-danger/20 bg-danger/5 text-danger",
  }[color];
  return (
    <div className={`rounded-xl border overflow-hidden ${expandida ? colorClasses.split(" ")[0] : "border-neutral-200"}`}>
      <button
        onClick={onToggle}
        className={`w-full text-left p-4 transition-colors ${expandida ? colorClasses : "bg-white hover:bg-neutral-50"}`}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">{label}</p>
          <svg className={`size-4 transition-transform ${expandida ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
        <p className="text-xl md:text-2xl font-bold font-display tabular-nums mt-1">{AR.format(monto)}</p>
        {subLabel && <p className="text-xs opacity-70 mt-0.5">{subLabel}</p>}
      </button>
      {expandida && <div className="border-t border-neutral-200 bg-white divide-y divide-neutral-100">{children}</div>}
    </div>
  );
}

function Fila({ nombre, monto, extra }: { nombre: string; monto: number; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-neutral-700">{nombre}</span>
      <span className="flex items-center gap-2">
        {extra}
        <span className="font-semibold tabular-nums text-neutral-900">{AR.format(monto)}</span>
      </span>
    </div>
  );
}

export function PosicionCajaView({ data, sucursales, sucursalFiltro, fecha, esHoy }: {
  data: PosicionData;
  sucursales: { id: string; nombre: string }[];
  sucursalFiltro: string;
  fecha: string;
  esHoy: boolean;
}) {
  const [expandida, setExpandida] = useState<string | null>(null);
  function toggle(key: string) { setExpandida((e) => (e === key ? null : key)); }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <form method="GET" className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Sucursal</label>
          <select
            name="sucursal" defaultValue={sucursalFiltro}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700 bg-white"
          >
            <option value="all">Todas</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Fecha</label>
          <input
            type="date" name="fecha" defaultValue={fecha}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Ver
        </button>
        {(sucursalFiltro !== "all" || !esHoy) && (
          <Link href="/admin/tesoreria" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {!data.hayAlgunSocioCargado && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          Todavía no hay ningún usuario marcado como socio (Staff → Editar) — "Deuda de socios" va a dar $0 hasta que se cargue al menos uno.
        </div>
      )}

      {/* Número principal */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Posición consolidada</p>
        <p className={`text-4xl md:text-5xl font-bold font-display tabular-nums ${data.posicionConsolidada >= 0 ? "text-neutral-900" : "text-danger"}`}>
          {AR.format(data.posicionConsolidada)}
        </p>
        <p className="text-xs text-neutral-400 mt-2">
          {esHoy ? "Actualizado ahora" : `Reconstruido al ${new Date(fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}`}
        </p>
      </div>

      {/* 4 tarjetas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Tarjeta label="Efectivo en cajones" monto={data.efectivoTotal} color="tierra" expandida={expandida === "efectivo"} onToggle={() => toggle("efectivo")}>
          {data.efectivoPorSucursal.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Sin sucursales.</p>
          ) : data.efectivoPorSucursal.map((r) => (
            <Fila key={r.sucursalId} nombre={r.nombre} monto={r.monto} extra={
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${ESTADO_COLOR[r.estado]}`}>{ESTADO_LABEL[r.estado]}</span>
            } />
          ))}
        </Tarjeta>

        <Tarjeta label="Sobres pendientes" monto={data.sobresTotal} color="tierra" expandida={expandida === "sobres"} onToggle={() => toggle("sobres")}>
          {data.sobresPorSucursal.filter((r) => r.monto > 0).length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Sin sobres pendientes de retiro.</p>
          ) : data.sobresPorSucursal.filter((r) => r.monto > 0).map((r) => (
            <Fila key={r.sucursalId} nombre={r.nombre} monto={r.monto} />
          ))}
        </Tarjeta>

        <Tarjeta label="Deuda a proveedores" monto={data.deudaProveedoresTotal} color="danger" expandida={expandida === "proveedores"} onToggle={() => toggle("proveedores")}>
          {data.deudaProveedores.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Sin deuda pendiente con proveedores.</p>
          ) : data.deudaProveedores.map((p) => <Fila key={p.id} nombre={p.nombre} monto={p.monto} />)}
        </Tarjeta>

        <Tarjeta label="Deuda de socios" monto={data.deudaSociosTotal} color="danger" expandida={expandida === "socios"} onToggle={() => toggle("socios")}>
          {data.deudaSocios.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Sin deuda pendiente de socios.</p>
          ) : data.deudaSocios.map((s) => <Fila key={s.id} nombre={s.nombre} monto={s.monto} />)}
        </Tarjeta>

        <Tarjeta
          label="Cta. Corriente pendiente"
          monto={data.ctaCorrientePendienteTotal}
          color="selva"
          expandida={expandida === "ctacorriente"}
          onToggle={() => toggle("ctacorriente")}
          subLabel="No entra en la Posición — no es efectivo disponible"
        >
          {data.ctaCorrientePendiente.length === 0 ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Sin saldo pendiente de empleados.</p>
          ) : data.ctaCorrientePendiente.map((p) => <Fila key={p.id} nombre={p.nombre} monto={p.monto} />)}
        </Tarjeta>
      </div>

      <p className="text-xs text-neutral-400">
        Posición = Efectivo en cajones + Sobres pendientes − Deuda a proveedores − Deuda de socios. Solo cuentan como deuda los retiros de socio tipo "Temporal" — el reparto de ganancias no vuelve. Cta. Corriente se muestra aparte, a título informativo: es plata que el negocio todavía no cobró, no efectivo disponible hoy.
      </p>
    </div>
  );
}
