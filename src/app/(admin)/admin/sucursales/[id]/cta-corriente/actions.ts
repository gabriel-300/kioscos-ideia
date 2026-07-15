"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

// Cta. Corriente: admin y encargado pueden registrar/eliminar pagos, nunca
// vendedor. Antes este archivo tenía su propio chequeo de rol (sin usar
// requireStaff() como el resto del sistema) y nunca validaba que la
// sucursal/fila fuera del encargado que llama -- mitigado hasta ahora solo
// porque usaba el cliente atado a RLS en vez de createAdminClient() como los
// demás 14 archivos de acciones (auditoría 15/07, hallazgo medio 09). Se
// alinea al mismo patrón que el resto: service role + chequeo explícito de
// dueño en JS, en vez de depender en silencio de la policy de la tabla.
async function requireEditRole(sucursalId: string) {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") throw new Error("No tenés permisos para Cta. Corriente");
  const admin = createAdminClient();
  if (role === "encargado") {
    const { data: suc } = await admin
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", sucursalId)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }
  return { admin, userId };
}

export async function registrarPagoCTC(params: {
  sucursal_id: string;
  personal_id: string;
  monto: number;
  fecha: string;
  notas?: string;
}) {
  const { admin, userId } = await requireEditRole(params.sucursal_id);
  const { error } = await (admin as any)
    .from("cta_corriente_pagos")
    .insert({ ...params, created_by: userId });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/sucursales/${params.sucursal_id}/cta-corriente`);
}

export async function eliminarPagoCTC(id: string, sucursalId: string) {
  const { admin } = await requireEditRole(sucursalId);
  const { error } = await (admin as any)
    .from("cta_corriente_pagos")
    .delete()
    .eq("id", id)
    .eq("sucursal_id", sucursalId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/sucursales/${sucursalId}/cta-corriente`);
}
