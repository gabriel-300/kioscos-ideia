import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import { VentasPorDiaChart } from "./_components/ventas-por-dia-chart";
import { DiasTable, type DiaFila, type TurnoFila } from "./_components/dias-table";

export const revalidate = 0;
export const metadata: Metadata = { title: "Ventas por día — Kioscos IDEIA" };

export default async function VentasDiariasPage({
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
  const desde = sp.desde ?? fechaHoyAR(new Date(Date.now() - 13 * 86400000));
  const hasta = sp.hasta ?? hoy;
  const sucFilter = sp.sucursal ?? "all";

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("is_active", true)
    .order("nombre");

  let query = (admin as any)
    .from("cierres_caja")
    .select(`
      id, fecha, created_at, total_ventas, diferencia, numero_liquidacion, created_by,
      sucursales(id, nombre)
    `)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });

  if (sucFilter !== "all") query = query.eq("sucursal_id", sucFilter);

  type CierreRow = {
    id: string;
    fecha: string;
    created_at: string;
    total_ventas: number | null;
    diferencia: number | null;
    numero_liquidacion: number | null;
    created_by: string | null;
    sucursales: { id: string; nombre: string } | null;
  };

  const { data: cierresRaw, error } = (await query) as { data: CierreRow[] | null; error: any };
  if (error) throw new Error(error.message);
  const cierres = cierresRaw ?? [];

  // Nombres de encargados -- mismo patrón que /admin/cierres (profiles, con
  // fallback a auth.users para los socios admin que no tienen full_name cargado).
  const userIds = [...new Set(cierres.map((c) => c.created_by).filter(Boolean))] as string[];
  let profileMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of profiles ?? []) if (p.full_name) profileMap[p.id] = p.full_name;
    const faltantes = userIds.filter((id) => !profileMap[id]);
    if (faltantes.length > 0) {
      const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 200 });
      for (const id of faltantes) {
        const u = (authUsers ?? []).find((au) => au.id === id);
        if (u) profileMap[id] = (u.user_metadata?.full_name as string | undefined) ?? u.email ?? id;
      }
    }
  }

  // Agrupar por día -- un cierre = un turno, varios cierres el mismo día = varios turnos
  const porDia = new Map<string, { fecha: string; totalVentas: number; cierres: CierreRow[] }>();
  for (const c of cierres) {
    const d = porDia.get(c.fecha) ?? { fecha: c.fecha, totalVentas: 0, cierres: [] };
    d.totalVentas += c.total_ventas ?? 0;
    d.cierres.push(c);
    porDia.set(c.fecha, d);
  }

  const diasParaGrafico = [...porDia.values()]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((d) => ({
      fecha: d.fecha,
      fechaDisplay: new Date(d.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }),
      totalVentas: d.totalVentas,
    }));

  const diasParaTabla: DiaFila[] = [...porDia.values()]
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map((d) => ({
      fecha: d.fecha,
      fechaDisplay: new Date(d.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "short" }),
      totalVentas: d.totalVentas,
      turnos: d.cierres
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((c): TurnoFila => ({
          id: c.id,
          numeroLiquidacion: c.numero_liquidacion,
          hora: new Date(c.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
          sucursalNombre: c.sucursales?.nombre ?? "—",
          encargado: c.created_by ? (profileMap[c.created_by] ?? "—") : "—",
          ventas: c.total_ventas ?? 0,
          diferencia: c.diferencia,
        })),
    }));

  const totalPeriodo = cierres.reduce((s, c) => s + (c.total_ventas ?? 0), 0);
  const promedioDiario = diasParaTabla.length > 0 ? totalPeriodo / diasParaTabla.length : 0;

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Ventas por día</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Cómo viene el negocio día a día, y el detalle de cada turno</p>
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
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="all">Todas</option>
            {(sucursales ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.sucursal) && (
          <Link href="/admin/ventas-diarias" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Total del período</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">
            {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(totalPeriodo)}
          </p>
          <p className="text-xs text-neutral-400 mt-0.5">{diasParaTabla.length} días con cierres</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Promedio diario</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">
            {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(promedioDiario)}
          </p>
        </div>
      </div>

      {/* Gráfico */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 md:p-6 mb-6">
        {diasParaGrafico.length === 0 ? (
          <p className="text-sm text-neutral-400 text-center py-12">Sin cierres en el período seleccionado.</p>
        ) : (
          <VentasPorDiaChart dias={diasParaGrafico} />
        )}
      </div>

      {/* Tabla por día */}
      <DiasTable dias={diasParaTabla} />
    </div>
  );
}
