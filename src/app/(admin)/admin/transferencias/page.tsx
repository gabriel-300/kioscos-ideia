import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import { TransferenciasTable, type TransferenciaFila } from "./_components/transferencias-table";

export const revalidate = 0;
export const metadata: Metadata = { title: "Transferencias — Kioscos IDEIA" };

export default async function TransferenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; estado?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (!role || !["admin", "encargado", "vendedor"].includes(role)) redirect("/admin/dashboard");

  // Encargado/vendedor solo ven las transferencias de SU sucursal (enviadas
  // o recibidas) -- el listado sin filtro es privado de admin.
  let miSucursalId: string | null = null;
  if (role === "encargado") {
    const { data } = await admin.from("sucursales").select("id").eq("encargado_user_id", user.id).single();
    miSucursalId = data?.id ?? null;
  } else if (role === "vendedor") {
    const res = await (admin as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    miSucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
  }
  if (role !== "admin" && !miSucursalId) redirect("/admin/dashboard");

  const sp    = await searchParams;
  const hoy   = fechaHoyAR();
  const desde = sp.desde ?? fechaHoyAR(new Date(Date.now() - 29 * 86400000));
  const hasta = sp.hasta ?? hoy;
  const estadoFilter = sp.estado ?? "all";

  let query = (admin as any)
    .from("transferencias_stock")
    .select(`
      id, fecha, estado, notas_envio, notas_recepcion, enviado_por, recibido_por,
      anulada_en, motivo_anulacion,
      sucursal_origen:sucursales!transferencias_stock_sucursal_origen_id_fkey(nombre),
      sucursal_destino:sucursales!transferencias_stock_sucursal_destino_id_fkey(nombre),
      transferencia_items(id, cantidad_enviada, cantidad_recibida, product:products(name, unit_label))
    `)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });

  if (estadoFilter !== "all") query = query.eq("estado", estadoFilter);
  if (miSucursalId) query = query.or(`sucursal_origen_id.eq.${miSucursalId},sucursal_destino_id.eq.${miSucursalId}`);

  type Row = {
    id: string; fecha: string; estado: "enviada" | "recibida";
    notas_envio: string | null; notas_recepcion: string | null;
    enviado_por: string | null; recibido_por: string | null;
    anulada_en: string | null; motivo_anulacion: string | null;
    sucursal_origen: { nombre: string } | null;
    sucursal_destino: { nombre: string } | null;
    transferencia_items: { id: string; cantidad_enviada: number; cantidad_recibida: number | null; product: { name: string; unit_label: string | null } | null }[];
  };

  const { data: transferenciasRaw, error } = (await query) as { data: Row[] | null; error: any };
  if (error) throw new Error(error.message);
  const transferencias = transferenciasRaw ?? [];

  // Nombres de quién envió/recibió -- mismo patrón que /admin/ventas-diarias:
  // profiles.full_name con fallback a auth.users.
  const userIds = [...new Set(transferencias.flatMap((t) => [t.enviado_por, t.recibido_por]).filter(Boolean))] as string[];
  const profileMap: Record<string, string> = {};
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

  const filas: TransferenciaFila[] = transferencias.map((t) => ({
    id: t.id,
    fecha: t.fecha,
    estado: t.estado,
    origenNombre: t.sucursal_origen?.nombre ?? "—",
    destinoNombre: t.sucursal_destino?.nombre ?? "—",
    enviadoPor: t.enviado_por ? (profileMap[t.enviado_por] ?? "—") : "—",
    recibidoPor: t.recibido_por ? (profileMap[t.recibido_por] ?? "—") : null,
    notasEnvio: t.notas_envio,
    notasRecepcion: t.notas_recepcion,
    anuladaEn: t.anulada_en,
    motivoAnulacion: t.motivo_anulacion,
    items: t.transferencia_items.map((i) => ({
      id: i.id,
      productoNombre: i.product?.name ?? "Producto eliminado",
      unitLabel: i.product?.unit_label ?? null,
      cantidadEnviada: i.cantidad_enviada,
      cantidadRecibida: i.cantidad_recibida,
    })),
  }));

  const pendientes = filas.filter((f) => f.estado === "enviada" && !f.anuladaEn).length;

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Transferencias</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          {miSucursalId ? "Transferencias enviadas o recibidas por tu sucursal" : "Movimiento de stock entre sucursales, enviado y confirmado"}
        </p>
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
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Estado</label>
          <select name="estado" defaultValue={estadoFilter}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="all">Todos</option>
            <option value="enviada">Pendientes</option>
            <option value="recibida">Recibidas</option>
          </select>
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.estado) && (
          <Link href="/admin/transferencias" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjeta resumen */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-6 max-w-xs">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Pendientes de confirmar</p>
        <p className={`text-xl font-bold font-display tabular-nums ${pendientes > 0 ? "text-amber-600" : "text-selva-700"}`}>
          {pendientes}
        </p>
      </div>

      <TransferenciasTable transferencias={filas} isAdmin={role === "admin"} />
    </div>
  );
}
