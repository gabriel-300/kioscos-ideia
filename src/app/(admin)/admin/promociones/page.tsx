import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PromosTable } from "./_components/promos-table";
import type { PromoWithItems } from "./_components/promos-table";
import { alcanceCatalogo } from "@/lib/auth/catalogo-propio";

export const metadata: Metadata = { title: "Promociones — Kioscos IDEIA" };
export const revalidate = 0;

export default async function PromocionesPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  // Admin: todo. Concesionario con catálogo propio: sus promos, y para armarlas sus
  // productos más los globales (migración 131). Un dueño solo ve su sucursal.
  const alcance = role ? await alcanceCatalogo(user.id, role) : null;
  if (!alcance) redirect("/admin/dashboard");
  const dueno = alcance.ownerSucursalId;

  let qPromos = (supabase as any)
    .from("promos")
    .select("*, promo_prices(sucursal_id, price), promo_items(id, product_id, cantidad, product:products(id, name, unit_label))")
    .order("name");
  let qSucursales: any = (supabase as any).from("sucursales").select("id, nombre, catalogo_propio").eq("is_active", true).order("nombre");
  if (dueno) {
    qPromos = qPromos.eq("owner_sucursal_id", dueno);
    qSucursales = qSucursales.eq("id", dueno);
  }

  const [{ data: promos }, { data: products }, { data: categories }, { data: sucursales }] = await Promise.all([
    qPromos as unknown as Promise<{ data: PromoWithItems[] | null }>,
    (supabase as any).from("products").select("id, name, unit_label, owner_sucursal_id").eq("is_active", true).order("name") as Promise<{ data: { id: string; name: string; unit_label: string; owner_sucursal_id: string | null }[] | null }>,
    (supabase as any).from("categories").select("id, name, owner_sucursal_id").eq("is_active", true).order("sort_order").order("name") as Promise<{ data: { id: string; name: string; owner_sucursal_id: string | null }[] | null }>,
    qSucursales,
  ]);
  // El admin arma las promos de IDEIA solo con lo global; el dueño con lo global y lo suyo (la RLS ya le
  // oculta lo de los demás). Las promos propias del dueño se ven en las listas de arriba, no en los selectores del admin.
  const productosElegibles = (products ?? []).filter((p) => dueno || !p.owner_sucursal_id);
  const categoriasElegibles = (categories ?? []).filter((c) => dueno || !c.owner_sucursal_id);

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Promociones y recetas</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Combos y productos preparados que descuentan stock de sus productos componentes</p>
        </div>
      </div>

      <PromosTable
        promos={(promos ?? []).filter((p) => dueno || !(p as { owner_sucursal_id?: string | null }).owner_sucursal_id)}
        products={productosElegibles}
        categories={categoriasElegibles}
        // El admin carga precios de promos solo en los kioscos de IDEIA; el dueño, en el suyo.
        sucursales={((sucursales ?? []) as { id: string; nombre: string; catalogo_propio?: boolean | null }[]).filter((s) => dueno || s.catalogo_propio !== true)}
      />
    </div>
  );
}
