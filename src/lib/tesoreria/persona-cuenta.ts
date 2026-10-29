// Cuenta corriente de una persona con la empresa (migración 129). Funciones puras: reciben filas ya leídas.
//
//     debe = saldo inicial + adelantos − reposiciones − descuentos de sueldo
//
// Solo cuentan los movimientos desde el día del saldo inicial en adelante (el saldo inicial ya trae todo lo anterior).
// Un saldo negativo es plata a favor de la persona (repuso de más).
// Qué mueve plata: un adelanto o una reposición con origen «efectivo de Tesorería» o «Mercado Pago» mueve esa cuenta; con
// «transferencia» no (no se llevan bancos). El saldo inicial y el descuento de sueldo no mueven ninguna cuenta.

import { redondearMoneda } from "@/lib/pedidos/pricing";
import { MONTO_MAX, fechaValida } from "./validaciones";

export const TIPOS_MOVIMIENTO_PERSONA = ["saldo_inicial", "adelanto", "reposicion", "descuento_sueldo"] as const;
export type TipoMovimientoPersona = (typeof TIPOS_MOVIMIENTO_PERSONA)[number];

export const ORIGENES_PERSONA = ["efectivo_tesoreria", "mercadopago", "transferencia"] as const;
export type OrigenPersona = (typeof ORIGENES_PERSONA)[number];

export const ETIQUETA_TIPO_PERSONA: Record<TipoMovimientoPersona, string> = {
  saldo_inicial:    "Saldo inicial",
  adelanto:         "Adelanto",
  reposicion:       "Reposición",
  descuento_sueldo: "Descuento de sueldo",
};
export const ETIQUETA_ORIGEN_PERSONA: Record<OrigenPersona, string> = {
  efectivo_tesoreria: "efectivo de Tesorería",
  mercadopago:        "Mercado Pago",
  transferencia:      "transferencia",
};

export interface MovimientoPersona {
  id: string; persona_id: string; tipo: TipoMovimientoPersona; fecha: string; monto: number;
  origen: OrigenPersona | null; nota: string | null; created_at: string; created_by: string | null;
}

export interface CuentaPersona {
  desde:         string | null;   // fecha del saldo inicial (null = sin saldo inicial: cuenta todo)
  saldoInicial:  number;
  adelantos:     number;
  reposiciones:  number;
  descuentos:    number;
  debe:          number;          // saldoInicial + adelantos − reposiciones − descuentos (negativo = a favor de la persona)
}

export function calcularCuentaPersona(movimientos: MovimientoPersona[]): CuentaPersona {
  const inicial = movimientos.find((m) => m.tipo === "saldo_inicial") ?? null;
  const desde = inicial?.fecha ?? null;
  const suma = (tipo: TipoMovimientoPersona) =>
    movimientos.filter((m) => m.tipo === tipo && (desde === null || m.fecha >= desde)).reduce((s, m) => s + m.monto, 0);
  const saldoInicial = inicial?.monto ?? 0;
  const adelantos = suma("adelanto"), reposiciones = suma("reposicion"), descuentos = suma("descuento_sueldo");
  return {
    desde,
    saldoInicial: redondearMoneda(saldoInicial),
    adelantos:    redondearMoneda(adelantos),
    reposiciones: redondearMoneda(reposiciones),
    descuentos:   redondearMoneda(descuentos),
    debe:         redondearMoneda(saldoInicial + adelantos - reposiciones - descuentos),
  };
}

// ── Validación en el servidor ────────────────────────────────────────────────
export interface MovimientoPersonaEntrada {
  persona_id: string; tipo: string; fecha: string; monto: number; origen?: string | null; nota: string | null;
}
export type MovimientoPersonaValidado = {
  persona_id: string; tipo: TipoMovimientoPersona; fecha: string; monto: number; origen: OrigenPersona | null; nota: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarMovimientoPersona(e: MovimientoPersonaEntrada, hoy: string): { valor: MovimientoPersonaValidado } | { error: string } {
  if (typeof e.persona_id !== "string" || !UUID_RE.test(e.persona_id)) return { error: "Elegí la persona" };
  if (!(TIPOS_MOVIMIENTO_PERSONA as readonly string[]).includes(e.tipo)) return { error: "Tipo de movimiento inválido" };
  const tipo = e.tipo as TipoMovimientoPersona;
  if (!fechaValida(e.fecha)) return { error: "La fecha no es válida" };
  if (e.fecha > hoy) return { error: "La fecha no puede ser futura" };
  if (typeof e.monto !== "number" || !Number.isFinite(e.monto)) return { error: "El monto no es válido" };
  if (e.monto > MONTO_MAX) return { error: "El monto es demasiado grande" };
  const monto = redondearMoneda(e.monto);
  if (tipo === "saldo_inicial" && monto < 0) return { error: "El saldo inicial no puede ser negativo" };
  if (tipo !== "saldo_inicial" && monto <= 0) return { error: "El monto tiene que ser mayor a cero" };

  let origen: OrigenPersona | null = null;
  if (tipo === "adelanto" || tipo === "reposicion") {
    origen = ORIGENES_PERSONA.find((o) => o === e.origen) ?? null;
    if (!origen) return { error: tipo === "adelanto" ? "Indicá de dónde salió la plata" : "Indicá adónde entró la plata" };
  }

  const nota = (e.nota ?? "").trim();
  if (nota.length > 200) return { error: "La nota es demasiado larga (máximo 200 caracteres)" };
  return { valor: { persona_id: e.persona_id, tipo, fecha: e.fecha, monto, origen, nota: nota || null } };
}
