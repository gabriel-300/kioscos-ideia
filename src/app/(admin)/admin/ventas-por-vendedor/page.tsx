import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import { VendedoresTable, type VendedorFila, type VentaDetalle } from "./_components/vendedores-table";

export const revalidate = 0;
export const metadata: Metadata = { title: "Ventas por vendedor — Kioscos IDEIA" };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const CANAL_LABELS: Record<string, string> = {
  consumidor_final:     "Consumidor Final",
  pedido_ya_efectivo:   "Pedido Ya Efectivo",
  pedido_ya_plataforma: "Pedido Ya Plataforma",
  cuenta_corriente:     "Cta. Corriente",
  ambulante:            "Ambulante",
};

export default async function VentasPorVendedorPage({
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

  type ItemRow  = { cantidad: number; subtotal: number | null };
  type VentaRow = {
    id: string; fecha: string; created_at: string; canal: string | null; created_by: string;
    sucursales: { nombre: string } | null;
    movimiento_items: ItemRow[];
  };

  // PostgREST devuelve como mucho 1000 filas por consulta si no se pagina --
  // con 30 días × varias sucursales esto se pisa fácil (fue exactamente lo
  // que pasó: "1000 ventas" clavado cortaba el período antes de llegar a
  // "hasta"). Se pagina con .range() hasta que una página vuelve incompleta.
  const PAGE_SIZE = 1000;
  const ventas: VentaRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = (admin as any)
      .from("movimientos")
      .select(`
        id, fecha, created_at, canal, created_by,
        sucursales(nombre),
        movimiento_items(cantidad, subtotal)
      `)
      .eq("tipo", "venta")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .not("created_by", "is", null)
      .order("fecha", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (sucFilter !== "all") query = query.eq("sucursal_id", sucFilter);

    const { data, error } = (await query) as { data: VentaRow[] | null; error: any };
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    ventas.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
  }

  // Nombre de cada vendedor sale de profiles (más prolijo cuando está cargado);
  // el rol SIEMPRE sale de auth.users.app_metadata, no de profiles.role -- ese
  // campo puede estar desincronizado (el rol real se asigna sobre app_metadata,
  // ver src/app/(admin)/admin/staff/actions.ts).
  const userIds = [...new Set(ventas.map((v) => v.created_by))];
  const profileMap: Record<string, { nombre: string; role: string | null }> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", userIds);
    const nombreMap: Record<string, string> = {};
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) nombreMap[p.id] = p.full_name;
    }

    const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const id of userIds) {
      const u = (authUsers ?? []).find((au) => au.id === id);
      profileMap[id] = {
        nombre: nombreMap[id] ?? (u?.user_metadata?.full_name as string | undefined) ?? u?.email ?? id,
        role:   (u?.app_metadata?.role as string | undefined) ?? null,
      };
    }
  }

  // Agrupar por vendedor (created_by = quién procesó la venta, no confundir
  // con personal_id que es el CLIENTE de Cta. Corriente en esa venta).
  const porVendedor = new Map<string, VendedorFila>();
  for (const venta of ventas) {
    const monto = venta.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    const unidades = venta.movimiento_items.reduce((s, i) => s + Number(i.cantidad), 0);
    const info = profileMap[venta.created_by] ?? { nombre: "Usuario eliminado", role: null };

    const prev = porVendedor.get(venta.created_by);
    const detalle: VentaDetalle = {
      id:             venta.id,
      fecha:          venta.fecha,
      hora:           new Date(venta.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      sucursalNombre: venta.sucursales?.nombre ?? "—",
      canalLabel:     CANAL_LABELS[venta.canal ?? "consumidor_final"] ?? venta.canal ?? "—",
      monto,
    };

    if (prev) {
      prev.ventasCount += 1;
      prev.facturado   += monto;
      prev.unidades    += unidades;
      prev.ventas.push(detalle);
    } else {
      porVendedor.set(venta.created_by, {
        vendedorId:  venta.created_by,
        nombre:      info.nombre,
        role:        info.role,
        ventasCount: 1,
        facturado:   monto,
        unidades,
        ventas:      [detalle],
      });
    }
  }

  const vendedores = [...porVendedor.values()]
    .map((v) => ({ ...v, ventas: v.ventas.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora)) }))
    .sort((a, b) => b.facturado - a.facturado);

  const totalFacturado = vendedores.reduce((s, v) => s + v.facturado, 0);
  const totalVentas    = vendedores.reduce((s, v) => s + v.ventasCount, 0);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Ventas por vendedor</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Ranking de quién vendió qué en el período, no importa desde qué sucursal</p>
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
          <Link href="/admin/ventas-por-vendedor" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Total del período</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalFacturado)}</p>
          <p className="text-xs text-neutral-400 mt-0.5">{totalVentas} ventas · {vendedores.length} vendedores</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Más vendido</p>
          {vendedores.length > 0 ? (
            <>
              <p className="text-sm font-bold text-neutral-900 leading-snug">{vendedores[0].nombre}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{AR.format(vendedores[0].facturado)}</p>
            </>
          ) : (
            <p className="text-sm text-neutral-400 mt-1">—</p>
          )}
        </div>
      </div>

      <VendedoresTable vendedores={vendedores} />

      <p className="text-xs text-neutral-400 mt-3">
        Se atribuye cada venta a quién la cargó en el sistema (no al beneficiario de una Cta. Corriente, que es el cliente, no quien la vendió).
      </p>
    </div>
  );
}
