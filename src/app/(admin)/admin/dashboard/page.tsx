import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR, primerDiaMesAR, fmtFechaLarga } from "@/lib/fecha";

export const metadata: Metadata = { title: "Dashboard — Kioscos IDEIA" };
export const revalidate = 0;

const AR  = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const PCT = (v: number) => `${Math.round(v)}%`;

type StatCardProps = {
  label: string;
  value: string | number;
  sub?:  string;
  href?: string;
  icon:  React.ReactNode;
  color: "blue" | "violet" | "green" | "tierra" | "amber";
};

const COLOR: Record<StatCardProps["color"], { chip: string; icon: string }> = {
  blue:   { chip: "bg-blue-100",   icon: "text-blue-600" },
  violet: { chip: "bg-violet-100", icon: "text-violet-600" },
  green:  { chip: "bg-selva-100",  icon: "text-selva-700" },
  tierra: { chip: "bg-tierra-100", icon: "text-tierra-700" },
  amber:  { chip: "bg-amber-100",  icon: "text-amber-600" },
};

function StatCard({ label, value, sub, href, icon, color }: StatCardProps) {
  const { chip, icon: iconColor } = COLOR[color];
  const inner = (
    <div className="bg-white rounded-xl border border-neutral-200 p-5 hover:border-neutral-300 hover:shadow-sm transition-all group">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className={`size-9 rounded-xl ${chip} flex items-center justify-center shrink-0`}>
          <span className={iconColor}>{icon}</span>
        </div>
      </div>
      <p className="text-xl md:text-2xl font-bold font-display text-neutral-900 tabular-nums leading-tight mb-1 break-words">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{label}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : <div>{inner}</div>;
}

function RotacionBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-neutral-300 text-xs">—</span>;
  const color = pct >= 60 ? "text-selva-700 bg-selva-50" : pct >= 30 ? "text-amber-700 bg-amber-50" : "text-danger bg-danger/5";
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{PCT(pct)}</span>;
}

// ── SVG icons ──
const ICON_STORE = <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></svg>;
const ICON_BOX   = <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>;
const ICON_TRUCK = <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></svg>;
const ICON_MONEY = <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>;
const ICON_CART  = <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>;

