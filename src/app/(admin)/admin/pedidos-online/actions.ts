"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

// Fase 5 del storefront (delivery, ver plan): primera pantalla del admin
// para ver pedidos que vinieron del storefront/bot de WhatsApp más allá de
// la venta que terminan generando. No existía nada de esto antes -- hacía
// falta para que asignar un repartidor tenga sentido.

// Qué estados siguen son válidos desde el estado actual, según el tipo de
// entrega -- se valida siempre server-side, los botones del cliente son
// solo una sugerencia de UI.
function transicionesPermitidas(estadoActual: string, tipoEntrega: string, tieneRepartidor: boolean): string[] {
  switch (estadoActual) {
    case "pagado":
      return ["en_preparacion"];
    case "en_preparacion":
      return tipoEntrega === "delivery"
        ? (tieneRepartidor ? ["en_reparto"] : [])
        : ["listo_retiro"];
    case "listo_retiro":
      return ["entregado"];
    case "en_reparto":
      return ["entregado"];
    default:
      return [];
  }
}

export async function avanzarEstadoPedido(pedidoId: string, nuevoEstado: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("sucursal_id, estado, tipo_entrega, repartidor_id")
    .eq("id", pedidoId)
    .single();
  if (!pedido) return { error: "No se encontró el pedido" };

  const accesoError = await requireSucursalAccess(admin, userId, role, pedido.sucursal_id);
  if (accesoError) return { error: accesoError };

  const permitidos = transicionesPermitidas(pedido.estado, pedido.tipo_entrega, !!pedido.repartidor_id);
  if (!permitidos.includes(nuevoEstado)) {
    return { error: pedido.tipo_entrega === "delivery" && pedido.estado === "en_preparacion" && !pedido.repartidor_id
      ? "Asigná un repartidor antes de pasarlo a reparto"
      : "Transición de estado inválida" };
  }

  // Atómico: solo aplica si el estado sigue siendo el que se leyó arriba --
  // mismo patrón idempotente ya usado en toda la Fase 2/3 para evitar
  // dobles clicks / carreras entre dos personas mirando la misma pantalla.
  const { data: actualizado, error } = await (admin as any)
    .from("pedidos")
    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq("id", pedidoId)
    .eq("estado", pedido.estado)
    .select("id");
  if (error) return { error: error.message };
  if (!actualizado?.length) return { error: "El pedido ya cambió de estado, refrescá la página" };

  revalidatePath("/admin/pedidos-online");
  revalidatePath("/admin/repartos");
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

  revalidatePath("/admin/pedidos-online");
  revalidatePath("/admin/repartos");
  return {};
}
