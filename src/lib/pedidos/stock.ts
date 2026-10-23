import type { createAdminClient } from "@/lib/supabase/server";
import { puertoKiosco } from "@/lib/tenteo/puerto-kiosco";
import type { ItemPedidoResuelto } from "./pricing";
import { formatearCantidad } from "./lineas";

// El chequeo de stock negativo está desactivado GLOBALMENTE en
// crear_movimiento_con_items desde la migración 024 (nunca reactivado) --
// no se reabre acá, afectaría a todo el sistema existente. Pero un pedido
// público, sin nadie mirando la góndola, es un caso distinto: dos
// compradores simultáneos podrían llevarse la última unidad sin que nadie
// se entere hasta después. Esto es una prevalidación LIVIANA, acotada solo
// al camino nuevo, contra la vista stock_sucursal ya existente (mig.
// 023/065) -- no es atómica ni reemplaza un lock real, es "avisar antes de
// cobrar", no una garantía dura.

export type FaltaStock = {
  error:       string;
  productId?:  string; // el producto que no alcanza (falta si el local nunca lo tuvo)
  disponible?: number; // lo que queda, en la unidad de la cantidad pedida
  pedido?:     number; // lo que se pidió en total de ese producto
};

// Mismo chequeo que chequearStockLiviano, con el detalle para que la tienda explique cuánto queda.
export async function revisarStock(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  items: ItemPedidoResuelto[]
): Promise<FaltaStock | null> {
  const productIds = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))];
  if (productIds.length === 0) return null;

  const requeridoPorProducto = new Map<string, number>();
  for (const item of items) {
    if (!item.product_id) continue;
    requeridoPorProducto.set(item.product_id, (requeridoPorProducto.get(item.product_id) ?? 0) + item.cantidad);
  }

  const stockRows = await puertoKiosco(admin).stock(sucursalId, productIds);
  if (!stockRows) return null; // best-effort -- si falla la consulta, no bloquea el pedido por esto

  const stockMap = new Map(stockRows.map((r) => [r.product_id, r]));

  for (const [productId, cantidadRequerida] of requeridoPorProducto) {
    const row = stockMap.get(productId) as { product_name: string; stock_actual: number } | undefined;
    // Sin fila en stock_sucursal = el producto nunca se movió en ESTE local = no lo tiene
    // (el catálogo tampoco lo ofrece, así que solo llega por un carrito viejo o armado a mano).
    if (!row) return { error: "Uno de los productos no está disponible en este local" };
    if (row.stock_actual < cantidadRequerida) {
      const nombre = (row.product_name ?? "").trim() || "Un producto";
      const queda = Math.max(0, Number(row.stock_actual) || 0);
      return {
        error: queda <= 0
          ? `${nombre} se agotó. Sacalo del pedido para seguir.`
          : `Quedan solo ${formatearCantidad(queda)} de ${nombre} y pediste ${formatearCantidad(cantidadRequerida)}. Bajá la cantidad para seguir.`,
        productId: productId,
        disponible: queda,
        pedido: cantidadRequerida,
      };
    }
  }

  return null;
}

export async function chequearStockLiviano(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  items: ItemPedidoResuelto[]
): Promise<string | null> {
  return (await revisarStock(admin, sucursalId, items))?.error ?? null;
}
