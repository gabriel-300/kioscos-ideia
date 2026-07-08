import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PromosTable } from "./_components/promos-table";
import type { PromoWithItems } from "./_components/promos-table";

export const metadata: Metadata = { title: "Promociones — Kioscos IDEIA" };
export const revalidate = 0;

export default async function PromocionesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin") redirect("/admin/dashboard");

  const [{ data: promos }, { data: products }] = await Promise.all([
    (supabase as any)
      .from("promos")
      .select("*, promo_items(id, product_id, cantidad, product:products(id, name, unit_label))")
      .order("name") as unknown as Promise<{ data: PromoWithItems[] | null }>,
    supabase.from("products").select("id, name, unit_label").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Promociones y recetas</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Combos y productos preparados que descuentan stock de sus productos componentes</p>
        </div>
      </div>

      <PromosTable
        promos={promos ?? []}
        products={products ?? []}
      />
    </div>
  );
}
