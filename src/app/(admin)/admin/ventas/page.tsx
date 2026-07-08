import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { VentasExportButton } from "./_components/export-button";
import { fechaHoyAR } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";

export const revalidate = 0;
export const metadata: Metadata = { title: "Informe de ventas — Kioscos IDEIA" };

const AR  = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

function fmtCantidad(cantidad: number, unitLabel: string | null) {
  return unitLabel === "kg" ? `${formatKg(cantidad)} kg` : `${NUM.format(cantidad)} u.`;
}

type ProductoFila = {
  productId:     string;
  nombre:        string;
  unitLabel:     string | null;
  cantidad:      number;
  facturado:     number;
  costoUnitario: number | null;
  costoTotal:    number | null;
  margen:        number | null;
};

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; sucursal?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin") redirect("/admin/dashboard");

  const sp    = await searchParams;
  const hoy   = fechaHoyAR();
  const desde = sp.desde ?? hoy;
  const hasta = sp.hasta ?? hoy;
  const sucFilter = sp.sucursal ?? "all";

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("is_active", true)
    .order("nombre");

  let query = (admin as any)
    .from("movimientos")
    .select(`
      id, fecha, sucursal_id,
      movimiento_items(
        product_id, cantidad, subtotal, promo_id,
        product:products(name, costo, unit_label)
      )
    `)
    .eq("tipo", "venta")
    .gte("fecha", desde)
    .lte("fecha", hasta);

  if (sucFilter !== "all") {
    query = query.eq("sucursal_id", sucFilter);
  }

  type ItemRow = {
    product_id: string;
    cantidad:   number;
    subtotal:   number | null;
    promo_id:   string | null;
    product:    { name: string; costo: number | null; unit_label: string | null } | null;
  };
  type VentaRow = { id: string; fecha: string; sucursal_id: string; movimiento_items: ItemRow[] };

  const { data: ventasRaw, error } = (await query) as { data: VentaRow[] | null; error: any };
  if (error) throw new Error(error.message);
  const ventas = ventasRaw ?? [];

  // Agregación por producto -- funciona igual para líneas sueltas y componentes
  // de promos (cada componente ya viene expandido a su propia fila con su
  // cantidad real). El costo se calcula sobre el costo ACTUAL del producto, no
  // el histórico al momento de la venta.
  const porProducto = new Map<string, ProductoFila>();
  let cantidadVentasConPromo = 0;

  for (const venta of ventas) {
    for (const item of venta.movimiento_items) {
      if (item.promo_id) cantidadVentasConPromo++;
      const prev = porProducto.get(item.product_id);
      const nombre    = item.product?.name ?? "Producto eliminado";
      const unitLabel = item.product?.unit_label ?? null;
      const costo     = item.product?.costo ?? null;
      const cantidad  = item.cantidad;
      const facturado = item.subtotal ?? 0;

      if (prev) {
        prev.cantidad  += cantidad;
        prev.facturado += facturado;
      } else {
        porProducto.set(item.product_id, {
          productId: item.product_id, nombre, unitLabel,
          cantidad, facturado, costoUnitario: costo, costoTotal: null, margen: null,
        });
      }
    }
  }

  const filas: ProductoFila[] = [...porProducto.values()].map((f) => {
    const costoTotal = f.costoUnitario != null ? f.cantidad * f.costoUnitario : null;
    const margen     = costoTotal != null ? f.facturado - costoTotal : null;
    return { ...f, costoTotal, margen };
  }).sort((a, b) => b.facturado - a.facturado);

  const totalFacturado  = filas.reduce((s, f) => s + f.facturado, 0);
  const totalCosto      = filas.reduce((s, f) => s + (f.costoTotal ?? 0), 0);
  const productosConCosto = filas.filter((f) => f.costoTotal != null).length;
  const totalMargen     = productosConCosto > 0 ? totalFacturado - totalCosto : null;
  const totalUnidades   = filas.reduce((s, f) => s + f.cantidad, 0);

  const exportRows = filas.map((f) => ({
    producto:  f.nombre,
    unidad:    f.unitLabel === "kg" ? "kg" : "unidad",
    cantidad:  f.cantidad,
    facturado: f.facturado,
    costo:     f.costoTotal,
    margen:    f.margen,
  }));

  return (
    <div className="p-4 md:p-8 max-w-[1600px]">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Informe de ventas</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Cantidad vendida, facturado y costo por producto</p>
        </div>
        {filas.length > 0 && <VentasExportButton filas={exportRows} />}
      </div>

      {/* Filtros */}
      <form method="GET" className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Desde</label>
          <input
            type="date" name="desde" defaultValue={desde}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Hasta</label>
          <input
            type="date" name="hasta" defaultValue={hasta}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Sucursal</label>
          <select
            name="sucursal" defaultValue={sucFilter}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          >
            <option value="all">Todas</option>
            {(sucursales ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors"
        >
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.sucursal) && (
          <Link
            href="/admin/ventas"
            className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center"
          >
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Facturado</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalFacturado)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{filas.length} productos · {NUM.format(totalUnidades)} unidades/kg</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Costo</p>
          {productosConCosto > 0 ? (
            <>
              <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalCosto)}</p>
              {productosConCosto < filas.length && (
                <p className="text-xs text-amber-600 mt-0.5">Solo {productosConCosto} de {filas.length} con costo cargado</p>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-400 mt-1">Sin costo cargado</p>
          )}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Margen estimado</p>
          {totalMargen !== null ? (
            <p className={`text-xl font-bold font-display tabular-nums ${totalMargen >= 0 ? "text-selva-600" : "text-danger"}`}>
              {AR.format(totalMargen)}
            </p>
          ) : (
            <p className="text-sm text-neutral-400 mt-1">—</p>
          )}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Más vendido</p>
          {filas.length > 0 ? (
            <>
              <p className="text-sm font-bold text-neutral-900 leading-snug line-clamp-2">{filas[0].nombre}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{AR.format(filas[0].facturado)}</p>
            </>
          ) : (
            <p className="text-sm text-neutral-400 mt-1">—</p>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "640px" }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Cantidad</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Facturado</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Costo</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Margen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-neutral-400">
                    Sin ventas en el período seleccionado.
                  </td>
                </tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.productId} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-neutral-800">{f.nombre}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{fmtCantidad(f.cantidad, f.unitLabel)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800">{AR.format(f.facturado)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 text-xs">
                      {f.costoTotal != null ? AR.format(f.costoTotal) : <span className="text-neutral-200">—</span>}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${
                      f.margen == null ? "text-neutral-200" : f.margen >= 0 ? "text-selva-600" : "text-danger"
                    }`}>
                      {f.margen != null ? AR.format(f.margen) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filas.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
                  <td className="px-3 py-2.5 text-xs uppercase tracking-wide text-neutral-500">Total ({filas.length} productos)</td>
                  <td />
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800">{AR.format(totalFacturado)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{productosConCosto > 0 ? AR.format(totalCosto) : "—"}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${totalMargen != null && totalMargen < 0 ? "text-danger" : "text-selva-700"}`}>
                    {totalMargen != null ? AR.format(totalMargen) : "—"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-xs text-neutral-400 mt-3">
        El costo se calcula con el costo actual cargado en Productos (no el histórico al momento de la venta).
        {cantidadVentasConPromo > 0 && " El facturado de una promo se contabiliza completo en el primer producto del combo, no repartido entre sus componentes."}
      </p>
    </div>
  );
}
