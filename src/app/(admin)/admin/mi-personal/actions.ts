"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireDueno } from "@/lib/auth/catalogo-propio";

// Personal de un local con catálogo propio (migración 131). El dueño da de alta y
// administra a SUS vendedores; no toca a nadie más ni asigna roles distintos: el
// «encargado» de su sucursal es él mismo (sucursales.encargado_user_id es uno solo).
//
// Un vendedor solo se puede administrar desde acá si trabaja ÚNICAMENTE en la
// sucursal del dueño: uno habilitado también en otros kioscos es personal de IDEIA.

async function validarVendedorPropio(userId: string, sucursalId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: user, error } = await admin.auth.admin.getUserById(userId);
  if (error || !user?.user) return "No existe";
  if (user.user.app_metadata?.role !== "vendedor") return "Solo podés administrar vendedores";
  const { data: filas } = await (admin as any).from("profile_sucursales").select("sucursal_id").eq("profile_id", userId);
  const ids = (filas ?? []).map((f: { sucursal_id: string }) => f.sucursal_id);
  if (ids.length === 0 || ids.some((id: string) => id !== sucursalId)) {
    return "Esa persona no es de tu local";
  }
  return null;
}

export async function crearVendedor(data: { email: string; nombre: string; password: string }): Promise<{ error?: string }> {
  const { sucursalId } = await requireDueno();
  const email = data.email.trim().toLowerCase();
  const nombre = data.nombre.trim();
  if (!nombre) return { error: "Falta el nombre" };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "El email no es válido" };
  if (data.password.length < 8) return { error: "La contraseña tiene que tener al menos 8 caracteres" };

  const admin = createAdminClient();
  // Rol y sistema los fija el servidor: un vendedor del kiosco, nada más.
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: data.password,
    user_metadata: { full_name: nombre },
    app_metadata: { role: "vendedor", sistemas: ["kiosco"] },
    email_confirm: true,
  });
  if (error || !created.user) return { error: error?.message ?? "No se pudo crear el usuario" };

  const id = created.user.id;
  await (admin as any).from("profiles").update({ sucursal_id: sucursalId }).eq("id", id);
  const { error: psError } = await (admin as any)
    .from("profile_sucursales")
    .upsert({ profile_id: id, sucursal_id: sucursalId }, { onConflict: "profile_id,sucursal_id" });
  if (psError) return { error: psError.message };

  revalidatePath("/admin/mi-personal");
  return {};
}

export async function suspenderVendedor(userId: string, suspender: boolean): Promise<{ error?: string }> {
  const { sucursalId } = await requireDueno();
  const err = await validarVendedorPropio(userId, sucursalId);
  if (err) return { error: err };
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: suspender ? "876600h" : "none" });
  if (error) return { error: error.message };
  revalidatePath("/admin/mi-personal");
  return {};
}

export async function cambiarClaveVendedor(userId: string, password: string): Promise<{ error?: string }> {
  const { sucursalId } = await requireDueno();
  if (password.length < 8) return { error: "La contraseña tiene que tener al menos 8 caracteres" };
  const err = await validarVendedorPropio(userId, sucursalId);
  if (err) return { error: err };
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };
  return {};
}
