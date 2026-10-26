import type { createAdminClient } from "@/lib/supabase/server";

// El cliente cancela SU pedido desde la página de seguimiento (como en Rappi: mientras el local todavía no empezó).
// Solo mientras no haya plata cobrada ni preparación en marcha:
//  - pendiente_pago: todavía no pagó (el link de Mercado Pago queda cancelado).
//  - confirmado: pidió en efectivo y el local lo aceptó, pero no empezó (se cobra al entregar, no hay nada que devolver).
// Un pedido ya pagado, en preparación, en camino o entregado NO se cancela solo: hay plata o comida de por medio, y lo
// resuelve el local por el chat. Sin "use server": lo llama una Server Action; la única credencial del cliente es el
// id del pedido (uuid aleatorio) junto con el de la sucursal, igual que el seguimiento.

type Admin = ReturnType<typeof createAdminClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ESTADOS_CANCELABLES_POR_CLIENTE = ["pendiente_pago", "confirmado"];

export function puedeCancelarElCliente(estado: string, tieneVenta: boolean): boolean {
  return ESTADOS_CANCELABLES_POR_CLIENTE.includes(estado) && !tieneVenta;
}

// Para estados en los que NO puede cancelar a solas: qué decirle.
export function textoAyudaCancelar(estado: string): string | null {
  if (["pagado", "en_preparacion", "listo_retiro", "en_reparto"].includes(estado)) {
    return "¿Necesitás cambiar o cancelar algo? Escribinos por el chat y lo resolvemos.";
  }
  return null;
}

export async function cancelarPedidoDelCliente(admin: Admin, p: { sucursalId: string; pedidoId: string }): Promise<{ error?: string }> {
  if (!UUID.test(p.pedidoId) || !UUID.test(p.sucursalId)) return { error: "No se encontró el pedido" };

  const { data: pedido } = await (admin as any)
    .from("pedidos").select("id, estado, movimiento_id, medio_pago").eq("id", p.pedidoId).eq("sucursal_id", p.sucursalId).maybeSingle();
  if (!pedido || pedido.estado === "carrito") return { error: "No se encontró el pedido" };

  if (pedido.estado === "cancelado") return { error: "Este pedido ya está cancelado" };
  if (pedido.estado === "expirado") return { error: "Este pedido ya venció" };
  if (!puedeCancelarElCliente(pedido.estado, !!pedido.movimiento_id)) {
    return { error: textoAyudaCancelar(pedido.estado) ?? "Este pedido ya no se puede cancelar desde acá. Escribinos por el chat." };
  }

  // Atómico: solo cancela si sigue en el estado que se leyó (el local puede haberlo tomado justo ahora).
  const { data: actualizado, error } = await (admin as any)
    .from("pedidos")
    .update({ estado: "cancelado", updated_at: new Date().toISOString() })
    .eq("id", p.pedidoId)
    .eq("estado", pedido.estado)
    .is("movimiento_id", null)
    .select("id");
  if (error) return { error: "No se pudo cancelar el pedido. Probá de nuevo o escribinos por el chat." };
  if (!actualizado?.length) return { error: "El local acaba de tomar tu pedido. Escribinos por el chat si necesitás cambiarlo." };

  // Si tenía un cobro de Mercado Pago sin pagar, queda cancelado (que nadie lo pague después).
  if (pedido.medio_pago?.startsWith("mercadopago")) {
    await (admin as any).from("mercadopago_qr_orders").update({ estado: "cancelado" }).eq("pedido_id", p.pedidoId).eq("estado", "pendiente");
  }
  return {};
}
