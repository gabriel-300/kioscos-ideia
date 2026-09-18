"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireRepartidor } from "@/lib/auth/require-role";
import { aplicarTransicion } from "@/lib/pedidos/transiciones";

// El repartidor NO pasa por requireStaff() (a propósito, ver require-role.ts):
// tiene su propia acción, acotada a lo que puede hacer -- marcar entregado un
// pedido que le asignaron y que está en reparto. Un admin puede hacerlo por
// cualquiera (supervisión).
export async function marcarEntregadoRepartidor(pedidoId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireRepartidor();
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("id, estado, tipo_entrega, repartidor_id, medio_pago")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };
  if (role === "repartidor" && pedido.repartidor_id !== userId) return { error: "Este pedido no es tuyo" };
  if (pedido.estado !== "en_reparto") return { error: "Este pedido no está en reparto" };

  const res = await aplicarTransicion(admin, pedido, "entregado");
  if (res.error) return res;

  revalidatePath("/admin/repartos");
  revalidatePath("/admin/pedidos-online");
  return {};
}
