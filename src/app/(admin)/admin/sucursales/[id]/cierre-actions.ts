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

  // Guard server-side: verificar que la caja esté efectivamente abierta
  const aperturaRes = await (admin as any)
    .from("aperturas_caja")
    .select("created_at")
    .eq("sucursal_id", data.sucursal_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ultimaApertura = aperturaRes.data as { created_at: string } | null;
  if (!ultimaApertura) throw new Error("No hay apertura de caja registrada");

  const cierreRes = await (admin as any)
    .from("cierres_caja")
    .select("created_at")
    .eq("sucursal_id", data.sucursal_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ultimoCierre = cierreRes.data as { created_at: string } | null;
  if (ultimoCierre && ultimoCierre.created_at >= ultimaApertura.created_at) {
    throw new Error("La caja ya está cerrada");
  }

  const { error } = await (admin as any).from("cierres_caja").insert({
    sucursal_id:             data.sucursal_id,
    fecha:                   data.fecha,
    fondo_inicial:           data.fondo_inicial,
    total_ventas:            data.total_ventas,
    efectivo_declarado:      data.efectivo_declarado,
    billetera_declarada:     data.billetera_declarada,
    tarjeta_declarada:       data.tarjeta_declarada,
    transferencia_declarada: data.transferencia_declarada,
    notas:                   data.notas,
    created_by:              userId,
  });

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/cierres");
}

export async function getCierreDelDia(sucursalId: string, fecha: string) {
  await requireStaff();
  const supabase = createAdminClient();
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
