// Lecturas de la cuenta corriente de las personas (migración 129). Cliente admin: quien llama ya verificó el permiso.
// La tabla nueva todavía no está en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { calcularCuentaPersona, type CuentaPersona, type FiadoDeLaPersona, type MovimientoPersona, type OrigenPersona, type TipoMovimientoPersona } from "./persona-cuenta";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = (admin: Admin, nombre: string) => (admin as any).from(nombre);

export const esTablaPersonaFaltante = (m: string) => m.includes("persona_cuenta") && /does not exist|schema cache|no existe/i.test(m);

export interface PersonaConCuenta {
  id:          string;
  nombre:      string;
  esSocio:     boolean;
  cuenta:      CuentaPersona;
  movimientos: MovimientoPersona[];   // los más nuevos primero
}

// El fiado del personal en los kioscos (ventas con canal «cuenta_corriente», sin anuladas, a precio de venta) y los pagos que se cargaron en la
// Cta. Corriente del kiosco, por persona. Es la «mercadería retirada» de la cuenta: se lee de acá y no se copia a persona_cuenta.
// `desde`: la fecha más vieja que hace falta (la del saldo inicial más antigua); `personaId`: una sola persona.
export async function cargarFiadoPorPersona(admin: Admin, desde: string | null, personaId?: string): Promise<Map<string, FiadoDeLaPersona>> {
  const porPersona = new Map<string, FiadoDeLaPersona>();
  if (desde === null) return porPersona;   // sin saldo inicial no hay mercadería que contar
  const dePersona = (id: string) => porPersona.get(id) ?? porPersona.set(id, { ventas: [], pagos: [] }).get(id)!;
  const [ventas, pagos] = await Promise.all([
    fetchAll<{ personal_id: string; fecha: string; movimiento_items: { subtotal: number | string | null }[] | null }>((d, h) => {
      let q = tabla(admin, "movimientos").select("id, personal_id, fecha, movimiento_items(subtotal)", { count: "exact" })
        .eq("tipo", "venta").eq("canal", "cuenta_corriente").is("anulado_en", null).not("personal_id", "is", null).gte("fecha", desde);
      if (personaId) q = q.eq("personal_id", personaId);
      return q.order("id").range(d, h);
    }),
    fetchAll<{ personal_id: string; fecha: string; monto: number | string }>((d, h) => {
      let q = tabla(admin, "cta_corriente_pagos").select("id, personal_id, fecha, monto", { count: "exact" }).not("personal_id", "is", null).gte("fecha", desde);
      if (personaId) q = q.eq("personal_id", personaId);
      return q.order("id").range(d, h);
    }),
  ]);
  for (const v of ventas) dePersona(v.personal_id).ventas.push({ fecha: String(v.fecha).slice(0, 10), monto: (v.movimiento_items ?? []).reduce((t, i) => t + Number(i.subtotal ?? 0), 0) });
  for (const p of pagos) dePersona(p.personal_id).pagos.push({ fecha: String(p.fecha).slice(0, 10), monto: Number(p.monto) });
  return porPersona;
}

// La fecha más vieja desde la que hay que leer el fiado: el saldo inicial más antiguo o, si es más viejo, el arranque de Tesorería.
const desdeMasViejo = (movs: MovimientoPersona[], desdeTesoreria: string | null) =>
  [...movs.filter((m) => m.tipo === "saldo_inicial").map((m) => m.fecha), ...(desdeTesoreria ? [desdeTesoreria] : [])].sort()[0] ?? null;

