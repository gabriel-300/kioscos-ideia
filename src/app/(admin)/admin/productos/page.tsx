import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsTable } from "./_components/products-table";

export const metadata: Metadata = { title: "Productos — Kioscos IDEIA" };
export const revalidate = 0;

export default async function ProductosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: products }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select("*, category:categories(*)")
      .order("name"),
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Productos</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Catálogo de reventa disponible para los kioscos</p>
        </div>
      </div>

      <ProductsTable
        products={(products ?? []) as Parameters<typeof ProductsTable>[0]["products"]}
        categories={categories ?? []}
      />
    </div>
  );
}
