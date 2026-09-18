import { createAdminClient } from "@/lib/supabase/server";
import { registrarVentaCobroEnEntrega } from "./crear-venta-publica";

// Máquina de estados de un pedido ya aceptado, compartida por las acciones de
// staff (/admin/pedidos-online) y la del repartidor (/admin/repartos).
// Sin "use server": no es invocable desde el browser -- cada Server Action
// que la usa hace antes su propio chequeo de rol y de acceso a la sucursal.

export function transicionesPermitidas(estadoActual: string, tipoEntrega: string, tieneRepartidor: boolean): string[] {
  switch (estadoActual) {
    case "confirmado":     // efectivo, aceptado, cobro pendiente
    case "pagado":         // Mercado Pago ya cobrado
      return ["en_preparacion"];
    case "en_preparacion":
      return tipoEntrega === "delivery"
        ? (tieneRepartidor ? ["en_reparto"] : [])
        : ["listo_retiro"];
    case "listo_retiro":
    case "en_reparto":
      return ["entregado"];
    default:
      return [];
  }
}

export type PedidoParaTransicion = {
  id: string;
  estado: string;
  tipo_entrega: string;
  repartidor_id: string | null;
  medio_pago: string | null;
};

export async function aplicarTransicion(
  admin: ReturnType<typeof createAdminClient>,
  pedido: PedidoParaTransicion,
  nuevoEstado: string
): Promise<{ error?: string }> {
  const permitidos = transicionesPermitidas(pedido.estado, pedido.tipo_entrega, !!pedido.repartidor_id);
  if (!permitidos.includes(nuevoEstado)) {
    return { error: pedido.tipo_entrega === "delivery" && pedido.estado === "en_preparacion" && !pedido.repartidor_id
      ? "Asigná un repartidor antes de pasarlo a reparto"
      : "Transición de estado inválida" };
  }

  // Atómico: solo aplica si el estado sigue siendo el que se leyó -- evita
  // dobles clicks / carreras entre dos personas mirando la misma pantalla.
  const { data: actualizado, error } = await (admin as any)
    .from("pedidos")
    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
    .eq("id", pedido.id)
    .eq("estado", pedido.estado)
    .select("id");
  if (error) return { error: error.message };
  if (!actualizado?.length) return { error: "El pedido ya cambió de estado, refrescá la página" };

  // Un pedido en efectivo recién se vende cuando se entrega y se cobra. Si el
  // registro de la venta falla, se revierte el estado para no dejar un pedido
  // "entregado" sin venta y sin forma de reintentar.
  if (nuevoEstado === "entregado" && pedido.medio_pago === "efectivo") {
    const venta = await registrarVentaCobroEnEntrega(admin, pedido.id);
    if (venta.error) {
      await (admin as any)
        .from("pedidos")
        .update({ estado: pedido.estado, updated_at: new Date().toISOString() })
        .eq("id", pedido.id)
        .eq("estado", "entregado");
      return { error: `No se pudo registrar la venta: ${venta.error}` };
    }
  }

  return {};
}
