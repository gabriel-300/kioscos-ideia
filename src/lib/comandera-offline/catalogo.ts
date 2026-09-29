import type { createAdminClient } from "@/lib/supabase/server";

// Catálogo de la comandera offline: lo que se incorpora dentro del archivo HTML
// que se descarga. Es un "congelado" de los precios de la sucursal al momento de
// generarlo -- la comandera no vuelve a consultar nada (no hay internet).
//
// Mismo filtro que el storefront (src/app/pedir/[sucursal]/page.tsx): activo,
// vendible_pos, categorías/promos habilitadas de la sucursal y precio > 0 en esa
// sucursal. Nunca lleva costo ni margen. Además deja afuera los productos que se
// venden por kg: la comandera cobra unidades a precio fijo y no pesa.

export type ItemComandera = { id: string; nombre: string; precio: number; promo?: boolean };
export type CategoriaComandera = { id: string; nombre: string; items: ItemComandera[] };
export type CatalogoComandera = {
  sucursalId: string;
  sucursalNombre: string;
  titulo: string; // lo que se ve en pantalla y en el ticket: el nombre de la sucursal o del evento
  clave: string;  // identifica los datos guardados en el navegador (ventas y contador de tickets)
  generado: string; // ISO
  categorias: CategoriaComandera[];
  omitidosPorKg: string[]; // nombres, para avisarle a quien descarga
};

type SucursalRaw = { id: string; nombre: string; categorias_habilitadas: string[] | null; promos_habilitadas: boolean | null };
type CategoriaRaw = { id: string; name: string };
type ProductoRaw = { id: string; name: string; category_id: string | null; unit_label: string | null; vendible_pos: boolean | null };
type PromoRaw = { id: string; name: string; price: number | null; category_id: string | null };

export function armarCatalogoComandera(input: {
  sucursal: SucursalRaw;
  categorias: CategoriaRaw[];
  productos: ProductoRaw[];
  precios: { product_id: string; precio_dist: number | string | null }[];
  promos: PromoRaw[];
  preciosPromo: { promo_id: string; price: number | string | null }[];
  ahora?: Date;
}): CatalogoComandera {
  const { sucursal } = input;
  const habilitadas = sucursal.categorias_habilitadas ?? null;
  const restringe = !!habilitadas && habilitadas.length > 0;
  const promosHabilitadas = sucursal.promos_habilitadas ?? true;

  const precioProducto = new Map(input.precios.map((p) => [p.product_id, Number(p.precio_dist)]));
  const precioPromo = new Map(input.preciosPromo.map((p) => [p.promo_id, Number(p.price)]));

  const PROMOS_ID = "promos";
  let categorias = restringe ? input.categorias.filter((c) => habilitadas!.includes(c.id)) : input.categorias;
  const porCategoria = new Map<string, ItemComandera[]>(categorias.map((c) => [c.id, []]));
  const omitidosPorKg: string[] = [];

  for (const p of input.productos) {
    if (p.vendible_pos === false) continue;
    if (!p.category_id || !porCategoria.has(p.category_id)) continue; // sin categoría o fuera de las habilitadas
    const precio = precioProducto.get(p.id) ?? 0;
    if (!(precio > 0)) continue;
    if (p.unit_label === "kg") { omitidosPorKg.push(p.name.trim()); continue; }
    porCategoria.get(p.category_id)!.push({ id: p.id, nombre: p.name.trim(), precio });
  }

  if (promosHabilitadas) {
    for (const p of input.promos) {
      // Sin categoría solo se ofrece si la sucursal no restringe (van a "Promos").
      const catId = p.category_id ?? (restringe ? null : PROMOS_ID);
      if (!catId) continue;
      if (catId === PROMOS_ID && !porCategoria.has(PROMOS_ID)) { porCategoria.set(PROMOS_ID, []); categorias = [...categorias, { id: PROMOS_ID, name: "Promos" }]; }
      if (!porCategoria.has(catId)) continue;
      const precio = precioPromo.get(p.id) ?? Number(p.price ?? 0);
      if (!(precio > 0)) continue;
      porCategoria.get(catId)!.push({ id: p.id, nombre: p.name.trim(), precio, promo: true });
    }
  }

  return {
    sucursalId: sucursal.id,
    sucursalNombre: sucursal.nombre,
    titulo: sucursal.nombre,
    clave: sucursal.id,
    generado: (input.ahora ?? new Date()).toISOString(),
    categorias: categorias
      .map((c) => ({ id: c.id, nombre: c.name, items: porCategoria.get(c.id)!.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")) }))
      .filter((c) => c.items.length > 0),
    omitidosPorKg,
  };
}

export async function cargarCatalogoComandera(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string
): Promise<CatalogoComandera | null> {
  const db = admin as any; // categorias_habilitadas/promos_habilitadas no están en los tipos generados
  const { data: sucursal } = await db
    .from("sucursales")
    .select("id, nombre, categorias_habilitadas, promos_habilitadas")
    .eq("id", sucursalId)
    .maybeSingle();
  if (!sucursal) return null;

  // Un kiosco tiene unos cientos de productos: entra holgado en el límite de 1.000 filas.
  const [cats, prods, precios, promos, preciosPromo] = await Promise.all([
    db.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    db.from("products").select("id, name, category_id, unit_label, vendible_pos").eq("is_active", true).neq("sku", "MULTA-TERMO"),
    db.from("product_prices").select("product_id, precio_dist").eq("sucursal_id", sucursalId),
    db.from("promos").select("id, name, price, category_id").eq("is_active", true),
    db.from("promo_prices").select("promo_id, price").eq("sucursal_id", sucursalId),
  ]);

  return armarCatalogoComandera({
    sucursal,
    categorias: cats.data ?? [],
    productos: prods.data ?? [],
    precios: precios.data ?? [],
    promos: promos.data ?? [],
    preciosPromo: preciosPromo.data ?? [],
  });
}

export function slugComandera(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

// Convierte el catálogo de una sucursal en el de un EVENTO: usa el nombre del evento en pantalla y
// ticket, y se queda solo con los productos elegidos. La clave incluye el nombre del evento: volver a
// descargar el archivo del mismo evento (por un precio nuevo) sigue la numeración de tickets; uno con
// otro nombre arranca en 1 y no se mezcla con las ventas de otro evento.
export function paraEvento(catalogo: CatalogoComandera, evento: string, ids: string[]): CatalogoComandera {
  const titulo = evento.replace(/\s+/g, " ").trim().slice(0, 40);
  const elegidos = new Set(ids);
  return {
    ...catalogo,
    titulo,
    clave: `${catalogo.sucursalId}:${slugComandera(titulo)}`,
    categorias: catalogo.categorias
      .map((c) => ({ ...c, items: c.items.filter((i) => elegidos.has(i.id)) }))
      .filter((c) => c.items.length > 0),
  };
}
