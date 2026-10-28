import type { createAdminClient } from "@/lib/supabase/server";

// Radio máximo de una zona de envío (migración 128). Sin "use server". Tolerante: si la columna todavía no existe o
// falla la lectura, devuelve null = sin límite (el pedido no se bloquea por esto).

type Admin = ReturnType<typeof createAdminClient>;

export async function leerRadioZona(admin: Admin, zonaId: string): Promise<number | null> {
  const { data, error } = await (admin as any).from("zonas_entrega").select("radio_km").eq("id", zonaId).maybeSingle();
  if (error || data?.radio_km === null || data?.radio_km === undefined) return null;
  const n = Number(data.radio_km);
  return Number.isFinite(n) && n > 0 ? n : null;
}
