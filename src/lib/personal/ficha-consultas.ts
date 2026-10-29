// Lecturas de la ficha del personal (migración 130). Cliente admin: quien llama ya verificó el
// permiso. La tabla nueva todavía no está en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
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
