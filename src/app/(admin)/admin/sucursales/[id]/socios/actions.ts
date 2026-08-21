"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

// Mismo nivel que Cta. Corriente (mirror exacto, pedido explícito del
// usuario): admin y encargado de esa sucursal, nunca vendedor.
async function requireEditRole(sucursalId: string) {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para Socios" };
  const admin = createAdminClient();
  if (role === "encargado") {
    const { data: suc } = await admin.from("sucursales").select("encargado_user_id").eq("id", sucursalId).single();
    if (suc?.encargado_user_id !== userId) return { error: "No tenés permisos para esta sucursal" };
  }
  return { admin, userId };
}

export async function registrarRetiroSocio(data: {
  sucursal_id: string;
  socio_id:    string;
  tipo:        "retiro_temporal" | "retiro_ganancias";
  monto:       number;
  fecha:       string;
  notas?:      string;
}): Promise<{ error?: string }> {
  const check = await requireEditRole(data.sucursal_id);
  if ("error" in check) return { error: check.error };
  const { admin, userId } = check;

  if (!(data.monto > 0)) return { error: "Ingresá un monto válido mayor a cero" };

  const { error } = await (admin as any).from("movimientos_socio").insert({
    sucursal_id: data.sucursal_id,
    socio_id:    data.socio_id,
    tipo:        data.tipo,
    monto:       data.monto,
    fecha:       data.fecha,
    notas:       data.notas || null,
    created_by:  userId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${data.sucursal_id}/socios`);
  revalidatePath("/admin/tesoreria");
  return {};
}

export async function eliminarRetiroSocio(id: string, sucursalId: string): Promise<{ error?: string }> {
  const check = await requireEditRole(sucursalId);
  if ("error" in check) return { error: check.error };
  const { admin } = check;

  const { error } = await (admin as any).from("movimientos_socio").delete().eq("id", id).eq("sucursal_id", sucursalId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${sucursalId}/socios`);
  revalidatePath("/admin/tesoreria");
  return {};
}

export async function registrarDevolucionSocio(data: {
  sucursal_id:     string;
  socio_id:        string;
  monto_efectivo:  number;
  monto_billetera: number;
  fecha:           string;
  notas?:          string;
}): Promise<{ error?: string }> {
  const check = await requireEditRole(data.sucursal_id);
  if ("error" in check) return { error: check.error };
  const { admin, userId } = check;

  if (data.monto_efectivo + data.monto_billetera <= 0) {
    return { error: "Ingresá un monto válido mayor a cero" };
  }

  const { error } = await (admin as any).from("pagos_socio").insert({
    sucursal_id:     data.sucursal_id,
    socio_id:        data.socio_id,
    monto_efectivo:  data.monto_efectivo,
    monto_billetera: data.monto_billetera,
    fecha:           data.fecha,
    notas:           data.notas || null,
    created_by:      userId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${data.sucursal_id}/socios`);
  revalidatePath("/admin/tesoreria");
  return {};
}

export async function eliminarDevolucionSocio(id: string, sucursalId: string): Promise<{ error?: string }> {
  const check = await requireEditRole(sucursalId);
  if ("error" in check) return { error: check.error };
  const { admin } = check;

  const { error } = await (admin as any).from("pagos_socio").delete().eq("id", id).eq("sucursal_id", sucursalId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${sucursalId}/socios`);
  revalidatePath("/admin/tesoreria");
  return {};
}
