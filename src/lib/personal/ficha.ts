// Ficha (legajo) del personal y de los socios (migración 130). Funciones puras: validación, qué cambió y qué falta completar.
// Los valores tienen que coincidir con los CHECK de la tabla `personal_ficha`. Todo es opcional: nada bloquea vender, cargar ni pagar.

import { validateCuit } from "@/lib/utils";
import { fechaValida, MONTO_MAX } from "@/lib/tesoreria/validaciones";

export const ESTADOS_CIVILES = [
  { valor: "soltero", etiqueta: "Soltero/a" },
  { valor: "casado", etiqueta: "Casado/a" },
  { valor: "union_convivencial", etiqueta: "Unión convivencial" },
  { valor: "divorciado", etiqueta: "Divorciado/a" },
  { valor: "viudo", etiqueta: "Viudo/a" },
] as const;

export const REGISTROS = [
  { valor: "registrado", etiqueta: "Registrado (en blanco)" },
  { valor: "no_registrado", etiqueta: "No registrado" },
] as const;

export const JORNADAS = [
  { valor: "completa", etiqueta: "Jornada completa" },
  { valor: "media", etiqueta: "Media jornada" },
  { valor: "otra", etiqueta: "Otra" },
] as const;

export const FORMAS_PAGO_PERSONAL = [
  { valor: "efectivo_tesoreria", etiqueta: "Efectivo" },
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "mercadopago", etiqueta: "Mercado Pago" },
] as const;

export const etiquetaDe = (lista: readonly { valor: string; etiqueta: string }[], v: string | null) =>
  v ? lista.find((x) => x.valor === v)?.etiqueta ?? v : null;

// Lo que se guarda de una persona (todas las columnas de personal_ficha menos las de auditoría).
export interface FichaPersonal {
  legajo: string | null; cuil: string | null; fecha_nacimiento: string | null; estado_civil: string | null; nacionalidad: string | null;
  domicilio: string | null; localidad: string | null; email_personal: string | null;
  emergencia_nombre: string | null; emergencia_vinculo: string | null; emergencia_telefono: string | null;
  puesto: string | null; fecha_ingreso: string | null; fecha_egreso: string | null; motivo_egreso: string | null;
  registro: string | null; fecha_alta_registro: string | null; jornada: string | null; horas_semanales: number | null; turno_habitual: string | null;
  convenio: string | null; categoria: string | null; obra_social: string | null;
  sueldo_acordado: number | null; sueldo_en_recibo: number | null; dia_pago: number | null; forma_pago: string | null;
  banco: string | null; cbu_alias: string | null; titular_cuenta: string | null; tope_descuento_pct: number | null;
  notas: string | null;
}

export const CAMPOS_FICHA = [
  "legajo", "cuil", "fecha_nacimiento", "estado_civil", "nacionalidad", "domicilio", "localidad", "email_personal",
  "emergencia_nombre", "emergencia_vinculo", "emergencia_telefono",
  "puesto", "fecha_ingreso", "fecha_egreso", "motivo_egreso", "registro", "fecha_alta_registro", "jornada", "horas_semanales", "turno_habitual",
  "convenio", "categoria", "obra_social",
  "sueldo_acordado", "sueldo_en_recibo", "dia_pago", "forma_pago", "banco", "cbu_alias", "titular_cuenta", "tope_descuento_pct", "notas",
] as const satisfies readonly (keyof FichaPersonal)[];

export const FICHA_VACIA: FichaPersonal = Object.fromEntries(CAMPOS_FICHA.map((c) => [c, null])) as unknown as FichaPersonal;

// Lo que manda el formulario: texto en los campos de texto y de fecha, número o null en los numéricos. Nada se confía: la acción lo valida.
export type FichaEntrada = {
  [K in keyof FichaPersonal]?: FichaPersonal[K] | string | number | null;
};

