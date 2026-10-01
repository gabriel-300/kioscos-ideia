import type { createAdminClient } from "@/lib/supabase/server";
import { puertoKiosco, type DatosCatalogo, type RestriccionesCatalogo } from "@/lib/tenteo/puerto-kiosco";

export type { DatosCatalogo, RestriccionesCatalogo };

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
//   - con stock: lo agotado no se ofrece, así el cliente no arma un carrito que después
//     se le rechaza. Misma regla que chequearStockLiviano (stock.ts): sin fila de stock
//     = stock desconocido = se ofrece; con fila, tiene que alcanzar. Una promo se ofrece
//     si alcanza el stock de TODOS sus componentes.
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

export type CatalogoSucursal = {
  items:  ItemCatalogo[];
  grupos: GrupoCatalogo[]; // lo que se muestra: "Promos" primero, después cada categoría con contenido
};

export const GRUPO_PROMOS = "promos";

type Fila = Record<string, any>;

// Puro: aplica las reglas de arriba sobre filas ya leídas.
export function armarCatalogo(datos: DatosCatalogo, restricciones: RestriccionesCatalogo): CatalogoSucursal {
  const habilitadas = restricciones.categoriasHabilitadas;
  const restringe = !!habilitadas && habilitadas.length > 0;
  const categoriaPermitida = (id: string | null) => !restringe || (!!id && habilitadas!.includes(id));

  const precioProducto = new Map<string, number>(datos.preciosProducto.map((p) => [p.product_id, p.precio_dist]));
  const precioPromo = new Map<string, number>(datos.preciosPromo.map((p) => [p.promo_id, p.price]));

  const stock = new Map<string, number>();
  for (const r of datos.stock) if (r.stock_actual != null) stock.set(r.product_id, Number(r.stock_actual));
  const hayStock = (productId: string, necesario = 1) => {
    const disponible = stock.get(productId);
    return disponible === undefined || disponible >= necesario;
  };
  const componentesDe = new Map<string, Fila[]>();
  for (const c of datos.componentes) componentesDe.set(c.promo_id, [...(componentesDe.get(c.promo_id) ?? []), c]);

  const categorias = datos.categorias.filter((c) => categoriaPermitida(c.id));

  const productos: ItemCatalogo[] = [];
  for (const p of datos.productos) {
    if (p.vendible_pos === false || !categoriaPermitida(p.category_id ?? null)) continue;
    const price = precioProducto.get(p.id) ?? 0;
    if (!(price > 0) || !hayStock(p.id)) continue;
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
      if (!(componentesDe.get(p.id) ?? []).every((c) => hayStock(c.product_id, Number(c.cantidad) || 1))) continue;
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
// evita una consulta. Los datos salen del puerto hacia el kiosco.
export async function cargarCatalogoSucursal(
  admin: ReturnType<typeof createAdminClient>,
  sucursalId: string,
  restricciones?: RestriccionesCatalogo
): Promise<CatalogoSucursal> {
  const kiosco = puertoKiosco(admin);
  const restr = restricciones ?? await kiosco.restricciones(sucursalId);
  return armarCatalogo(await kiosco.datosCatalogo(sucursalId), restr);
}
