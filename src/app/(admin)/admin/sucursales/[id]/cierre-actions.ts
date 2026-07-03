"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

export async function cerrarCaja(data: {
  sucursal_id:              string;
  fecha:                    string;
  fondo_inicial:           number;
  total_ventas:            number;
  efectivo_declarado:      number;
  billetera_declarada:     number;
  tarjeta_declarada:       number;
  transferencia_declarada: number;
  notas:                    string | null;
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

  // Cierre atómico: la RPC lockea por sucursal, valida el ciclo y calcula
  // retiros_turno server-side (no confía en lo que mande el cliente)
  const { error } = await (admin as any).rpc("cerrar_caja", {
    p_sucursal_id:             data.sucursal_id,
    p_fecha:                   data.fecha,
    p_fondo_inicial:           data.fondo_inicial,
    p_total_ventas:            data.total_ventas,
    p_efectivo_declarado:      data.efectivo_declarado,
    p_billetera_declarada:     data.billetera_declarada,
    p_tarjeta_declarada:       data.tarjeta_declarada,
    p_transferencia_declarada: data.transferencia_declarada,
    p_notas:                   data.notas,
    p_created_by:              userId,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/cierres");
}

export async function getCierreDelDia(sucursalId: string, fecha: string) {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  if (role === "encargado") {
    const { data: suc } = await supabase
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", sucursalId)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }
  if (role === "vendedor") {
    const profileRes = await (supabase as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== sucursalId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  const res = await (supabase as any)
    .from("cierres_caja")
    .select("*")
    .eq("sucursal_id", sucursalId)
    .eq("fecha", fecha)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return res.data ?? null;
}