const LARGO: Partial<Record<keyof FichaPersonal, [number, string]>> = {
  legajo: [20, "El legajo"], nacionalidad: [60, "La nacionalidad"], domicilio: [160, "El domicilio"], localidad: [80, "La localidad"],
  email_personal: [120, "El email"], emergencia_nombre: [120, "El contacto de emergencia"], emergencia_vinculo: [60, "El vínculo"],
  emergencia_telefono: [40, "El teléfono de emergencia"], puesto: [80, "El puesto"], motivo_egreso: [200, "El motivo de egreso"],
  turno_habitual: [120, "El turno"], convenio: [120, "El convenio"], categoria: [120, "La categoría"], obra_social: [120, "La obra social"],
  banco: [80, "El banco"], titular_cuenta: [120, "El titular"], notas: [500, "Las notas"],
};
const TEXTOS = Object.keys(LARGO) as (keyof FichaPersonal)[];
const FECHAS = ["fecha_nacimiento", "fecha_ingreso", "fecha_egreso", "fecha_alta_registro"] as const;
const ETIQUETA_FECHA: Record<(typeof FECHAS)[number], string> = {
  fecha_nacimiento: "La fecha de nacimiento", fecha_ingreso: "La fecha de ingreso", fecha_egreso: "La fecha de egreso", fecha_alta_registro: "La fecha de alta registrada",
};

// CBU: 22 dígitos. Alias: 6 a 20 caracteres (letras, números, punto y guion).
export function normalizarCbuAlias(v: string | null | undefined): string | null | "invalido" {
  const t = (v ?? "").replace(/\s+/g, "");
  if (!t) return null;
  if (/^\d+$/.test(t)) return t.length === 22 ? t : "invalido";
  return /^[a-z0-9.\-]{6,20}$/i.test(t) ? t : "invalido";
}

export function validarFichaPersonal(e: FichaEntrada): { valor: FichaPersonal } | { error: string } {
  const v: Record<string, string | number | null> = {};

  for (const c of TEXTOS) {
    const t = String(e[c] ?? "").trim().replace(/\s+/g, " ");
    const [max, nombre] = LARGO[c]!;
    if (t.length > max) return { error: `${nombre} es demasiado largo (máximo ${max} caracteres)` };
    v[c] = t || null;
  }
  if (v.email_personal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email_personal as string)) return { error: "El email no es válido" };

  const cuilTexto = String(e.cuil ?? "").trim();
  if (!cuilTexto) v.cuil = null;
  else if (!validateCuit(cuilTexto)) return { error: "El CUIL no es válido: revisá los 11 dígitos" };
  else v.cuil = cuilTexto.replace(/\D/g, "");

  for (const c of FECHAS) {
    const t = String(e[c] ?? "").trim();
    if (!t) { v[c] = null; continue; }
    if (!fechaValida(t) || t < "1900-01-01" || t > "2100-12-31") return { error: `${ETIQUETA_FECHA[c]} no es válida` };
    v[c] = t;
  }
  if (v.fecha_egreso && v.fecha_ingreso && (v.fecha_egreso as string) < (v.fecha_ingreso as string)) return { error: "La fecha de egreso no puede ser anterior a la de ingreso" };

  const elegir = (c: "estado_civil" | "registro" | "jornada" | "forma_pago", lista: readonly { valor: string }[], nombre: string): string | null => {
    const t = String(e[c] ?? "").trim();
    if (!t) return null;
    if (!lista.some((x) => x.valor === t)) throw new Error(`${nombre} no es válido`);
    return t;
  };
  try {
    v.estado_civil = elegir("estado_civil", ESTADOS_CIVILES, "El estado civil");
    v.registro = elegir("registro", REGISTROS, "La condición de registro");
    v.jornada = elegir("jornada", JORNADAS, "La jornada");
    v.forma_pago = elegir("forma_pago", FORMAS_PAGO_PERSONAL, "La forma de pago");
  } catch (err) {
    return { error: (err as Error).message };
  }

  const numero = (c: keyof FichaPersonal): number | null | "invalido" => {
    const x = e[c];
    if (x === null || x === undefined || x === "") return null;
    const n = typeof x === "number" ? x : Number(String(x).replace(",", "."));
    return Number.isFinite(n) ? n : "invalido";
  };
  const horas = numero("horas_semanales");
  if (horas === "invalido" || (horas !== null && (horas <= 0 || horas > 60))) return { error: "Las horas semanales tienen que estar entre 1 y 60" };
  v.horas_semanales = horas === null ? null : Math.round(horas * 10) / 10;

  const dia = numero("dia_pago");
  if (dia === "invalido" || (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31))) return { error: "El día de pago tiene que ser un número entero entre 1 y 31" };
  v.dia_pago = dia;

  const tope = numero("tope_descuento_pct");
  if (tope === "invalido" || (tope !== null && (tope < 0 || tope > 100))) return { error: "El tope de descuento es un porcentaje entre 0 y 100" };
  v.tope_descuento_pct = tope === null ? null : Math.round(tope * 100) / 100;

  for (const c of ["sueldo_acordado", "sueldo_en_recibo"] as const) {
    const n = numero(c);
    if (n === "invalido" || (n !== null && (n < 0 || n > MONTO_MAX))) return { error: `${c === "sueldo_acordado" ? "El sueldo acordado" : "El sueldo en recibo"} no es válido` };
    v[c] = n === null ? null : Math.round(n * 100) / 100;
  }
  if (v.sueldo_acordado !== null && v.sueldo_en_recibo !== null && (v.sueldo_en_recibo as number) > (v.sueldo_acordado as number)) {
    return { error: "El sueldo en recibo no puede ser mayor que el sueldo acordado" };
  }

  const cbu = normalizarCbuAlias(e.cbu_alias as string | null | undefined);
  if (cbu === "invalido") return { error: "El CBU tiene que tener 22 dígitos, o el alias entre 6 y 20 caracteres (letras, números, punto y guion)" };
  v.cbu_alias = cbu;

  return { valor: v as unknown as FichaPersonal };
}

