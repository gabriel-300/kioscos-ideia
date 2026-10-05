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
export function FijosLista({ fijos, pagadosPorFijo, mes, sucursales, proveedores, puedeCargar }: {
  fijos: GastoFijoLista[];
  pagadosPorFijo: Record<string, { monto: number; fecha: string }>;   // gasto_fijo_id → egreso de este mes
  mes: string;
  sucursales: Opcion[];
  proveedores: Opcion[];
  puedeCargar: boolean;
}) {
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [abierto, setAbierto]   = useState(false);
  const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));

  function registrar(g: GastoFijoLista) {
    const hoy = fechaHoyAR();
    setBorrador({
      fecha: hoy.slice(0, 7) === mes ? hoy : `${mes}-01`,
      monto: g.monto_estimado, categoria: g.categoria, descripcion: g.descripcion,
      sucursal_id: g.sucursal_id, gasto_fijo_id: g.id,
    });
    setAbierto(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-neutral-500">Lo que se paga todos los meses. Registrá cada pago cuando se hace.</p>
        <Link href="/admin/gastos" className="text-xs font-semibold text-tierra-700 hover:underline">Editar la lista de gastos fijos</Link>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {fijos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400">No hay gastos fijos cargados.</p>
        ) : fijos.map((g) => {
          const pago = pagadosPorFijo[g.id];
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
                    <span className="text-selva-700 font-medium">Registrado {AR.format(pago.monto)} el {new Date(pago.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}</span>
                  ) : (
                    <span className="text-amber-700 font-medium">Sin registrar este mes — estimado {AR.format(g.monto_estimado)}</span>
                  )}
                </p>
              </div>
              {puedeCargar && !pago && (
                <button onClick={() => registrar(g)} className="text-xs font-semibold text-tierra-700 hover:underline shrink-0">Registrar pago</button>
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
