import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";
import { DiferenciaRow } from "./_components/diferencia-row";

export const revalidate = 0;
export const metadata: Metadata = { title: "Auditoría de stock — Kioscos IDEIA" };

const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function fmtCantidad(cantidad: number, unitLabel: string | null) {
  return unitLabel === "kg" ? `${formatKg(cantidad)} kg` : `${NUM.format(cantidad)} u.`;
}

type ItemRow = {
  id:              string;
  stock_sistema:   number;
  stock_contado:   number;
  diferencia:      number;
  observacion:     string | null;
  revisado_por:    string | null;
  revisado_en:     string | null;
  ajuste_aplicado: boolean;
  nota_admin:      string | null;
  product:         { name: string; sku: string; unit_label: string | null } | null;
};
type AuditoriaRow = {
  id:         string;
  sucursal_id: string;
  fecha:      string;
  created_by: string | null;
  sucursal:   { nombre: string } | null;
  auditoria_stock_items: ItemRow[];
};

export default async function AuditoriaPage({
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

  let query = (admin as any)
    .from("auditorias_stock")
    .select(`
      id, sucursal_id, fecha, created_by,
      sucursal:sucursales(nombre),
      auditoria_stock_items(
        id, stock_sistema, stock_contado, diferencia, observacion,
        revisado_por, revisado_en, ajuste_aplicado, nota_admin,
        product:products(name, sku, unit_label)
      )
    `)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false });

  if (sucFilter !== "all") query = query.eq("sucursal_id", sucFilter);

  const { data: auditoriasRaw, error } = (await query) as { data: AuditoriaRow[] | null; error: any };
  if (error) throw new Error(error.message);
  const auditorias = auditoriasRaw ?? [];

  // Nombre de quién realizó cada auditoría (created_by) -- mismo patrón que
  // /admin/ventas-diarias: profiles.full_name con fallback a auth.users.
  const auditorIds = [...new Set(auditorias.map((a) => a.created_by).filter(Boolean))] as string[];
  const profileMap: Record<string, string> = {};
  if (auditorIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", auditorIds);
    for (const p of profiles ?? []) if (p.full_name) profileMap[p.id] = p.full_name;
    const faltantes = auditorIds.filter((id) => !profileMap[id]);
    if (faltantes.length > 0) {
      const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 200 });
      for (const id of faltantes) {
        const u = (authUsers ?? []).find((au) => au.id === id);
        if (u) profileMap[id] = (u.user_metadata?.full_name as string | undefined) ?? u.email ?? id;
      }
    }
  }

  const diferencias = auditorias.flatMap((a) =>
    a.auditoria_stock_items
      .filter((i) => i.diferencia !== 0)
      .map((i) => ({
        ...i,
        fecha: a.fecha,
        sucursalNombre: a.sucursal?.nombre ?? "—",
        auditadoPor: a.created_by ? (profileMap[a.created_by] ?? "—") : "—",
      }))
  ).sort((a, b) => b.fecha.localeCompare(a.fecha));

  const sinRevisar = diferencias.filter((d) => !d.revisado_por);

  // Cumplimiento: última auditoría por sucursal (todo el historial, no solo el rango filtrado)
  const { data: todasFechas } = await (admin as any)
    .from("auditorias_stock")
    .select("sucursal_id, fecha")
    .order("fecha", { ascending: false });
  const ultimaPorSucursal = new Map<string, string>();
  for (const row of todasFechas ?? []) {
    if (!ultimaPorSucursal.has(row.sucursal_id)) ultimaPorSucursal.set(row.sucursal_id, row.fecha);
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Auditoría de stock</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Diferencias reportadas por el personal, pendientes de tu aprobación</p>
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
          <Link href="/admin/auditoria" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Diferencias sin revisar</p>
          <p className={`text-xl font-bold font-display tabular-nums ${sinRevisar.length > 0 ? "text-amber-600" : "text-selva-700"}`}>
            {sinRevisar.length}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Auditorías en el período</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{auditorias.length}</p>
        </div>
      </div>

      {/* Cumplimiento */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden mb-6">
        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Cumplimiento</p>
        </div>
        <div className="divide-y divide-neutral-100">
          {(sucursales ?? []).map((s) => {
            const ultima = ultimaPorSucursal.get(s.id);
            const auditoHoy = ultima === hoy;
            return (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-neutral-800">{s.nombre}</span>
                {auditoHoy ? (
                  <span className="text-xs font-semibold text-selva-700 bg-selva-50 px-2 py-0.5 rounded-full">Auditó hoy</span>
                ) : ultima ? (
                  <span className="text-xs text-neutral-400">
                    Última auditoría: {new Date(ultima + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-danger bg-danger/5 px-2 py-0.5 rounded-full">Nunca auditó</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Diferencias */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Diferencias reportadas</p>
        </div>
        {diferencias.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-400">Sin diferencias en el período seleccionado.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {diferencias.map((d) => (
              <DiferenciaRow
                key={d.id}
                itemId={d.id}
                fecha={d.fecha}
                sucursalNombre={d.sucursalNombre}
                auditadoPor={d.auditadoPor}
                productoNombre={d.product?.name ?? "Producto eliminado"}
                sku={d.product?.sku ?? ""}
                diferenciaTexto={fmtCantidad(d.diferencia, d.product?.unit_label ?? null)}
                diferenciaPositiva={d.diferencia > 0}
                stockSistemaTexto={fmtCantidad(d.stock_sistema, d.product?.unit_label ?? null)}
                stockContadoTexto={fmtCantidad(d.stock_contado, d.product?.unit_label ?? null)}
                observacion={d.observacion}
                revisado={d.revisado_por != null}
                ajusteAplicado={d.ajuste_aplicado}
                notaAdmin={d.nota_admin}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