// Qué campos cambiaron (para el Historial): { campo: { antes, despues } }.
export function cambiosDeFicha(
  antes: Partial<Record<keyof FichaPersonal, unknown>> | null, despues: FichaPersonal,
): Record<string, { antes: string | number | null; despues: string | number | null }> {
  const cambios: Record<string, { antes: string | number | null; despues: string | number | null }> = {};
  for (const c of CAMPOS_FICHA) {
    const a = antes?.[c];
    // numeric de Postgres llega como texto ("1000.00"): se compara como número.
    const ant = a === undefined || a === null ? null : typeof despues[c] === "number" ? Number(a) : (a as string | number);
    const des = despues[c] ?? null;
    if (ant !== des) cambios[c] = { antes: ant as string | number | null, despues: des };
  }
  return cambios;
}

// Qué le falta a la ficha para poder liquidar y pagar. Si está registrada, además lo del alta.
export function faltantesDeFicha(f: FichaPersonal): string[] {
  const falta: string[] = [];
  const pedir = (ok: boolean, nombre: string) => { if (!ok) falta.push(nombre); };
  pedir(!!f.cuil, "CUIL");
  pedir(!!f.fecha_ingreso, "fecha de ingreso");
  pedir(!!f.jornada, "jornada");
  pedir(f.sueldo_acordado !== null, "sueldo acordado");
  pedir(!!f.forma_pago, "forma de pago");
  if (f.forma_pago === "transferencia") pedir(!!f.cbu_alias, "CBU o alias");
  if (f.registro === "registrado") {
    pedir(!!f.fecha_alta_registro, "fecha de alta registrada");
    pedir(!!f.convenio, "convenio");
    pedir(!!f.categoria, "categoría");
    pedir(f.sueldo_en_recibo !== null, "sueldo en recibo");
  }
  return falta;
}
