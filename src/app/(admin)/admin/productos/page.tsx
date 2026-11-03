import type { Metadata } from "next";
import { createClient, getUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsTable } from "./_components/products-table";
import { alcanceCatalogo } from "@/lib/auth/catalogo-propio";

export const metadata: Metadata = { title: "Productos — Kioscos IDEIA" };
export const revalidate = 0;

export default async function ProductosPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();
  const user = await getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;
  // Admin: todo el catálogo. Concesionario con catálogo propio (migración 131): solo lo suyo.
  const alcance = role ? await alcanceCatalogo(user.id, role) : null;
  if (!alcance) redirect("/admin/dashboard");
  const dueno = alcance.ownerSucursalId; // null = admin

  // Un dueño no ve proveedores de IDEIA ni precios/stock de otros locales: todo se acota a su sucursal.
  let qProductos = (admin as any).from("products").select("*, category:categories(*)").order("name");
  let qSucursales = (admin as any).from("sucursales").select("id, nombre, catalogo_propio").eq("is_active", true).order("nombre");
  let qStock = (admin as any).from("stock_sucursal").select("product_id, sucursal_id, stock_actual").gt("stock_actual", 0);
  let qPrecios = (admin as any).from("product_prices").select("product_id, sucursal_id, precio_dist, costo, punto_minimo, punto_pedido, punto_maximo");
  if (dueno) {
    qProductos = qProductos.eq("owner_sucursal_id", dueno);
    qSucursales = qSucursales.eq("id", dueno);
    qStock = qStock.eq("sucursal_id", dueno);
    qPrecios = qPrecios.eq("sucursal_id", dueno);
  }

  const [{ data: productsRaw }, { data: categories }, { data: sucursales }, { data: proveedores }, stockActivoRes, preciosRes] = await Promise.all([
    qProductos,
    supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
    qSucursales,
    dueno ? Promise.resolve({ data: [] }) : supabase.from("proveedores").select("id, nombre").eq("is_active", true).order("nombre"),
    qStock as unknown as Promise<{
        data: { product_id: string; sucursal_id: string; stock_actual: number }[] | null;
      }>,
    qPrecios as unknown as Promise<{
      data: { product_id: string; sucursal_id: string; precio_dist: number; costo: number; punto_minimo: number | null; punto_pedido: number | null; punto_maximo: number | null }[] | null;
    }>,
  ]);

  // El admin gestiona el catálogo de IDEIA: los productos propios de un local independiente (migración 131)
  // los administra su dueño y no se mezclan acá. (Filtro en JS: la página no debe romperse si la 131 no está aplicada.)
  const products = (productsRaw ?? []).filter((p: { owner_sucursal_id?: string | null }) => dueno || !p.owner_sucursal_id);
  const precios  = preciosRes.data ?? [];
  const puntos   = precios.map((p) => ({
    product_id: p.product_id, sucursal_id: p.sucursal_id,
    punto_minimo: p.punto_minimo, punto_pedido: p.punto_pedido, punto_maximo: p.punto_maximo,
  }));

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
        // El admin carga precios globales solo para los kioscos de IDEIA: los locales con catálogo propio
        // (migración 131) manejan los suyos.
        sucursales={((sucursales ?? []) as { id: string; nombre: string; catalogo_propio?: boolean | null }[])
          .filter((s) => dueno || s.catalogo_propio !== true)
          .map(({ id, nombre }) => ({ id, nombre }))}
        proveedores={proveedores ?? []}
        precios={precios}
        puntos={puntos}
        role={role}
        esDueno={!!dueno}
      />
    </div>
  );
}
