"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

// El socio que retira el sobre confirma con su propia sesión, en el momento
// en que físicamente lo tiene en la mano (puede ser horas o días después del
// cierre -- el sobre suele quedar en el kiosco hasta el próximo retiro). Antes
// lo "declaraba" el encargado/vendedor del kiosco eligiendo un nombre de una
// lista, lo que permitía marcar a alguien que en los hechos no lo había
// retirado. Ahora nadie puede confirmar el retiro de otro -- solo el propio.
export async function confirmarRetiroSobre(cierreId: string) {
  const { userId } = await requireAdmin();
  const admin = createAdminClient();

  const { data: cierre } = await (admin as any)
    .from("cierres_caja")
    .select("sucursal_id, sobre_retirado_por")
    .eq("id", cierreId)
    .single();
  if (!cierre) throw new Error("Cierre no encontrado");
  if (cierre.sobre_retirado_por) throw new Error("Este sobre ya estaba marcado como retirado");

  const { error } = await (admin as any)
    .from("cierres_caja")
    .update({ sobre_retirado_por: userId, sobre_retirado_en: new Date().toISOString() })
    .eq("id", cierreId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/cierres");
  if (cierre.sucursal_id) revalidatePath(`/admin/sucursales/${cierre.sucursal_id}`);
}

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
