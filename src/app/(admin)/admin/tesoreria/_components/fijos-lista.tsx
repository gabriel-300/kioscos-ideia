"use client";

import { useState } from "react";
import Link from "next/link";
import { EgresoForm, type Borrador } from "./egreso-form";
import type { GastoFijoLista } from "@/lib/tesoreria/consultas";
import { etiquetaCategoria } from "@/lib/tesoreria/tipos";
import { fechaHoyAR } from "@/lib/fecha";

type Opcion = { id: string; nombre: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

// Vencimientos del mes: alquiler, sueldos, servicios. La lista base (qué se paga y cuánto) se edita en
// /admin/gastos; acá solo se registra el pago de cada mes, con el mismo formulario que cualquier egreso.
export function FijosLista({ fijos, pagadosPorFijo, mes, desde, sucursales, proveedores, puedeCargar }: {
  fijos: GastoFijoLista[];
  pagadosPorFijo: Record<string, { monto: number; fecha: string; pagos: number }>;   // gasto_fijo_id → lo registrado este mes
  mes: string;
  desde: string;   // arranque de Tesorería: lo que vence antes ya está cerrado
  sucursales: Opcion[];
  proveedores: Opcion[];
  puedeCargar: boolean;
}) {
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [abierto, setAbierto]   = useState(false);
  const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));

  function registrar(g: GastoFijoLista) {
    const hoy = fechaHoyAR();
    // Si ya se pagó una parte, se sugiere lo que falta del estimado (se corrige con el importe real).
    const yaPagado = pagadosPorFijo[g.id]?.monto ?? 0;
    setBorrador({
      fecha: hoy.slice(0, 7) === mes ? hoy : `${mes}-01`,
      monto: Math.max(g.monto_estimado - yaPagado, 0) || g.monto_estimado, categoria: g.categoria, descripcion: g.descripcion,
      sucursal_id: g.sucursal_id, gasto_fijo_id: g.id,
    });
    setAbierto(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-neutral-500">
          Obligaciones del mes: sueldos, alquiler, cuotas y servicios. Una obligación queda «sin registrar» hasta que cargues su pago; si se
          paga en partes, registrá cada una y se suman.
        </p>
        <Link href="/admin/gastos" className="text-xs font-semibold text-tierra-700 hover:underline">Editar la lista de gastos fijos</Link>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {fijos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400">No hay gastos fijos cargados.</p>
        ) : fijos.map((g) => {
          const pago = pagadosPorFijo[g.id];
          const cerrada = !pago && `${mes}-${String(g.dia_vencimiento).padStart(2, "0")}` < desde;
          return (
            <div key={g.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-neutral-800">{g.descripcion}</span>
                  <span className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-600">{etiquetaCategoria(g.categoria)}</span>
                  <span className="text-xs text-neutral-400">vence día {g.dia_vencimiento}{g.sucursal_id ? ` · ${nombreSucursal.get(g.sucursal_id) ?? ""}` : ""}</span>
                </div>
                <p className="mt-1 text-xs">
                  {pago ? (
                    <span className="text-selva-700 font-medium">Registrado {AR.format(pago.monto)}{pago.pagos > 1 ? ` en ${pago.pagos} pagos` : ""} · {pago.pagos > 1 ? "último " : ""}{new Date(pago.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} · estimado {AR.format(g.monto_estimado)}</span>
                  ) : cerrada ? (
                    <span className="text-neutral-400">Vence antes del arranque de Tesorería ({desde.split("-").reverse().join("/")}): ya está cerrado — estimado {AR.format(g.monto_estimado)}</span>
                  ) : (
                    <span className="text-amber-700 font-medium">Sin registrar este mes — estimado {AR.format(g.monto_estimado)}</span>
                  )}
                </p>
              </div>
              {puedeCargar && (
                <button onClick={() => registrar(g)} className="text-xs font-semibold text-tierra-700 hover:underline shrink-0">
                  {pago ? "Registrar otro pago" : "Registrar pago"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <EgresoForm open={abierto} titulo="Registrar gasto fijo" borrador={borrador} sucursales={sucursales} proveedores={proveedores}
        onClose={() => { setAbierto(false); setBorrador(null); }} />
    </div>
  );
}
