import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsTable } from "./_components/products-table";

export const metadata: Metadata = { title: "Productos — Kioscos IDEIA" };
export const revalidate = 0;

export default async function ProductosPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;

  const [{ data: products }, { data: categories }, stockActivoRes] = await Promise.all([
    supabase.from("products").select("*, category:categories(*)").order("name"),
    supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
    (admin as any)
      .from("stock_sucursal")
      .select("product_id, sucursal_id, stock_actual")
      .gt("stock_actual", 0) as unknown as Promise<{
        data: { product_id: string; sucursal_id: string; stock_actual: number }[] | null;
      }>,
  ]);

  // Detectar productos inactivos con stock remanente
  const inactivosMap: Record<string, string> = {};
  for (const p of products ?? []) {
    if (!p.is_active) inactivosMap[p.id] = p.name;
  }
  const stockByInactivo: Record<string, { nombre: string; totalStock: number; suc: number }> = {};
  for (const s of stockActivoRes.data ?? []) {
    if (!inactivosMap[s.product_id]) continue;
    if (!stockByInactivo[s.product_id]) {
      stockByInactivo[s.product_id] = { nombre: inactivosMap[s.product_id], totalStock: 0, suc: 0 };
    }
    stockByInactivo[s.product_id].totalStock += s.stock_actual;
    stockByInactivo[s.product_id].suc++;
  }
  const inactivosConStock = Object.entries(stockByInactivo).map(([id, v]) => ({ id, ...v }));

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Productos</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Catálogo de reventa disponible para los kioscos</p>
        </div>
      </div>

      {inactivosConStock.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">
            {inactivosConStock.length} {inactivosConStock.length === 1 ? "producto inactivo tiene" : "productos inactivos tienen"} stock disponible en sucursales
          </p>
          <div className="mt-2 space-y-0.5">
            {inactivosConStock.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs text-amber-700">
                <span className="font-medium">{p.nombre}</span>
                <span className="text-amber-400">·</span>
                <span>{p.totalStock} unid. en {p.suc} sucursal{p.suc !== 1 ? "es" : ""}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-600 mt-2">Considerá ajustar o transferir el stock antes de desactivar definitivamente.</p>
        </div>
      )}

      <ProductsTable
        products={(products ?? []) as Parameters<typeof ProductsTable>[0]["products"]}
        categories={categories ?? []}
        role={role}
      />
    </div>
  );
}
