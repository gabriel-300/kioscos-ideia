"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { identificadorCliente } from "./rate-limit";
import { crearPedidoPublico, type DatosPedidoPublico, type ResultadoPedidoPublico } from "./crear-pedido-publico";
import { sugerirUpsellParaSucursal, type SugerenciaUpsell } from "./sugerir-upsell";

// La lógica vive en crear-pedido-publico.ts (sin next/headers, para poder
// probarla con un script). Acá solo se resuelve el identificador del rate
// limit -- cf-connecting-ip, o el teléfono si falta el header.
export async function iniciarPedido(data: DatosPedidoPublico): Promise<ResultadoPedidoPublico> {
  const admin = createAdminClient();
  const identificador = await identificadorCliente(data.cliente_telefono ?? "");
  return crearPedidoPublico(admin, data, identificador);
}

export async function consultarEstadoPedidoPublico(pedidoId: string): Promise<{ estado?: string; total?: number; error?: string }> {
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("estado, total, expira_en")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };

  if (pedido.estado === "pendiente_pago" && pedido.expira_en && new Date(pedido.expira_en) < new Date()) {
    await (admin as any)
      .from("pedidos")
      .update({ estado: "expirado" })
      .eq("id", pedidoId)
      .eq("estado", "pendiente_pago");
    return { estado: "expirado", total: pedido.total };
  }

  return { estado: pedido.estado, total: pedido.total };
}

// Fase 4: sugerencia de IA para subir el ticket, solo en el storefront por
// ahora (el bot de WhatsApp sigue inerte sin WHATSAPP_ACCESS_TOKEN, no hay
// urgencia en cablearlo ahí todavía). Nunca falla de forma visible -- si
// algo sale mal (sin GROQ_API_KEY, error de red, el modelo no devuelve
// nada útil) simplemente no hay sugerencia, el checkout sigue andando
// igual. idsEnCarrito son ids que el cliente ya tiene, nunca se usan para
// cobrar nada -- solo para no sugerir algo que ya está en el carrito.
export async function sugerirUpsellPublico(sucursalId: string, idsEnCarrito: string[]): Promise<SugerenciaUpsell | null> {
  const admin = createAdminClient();
  try {
    return await sugerirUpsellParaSucursal(admin, sucursalId, idsEnCarrito);
  } catch {
    return null;
  }
}
