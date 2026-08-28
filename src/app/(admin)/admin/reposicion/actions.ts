"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

// Marcar "ya pedido" no borra ni ajusta stock -- solo silencia el ítem del
// aviso de reposición hasta que llegue una entrega nueva de ese producto en
// esa sucursal (ver src/lib/reposicion.ts, obtenerItemsReposicion).
export async function marcarPedidoRealizado(productId: string, sucursalId: string): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
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
  await requireAdmin();
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
