import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CategoriasList } from "./_components/categorias-list";

export const metadata: Metadata = { title: "Categorías — Kioscos IDEIA" };
export const revalidate = 0;

export default async function CategoriasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .order("sort_order")
    .order("name");

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Categorías</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Organizá los productos del catálogo por categoría</p>
      </div>

      <CategoriasList categories={categories ?? []} />
    </div>
  );
}
