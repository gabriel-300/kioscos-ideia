// Ficha contable del proveedor (migración 116). Funciones puras: validación, nombres parecidos y qué falta completar.
// Los valores tienen que coincidir con los CHECK de la tabla `proveedores`.

import { validateCuit } from "@/lib/utils";

export const CONDICIONES_IVA = [
  { valor: "responsable_inscripto", etiqueta: "Responsable inscripto" },
  { valor: "monotributo",           etiqueta: "Monotributo" },
  { valor: "exento",                etiqueta: "Exento" },
  { valor: "no_responsable",        etiqueta: "No responsable" },
] as const;

export const DA_FACTURA = [
  { valor: "siempre", etiqueta: "Siempre" },
  { valor: "a_veces", etiqueta: "A veces" },
  { valor: "nunca",   etiqueta: "Nunca" },
] as const;

export const RUBROS = [
  { valor: "mercaderia", etiqueta: "Mercadería" },
  { valor: "servicios",  etiqueta: "Servicios" },
  { valor: "alquiler",   etiqueta: "Alquiler" },
  { valor: "otro",       etiqueta: "Otro" },
] as const;

// Cómo se le suele pagar (el retiro de caja no es una forma de pago de Tesorería).
export const FORMAS_PAGO = [
  { valor: "efectivo_tesoreria", etiqueta: "Efectivo" },
  { valor: "transferencia",      etiqueta: "Transferencia" },
  { valor: "mercadopago",        etiqueta: "Mercado Pago" },
] as const;

export const etiquetaDe = (lista: readonly { valor: string; etiqueta: string }[], v: string | null) =>
  v ? lista.find((x) => x.valor === v)?.etiqueta ?? v : null;

// Lo que se guarda de un proveedor para la contabilidad (todo opcional salvo el nombre).
export interface FichaProveedor {
  id:              string;
  nombre:          string;
  is_active:       boolean;
  razon_social:    string | null;
  cuit:            string | null;
  condicion_iva:   string | null;
  da_factura:      string | null;
  rubro:           string | null;
  forma_pago:      string | null;
  plazo_pago_dias: number | null;
  alias_cbu:       string | null;
  contacto:        string | null;   // teléfono u otro contacto (columna que ya existía)
  email:           string | null;
  notas:           string | null;
}

// Lo que manda el formulario. Nada se confía: la acción lo valida de nuevo.
export interface FichaEntrada {
  nombre:          string;
  razon_social?:   string | null;
  cuit?:           string | null;
  condicion_iva?:  string | null;
  da_factura?:     string | null;
  rubro?:          string | null;
  forma_pago?:     string | null;
  plazo_pago_dias?: number | null;
  alias_cbu?:      string | null;
  contacto?:       string | null;
  email?:          string | null;
  notas?:          string | null;
}

export type FichaValidada = Omit<FichaProveedor, "id" | "is_active">;

const texto = (v: string | null | undefined, max: number): string | null | "largo" => {
  const t = (v ?? "").trim();
  if (!t) return null;
  return t.length > max ? "largo" : t;
};

export const soloDigitos = (cuit: string) => cuit.replace(/\D/g, "");

// CUIT con guiones o sin ellos → 11 dígitos. null = vacío; "invalido" = no pasa el dígito verificador.
export function normalizarCuit(cuit: string | null | undefined): string | null | "invalido" {
  const t = (cuit ?? "").trim();
  if (!t) return null;
  return validateCuit(t) ? soloDigitos(t) : "invalido";
}

