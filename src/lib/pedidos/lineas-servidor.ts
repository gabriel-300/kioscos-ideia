import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { puertoKiosco } from "@/lib/tenteo/puerto-kiosco";
import { armarLineas, type FilaPedidoItem, type LineaPedido } from "./lineas";

// Carga las líneas (lo que pidió el cliente) de varios pedidos con pocas consultas.
// Sin "use server": lo llaman páginas y acciones que ya validaron el rol.
//
// Tolerante a fallas: si no se pueden leer, devuelve un mapa vacío y la pantalla
// muestra los pedidos igual, sin el detalle (mejor eso que romper la lista).

type Admin = ReturnType<typeof createAdminClient>;

// Los ids van en la URL de la consulta: en tandas para no pasarse del largo permitido.
const TANDA = 50;

type FilaConPedido = FilaPedidoItem & { id: string; pedido_id: string };

export async function cargarLineasDePedidos(admin: Admin, pedidoIds: string[]): Promise<Map<string, LineaPedido[]>> {
  const resultado = new Map<string, LineaPedido[]>();
  const ids = [...new Set(pedidoIds)];
  if (ids.length === 0) return resultado;

  try {
    const filas: FilaConPedido[] = [];
    for (let i = 0; i < ids.length; i += TANDA) {
      const tanda = ids.slice(i, i + TANDA);
      filas.push(...await fetchAll<FilaConPedido>((d, h) =>
        (admin as any)
          .from("pedido_items")
          .select("id, pedido_id, product_id, promo_id, cantidad", { count: "exact" })
          .in("pedido_id", tanda)
          .order("id")
          .range(d, h)
      ));
    }

    // Los nombres de productos y promos son del kiosco: se piden por el puerto.
    const productIds = [...new Set(filas.flatMap((f) => (f.product_id ? [f.product_id] : [])))];
    const promoIds = [...new Set(filas.flatMap((f) => (f.promo_id ? [f.promo_id] : [])))];
    const { productos, promos } = await puertoKiosco(admin).nombres(productIds, promoIds);
    const nombreProducto = new Map(productos.map((p) => [p.id, p.name]));
    const nombrePromo = new Map(promos.map((p) => [p.id, p.name]));

    const porPedido = new Map<string, FilaConPedido[]>();
    for (const f of filas) porPedido.set(f.pedido_id, [...(porPedido.get(f.pedido_id) ?? []), f]);
    for (const [pedidoId, delPedido] of porPedido) {
      // Orden alfabético: estable entre recargas (el orden de inserción no se conserva).
      const lineas = armarLineas(delPedido, nombreProducto, nombrePromo)
        .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));
      resultado.set(pedidoId, lineas);
    }
  } catch (e) {
    console.error("[lineas-pedidos] no se pudo leer el detalle de los pedidos:", (e as Error).message);
  }
  return resultado;
}
