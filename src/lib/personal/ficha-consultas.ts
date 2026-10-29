// Lecturas de la ficha del personal (migración 130) y del fiado de la persona en los kioscos. Cliente admin: quien llama ya verificó el
// permiso. La tabla nueva todavía no está en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { CAMPOS_FICHA, FICHA_VACIA, type FichaPersonal } from "./ficha";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = (admin: Admin, nombre: string) => (admin as any).from(nombre);

export const esTablaFichaFaltante = (m: string) => m.includes("personal_ficha") && /does not exist|schema cache|no existe/i.test(m);

const NUMERICOS = new Set<string>(["horas_semanales", "sueldo_acordado", "sueldo_en_recibo", "dia_pago", "tope_descuento_pct"]);

// null en cada campo si la persona todavía no tiene ficha. Lanza si la tabla no existe (la pantalla avisa).
export async function cargarFichaPersonal(admin: Admin, personaId: string): Promise<{ ficha: FichaPersonal; existe: boolean; actualizada: string | null }> {
  const { data, error } = await tabla(admin, "personal_ficha").select([...CAMPOS_FICHA, "updated_at", "created_at"].join(", ")).eq("persona_id", personaId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ficha: { ...FICHA_VACIA }, existe: false, actualizada: null };
  const ficha = { ...FICHA_VACIA } as Record<string, string | number | null>;
  for (const c of CAMPOS_FICHA) {
    const v = (data as Record<string, unknown>)[c];
    ficha[c] = v === null || v === undefined ? null : NUMERICOS.has(c) ? Number(v) : String(v);
  }
  return { ficha: ficha as unknown as FichaPersonal, existe: true, actualizada: ((data.updated_at ?? data.created_at) as string | null) ?? null };
}

export interface FiadoPersona { vendido: number; pagado: number; saldo: number; ventas: number }

// Lo que la persona compró fiado en los kioscos (canal «cuenta_corriente», ventas no anuladas) menos lo que ya pagó: es la misma cuenta
// que se ve en Sucursal → Cta. Corriente, sumada entre todos los kioscos.
export async function cargarFiadoPersona(admin: Admin, personaId: string): Promise<FiadoPersona> {
  const [ventas, pagos] = await Promise.all([
    fetchAll<{ movimiento_items: { subtotal: number | string | null }[] | null }>((d, h) =>
      tabla(admin, "movimientos").select("id, movimiento_items(subtotal)", { count: "exact" })
        .eq("personal_id", personaId).eq("tipo", "venta").eq("canal", "cuenta_corriente").is("anulado_en", null).order("id").range(d, h)),
    fetchAll<{ monto: number | string }>((d, h) =>
      tabla(admin, "cta_corriente_pagos").select("monto", { count: "exact" }).eq("personal_id", personaId).order("id").range(d, h)),
  ]);
  const vendido = ventas.reduce((s, v) => s + (v.movimiento_items ?? []).reduce((t, i) => t + Number(i.subtotal ?? 0), 0), 0);
  const pagado = pagos.reduce((s, p) => s + Number(p.monto), 0);
  return { vendido, pagado, saldo: vendido - pagado, ventas: ventas.length };
}
