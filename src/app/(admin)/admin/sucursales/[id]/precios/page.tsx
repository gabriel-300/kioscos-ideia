import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PreciosTable, type ProductoPrecio } from "./_components/precios-table";

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("sucursales").select("nombre").eq("id", id).single();
  return { title: data ? `Precios — ${data.nombre}` : "Precios" };
}

export default async function PreciosSucursalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const admin    = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  // Solo admin y concesionario -- mismo criterio que costo/margen del resto
  // de la sucursal (encargado/vendedor no ven costo, acá tampoco).
  if (role !== "admin" && role !== "concesionario") redirect("/admin/dashboard");

  const { data: sucursal } = await (supabase as any).from("sucursales").select("id, nombre, encargado_user_id, categorias_habilitadas").eq("id", id).single();
  if (!sucursal) notFound();
  if (role === "concesionario" && sucursal.encargado_user_id !== user.id) redirect("/admin/dashboard");

  // Mismo filtro que Venta Rápida (migración 088) -- si esta sucursal solo
  // vende ciertas categorías, no tiene sentido dejarle poner precio a lo que
  // no puede vender.
  const categoriasHabilitadas: string[] | null = (sucursal as any).categorias_habilitadas ?? null;

  const [{ data: productsRaw }, { data: categories }, { data: preciosRaw }] = await Promise.all([
    (admin as any)
      .from("products")
      .select("id, name, sku, category_id, unit_label")
      .eq("is_active", true)
      .neq("sku", "MULTA-TERMO")
      .order("name") as unknown as Promise<{ data: { id: string; name: string; sku: string; category_id: string | null; unit_label: string }[] | null }>,
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order"),
    admin.from("product_prices").select("product_id, precio_dist, costo").eq("sucursal_id", id) as unknown as Promise<{
      data: { product_id: string; precio_dist: number; costo: number }[] | null;
    }>,
  ]);

  const precioMap = new Map((preciosRaw ?? []).map((p) => [p.product_id, p]));
  const categoriaMap = new Map((categories ?? []).map((c) => [c.id, c.name]));

  const productsFiltrados = categoriasHabilitadas && categoriasHabilitadas.length > 0
    ? (productsRaw ?? []).filter((p) => p.category_id && categoriasHabilitadas.includes(p.category_id))
    : (productsRaw ?? []);

  const productos: ProductoPrecio[] = productsFiltrados.map((p) => {
    const precio = precioMap.get(p.id);
    return {
      id:          p.id,
      nombre:      p.name,
      sku:         p.sku,
      categoria:   p.category_id ? (categoriaMap.get(p.category_id) ?? null) : null,
      unitLabel:   p.unit_label,
      precioDist:  precio?.precio_dist ?? null,
      costo:       precio?.costo ?? null,
    };
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <Link
          href={`/admin/sucursales/${sucursal.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-700 mb-3 transition-colors"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          {sucursal.nombre}
        </Link>
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Precios — {sucursal.nombre}</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Precio de venta y costo de tus productos. El nombre/SKU es del catálogo general, no se edita acá.</p>
      </div>

      <PreciosTable sucursalId={sucursal.id} productos={productos} />
    </div>
  );
}
