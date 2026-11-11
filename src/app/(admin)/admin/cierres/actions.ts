"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { sucursalConCatalogoPropio } from "@/lib/auth/catalogo-propio";

// El socio que retira el sobre confirma con su propia sesión, en el momento
// en que físicamente lo tiene en la mano (puede ser horas o días después del
// cierre -- el sobre suele quedar en el kiosco hasta el próximo retiro). Antes
// lo "declaraba" el encargado/vendedor del kiosco eligiendo un nombre de una
// lista, lo que permitía marcar a alguien que en los hechos no lo había
// retirado. Ahora nadie puede confirmar el retiro de otro -- solo el propio.
//
// Quién puede tocar el sobre de un cierre: un administrador (cualquier cierre) o el DUEÑO de un local independiente
// (migración 131), que es quien retira la caja de su propio local, y solo los cierres de ese local.
// Devuelven { error } en vez de lanzar: Next.js oculta el mensaje de un throw en producción.

async function permisoSobre(cierreId: string): Promise<{ error: string } | { userId: string; sucursalId: string | null; sobreRetiradoPor: string | null }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const { data: cierre } = await (admin as any)
    .from("cierres_caja")
    .select("sucursal_id, sobre_retirado_por")
    .eq("id", cierreId)
    .single();
  if (!cierre) return { error: "Cierre no encontrado" };

  if (role !== "admin") {
    const propia = role === "concesionario" ? await sucursalConCatalogoPropio(userId) : null;
    if (!propia || propia !== cierre.sucursal_id) return { error: "No tenés permiso para este cierre" };
  }
  return { userId, sucursalId: cierre.sucursal_id ?? null, sobreRetiradoPor: cierre.sobre_retirado_por ?? null };
}

export async function confirmarRetiroSobre(cierreId: string): Promise<{ error?: string }> {
  const permiso = await permisoSobre(cierreId);
  if ("error" in permiso) return permiso;
  if (permiso.sobreRetiradoPor) return { error: "Este sobre ya estaba marcado como retirado" };

  const admin = createAdminClient();
  const { error } = await (admin as any)
    .from("cierres_caja")
    .update({ sobre_retirado_por: permiso.userId, sobre_retirado_en: new Date().toISOString() })
    .eq("id", cierreId);
  if (error) return { error: error.message };

  revalidatePath("/admin/cierres");
  if (permiso.sucursalId) revalidatePath(`/admin/sucursales/${permiso.sucursalId}`);
  revalidatePath("/admin/tesoreria");
  return {};
}

// El tesorero/socio verifica cuánto contó del sobre que le entregaron. Queda
// registrado quién verificó automáticamente (el usuario logueado -- Damián,
// Javier o Gabriel, todos con su propia cuenta admin), no hace falta elegirlo
// de una lista.
export async function verificarSobre(cierreId: string, data: { montoVerificado: number; notas: string | null }): Promise<{ error?: string }> {
  const permiso = await permisoSobre(cierreId);
  if ("error" in permiso) return permiso;

  const admin = createAdminClient();
  const { error } = await (admin as any)
    .from("cierres_caja")
    .update({
      sobre_monto_verificado: data.montoVerificado,
      sobre_verificado_por:   permiso.userId,
      sobre_verificado_en:    new Date().toISOString(),
      sobre_notas:            data.notas,
    })
    .eq("id", cierreId);
  if (error) return { error: error.message };

  revalidatePath("/admin/cierres");
  return {};
}
