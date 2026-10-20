"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { armarSeguimiento } from "./seguimiento";

// Estado resumido de un pedido para la franja "Tu pedido en curso". Igual que la página de
// seguimiento: el id del pedido (uuid aleatorio) hace de enlace secreto, y no se devuelve
// nada del cliente (ni teléfono ni dirección).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EstadoPedidoReciente = { titulo: string; final: boolean };

export async function estadoPedidoReciente(sucursalId: string, pedidoId: string): Promise<EstadoPedidoReciente | null> {
  if (!UUID.test(sucursalId) || !UUID.test(pedidoId)) return null;
  const { data: pedido } = await (createAdminClient() as any)
    .from("pedidos")
    .select("estado, tipo_entrega, medio_pago")
    .eq("id", pedidoId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle();
  if (!pedido || pedido.estado === "carrito") return null;
  const seg = armarSeguimiento(pedido);
  return { titulo: seg.titulo, final: seg.final };
}
