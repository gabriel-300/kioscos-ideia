import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { StockTable } from "./_components/stock-table";

export const metadata: Metadata = { title: "Stock kioscos — Kioscos IDEIA" };
export const revalidate = 0;

export default async function StockPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: sucursales },
    { data: products },
    { data: categories },
    { data: movimientos },
  ] = await Promise.all([
    supabase
      .from("sucursales")
      .select("id, nombre")
      .eq("is_active", true)
      .order("nombre"),
    (supabase as any)
      .from("products")
      .select("id, name, sku, category_id, unit_label, stock_minimo")
      .eq("is_active", true)
      .order("name") as unknown as Promise<{ data: { id: string; name: string; sku: string; category_id: string | null; unit_label: string; stock_minimo: number }[] | null }>,
    supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("movimientos")
      .select("tipo, sucursal_id, movimiento_items(product_id, cantidad)")
      .in("tipo", ["entrega", "devolucion", "venta"]),
  ]);

  // Construir matriz: stockMap[sucursal_id][product_id] = cantidad
  const stockMap: Record<string, Record<string, number>> = {};
  for (const m of movimientos ?? []) {
    if (!m.sucursal_id) continue;
    if (!stockMap[m.sucursal_id]) stockMap[m.sucursal_id] = {};
    for (const item of m.movimiento_items) {
      const delta = m.tipo === "entrega" ? item.cantidad : -item.cantidad; // devolucion y venta restan
      stockMap[m.sucursal_id][item.product_id] =
        (stockMap[m.sucursal_id][item.product_id] ?? 0) + delta;
    }
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Stock kioscos</h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            Stock estimado por producto en cada kiosco · calculado desde el historial de movimientos
          </p>
        </div>
      </div>

      <StockTable
        sucursales={sucursales ?? []}
        products={products ?? []}
        categories={categories ?? []}
        stockMap={stockMap}
      />
    </div>
  );
}
