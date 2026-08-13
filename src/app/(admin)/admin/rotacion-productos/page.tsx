import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { primerDiaMesAR, fechaHoyAR } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";

export const revalidate = 0;
export const metadata: Metadata = { title: "Rotación por producto — Kioscos IDEIA" };

const AR  = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

function fmtCantidad(cantidad: number, unitLabel: string | null) {
  return unitLabel === "kg" ? `${formatKg(cantidad)} kg` : `${NUM.format(cantidad)} u.`;
}

function RotacionBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-neutral-300 text-xs">—</span>;
  const color = pct >= 60 ? "text-selva-700 bg-selva-50" : pct >= 30 ? "text-amber-700 bg-amber-50" : "text-danger bg-danger/5";
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{pct.toFixed(0)}%</span>;
}

type ProductoFila = {
  productId: string; nombre: string; unitLabel: string | null;
  entregado: number; vendido: number; rotacion: number | null;
  facturado: number; costoTotal: number | null; margen: number | null;
};

export default async function RotacionProductosPage({
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
  // Mismo período por defecto que "Rotación global" del dashboard (mes en
  // curso) -- esta página es la versión "abierta por producto" de esa métrica.
  const desde = sp.desde ?? primerDiaMesAR();
  const hasta = sp.hasta ?? hoy;
  const sucFilter = sp.sucursal ?? "all";

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("is_active", true)
    .order("nombre");

  type ItemRow = { product_id: string; cantidad: number; subtotal: number | null; product: { name: string; unit_label: string | null } | null };
  type MovRow  = { id: string; sucursal_id: string; movimiento_items: ItemRow[] };

  async function fetchMovimientos(tipo: "entrega" | "venta"): Promise<MovRow[]> {
    const PAGE_SIZE = 1000;
    const rows: MovRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = (admin as any)
        .from("movimientos")
        .select(`
          id, sucursal_id,
          movimiento_items(product_id, cantidad, subtotal, product:products(name, unit_label))
        `)
        .eq("tipo", tipo)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .range(from, from + PAGE_SIZE - 1);
      if (tipo === "venta") query = query.is("anulado_en", null);
      if (sucFilter !== "all") query = query.eq("sucursal_id", sucFilter);

      const { data, error } = (await query) as { data: MovRow[] | null; error: any };
      if (error) throw new Error(error.message);
      const pagina = data ?? [];
      rows.push(...pagina);
      if (pagina.length < PAGE_SIZE) break;
    }
    return rows;
  }

  const [entregas, ventas, { data: preciosRaw }] = await Promise.all([
    fetchMovimientos("entrega"),
    fetchMovimientos("venta"),
    admin.from("product_prices").select("sucursal_id, product_id, costo"),
  ]);
  const costoMap = new Map((preciosRaw ?? []).map((p) => [`${p.sucursal_id}:${p.product_id}`, p.costo]));

  type Acc = {
    nombre: string; unitLabel: string | null;
    entregado: number; vendido: number; facturado: number;
    costoTotal: number; costoCompleto: boolean;
  };
  const porProducto = new Map<string, Acc>();

  function getAcc(productId: string, nombre: string, unitLabel: string | null): Acc {
    let acc = porProducto.get(productId);
    if (!acc) {
      acc = { nombre, unitLabel, entregado: 0, vendido: 0, facturado: 0, costoTotal: 0, costoCompleto: true };
      porProducto.set(productId, acc);
    }
    return acc;
  }

  for (const mov of entregas) {
    for (const item of mov.movimiento_items) {
      const acc = getAcc(item.product_id, item.product?.name ?? "Producto eliminado", item.product?.unit_label ?? null);
      acc.entregado += Number(item.cantidad);
    }
  }
  for (const mov of ventas) {
    for (const item of mov.movimiento_items) {
      const acc = getAcc(item.product_id, item.product?.name ?? "Producto eliminado", item.product?.unit_label ?? null);
      const cantidad = Number(item.cantidad);
      const costo    = costoMap.get(`${mov.sucursal_id}:${item.product_id}`) ?? null;
      acc.vendido    += cantidad;
      acc.facturado  += item.subtotal ?? 0;
      acc.costoTotal += costo != null ? cantidad * costo : 0;
      acc.costoCompleto = acc.costoCompleto && costo != null;
    }
  }

  const filas: ProductoFila[] = [...porProducto.entries()].map(([productId, acc]) => {
    const costoTotal = acc.costoCompleto ? acc.costoTotal : null;
    const margen     = costoTotal != null ? acc.facturado - costoTotal : null;
    const rotacion   = acc.entregado > 0 ? (acc.vendido / acc.entregado) * 100 : null;
    return {
      productId, nombre: acc.nombre, unitLabel: acc.unitLabel,
      entregado: acc.entregado, vendido: acc.vendido, rotacion,
      facturado: acc.facturado, costoTotal, margen,
    };
  }).sort((a, b) => {
    if (a.rotacion === null && b.rotacion === null) return b.facturado - a.facturado;
    if (a.rotacion === null) return 1;
    if (b.rotacion === null) return -1;
    return a.rotacion - b.rotacion;
  });

  const totalFacturado = filas.reduce((s, f) => s + f.facturado, 0);
  const totalCosto     = filas.reduce((s, f) => s + (f.costoTotal ?? 0), 0);
  const productosConCosto = filas.filter((f) => f.costoTotal != null).length;
  const totalMargen    = productosConCosto > 0 ? totalFacturado - totalCosto : null;
  const productosConEntrega = filas.filter((f) => f.rotacion !== null);
  const rotacionPromedio = productosConEntrega.length > 0
    ? productosConEntrega.reduce((s, f) => s + (f.rotacion ?? 0), 0) / productosConEntrega.length
    : null;
  const productosBajaRotacion = productosConEntrega.filter((f) => (f.rotacion ?? 0) < 30).length;

  return (
    <div className="p-4 md:p-8 max-w-[1600px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Rotación por producto</h1>
        <p className="text-sm text-neutral-400 mt-0.5">De lo que entregaste a cada producto, cuánto se vendió -- ordenado de menor a mayor rotación</p>
      </div>

      {/* Filtros */}
      <form method="GET" className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Desde</label>
          <input type="date" name="desde" defaultValue={desde}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Hasta</label>
          <input type="date" name="hasta" defaultValue={hasta}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Sucursal</label>
          <select name="sucursal" defaultValue={sucFilter}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="all">Todas</option>
            {(sucursales ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.sucursal) && (
          <Link href="/admin/rotacion-productos" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Facturado</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalFacturado)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{filas.length} productos</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Ganancia estimada</p>
          {totalMargen !== null ? (
            <p className={`text-xl font-bold font-display tabular-nums ${totalMargen >= 0 ? "text-selva-600" : "text-danger"}`}>{AR.format(totalMargen)}</p>
          ) : <p className="text-sm text-neutral-400 mt-1">—</p>}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Rotación promedio</p>
          {rotacionPromedio !== null ? (
            <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{rotacionPromedio.toFixed(0)}%</p>
          ) : <p className="text-sm text-neutral-400 mt-1">—</p>}
          <p className="text-xs text-neutral-400 mt-0.5">de productos con entregas en el período</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Baja rotación (&lt;30%)</p>
          <p className={`text-xl font-bold font-display tabular-nums ${productosBajaRotacion > 0 ? "text-danger" : "text-neutral-900"}`}>{productosBajaRotacion}</p>
          <p className="text-xs text-neutral-400 mt-0.5">productos</p>
        </div>
      </div>

      {/* Mobile: tarjetas apiladas */}
      <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {filas.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-400">Sin movimientos en el período seleccionado.</p>
        ) : (
          filas.map((f) => (
            <div key={f.productId} className="px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-neutral-800">{f.nombre}</span>
                <RotacionBadge pct={f.rotacion} />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span>Entregado: {fmtCantidad(f.entregado, f.unitLabel)}</span>
                <span>Vendido: {fmtCantidad(f.vendido, f.unitLabel)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span>Facturado: {AR.format(f.facturado)}</span>
                <span>
                  Ganancia:{" "}
                  <span className={f.margen == null ? "" : f.margen >= 0 ? "text-selva-600 font-medium" : "text-danger font-medium"}>
                    {f.margen != null ? AR.format(f.margen) : "—"}
                  </span>
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "800px" }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Entregado</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Vendido</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Rotación</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Facturado</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Costo</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Ganancia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filas.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-neutral-400">Sin movimientos en el período seleccionado.</td></tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.productId} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-neutral-800">{f.nombre}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{fmtCantidad(f.entregado, f.unitLabel)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{fmtCantidad(f.vendido, f.unitLabel)}</td>
                    <td className="px-3 py-2.5 text-center"><RotacionBadge pct={f.rotacion} /></td>
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
                  <td /><td /><td />
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
        Rotación = cantidad vendida / cantidad entregada en el período, por producto. Sin entregas registradas en el período aparece como "—" (no es 0%: puede ser stock que ya estaba antes del período elegido).
        El costo se calcula con el costo actual cargado en Productos.
      </p>
    </div>
  );
}
