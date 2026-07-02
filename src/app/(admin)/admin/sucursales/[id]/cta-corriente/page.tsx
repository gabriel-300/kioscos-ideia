import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

export const revalidate = 0;

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("sucursales").select("nombre").eq("id", id).single();
  return { title: data ? `Cta. Corriente — ${data.nombre}` : "Cuenta corriente" };
}

export default async function CtaCorrientePage({
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

  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
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

  if (role === "encargado" && sucursal.encargado_user_id !== user.id) redirect("/admin/dashboard");
  if (role === "vendedor") {
    const profileRes = await (supabase as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== id) redirect("/admin/dashboard");
  }

  const [ventasRes, personalRes] = await Promise.all([
    (supabase as any)
      .from("movimientos")
      .select(`
        id, fecha, created_at, notas, personal_id,
        movimiento_items(subtotal, cantidad, product:products(name))
      `)
      .eq("sucursal_id", id)
      .eq("canal", "cuenta_corriente")
      .eq("tipo", "venta")
      .gte("fecha", mesInicio)
      .lte("fecha", mesFin)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }) as unknown as Promise<{ data: any[] | null }>,
    (supabase as any)
      .from("profiles")
      .select("id, full_name")
      .eq("sucursal_id", id) as unknown as Promise<{ data: { id: string; full_name: string | null }[] | null }>,
  ]);

  const ventas   = ventasRes.data   ?? [];
  const personal = personalRes.data ?? [];
  const personalMap: Record<string, string> = Object.fromEntries(
    personal.map((p) => [p.id, p.full_name ?? "Sin nombre"])
  );

  type VentaItem  = { name: string; cantidad: number; subtotal: number };
  type VentaEntry = { id: string; fecha: string; notas: string | null; total: number; items: VentaItem[] };
  type PersonaEntry = { nombre: string; total: number; ventas: VentaEntry[] };

  const byPersonal: Record<string, PersonaEntry> = {};
  for (const v of ventas) {
    const pid   = v.personal_id ?? "sin_asignar";
    const total = (v.movimiento_items as any[]).reduce((s: number, i: any) => s + (i.subtotal ?? 0), 0);
    if (!byPersonal[pid]) {
      byPersonal[pid] = { nombre: personalMap[pid] ?? "Sin asignar", total: 0, ventas: [] };
    }
    byPersonal[pid].total += total;
    byPersonal[pid].ventas.push({
      id:    v.id,
      fecha: v.fecha,
      notas: v.notas,
      total,
      items: (v.movimiento_items as any[]).map((i: any) => ({
        name:     i.product?.name ?? "—",
        cantidad: i.cantidad,
        subtotal: i.subtotal ?? 0,
      })),
    });
  }

  const personas    = Object.entries(byPersonal).sort((a, b) => b[1].total - a[1].total);
  const totalMes    = personas.reduce((s, [, p]) => s + p.total, 0);
  const canGoNext   = mes < mesActual;

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      {/* Back */}
      <Link
        href={`/admin/sucursales/${id}`}
        className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-700 mb-4 transition-colors"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        {sucursal.nombre}
      </Link>

      <h1 className="text-xl font-semibold font-display text-neutral-900 mb-0.5">Cuenta corriente</h1>
      <p className="text-sm text-neutral-400 mb-6">{sucursal.nombre}</p>

      {/* Month nav */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/admin/sucursales/${id}/cta-corriente?mes=${prevMes}`}
          className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors"
        >
          <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <span className="flex-1 text-center font-semibold text-neutral-900 capitalize">{mesLabel}</span>
        {canGoNext ? (
          <Link
            href={`/admin/sucursales/${id}/cta-corriente?mes=${nextMes}`}
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

      {/* Summary cards */}
      {ventas.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl border border-tierra-200 bg-tierra-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-tierra-600 mb-1">Total fiado</p>
            <p className="text-2xl font-bold font-display tabular-nums text-tierra-700">{AR.format(totalMes)}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Empleados</p>
            <p className="text-2xl font-bold font-display text-neutral-900">{personas.length}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Ventas</p>
            <p className="text-2xl font-bold font-display text-neutral-900">{ventas.length}</p>
          </div>
        </div>
      )}

      {/* Per-person cards */}
      {personas.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-10 text-center">
          <p className="text-sm text-neutral-400">Sin ventas en cuenta corriente en <span className="capitalize">{mesLabel}</span>.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {personas.map(([pid, data]) => {
            const initials = data.nombre.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
            return (
              <div key={pid} className="rounded-xl border border-neutral-200 overflow-hidden">
                {/* Employee header */}
                <div className="flex items-center justify-between px-4 py-3.5 bg-neutral-50 border-b border-neutral-200">
                  <div className="flex items-center gap-2.5">
                    <div className="size-8 rounded-full bg-tierra-100 flex items-center justify-center text-xs font-bold text-tierra-700 shrink-0">
                      {initials}
                    </div>
                    <span className="font-semibold text-neutral-900">{data.nombre}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums text-tierra-700">{AR.format(data.total)}</p>
                    <p className="text-xs text-neutral-400">{data.ventas.length} {data.ventas.length === 1 ? "venta" : "ventas"}</p>
                  </div>
                </div>

                {/* Ventas detail */}
                <div className="divide-y divide-neutral-100">
                  {data.ventas.map((v) => {
                    const fechaStr = new Date(v.fecha + "T00:00:00").toLocaleDateString("es-AR", {
                      weekday: "short", day: "numeric", month: "short",
                    });
                    return (
                      <div key={v.id} className="px-4 py-3">
                        <div className="flex items-start justify-between mb-1.5">
                          <span className="text-xs text-neutral-400 capitalize">{fechaStr}</span>
                          <span className="font-semibold tabular-nums text-neutral-900">{AR.format(v.total)}</span>
                        </div>
                        <div className="space-y-0.5">
                          {v.items.map((item, i) => (
                            <div key={i} className="flex justify-between text-xs text-neutral-500">
                              <span>{item.name} × {item.cantidad}</span>
                              <span className="tabular-nums">{AR.format(item.subtotal)}</span>
                            </div>
                          ))}
                        </div>
                        {v.notas && (
                          <p className="text-xs text-neutral-400 mt-1.5 italic">{v.notas}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Employee total footer */}
                <div className="flex justify-between items-center px-4 py-2.5 bg-tierra-50 border-t border-tierra-100">
                  <span className="text-xs font-semibold text-tierra-600 uppercase tracking-wider">Total {mesLabel}</span>
                  <span className="font-bold tabular-nums text-tierra-700">{AR.format(data.total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
