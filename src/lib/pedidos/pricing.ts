import { createAdminClient } from "@/lib/supabase/server";

// Copia deliberada y acotada del bloque de precio/promos de crearMovimiento
// (src/app/(admin)/admin/movimientos/actions.ts) -- ese archivo no se toca,
// es una función de 380 líneas vendiendo en vivo ahora mismo con ramas de
// staff que no aplican nunca acá (tenedor de turno, override de precio de
// Pedido Ya). El precio SIEMPRE se resuelve server-side, nunca se confía del
// cliente -- ni siquiera se acepta un precio_unitario en el tipo de entrada.
//
// A diferencia de crearMovimiento (que confía en que la UI de venta rápida
// ya filtró categorías/promos habilitadas), acá SÍ se revalida
// categorias_habilitadas/promos_habilitadas contra la sucursal -- el cliente
// público le puede pegar directo a iniciarPedido() con un product_id que el
// storefront nunca mostró.

export function redondearMoneda(n: number): number {
  return Math.round(n * 100) / 100;
}

// Topes de un pedido público (un kiosco no vende 1.000 unidades de un producto por la web).
const MAX_CANTIDAD_LINEA = 1000;
const MAX_LINEAS_CARRITO = 100;

export type ItemCarritoInput =
  | { product_id: string; cantidad: number }
  | { promo_id: string; cantidad: number };

export type ItemPedidoResuelto = {
  product_id: string | null;
  promo_id: string | null;
  cantidad: number;
  precio_unitario: number | null;
  subtotal: number;
};

type Resultado =
  | { error: string }
  | { items: ItemPedidoResuelto[]; subtotal: number; total: number };

function esPromoItem(i: ItemCarritoInput): i is { promo_id: string; cantidad: number } {
  return "promo_id" in i;
}

