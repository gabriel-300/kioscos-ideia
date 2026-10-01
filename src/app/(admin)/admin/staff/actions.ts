"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { rolDe, sistemasAGuardar, sistemasFijos, type Rol as StaffRole, type Sistema } from "@/lib/auth/acceso";

export async function crearStaff(data: {
  email:      string;
  nombre:     string;
  password:   string;
  role:       StaffRole;
  sistemas?:  Sistema[];  // admin y repartidor no lo usan (fijos); sin dato, kiosco
  sucursalId?: string;
}): Promise<{ userId: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  // El sistema va en app_metadata (solo lo escribe el servidor), nunca en user_metadata.
  const sist = sistemasAGuardar(data.role, data.sistemas ?? ["kiosco"]);
  if ("error" in sist) throw new Error(sist.error);

  const { data: created, error } = await admin.auth.admin.createUser({
    email:         data.email,
    password:      data.password,
    user_metadata: { full_name: data.nombre },
    app_metadata:  { role: data.role, ...(sist.valor ? { sistemas: sist.valor } : {}) },
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

export async function actualizarStaff(userId: string, data: { nombre: string; password?: string; creditoLimite?: number | null; esSocio?: boolean; role?: StaffRole; sistemas?: Sistema[] }) {
  await requireAdmin();
  const admin = createAdminClient();
  const update: { user_metadata: Record<string, string>; app_metadata?: Record<string, unknown>; password?: string } = {
    user_metadata: { full_name: data.nombre },
  };
  if (data.password) update.password = data.password;
  if (data.role || data.sistemas !== undefined) {
    // Merge, no reemplazo -- app_metadata puede tener otras claves además de
    // role y sistemas, no hay que perderlas por cambiar una.
    const { data: actual } = await admin.auth.admin.getUserById(userId);
    const meta: Record<string, unknown> = { ...(actual.user?.app_metadata ?? {}) };
    const rolFinal = data.role ?? rolDe(actual.user);
    if (data.role) meta.role = data.role;

    // Sistemas: se escriben si los mandan, o si el rol nuevo es fijo (admin y
    // repartidor: se borra el dato, para que no quede uno viejo si vuelve a cambiar).
    if (rolFinal && (data.sistemas !== undefined || (data.role && sistemasFijos(data.role)))) {
      const sist = sistemasAGuardar(rolFinal, data.sistemas);
      if ("error" in sist) throw new Error(sist.error);
      if (sist.valor) meta.sistemas = sist.valor;
      else delete meta.sistemas;
    }
    update.app_metadata = meta;
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

  // Para encargados y concesionarios (mismo mecanismo de scoping, ver
  // sucursal-access.ts), también actualizar sucursales.encargado_user_id
  if (sucursalId && (!role || role === "encargado" || role === "concesionario")) {
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
