import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { RetiroSocioBtn, DeleteMovSocioBtn, DeletePagoSocioBtn } from "./_components/retiro-socio-form";
import { fechaHoyAR } from "@/lib/fecha";

export const revalidate = 0;

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("sucursales").select("nombre").eq("id", id).single();
  return { title: data ? `Socios — ${data.nombre}` : "Socios" };
}

export default async function SociosPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string }>;
}) {
  const { id } = await params;
  const { mes: mesParam } = await searchParams;

  const supabase = await createClient();
  const admin    = createAdminClient();
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

  // Socios son del negocio entero, no de esta sucursal (decisión del
  // usuario) -- se listan por es_socio=true, sin filtrar por sucursal_id,
  // a diferencia del selector de empleados de Cta. Corriente. Requiere
  // admin client: RLS de profiles no deja a un encargado leer perfiles de
  // otras sucursales por su cuenta.
  const [sociosRes, retirosRes, pagosRes] = await Promise.all([
    (admin as any).from("profiles").select("id, full_name").eq("es_socio", true) as unknown as Promise<{
      data: { id: string; full_name: string | null }[] | null;
    }>,
    (admin as any)
      .from("movimientos_socio")
      .select("id, socio_id, tipo, monto, fecha, notas")
      .eq("sucursal_id", id)
      .order("fecha", { ascending: false }) as unknown as Promise<{
        data: { id: string; socio_id: string; tipo: string; monto: number; fecha: string; notas: string | null }[] | null;
      }>,
    (admin as any)
      .from("pagos_socio")
      .select("id, socio_id, monto_efectivo, monto_billetera, fecha, notas")
      .eq("sucursal_id", id)
      .order("fecha", { ascending: false }) as unknown as Promise<{
        data: { id: string; socio_id: string; monto_efectivo: number; monto_billetera: number; fecha: string; notas: string | null }[] | null;
      }>,
  ]);

  const socios  = sociosRes.data  ?? [];
  const retiros = retirosRes.data ?? [];
  const pagos   = pagosRes.data   ?? [];

  const socioMap: Record<string, string> = Object.fromEntries(socios.map((s) => [s.id, s.full_name ?? "Sin nombre"]));

  // Solo retiro_temporal cuenta como deuda (decisión del usuario) --
  // retiro_ganancias es reparto real de utilidades, se muestra aparte.
  const deudaMap: Record<string, number>      = {};
  const gananciasMap: Record<string, number>  = {};
  for (const r of retiros) {
    if (r.tipo === "retiro_temporal") deudaMap[r.socio_id] = (deudaMap[r.socio_id] ?? 0) + r.monto;
    else gananciasMap[r.socio_id] = (gananciasMap[r.socio_id] ?? 0) + r.monto;
  }
  const pagadoMap: Record<string, number> = {};
  for (const p of pagos) {
    pagadoMap[p.socio_id] = (pagadoMap[p.socio_id] ?? 0) + p.monto_efectivo + p.monto_billetera;
  }

  const saldoPendienteGlobal = Object.entries(deudaMap).reduce(
    (s, [sid, deuda]) => s + Math.max(0, deuda - (pagadoMap[sid] ?? 0)), 0
  );

  const retirosMes = retiros.filter((r) => r.fecha >= mesInicio && r.fecha <= mesFin);
  const totalRetiradoMes = retirosMes.reduce((s, r) => s + r.monto, 0);
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

      <h1 className="text-xl font-semibold font-display text-neutral-900 mb-0.5">Socios</h1>
      <p className="text-sm text-neutral-400 mb-6">Retiros y devoluciones — {sucursal.nombre}</p>

      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/admin/sucursales/${id}/socios?mes=${prevMes}`}
          className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors"
        >
          <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <span className="flex-1 text-center font-semibold text-neutral-900 capitalize">{mesLabel}</span>
        {canGoNext ? (
          <Link
            href={`/admin/sucursales/${id}/socios?mes=${nextMes}`}
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

      {socios.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-10 text-center">
          <p className="text-sm text-neutral-400">Todavía no hay ningún usuario marcado como socio. Marcalo desde Staff → Editar.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="rounded-xl border border-tierra-200 bg-tierra-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-tierra-600 mb-1">Retirado este mes</p>
              <p className="text-2xl font-bold font-display tabular-nums text-tierra-700">{AR.format(totalRetiradoMes)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${saldoPendienteGlobal > 0 ? "border-red-200 bg-red-50" : "border-selva-200 bg-selva-50"}`}>
              <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${saldoPendienteGlobal > 0 ? "text-red-500" : "text-selva-600"}`}>Saldo pendiente total</p>
              <p className={`text-2xl font-bold font-display tabular-nums ${saldoPendienteGlobal > 0 ? "text-red-700" : "text-selva-700"}`}>
                {AR.format(saldoPendienteGlobal)}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {socios.map((s) => {
              const deuda      = deudaMap[s.id] ?? 0;
              const pagado     = pagadoMap[s.id] ?? 0;
              const saldo      = deuda - pagado;
              const ganancias  = gananciasMap[s.id] ?? 0;
              const nombre     = socioMap[s.id];
              const retirosSocio = retiros.filter((r) => r.socio_id === s.id);
              const pagosSocio   = pagos.filter((p) => p.socio_id === s.id);

              return (
                <div key={s.id} className="rounded-xl overflow-hidden border border-neutral-200">
                  <div className="flex items-center justify-between px-4 py-3.5 bg-neutral-50 border-b border-neutral-200">
                    <span className="font-semibold text-neutral-900">{nombre}</span>
                    <div className="text-right">
                      {saldo > 0 && <p className="text-sm font-bold tabular-nums text-red-500">Saldo: {AR.format(saldo)}</p>}
                      {saldo <= 0 && deuda > 0 && <p className="text-xs text-selva-600 tabular-nums">Al día ✓</p>}
                      {ganancias > 0 && <p className="text-xs text-neutral-400 tabular-nums">Ganancias retiradas: {AR.format(ganancias)}</p>}
                    </div>
                  </div>

                  {(retirosSocio.length > 0 || pagosSocio.length > 0) && (
                    <div className="divide-y divide-neutral-100">
                      {retirosSocio.map((r) => (
                        <div key={r.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                          <span className="text-neutral-500">
                            {new Date(r.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                            {" · "}
                            {r.tipo === "retiro_temporal" ? "Retiro temporal" : "Reparto de ganancias"}
                            {r.notas && <span className="ml-1.5 italic text-neutral-400">{r.notas}</span>}
                          </span>
                          <span className="flex items-center">
                            <span className={`font-semibold tabular-nums ${r.tipo === "retiro_temporal" ? "text-red-500" : "text-neutral-500"}`}>
                              −{AR.format(r.monto)}
                            </span>
                            <DeleteMovSocioBtn id={r.id} sucursalId={id} />
                          </span>
                        </div>
                      ))}
                      {pagosSocio.map((p) => (
                        <div key={p.id} className="px-4 py-2.5 flex items-center justify-between text-xs bg-selva-50/50">
                          <span className="text-neutral-500">
                            {new Date(p.fecha + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                            {" · Devolución"}
                            {p.notas && <span className="ml-1.5 italic text-neutral-400">{p.notas}</span>}
                          </span>
                          <span className="flex items-center">
                            <span className="font-semibold tabular-nums text-selva-700">+{AR.format(p.monto_efectivo + p.monto_billetera)}</span>
                            <DeletePagoSocioBtn id={p.id} sucursalId={id} />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <RetiroSocioBtn sucursalId={id} socioId={s.id} nombre={nombre} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
