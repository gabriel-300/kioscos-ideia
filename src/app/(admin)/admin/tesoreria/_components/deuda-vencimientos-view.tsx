"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TRAMOS, listadoDeuda, type FilaDeuda, type Tramo } from "@/lib/tesoreria/deuda-vencimientos";
import type { CuentaProveedor } from "@/lib/tesoreria/proveedores-cuenta";
import { fijarVencimiento } from "../actions";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const dma = (f: string) => f.split("-").reverse().join("/");

const COLOR_TRAMO: Record<Tramo, string> = {
  vencida:         "border-danger/30 bg-danger/5 text-danger",
  vence_7:         "border-amber-200 bg-amber-50 text-amber-800",
  vence_30:        "border-blue-200 bg-blue-50 text-blue-700",
  mas_30:          "border-neutral-200 bg-neutral-50 text-neutral-600",
  sin_vencimiento: "border-neutral-200 bg-white text-neutral-500",
};

// Cargar o corregir cuándo vence un remito o factura que todavía se debe (migración 113). Queda en el historial.
export function Vencimiento({ egresoId, vence, puedeCargar }: { egresoId: string; vence: string | null; puedeCargar: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [fecha, setFecha] = useState(vence ?? "");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();

  function guardar(valor: string | null) {
    setError("");
    empezar(async () => {
      const r = await fijarVencimiento(egresoId, valor);
      if (r.error) { setError(r.error); return; }
      setEditando(false);
      router.refresh();
    });
  }

  if (!editando) {
    return (
      <span className="text-xs text-neutral-500">
        {vence ? `Vence ${dma(vence)}` : "Sin vencimiento"}
        {puedeCargar && (
          <button type="button" onClick={() => { setFecha(vence ?? ""); setEditando(true); }} className="ml-2 underline text-tierra-700 hover:text-tierra-800">
            {vence ? "Cambiar" : "Fijar"}
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha de vencimiento"
        className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-xs" />
      <button type="button" onClick={() => guardar(fecha || null)} disabled={pendiente}
        className="rounded-lg bg-tierra-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">{pendiente ? "Guardando…" : "Guardar"}</button>
      {vence && <button type="button" onClick={() => guardar(null)} disabled={pendiente} className="text-xs underline text-neutral-500">Sacar</button>}
      <button type="button" onClick={() => setEditando(false)} disabled={pendiente} className="text-xs underline text-neutral-500">Cancelar</button>
      {error && <span role="alert" className="basis-full text-xs text-danger">{error}</span>}
    </span>
  );
}

// El listado, para llevarlo a una planilla (separador «;» y coma decimal: así lo abre Excel en castellano).
function descargarCsv(filas: FilaDeuda[], proveedor: Record<string, string>, local: Record<string, string>, hoy: string) {
  const etiqueta = Object.fromEntries(TRAMOS.map((t) => [t.valor, t.etiqueta]));
  const num = (n: number) => n.toFixed(2).replace(".", ",");
  const cabecera = ["Proveedor", "Local", "N° de comprobante", "Detalle", "Fecha de compra", "Vencimiento", "Días de atraso", "Estado", "Falta pagar"];
  const cuerpo = filas.map((f) => [
    proveedor[f.proveedor_id] ?? "", f.sucursal_id ? local[f.sucursal_id] ?? "" : "Sin local", f.numero ?? "", f.descripcion,
    f.fecha ? dma(f.fecha) : "", f.vencimiento ? dma(f.vencimiento) : "", f.dias !== null && f.dias > 0 ? String(f.dias) : "", etiqueta[f.tramo], num(f.monto),
  ]);
  const csv = "﻿" + [cabecera, ...cuerpo].map((fila) => fila.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `deuda-proveedores-${hoy}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function DeudaVencimientosView({ cuentas, hoy, nombreProveedor, nombreLocal, puedeCargar }: {
  cuentas: CuentaProveedor[]; hoy: string; nombreProveedor: Record<string, string>; nombreLocal: Record<string, string>; puedeCargar: boolean;
}) {
  const listado = useMemo(() => listadoDeuda(cuentas, hoy), [cuentas, hoy]);
  const [tramo, setTramo] = useState<Tramo | "todos">("todos");
  const filas = tramo === "todos" ? listado.filas : listado.filas.filter((f) => f.tramo === tramo);
  const { totales } = listado;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Deuda vencida y a vencer</h2>
          <p className="text-xs text-neutral-500">
            Lo que falta pagar de cada remito o factura, según su vencimiento. Los que no tienen fecha figuran aparte: tocá «Fijar» para cargarla.
          </p>
        </div>
        <button type="button" onClick={() => descargarCsv(filas, nombreProveedor, nombreLocal, hoy)} disabled={filas.length === 0}
          className="rounded-lg border border-tierra-700 px-3 py-1.5 text-sm font-semibold text-tierra-700 hover:bg-tierra-50 disabled:opacity-40">
          Descargar el listado (Excel)
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {TRAMOS.map((t) => (
          <button key={t.valor} type="button" onClick={() => setTramo(tramo === t.valor ? "todos" : t.valor)}
            className={`rounded-xl border p-3 text-left transition-shadow ${COLOR_TRAMO[t.valor]} ${tramo === t.valor ? "ring-2 ring-tierra-700/40" : ""}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide">{t.etiqueta}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{AR.format(totales[t.valor].monto)}</p>
            <p className="text-xs opacity-80">{totales[t.valor].cantidad} {totales[t.valor].cantidad === 1 ? "comprobante" : "comprobantes"}</p>
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Total que se debe: <b>{AR.format(listado.total)}</b>
        {listado.aFavor > 0 && <> · además hay <b>{AR.format(listado.aFavor)}</b> a favor en cuentas pagadas de más</>}
        {tramo !== "todos" && <> · mostrando solo «{TRAMOS.find((t) => t.valor === tramo)?.etiqueta}» <button type="button" onClick={() => setTramo("todos")} className="underline">ver todo</button></>}
      </p>

      {filas.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-400">No hay deuda en esta categoría.</p>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
          {filas.map((f, i) => (
            <div key={`${f.egreso_id ?? "saldo"}-${f.proveedor_id}-${f.sucursal_id}-${i}`} className="px-4 py-2.5 text-sm flex justify-between gap-3 flex-wrap">
              <span className="min-w-0">
                <span className="font-medium text-neutral-900">{nombreProveedor[f.proveedor_id] ?? "Proveedor"}</span>
                <span className="text-neutral-500"> · {f.sucursal_id ? nombreLocal[f.sucursal_id] ?? "—" : "Sin local"}</span>
                <span className="block text-xs text-neutral-500">
                  {f.numero ? `N° ${f.numero} · ` : ""}{f.descripcion}{f.fecha ? ` · compra del ${dma(f.fecha)}` : ""}
                </span>
              </span>
              <span className="text-right">
                <b className="tabular-nums">{AR.format(f.monto)}</b>
                <span className="block">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${COLOR_TRAMO[f.tramo]}`}>
                    {f.tramo === "vencida" ? `Vencida hace ${f.dias} ${f.dias === 1 ? "día" : "días"}`
                      : f.tramo === "sin_vencimiento" ? "Sin vencimiento"
                      : f.dias === 0 ? "Vence hoy" : `Vence en ${-(f.dias ?? 0)} ${-(f.dias ?? 0) === 1 ? "día" : "días"}`}
                  </span>
                </span>
                {f.egreso_id && <span className="block mt-0.5"><Vencimiento egresoId={f.egreso_id} vence={f.vencimiento} puedeCargar={puedeCargar} /></span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
