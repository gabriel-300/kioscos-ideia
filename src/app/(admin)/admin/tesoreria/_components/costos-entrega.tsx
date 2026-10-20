"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EntregaPendiente } from "@/lib/tesoreria/consultas";
import { formatKg } from "@/lib/utils";
import { completarCostosEntrega } from "../actions";

// Costo unitario de cada producto de una mercadería que ingresó al kiosco. El personal solo carga producto y cantidad (sin precios,
// los cargaba mal); el administrativo completa el costo mirando la factura o el remito. Es el mismo dato de siempre
// (movimiento_items.precio_unitario): alimenta márgenes, rotación y el aviso de «el proveedor cambió el precio».

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export type ValoresCosto = Record<string, string>;   // id de la línea → costo unitario como texto

export const costosIniciales = (e: EntregaPendiente): ValoresCosto =>
  Object.fromEntries(e.lineas.map((l) => [l.id, l.precio_unitario != null ? String(l.precio_unitario) : ""]));

const numero = (t: string) => Number(t.replace(",", "."));

// Lo que se manda al servidor: un costo por línea (vacío = sin costo todavía).
export const costosAEnviar = (e: EntregaPendiente, v: ValoresCosto) =>
  e.lineas.map((l) => ({ id: l.id, precio_unitario: (v[l.id] ?? "").trim() === "" ? null : numero(v[l.id]) }));

export const hayCostosCargados = (v: ValoresCosto) => Object.values(v).some((t) => t.trim() !== "");

export const costosValidos = (v: ValoresCosto) =>
  Object.values(v).every((t) => t.trim() === "" || (Number.isFinite(numero(t)) && numero(t) >= 0));

// Tabla con un campo de costo por producto (controlada: quien la usa guarda los valores).
export function CostosTabla({ entrega, valores, onChange }: { entrega: EntregaPendiente; valores: ValoresCosto; onChange: (v: ValoresCosto) => void }) {
  const total = entrega.lineas.reduce((s, l) => s + (numero(valores[l.id] ?? "") || 0) * l.cantidad, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="py-2 font-medium">Producto</th>
            <th className="py-2 font-medium text-right">Cantidad</th>
            <th className="py-2 font-medium text-right w-32">Costo unit. $</th>
            <th className="py-2 font-medium text-right w-24">Importe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {entrega.lineas.map((l) => {
            const costo = numero(valores[l.id] ?? "");
            return (
              <tr key={l.id}>
                <td className="py-1.5 text-neutral-700">{l.producto}</td>
                <td className="py-1.5 text-right tabular-nums text-neutral-700">{formatKg(l.cantidad)}{l.unidad ? ` ${l.unidad}` : ""}</td>
                <td className="py-1.5 text-right">
                  <input inputMode="decimal" aria-label={`Costo unitario de ${l.producto}`} value={valores[l.id] ?? ""} placeholder="0"
                    onChange={(ev) => onChange({ ...valores, [l.id]: ev.target.value })}
                    className="h-8 w-28 rounded-lg border border-neutral-300 bg-white px-2 text-right text-sm tabular-nums" />
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-700">{costo > 0 ? AR.format(costo * l.cantidad) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        {total > 0 && (
          <tfoot>
            <tr><td colSpan={3} className="pt-2 text-right text-xs font-semibold text-neutral-500">Total de la mercadería</td><td className="pt-2 text-right font-semibold tabular-nums text-neutral-900">{AR.format(total)}</td></tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// Editor con su propio botón «Guardar costos» (se usa dentro del detalle de un ingreso del kiosco).
export function CostosEditor({ entrega }: { entrega: EntregaPendiente }) {
  const router = useRouter();
  const [valores, setValores] = useState<ValoresCosto>(() => costosIniciales(entrega));
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();
  const [guardado, setGuardado] = useState(false);

  function guardar() {
    setError("");
    setGuardado(false);
    if (!costosValidos(valores)) { setError("Cada costo tiene que ser un número mayor o igual a cero"); return; }
    empezar(async () => {
      const r = await completarCostosEntrega(entrega.id, costosAEnviar(entrega, valores));
      if (r.error) { setError(r.error); return; }
      setGuardado(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <CostosTabla entrega={entrega} valores={valores} onChange={(v) => { setGuardado(false); setValores(v); }} />
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={guardar} disabled={pendiente || !hayCostosCargados(valores)}
          className="rounded-lg bg-tierra-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
          {pendiente ? "Guardando…" : "Guardar costos"}
        </button>
        {guardado && <span className="text-xs text-selva-700">Costos guardados.</span>}
        <span className="text-xs text-neutral-400">Tomalos de la factura o el remito. Si un costo cambió respecto del actual, queda un aviso en Alertas de precio.</span>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
