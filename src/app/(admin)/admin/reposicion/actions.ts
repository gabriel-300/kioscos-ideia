"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

// Admin ve/marca reposición de cualquier sucursal; concesionario solo la
// suya. Vendedor/encargado quedan afuera -- reposición es decisión de compra,
// no una tarea de turno.
async function requireAdminOAccesoSucursal(sucursalId: string): Promise<{ userId: string; error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor" || role === "encargado") return { userId, error: "No tenés permisos para reposición" };
  if (role !== "admin") {
    const admin = createAdminClient();
    const error = await requireSucursalAccess(admin, userId, role, sucursalId);
    if (error) return { userId, error };
  }
  return { userId };
}

// Marcar "ya pedido" no borra ni ajusta stock -- solo silencia el ítem del
// aviso de reposición hasta que llegue una entrega nueva de ese producto en
// esa sucursal (ver src/lib/reposicion.ts, obtenerItemsReposicion).
export async function marcarPedidoRealizado(productId: string, sucursalId: string): Promise<{ error?: string }> {
  const { userId, error: accesoError } = await requireAdminOAccesoSucursal(sucursalId);
  if (accesoError) return { error: accesoError };
  const supabase = createAdminClient();
  const { error } = await (supabase as any)
    .from("reposicion_marcas_pedido")
    .upsert(
      { product_id: productId, sucursal_id: sucursalId, marcado_en: new Date().toISOString(), marcado_por: userId },
      { onConflict: "product_id,sucursal_id" }
    );
  if (error) return { error: error.message };
  revalidatePath("/admin/reposicion");
  return {};
}

export async function desmarcarPedido(productId: string, sucursalId: string): Promise<{ error?: string }> {
  const { error: accesoError } = await requireAdminOAccesoSucursal(sucursalId);
  if (accesoError) return { error: accesoError };
  const supabase = createAdminClient();
  const { error } = await (supabase as any)
    .from("reposicion_marcas_pedido")
    .delete()
    .eq("product_id", productId)
    .eq("sucursal_id", sucursalId);
  if (error) return { error: error.message };
  revalidatePath("/admin/reposicion");
  return {};
}
