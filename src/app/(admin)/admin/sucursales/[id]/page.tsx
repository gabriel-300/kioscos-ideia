import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { HistorialSucursal } from "./_components/historial-sucursal";
import { NuevaEntregaButton } from "./_components/nueva-entrega-button";
import { CierreCajaButton } from "./_components/cierre-caja-button";

export const revalidate = 0;

type StockRow = { product_id: string; product_name: string; sku: string; entradas: number; salidas: number; stock_actual: number };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("sucursales").select("nombre").eq("id", id).single();
  return { title: data ? `${data.nombre} — Kioscos IDEIA` : "Sucursal — Kioscos IDEIA" } satisfies Metadata;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-tierra-200 bg-tierra-50" : "border-neutral-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold font-display tabular-nums ${accent ? "text-tierra-700" : "text-neutral-900"}`}>{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function SucursalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const hoy = new Date().toISOString().slice(0, 10);

  const [{ data: sucursal }, { data: movimientos }, { data: products }, { data: categories }, { data: cierreHoy }, { data: stockRows }] = await Promise.all([
    supabase.from("sucursales").select("*").eq("id", id).single(),
    supabase
      .from("movimientos")
      .select(`
        id, fecha, tipo, notas, created_at,
        movimiento_items(
          id, cantidad, precio_unitario, subtotal,
          product:products(id, name, sku)
        )
      `)
      .eq("sucursal_id", id)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("products").select("*").eq("is_active", true).order("name"),
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("cierres_caja").select("*").eq("sucursal_id", id).eq("fecha", hoy).maybeSingle(),
    (supabase as any).from("stock_sucursal").select("product_id, product_name, sku, entradas, salidas, stock_actual").eq("sucursal_id", id) as Promise<{ data: StockRow[] | null }>,
  ]);

  if (!sucursal) notFound();

  // Encargados solo pueden ver su propia sucursal
  if (user.app_metadata?.role === "encargado" && sucursal.encargado_user_id !== user.id) {
    redirect("/admin/dashboard");
  }

  const movs = movimientos ?? [];

  // Totales
  const totalEntregado = movs
    .filter((m) => m.tipo === "entrega")
    .reduce((sum, m) => sum + m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0), 0);

  const totalDevuelto = movs
    .filter((m) => m.tipo === "devolucion")
    .reduce((sum, m) => sum + m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0), 0);

  const cantidadEntregas = movs.filter((m) => m.tipo === "entrega").length;

  const totalUnidadesVendidas = movs
    .filter((m) => m.tipo === "venta")
    .reduce((sum, m) => sum + m.movimiento_items.reduce((s: number, i: { cantidad: number }) => s + i.cantidad, 0), 0);

  const cantidadRegistrosVenta = movs.filter((m) => m.tipo === "venta").length;

  // Stock por producto desde la vista SQL
  const stock = (stockRows ?? []).sort((a, b) => b.entradas - a.entradas);
  const stockActual: Record<string, number> = Object.fromEntries(
    stock.map((r) => [r.product_id, r.stock_actual])
  );

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        {user.app_metadata?.role === "admin" && (
          <Link
            href="/admin/sucursales"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-700 mb-3 transition-colors"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Sucursales
          </Link>
        )}

        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">{sucursal.nombre}</h1>
              {!sucursal.is_active && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500">Inactiva</span>
              )}
            </div>
            <p className="text-sm text-neutral-400 mt-0.5">
              {sucursal.localidad}{sucursal.provincia && sucursal.provincia !== sucursal.localidad ? `, ${sucursal.provincia}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {user.app_metadata?.role === "encargado" ? (
              <>
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="ajuste"
                  label="Ajuste"
                  variant="ghost"
                />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="entrega"
                  label="Registrar recepción"
                  variant="ghost"
                />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="venta"
                  stockMap={stockActual}
                  categories={categories ?? []}
                />
              </>
            ) : (
              <>
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="venta"
                  variant="ghost"
                  stockMap={stockActual}
                  categories={categories ?? []}
                />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="entrega"
                />
              </>
            )}
            <CierreCajaButton
              sucursalId={sucursal.id}
              sucursalNombre={sucursal.nombre}
              movimientos={(movs as Parameters<typeof CierreCajaButton>[0]["movimientos"])}
              cierreHoy={cierreHoy}
            />
          </div>
        </div>
      </div>

      {/* Info del encargado */}
      {(sucursal.encargado_nombre || sucursal.direccion || sucursal.encargado_telefono) && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-6 flex flex-wrap gap-5 text-sm">
          {sucursal.encargado_nombre && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Encargado</p>
              <p className="text-neutral-800 font-medium">{sucursal.encargado_nombre}</p>
            </div>
          )}
          {sucursal.encargado_telefono && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Teléfono</p>
              <a
                href={`tel:${sucursal.encargado_telefono}`}
                className="text-tierra-700 hover:underline font-medium"
              >
                {sucursal.encargado_telefono}
              </a>
            </div>
          )}
          {sucursal.encargado_email && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Email</p>
              <a href={`mailto:${sucursal.encargado_email}`} className="text-tierra-700 hover:underline font-medium">
                {sucursal.encargado_email}
              </a>
            </div>
          )}
          {sucursal.direccion && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Dirección</p>
              <p className="text-neutral-800">{sucursal.direccion}</p>
            </div>
          )}
          {sucursal.notas && (
            <div className="w-full">
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Notas</p>
              <p className="text-neutral-600">{sucursal.notas}</p>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total entregado"
          value={totalEntregado > 0 ? AR.format(totalEntregado) : "—"}
          sub={`${cantidadEntregas} entregas`}
          accent
        />
        <StatCard
          label="Ventas registradas"
          value={totalUnidadesVendidas > 0 ? `${totalUnidadesVendidas} u.` : "—"}
          sub={`${cantidadRegistrosVenta} registros`}
        />
        <StatCard
          label="Devoluciones"
          value={totalDevuelto > 0 ? AR.format(totalDevuelto) : "—"}
          sub={`${movs.filter((m) => m.tipo === "devolucion").length} movimientos`}
        />
        <StatCard
          label="Saldo kiosco"
          value={totalEntregado - totalDevuelto > 0 ? AR.format(totalEntregado - totalDevuelto) : "—"}
          sub="entregado − devuelto"
        />
      </div>

      {/* Stock estimado */}
      {stock.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Stock estimado</h2>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 w-20">Entradas</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 w-20">Salidas</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500 w-20">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {stock.map((p) => (
                  <tr key={p.product_id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-medium text-neutral-800">{p.product_name}</span>
                      <span className="ml-2 text-xs text-neutral-400">{p.sku}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-selva-700 font-medium">+{p.entradas}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{p.salidas > 0 ? `-${p.salidas}` : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-neutral-900">{p.stock_actual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-neutral-400 mt-2">Entregas − devoluciones − ventas. Los ajustes de stock no se suman ni restan automáticamente.</p>
        </div>
      )}

      {/* Historial */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-neutral-900">Historial de movimientos</h2>
          <span className="text-xs text-neutral-400">{movs.length} registros</span>
        </div>
        <HistorialSucursal movimientos={movs as Parameters<typeof HistorialSucursal>[0]["movimientos"]} />
      </div>
    </div>
  );
}
