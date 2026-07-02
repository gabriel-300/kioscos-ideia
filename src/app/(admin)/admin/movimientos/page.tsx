import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MovimientosList } from "./_components/movimientos-list";

export const metadata: Metadata = { title: "Historial — Kioscos IDEIA" };
export const revalidate = 0;

export default async function MovimientosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: movimientos }, { data: sucursales }, { data: products }, { data: proveedores }] = await Promise.all([
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
    supabase
      .from("products")
      .select("id, name, sku, precio_dist")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("proveedores")
      .select("id, nombre")
      .eq("is_active", true)
      .order("nombre"),
  ]);

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
      />
    </div>
  );
}
