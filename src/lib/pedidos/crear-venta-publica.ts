import { createAdminClient } from "@/lib/supabase/server";
import { fechaHoyAR } from "@/lib/fecha";

// Sin "use server" a propósito -- esto NO es una Server Action invocable
// desde el browser, solo se llama desde el webhook de Mercado Pago
// (src/app/api/webhooks/mercadopago/route.ts) después de que el pago ya está
// confirmado contra la API de MP, y desde las acciones de staff de
// /admin/pedidos-online (que hacen su propio chequeo de rol antes). Mismo criterio que
// src/lib/auth/sucursal-access.ts: un módulo server-side interno, no una
// puerta de entrada pública.
//
// No se toca crearMovimiento() (src/app/(admin)/admin/movimientos/actions.ts)
// -- esa función exige requireStaff() de forma incondicional y tiene ramas
// (tenedor de turno, roles) que no aplican nunca acá. crear_movimiento_con_items
// (el RPC) tampoco se modifica -- sigue con EXECUTE revocado de anon/authenticated,
// esta función lo invoca con service_role desde el servidor, nunca expuesto
// al navegador.

export async function crearVentaPublica(
  admin: ReturnType<typeof createAdminClient>,
  pedidoId: string
): Promise<{ movimiento_id: string | null; error?: string }> {
  // Transición atómica pendiente_pago -> pagado, independiente de la de
  // mercadopago_qr_orders que ya hizo el webhook -- WHERE estado='pendiente_pago'
  // garantiza que esto corre una sola vez para este pedido aunque algo más
  // adelante vuelva a invocar esta función por error.
  const { data: transicionados, error: updError } = await (admin as any)
    .from("pedidos")
    .update({ estado: "pagado", updated_at: new Date().toISOString() })
    .eq("id", pedidoId)
    .eq("estado", "pendiente_pago")
    .select("id, sucursal_id, total, contacto_id");

  if (updError) return { movimiento_id: null, error: updError.message };
  if (!transicionados || transicionados.length === 0) {
    // Ya estaba procesado (o nunca llegó a pendiente_pago) -- no-op, no error.
    return { movimiento_id: null };
  }

  const pedido = transicionados[0] as { id: string; sucursal_id: string; total: number; contacto_id: string | null };

  const { data: itemsPedido, error: itemsError } = await (admin as any)
    .from("pedido_items")
    .select("product_id, promo_id, cantidad, precio_unitario, subtotal")
    .eq("pedido_id", pedidoId);

  if (itemsError || !itemsPedido?.length) {
    // No dejar "pagado" sin venta ni forma de reintentar -- se revierte para
    // que quede visible en la cola de "pedidos pagados sin venta generada".
    await (admin as any).from("pedidos").update({ estado: "pendiente_pago" }).eq("id", pedidoId);
    return { movimiento_id: null, error: itemsError?.message ?? "El pedido no tiene items" };
  }

  const fecha = fechaHoyAR();

  const rpcRes = await (admin as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id: pedido.sucursal_id,
    p_fecha: fecha,
    p_tipo: "venta",
    p_notas: `Pedido online #${pedidoId.slice(0, 8)}`,
    p_proveedor: null,
    p_proveedor_id: null,
    p_nro_remito: null,
    p_canal: "pedido_online",
    p_personal_id: null,
    p_contacto_id: pedido.contacto_id ?? null,
    p_pago_efectivo: null,
    p_pago_billetera: pedido.total, // mismo campo que ya usa el flujo QR de staff (vincularMovimientoQr)
    p_pago_tarjeta: null,
    p_pago_transferencia: null,
    p_created_by: null,
    p_items: itemsPedido.map((i: any) => ({
      product_id: i.product_id,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      subtotal: i.subtotal,
      promo_id: i.promo_id,
    })),
  });

  if (rpcRes.error) {
    await (admin as any).from("pedidos").update({ estado: "pendiente_pago" }).eq("id", pedidoId);
    return { movimiento_id: null, error: rpcRes.error.message };
  }

  const movimientoId: string | null = typeof rpcRes.data === "string" ? rpcRes.data : null;

  await (admin as any).from("pedidos").update({ movimiento_id: movimientoId }).eq("id", pedidoId);
  if (movimientoId) {
    await (admin as any).from("mercadopago_qr_orders").update({ movimiento_id: movimientoId }).eq("pedido_id", pedidoId);
  }

  return { movimiento_id: movimientoId };
}

// Pedido en efectivo (cobro en la puerta): a diferencia del flujo de Mercado
// Pago, acá no hay un pago previo que dispare la venta -- se registra recién
// cuando el pedido se entrega/retira y se cobra. La transición de estado a
// "entregado" ya la hizo (de forma atómica) quien llama; si esto falla, quien
// llama es responsable de revertir el estado, igual que hace crearVentaPublica.
//
// El total incluye el costo de envío pero los ítems del movimiento no --
// crear_movimiento_con_items no valida que la suma de pagos coincida con la
// suma de ítems, así que el efectivo cobrado (envío incluido) queda reflejado
// tal cual se cobró.
export async function registrarVentaCobroEnEntrega(
  admin: ReturnType<typeof createAdminClient>,
  pedidoId: string
): Promise<{ movimiento_id: string | null; error?: string }> {
  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("id, sucursal_id, total, contacto_id, movimiento_id, medio_pago, numero")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { movimiento_id: null, error: "No se encontró el pedido" };
  if (pedido.medio_pago !== "efectivo") return { movimiento_id: null, error: "El pedido no es de pago en efectivo" };
  if (pedido.movimiento_id) return { movimiento_id: pedido.movimiento_id }; // ya registrada

  const { data: itemsPedido, error: itemsError } = await (admin as any)
    .from("pedido_items")
    .select("product_id, promo_id, cantidad, precio_unitario, subtotal")
    .eq("pedido_id", pedidoId);
  if (itemsError || !itemsPedido?.length) {
    return { movimiento_id: null, error: itemsError?.message ?? "El pedido no tiene items" };
  }

  const rpcRes = await (admin as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id: pedido.sucursal_id,
    p_fecha: fechaHoyAR(),
    p_tipo: "venta",
    p_notas: `Pedido online #${pedido.numero ?? pedidoId.slice(0, 8)} (efectivo)`,
    p_proveedor: null,
    p_proveedor_id: null,
    p_nro_remito: null,
    p_canal: "pedido_online",
    p_personal_id: null,
    p_contacto_id: pedido.contacto_id ?? null,
    p_pago_efectivo: pedido.total,
    p_pago_billetera: null,
    p_pago_tarjeta: null,
    p_pago_transferencia: null,
    p_created_by: null,
    p_items: itemsPedido.map((i: any) => ({
      product_id: i.product_id,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      subtotal: i.subtotal,
      promo_id: i.promo_id,
    })),
  });
  if (rpcRes.error) return { movimiento_id: null, error: rpcRes.error.message };

  const movimientoId: string | null = typeof rpcRes.data === "string" ? rpcRes.data : null;
  await (admin as any).from("pedidos").update({ movimiento_id: movimientoId }).eq("id", pedidoId);
  return { movimiento_id: movimientoId };
}
