import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const metadata: Metadata = { title: "Dashboard — Kioscos IDEIA" };
export const revalidate = 0;

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function StatCard({ label, value, sub, href }: { label: string; value: string | number; sub?: string; href?: string }) {
  const inner = (
    <div className="bg-white rounded-xl border border-neutral-200 p-5 hover:border-tierra-300 transition-colors">
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-2">{label}</p>
      <p className="text-3xl font-bold font-display text-neutral-900 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;

  // Encargado sin sucursal asignada
  if (role === "encargado") {
    const { data: sucursal } = await supabase
      .from("sucursales")
      .select("id, nombre")
      .eq("encargado_user_id", user.id)
      .single();

    if (sucursal) redirect(`/admin/sucursales/${sucursal.id}`);

    return (
      <div className="p-4 md:p-8 max-w-lg">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
          <div className="size-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4">
            <svg className="size-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
            </svg>
          </div>
          <p className="font-semibold text-neutral-900 mb-1">Sin sucursal asignada</p>
          <p className="text-sm text-neutral-500">
            Tu usuario todavía no tiene una sucursal asignada. Contactá al administrador para que te asigne una.
          </p>
        </div>
      </div>
    );
  }

  const now = new Date().toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const [
    { count: totalSucursales },
    { count: sucursalesActivas },
    { count: totalProductos },
    { count: productosActivos },
    { data: ultimosMovimientos },
    { data: movimientosMes },
  ] = await Promise.all([
    supabase.from("sucursales").select("*", { count: "exact", head: true }),
    supabase.from("sucursales").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("products").select("*", { count: "exact", head: true }),
    supabase.from("products").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("movimientos")
      .select(`
        id, fecha, tipo, created_at,
        sucursal:sucursales(nombre),
        movimiento_items(subtotal)
      `)
      .eq("tipo", "entrega")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("movimientos")
      .select(`
        sucursal:sucursales(id, nombre),
        movimiento_items(subtotal, cantidad, product:products(id, name))
      `)
      .eq("tipo", "entrega")
      .gte("fecha", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)),
  ]);

  type MesItem = { subtotal: number | null; cantidad: number; product: { id: string; name: string } | null };
  type MesMov  = { sucursal: { id: string; nombre: string } | null; movimiento_items: MesItem[] };

  const movsMes = (movimientosMes ?? []) as MesMov[];

  const totalMes = movsMes.reduce((sum, m) =>
    sum + m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0), 0);

  // Top 5 sucursales del mes
  const sucursalMap = new Map<string, { nombre: string; total: number }>();
  for (const m of movsMes) {
    if (!m.sucursal) continue;
    const key = m.sucursal.id;
    const existing = sucursalMap.get(key) ?? { nombre: m.sucursal.nombre, total: 0 };
    existing.total += m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    sucursalMap.set(key, existing);
  }
  const topSucursales = Array.from(sucursalMap.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Top 5 productos del mes
  const productoMap = new Map<string, { name: string; cantidad: number }>();
  for (const m of movsMes) {
    for (const item of m.movimiento_items) {
      if (!item.product) continue;
      const key = item.product.id;
      const existing = productoMap.get(key) ?? { name: item.product.name, cantidad: 0 };
      existing.cantidad += item.cantidad;
      productoMap.set(key, existing);
    }
  }
  const topProductos = Array.from(productoMap.values())
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5);

  const TIPO_LABEL: Record<string, string> = { entrega: "Entrega", devolucion: "Devolución", ajuste: "Ajuste" };
  const TIPO_COLOR: Record<string, string> = {
    entrega:    "bg-selva-100 text-selva-700",
    devolucion: "bg-warning-bg text-warning",
    ajuste:     "bg-neutral-100 text-neutral-500",
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Dashboard</h1>
        <p className="text-sm text-neutral-400 mt-0.5 capitalize">{now}</p>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Sucursales activas"
          value={sucursalesActivas ?? 0}
          sub={`de ${totalSucursales ?? 0} totales`}
          href="/admin/sucursales"
        />
        <StatCard
          label="Productos activos"
          value={productosActivos ?? 0}
          sub={`de ${totalProductos ?? 0} totales`}
          href="/admin/productos"
        />
        <StatCard
          label="Entregas este mes"
          value={movimientosMes?.length ?? 0}
          sub="solo tipo entrega"
          href="/admin/movimientos"
        />
        <StatCard
          label="Facturado este mes"
          value={totalMes > 0 ? AR.format(totalMes) : "—"}
          sub="solo entregas con precio"
        />
      </div>

      {/* Rankings del mes */}
      {(topSucursales.length > 0 || topProductos.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Top sucursales */}
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100">
              <h2 className="text-sm font-semibold text-neutral-900">Top kioscos este mes</h2>
            </div>
            {topSucursales.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-400">Sin datos.</p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {topSucursales.map((s, i) => (
                  <Link
                    key={s.id}
                    href={`/admin/sucursales/${s.id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 transition-colors"
                  >
                    <span className="text-xs font-bold tabular-nums text-neutral-300 w-4">{i + 1}</span>
                    <span className="flex-1 text-sm font-medium text-neutral-800 truncate">{s.nombre}</span>
                    <span className="text-sm font-semibold tabular-nums text-tierra-700">{AR.format(s.total)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Top productos */}
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100">
              <h2 className="text-sm font-semibold text-neutral-900">Productos más distribuidos este mes</h2>
            </div>
            {topProductos.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-400">Sin datos.</p>
            ) : (
              <div className="divide-y divide-neutral-100">
                {topProductos.map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3 px-5 py-3">
                    <span className="text-xs font-bold tabular-nums text-neutral-300 w-4">{i + 1}</span>
                    <span className="flex-1 text-sm font-medium text-neutral-800 truncate">{p.name}</span>
                    <span className="text-sm font-semibold tabular-nums text-neutral-700">{p.cantidad} u.</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Últimos movimientos */}
      <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
          <h2 className="text-sm font-semibold text-neutral-900">Últimas entregas</h2>
          <Link href="/admin/movimientos" className="text-xs text-tierra-700 hover:underline font-medium">
            Ver todas
          </Link>
        </div>

        {!ultimosMovimientos || ultimosMovimientos.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-neutral-400">
            Todavía no hay movimientos registrados.{" "}
            <Link href="/admin/movimientos" className="text-tierra-700 hover:underline">Registrar primera entrega</Link>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {ultimosMovimientos.map((m) => {
              const total = (m.movimiento_items ?? []).reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0);
              const sucursal = m.sucursal as { nombre: string } | null;
              return (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 transition-colors">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIPO_COLOR[m.tipo]}`}>
                    {TIPO_LABEL[m.tipo]}
                  </span>
                  <span className="flex-1 text-sm font-medium text-neutral-800 truncate">
                    {sucursal?.nombre ?? "—"}
                  </span>
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
