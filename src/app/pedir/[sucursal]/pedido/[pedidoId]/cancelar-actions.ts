"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { cancelarPedidoDelCliente } from "@/lib/pedidos/cancelar-por-cliente";

// El cliente cancela su pedido mientras el local todavía no lo empezó (ver lib/pedidos/cancelar-por-cliente.ts).
export async function cancelarMiPedido(sucursalId: string, pedidoId: string): Promise<{ error?: string }> {
  const res = await cancelarPedidoDelCliente(createAdminClient(), { sucursalId, pedidoId });
  if (res.error) return res;
  // El local lo ve desaparecer de Pedidos online / del aviso de pedidos nuevos.
  revalidatePath("/tenteo/pedidos");
  revalidatePath("/tenteo/repartos");
  return {};
}
