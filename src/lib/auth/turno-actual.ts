import type { createAdminClient } from "@/lib/supabase/server";

// "Tenedor actual" del turno: quien lo tiene en custodia AHORA -- el
// recibido_por del último traspasos_caja de esta apertura, o quien la abrió
// si todavía no hubo ningún traspaso (ver migración 083). Misma derivación
// que hace registrar_traspaso_caja server-side para entregado_por --
// centralizado acá porque cierre-actions.ts y sucursales/[id]/page.tsx
// necesitan el mismo cálculo.
export async function obtenerTenedorActual(
  admin: ReturnType<typeof createAdminClient>,
  aperturaId: string,
  fallbackCreatedBy: string | null
): Promise<string | null> {
  const { data } = await (admin as any)
    .from("traspasos_caja")
    .select("recibido_por")
    .eq("apertura_id", aperturaId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.recibido_por ?? fallbackCreatedBy;
}