// PostgREST devuelve como mucho 1000 filas por consulta si no se pagina --
// "entregas/ventas del mes" cruza todas las sucursales y puede pisar ese
// límite bien entrado el mes (mismo bug que se encontró y arregló en
// /admin/ventas, /admin/ventas-por-vendedor y /admin/mermas).
async function fetchAllMovimientosDelMes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tipo: "entrega" | "venta",
  desde: string
) {
  const PAGE_SIZE = 1000;
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("movimientos")
      .select("sucursal:sucursales(id, nombre), movimiento_items(subtotal, cantidad, product:products(id, name))")
      .eq("tipo", tipo)
      .gte("fecha", desde)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    rows.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
  }
  return { data: rows };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;

  if (role === "encargado") {
    const { data: sucursal } = await supabase
      .from("sucursales")
      .select("id")
      .eq("encargado_user_id", user.id)
      .single();
    if (sucursal) redirect(`/admin/sucursales/${sucursal.id}`);
    return (
      <div className="p-4 md:p-8 max-w-lg">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
          <p className="font-semibold text-neutral-900 mb-1">Sin sucursal asignada</p>
          <p className="text-sm text-neutral-500">Contactá al administrador para que te asigne una.</p>
        </div>
      </div>
    );
  }

  if (role === "vendedor") {
    const res = await (supabase as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    const sucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
    if (sucursalId) redirect(`/admin/sucursales/${sucursalId}`);
    return (
      <div className="p-4 md:p-8 max-w-lg">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
          <p className="font-semibold text-neutral-900 mb-1">Sin sucursal asignada</p>
          <p className="text-sm text-neutral-500">Contactá al administrador para que te asigne una.</p>
        </div>
      </div>
    );
  }

  const admin = createAdminClient();
  const now       = fmtFechaLarga(new Date());
  const hoy       = fechaHoyAR();
  const mesInicio = primerDiaMesAR();

  const [
    { count: totalSucursales },
    { count: sucursalesActivas },
    { count: totalProductos },
    { count: productosActivos },
    { data: ultimosMovimientos },
    { data: entregasMesRaw },
    { data: ventasMesRaw },
    { data: sucursalesHoy },
    { data: ventasHoyRaw },
    aperturaHoyRaw,
    cierreHoyRaw,
    retirosHoyRaw,
    stockSucursalRaw,
    prodsMinimoRaw,
  ] = await Promise.all([
    supabase.from("sucursales").select("*", { count: "exact", head: true }),
    supabase.from("sucursales").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("products").select("*", { count: "exact", head: true }).eq("is_active", true),
    // últimas entregas para la tabla de actividad
    supabase
      .from("movimientos")
      .select("id, fecha, tipo, created_at, sucursal:sucursales(nombre), movimiento_items(subtotal)")
      .eq("tipo", "entrega")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    // entregas del mes
    fetchAllMovimientosDelMes(supabase, "entrega", mesInicio),
    // ventas POS del mes
    fetchAllMovimientosDelMes(supabase, "venta", mesInicio),
    // sucursales activas para resumen del día
    supabase.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    // ventas de hoy por sucursal
    supabase
      .from("movimientos")
      .select("sucursal_id, movimiento_items(subtotal)")
      .eq("tipo", "venta")
      .eq("fecha", hoy),
    // aperturas de hoy
    (supabase as any)
      .from("aperturas_caja")
      .select("sucursal_id, fondo_inicial")
      .eq("fecha", hoy) as unknown as Promise<{ data: { sucursal_id: string; fondo_inicial: number }[] | null }>,
    // cierres de hoy
    (supabase as any)
      .from("cierres_caja")
      .select("sucursal_id, total_ventas")
      .eq("fecha", hoy) as unknown as Promise<{ data: { sucursal_id: string; total_ventas: number }[] | null }>,
    // retiros de hoy
    (supabase as any)
      .from("retiros_caja")
      .select("sucursal_id, monto")
      .eq("fecha", hoy) as unknown as Promise<{ data: { sucursal_id: string; monto: number }[] | null }>,
    // stock actual por sucursal/producto (para alertas)
    (admin as any)
      .from("stock_sucursal")
      .select("sucursal_id, product_id, stock_actual") as unknown as Promise<{ data: { sucursal_id: string; product_id: string; stock_actual: number }[] | null }>,
    // productos con stock mínimo configurado
    admin
      .from("products")
      .select("id, name, stock_minimo")
      .eq("is_active", true)
      .gt("stock_minimo", 0) as unknown as Promise<{ data: { id: string; name: string; stock_minimo: number }[] | null }>,
  ]);

  type Item = { subtotal: number | null; cantidad: number; product: { id: string; name: string } | null };
  type Mov  = { sucursal: { id: string; nombre: string } | null; movimiento_items: Item[] };

  const entregasMes = (entregasMesRaw ?? []) as Mov[];
  const ventasMes   = (ventasMesRaw   ?? []) as Mov[];

  // ── Totales ──
  const totalEntregado = entregasMes.reduce((s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0);
  const totalVendido   = ventasMes.reduce(  (s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0);
  const rotacionGlobal = totalEntregado > 0 ? (totalVendido / totalEntregado) * 100 : null;

  // ── Por sucursal ──
  const sucMap = new Map<string, { nombre: string; entregado: number; vendido: number }>();

  for (const m of entregasMes) {
    if (!m.sucursal) continue;
    const s = sucMap.get(m.sucursal.id) ?? { nombre: m.sucursal.nombre, entregado: 0, vendido: 0 };
    s.entregado += m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0);
    sucMap.set(m.sucursal.id, s);
  }
  for (const m of ventasMes) {
    if (!m.sucursal) continue;
    const s = sucMap.get(m.sucursal.id) ?? { nombre: m.sucursal.nombre, entregado: 0, vendido: 0 };
    s.vendido += m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0);
    sucMap.set(m.sucursal.id, s);
  }

  const sucursalesMes = Array.from(sucMap.entries())
    .map(([id, v]) => ({ id, ...v, rotacion: v.entregado > 0 ? (v.vendido / v.entregado) * 100 : null }))
    .sort((a, b) => b.entregado - a.entregado);

  const maxEntregado = sucursalesMes[0]?.entregado ?? 1;
  const maxVendido   = Math.max(...sucursalesMes.map((s) => s.vendido), 1);

  // ── Productos ──
  const distribMap = new Map<string, { name: string; cantidad: number }>();
  const vendidoMap = new Map<string, { name: string; cantidad: number }>();

  for (const m of entregasMes) {
    for (const i of m.movimiento_items) {
      if (!i.product) continue;
      const e = distribMap.get(i.product.id) ?? { name: i.product.name, cantidad: 0 };
      e.cantidad += Number(i.cantidad);
      distribMap.set(i.product.id, e);
    }
  }
  for (const m of ventasMes) {
    for (const i of m.movimiento_items) {
      if (!i.product) continue;
      const e = vendidoMap.get(i.product.id) ?? { name: i.product.name, cantidad: 0 };
      e.cantidad += Number(i.cantidad);
      vendidoMap.set(i.product.id, e);
    }
  }

  const topDistrib  = Array.from(distribMap.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);
  const topVendidos = Array.from(vendidoMap.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);
  const maxDistrib  = topDistrib[0]?.cantidad  ?? 1;
  const maxVendidos = topVendidos[0]?.cantidad ?? 1;

  // ── Resumen del día por sucursal ──
  type ResumenSuc = {
    id: string; nombre: string;
    apertura: number | null;
    ventasHoy: number;
    registrosVenta: number;
    retiros: number;
    cerrado: boolean;
  };

  const ventasHoyMap = new Map<string, { total: number; registros: number }>();
  for (const v of ventasHoyRaw ?? []) {
    const total = (v.movimiento_items as { subtotal: number | null }[]).reduce((s, i) => s + (i.subtotal ?? 0), 0);
    const prev  = ventasHoyMap.get(v.sucursal_id) ?? { total: 0, registros: 0 };
    ventasHoyMap.set(v.sucursal_id, { total: prev.total + total, registros: prev.registros + 1 });
  }
  const aperturaMap = new Map((aperturaHoyRaw.data ?? []).map((a) => [a.sucursal_id, a.fondo_inicial]));
  const cierreSet   = new Set((cierreHoyRaw.data  ?? []).map((c) => c.sucursal_id));
  const retirosMap  = new Map<string, number>();
  for (const r of retirosHoyRaw.data ?? []) {
    retirosMap.set(r.sucursal_id, (retirosMap.get(r.sucursal_id) ?? 0) + r.monto);
  }

  const resumenHoy: ResumenSuc[] = (sucursalesHoy ?? []).map((s) => ({
    id:             s.id,
    nombre:         s.nombre,
    apertura:       aperturaMap.has(s.id) ? aperturaMap.get(s.id)! : null,
    ventasHoy:      ventasHoyMap.get(s.id)?.total    ?? 0,
    registrosVenta: ventasHoyMap.get(s.id)?.registros ?? 0,
    retiros:        retirosMap.get(s.id) ?? 0,
    cerrado:        cierreSet.has(s.id),
  }));

  const totalVentasHoy = resumenHoy.reduce((s, r) => s + r.ventasHoy, 0);

  // ── Alertas de stock bajo ──
  const prodsMinimoMap = new Map(
    (prodsMinimoRaw?.data ?? []).map((p) => [p.id, p])
  );
  type AlertaStock = { sucursalId: string; productName: string; stockActual: number; stockMinimo: number };
  const alertasStock: AlertaStock[] = [];
  for (const row of stockSucursalRaw?.data ?? []) {
    const prod = prodsMinimoMap.get(row.product_id);
    if (!prod) continue;
    if (row.stock_actual <= prod.stock_minimo) {
      alertasStock.push({ sucursalId: row.sucursal_id, productName: prod.name, stockActual: row.stock_actual, stockMinimo: prod.stock_minimo });
    }
  }
  const alertasBySuc = new Map<string, AlertaStock[]>();
  for (const a of alertasStock) {
    alertasBySuc.set(a.sucursalId, [...(alertasBySuc.get(a.sucursalId) ?? []), a]);
  }
  const sucNombresMap = new Map((sucursalesHoy ?? []).map((s) => [s.id, s.nombre]));

  return (
    <div className="p-4 md:p-8 max-w-5xl">

      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Dashboard</h1>
          <p className="text-sm text-neutral-400 mt-0.5 capitalize">{now}</p>
        </div>
        <Link
          href="/admin/movimientos"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:border-tierra-300 hover:text-tierra-700 transition-colors"
        >
          <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nueva entrega
        </Link>
      </div>

      {/* ── Resumen del día ── */}
      {resumenHoy.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-neutral-900">Hoy — {new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long" })}</h2>
            {totalVentasHoy > 0 && (
              <span className="text-sm font-bold tabular-nums text-selva-700">{AR.format(totalVentasHoy)} total ventas</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {resumenHoy.map((s) => (
              <Link key={s.id} href={`/admin/sucursales/${s.id}`} className="block group">
                <div className="bg-white rounded-xl border border-neutral-200 p-4 hover:border-neutral-300 hover:shadow-sm transition-all">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-sm text-neutral-800 group-hover:text-tierra-700 transition-colors truncate">{s.nombre}</span>
                    {s.cerrado ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 shrink-0 ml-2">Cerrado</span>
                    ) : s.apertura !== null ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-selva-50 text-selva-700 shrink-0 ml-2">Abierto</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 shrink-0 ml-2">Sin apertura</span>
                    )}
                  </div>
                  {/* Métricas */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-wide mb-0.5">Fondo</p>
                      <p className="text-sm font-bold tabular-nums text-neutral-700">
                        {s.apertura !== null ? AR.format(s.apertura) : <span className="text-neutral-300 font-normal">—</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-wide mb-0.5">Ventas</p>
                      <p className={`text-sm font-bold tabular-nums ${s.ventasHoy > 0 ? "text-selva-700" : "text-neutral-300"}`}>
                        {s.ventasHoy > 0 ? AR.format(s.ventasHoy) : "—"}
                      </p>
                      {s.registrosVenta > 0 && (
                        <p className="text-[10px] text-neutral-400">{s.registrosVenta} reg.</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-400 font-medium uppercase tracking-wide mb-0.5">Retiros</p>
                      <p className={`text-sm font-bold tabular-nums ${s.retiros > 0 ? "text-danger" : "text-neutral-300"}`}>
                        {s.retiros > 0 ? AR.format(s.retiros) : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
        <StatCard label="Sucursales activas" value={sucursalesActivas ?? 0} sub={`de ${totalSucursales ?? 0} totales`} href="/admin/sucursales" icon={ICON_STORE} color="blue" />
        <StatCard label="Productos activos"  value={productosActivos  ?? 0} sub={`de ${totalProductos   ?? 0} totales`} href="/admin/productos"  icon={ICON_BOX}   color="violet" />
        <StatCard
          label="Entregado este mes"
          value={totalEntregado > 0 ? AR.format(totalEntregado) : "—"}
          sub={`${entregasMes.length} entregas — IDEIA → kioscos`}
          href="/admin/movimientos"
          icon={ICON_TRUCK}
          color="tierra"
        />
        <StatCard
          label="Vendido este mes"
          value={totalVendido > 0 ? AR.format(totalVendido) : "—"}
          sub={`${ventasMes.length} registros POS — kioscos → público`}
          icon={ICON_CART}
          color="green"
        />
      </div>

      {/* Rotación global */}
      {rotacionGlobal !== null && (
        <div className={`mb-8 rounded-xl border px-5 py-3 flex items-center gap-3 ${
          rotacionGlobal >= 60 ? "border-selva-200 bg-selva-50"
          : rotacionGlobal >= 30 ? "border-amber-200 bg-amber-50"
          : "border-danger/20 bg-danger/5"
        }`}>
          <div className={`text-2xl font-bold font-display tabular-nums ${
            rotacionGlobal >= 60 ? "text-selva-700" : rotacionGlobal >= 30 ? "text-amber-700" : "text-danger"
          }`}>{PCT(rotacionGlobal)}</div>
          <div>
            <p className={`text-sm font-semibold ${
              rotacionGlobal >= 60 ? "text-selva-800" : rotacionGlobal >= 30 ? "text-amber-800" : "text-danger"
            }`}>Rotación global este mes</p>
            <p className={`text-xs ${
              rotacionGlobal >= 60 ? "text-selva-600" : rotacionGlobal >= 30 ? "text-amber-600" : "text-danger/70"
            }`}>
              {rotacionGlobal >= 60
                ? "Los kioscos están vendiendo bien lo que reciben."
                : rotacionGlobal >= 30
                ? "Rotación media — hay margen para mejorar."
                : "Rotación baja — revisá stock o actividad de los kioscos."}
            </p>
          </div>
          <div className="ml-auto text-xs text-right hidden sm:block">
            <p className={`opacity-60 ${rotacionGlobal >= 60 ? "text-selva-700" : rotacionGlobal >= 30 ? "text-amber-700" : "text-danger"}`}>
              {AR.format(totalVendido)} vendido<br />de {AR.format(totalEntregado)} entregado
            </p>
          </div>
        </div>
      )}

      {/* Tabla por sucursal */}
      {sucursalesMes.length > 0 && (
        <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden mb-4">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">Kioscos este mes</h2>
            <Link href="/admin/sucursales" className="text-xs text-tierra-700 hover:underline font-medium">Ver todos</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: "500px" }}>
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-100">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-400">Sucursal</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-400">Entregado</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-400">Vendido POS</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-neutral-400">Rotación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {sucursalesMes.map((s) => (
                  <tr key={s.id} className="hover:bg-neutral-50/80 transition-colors group">
                    <td className="px-5 py-3">
                      <Link href={`/admin/sucursales/${s.id}`} className="font-medium text-neutral-800 group-hover:text-tierra-700 transition-colors">{s.nombre}</Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="tabular-nums font-semibold text-tierra-700">{s.entregado > 0 ? AR.format(s.entregado) : "—"}</span>
                        {s.entregado > 0 && (
                          <div className="w-20 h-1 rounded-full bg-neutral-100 overflow-hidden">
                            <div className="h-full bg-tierra-400 rounded-full" style={{ width: `${Math.round((s.entregado / maxEntregado) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span className="tabular-nums font-semibold text-selva-700">{s.vendido > 0 ? AR.format(s.vendido) : <span className="text-neutral-300 font-normal text-xs">Sin registro</span>}</span>
                        {s.vendido > 0 && (
                          <div className="w-20 h-1 rounded-full bg-neutral-100 overflow-hidden">
                            <div className="h-full bg-selva-400 rounded-full" style={{ width: `${Math.round((s.vendido / maxVendido) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <RotacionBadge pct={s.rotacion} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {sucursalesMes.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-neutral-100 bg-neutral-50">
                    <td className="px-5 py-2.5 text-xs font-semibold text-neutral-500">Total</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-tierra-700 tabular-nums">{AR.format(totalEntregado)}</td>
                    <td className="px-4 py-2.5 text-right text-xs font-bold text-selva-700 tabular-nums">{totalVendido > 0 ? AR.format(totalVendido) : "—"}</td>
                    <td className="px-4 py-2.5 text-center"><RotacionBadge pct={rotacionGlobal} /></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Rankings de productos */}
      {(topDistrib.length > 0 || topVendidos.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

          {/* Más distribuidos */}
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">Más distribuidos</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Unidades entregadas a kioscos</p>
              </div>
              <Link href="/admin/stock" className="text-xs text-tierra-700 hover:underline font-medium">Ver stock</Link>
            </div>
            {topDistrib.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-400">Sin datos este mes.</p>
            ) : (
              <div className="divide-y divide-neutral-50">
                {topDistrib.map((p, i) => (
                  <div key={p.name} className="flex flex-col gap-1.5 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold tabular-nums text-neutral-300 w-4 shrink-0">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium text-neutral-800 truncate">{p.name}</span>
                      <span className="text-sm font-semibold tabular-nums text-tierra-700">{NUM.format(p.cantidad)} u.</span>
                    </div>
                    <div className="pl-7">
                      <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                        <div className="h-full bg-tierra-400 rounded-full" style={{ width: `${Math.round((p.cantidad / maxDistrib) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Más vendidos POS */}
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900">Más vendidos</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Unidades vendidas al público (POS)</p>
              </div>
              <Link href="/admin/cierres" className="text-xs text-tierra-700 hover:underline font-medium">Ver cierres</Link>
            </div>
            {topVendidos.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-400">Sin ventas POS este mes.</p>
            ) : (
              <div className="divide-y divide-neutral-50">
                {topVendidos.map((p, i) => (
                  <div key={p.name} className="flex flex-col gap-1.5 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold tabular-nums text-neutral-300 w-4 shrink-0">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium text-neutral-800 truncate">{p.name}</span>
                      <span className="text-sm font-semibold tabular-nums text-selva-700">{NUM.format(p.cantidad)} u.</span>
                    </div>
                    <div className="pl-7">
                      <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                        <div className="h-full bg-selva-400 rounded-full" style={{ width: `${Math.round((p.cantidad / maxVendidos) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alertas de stock bajo */}
      {alertasBySuc.size > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden mb-4">
          <div className="px-5 py-3 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="size-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <h2 className="text-sm font-semibold text-amber-800">
                Stock bajo — {alertasStock.length} {alertasStock.length === 1 ? "producto" : "productos"} en {alertasBySuc.size} {alertasBySuc.size === 1 ? "kiosco" : "kioscos"}
              </h2>
            </div>
            <Link href="/admin/stock" className="text-xs text-amber-700 hover:underline font-medium">Ver stock completo</Link>
          </div>
          <div className="divide-y divide-neutral-50">
            {Array.from(alertasBySuc.entries()).map(([sucId, items]) => (
              <div key={sucId} className="px-5 py-3">
                <Link href={`/admin/sucursales/${sucId}`} className="text-xs font-semibold text-neutral-700 hover:text-tierra-700 transition-colors">
                  {sucNombresMap.get(sucId) ?? sucId}
                </Link>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {items.map((a) => (
                    <span key={a.productName} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      a.stockActual <= 0 ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}>
                      {a.productName}
                      <span className="opacity-60">·</span>
                      <span className="tabular-nums">{a.stockActual <= 0 ? "sin stock" : `${a.stockActual} u.`}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Últimas entregas */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="text-sm font-semibold text-neutral-900">Últimas entregas</h2>
          <Link href="/admin/movimientos" className="text-xs text-tierra-700 hover:underline font-medium">Ver todas</Link>
        </div>
        {!ultimosMovimientos?.length ? (
          <div className="px-5 py-10 text-center text-sm text-neutral-400">
            Todavía no hay entregas registradas.{" "}
            <Link href="/admin/movimientos" className="text-tierra-700 hover:underline">Registrar primera</Link>
          </div>
        ) : (
          <div className="divide-y divide-neutral-50">
            {ultimosMovimientos.map((m) => {
              const total    = (m.movimiento_items ?? []).reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0);
              const sucursal = m.sucursal as { nombre: string } | null;
              return (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 transition-colors">
                  <span className="size-2 rounded-full bg-tierra-400 shrink-0" />
                  <span className="flex-1 text-sm font-medium text-neutral-800 truncate">{sucursal?.nombre ?? "—"}</span>
                  <span className="text-xs text-neutral-400 shrink-0">
                    {new Date(m.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-neutral-700 shrink-0 w-24 text-right">
                    {total > 0 ? AR.format(total) : <span className="text-neutral-300 font-normal text-xs">Sin precio</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