// Los socios (aunque no tengan movimientos) y cualquier otra persona que tenga algo en su cuenta.
// `tolerarSinTabla`: el Resumen no se rompe si la migración 129 todavía no está aplicada (sin personas).
// `desdeTesoreria`: arranque de Tesorería; sin saldo inicial, la mercadería de cada persona cuenta desde ahí.
export async function cargarCuentasPersonas(admin: Admin, tolerarSinTabla = false, desdeTesoreria: string | null = null): Promise<PersonaConCuenta[]> {
  let filas: Record<string, unknown>[];
  try {
    filas = await fetchAll<Record<string, unknown>>((d, h) =>
      tabla(admin, "persona_cuenta").select("id, persona_id, tipo, fecha, monto, origen, nota, created_at, created_by", { count: "exact" })
        .is("anulado_en", null).order("id").range(d, h));
  } catch (e) {
    if (tolerarSinTabla && e instanceof Error && esTablaPersonaFaltante(e.message)) return [];
    throw e;
  }

  const movimientos: MovimientoPersona[] = filas.map((f) => ({
    id: String(f.id), persona_id: String(f.persona_id), tipo: f.tipo as TipoMovimientoPersona, fecha: String(f.fecha), monto: Number(f.monto),
    origen: (f.origen as OrigenPersona | null) ?? null, nota: (f.nota as string | null) ?? null,
    created_at: String(f.created_at), created_by: (f.created_by as string | null) ?? null,
  }));
  const porPersona = new Map<string, MovimientoPersona[]>();
  for (const m of movimientos) porPersona.set(m.persona_id, [...(porPersona.get(m.persona_id) ?? []), m]);

  // Cualquier persona con fiado desde el arranque también tiene cuenta, aunque nunca se le haya cargado un movimiento.
  const fiado = await cargarFiadoPorPersona(admin, desdeMasViejo(movimientos, desdeTesoreria));
  const { data: socios, error } = await admin.from("profiles").select("id, full_name").eq("es_socio", true);
  if (error) throw new Error(error.message);
  const ids = new Set<string>([...(socios ?? []).map((s) => s.id), ...porPersona.keys(), ...fiado.keys()]);
  const otros = [...ids].filter((id) => !(socios ?? []).some((s) => s.id === id));
  const nombres = new Map<string, string>((socios ?? []).map((s) => [s.id, s.full_name?.trim() || "Sin nombre"]));
  if (otros.length > 0) {
    const { data, error: e2 } = await admin.from("profiles").select("id, full_name").in("id", otros);
    if (e2) throw new Error(e2.message);
    for (const p of data ?? []) nombres.set(p.id, p.full_name?.trim() || "Sin nombre");
  }
  const sociosIds = new Set((socios ?? []).map((s) => s.id));

  return [...ids].map((id) => {
    const movs = (porPersona.get(id) ?? []).sort((a, b) => (a.fecha === b.fecha ? b.created_at.localeCompare(a.created_at) : b.fecha.localeCompare(a.fecha)));
    return { id, nombre: nombres.get(id) ?? "Sin nombre", esSocio: sociosIds.has(id), cuenta: calcularCuentaPersona(movs, fiado.get(id), desdeTesoreria), movimientos: movs };
  }).sort((a, b) => Number(b.esSocio) - Number(a.esSocio) || a.nombre.localeCompare(b.nombre, "es"));
}

// Adelantos y reposiciones que mueven una cuenta (efectivo de Tesorería o Mercado Pago) desde la fecha en que esa cuenta arrancó.
// Sin la migración 129 no hay nada que sumar: devuelve vacío. Cualquier otro error se propaga (un saldo de menos sería peor que un aviso).
export async function cargarFlujosPersonas(
  admin: Admin, origen: "efectivo_tesoreria" | "mercadopago", desde: string,
): Promise<{ adelantos: number; reposiciones: number }> {
  try {
    const filas = await fetchAll<{ tipo: string; monto: number | string }>((d, h) =>
      tabla(admin, "persona_cuenta").select("tipo, monto", { count: "exact" })
        .in("tipo", ["adelanto", "reposicion"]).eq("origen", origen).is("anulado_en", null).gte("fecha", desde)
        .order("id").range(d, h));
    let adelantos = 0, reposiciones = 0;
    for (const f of filas) { if (f.tipo === "adelanto") adelantos += Number(f.monto); else reposiciones += Number(f.monto); }
    return { adelantos, reposiciones };
  } catch (e) {
    if (e instanceof Error && esTablaPersonaFaltante(e.message)) return { adelantos: 0, reposiciones: 0 };
    throw e;
  }
}

// La cuenta de una sola persona (para su ficha). `null` si la migración 129 todavía no está aplicada o la persona no existe.
export async function cargarCuentaDePersona(admin: Admin, personaId: string, desdeTesoreria: string | null = null): Promise<PersonaConCuenta | null> {
  let filas: Record<string, unknown>[];
  try {
    filas = await fetchAll<Record<string, unknown>>((d, h) =>
      tabla(admin, "persona_cuenta").select("id, persona_id, tipo, fecha, monto, origen, nota, created_at, created_by", { count: "exact" })
        .eq("persona_id", personaId).is("anulado_en", null).order("id").range(d, h));
  } catch (e) {
    if (e instanceof Error && esTablaPersonaFaltante(e.message)) return null;
    throw e;
  }
  const { data: perfil, error } = await admin.from("profiles").select("id, full_name, es_socio").eq("id", personaId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!perfil) return null;
  const movs: MovimientoPersona[] = filas.map((f) => ({
    id: String(f.id), persona_id: String(f.persona_id), tipo: f.tipo as TipoMovimientoPersona, fecha: String(f.fecha), monto: Number(f.monto),
    origen: (f.origen as OrigenPersona | null) ?? null, nota: (f.nota as string | null) ?? null,
    created_at: String(f.created_at), created_by: (f.created_by as string | null) ?? null,
  })).sort((a, b) => (a.fecha === b.fecha ? b.created_at.localeCompare(a.created_at) : b.fecha.localeCompare(a.fecha)));
  const fiado = await cargarFiadoPorPersona(admin, desdeMasViejo(movs, desdeTesoreria), personaId);
  return { id: perfil.id, nombre: perfil.full_name?.trim() || "Sin nombre", esSocio: !!perfil.es_socio, cuenta: calcularCuentaPersona(movs, fiado.get(personaId), desdeTesoreria), movimientos: movs };
}
