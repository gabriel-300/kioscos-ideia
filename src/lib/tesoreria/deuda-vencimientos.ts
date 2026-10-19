// Listado de deuda a proveedores por vencimiento (migración 113). Función pura: recibe las cuentas ya calculadas
// (proveedores-cuenta.ts, con las imputaciones de los pagos aplicadas) y la fecha de hoy.
//
// Cada fila es lo que todavía FALTA pagar de un remito o factura (no su importe entero) y la suma de las filas da lo mismo que
// «Se debe a proveedores». El saldo inicial de una cuenta no tiene vencimiento: figura como una fila «Saldo anterior».

import { redondearMoneda } from "@/lib/pedidos/pricing";
import type { CuentaProveedor } from "./proveedores-cuenta";

export const TRAMOS = [
  { valor: "vencida",         etiqueta: "Vencida" },
  { valor: "vence_7",         etiqueta: "Vence en los próximos 7 días" },
  { valor: "vence_30",        etiqueta: "Vence entre 8 y 30 días" },
  { valor: "mas_30",          etiqueta: "Vence en más de 30 días" },
  { valor: "sin_vencimiento", etiqueta: "Sin vencimiento cargado" },
] as const;
export type Tramo = (typeof TRAMOS)[number]["valor"];

export interface FilaDeuda {
  tramo:        Tramo;
  proveedor_id: string;
  sucursal_id:  string | null;
  egreso_id:    string | null;       // null = saldo anterior (inicial) de la cuenta
  descripcion:  string;
  numero:       string | null;
  fecha:        string;              // de la compra; en el saldo anterior, la fecha de corte vacía
  vencimiento:  string | null;
  monto:        number;              // lo que falta pagar
  dias:         number | null;       // > 0 = días de atraso; < 0 = días que faltan; null = sin vencimiento
}

export interface ListadoDeuda {
  filas:   FilaDeuda[];
  totales: Record<Tramo, { cantidad: number; monto: number }>;
  total:   number;                   // lo que se debe (igual al «se debe» de las cuentas con saldo positivo)
  aFavor:  number;                   // cuentas con saldo a favor: no figuran como deuda
}

const MS_DIA = 86_400_000;
const enDias = (desde: string, hasta: string) => Math.round((Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10)) - Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10))) / MS_DIA);

export function tramoDe(vencimiento: string | null, hoy: string): Tramo {
  if (!vencimiento) return "sin_vencimiento";
  const faltan = enDias(hoy, vencimiento);   // negativo = ya venció
  if (faltan < 0)   return "vencida";
  if (faltan <= 7)  return "vence_7";
  if (faltan <= 30) return "vence_30";
  return "mas_30";
}

const ORDEN = new Map<Tramo, number>(TRAMOS.map((t, i) => [t.valor, i]));

export function listadoDeuda(cuentas: CuentaProveedor[], hoy: string): ListadoDeuda {
  const filas: FilaDeuda[] = [];
  let aFavor = 0;
  for (const c of cuentas) {
    if (c.saldo < 0) aFavor += -c.saldo;
    if (c.saldoInicialPendiente > 0) {
      filas.push({
        tramo: "sin_vencimiento", proveedor_id: c.proveedor_id, sucursal_id: c.sucursal_id, egreso_id: null,
        descripcion: "Saldo anterior (saldo inicial)", numero: null, fecha: "", vencimiento: null, monto: c.saldoInicialPendiente, dias: null,
      });
    }
    for (const d of c.detalleCompras) {
      if (d.resta <= 0) continue;
      const vence = d.compra.fecha_vencimiento ?? null;
      filas.push({
        tramo: tramoDe(vence, hoy), proveedor_id: c.proveedor_id, sucursal_id: c.sucursal_id, egreso_id: d.compra.id,
        descripcion: d.compra.descripcion, numero: d.compra.comprobante_numero, fecha: d.compra.fecha,
        vencimiento: vence, monto: d.resta, dias: vence ? -enDias(hoy, vence) : null,
      });
    }
  }
  filas.sort((a, b) =>
    (ORDEN.get(a.tramo)! - ORDEN.get(b.tramo)!)
    || ((a.vencimiento ?? a.fecha) < (b.vencimiento ?? b.fecha) ? -1 : (a.vencimiento ?? a.fecha) > (b.vencimiento ?? b.fecha) ? 1 : 0));

  const totales = Object.fromEntries(TRAMOS.map((t) => [t.valor, { cantidad: 0, monto: 0 }])) as ListadoDeuda["totales"];
  for (const f of filas) { totales[f.tramo].cantidad += 1; totales[f.tramo].monto += f.monto; }
  for (const t of TRAMOS) totales[t.valor].monto = redondearMoneda(totales[t.valor].monto);
  return { filas, totales, total: redondearMoneda(filas.reduce((s, f) => s + f.monto, 0)), aFavor: redondearMoneda(aFavor) };
}
