import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const metadata: Metadata = { title: "Dashboard — Kioscos IDEIA" };
export const revalidate = 0;

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type StatCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  icon: React.ReactNode;
  color: "blue" | "violet" | "green" | "tierra";
};

const COLOR: Record<StatCardProps["color"], { chip: string; icon: string }> = {
  blue:   { chip: "bg-blue-100",    icon: "text-blue-600" },
  violet: { chip: "bg-violet-100",  icon: "text-violet-600" },
  green:  { chip: "bg-selva-100",   icon: "text-selva-700" },
  tierra: { chip: "bg-tierra-100",  icon: "text-tierra-700" },
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
      <p className="text-2xl font-bold font-display text-neutral-900 tabular-nums leading-none mb-1">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{label}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : <div>{inner}</div>;
}

const ICON_STORE = (
  <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
  </svg>
);
const ICON_BOX = (
  <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);
const ICON_TRUCK = (
  <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
  </svg>
);
const ICON_MONEY = (
  <svg className="size-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
  </svg>
);

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;

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

  const mesInicio = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

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
      .gte("fecha", mesInicio),
  ]);

  type MesItem = { subtotal: number | null; cantidad: number; product: { id: string; name: string } | null };
  type MesMov  = { sucursal: { id: string; nombre: string } | null; movimiento_items: MesItem[] };

  const movsMes = (movimientosMes ?? []) as MesMov[];

  const totalMes = movsMes.reduce((sum, m) =>
    sum + m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0), 0);

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

  const maxSucTotal   = topSucursales[0]?.total    ?? 1;
  const maxProdCant   = topProductos[0]?.cantidad  ?? 1;

  return (
    <div className="p-4 md:p-8 max-w-5xl">
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

      {/* Métricas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Sucursales activas"
          value={sucursalesActivas ?? 0}
          sub={`de ${totalSucursales ?? 0} totales`}
          href="/admin/sucursales"
          icon={ICON_STORE}
          color="blue"
        />
        <StatCard
          label="Productos activos"
          value={productosActivos ?? 0}
          sub={`de ${totalProductos ?? 0} totales`}
          href="/admin/productos"
          icon={ICON_BOX}
          color="violet"
        />
        <StatCard
          label="Entregas este mes"
          value={movimientosMes?.length ?? 0}
          sub="solo tipo entrega"
          href="/admin/movimientos"
          icon={ICON_TRUCK}
          color="green"
        />
        <StatCard
          label="Facturado este mes"
          value={totalMes > 0 ? AR.format(totalMes) : "—"}
          sub="solo entregas con precio"
          icon={ICON_MONEY}
          color="tierra"
        />
      </div>

      {/* Rankings */}
      {(topSucursales.length > 0 || topProductos.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Top sucursales */}
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Top kioscos — este mes</h2>
              <Link href="/admin/sucursales" className="text-xs text-tierra-700 hover:underline font-medium">Ver todos</Link>
            </div>
            {topSucursales.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-400">Sin datos este mes.</p>
            ) : (
              <div className="divide-y divide-neutral-50">
                {topSucursales.map((s, i) => (
                  <Link
                    key={s.id}
                    href={`/admin/sucursales/${s.id}`}
                    className="flex flex-col gap-1.5 px-5 py-3 hover:bg-neutral-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold tabular-nums text-neutral-300 w-4 shrink-0">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium text-neutral-800 truncate group-hover:text-tierra-700 transition-colors">{s.nombre}</span>
                      <span className="text-sm font-semibold tabular-nums text-tierra-700">{AR.format(s.total)}</span>
                    </div>
                    <div className="pl-7">
                      <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                        <div
                          className="h-full bg-tierra-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.round((s.total / maxSucTotal) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Top productos */}
          <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Más distribuidos — este mes</h2>
              <Link href="/admin/stock" className="text-xs text-tierra-700 hover:underline font-medium">Ver stock</Link>
            </div>
            {topProductos.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-400">Sin datos este mes.</p>
            ) : (
              <div className="divide-y divide-neutral-50">
                {topProductos.map((p, i) => (
                  <div key={p.name} className="flex flex-col gap-1.5 px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold tabular-nums text-neutral-300 w-4 shrink-0">{i + 1}</span>
                      <span className="flex-1 text-sm font-medium text-neutral-800 truncate">{p.name}</span>
                      <span className="text-sm font-semibold tabular-nums text-neutral-700">{p.cantidad} u.</span>
                    </div>
                    <div className="pl-7">
                      <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
                        <div
                          className="h-full bg-selva-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.round((p.cantidad / maxProdCant) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Últimas entregas */}
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
          <div className="divide-y divide-neutral-50">
            {ultimosMovimientos.map((m) => {
              const total = (m.movimiento_items ?? []).reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0);
              const sucursal = m.sucursal as { nombre: string } | null;
              return (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 transition-colors">
                  <span className="size-2 rounded-full bg-selva-500 shrink-0" />
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
