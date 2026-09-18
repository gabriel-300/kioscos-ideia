import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizarHorario } from "@/lib/pedidos/horario";
import { Tienda } from "./_components/tienda";
import type { CategoriaCatalogo, ConfigTienda, ItemCatalogo } from "./_lib/tipos";

// Catálogo público de pedidos online. Nadie necesita sesión para entrar acá
// (ver la exclusión en src/lib/supabase/middleware.ts).
//
// Usa createAdminClient() (service role) igual que el resto del admin --
// acá no hay ninguna sesión de la que depender. Nunca se lee/muestra costo ni
// margen. La carga de datos y el filtrado (categorias_habilitadas/
// promos_habilitadas/vendible_pos) son 100% server-side: el Client Component
// solo recibe el catálogo ya resuelto y NUNCA manda precios de vuelta (el
// servidor los vuelve a resolver al confirmar el pedido).

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ sucursal: string }> }): Promise<Metadata> {
  const { sucursal } = await params;
  const admin = createAdminClient();
  const { data } = await admin.from("sucursales").select("nombre").eq("id", sucursal).single();
  return { title: data ? `Pedí en ${data.nombre}` : "Pedí online" };
}

export default async function PedirPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal: sucursalId } = await params;
  const admin = createAdminClient();

  // (admin as any): las columnas de config de pedidos online (migración 094)
  // y categorias_habilitadas/promos_habilitadas (088/089) todavía no están en
  // los tipos generados -- mismo patrón que el resto del proyecto.
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("id, nombre, direccion, localidad, is_active, categorias_habilitadas, promos_habilitadas, pedidos_online_habilitado, delivery_habilitado, retiro_habilitado, pedido_minimo_envio, retiro_eta_min, retiro_eta_max, whatsapp_pedidos, horario_pedidos")
    .eq("id", sucursalId)
    .single();

  if (!sucursal || !sucursal.is_active) notFound();

  const categoriasHabilitadas: string[] | null = sucursal.categorias_habilitadas ?? null;
  const restringe = !!categoriasHabilitadas && categoriasHabilitadas.length > 0;
  const promosHabilitadas: boolean = sucursal.promos_habilitadas ?? true;

  const [{ data: categoriesRaw }, { data: productsRaw }, { data: preciosRaw }, { data: promosRaw }, { data: preciosPromoRaw }, { data: zonasRaw }] = await Promise.all([
    admin.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    (admin as any)
      .from("products")
      .select("id, name, cover_image_url, category_id, unit_label, vendible_pos")
      .eq("is_active", true)
      .neq("sku", "MULTA-TERMO")
      .order("name"),
    admin.from("product_prices").select("product_id, precio_dist").eq("sucursal_id", sucursalId),
    (admin as any)
      .from("promos")
      .select("id, name, price, tipo, cover_image_url, category_id")
      .eq("is_active", true)
      .order("name"),
    (admin as any).from("promo_prices").select("promo_id, price").eq("sucursal_id", sucursalId),
    (admin as any)
      .from("zonas_entrega")
      .select("id, nombre, costo, eta_min, eta_max")
      .eq("sucursal_id", sucursalId)
      .eq("is_active", true)
      .order("orden")
      .order("costo"),
  ]);

  const precioProducto = new Map((preciosRaw ?? []).map((p: any) => [p.product_id as string, p.precio_dist as number]));
  // Mismo precio que después cobra resolverItemsPedido(): el de la sucursal si
  // existe, si no el global de la promo.
  const precioPromo = new Map((preciosPromoRaw ?? []).map((p: any) => [p.promo_id as string, p.price as number]));

  const categorias = (restringe
    ? (categoriesRaw ?? []).filter((c) => categoriasHabilitadas!.includes(c.id))
    : (categoriesRaw ?? [])) as { id: string; name: string }[];
  const nombreCategoria = new Map(categorias.map((c) => [c.id, c.name]));

  const productos: ItemCatalogo[] = [];
  for (const p of (productsRaw ?? []) as any[]) {
    if (p.vendible_pos === false) continue;
    if (restringe && (!p.category_id || !categoriasHabilitadas!.includes(p.category_id))) continue;
    const price = precioProducto.get(p.id) ?? 0;
    if (!(price > 0)) continue; // sin precio en esta sucursal: no se puede pedir
    const catId: string = p.category_id ?? "";
    productos.push({
      id: p.id, esPromo: false, name: p.name, price, image: p.cover_image_url ?? null,
      unit: p.unit_label === "kg" ? "por kg" : undefined,
      categoriaId: catId, categoriaNombre: nombreCategoria.get(catId) ?? "",
    });
  }

  const promos: ItemCatalogo[] = [];
  if (promosHabilitadas) {
    for (const p of (promosRaw ?? []) as any[]) {
      if (restringe && (!p.category_id || !categoriasHabilitadas!.includes(p.category_id))) continue;
      const price = precioPromo.get(p.id) ?? p.price ?? 0;
      if (!(price > 0)) continue;
      const catId: string = p.category_id ?? "promos";
      promos.push({
        id: p.id, esPromo: true, name: p.name, price, image: p.cover_image_url ?? null,
        badge: p.tipo === "receta" ? "RECETA" : "PROMO",
        categoriaId: catId, categoriaNombre: p.category_id ? (nombreCategoria.get(catId) ?? "") : "Promos",
      });
    }
  }

  const catalogo: CategoriaCatalogo[] = [];
  const promosSueltas = promos.filter((p) => p.categoriaId === "promos");
  if (promosSueltas.length > 0) catalogo.push({ id: "promos", name: "Promos", items: promosSueltas });
  for (const c of categorias) {
    const items = [
      ...promos.filter((p) => p.categoriaId === c.id),
      ...productos.filter((p) => p.categoriaId === c.id),
    ];
    if (items.length > 0) catalogo.push({ id: c.id, name: c.name, items });
  }

  const config: ConfigTienda = {
    sucursalId,
    nombre: sucursal.nombre,
    direccion: sucursal.direccion ?? null,
    localidad: sucursal.localidad ?? null,
    habilitado: !!sucursal.pedidos_online_habilitado,
    retiroHabilitado: sucursal.retiro_habilitado ?? true,
    deliveryHabilitado: !!sucursal.delivery_habilitado,
    minimoEnvio: Number(sucursal.pedido_minimo_envio ?? 0),
    retiroEtaMin: sucursal.retiro_eta_min ?? 15,
    retiroEtaMax: sucursal.retiro_eta_max ?? 20,
    whatsapp: sucursal.whatsapp_pedidos ?? null,
    horario: normalizarHorario(sucursal.horario_pedidos),
    zonas: ((zonasRaw ?? []) as any[]).map((z) => ({
      id: z.id, nombre: z.nombre, costo: Number(z.costo), etaMin: z.eta_min, etaMax: z.eta_max,
    })),
  };

  return <Tienda config={config} catalogo={catalogo} />;
}
