"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import type { Database } from "@/types/database";

type Insert = Database["public"]["Tables"]["sucursales"]["Insert"];
type Update = Database["public"]["Tables"]["sucursales"]["Update"];

export async function crearSucursal(data: Omit<Insert, "id" | "created_at" | "updated_at">) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from("sucursales").insert(data);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/sucursales");
}

export async function actualizarSucursal(id: string, data: Update) {
  await requireAdmin();
  const supabase = createAdminClient();

  // Si se asigna un nuevo encargado, desasignarlo de cualquier otra sucursal primero
  if (data.encargado_user_id) {
    await supabase
      .from("sucursales")
      .update({ encargado_user_id: null })
      .eq("encargado_user_id", data.encargado_user_id)
      .neq("id", id);
  }

  const { error } = await supabase.from("sucursales").update(data).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/sucursales");
  revalidatePath("/admin/staff");
}

export async function toggleSucursalActiva(id: string, activa: boolean) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("sucursales")
    .update({ is_active: !activa })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/sucursales");
}
