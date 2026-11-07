import type { Metadata } from "next";
import { independientesParaAdmin, sinIndependientes, sinIndependientesLista } from "@/lib/sucursales-independientes";
import { todosLosPrecios } from "@/lib/supabase/paginar";
import { createClient, createAdminClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StockTable } from "./_components/stock-table";
import { filtroCatalogoDe } from "@/lib/catalogo-dueno";

export const metadata: Metadata = { title: "Stock kioscos — Kioscos IDEIA" };
export const revalidate = 0;

export default async function StockPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();
  const user = await getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "";
  const isStaff = role === "encargado" || role === "vendedor" || role === "concesionario";

  let staffSucursalId: string | null = null;
  if (role === "encargado" || role === "concesionario") {
    const { data } = await supabase.from("sucursales").select("id").eq("encargado_user_id", user.id).single();
    staffSucursalId = data?.id ?? null;
  } else if (role === "vendedor") {
    const res = await (supabase as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    staffSucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
  }

  // Sin esto, un encargado/vendedor sin sucursal asignada (o cualquier rol
  // inesperado) caía por defecto en la vista matriz de TODAS las sucursales
  // más abajo, pensada solo para admin.
  if (role !== "admin" && !(isStaff && staffSucursalId)) {
    redirect("/admin/dashboard");
  }

  // Quien trabaja en una sucursal ve lo global + lo propio de SU sucursal (migración 131). Admin ve todo.
  const filtroDueno = isStaff && staffSucursalId ? filtroCatalogoDe(staffSucursalId) : null;

  // Cliente admin a propósito: en `products` los permisos son columna por columna y owner_sucursal_id NO se puede
  // leer ni filtrar con la sesión del usuario (daba 403 y la lista quedaba vacía). El acceso ya está acotado arriba.
  // Admin: solo el catálogo de IDEIA (un local independiente es de otra persona); personal de una sucursal: lo global + lo suyo.
  let productsQuery = (admin as any)
      .from("products")
      .select("id, name, sku, category_id, unit_label, stock_minimo")
      .eq("is_active", true);
  productsQuery = filtroDueno ? productsQuery.or(filtroDueno) : productsQuery.is("owner_sucursal_id", null);

  const [
    { data: products },
    { data: categories },
  ] = await Promise.all([
    productsQuery
      // La "multa por atraso de termo" es un producto de servicio ficticio
      // (ver 063_multa_alquiler_termo.sql) solo para que su cobro entre a la
      // conciliación de caja como cualquier venta -- no tiene stock real, no
      // tiene sentido que aparezca acá con un número cada vez más negativo.
      .neq("sku", "MULTA-TERMO")
      .order("name") as unknown as Promise<{ data: { id: string; name: string; sku: string; category_id: string | null; unit_label: string; stock_minimo: number }[] | null }>,
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order"),
  ]);

  // Vista plana para encargado/vendedor (una sucursal)
  if (isStaff && staffSucursalId) {
    const { data: sucursalRaw } = await (supabase as any)
      .from("sucursales").select("id, nombre, catalogo_propio").eq("id", staffSucursalId).single();
    const sucursal = sucursalRaw as { id: string; nombre: string; catalogo_propio: boolean | null } | null;

    // Admin client a propósito: stock_sucursal hereda RLS de movimientos/
    // movimiento_items, y la regla "cada uno ve su turno" (036/041) le
    // esconde a un vendedor/encargado las entregas o ventas de HOY que no
    // hizo él mismo -- eso tiene sentido para el Historial (privacidad entre
    // turnos), pero acá rompe el número: Stock tiene que mostrar el
    // inventario real, no una porción filtrada por turno. El alcance a la
    // sucursal propia ya lo garantiza el .eq de abajo con staffSucursalId,
    // que se resolvió server-side desde la sesión (no viene del cliente).
    const [stockRes, puntosRes] = await Promise.all([
      (admin as any)
        .from("stock_sucursal")
        .select("product_id, entradas, salidas, stock_actual")
        .eq("sucursal_id", staffSucursalId),
      (admin as any)
        .from("product_prices")
        .select("product_id, punto_minimo")
        .eq("sucursal_id", staffSucursalId) as unknown as Promise<{ data: { product_id: string; punto_minimo: number | null }[] | null }>,
    ]);
    const stockRows = stockRes.data as { product_id: string; entradas: number; salidas: number; stock_actual: number }[] | null;

    const entradaMap: Record<string, number> = {};
    const salidaMap:  Record<string, number> = {};
    const stockMap:   Record<string, number> = {};
    for (const r of stockRows ?? []) {
      entradaMap[r.product_id] = r.entradas;
      salidaMap[r.product_id]  = r.salidas;
      stockMap[r.product_id]   = r.stock_actual;
    }
    const minimoMap: Record<string, number> = {};
    for (const r of puntosRes.data ?? []) {
      if (r.punto_minimo != null) minimoMap[r.product_id] = r.punto_minimo;
    }

    // Local independiente (migración 131): del catálogo de IDEIA solo lo que tenga precio acá; lo propio, siempre.
    let productosVisibles = products ?? [];
    let categoriasVisibles = categories ?? [];
    if (sucursal?.catalogo_propio) {
      const conPrecio = new Set((puntosRes.data ?? []).map((r) => r.product_id));
      const { data: propios } = await (admin as any).from("products").select("id").eq("owner_sucursal_id", staffSucursalId);
      const propiosIds = new Set(((propios ?? []) as { id: string }[]).map((p) => p.id));
      productosVisibles = productosVisibles.filter((p) => propiosIds.has(p.id) || conPrecio.has(p.id));
      const { data: catsPropias } = await (admin as any).from("categories").select("id").eq("owner_sucursal_id", staffSucursalId);
      const catIds = new Set([
        ...((catsPropias ?? []) as { id: string }[]).map((c) => c.id),
        ...productosVisibles.map((p) => p.category_id).filter((c): c is string => !!c),
      ]);
      categoriasVisibles = categoriasVisibles.filter((c) => catIds.has(c.id));
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
          products={productosVisibles}
          categories={categoriasVisibles}
          flatStockMap={stockMap}
          entradaMap={entradaMap}
          salidaMap={salidaMap}
          minimoMap={minimoMap}
          sucursalId={staffSucursalId ?? undefined}
          sucursalNombre={sucursal?.nombre ?? undefined}
          canAjustar={false}
        />
      </div>
    );
  }

  // Vista matriz para admin (todas las sucursales) — misma fuente que la vista
  // de encargado/vendedor (stock_sucursal), para no reimplementar la fórmula
  // de stock a mano (eso hacía que "Ajuste de stock" no se viera acá).
  const propias = await independientesParaAdmin(admin, "admin");
  const [
    { data: sucursalesTodas },
    { data: stockRows },
    { data: puntosRows },
  ] = await Promise.all([
    supabase.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    sinIndependientes((supabase as any)
      .from("stock_sucursal")
      .select("sucursal_id, product_id, stock_actual"), propias) as unknown as Promise<{
        data: { sucursal_id: string; product_id: string; stock_actual: number }[] | null;
      }>,
    todosLosPrecios<{ sucursal_id: string; product_id: string; punto_minimo: number | null }>(admin as any, "sucursal_id, product_id, punto_minimo").then((data) => ({ data })),
  ]);

  const sucursales = sinIndependientesLista(sucursalesTodas, propias);
  const matrixMap: Record<string, Record<string, number>> = {};
  for (const r of stockRows ?? []) {
    if (!matrixMap[r.sucursal_id]) matrixMap[r.sucursal_id] = {};
    matrixMap[r.sucursal_id][r.product_id] = r.stock_actual;
  }
  const minimoMatrix: Record<string, Record<string, number>> = {};
  for (const r of puntosRows ?? []) {
    if (r.punto_minimo == null) continue;
    if (!minimoMatrix[r.sucursal_id]) minimoMatrix[r.sucursal_id] = {};
    minimoMatrix[r.sucursal_id][r.product_id] = r.punto_minimo;
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
        minimoMatrix={minimoMatrix}
      />
    </div>
  );
}
