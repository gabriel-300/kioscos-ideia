// Cuenta de Mercado Pago con saldo (migración 107). Funciones puras: reciben filas ya leídas.
//
//     saldo = saldo inicial + cobros (neto) + ingresos clasificados como entrada − pagos desde Mercado Pago − retiros
//
// «Disponible» es lo que MP ya liberó; «a liberar» son cobros cuya fecha de liberación todavía no llegó (no es plata para pagar hoy).
// Solo cuentan los movimientos desde el día del saldo inicial en adelante (el saldo inicial ya trae todo lo anterior).
// No se descuentan reembolsos: hoy no hay ninguno en lo importado; cuando aparezcan hay que revisarlo con el reporte de movimientos.

import { redondearMoneda } from "@/lib/pedidos/pricing";
import { MONTO_MAX, fechaValida } from "./validaciones";
import { diaArgentino } from "./mp-cobros";

export const TIPOS_MOVIMIENTO_MP = ["saldo_inicial", "retiro"] as const;
export type TipoMovimientoMp = (typeof TIPOS_MOVIMIENTO_MP)[number];

export interface MovimientoMp {
  id: string; tipo: TipoMovimientoMp; fecha: string; monto: number; nota: string | null; created_at: string; created_by: string | null;
}

// Lo mínimo de un cobro importado que hace falta para el saldo.
export interface CobroParaSaldo {
  fecha_cobro: string; fecha_liberacion: string | null; monto_neto: number; estado: string;
  clase: "cobro" | "a_clasificar"; clasificacion: string | null;
}
export interface PagoDesdeMp { monto: number; fecha: string }   // fecha AAAA-MM-DD

// De lo que no es venta de caja, estas clasificaciones son plata que entró a la cuenta. «No es un ingreso» (movimiento interno de MP) no suma.
const CLASIFICACIONES_QUE_ENTRAN = new Set(["transferencia_propia", "aporte_socio", "otro_ingreso"]);

export interface SaldoMp {
  configurada:    boolean;          // hay saldo inicial cargado: sin eso el saldo no significa nada
  desde:          string | null;    // fecha del saldo inicial
  saldoInicial:   number;
  cobros:         number;           // cobros de caja, neto
  ingresos:       number;           // ingresos clasificados como entrada
  pagos:          number;           // pagos con origen Mercado Pago
  retiros:        number;
  total:          number;           // saldoInicial + cobros + ingresos − pagos − retiros
  aLiberar:       number;           // parte de lo cobrado que todavía no está disponible
  disponible:     number;           // total − aLiberar
  sinClasificar:  { cantidad: number; monto: number };   // ingresos todavía sin clasificar: NO suman hasta que alguien diga qué son
}

export function calcularSaldoMp(p: {
  movimientos: MovimientoMp[];
  cobros:      CobroParaSaldo[];
  pagos:       PagoDesdeMp[];   // incluye los adelantos a personas que salieron de Mercado Pago
  ahoraMs:     number;
  // Plata que una persona repuso en Mercado Pago (migración 129): entra a la cuenta y se suma a «ingresos».
  reposiciones?: PagoDesdeMp[];
}): SaldoMp {
  const inicial = p.movimientos.find((m) => m.tipo === "saldo_inicial") ?? null;
  const vacio: SaldoMp = {
    configurada: false, desde: null, saldoInicial: 0, cobros: 0, ingresos: 0, pagos: 0, retiros: 0, total: 0, aLiberar: 0, disponible: 0,
    sinClasificar: { cantidad: 0, monto: 0 },
  };
  if (!inicial) return vacio;

  const desde = inicial.fecha;
  let cobros = 0, ingresos = 0, aLiberar = 0, sinCantidad = 0, sinMonto = 0;
  for (const c of p.cobros) {
    if (c.estado !== "approved" || diaArgentino(c.fecha_cobro) < desde) continue;
    let suma = false;
    if (c.clase === "cobro") { cobros += c.monto_neto; suma = true; }
    else if (c.clasificacion && CLASIFICACIONES_QUE_ENTRAN.has(c.clasificacion)) { ingresos += c.monto_neto; suma = true; }
    else if (!c.clasificacion) { sinCantidad += 1; sinMonto += c.monto_neto; }
    if (suma && c.fecha_liberacion && Date.parse(c.fecha_liberacion) > p.ahoraMs) aLiberar += c.monto_neto;
  }
  ingresos += (p.reposiciones ?? []).filter((x) => x.fecha >= desde).reduce((s, x) => s + x.monto, 0);
  const pagos   = p.pagos.filter((x) => x.fecha >= desde).reduce((s, x) => s + x.monto, 0);
  const retiros = p.movimientos.filter((m) => m.tipo === "retiro" && m.fecha >= desde).reduce((s, m) => s + m.monto, 0);

  const total = inicial.monto + cobros + ingresos - pagos - retiros;
  return {
    configurada: true, desde, saldoInicial: redondearMoneda(inicial.monto),
    cobros: redondearMoneda(cobros), ingresos: redondearMoneda(ingresos), pagos: redondearMoneda(pagos), retiros: redondearMoneda(retiros),
    total: redondearMoneda(total), aLiberar: redondearMoneda(aLiberar), disponible: redondearMoneda(total - aLiberar),
    sinClasificar: { cantidad: sinCantidad, monto: redondearMoneda(sinMonto) },
  };
}

// ── Validación en el servidor ────────────────────────────────────────────────
export interface MovimientoMpEntrada { tipo: string; fecha: string; monto: number; nota: string | null }
export type MovimientoMpValidado = { tipo: TipoMovimientoMp; fecha: string; monto: number; nota: string | null };

export function validarMovimientoMp(e: MovimientoMpEntrada, hoy: string): { valor: MovimientoMpValidado } | { error: string } {
  if (!(TIPOS_MOVIMIENTO_MP as readonly string[]).includes(e.tipo)) return { error: "Tipo de movimiento inválido" };
  const tipo = e.tipo as TipoMovimientoMp;
  if (!fechaValida(e.fecha)) return { error: "La fecha no es válida" };
  if (e.fecha > hoy) return { error: "La fecha no puede ser futura" };
  if (typeof e.monto !== "number" || !Number.isFinite(e.monto)) return { error: "El monto no es válido" };
  if (e.monto > MONTO_MAX) return { error: "El monto es demasiado grande" };
  const monto = redondearMoneda(e.monto);
  if (tipo === "retiro" && monto <= 0) return { error: "El monto del retiro tiene que ser mayor a cero" };
  if (tipo === "saldo_inicial" && monto < 0) return { error: "El saldo inicial no puede ser negativo" };
  const nota = (e.nota ?? "").trim();
  if (nota.length > 200) return { error: "La nota es demasiado larga (máximo 200 caracteres)" };
  if (tipo === "retiro" && nota.length < 3) return { error: "Escribí a dónde fue la plata (por ejemplo: «pasé a Brubank»)" };
  return { valor: { tipo, fecha: e.fecha, monto, nota: nota || null } };
}
