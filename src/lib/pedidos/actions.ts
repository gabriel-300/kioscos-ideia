"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { identificadorCliente, chequearRateLimit } from "./rate-limit";
import { resolverItemsPedido, type ItemCarritoInput } from "./pricing";
import { chequearStockLiviano } from "./stock";
import { sugerirUpsellParaSucursal, type SugerenciaUpsell } from "./sugerir-upsell";

const EXPIRACION_MS = 15 * 60 * 1000; // 15 minutos para pagar antes de expirar

export async function iniciarPedido(data: {
  sucursal_id:      string;
  cliente_nombre:   string;
  cliente_telefono: string;
  notas:            string | null;
  items:            ItemCarritoInput[]; // nunca lleva precio -- el público no lo manda
}): Promise<{ pedido_id?: string; external_reference?: string; total?: number; error?: string }> {
  const admin = createAdminClient();

  if (!data.cliente_nombre?.trim() || !data.cliente_telefono?.trim()) {
    return { error: "Faltan tus datos de contacto" };
  }

  const identificador = await identificadorCliente(data.cliente_telefono);
  const rateLimitError = await chequearRateLimit(admin, identificador);
  if (rateLimitError) return { error: rateLimitError };

  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("is_active, mercadopago_pos_id")
    .eq("id", data.sucursal_id)
    .single();
  if (!sucursal?.is_active) return { error: "Esta sucursal no está disponible para pedidos online" };
  // TODO(fase 2, pendiente de confirmar): la Orders API nueva puede no
  // necesitar mercadopago_pos_id (ver plan) -- se revisa este chequeo una
  // vez confirmado el endpoint real, no antes.
  if (!sucursal.mercadopago_pos_id) return { error: "Esta sucursal todavía no acepta pedidos online" };

  const resuelto = await resolverItemsPedido(admin, data.sucursal_id, data.items);
  if ("error" in resuelto) return { error: resuelto.error };

  const stockError = await chequearStockLiviano(admin, data.sucursal_id, resuelto.items);
  if (stockError) return { error: stockError };

  const externalReference = crypto.randomUUID();

  const { data: pedido, error: pedidoError } = await (admin as any)
    .from("pedidos")
    .insert({
      sucursal_id:      data.sucursal_id,
      origen:           "storefront",
      estado:           "pendiente_pago",
      tipo_entrega:     "retiro_local",
      cliente_nombre:   data.cliente_nombre.trim(),
      cliente_telefono: data.cliente_telefono.trim(),
      notas:            data.notas?.trim() || null,
      subtotal:         resuelto.subtotal,
      total:            resuelto.total,
      medio_pago:       "mercadopago_qr",
      expira_en:        new Date(Date.now() + EXPIRACION_MS).toISOString(),
    })
    .select("id")
    .single();
  if (pedidoError || !pedido) return { error: pedidoError?.message ?? "No se pudo crear el pedido" };

  const { error: itemsError } = await (admin as any)
    .from("pedido_items")
    .insert(resuelto.items.map((i) => ({ pedido_id: pedido.id, ...i })));
  if (itemsError) return { error: itemsError.message };

  // Punto pendiente (ver plan de Fase 2): confirmar el endpoint real de la
  // Orders API de Mercado Pago (POST /v1/orders, type:"qr") antes de armar
  // el pago acá -- documentación contradictoria sobre si external_pos_id es
  // obligatorio, hace falta una prueba real. Hasta confirmarlo, el pedido
  // queda creado en pendiente_pago pero sin QR armado.
  return {
    pedido_id:          pedido.id,
    external_reference: externalReference,
    total:               resuelto.total,
    error:                "El armado del pago todavía no está conectado (pendiente de confirmar el endpoint de Mercado Pago) -- el pedido se guardó pero no se puede pagar todavía.",
  };
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
