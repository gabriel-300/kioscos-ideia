import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";

export const revalidate = 0;
export const metadata: Metadata = { title: "Mermas — Kioscos IDEIA" };

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
  costoUnitario: number | null;
  costoTotal:    number | null;
};

type EventoFila = {
  id:        string;
  fecha:     string;
  sucursal:  string;
  producto:  string;
  cantidad:  number;
  unitLabel: string | null;
  motivo:    string | null;
  fotoUrl:   string | null;
};

export default async function MermasPage({
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
  const desde = sp.desde ?? fechaHoyAR(new Date(Date.now() - 29 * 86400000));
  const hasta = sp.hasta ?? hoy;
  const sucFilter = sp.sucursal ?? "all";

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("is_active", true)
    .order("nombre");

  type ItemRow = {
    product_id: string;
    cantidad:   number;
    product:    { name: string; costo: number | null; unit_label: string | null } | null;
  };
  type MermaRow = {
    id: string; fecha: string; sucursal_id: string; notas: string | null; remito_image_url: string | null;
    sucursal: { nombre: string } | null;
    movimiento_items: ItemRow[];
  };

  // PostgREST devuelve como mucho 1000 filas si no se pagina (ver el mismo
  // fix en /admin/ventas y /admin/ventas-por-vendedor) -- se pagina con
  // .range() por las dudas.
  const PAGE_SIZE = 1000;
  const mermas: MermaRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = (admin as any)
      .from("movimientos")
      .select(`
        id, fecha, sucursal_id, notas, remito_image_url,
        sucursal:sucursales(nombre),
        movimiento_items(
          product_id, cantidad,
          product:products(name, costo, unit_label)
        )
      `)
      .eq("tipo", "merma")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (sucFilter !== "all") {
      query = query.eq("sucursal_id", sucFilter);
    }

    const { data, error } = (await query) as { data: MermaRow[] | null; error: any };
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    mermas.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
  }

  const porProducto = new Map<string, ProductoFila>();
  const eventos: EventoFila[] = [];

  for (const m of mermas) {
    const nombresProductos: string[] = [];
    for (const item of m.movimiento_items) {
      const nombre    = item.product?.name ?? "Producto eliminado";
      const unitLabel = item.product?.unit_label ?? null;
      const costo     = item.product?.costo ?? null;
      nombresProductos.push(`${nombre} (${fmtCantidad(item.cantidad, unitLabel)})`);

      const prev = porProducto.get(item.product_id);
      if (prev) {
        prev.cantidad += item.cantidad;
      } else {
        porProducto.set(item.product_id, {
          productId: item.product_id, nombre, unitLabel,
          cantidad: item.cantidad, costoUnitario: costo, costoTotal: null,
        });
      }

      eventos.push({
        id: `${m.id}-${item.product_id}`,
        fecha: m.fecha,
        sucursal: m.sucursal?.nombre ?? "—",
        producto: nombre,
        cantidad: item.cantidad,
        unitLabel,
        motivo: m.notas,
        fotoUrl: m.remito_image_url,
      });
    }
  }

  const filas: ProductoFila[] = [...porProducto.values()].map((f) => ({
    ...f,
    costoTotal: f.costoUnitario != null ? f.cantidad * f.costoUnitario : null,
  })).sort((a, b) => (b.costoTotal ?? 0) - (a.costoTotal ?? 0));

  const totalCosto        = filas.reduce((s, f) => s + (f.costoTotal ?? 0), 0);
  const productosConCosto = filas.filter((f) => f.costoTotal != null).length;
  const totalEventos      = mermas.length;

  return (
    <div className="p-4 md:p-8 max-w-[1600px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Mermas</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Producto perdido (vencido, roto, etc.) y cuánto representa en costo</p>
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
            href="/admin/mermas"
            className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center"
          >
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Costo perdido</p>
          {productosConCosto > 0 ? (
            <>
              <p className="text-xl font-bold font-display tabular-nums text-danger">{AR.format(totalCosto)}</p>
              {productosConCosto < filas.length && (
                <p className="text-xs text-amber-600 mt-0.5">Solo {productosConCosto} de {filas.length} con costo cargado</p>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-400 mt-1">Sin costo cargado</p>
          )}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Registros</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{totalEventos}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{filas.length} productos distintos</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Más mermado</p>
          {filas.length > 0 ? (
            <>
              <p className="text-sm font-bold text-neutral-900 leading-snug line-clamp-2">{filas[0].nombre}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{fmtCantidad(filas[0].cantidad, filas[0].unitLabel)}</p>
            </>
          ) : (
            <p className="text-sm text-neutral-400 mt-1">—</p>
          )}
        </div>
      </div>

      {/* Tabla por producto */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "480px" }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Cantidad perdida</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Costo perdido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-sm text-neutral-400">
                    Sin mermas registradas en el período seleccionado.
                  </td>
                </tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.productId} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-neutral-800">{f.nombre}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{fmtCantidad(f.cantidad, f.unitLabel)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-danger">
                      {f.costoTotal != null ? AR.format(f.costoTotal) : <span className="text-neutral-200 font-normal">—</span>}
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
                  <td className="px-3 py-2.5 text-right tabular-nums text-danger">{productosConCosto > 0 ? AR.format(totalCosto) : "—"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Detalle de eventos */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "640px" }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sucursal</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Cant.</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Motivo</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {eventos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-neutral-400">
                    Sin registros.
                  </td>
                </tr>
              ) : (
                eventos.map((e) => {
                  const fechaDisplay = new Date(e.fecha + "T12:00:00").toLocaleDateString("es-AR", {
                    weekday: "short", day: "numeric", month: "short",
                  });
                  return (
                    <tr key={e.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="px-3 py-2.5 text-neutral-600 capitalize">{fechaDisplay}</td>
                      <td className="px-3 py-2.5 text-neutral-600">{e.sucursal}</td>
                      <td className="px-3 py-2.5 font-medium text-neutral-800">{e.producto}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">{fmtCantidad(e.cantidad, e.unitLabel)}</td>
                      <td className="px-3 py-2.5 text-neutral-500 text-xs">{e.motivo || <span className="text-neutral-200">—</span>}</td>
                      <td className="px-3 py-2.5 text-center">
                        {e.fotoUrl && (
                          <a href={e.fotoUrl} target="_blank" rel="noopener noreferrer" title="Ver foto" className="text-tierra-700 hover:underline text-xs">
                            📷
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-neutral-400 mt-3">
        El costo se calcula con el costo actual cargado en Productos (no el histórico al momento de la pérdida).
      </p>
    </div>
  );
}
