import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { GastosFijosView, type GastoFijoRow } from "./_components/gastos-fijos-view";
import { fechaHoyAR } from "@/lib/fecha";
import { rangoDelMes } from "@/lib/tesoreria/calculos";

export const revalidate = 0;
export const metadata: Metadata = { title: "Gastos fijos — Kioscos IDEIA" };

// Desde la unificación de Tesorería (migración 101) los egresos se cargan en /admin/tesoreria. Esta pantalla quedó
// solo para mantener la LISTA de gastos fijos (qué se paga todos los meses y cuánto): alta, edición y baja. El pago
// de cada mes se registra en Tesorería → Gastos fijos; acá se muestra si ya se registró.
export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const admin = createAdminClient();

  const user = await getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin") redirect("/admin/dashboard");

  const sp  = await searchParams;
  const mes = sp.mes && rangoDelMes(sp.mes) ? sp.mes : fechaHoyAR().slice(0, 7);
  const { desde, hasta } = rangoDelMes(mes)!;

  const [{ data: sucursales }, { data: gastosFijosRaw }, { data: pagosRaw }] = await Promise.all([
    admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    (admin as any)
      .from("gastos_fijos")
      .select("id, categoria, descripcion, monto_estimado, dia_vencimiento, sucursal_id, sucursal:sucursales(id, nombre)")
      .eq("is_active", true)
      .order("dia_vencimiento") as unknown as Promise<{ data: Omit<GastoFijoRow, "pago">[] | null }>,
    // Si el gasto fijo ya se registró este mes en Tesorería (egreso vivo vinculado).
    (admin as any)
      .from("egresos")
      .select("id, gasto_fijo_id, monto, fecha")
      .not("gasto_fijo_id", "is", null).is("anulado_en", null)
      .gte("fecha", desde).lte("fecha", hasta) as unknown as Promise<{ data: { id: string; gasto_fijo_id: string; monto: number; fecha: string }[] | null }>,
  ]);

  const pagoPorFijo = new Map<string, { id: string; monto: number; fecha: string }>();
  for (const p of pagosRaw ?? []) pagoPorFijo.set(p.gasto_fijo_id, { id: p.id, monto: Number(p.monto), fecha: p.fecha });

  const gastosFijos: GastoFijoRow[] = (gastosFijosRaw ?? []).map((gf) => ({ ...gf, pago: pagoPorFijo.get(gf.id) ?? null }));

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Gastos fijos</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          La lista de lo que se paga todos los meses. Los pagos se registran en{" "}
          <Link href="/admin/tesoreria?vista=fijos" className="text-tierra-700 hover:underline font-medium">Tesorería</Link>.
        </p>
      </div>

      <GastosFijosView mes={mes} items={gastosFijos} sucursales={sucursales ?? []} />
    </div>
  );
}
