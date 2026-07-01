import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { HistorialSucursal } from "./_components/historial-sucursal";
import { NuevaEntregaButton } from "./_components/nueva-entrega-button";
import { CierreCajaButton } from "./_components/cierre-caja-button";
import { AperturaCajaButton } from "./_components/apertura-caja-button";
import { RetiroEfectivoButton } from "./_components/retiro-efectivo-button";

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

  const [{ data: sucursal }, { data: movimientos }, { data: products }, { data: categories }, { data: cierreHoy }, { data: stockRows }, { data: aperturaHoy }, { data: retirosHoy }] = await Promise.all([
    supabase.from("sucursales").select("*").eq("id", id).single(),
    (supabase as any)
      .from("movimientos")
      .select(`
        id, fecha, tipo, notas, canal, created_at,
        movimiento_items(
          id, cantidad, precio_unitario, subtotal,
          product:products(id, name, sku)
        )
      `)
      .eq("sucursal_id", id)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }) as unknown as Promise<{ data: any[] | null; error: any }>,
    supabase.from("products").select("*").eq("is_active", true).order("name"),
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    (supabase as any).from("cierres_caja").select("*").eq("sucursal_id", id).eq("fecha", hoy).maybeSingle() as unknown as Promise<{ data: { fecha: string; total_ventas: number; efectivo_declarado: number; mercadopago_declarado: number; tarjeta_declarada: number | null; transferencia_declarada: number | null; diferencia: number | null; notas: string | null } | null }>,
    (supabase as any).from("stock_sucursal").select("product_id, product_name, sku, entradas, salidas, stock_actual").eq("sucursal_id", id) as Promise<{ data: StockRow[] | null }>,
    (supabase as any).from("aperturas_caja").select("fondo_inicial, notas").eq("sucursal_id", id).eq("fecha", hoy).maybeSingle() as unknown as Promise<{ data: { fondo_inicial: number; notas: string | null } | null }>,
    (supabase as any).from("retiros_caja").select("id, monto, motivo, created_at").eq("sucursal_id", id).eq("fecha", hoy).order("created_at", { ascending: false }) as unknown as Promise<{ data: { id: string; monto: number; motivo: string; created_at: string }[] | null }>,
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

  const retiros        = retirosHoy ?? [];
  const totalRetiros   = retiros.reduce((sum, r) => sum + r.monto, 0);

  const ventasHoy      = movs.filter((m) => m.tipo === "venta" && m.fecha === hoy);
  const totalVentasHoy = ventasHoy.reduce(
    (sum, m) => sum + m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0),
    0
  );

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
                <RetiroEfectivoButton sucursalId={sucursal.id} />
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
            <AperturaCajaButton
              sucursalId={sucursal.id}
              sucursalNombre={sucursal.nombre}
              aperturaHoy={aperturaHoy}
            />
            <CierreCajaButton
              sucursalId={sucursal.id}
              sucursalNombre={sucursal.nombre}
              movimientos={(movs as Parameters<typeof CierreCajaButton>[0]["movimientos"])}
              cierreHoy={cierreHoy}
              aperturaHoy={aperturaHoy}
            />
          </div>
        </div>
      </div>

      {/* ── Caja del día (encargado) ── */}
      {user.app_metadata?.role === "encargado" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {/* Apertura */}
          <div className={`rounded-xl border p-4 ${aperturaHoy ? "bg-selva-50 border-selva-200" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${aperturaHoy ? "text-selva-600" : "text-neutral-400"}`}>
              Fondo inicial
            </p>
            {aperturaHoy ? (
              <p className="text-xl font-bold font-display tabular-nums text-selva-700">{AR.format(aperturaHoy.fondo_inicial)}</p>
            ) : (
              <p className="text-sm text-neutral-400">Sin apertura</p>
            )}
          </div>

          {/* Ventas hoy */}
          <div className="rounded-xl border border-tierra-100 bg-tierra-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-tierra-600 mb-2">Ventas hoy</p>
            <p className="text-xl font-bold font-display tabular-nums text-tierra-700">
              {totalVentasHoy > 0 ? AR.format(totalVentasHoy) : "—"}
            </p>
            <p className="text-[11px] text-tierra-600 mt-1">{ventasHoy.length} {ventasHoy.length === 1 ? "registro" : "registros"}</p>
          </div>

          {/* Retiros */}
          <div className={`rounded-xl border p-4 ${totalRetiros > 0 ? "bg-danger-bg/30 border-danger/20" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${totalRetiros > 0 ? "text-danger" : "text-neutral-400"}`}>
              Retiros
            </p>
            {totalRetiros > 0 ? (
              <>
                <p className="text-xl font-bold font-display tabular-nums text-danger">{AR.format(totalRetiros)}</p>
                <p className="text-[11px] text-neutral-500 mt-1">{retiros.length} {retiros.length === 1 ? "retiro" : "retiros"}</p>
              </>
            ) : (
              <p className="text-sm text-neutral-400">Sin retiros</p>
            )}
          </div>

          {/* Cierre */}
          <div className={`rounded-xl border p-4 ${cierreHoy ? "bg-selva-50 border-selva-200" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${cierreHoy ? "text-selva-600" : "text-neutral-400"}`}>
              Cierre
            </p>
            {cierreHoy ? (
              <>
                <p className="text-sm font-bold text-selva-700">Cerrado ✓</p>
                <p className="text-[11px] text-selva-600 mt-1">{AR.format(cierreHoy.total_ventas ?? 0)}</p>
              </>
            ) : (
              <p className="text-sm text-neutral-400">Pendiente</p>
            )}
          </div>
        </div>
      )}

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
        <HistorialSucursal movimientos={movs as Parameters<typeof HistorialSucursal>[0]["movimientos"]} sucursalNombre={sucursal.nombre} />
      </div>
    </div>
  );
}
