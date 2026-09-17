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
      <header className="relative overflow-hidden bg-tierra-800 text-white px-4 pt-7 pb-8 md:px-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: "radial-gradient(120% 140% at 15% -10%, var(--color-tierra-500) 0%, transparent 55%)" }}
        />
        <div className="relative max-w-3xl mx-auto">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tierra-200 mb-1.5">Pedí online</p>
          <h1 className="text-[28px] leading-tight md:text-4xl font-display font-semibold">{sucursal.nombre}</h1>
          {(sucursal.direccion || sucursal.localidad) && (
            <p className="flex items-center gap-1.5 text-sm text-white/65 mt-2">
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-3.5 shrink-0">
                <path fillRule="evenodd" d="M9.69 18.933a.75.75 0 00.62 0c.058-.026.157-.079.28-.156a19.302 19.302 0 002.617-1.956C15.09 15.041 17 12.634 17 9.75 17 5.365 13.866 2 10 2S3 5.365 3 9.75c0 2.884 1.909 5.291 3.79 7.071a19.298 19.298 0 002.899 2.112zM10 12a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" clipRule="evenodd" />
              </svg>
              {[sucursal.direccion, sucursal.localidad].filter(Boolean).join(", ")}
            </p>
          )}
        </div>
      </header>

      {!sinNada && (
        <nav className="sticky top-0 z-10 bg-crema-50/90 backdrop-blur-sm border-b border-neutral-200/70 overflow-x-auto">
          <div className="flex gap-2 px-4 py-3 md:px-8 max-w-3xl mx-auto">
            {itemsSinCategoria.length > 0 && (
              <a href="#promos" className="shrink-0 text-xs font-semibold px-3.5 py-2 rounded-full bg-tierra-700 text-white shadow-sm shadow-tierra-700/20">
                Promos
              </a>
            )}
            {categoriasConItems.map((c) => (
              <a
                key={c.id}
                href={`#cat-${c.id}`}
                className="shrink-0 text-xs font-semibold px-3.5 py-2 rounded-full bg-white text-neutral-600 border border-neutral-200 hover:border-tierra-300 hover:text-tierra-700 transition-colors"
              >
                {c.name}
              </a>
            ))}
          </div>
        </nav>
      )}

      <main className="max-w-3xl mx-auto px-4 py-7 md:px-8">
        {sinNada ? (
          <div className="text-center py-20">
            <p className="text-sm text-neutral-400">Todavía no hay productos cargados para pedir acá.</p>
          </div>
        ) : (
          <CatalogoConCarrito sucursalId={sucursalId} categorias={categoriasConItems} itemsSinCategoria={itemsSinCategoria} />
        )}
      </main>

      <footer className="text-center text-xs text-neutral-400 py-10 px-4">
        <p className="font-display text-sm text-neutral-500 mb-1">Kioscos IDEIA</p>
        Retirás tu pedido en el local o lo pedís por delivery. Pagás con QR de Mercado Pago.
      </footer>
    </div>
  );
}
