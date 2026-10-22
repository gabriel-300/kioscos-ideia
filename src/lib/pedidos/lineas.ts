// Qué pidió el cliente, en líneas legibles. Puro (sin base ni red): lo usan la
// lista de pedidos del personal, el aviso de pedido nuevo, la pantalla del
// repartidor y la página de seguimiento del cliente, para que todos lo muestren igual.

export type FilaPedidoItem = { product_id: string | null; promo_id: string | null; cantidad: number | string };

export type LineaPedido = { titulo: string; componentes: string[] };

const CANTIDAD = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

// numeric llega como número o texto: "2.00" se muestra "2".
export function formatearCantidad(c: number | string): string {
  const n = Number(c);
  return Number.isFinite(n) ? CANTIDAD.format(n) : String(c);
}

// Lo que se pide por peso se guarda en kilos (0.2): se lee "200 g". Una cantidad con decimales solo puede ser
// de un producto por kg; las enteras (2) son unidades. Devuelve la frase lista: "200 g de Chipa" o "2× Chipa".
export function frasePedido(c: number | string, nombre: string): string {
  const n = Number(c);
  if (Number.isFinite(n) && !Number.isInteger(n) && n > 0) {
    return n < 1 ? `${Math.round(n * 1000)} g de ${nombre}` : `${CANTIDAD.format(n)} kg de ${nombre}`;
  }
  return `${formatearCantidad(c)}× ${nombre}`;
}

// Una promo o receta se guarda como una fila por producto que la compone: se agrupa
// bajo el nombre de la promo para que se reconozca lo que se pidió. De una promo no
// queda guardada la cantidad pedida, solo la de cada componente (ya multiplicada).
export function armarLineas(filas: FilaPedidoItem[], productos: Map<string, string>, promos: Map<string, string>): LineaPedido[] {
  const lineas: LineaPedido[] = [];
  const porPromo = new Map<string, LineaPedido>();
  for (const f of filas) {
    const producto = f.product_id ? (productos.get(f.product_id) ?? "Producto") : "Producto";
    if (!f.promo_id) {
      lineas.push({ titulo: frasePedido(f.cantidad, producto), componentes: [] });
      continue;
    }
    let linea = porPromo.get(f.promo_id);
    if (!linea) {
      linea = { titulo: promos.get(f.promo_id) ?? "Promo", componentes: [] };
      porPromo.set(f.promo_id, linea);
      lineas.push(linea);
    }
    linea.componentes.push(frasePedido(f.cantidad, producto));
  }
  return lineas;
}
