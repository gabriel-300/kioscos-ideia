import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MovimientosList } from "./_components/movimientos-list";

export const metadata: Metadata = { title: "Historial — Kioscos IDEIA" };
export const revalidate = 0;

export default async function MovimientosPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin") redirect("/admin/dashboard");

  const [{ data: movimientos }, { data: sucursales }, { data: products }, { data: proveedores }, preciosRes] = await Promise.all([
    supabase
      .from("movimientos")
      .select(`
        *,
        sucursal:sucursales(id, nombre),
        movimiento_items(
          id, cantidad, precio_unitario, subtotal,
          product:products(id, name, sku)
        )
      `)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("sucursales")
      .select("id, nombre")
      .eq("is_active", true)
      .order("nombre"),
    (admin as any)
      .from("products")
      .select("id, name, sku")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("proveedores")
      .select("id, nombre, modo_facturacion, porcentaje_descuento")
      .eq("is_active", true)
      .order("nombre"),
    // Costo por sucursal (migración 059) -- este form elige la sucursal
    // adentro, no viene fija por URL como en /admin/sucursales/[id], así que
    // necesita el costo de TODAS para poder resolverlo recién cuando el
    // usuario elige una.
    admin.from("product_prices").select("product_id, sucursal_id, costo") as unknown as Promise<{
      data: { product_id: string; sucursal_id: string; costo: number }[] | null;
    }>,
  ]);

  const costosPorSucursal: Record<string, Record<string, number>> = {};
  for (const p of preciosRes.data ?? []) {
    (costosPorSucursal[p.sucursal_id] ??= {})[p.product_id] = p.costo;
  }

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Historial</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Movimientos y entregas por sucursal</p>
      </div>

      <MovimientosList
        movimientos={(movimientos ?? []) as Parameters<typeof MovimientosList>[0]["movimientos"]}
        sucursales={sucursales ?? []}
        products={(products ?? []) as Parameters<typeof MovimientosList>[0]["products"]}
        proveedores={proveedores ?? []}
        costosPorSucursal={costosPorSucursal}
      />
    </div>
  );
}
