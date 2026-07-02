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
  if (role === "vendedor") {
    const profileRes = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== data.sucursal_id) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  // Guard server-side: verificar que no haya una apertura ya abierta
  const aperturaRes = await (admin as any)
    .from("aperturas_caja")
    .select("created_at")
    .eq("sucursal_id", data.sucursal_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ultimaApertura = aperturaRes.data as { created_at: string } | null;

  if (ultimaApertura) {
    const cierreRes = await (admin as any)
      .from("cierres_caja")
      .select("created_at")
      .eq("sucursal_id", data.sucursal_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const ultimoCierre = cierreRes.data as { created_at: string } | null;
    if (!ultimoCierre || ultimaApertura.created_at > ultimoCierre.created_at) {
      throw new Error("La caja ya está abierta");
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
