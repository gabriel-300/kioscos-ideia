import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StockTable } from "./_components/stock-table";

export const metadata: Metadata = { title: "Stock kioscos — Kioscos IDEIA" };
export const revalidate = 0;

export default async function StockPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "";
  const isStaff = role === "encargado" || role === "vendedor";

  let staffSucursalId: string | null = null;
  if (role === "encargado") {
    const { data } = await supabase.from("sucursales").select("id").eq("encargado_user_id", user.id).single();
    staffSucursalId = data?.id ?? null;
  } else if (role === "vendedor") {
    const res = await (supabase as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    staffSucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
  }

  const [
    { data: products },
    { data: categories },
  ] = await Promise.all([
    (supabase as any)
      .from("products")
      .select("id, name, sku, category_id, unit_label, stock_minimo")
      .eq("is_active", true)
      .order("name") as unknown as Promise<{ data: { id: string; name: string; sku: string; category_id: string | null; unit_label: string; stock_minimo: number }[] | null }>,
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  // Vista plana para encargado/vendedor (una sucursal)
  if (isStaff && staffSucursalId) {
    const { data: sucursal } = await supabase
      .from("sucursales").select("id, nombre").eq("id", staffSucursalId).single();

    const stockRes = await (supabase as any)
      .from("stock_sucursal")
      .select("product_id, entradas, salidas, stock_actual")
      .eq("sucursal_id", staffSucursalId);
    const stockRows = stockRes.data as { product_id: string; entradas: number; salidas: number; stock_actual: number }[] | null;

    const entradaMap: Record<string, number> = {};
    const salidaMap:  Record<string, number> = {};
    const stockMap:   Record<string, number> = {};
    for (const r of stockRows ?? []) {
      entradaMap[r.product_id] = r.entradas;
      salidaMap[r.product_id]  = r.salidas;
      stockMap[r.product_id]   = r.stock_actual;
    }

    return (
      <div className="p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Stock</h1>
          <p className="text-sm text-neutral-400 mt-0.5">
            {sucursal?.nombre} · estimado desde el historial de movimientos
          </p>
        </div>
        <StockTable
          products={products ?? []}
          categories={categories ?? []}
          flatStockMap={stockMap}
          entradaMap={entradaMap}
          salidaMap={salidaMap}
          sucursalId={staffSucursalId ?? undefined}
          canAjustar={role === "encargado"}
        />
      </div>
    );
  }

  // Vista matriz para admin (todas las sucursales) — misma fuente que la vista
  // de encargado/vendedor (stock_sucursal), para no reimplementar la fórmula
  // de stock a mano (eso hacía que "Ajuste de stock" no se viera acá).
  const [
    { data: sucursales },
    { data: stockRows },
  ] = await Promise.all([
    supabase.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    (supabase as any)
      .from("stock_sucursal")
      .select("sucursal_id, product_id, stock_actual") as unknown as Promise<{
        data: { sucursal_id: string; product_id: string; stock_actual: number }[] | null;
      }>,
  ]);

  const matrixMap: Record<string, Record<string, number>> = {};
  for (const r of stockRows ?? []) {
    if (!matrixMap[r.sucursal_id]) matrixMap[r.sucursal_id] = {};
    matrixMap[r.sucursal_id][r.product_id] = r.stock_actual;
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Stock kioscos</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Stock estimado por producto · calculado desde el historial de movimientos
        </p>
      </div>
      <StockTable
        sucursales={sucursales ?? []}
        products={products ?? []}
        categories={categories ?? []}
        stockMap={matrixMap}
      />
    </div>
  );
}