export function validarFicha(e: FichaEntrada): { valor: FichaValidada } | { error: string } {
  const nombre = (e.nombre ?? "").trim().replace(/\s+/g, " ");
  if (!nombre) return { error: "Escribí el nombre del proveedor" };
  if (nombre.length > 120) return { error: "El nombre es demasiado largo (máximo 120 caracteres)" };

  const cuit = normalizarCuit(e.cuit);
  if (cuit === "invalido") return { error: "El CUIT no es válido: revisá los 11 dígitos" };

  const elegir = (v: string | null | undefined, lista: readonly { valor: string }[]): string | null | "invalido" => {
    const t = (v ?? "").trim();
    if (!t) return null;
    return lista.some((x) => x.valor === t) ? t : "invalido";
  };
  const condicion = elegir(e.condicion_iva, CONDICIONES_IVA);
  const factura   = elegir(e.da_factura, DA_FACTURA);
  const rubro     = elegir(e.rubro, RUBROS);
  const forma     = elegir(e.forma_pago, FORMAS_PAGO);
  if (condicion === "invalido") return { error: "La condición frente al IVA no es válida" };
  if (factura === "invalido")   return { error: "La opción «da factura» no es válida" };
  if (rubro === "invalido")     return { error: "El rubro no es válido" };
  if (forma === "invalido")     return { error: "La forma de pago no es válida" };

  let plazo: number | null = null;
  if (e.plazo_pago_dias !== null && e.plazo_pago_dias !== undefined) {
    if (!Number.isInteger(e.plazo_pago_dias) || e.plazo_pago_dias < 0 || e.plazo_pago_dias > 365) {
      return { error: "El plazo de pago tiene que ser un número entero de días entre 0 y 365" };
    }
    plazo = e.plazo_pago_dias;
  }

  const razon = texto(e.razon_social, 160);
  const alias = texto(e.alias_cbu, 60);
  const contacto = texto(e.contacto, 120);
  const email = texto(e.email, 120);
  const notas = texto(e.notas, 500);
  if (razon === "largo") return { error: "La razón social es demasiado larga" };
  if (alias === "largo") return { error: "El alias o CBU es demasiado largo" };
  if (contacto === "largo") return { error: "El contacto es demasiado largo" };
  if (email === "largo") return { error: "El email es demasiado largo" };
  if (notas === "largo") return { error: "Las notas son demasiado largas (máximo 500 caracteres)" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "El email no es válido" };

  return {
    valor: {
      nombre, razon_social: razon, cuit, condicion_iva: condicion, da_factura: factura, rubro, forma_pago: forma,
      plazo_pago_dias: plazo, alias_cbu: alias, contacto, email, notas,
    },
  };
}

// ── Nombres parecidos (para no duplicar «petri», «Panadería Petri», «PETRI») ─────────────────────
// Sin tildes, sin mayúsculas y sin espacios ni signos.
export const normalizarNombre = (n: string) =>
  n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function nombresParecidos(
  nombre: string, existentes: { id: string; nombre: string }[], excluirId?: string,
): { iguales: { id: string; nombre: string }[]; parecidos: { id: string; nombre: string }[] } {
  const n = normalizarNombre(nombre);
  const iguales: { id: string; nombre: string }[] = [];
  const parecidos: { id: string; nombre: string }[] = [];
  if (!n) return { iguales, parecidos };
  for (const p of existentes) {
    if (p.id === excluirId) continue;
    const m = normalizarNombre(p.nombre);
    if (!m) continue;
    if (m === n) iguales.push(p);
    else if (Math.min(m.length, n.length) >= 4 && (m.includes(n) || n.includes(m))) parecidos.push(p);
  }
  return { iguales, parecidos };
}

// ── Qué le falta a la ficha para la contabilidad ────────────────────────────────────────────────
export const CAMPOS_CONTABLES = [
  { clave: "cuit",            etiqueta: "CUIT" },
  { clave: "condicion_iva",   etiqueta: "condición de IVA" },
  { clave: "da_factura",      etiqueta: "si da factura" },
  { clave: "forma_pago",      etiqueta: "forma de pago" },
  { clave: "plazo_pago_dias", etiqueta: "plazo de pago" },
] as const;

export function faltantes(f: Pick<FichaProveedor, "cuit" | "condicion_iva" | "da_factura" | "forma_pago" | "plazo_pago_dias" | "da_factura">): string[] {
  return CAMPOS_CONTABLES.filter((c) => f[c.clave] === null || f[c.clave] === undefined).map((c) => c.etiqueta);
}