export async function resolverItemsPedido(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  itemsCarrito: ItemCarritoInput[]
): Promise<Resultado> {
  if (itemsCarrito.length === 0) return { error: "El carrito está vacío" };
  // `cantidad <= 0` dejaba pasar NaN (NaN <= 0 es false) y no había tope: una Server Action
  // recibe NaN/Infinity sin problema (auditoría 19/09, H-12).
  if (itemsCarrito.length > MAX_LINEAS_CARRITO) return { error: "El carrito tiene demasiados productos" };
  if (itemsCarrito.some((i) => !Number.isFinite(i.cantidad) || i.cantidad <= 0)) return { error: "Cantidad inválida en el carrito" };
  if (itemsCarrito.some((i) => i.cantidad > MAX_CANTIDAD_LINEA)) return { error: "Cantidad demasiado grande en el carrito" };

  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("categorias_habilitadas, promos_habilitadas")
    .eq("id", sucursalId)
    .single();
  const categoriasHabilitadas: string[] | null = sucursal?.categorias_habilitadas ?? null;
  const promosHabilitadas: boolean = sucursal?.promos_habilitadas ?? true;

  const productInputs = itemsCarrito.filter((i): i is { product_id: string; cantidad: number } => !esPromoItem(i));
  const promoInputs   = itemsCarrito.filter(esPromoItem);

  if (promoInputs.length > 0 && !promosHabilitadas) {
    return { error: "Esta sucursal no tiene promociones habilitadas para pedidos online" };
  }

  const items: ItemPedidoResuelto[] = [];
  let subtotal = 0;

  // ── Productos sueltos ──────────────────────────────────────────────
  if (productInputs.length > 0) {
    const productIds = [...new Set(productInputs.map((i) => i.product_id))];
    const { data: products, error: prodError } = await (admin as any)
      .from("products")
      .select("id, category_id, is_active, vendible_pos")
      .in("id", productIds);
    if (prodError) return { error: prodError.message };

    const productMap = new Map((products ?? []).map((p: any) => [p.id, p]));

    const { data: precios, error: preciosError } = await admin
      .from("product_prices")
      .select("product_id, precio_dist")
      .eq("sucursal_id", sucursalId)
      .in("product_id", productIds);
    if (preciosError) return { error: preciosError.message };
    const precioMap = new Map((precios ?? []).map((p) => [p.product_id, p.precio_dist]));

    for (const input of productInputs) {
      const producto = productMap.get(input.product_id) as { id: string; category_id: string | null; is_active: boolean; vendible_pos: boolean | null } | undefined;
      if (!producto || !producto.is_active || producto.vendible_pos === false) {
        return { error: "Uno de los productos del carrito ya no está disponible" };
      }
      if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
        if (!producto.category_id || !categoriasHabilitadas.includes(producto.category_id)) {
          return { error: "Uno de los productos del carrito ya no está disponible en esta sucursal" };
        }
      }
      const precio = precioMap.get(input.product_id);
      if (precio == null || !(precio > 0)) {
        return { error: "Uno de los productos del carrito no tiene precio cargado" };
      }
      const sub = redondearMoneda(input.cantidad * precio);
      subtotal += sub;
      items.push({ product_id: input.product_id, promo_id: null, cantidad: input.cantidad, precio_unitario: precio, subtotal: sub });
    }
  }

  // ── Promos/recetas (mismo reparto proporcional al costo que crearMovimiento) ──
  if (promoInputs.length > 0) {
    const promoIds = [...new Set(promoInputs.map((i) => i.promo_id))];
    const { data: promos, error: promosError } = await (admin as any)
      .from("promos")
      .select("id, price, is_active, category_id, promo_items(product_id, cantidad)")
      .in("id", promoIds);
    if (promosError) return { error: promosError.message };

    type PromoItemRow = { product_id: string; cantidad: number };
    type PromoRow = { id: string; price: number; is_active: boolean; category_id: string | null; promo_items: PromoItemRow[] };
    const promoMap = new Map<string, PromoRow>((promos ?? []).map((p: PromoRow) => [p.id, p]));

    const { data: preciosPromo, error: preciosPromoError } = await (admin as any)
      .from("promo_prices")
      .select("promo_id, price")
      .eq("sucursal_id", sucursalId)
      .in("promo_id", promoIds);
    if (preciosPromoError) return { error: preciosPromoError.message };
    const precioPromoMap = new Map<string, number>((preciosPromo ?? []).map((p: { promo_id: string; price: number }) => [p.promo_id, p.price]));

    const componentProductIds: string[] = [...new Set(
      (promos ?? []).flatMap((p: PromoRow) => p.promo_items.map((pi) => pi.product_id))
    )] as string[];
    let costoComponenteMap = new Map<string, number>();
    if (componentProductIds.length > 0) {
      const { data: preciosComponentes, error: preciosCompError } = await admin
        .from("product_prices")
        .select("product_id, costo")
        .eq("sucursal_id", sucursalId)
        .in("product_id", componentProductIds);
      if (preciosCompError) return { error: preciosCompError.message };
      costoComponenteMap = new Map((preciosComponentes ?? []).map((p) => [p.product_id, p.costo]));
    }

    for (const input of promoInputs) {
      const promo = promoMap.get(input.promo_id);
      if (!promo || !promo.is_active) return { error: "Una de las promos del carrito ya no está disponible" };
      if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
        if (!promo.category_id || !categoriasHabilitadas.includes(promo.category_id)) {
          return { error: "Una de las promos del carrito ya no está disponible en esta sucursal" };
        }
      }
      if (!promo.promo_items || promo.promo_items.length === 0) {
        return { error: "Una de las promos del carrito no tiene productos configurados" };
      }
      const precioPromo = precioPromoMap.get(promo.id) ?? promo.price;
      if (precioPromo == null || !(precioPromo > 0)) {
        return { error: "Una de las promos del carrito no tiene precio cargado" };
      }
      const subtotalTotal = redondearMoneda(input.cantidad * precioPromo);
      subtotal += subtotalTotal;

      const cantidades = promo.promo_items.map((pi) => input.cantidad * pi.cantidad);
      const pesos = promo.promo_items.map((pi, i) => cantidades[i] * (costoComponenteMap.get(pi.product_id) ?? 0));
      const pesoTotal = pesos.reduce((s, w) => s + w, 0);
      const pesosFinal = pesoTotal > 0 ? pesos : cantidades.map(() => 1);
      const pesoFinalTotal = pesosFinal.reduce((s, w) => s + w, 0);

      let acumulado = 0;
      promo.promo_items.forEach((pi, idx) => {
        const esUltimo = idx === promo.promo_items.length - 1;
        const subtotalItem = esUltimo
          ? redondearMoneda(subtotalTotal - acumulado)
          : redondearMoneda(subtotalTotal * (pesosFinal[idx] / pesoFinalTotal));
        acumulado += subtotalItem;
        items.push({
          product_id: pi.product_id,
          promo_id: input.promo_id,
          cantidad: cantidades[idx],
          precio_unitario: null,
          subtotal: subtotalItem,
        });
      });
    }
  }

  return { items, subtotal: redondearMoneda(subtotal), total: redondearMoneda(subtotal) };
}
