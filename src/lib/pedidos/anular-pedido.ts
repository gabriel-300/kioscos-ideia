import type { createAdminClient } from "@/lib/supabase/server";
import { puertoKiosco } from "@/lib/tenteo/puerto-kiosco";

// Anular un pedido online que ya se cobró (Mercado Pago): el pedido pasa a "cancelado" y su venta se
// marca como anulada (no se borra: queda en el Historial con quién, cuándo y por qué), así deja de contar
// en caja, stock e informes. La plata ya cobrada NO se devuelve sola: hay que devolverla desde Mercado Pago.
//
// Misma regla que anularVenta del kiosco: solo mientras la caja de ese turno sigue abierta -- una vez
// cerrada, la venta queda fija. El administrador puede anular igual (con motivo), por ejemplo un pedido de
// prueba o un error que se descubre después del cierre.

type Admin = ReturnType<typeof createAdminClient>;

export const ESTADOS_SIN_ANULAR = ["cancelado", "expirado", "carrito"];

export async function anularPedidoCobrado(
  admin: Admin,
  p: { pedidoId: string; motivo: string; userId: string; esAdmin: boolean },
): Promise<{ error?: string; sucursalId?: string }> {
  const motivo = p.motivo?.trim();
  if (!motivo || motivo.length < 3) return { error: "Contá por qué anulás este pedido" };

  const { data: pedido } = await (admin as any)
    .from("pedidos").select("id, sucursal_id, estado, movimiento_id").eq("id", p.pedidoId).single();
  if (!pedido) return { error: "No se encontró el pedido" };
  if (ESTADOS_SIN_ANULAR.includes(pedido.estado)) return { error: "Este pedido ya no se puede anular" };
  if (!pedido.movimiento_id) return { error: "Este pedido todavía no tiene una venta: usá Cancelar pedido" };
  if (pedido.estado === "entregado" && !p.esAdmin) return { error: "Un pedido ya entregado solo lo puede anular un administrador" };

  const res = await puertoKiosco(admin).anularVenta({
    movimientoId: pedido.movimiento_id, sucursalId: pedido.sucursal_id, userId: p.userId, motivo, esAdmin: p.esAdmin,
  });
  if (res.error) return { error: res.error };

  const { data: actualizado, error } = await (admin as any)
    .from("pedidos")
    .update({ estado: "cancelado", updated_at: new Date().toISOString() })
    .eq("id", p.pedidoId)
    .eq("estado", pedido.estado)
    .select("id");
  if (error) return { error: error.message };
  if (!actualizado?.length) return { error: "El pedido ya cambió de estado, refrescá la página" };

  return { sucursalId: pedido.sucursal_id };
}
