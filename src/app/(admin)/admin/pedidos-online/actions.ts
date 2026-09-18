"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { aplicarTransicion } from "@/lib/pedidos/transiciones";
import { crearVentaPublica } from "@/lib/pedidos/crear-venta-publica";

// Fase 5 del storefront (delivery, ver plan): primera pantalla del admin
// para ver pedidos que vinieron del storefront/bot de WhatsApp más allá de
// la venta que terminan generando. La máquina de estados vive en
// src/lib/pedidos/transiciones.ts (la comparte /admin/repartos).

function refrescar() {
  revalidatePath("/admin/pedidos-online");
  revalidatePath("/admin/repartos");
}

export async function avanzarEstadoPedido(pedidoId: string, nuevoEstado: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("id, sucursal_id, estado, tipo_entrega, repartidor_id, medio_pago")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  const res = await aplicarTransicion(admin, pedido, nuevoEstado);
  if (res.error) return res;

  refrescar();
  return {};
}

// Asignar repartidor es una decisión operativa (quién coordina la entrega),
// no una tarea de turno -- mismo criterio que ya usa reposicion.ts para
// excluir vendedor/concesionario de decisiones de compra.
export async function asignarRepartidor(pedidoId: string, repartidorUserId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor" || role === "concesionario") return { error: "No tenés permisos para asignar repartidor" };
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("sucursal_id, tipo_entrega")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };
  if (pedido.tipo_entrega !== "delivery") return { error: "Este pedido no es de delivery" };

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  const { data: repartidorUser } = await admin.auth.admin.getUserById(repartidorUserId);
  if (repartidorUser?.user?.app_metadata?.role !== "repartidor") return { error: "Ese usuario no es un repartidor" };

  const { error } = await (admin as any)
    .from("pedidos")
    .update({ repartidor_id: repartidorUserId, updated_at: new Date().toISOString() })
    .eq("id", pedidoId);
  if (error) return { error: error.message };

  refrescar();
  return {};
}

// Pedido pagado con Mercado Pago por link (el local manda el link por
// WhatsApp y confirma acá cuando ve el pago en su cuenta). Reusa
// crearVentaPublica: hace la transición pendiente_pago -> pagado y la venta.
// Confirmar que entró plata es una decisión de dueño/encargado, no de turno.
export async function confirmarPagoRecibido(pedidoId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role !== "admin" && role !== "encargado") return { error: "No tenés permisos para confirmar pagos" };
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("sucursal_id, estado, medio_pago")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };
  if (pedido.medio_pago !== "mercadopago_link") return { error: "Este pedido no se paga por link de Mercado Pago" };
  if (pedido.estado !== "pendiente_pago") {
    return { error: pedido.estado === "expirado" ? "El pedido ya venció, hay que cargarlo de nuevo" : "El pedido ya no está esperando el pago" };
  }

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  const res = await crearVentaPublica(admin, pedidoId);
  if (res.error) return { error: `No se pudo registrar la venta: ${res.error}` };

  refrescar();
  return {};
}

// Solo pedidos que todavía no generaron una venta: los cobrados por Mercado
// Pago ya tienen movimiento y se anulan desde la venta, no desde acá.
export async function cancelarPedido(pedidoId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("sucursal_id, estado, movimiento_id")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  if (pedido.movimiento_id) return { error: "Este pedido ya tiene una venta registrada -- anulala desde el historial de ventas" };
  if (["entregado", "cancelado", "expirado", "carrito"].includes(pedido.estado)) return { error: "Este pedido ya no se puede cancelar" };

  const { data: actualizado, error } = await (admin as any)
    .from("pedidos")
    .update({ estado: "cancelado", updated_at: new Date().toISOString() })
    .eq("id", pedidoId)
    .eq("estado", pedido.estado)
    .select("id");
  if (error) return { error: error.message };
  if (!actualizado?.length) return { error: "El pedido ya cambió de estado, refrescá la página" };

  refrescar();
  return {};
}
