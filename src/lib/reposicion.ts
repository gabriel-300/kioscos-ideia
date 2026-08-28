import { createAdminClient } from "@/lib/supabase/server";
import { diaSemanaHoyAR } from "@/lib/fecha";

// Lógica compartida entre /admin/reposicion (pantalla) y
// /api/reposicion-hoy (aviso automático) -- las dos tienen que mostrar
// exactamente lo mismo, si no el aviso de WhatsApp y la pantalla se
// contradicen entre sí.

export type ItemReposicion = {
  productId:        string;
  sucursalId:       string;
  sucursalNombre:   string;
  proveedorId:      string | null;
  proveedorNombre:  string | null;
  nombre:           string;
  sku:              string;
  categoryId:       string | null;
  unit:             string;
  stockActual:      number;
  puntoMinimo:      number | null;
  puntoPedido:      number | null;
  puntoMaximo:      number | null;
  cantidadSugerida: number | null;
  diasEntrega:      number | null;
  diaPedido:        string | null; // "diario" | día de semana | null
  motivo:           "punto_pedido" | "ciclo";
};

type PuntoRow = {
  product_id:  string;
  sucursal_id: string;
  punto_minimo: number | null;
  punto_pedido: number | null;
  punto_maximo: number | null;
  product: {
    name: string; sku: string; category_id: string | null; unit_label: string; is_active: boolean;
    dias_entrega: number | null; dia_pedido: string | null; proveedor_id: string | null;
  } | null;
};

// Trae todo lo que corresponde reponer HOY (bajo punto de pedido, o con
// ciclo fijo -- diario o de un día de la semana -- que coincide con hoy),
// ya filtrando lo que un admin marcó como "ya pedido" y todavía no llegó
// una entrega nueva desde esa marca.
export async function obtenerItemsReposicion(
  admin: ReturnType<typeof createAdminClient>
): Promise<ItemReposicion[]> {
  const hoy = diaSemanaHoyAR();

  const [{ data: sucursales }, { data: puntosRaw }, { data: stockRaw }, { data: proveedoresRaw }] = await Promise.all([
    admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    (admin as any)
      .from("product_prices")
      .select(`
        product_id, sucursal_id, punto_minimo, punto_pedido, punto_maximo,
        product:products(name, sku, category_id, unit_label, is_active, dias_entrega, dia_pedido, proveedor_id)
      `) as unknown as Promise<{ data: PuntoRow[] | null }>,
    (admin as any)
      .from("stock_sucursal")
      .select("product_id, sucursal_id, stock_actual") as unknown as Promise<{
        data: { product_id: string; sucursal_id: string; stock_actual: number }[] | null;
      }>,
    admin.from("proveedores").select("id, nombre") as unknown as Promise<{ data: { id: string; nombre: string }[] | null }>,
  ]);

  const sucursalNombreMap  = new Map((sucursales ?? []).map((s) => [s.id, s.nombre]));
  const stockMap           = new Map((stockRaw ?? []).map((r) => [`${r.sucursal_id}:${r.product_id}`, r.stock_actual]));
  const proveedorNombreMap = new Map((proveedoresRaw ?? []).map((p) => [p.id, p.nombre]));

  const candidatos: ItemReposicion[] = [];
  for (const p of puntosRaw ?? []) {
    if (!p.product?.is_active) continue;
    const stockActual = stockMap.get(`${p.sucursal_id}:${p.product_id}`) ?? 0;
    const diaPedido = p.product.dia_pedido;
    const bajoPunto = p.punto_pedido != null && stockActual <= p.punto_pedido;
    const cicloHoy  = diaPedido === "diario" || diaPedido === hoy;
    if (!bajoPunto && !cicloHoy) continue;
    // Ciclo fijo que ya está en el máximo (o sin margen para pedir): no
    // tiene sentido avisar aunque hoy sea el día del ciclo.
    if (!bajoPunto && cicloHoy && p.punto_maximo != null && stockActual >= p.punto_maximo) continue;

    candidatos.push({
      productId:   p.product_id,
      sucursalId:  p.sucursal_id,
      sucursalNombre: sucursalNombreMap.get(p.sucursal_id) ?? "—",
      proveedorId:     p.product.proveedor_id,
      proveedorNombre: p.product.proveedor_id ? (proveedorNombreMap.get(p.product.proveedor_id) ?? null) : null,
      nombre:      p.product.name,
      sku:         p.product.sku,
      categoryId:  p.product.category_id,
      unit:        p.product.unit_label,
      stockActual,
      puntoMinimo: p.punto_minimo,
      puntoPedido: p.punto_pedido,
      puntoMaximo: p.punto_maximo,
      cantidadSugerida: p.punto_maximo != null ? Math.max(0, p.punto_maximo - stockActual) : null,
      diasEntrega: p.product.dias_entrega,
      diaPedido,
      motivo: bajoPunto ? "punto_pedido" : "ciclo",
    });
  }

  if (candidatos.length === 0) return [];

  const productIds  = [...new Set(candidatos.map((c) => c.productId))];
  const sucursalIds = [...new Set(candidatos.map((c) => c.sucursalId))];

  const { data: marcas } = await (admin as any)
    .from("reposicion_marcas_pedido")
    .select("product_id, sucursal_id, marcado_en")
    .in("product_id", productIds)
    .in("sucursal_id", sucursalIds) as { data: { product_id: string; sucursal_id: string; marcado_en: string }[] | null };

  if (!marcas || marcas.length === 0) return candidatos;

  const marcaMap = new Map(marcas.map((m) => [`${m.sucursal_id}:${m.product_id}`, m.marcado_en]));
  const minMarcadoEn = marcas.reduce((min, m) => (m.marcado_en < min ? m.marcado_en : min), marcas[0].marcado_en);

  // Solo entre los candidatos marcados: ¿llegó una entrega nueva de ese
  // producto en esa sucursal después de la marca? Si sí, la marca quedó
  // "consumida" y el ítem vuelve a aparecer.
  const { data: entregasNuevas } = await (admin as any)
    .from("movimientos")
    .select("sucursal_id, created_at, movimiento_items(product_id)")
    .eq("tipo", "entrega")
    .in("sucursal_id", sucursalIds)
    .gt("created_at", minMarcadoEn) as {
      data: { sucursal_id: string; created_at: string; movimiento_items: { product_id: string }[] }[] | null;
    };

  const entregaMasRecienteMap = new Map<string, string>();
  for (const mov of entregasNuevas ?? []) {
    for (const item of mov.movimiento_items ?? []) {
      const key = `${mov.sucursal_id}:${item.product_id}`;
      const actual = entregaMasRecienteMap.get(key);
      if (!actual || mov.created_at > actual) entregaMasRecienteMap.set(key, mov.created_at);
    }
  }

  return candidatos.filter((c) => {
    const key = `${c.sucursalId}:${c.productId}`;
    const marcadoEn = marcaMap.get(key);
    if (!marcadoEn) return true; // nunca se marcó como pedido
    const entregaEn = entregaMasRecienteMap.get(key);
    return !!entregaEn && entregaEn > marcadoEn; // se marcó, pero ya llegó una entrega nueva
  });
}

export function agruparPorProveedor(items: ItemReposicion[]): Map<string, ItemReposicion[]> {
  const grupos = new Map<string, ItemReposicion[]>();
  for (const it of items) {
    const key = it.proveedorNombre ?? "Sin proveedor asignado";
    grupos.set(key, [...(grupos.get(key) ?? []), it]);
  }
  return grupos;
}
