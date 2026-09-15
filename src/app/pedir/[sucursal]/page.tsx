import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { CatalogoConCarrito, type CategoriaConItems, type ItemCatalogo } from "./_components/catalogo-con-carrito";

// Fase 1 (catálogo) + Fase 2 (carrito/checkout) del storefront público (ver
// plan "linked-brewing-moon"). Nadie necesita sesión para entrar acá (ver la
// exclusión agregada en src/lib/supabase/middleware.ts para que tampoco
// redirija a un admin/vendedor logueado que la mire).
//
// Usa createAdminClient() (service role) igual que el resto del admin, no el
// cliente de sesión -- acá no hay ninguna sesión de la que depender. Nunca
// se lee/muestra costo ni margen (mismas columnas que ya se ocultan a
// encargado/vendedor en sucursales/[id]/page.tsx).
//
// La carga de datos y el filtrado (categorias_habilitadas/promos_habilitadas/
// vendible_pos) siguen siendo 100% server-side -- el Client Component solo
// recibe el catálogo ya resuelto, no vuelve a consultar Supabase.

export const revalidate = 0;

type Categoria = { id: string; name: string };
type Producto = {
  id: string;
  name: string;
  cover_image_url: string | null;
  category_id: string | null;
  unit_label: string | null;
  precio_dist: number;
};
type Promo = {
  id: string;
  name: string;
  price: number | null;
  tipo: "promo" | "receta";
  cover_image_url: string | null;
  category_id: string | null;
};

export async function generateMetadata({ params }: { params: Promise<{ sucursal: string }> }): Promise<Metadata> {
  const { sucursal } = await params;
  const admin = createAdminClient();
  const { data } = await admin.from("sucursales").select("nombre").eq("id", sucursal).single();
  return { title: data ? `Pedí en ${data.nombre} — Kioscos IDEIA` : "Pedí online — Kioscos IDEIA" };
}

export default async function PedirPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal: sucursalId } = await params;
  const admin = createAdminClient();

  // (sucursales as any): categorias_habilitadas/promos_habilitadas son de
  // migraciones 088/089, todavía no están en los tipos generados de
  // database.ts -- mismo patrón que el resto del proyecto (ver
  // feedback-typescript-cast).
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("id, nombre, direccion, localidad, is_active, categorias_habilitadas, promos_habilitadas")
    .eq("id", sucursalId)
    .single();

  if (!sucursal || !sucursal.is_active) notFound();

  const categoriasHabilitadas: string[] | null = (sucursal as any).categorias_habilitadas ?? null;
  const promosHabilitadas: boolean = (sucursal as any).promos_habilitadas ?? true;

  const [{ data: categoriesRaw }, { data: productsRaw }, { data: preciosRaw }, { data: promosRaw }] = await Promise.all([
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
  ]);

  const precioPorProducto = new Map((preciosRaw ?? []).map((p: any) => [p.product_id as string, p.precio_dist as number]));

  const categorias: Categoria[] = categoriasHabilitadas && categoriasHabilitadas.length > 0
    ? (categoriesRaw ?? []).filter((c) => categoriasHabilitadas.includes(c.id))
    : (categoriesRaw ?? []);

  let productos: Producto[] = (productsRaw ?? [])
    .filter((p: any) => p.vendible_pos !== false)
    .map((p: any) => ({
      id: p.id,
      name: p.name,
      cover_image_url: p.cover_image_url,
      category_id: p.category_id,
      unit_label: p.unit_label,
      precio_dist: precioPorProducto.get(p.id) ?? 0,
    }));
  if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
    productos = productos.filter((p) => p.category_id && categoriasHabilitadas.includes(p.category_id));
  }

  let promos: Promo[] = promosHabilitadas ? (promosRaw ?? []) : [];
  if (categoriasHabilitadas && categoriasHabilitadas.length > 0) {
    promos = promos.filter((p) => p.category_id && categoriasHabilitadas.includes(p.category_id));
  }
  const promosSinCategoria = promos.filter((p) => !p.category_id);

  function itemDeProducto(p: Producto): ItemCatalogo {
    return {
      id: p.id, esPromo: false, name: p.name, price: p.precio_dist, image: p.cover_image_url,
      unit: p.unit_label === "kg" ? "por kg" : undefined, category_id: p.category_id,
    };
  }
  function itemDePromo(p: Promo): ItemCatalogo {
    return {
      id: p.id, esPromo: true, name: p.name, price: p.price ?? 0, image: p.cover_image_url,
      badge: p.tipo === "receta" ? "Receta" : "Promo", category_id: p.category_id,
    };
  }

  const categoriasConItems: CategoriaConItems[] = categorias
    .map((c) => ({
      id: c.id,
      name: c.name,
      items: [
        ...promos.filter((p) => p.category_id === c.id).map(itemDePromo),
        ...productos.filter((p) => p.category_id === c.id).map(itemDeProducto),
      ],
    }))
    .filter((c) => c.items.length > 0);

  const itemsSinCategoria: ItemCatalogo[] = promosSinCategoria.map(itemDePromo);

  const sinNada = categoriasConItems.length === 0 && itemsSinCategoria.length === 0;

  return (
    <div className="min-h-screen bg-crema-50">
      <header className="bg-tierra-700 text-white px-4 py-6 md:px-8">
        <h1 className="text-2xl md:text-3xl font-display font-semibold">{sucursal.nombre}</h1>
        {(sucursal.direccion || sucursal.localidad) && (
          <p className="text-sm text-white/70 mt-1">
            {[sucursal.direccion, sucursal.localidad].filter(Boolean).join(", ")}
          </p>
        )}
      </header>

      {!sinNada && (
        <nav className="sticky top-0 z-10 bg-white border-b border-neutral-200 overflow-x-auto">
          <div className="flex gap-2 px-4 py-2.5 md:px-8">
            {itemsSinCategoria.length > 0 && (
              <a href="#promos" className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-tierra-50 text-tierra-700 border border-tierra-100">
                Promos
              </a>
            )}
            {categoriasConItems.map((c) => (
              <a
                key={c.id}
                href={`#cat-${c.id}`}
                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
              >
                {c.name}
              </a>
            ))}
          </div>
        </nav>
      )}

      <main className="max-w-3xl mx-auto px-4 py-6 md:px-8">
        {sinNada ? (
          <p className="text-center text-neutral-400 py-16 text-sm">
            Todavía no hay productos cargados para pedir acá.
          </p>
        ) : (
          <CatalogoConCarrito sucursalId={sucursalId} categorias={categoriasConItems} itemsSinCategoria={itemsSinCategoria} />
        )}
      </main>

      <footer className="text-center text-xs text-neutral-400 py-8">
        Kioscos IDEIA — retirás tu pedido en el local, pagás con QR de Mercado Pago.
      </footer>
    </div>
  );
}
