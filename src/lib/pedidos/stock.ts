import { createAdminClient } from "@/lib/supabase/server";
import type { ItemPedidoResuelto } from "./pricing";

// El chequeo de stock negativo está desactivado GLOBALMENTE en
// crear_movimiento_con_items desde la migración 024 (nunca reactivado) --
// no se reabre acá, afectaría a todo el sistema existente. Pero un pedido
// público, sin nadie mirando la góndola, es un caso distinto: dos
// compradores simultáneos podrían llevarse la última unidad sin que nadie
// se entere hasta después. Esto es una prevalidación LIVIANA, acotada solo
// al camino nuevo, contra la vista stock_sucursal ya existente (mig.
// 023/065) -- no es atómica ni reemplaza un lock real, es "avisar antes de
// cobrar", no una garantía dura.

export async function chequearStockLiviano(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  items: ItemPedidoResuelto[]
): Promise<string | null> {
  const productIds = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
  if (productIds.length === 0) return null;

  const requeridoPorProducto = new Map<string, number>();
  for (const item of items) {
    if (!item.product_id) continue;
    requeridoPorProducto.set(item.product_id, (requeridoPorProducto.get(item.product_id) ?? 0) + item.cantidad);
  }

  const { data: stockRows, error } = await (admin as any)
    .from("stock_sucursal")
    .select("product_id, product_name, stock_actual")
    .eq("sucursal_id", sucursalId)
    .in("product_id", productIds);
  if (error) return null; // best-effort -- si falla la consulta, no bloquea el pedido por esto

  const stockMap = new Map((stockRows ?? []).map((r: any) => [r.product_id, r]));

  for (const [productId, cantidadRequerida] of requeridoPorProducto) {
    const row = stockMap.get(productId) as { product_name: string; stock_actual: number } | undefined;
    // Sin fila en stock_sucursal = nunca tuvo movimientos = stock desconocido,
    // no "cero" -- mismo criterio que ya usa el resto del proyecto, no bloquea.
    if (row && row.stock_actual < cantidadRequerida) {
      return `"${row.product_name}" no tiene stock suficiente en este momento`;
    }
  }

  return null;
}
