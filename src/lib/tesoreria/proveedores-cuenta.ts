// Cuenta corriente por proveedor y local (migración 106). Funciones puras: reciben filas ya leídas.
//
// Regla (la misma que usa la planilla del administrativo): el saldo no se arma imputando cada pago a un remito, se resta:
//     saldo = saldo inicial + compras que todavía se deben − pagos
// Positivo = se le debe al proveedor. Negativo = saldo a favor (se pagó de más o por adelantado).
// Qué compras quedan cubiertas es solo informativo y no cambia el saldo: un pago puede imputarse a remitos o facturas concretos
// (migración 112); lo que no se imputa cubre primero el saldo inicial y después las compras más viejas.

import { redondearMoneda } from "@/lib/pedidos/pricing";
import { agruparDeuda, type Deuda } from "./calculos";
import { ORIGENES, type Egreso, type Origen } from "./tipos";
import { MONTO_MAX, fechaValida } from "./validaciones";

export const TIPOS_MOVIMIENTO = ["saldo_inicial", "pago"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

// Un pago de proveedor sale de Tesorería o de una cuenta: el retiro de caja ya tiene su propio camino (pago autorizado en el kiosco).
export const ORIGENES_PAGO = ORIGENES.filter((o) => o.valor !== "retiro_caja");

export interface MovimientoProveedor {
  id: string; tipo: TipoMovimiento; proveedor_id: string; sucursal_id: string; fecha: string; monto: number;
  origen: Origen | null; nota: string | null; created_at: string; created_by: string | null;
}

// Compra que todavía se debe (egreso no pagado, con proveedor de la lista).
export interface CompraAdeudada {
  id: string; proveedor_id: string; sucursal_id: string | null; fecha: string; monto: number;
  descripcion: string; comprobante_numero: string | null;
}

export type EstadoCompra = "pendiente" | "parcial" | "cubierta";
export interface CompraConEstado { compra: CompraAdeudada; estado: EstadoCompra; cubierto: number; resta: number }

export interface CuentaProveedor {
  clave:        string;               // proveedor|local
  proveedor_id: string;
  sucursal_id:  string | null;        // null = compras sin local («general»)
  saldoInicial: number;
  compras:      number;               // suma de lo que todavía se debe en compras
  pagos:        number;
  saldo:        number;               // saldoInicial + compras − pagos
  detalleCompras: CompraConEstado[];  // de la más vieja a la más nueva
  movimientos:  MovimientoProveedor[];// más nuevos primero
}

const claveDe = (proveedor: string, sucursal: string | null) => `${proveedor}|${sucursal ?? "general"}`;

// Parte de un pago que se imputó a un remito o factura concreto (migración 112).
export interface Imputacion { pago_id: string; egreso_id: string; monto: number }

export function calcularCuentas(compras: CompraAdeudada[], movimientos: MovimientoProveedor[], imputaciones: Imputacion[] = []): CuentaProveedor[] {
  const cuentas = new Map<string, CuentaProveedor>();
  const cuenta = (proveedor: string, sucursal: string | null) => {
    const k = claveDe(proveedor, sucursal);
    let c = cuentas.get(k);
    if (!c) {
      c = { clave: k, proveedor_id: proveedor, sucursal_id: sucursal, saldoInicial: 0, compras: 0, pagos: 0, saldo: 0, detalleCompras: [], movimientos: [] };
      cuentas.set(k, c);
    }
    return c;
  };

  for (const m of movimientos) {
    const c = cuenta(m.proveedor_id, m.sucursal_id);
    if (m.tipo === "saldo_inicial") c.saldoInicial += m.monto; else c.pagos += m.monto;
    c.movimientos.push(m);
  }
  const ordenadas = [...compras].sort((a, b) => (a.fecha === b.fecha ? a.id.localeCompare(b.id) : a.fecha.localeCompare(b.fecha)));
  for (const cp of ordenadas) {
    const c = cuenta(cp.proveedor_id, cp.sucursal_id);
    c.compras += cp.monto;
    c.detalleCompras.push({ compra: cp, estado: "pendiente", cubierto: 0, resta: cp.monto });
  }

  // Imputaciones vigentes: su pago no está anulado (está entre los movimientos) y la compra sigue pendiente (está entre las compras).
  const pagosVigentes = new Set(movimientos.filter((m) => m.tipo === "pago").map((m) => m.id));
  const imputadoA = new Map<string, number>();
  for (const i of imputaciones) {
    if (!pagosVigentes.has(i.pago_id)) continue;
    imputadoA.set(i.egreso_id, (imputadoA.get(i.egreso_id) ?? 0) + i.monto);
  }

  for (const c of cuentas.values()) {
    // 1) Lo imputado a un remito lo cubre a ese remito (nunca más que su monto).
    let imputadoTotal = 0;
    for (const d of c.detalleCompras) {
      const aplicado = Math.min(d.compra.monto, imputadoA.get(d.compra.id) ?? 0);
      imputadoTotal += aplicado;
      d.cubierto = aplicado;
    }
    // 2) Lo que de los pagos no se imputó cubre primero el saldo inicial (lo más viejo) y el resto a las compras, de la más vieja a la más nueva.
    let disponible = Math.max(0, c.pagos - imputadoTotal - c.saldoInicial);
    for (const d of c.detalleCompras) {
      const aplicar = Math.min(d.compra.monto - d.cubierto, disponible);
      disponible -= aplicar;
      const cubierto = d.cubierto + aplicar;
      d.cubierto = redondearMoneda(cubierto);
      d.resta    = redondearMoneda(d.compra.monto - cubierto);
      d.estado   = d.resta <= 0 ? "cubierta" : cubierto > 0 ? "parcial" : "pendiente";
    }
    c.saldoInicial = redondearMoneda(c.saldoInicial);
    c.compras      = redondearMoneda(c.compras);
    c.pagos        = redondearMoneda(c.pagos);
    c.saldo        = redondearMoneda(c.saldoInicial + c.compras - c.pagos);
    c.movimientos.sort((a, b) => (a.fecha === b.fecha ? b.created_at.localeCompare(a.created_at) : b.fecha.localeCompare(a.fecha)));
  }
  return [...cuentas.values()].sort((a, b) => b.saldo - a.saldo);
}

// Estado de cada compra según los pagos de su cuenta (calculado, nunca guardado): para mostrar lo mismo en todas las pantallas.
export function estadoPorCompra(cuentas: CuentaProveedor[]): Record<string, { estado: EstadoCompra; resta: number; cubierto: number }> {
  const out: Record<string, { estado: EstadoCompra; resta: number; cubierto: number }> = {};
  for (const c of cuentas) for (const d of c.detalleCompras) out[d.compra.id] = { estado: d.estado, resta: d.resta, cubierto: d.cubierto };
  return out;
}

export function totalAdeudado(cuentas: Pick<CuentaProveedor, "saldo">[]): { debe: number; aFavor: number; neto: number } {
  let debe = 0, aFavor = 0;
  for (const c of cuentas) { if (c.saldo > 0) debe += c.saldo; else aFavor += -c.saldo; }
  return { debe: redondearMoneda(debe), aFavor: redondearMoneda(aFavor), neto: redondearMoneda(debe - aFavor) };
}

// ── Validación en el servidor ────────────────────────────────────────────────
export interface MovimientoEntrada {
  tipo:         string;
  proveedor_id: string;
  sucursal_id:  string;
  fecha:        string;
  monto:        number;
  origen:       string | null;
  nota:         string | null;
}

export type MovimientoValidado = {
  tipo: TipoMovimiento; proveedor_id: string; sucursal_id: string; fecha: string; monto: number; origen: Origen | null; nota: string | null;
};

export function validarMovimientoProveedor(e: MovimientoEntrada, hoy: string): { valor: MovimientoValidado } | { error: string } {
  if (!(TIPOS_MOVIMIENTO as readonly string[]).includes(e.tipo)) return { error: "Tipo de movimiento inválido" };
  const tipo = e.tipo as TipoMovimiento;
  if (!e.proveedor_id) return { error: "Elegí el proveedor" };
  if (!e.sucursal_id)  return { error: "Elegí el local al que corresponde" };
  if (!fechaValida(e.fecha)) return { error: "La fecha no es válida" };
  if (e.fecha > hoy) return { error: "La fecha no puede ser futura" };
  if (typeof e.monto !== "number" || !Number.isFinite(e.monto) || e.monto <= 0) return { error: "El monto tiene que ser mayor a cero" };
  if (e.monto > MONTO_MAX) return { error: "El monto es demasiado grande" };
  const monto = redondearMoneda(e.monto);
  if (monto <= 0) return { error: "El monto tiene que ser mayor a cero" };

  let origen: Origen | null = null;
  if (tipo === "pago") {
    const o = ORIGENES_PAGO.find((x) => x.valor === e.origen);
    if (!o) return { error: "Elegí de dónde salió la plata" };
    origen = o.valor;
  }
  const nota = (e.nota ?? "").trim();
  if (nota.length > 200) return { error: "La nota es demasiado larga (máximo 200 caracteres)" };
  return { valor: { tipo, proveedor_id: e.proveedor_id, sucursal_id: e.sucursal_id, fecha: e.fecha, monto, origen, nota: nota || null } };
}

// A qué remitos o facturas se imputa un pago (migración 112). `resta` = lo que todavía falta cubrir de cada compra de la cuenta
// (calculado sin este pago). La suma no puede superar el pago, ni cada parte lo que le resta a su compra.
export interface ImputacionEntrada { egreso_id: string; monto: number }

export function validarImputaciones(
  entradas: ImputacionEntrada[] | undefined, montoPago: number, resta: Map<string, number>,
): { valor: ImputacionEntrada[] } | { error: string } {
  const lista = entradas ?? [];
  if (lista.length === 0) return { valor: [] };
  const vistos = new Set<string>();
  const valor: ImputacionEntrada[] = [];
  let suma = 0;
  for (const i of lista) {
    if (!i?.egreso_id || !resta.has(i.egreso_id)) return { error: "Elegiste un remito o factura que no corresponde a esta cuenta o ya no se debe. Recargá la pantalla." };
    if (vistos.has(i.egreso_id)) return { error: "Un remito o factura está repetido en el pago" };
    vistos.add(i.egreso_id);
    if (typeof i.monto !== "number" || !Number.isFinite(i.monto) || i.monto <= 0) return { error: "El monto de cada remito o factura tiene que ser mayor a cero" };
    const monto = redondearMoneda(i.monto);
    if (monto <= 0) return { error: "El monto de cada remito o factura tiene que ser mayor a cero" };
    const falta = resta.get(i.egreso_id) ?? 0;
    if (monto > falta) return { error: `A un remito o factura le imputaste más de lo que le falta cubrir (le faltan ${falta.toLocaleString("es-AR")}).` };
    suma += monto;
    valor.push({ egreso_id: i.egreso_id, monto });
  }
  if (redondearMoneda(suma) > montoPago) return { error: "Lo imputado a los remitos y facturas supera el monto del pago" };
  return { valor };
}

// ── «Se debe» del Resumen ────────────────────────────────────────────────────
// Con cuenta corriente, lo que se debe a un proveedor es su saldo (compras − pagos + saldo inicial), no la suma de compras sueltas.
// Las compras sin proveedor de la lista no tienen cuenta y siguen agrupadas por lo que se escribió («lo de Mario»).

export function deudaDelResumen(
  pendientes: Pick<Egreso, "id" | "proveedor_id" | "sucursal_id" | "descripcion" | "monto" | "fecha" | "comprobante_numero">[],
  movimientos: MovimientoProveedor[],
  nombreProveedor: Map<string, string>,
  nombreLocal: Map<string, string>,
  imputaciones: Imputacion[] = [],
): { items: Deuda[]; total: number; sinProveedor: Deuda[]; cuentas: CuentaProveedor[] } {
  const conProveedor = pendientes.filter((p) => p.proveedor_id) as (typeof pendientes[number] & { proveedor_id: string })[];
  const cuentas = calcularCuentas(
    conProveedor.map((p) => ({
      id: p.id, proveedor_id: p.proveedor_id, sucursal_id: p.sucursal_id, fecha: p.fecha, monto: p.monto,
      descripcion: p.descripcion, comprobante_numero: p.comprobante_numero,
    })),
    movimientos,
    imputaciones,
  );
  const items: Deuda[] = cuentas
    .filter((c) => c.saldo > 0)
    .map((c) => ({
      clave: c.clave,
      nombre: `${nombreProveedor.get(c.proveedor_id) ?? "Proveedor"}${c.sucursal_id ? ` · ${nombreLocal.get(c.sucursal_id) ?? ""}` : ""}`,
      monto: c.saldo,
      cantidad: c.detalleCompras.filter((d) => d.estado !== "cubierta").length,   // remitos que todavía no cubren los pagos
    }));
  const sinProveedor = agruparDeuda(pendientes.filter((p) => !p.proveedor_id), nombreProveedor).items;
  const todos = [...items, ...sinProveedor].sort((a, b) => b.monto - a.monto);
  return { items: todos, total: redondearMoneda(todos.reduce((s, d) => s + d.monto, 0)), sinProveedor, cuentas };
}
