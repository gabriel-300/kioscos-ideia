import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PagoProveedorBtn } from "./_components/pago-proveedor-form";
import { fechaHoyAR } from "@/lib/fecha";

export const revalidate = 0;

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("sucursales").select("nombre").eq("id", id).single();
  return { title: data ? `Pagos a proveedores — ${data.nombre}` : "Pagos a proveedores" };
}

export default async function PagosProveedoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string }>;
}) {
  const { id } = await params;
  const { mes: mesParam } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;

  const mesActual = fechaHoyAR().slice(0, 7);
  const mes = mesParam ?? mesActual;
  const [year, month] = mes.split("-").map(Number);
  const mesInicio = `${mes}-01`;
  const mesFin = new Date(year, month, 0).toISOString().slice(0, 10);

  const prevDate = new Date(year, month - 2, 1);
  const nextDate = new Date(year, month, 1);
  const prevMes = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const nextMes = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
  const mesLabel = new Date(year, month - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });

  const { data: sucursal } = await supabase.from("sucursales").select("id, nombre, encargado_user_id").eq("id", id).single();
  if (!sucursal) notFound();

  if (role === "vendedor") redirect("/admin/dashboard");
  if (role === "encargado" && sucursal.encargado_user_id !== user.id) redirect("/admin/dashboard");

  const [entregasRes, proveedoresRes, totalHistRes, pagosRes] = await Promise.all([
    (supabase as any)
      .from("movimientos")
      .select(`
        id, fecha, created_at, notas, proveedor_id,
        movimiento_items(subtotal, cantidad, product:products(name))
      `)
      .eq("sucursal_id", id)
      .eq("tipo", "entrega")
      .not("proveedor_id", "is", null)
      .gte("fecha", mesInicio)
      .lte("fecha", mesFin)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }) as unknown as Promise<{ data: any[] | null }>,
    supabase.from("proveedores").select("id, nombre").eq("is_active", true).order("nombre") as unknown as Promise<{
      data: { id: string; nombre: string }[] | null;
    }>,
    // Deuda histórica acumulada por proveedor (sin filtro de mes)
    (supabase as any)
      .from("movimientos")
      .select("proveedor_id, movimiento_items(subtotal)")
      .eq("sucursal_id", id)
      .eq("tipo", "entrega")
      .not("proveedor_id", "is", null) as unknown as Promise<{
        data: { proveedor_id: string; movimiento_items: { subtotal: number | null }[] }[] | null;
      }>,
    (supabase as any)
      .from("pagos_proveedor")
      .select("id, proveedor_id, monto_efectivo, monto_billetera, fecha_pago, nota")
      .eq("sucursal_id", id)
      .order("fecha_pago", { ascending: false }) as unknown as Promise<{
        data: { id: string; proveedor_id: string; monto_efectivo: number; monto_billetera: number; fecha_pago: string; nota: string | null }[] | null;
      }>,
  ]);

  const entregas    = entregasRes.data    ?? [];
  const proveedores = proveedoresRes.data ?? [];

  const proveedorMap: Record<string, string> = Object.fromEntries(proveedores.map((p) => [p.id, p.nombre]));

  // Deuda histórica total por proveedor
  const deudaHistorica: Record<string, number> = {};
  for (const m of totalHistRes.data ?? []) {
    const sub = m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    deudaHistorica[m.proveedor_id] = (deudaHistorica[m.proveedor_id] ?? 0) + sub;
  }
  const deudaHistoricaTotal = Object.values(deudaHistorica).reduce((s, v) => s + v, 0);

  // Pagos acumulados por proveedor
  const pagadosMap: Record<string, { total: number; items: { id: string; monto: number; fecha_pago: string; nota: string | null }[] }> = {};
  for (const p of pagosRes.data ?? []) {
    const monto = p.monto_efectivo + p.monto_billetera;
    if (!pagadosMap[p.proveedor_id]) pagadosMap[p.proveedor_id] = { total: 0, items: [] };
    pagadosMap[p.proveedor_id].total += monto;
    pagadosMap[p.proveedor_id].items.push({ id: p.id, monto, fecha_pago: p.fecha_pago, nota: p.nota });
  }
  const totalPagado = Object.values(pagadosMap).reduce((s, v) => s + v.total, 0);
  const saldoPendienteGlobal = deudaHistoricaTotal - totalPagado;

  type EntregaItem  = { name: string; cantidad: number; subtotal: number };
  type EntregaEntry = { id: string; fecha: string; notas: string | null; total: number; items: EntregaItem[] };
  type ProveedorEntry = { nombre: string; total: number; entregas: EntregaEntry[] };

  const byProveedor: Record<string, ProveedorEntry> = {};
  for (const m of entregas) {
    const pid   = m.proveedor_id as string;
    const total = (m.movimiento_items as any[]).reduce((s: number, i: any) => s + (i.subtotal ?? 0), 0);
    if (!byProveedor[pid]) {
      byProveedor[pid] = { nombre: proveedorMap[pid] ?? "Proveedor eliminado", total: 0, entregas: [] };
    }
    byProveedor[pid].total += total;
    byProveedor[pid].entregas.push({
      id:    m.id,
      fecha: m.fecha,
      notas: m.notas,
      total,
      items: (m.movimiento_items as any[]).map((i: any) => ({
        name:     i.product?.name ?? "—",
        cantidad: i.cantidad,
        subtotal: i.subtotal ?? 0,
      })),
    });
  }

  const proveedoresConMov = Object.entries(byProveedor).sort((a, b) => b[1].total - a[1].total);
  const totalMes  = proveedoresConMov.reduce((s, [, p]) => s + p.total, 0);
  const canGoNext = mes < mesActual;

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <Link
        href={`/admin/sucursales/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-700 mb-4 transition-colors"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        {sucursal.nombre}
      </Link>

      <h1 className="text-xl font-semibold font-display text-neutral-900 mb-0.5">Pagos a proveedores</h1>
      <p className="text-sm text-neutral-400 mb-6">{sucursal.nombre}</p>

      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/admin/sucursales/${id}/pagos-proveedores?mes=${prevMes}`}
          className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors"
        >
          <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <span className="flex-1 text-center font-semibold text-neutral-900 capitalize">{mesLabel}</span>
        {canGoNext ? (
          <Link
            href={`/admin/sucursales/${id}/pagos-proveedores?mes=${nextMes}`}
            className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors"
          >
            <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        ) : (
          <div className="size-10" />
        )}
      </div>

      {(entregas.length > 0 || deudaHistoricaTotal > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl border border-tierra-200 bg-tierra-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-tierra-600 mb-1">Recibido este mes</p>
            <p className="text-2xl font-bold font-display tabular-nums text-tierra-700">{AR.format(totalMes)}</p>
          </div>
          <div className={`rounded-xl border p-4 ${saldoPendienteGlobal > 0 ? "border-red-200 bg-red-50" : "border-selva-200 bg-selva-50"}`}>
            <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${saldoPendienteGlobal > 0 ? "text-red-500" : "text-selva-600"}`}>Saldo pendiente</p>
            <p className={`text-2xl font-bold font-display tabular-nums ${saldoPendienteGlobal > 0 ? "text-red-700" : "text-selva-700"}`}>
              {AR.format(Math.max(0, saldoPendienteGlobal))}
            </p>
            <p className="text-xs text-neutral-400 mt-0.5">
              {totalPagado > 0 ? `${AR.format(totalPagado)} pagado` : "sin pagos registrados"}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Proveedores</p>
            <p className="text-2xl font-bold font-display text-neutral-900">{proveedoresConMov.length}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Entregas este mes</p>
            <p className="text-2xl font-bold font-display text-neutral-900">{entregas.length}</p>
          </div>
        </div>
      )}

      {proveedoresConMov.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-10 text-center">
          <p className="text-sm text-neutral-400">Sin entregas con proveedor asignado en <span className="capitalize">{mesLabel}</span>.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {proveedoresConMov.map(([pid, data]) => {
            const saldo = (deudaHistorica[pid] ?? 0) - (pagadosMap[pid]?.total ?? 0);
            return (
              <div key={pid} className="rounded-xl overflow-hidden border border-neutral-200">
                <div className="flex items-center justify-between px-4 py-3.5 bg-neutral-50 border-b border-neutral-200">
                  <span className="font-semibold text-neutral-900">{data.nombre}</span>
                  <div className="text-right">
                    <p className="font-bold tabular-nums text-tierra-700">{AR.format(data.total)}</p>
                    {saldo > 0 && <p className="text-xs text-red-500 tabular-nums font-semibold">Saldo: {AR.format(saldo)}</p>}
                    {saldo <= 0 && (deudaHistorica[pid] ?? 0) > 0 && <p className="text-xs text-selva-600 tabular-nums">Al día ✓</p>}
                    <p className="text-xs text-neutral-400">{data.entregas.length} {data.entregas.length === 1 ? "entrega" : "entregas"} este mes</p>
                  </div>
                </div>

                <div className="divide-y divide-neutral-100">
                  {data.entregas.map((e) => {
                    const fechaStr = new Date(e.fecha + "T00:00:00").toLocaleDateString("es-AR", {
                      weekday: "short", day: "numeric", month: "short",
                    });
                    return (
                      <div key={e.id} className="px-4 py-3">
                        <div className="flex items-start justify-between mb-1.5">
                          <span className="text-xs text-neutral-400 capitalize">{fechaStr}</span>
                          <span className="font-semibold tabular-nums text-neutral-900">{AR.format(e.total)}</span>
                        </div>
                        <div className="space-y-0.5">
                          {e.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-xs text-neutral-500">
                              <span>{item.name} × {item.cantidad}</span>
                              <span className="tabular-nums">{AR.format(item.subtotal)}</span>
                            </div>
                          ))}
                        </div>
                        {e.notas && <p className="text-xs text-neutral-400 mt-1.5 italic">{e.notas}</p>}
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-between items-center px-4 py-2.5 bg-tierra-50 border-t border-tierra-100">
                  <span className="text-xs font-semibold text-tierra-600 uppercase tracking-wider">Total {mesLabel}</span>
                  <span className="font-bold tabular-nums text-tierra-700">{AR.format(data.total)}</span>
                </div>

                <PagoProveedorBtn
                  sucursalId={id}
                  proveedorId={pid}
                  nombre={data.nombre}
                  pagos={pagadosMap[pid]?.items.map((p) => ({ id: p.id, monto: p.monto, fecha: p.fecha_pago, notas: p.nota })) ?? []}
                  entregas={data.entregas.map((e) => ({ id: e.id, fecha: e.fecha, total: e.total }))}
                />
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-neutral-400 mt-4">
        Solo se muestran entregas con proveedor asignado desde el catálogo (no texto libre). Si falta alguno, asignalo en Movimientos → Entrega.
      </p>
    </div>
  );
}
