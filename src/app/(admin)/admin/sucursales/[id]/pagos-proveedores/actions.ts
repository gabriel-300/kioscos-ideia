"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

// Admin + encargado de esa sucursal (decisión del usuario) -- mismo nivel
// que Cta. Corriente, no admin-only como Gastos.
async function requireEditRole(sucursalId: string) {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para Pagos a Proveedores" };
  const admin = createAdminClient();
  if (role === "encargado") {
    const { data: suc } = await admin.from("sucursales").select("encargado_user_id").eq("id", sucursalId).single();
    if (suc?.encargado_user_id !== userId) return { error: "No tenés permisos para esta sucursal" };
  }
  return { admin, userId };
}

export async function registrarPagoProveedor(data: {
  sucursal_id:     string;
  proveedor_id:    string;
  monto_efectivo:  number;
  monto_billetera: number;
  fecha_pago:      string;
  movimiento_id?:  string | null;
  nota?:           string;
}): Promise<{ error?: string }> {
  const check = await requireEditRole(data.sucursal_id);
  if ("error" in check) return { error: check.error };
  const { admin, userId } = check;

  if (data.monto_efectivo + data.monto_billetera <= 0) {
    return { error: "Ingresá un monto válido mayor a cero" };
  }

  const { error } = await (admin as any).from("pagos_proveedor").insert({
    sucursal_id:     data.sucursal_id,
    proveedor_id:    data.proveedor_id,
    monto_efectivo:  data.monto_efectivo,
    monto_billetera: data.monto_billetera,
    fecha_pago:      data.fecha_pago,
    movimiento_id:   data.movimiento_id || null,
    nota:            data.nota || null,
    created_by:      userId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${data.sucursal_id}/pagos-proveedores`);
  revalidatePath("/admin/tesoreria");
  return {};
}

export async function eliminarPagoProveedor(id: string, sucursalId: string): Promise<{ error?: string }> {
  const check = await requireEditRole(sucursalId);
  if ("error" in check) return { error: check.error };
  const { admin } = check;

  const { error } = await (admin as any)
    .from("pagos_proveedor")
    .delete()
    .eq("id", id)
    .eq("sucursal_id", sucursalId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${sucursalId}/pagos-proveedores`);
  revalidatePath("/admin/tesoreria");
  return {};
}
