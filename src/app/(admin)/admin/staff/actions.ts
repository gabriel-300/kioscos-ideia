"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

type StaffRole = "admin" | "encargado" | "vendedor";

export async function crearStaff(data: {
  email:      string;
  nombre:     string;
  password:   string;
  role:       StaffRole;
  sucursalId?: string;
}): Promise<{ userId: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: created, error } = await admin.auth.admin.createUser({
    email:         data.email,
    password:      data.password,
    user_metadata: { full_name: data.nombre },
    app_metadata:  { role: data.role },
    email_confirm: true,
  });

  if (error || !created.user) throw new Error(error?.message ?? "Error al crear usuario");

  const userId = created.user.id;

  if (data.sucursalId) {
    await asignarSucursal(userId, data.sucursalId, data.role);
  }

  revalidatePath("/admin/staff");
  return { userId };
}

export async function eliminarStaff(userId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.from("sucursales").update({ encargado_user_id: null }).eq("encargado_user_id", userId);
  await (admin as any).from("profiles").update({ sucursal_id: null }).eq("id", userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/staff");
  revalidatePath("/admin/sucursales");
}

export async function actualizarStaff(userId: string, data: { nombre: string; password?: string; creditoLimite?: number | null; esSocio?: boolean; role?: StaffRole }) {
  await requireAdmin();
  const admin = createAdminClient();
  const update: { user_metadata: Record<string, string>; app_metadata?: Record<string, unknown>; password?: string } = {
    user_metadata: { full_name: data.nombre },
  };
  if (data.password) update.password = data.password;
  if (data.role) {
    // Merge, no reemplazo -- app_metadata puede tener otras claves además de
    // role a futuro, no hay que perderlas por cambiar el rol.
    const { data: actual } = await admin.auth.admin.getUserById(userId);
    update.app_metadata = { ...(actual.user?.app_metadata ?? {}), role: data.role };
  }
  const { error } = await admin.auth.admin.updateUserById(userId, update);
  if (error) throw new Error(error.message);
  if (data.creditoLimite !== undefined) {
    await (admin as any).from("profiles").update({ credito_limite: data.creditoLimite }).eq("id", userId);
  }
  if (data.esSocio !== undefined) {
    await (admin as any).from("profiles").update({ es_socio: data.esSocio }).eq("id", userId);
  }
  revalidatePath("/admin/staff");
}

export async function suspenderStaff(userId: string, suspend: boolean) {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: suspend ? "876600h" : "none",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/staff");
}

export async function generarLinkResetPassword(email: string): Promise<string> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data) throw new Error(error?.message ?? "Error al generar link");
  return data.properties.action_link;
}

export async function asignarSucursal(userId: string, sucursalId: string | null, role?: string) {
  await requireAdmin();
  const admin = createAdminClient();

  // Limpiar asignación anterior en sucursales (encargado)
  await admin.from("sucursales").update({ encargado_user_id: null }).eq("encargado_user_id", userId);

  // Actualizar profiles.sucursal_id para todos los roles
  await (admin as any).from("profiles").update({ sucursal_id: sucursalId ?? null }).eq("id", userId);

  // Para encargados, también actualizar sucursales.encargado_user_id
  if (sucursalId && (!role || role === "encargado")) {
    const { error } = await admin.from("sucursales").update({ encargado_user_id: userId }).eq("id", sucursalId);
    if (error) throw new Error(error.message);
  }

  // Para vendedor (alta inicial desde crearStaff, una sola sucursal): además
  // de profiles.sucursal_id (sucursal activa), se registra en
  // profile_sucursales -- si no, el vendedor recién creado quedaría "sin
  // sucursales" para auth/redirect/page.tsx a pesar de tener una elegida acá.
  if (sucursalId && role === "vendedor") {
    await (admin as any)
      .from("profile_sucursales")
      .upsert({ profile_id: userId, sucursal_id: sucursalId }, { onConflict: "profile_id,sucursal_id" });
  }

  revalidatePath("/admin/staff");
  revalidatePath("/admin/sucursales");
}

// Reemplaza el conjunto completo de sucursales donde un vendedor está
// habilitado a trabajar (distinto de asignarSucursal, que solo apunta la
// sucursal ACTIVA -- ver migración 082 y sucursal-access.ts).
export async function asignarSucursalesVendedor(userId: string, sucursalIds: string[]) {
  await requireAdmin();
  const admin = createAdminClient();

  await (admin as any).from("profile_sucursales").delete().eq("profile_id", userId);
  if (sucursalIds.length > 0) {
    const { error } = await (admin as any)
      .from("profile_sucursales")
      .insert(sucursalIds.map((sucursal_id) => ({ profile_id: userId, sucursal_id })));
    if (error) throw new Error(error.message);
  }

  // Si la sucursal activa actual quedó fuera del nuevo set, reapuntarla (o
  // vaciarla) para que nav/redirect nunca apunten a una sucursal ya no
  // asignada.
  const { data: profile } = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
  if (profile?.sucursal_id && !sucursalIds.includes(profile.sucursal_id)) {
    await (admin as any).from("profiles").update({ sucursal_id: sucursalIds[0] ?? null }).eq("id", userId);
  }

  revalidatePath("/admin/staff");
  revalidatePath("/admin/sucursales");
}
