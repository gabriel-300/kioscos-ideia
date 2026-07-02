"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

export async function cerrarCaja(data: {
  sucursal_id:              string;
  fecha:                    string;
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

  const { error } = await (admin as any).from("cierres_caja").insert({
    sucursal_id:             data.sucursal_id,
    fecha:                   data.fecha,
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
  const supabase = await createClient();
  const { data } = await supabase
    .from("cierres_caja")
    .select("*")
    .eq("sucursal_id", sucursalId)
    .eq("fecha", fecha)
    .single();
  return data;
}
