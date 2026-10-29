// Lecturas de la cuenta corriente de las personas (migración 129). Cliente admin: quien llama ya verificó el permiso.
// La tabla nueva todavía no está en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { calcularCuentaPersona, type CuentaPersona, type MovimientoPersona, type OrigenPersona, type TipoMovimientoPersona } from "./persona-cuenta";

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

// Los socios (aunque no tengan movimientos) y cualquier otra persona que tenga algo en su cuenta.
// `tolerarSinTabla`: el Resumen no se rompe si la migración 129 todavía no está aplicada (sin personas).
export async function cargarCuentasPersonas(admin: Admin, tolerarSinTabla = false): Promise<PersonaConCuenta[]> {
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

  const { data: socios, error } = await admin.from("profiles").select("id, full_name").eq("es_socio", true);
  if (error) throw new Error(error.message);
  const ids = new Set<string>([...(socios ?? []).map((s) => s.id), ...porPersona.keys()]);
  const otros = [...porPersona.keys()].filter((id) => !(socios ?? []).some((s) => s.id === id));
  const nombres = new Map<string, string>((socios ?? []).map((s) => [s.id, s.full_name?.trim() || "Sin nombre"]));
  if (otros.length > 0) {
    const { data, error: e2 } = await admin.from("profiles").select("id, full_name").in("id", otros);
    if (e2) throw new Error(e2.message);
    for (const p of data ?? []) nombres.set(p.id, p.full_name?.trim() || "Sin nombre");
  }
  const sociosIds = new Set((socios ?? []).map((s) => s.id));

  return [...ids].map((id) => {
    const movs = (porPersona.get(id) ?? []).sort((a, b) => (a.fecha === b.fecha ? b.created_at.localeCompare(a.created_at) : b.fecha.localeCompare(a.fecha)));
    return { id, nombre: nombres.get(id) ?? "Sin nombre", esSocio: sociosIds.has(id), cuenta: calcularCuentaPersona(movs), movimientos: movs };
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
