"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

export async function crearEncargado(data: { email: string; nombre: string; password: string }): Promise<{ userId: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email:          data.email,
    password:       data.password,
    user_metadata:  { full_name: data.nombre },
    app_metadata:   { role: "encargado" },
    email_confirm:  true,
  });

  if (error || !created.user) throw new Error(error?.message ?? "Error al crear usuario");

  revalidatePath("/admin/staff");
  return { userId: created.user.id };
}

export async function eliminarStaff(userId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  // Desasignar de sucursal antes de eliminar
  await admin.from("sucursales").update({ encargado_user_id: null }).eq("encargado_user_id", userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/staff");
  revalidatePath("/admin/sucursales");
}

export async function actualizarEncargado(userId: string, data: { nombre: string; password?: string }) {
  await requireAdmin();
  const admin = createAdminClient();
  const update: { user_metadata: Record<string, string>; password?: string } = {
    user_metadata: { full_name: data.nombre },
  };
  if (data.password) update.password = data.password;
  const { error } = await admin.auth.admin.updateUserById(userId, update);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/staff");
}

export async function asignarSucursal(userId: string, sucursalId: string | null) {
  await requireAdmin();
  const admin = createAdminClient();
  // Desasignar de cualquier sucursal previa
  await admin.from("sucursales").update({ encargado_user_id: null }).eq("encargado_user_id", userId);
  // Asignar a la nueva sucursal
  if (sucursalId) {
    const { error } = await admin.from("sucursales").update({ encargado_user_id: userId }).eq("id", sucursalId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/admin/staff");
  revalidatePath("/admin/sucursales");
}
