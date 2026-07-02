"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

export async function abrirCaja(data: {
  sucursal_id:   string;
  fecha:         string;
  fondo_inicial: number;
  notas:         string | null;
}) {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  if (role === "encargado") {
    const { data: suc } = await admin
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", data.sucursal_id)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  const { error } = await (admin as any).from("aperturas_caja").insert({
    sucursal_id:   data.sucursal_id,
    fecha:         data.fecha,
    fondo_inicial: data.fondo_inicial,
    notas:         data.notas,
    created_by:    userId,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/cierres");
}
