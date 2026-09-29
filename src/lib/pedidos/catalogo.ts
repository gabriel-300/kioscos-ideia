import { createAdminClient } from "@/lib/supabase/server";

// Catálogo de pedidos online de UNA sucursal: qué se puede pedir y a qué
// precio. Única fuente para el storefront (/pedir), el bot de WhatsApp y la
// sugerencia de IA -- antes cada uno tenía su copia del filtro y ya habían
// empezado a diferir. pricing.ts sigue revalidando lo mismo al cobrar (ahí
// parte de ids que manda el cliente, otro problema), pero la regla de qué es
// "pedible" es esta:
//   - producto/promo activo, y producto con vendible_pos distinto de false
//   - si la sucursal restringe categorías, solo las habilitadas
//   - promos solo si promos_habilitadas
//   - con precio > 0 en ESA sucursal (promo: el de la sucursal o el global)
// Nunca se lee costo ni margen.

export type ItemCatalogo = {
  id:          string; // product_id o promo_id
  esPromo:     boolean;
  name:        string;
  price:       number;
  image:       string | null;
  categoriaId: string | null;
  unidad?:     string;                 // "por kg"
  etiqueta?:   "PROMO" | "RECETA";
};

export type GrupoCatalogo = { id: string; name: string; items: ItemCatalogo[] };

export type RestriccionesCatalogo = {
  categoriasHabilitadas: string[] | null; // null o vacío = sin restricción
  promosHabilitadas:     boolean;
};

export type CatalogoSucursal = {
  items:  ItemCatalogo[];
  grupos: GrupoCatalogo[]; // lo que se muestra: "Promos" primero, después cada categoría con contenido
};

export const GRUPO_PROMOS = "promos";

type Fila = Record<string, any>;

export type DatosCatalogo = {
  categorias:      Fila[]; // {id, name}, ya ordenadas
  productos:       Fila[]; // {id, name, cover_image_url, category_id, unit_label, vendible_pos}
  preciosProducto: Fila[]; // {product_id, precio_dist}
  promos:          Fila[]; // {id, name, price, tipo, cover_image_url, category_id}
  preciosPromo:    Fila[]; // {promo_id, price}
};

// Puro: aplica las reglas de arriba sobre filas ya leídas.
export function armarCatalogo(datos: DatosCatalogo, restricciones: RestriccionesCatalogo): CatalogoSucursal {
  const habilitadas = restricciones.categoriasHabilitadas;
  const restringe = !!habilitadas && habilitadas.length > 0;
  const categoriaPermitida = (id: string | null) => !restringe || (!!id && habilitadas!.includes(id));

  const precioProducto = new Map<string, number>(datos.preciosProducto.map((p) => [p.product_id, p.precio_dist]));
  const precioPromo = new Map<string, number>(datos.preciosPromo.map((p) => [p.promo_id, p.price]));

  const categorias = datos.categorias.filter((c) => categoriaPermitida(c.id));

  const productos: ItemCatalogo[] = [];
  for (const p of datos.productos) {
    if (p.vendible_pos === false || !categoriaPermitida(p.category_id ?? null)) continue;
    const price = precioProducto.get(p.id) ?? 0;
    if (!(price > 0)) continue;
    productos.push({
      id: p.id, esPromo: false, name: p.name, price,
      image: p.cover_image_url ?? null, categoriaId: p.category_id ?? null,
      unidad: p.unit_label === "kg" ? "por kg" : undefined,
    });
  }

  const promos: ItemCatalogo[] = [];
  if (restricciones.promosHabilitadas) {
    for (const p of datos.promos) {
      if (!categoriaPermitida(p.category_id ?? null)) continue;
      const price = precioPromo.get(p.id) ?? p.price ?? 0;
      if (!(price > 0)) continue;
      promos.push({
        id: p.id, esPromo: true, name: p.name, price,
        image: p.cover_image_url ?? null, categoriaId: p.category_id ?? null,
        etiqueta: p.tipo === "receta" ? "RECETA" : "PROMO",
      });
    }
  }

  // Una promo sin categoría va al grupo "Promos". Un producto sin categoría no
  // se muestra (igual que siempre en el storefront).
  const grupos: GrupoCatalogo[] = [];
  const promosSueltas = promos.filter((p) => !p.categoriaId);
  if (promosSueltas.length > 0) grupos.push({ id: GRUPO_PROMOS, name: "Promos", items: promosSueltas });
  for (const c of categorias) {
    const items = [
      ...promos.filter((p) => p.categoriaId === c.id),
      ...productos.filter((p) => p.categoriaId === c.id),
    ];
    if (items.length > 0) grupos.push({ id: c.id, name: c.name, items });
  }

  return { items: [...promos, ...productos], grupos };
}

// Si el llamador ya leyó la sucursal (como /pedir) pasa las restricciones y se
// evita una consulta.
export async function cargarCatalogoSucursal(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  restricciones?: RestriccionesCatalogo
): Promise<CatalogoSucursal> {
  // (admin as any): categorias_habilitadas/promos_habilitadas y las columnas de
  // promos no están en los tipos generados -- mismo patrón que el resto.
  const restr = restricciones ?? await leerRestricciones(admin, sucursalId);

  const [categorias, productos, preciosProducto, promos, preciosPromo] = await Promise.all([
    admin.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    (admin as any).from("products").select("id, name, cover_image_url, category_id, unit_label, vendible_pos").eq("is_active", true).neq("sku", "MULTA-TERMO").order("name"),
    admin.from("product_prices").select("product_id, precio_dist").eq("sucursal_id", sucursalId),
    (admin as any).from("promos").select("id, name, price, tipo, cover_image_url, category_id").eq("is_active", true).order("name"),
    (admin as any).from("promo_prices").select("promo_id, price").eq("sucursal_id", sucursalId),
  ]);

  return armarCatalogo({
    categorias:      categorias.data ?? [],
    productos:       productos.data ?? [],
    preciosProducto: preciosProducto.data ?? [],
    promos:          promos.data ?? [],
    preciosPromo:    preciosPromo.data ?? [],
  }, restr);
}

async function leerRestricciones(admin: ReturnType<typeof createAdminClient>, sucursalId: string): Promise<RestriccionesCatalogo> {
  const { data } = await (admin as any)
    .from("sucursales")
    .select("categorias_habilitadas, promos_habilitadas")
    .eq("id", sucursalId)
    .single();
  return { categoriasHabilitadas: data?.categorias_habilitadas ?? null, promosHabilitadas: data?.promos_habilitadas ?? true };
}
