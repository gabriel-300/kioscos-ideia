import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { GastosView, type GastoRow } from "./_components/gastos-view";
import { GastosFijosView, type GastoFijoRow } from "./_components/gastos-fijos-view";
import { fechaHoyAR } from "@/lib/fecha";

export const revalidate = 0;
export const metadata: Metadata = { title: "Finanzas — Kioscos IDEIA" };

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin") redirect("/admin/dashboard");

  const sp  = await searchParams;
  const mes = sp.mes ?? fechaHoyAR().slice(0, 7); // YYYY-MM

  const [anioStr, mesStr] = mes.split("-");
  const anio   = parseInt(anioStr, 10);
  const mesNum = parseInt(mesStr, 10);
  const desde  = `${mes}-01`;
  // Día 0 del mes siguiente = último día de este mes. Calculado en UTC explícito
  // para no depender de la zona horaria del servidor -- es aritmética de
  // calendario pura, no "la fecha de ahora", así que no aplica el problema de
  // huso horario de fechaHoyAR().
  const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
  const hasta = `${mes}-${String(ultimoDia).padStart(2, "0")}`;

  const [{ data: sucursales }, { data: proveedores }, { data: gastosRaw }, { data: gastosFijosRaw }, { data: ventasRaw }] = await Promise.all([
    supabase.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    supabase.from("proveedores").select("id, nombre").eq("is_active", true).order("nombre"),
    (admin as any)
      .from("gastos")
      .select("id, categoria, monto, fecha, proveedor, sucursal_id, notas, gasto_fijo_id, sucursal:sucursales(id, nombre)")
      .gte("fecha", desde).lte("fecha", hasta)
      .order("fecha", { ascending: false }) as unknown as Promise<{ data: (GastoRow & { gasto_fijo_id: string | null })[] | null }>,
    (admin as any)
      .from("gastos_fijos")
      .select("id, categoria, descripcion, monto_estimado, dia_vencimiento, sucursal_id, sucursal:sucursales(id, nombre)")
      .eq("is_active", true)
      .order("dia_vencimiento") as unknown as Promise<{
        data: Omit<GastoFijoRow, "pago">[] | null;
      }>,
    (admin as any)
      .from("movimientos")
      .select("canal, movimiento_items(subtotal)")
      .eq("tipo", "venta")
      .gte("fecha", desde).lte("fecha", hasta) as unknown as Promise<{
        data: { canal: string | null; movimiento_items: { subtotal: number | null }[] }[] | null;
      }>,
  ]);

  const gastos = gastosRaw ?? [];

  const pagosPorFijo = new Map<string, { id: string; monto: number; fecha: string }>();
  for (const g of gastos) {
    if (g.gasto_fijo_id) pagosPorFijo.set(g.gasto_fijo_id, { id: g.id, monto: g.monto, fecha: g.fecha });
  }
  const gastosFijos: GastoFijoRow[] = (gastosFijosRaw ?? []).map((gf) => ({
    ...gf,
    pago: pagosPorFijo.get(gf.id) ?? null,
  }));

  // Mismo criterio que el informe de ventas y el cierre de caja: la Cta.
  // Corriente y Pedido Ya Plataforma no se cobran en el momento, no cuentan
  // como ingreso real todavía.
  const ingresos = (ventasRaw ?? [])
    .filter((m) => m.canal !== "cuenta_corriente" && m.canal !== "pedido_ya_plataforma")
    .reduce((s, m) => s + m.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Finanzas</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Ingresos, gastos y resultado del mes</p>
      </div>

      <div className="space-y-10">
        <GastosFijosView
          mes={mes}
          items={gastosFijos}
          sucursales={sucursales ?? []}
          proveedores={proveedores ?? []}
        />

        <GastosView
          mes={mes}
          ingresos={ingresos}
          gastos={gastos}
          sucursales={sucursales ?? []}
          proveedores={proveedores ?? []}
        />
      </div>
    </div>
  );
}
