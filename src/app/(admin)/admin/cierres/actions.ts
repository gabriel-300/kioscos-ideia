"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

// El tesorero/socio verifica cuánto contó del sobre que le entregaron. Queda
// registrado quién verificó automáticamente (el usuario logueado -- Damián,
// Javier o Gabriel, todos con su propia cuenta admin), no hace falta elegirlo
// de una lista.
export async function verificarSobre(cierreId: string, data: { montoVerificado: number; notas: string | null }) {
  await requireAdmin();
  const admin = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await (admin as any)
    .from("cierres_caja")
    .update({
      sobre_monto_verificado: data.montoVerificado,
      sobre_verificado_por:   user?.id ?? null,
      sobre_verificado_en:    new Date().toISOString(),
      sobre_notas:            data.notas,
    })
    .eq("id", cierreId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/cierres");
}
