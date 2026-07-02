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

export default async function SucursalDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id }        = await params;
  const { mes: mesParam } = await searchParams;
  const supabase      = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const hoy       = new Date().toISOString().slice(0, 10);
  const mesActual = hoy.slice(0, 7);
  const mes       = mesParam ?? mesActual;
  const [mesYear, mesMonth] = mes.split("-").map(Number);
  const mesInicio  = `${mes}-01`;
  const mesFin     = new Date(mesYear, mesMonth, 0).toISOString().slice(0, 10);
  const prevMes    = (() => { const d = new Date(mesYear, mesMonth - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const nextMes    = (() => { const d = new Date(mesYear, mesMonth, 1);     return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const mesLabel   = new Date(mesYear, mesMonth - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const canGoNext  = mes < mesActual;

  type CierreRow = { fecha: string; fondo_inicial: number; total_ventas: number; efectivo_declarado: number; billetera_declarada: number; tarjeta_declarada: number | null; transferencia_declarada: number | null; diferencia: number | null; notas: string | null; created_at: string };
  type AperturaRow = { fondo_inicial: number; notas: string | null; created_at: string };

  const [{ data: sucursal }, { data: movimentos }, { data: products }, { data: categories }, { data: cierresData }, { data: stockRows }, { data: aperturasData }, { data: retirosHoy }, personalResult, proveedoresResult] = await Promise.all([
    supabase.from("sucursales").select("*").eq("id", id).single(),
    (supabase as any)
      .from("movimientos")
      .select(`
        id, fecha, tipo, notas, canal, personal_id, created_at,
        pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
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
    (supabase as any).from("cierres_caja").select("*").eq("sucursal_id", id).order("created_at", { ascending: false }).limit(20) as unknown as Promise<{ data: CierreRow[] | null }>,
    (supabase as any).from("stock_sucursal").select("product_id, product_name, sku, entradas, salidas, stock_actual").eq("sucursal_id", id) as Promise<{ data: StockRow[] | null }>,
    (supabase as any).from("aperturas_caja").select("fondo_inicial, notas, created_at").eq("sucursal_id", id).order("created_at", { ascending: false }).limit(1) as unknown as Promise<{ data: AperturaRow[] | null }>,
    (supabase as any).from("retiros_caja").select("id, fecha, monto, motivo, created_at").eq("sucursal_id", id).order("fecha", { ascending: false }).order("created_at", { ascending: false }) as unknown as Promise<{ data: { id: string; fecha: string; monto: number; motivo: string; created_at: string }[] | null }>,
    (supabase as any)
      .from("profiles")
      .select("id, full_name")
      .eq("sucursal_id", id) as unknown as Promise<{ data: { id: string; full_name: string | null }[] | null }>,
    (supabase as any)
      .from("proveedores")
      .select("id, nombre")
      .eq("is_active", true)
      .order("nombre") as unknown as Promise<{ data: { id: string; nombre: string }[] | null }>,
  ]);

  const movimientos = movimentos;
  const aperturaActual   = aperturasData?.[0] ?? null;
  const ultimoCierre     = cierresData?.[0] ?? null;
  const historicosCierres = cierresData ?? [];
  const cajaAbierta      = aperturaActual != null && (ultimoCierre == null || aperturaActual.created_at > ultimoCierre.created_at);

  if (!sucursal) notFound();

  const personal     = (personalResult.data ?? []).map((p) => ({ id: p.id, nombre: p.full_name ?? "Sin nombre" }));
  const proveedores  = proveedoresResult.data ?? [];
  const personalMap: Record<string, string> = Object.fromEntries(personal.map((p) => [p.id, p.nombre]));

  // Staff solo puede ver su propia sucursal
  const role = user.app_metadata?.role as string | undefined;
  if (role === "encargado" && sucursal.encargado_user_id !== user.id) {
    redirect("/admin/dashboard");
  }
  if (role === "vendedor" && !personal.some((p) => p.id === user.id)) {
    redirect("/admin/dashboard");
  }

  const movs       = movimientos ?? [];
  const todosRetiros = retirosHoy ?? []; // ahora trae todos, no solo hoy
  const retirosHoyFilt = todosRetiros.filter((r) => r.fecha === hoy);

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

  const retiros        = retirosHoyFilt;
  const totalRetiros   = retiros.reduce((sum, r) => sum + r.monto, 0);

  const ventasHoy      = movs.filter((m) => m.tipo === "venta" && m.fecha === hoy);
  const totalVentasHoy = ventasHoy.reduce(
    (sum, m) => sum + m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0),
    0
  );

  const stockActual: Record<string, number> = Object.fromEntries(
    (stockRows ?? []).map((r) => [r.product_id, r.stock_actual])
  );

  // Analytics del mes seleccionado
  const ventasDelMes = movs.filter(
    (m) => m.tipo === "venta" && m.fecha >= mesInicio && m.fecha <= mesFin
  );
  const totalesPago = {
    efectivo:      ventasDelMes.reduce((s: number, m: any) => s + (m.pago_efectivo      ?? 0), 0),
    billetera:     ventasDelMes.reduce((s: number, m: any) => s + (m.pago_billetera     ?? 0), 0),
    tarjeta:       ventasDelMes.reduce((s: number, m: any) => s + (m.pago_tarjeta       ?? 0), 0),
    transferencia: ventasDelMes.reduce((s: number, m: any) => s + (m.pago_transferencia ?? 0), 0),
  };
  const totalVentasMes = ventasDelMes.reduce(
    (s: number, m: any) => s + m.movimiento_items.reduce((si: number, i: any) => si + (i.subtotal ?? 0), 0), 0
  );
  const prodMap: Record<string, { name: string; cantidad: number; total: number }> = {};
  for (const v of ventasDelMes) {
    for (const item of v.movimiento_items as any[]) {
      const name = item.product?.name ?? "Sin nombre";
      if (!prodMap[name]) prodMap[name] = { name, cantidad: 0, total: 0 };
      prodMap[name].cantidad += item.cantidad;
      prodMap[name].total    += item.subtotal ?? 0;
    }
  }
  const rankingProductos = Object.values(prodMap).sort((a, b) => b.total - a.total).slice(0, 5);

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        {role === "admin" && (
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
            {(role === "encargado" || role === "vendedor") ? (
              <>
                <RetiroEfectivoButton sucursalId={sucursal.id} />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="entrega"
                  label="Registrar recepción"
                  variant="ghost"
                  proveedores={proveedores}
                />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="venta"
                  stockMap={stockActual}
                  categories={categories ?? []}
                  personal={personal}
                  cajaAbierta={cajaAbierta}
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
                  personal={personal}
                  cajaAbierta={cajaAbierta}
                />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="entrega"
                  proveedores={proveedores}
                />
              </>
            )}
            <AperturaCajaButton
              sucursalId={sucursal.id}
              sucursalNombre={sucursal.nombre}
              cajaAbierta={cajaAbierta}
              aperturaActual={aperturaActual}
            />
            <CierreCajaButton
              sucursalId={sucursal.id}
              sucursalNombre={sucursal.nombre}
              movimientos={(movs as Parameters<typeof CierreCajaButton>[0]["movimientos"])}
              cajaAbierta={cajaAbierta}
              ultimoCierre={ultimoCierre}
              aperturaActual={aperturaActual}
            />
          </div>
        </div>
      </div>

      {/* ── Caja del día (staff) ── */}
      {(role === "encargado" || role === "vendedor") && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {/* Apertura */}
          <div className={`rounded-xl border p-4 ${cajaAbierta ? "bg-selva-50 border-selva-200" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${cajaAbierta ? "text-selva-600" : "text-neutral-400"}`}>
              Fondo inicial
            </p>
            {cajaAbierta && aperturaActual ? (
              <p className="text-xl font-bold font-display tabular-nums text-selva-700">{AR.format(aperturaActual.fondo_inicial)}</p>
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
          <div className={`rounded-xl border p-4 ${!cajaAbierta && ultimoCierre ? "bg-selva-50 border-selva-200" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${!cajaAbierta && ultimoCierre ? "text-selva-600" : "text-neutral-400"}`}>
              Cierre
            </p>
            {!cajaAbierta && ultimoCierre ? (
              <>
                <p className="text-sm font-bold text-selva-700">Cerrado ✓</p>
                <p className="text-[11px] text-selva-600 mt-1">{AR.format(ultimoCierre.total_ventas ?? 0)}</p>
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

      {/* Análisis del mes */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-neutral-900">Análisis</h2>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/admin/sucursales/${id}?mes=${prevMes}`}
              className="p-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors"
            >
              <svg className="size-3.5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </Link>
            <span className="text-sm font-medium text-neutral-700 capitalize w-36 text-center">{mesLabel}</span>
            {canGoNext ? (
              <Link
                href={`/admin/sucursales/${id}?mes=${nextMes}`}
                className="p-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors"
              >
                <svg className="size-3.5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ) : (
              <div className="size-8" />
            )}
          </div>
        </div>

        {ventasDelMes.length === 0 ? (
          <p className="text-sm text-neutral-400 py-2">Sin ventas registradas en <span className="capitalize">{mesLabel}</span>.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Medios de pago */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">Medios de pago</p>
              <div className="space-y-2.5">
                {(
                  [
                    { label: "Efectivo",       value: totalesPago.efectivo,      color: "bg-selva-50 text-selva-700" },
                    { label: "Billetera",      value: totalesPago.billetera,     color: "bg-blue-50 text-blue-700" },
                    { label: "Tarjeta",        value: totalesPago.tarjeta,       color: "bg-violet-50 text-violet-700" },
                    { label: "Transferencia",  value: totalesPago.transferencia, color: "bg-amber-50 text-amber-700" },
                  ] as const
                ).map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{label}</span>
                    <span className="text-sm font-semibold tabular-nums text-neutral-700">
                      {value > 0 ? AR.format(value) : <span className="text-neutral-300">—</span>}
                    </span>
                  </div>
                ))}
                <div className="pt-2 border-t border-neutral-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-500">Total ventas</span>
                  <span className="text-sm font-bold tabular-nums text-neutral-900">{AR.format(totalVentasMes)}</span>
                </div>
              </div>
            </div>

            {/* Ranking productos */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">Top productos</p>
              <div className="space-y-3">
                {rankingProductos.map((p, i) => {
                  const pct = totalVentasMes > 0 ? (p.total / totalVentasMes) * 100 : 0;
                  return (
                    <div key={p.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-neutral-300 w-4 text-right shrink-0">{i + 1}</span>
                          <span className="text-sm text-neutral-700 truncate">{p.name}</span>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-neutral-900 ml-2 shrink-0">{AR.format(p.total)}</span>
                      </div>
                      <div className="ml-6 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                        <div className="h-full rounded-full bg-tierra-400 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Acceso rápido a Cta. Corriente */}
      <div className="mb-6">
        <Link
          href={`/admin/sucursales/${sucursal.id}/cta-corriente`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:border-tierra-300 hover:bg-tierra-50 transition-colors text-sm font-medium text-neutral-700 hover:text-tierra-700"
        >
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
          Ver cuenta corriente
        </Link>
      </div>

      {/* Historial de cierres */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-neutral-900">Historial de cierres</h2>
          <span className="text-xs text-neutral-400">{historicosCierres.length} registros</span>
        </div>
        {historicosCierres.length === 0 ? (
          <p className="text-sm text-neutral-400">No hay cierres registrados.</p>
        ) : (
          <div className="rounded-xl border border-neutral-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-400 text-xs uppercase tracking-wider border-b border-neutral-200">
                  <th className="px-4 py-2.5 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Ventas</th>
                  <th className="px-4 py-2.5 text-right font-semibold hidden sm:table-cell">Efectivo</th>
                  <th className="px-4 py-2.5 text-right font-semibold hidden sm:table-cell">Billetera</th>
                  <th className="px-4 py-2.5 text-right font-semibold hidden md:table-cell">Tarjeta</th>
                  <th className="px-4 py-2.5 text-right font-semibold hidden md:table-cell">Transfer.</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {historicosCierres.map((c) => (
                  <tr key={c.created_at} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 text-neutral-700 font-medium">
                      {new Date(c.fecha + "T00:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">
                      {AR.format(c.total_ventas)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden sm:table-cell">
                      {c.efectivo_declarado > 0 ? AR.format(c.efectivo_declarado) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden sm:table-cell">
                      {(c.billetera_declarada ?? 0) > 0 ? AR.format(c.billetera_declarada) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden md:table-cell">
                      {(c.tarjeta_declarada ?? 0) > 0 ? AR.format(c.tarjeta_declarada!) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-neutral-500 hidden md:table-cell">
                      {(c.transferencia_declarada ?? 0) > 0 ? AR.format(c.transferencia_declarada!) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.diferencia !== null ? (
                        <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${
                          c.diferencia === 0
                            ? "bg-selva-50 text-selva-700"
                            : c.diferencia > 0
                            ? "bg-blue-50 text-blue-700"
                            : "bg-red-50 text-red-600"
                        }`}>
                          {c.diferencia > 0 ? "+" : ""}{AR.format(c.diferencia)}
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historial */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-neutral-900">Historial de movimientos</h2>
          <span className="text-xs text-neutral-400">{movs.length} registros</span>
        </div>
        <HistorialSucursal
          movimientos={movs as Parameters<typeof HistorialSucursal>[0]["movimientos"]}
          sucursalNombre={sucursal.nombre}
          retiros={todosRetiros}
          personalMap={personalMap}
        />
      </div>
    </div>
  );
}
