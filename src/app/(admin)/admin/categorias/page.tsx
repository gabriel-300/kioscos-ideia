import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CategoriasList } from "./_components/categorias-list";
import { alcanceCatalogo } from "@/lib/auth/catalogo-propio";

export const metadata: Metadata = { title: "Categorías — Kioscos IDEIA" };
export const revalidate = 0;

export default async function CategoriasPage() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) redirect("/login");

  // Admin: todas. Concesionario con catálogo propio: solo las suyas (migración 131).
  const role = user.app_metadata?.role as string | undefined;
  const alcance = role ? await alcanceCatalogo(user.id, role) : null;
  if (!alcance) redirect("/admin/dashboard");

  let q = supabase.from("categories").select("*").order("sort_order").order("name");
  if (alcance.ownerSucursalId) q = (q as any).eq("owner_sucursal_id", alcance.ownerSucursalId);
  const { data: categoriasTodas } = await q;
  // El admin gestiona las categorías de IDEIA; las de un local independiente las maneja su dueño.
  const categories = (categoriasTodas ?? []).filter((c) => alcance.ownerSucursalId || !(c as { owner_sucursal_id?: string | null }).owner_sucursal_id);

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
