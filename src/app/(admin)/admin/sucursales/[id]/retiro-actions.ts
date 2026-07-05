"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { fechaHoyAR } from "@/lib/fecha";

export async function registrarRetiro(data: {
  sucursal_id: string;
  monto:       number;
  motivo:      string;
  comprobante_image_url?: string | null;
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
  if (role === "vendedor") {
    const profileRes = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== data.sucursal_id) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  const hoy = fechaHoyAR();

  const { error } = await (admin as any).from("retiros_caja").insert({
    sucursal_id: data.sucursal_id,
    fecha:       hoy,
    monto:       data.monto,
    motivo:      data.motivo,
    created_by:  userId,
    comprobante_image_url: data.comprobante_image_url ?? null,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
}
