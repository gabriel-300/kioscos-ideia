import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { fechaHoyAR } from "@/lib/fecha";
import { formatKg } from "@/lib/utils";

export const revalidate = 0;
export const metadata: Metadata = { title: "Pronóstico — Kioscos IDEIA" };

const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

function fmtCantidad(cantidad: number, unitLabel: string | null) {
  return unitLabel === "kg" ? `${formatKg(cantidad)} kg` : `${NUM.format(cantidad)} u.`;
}

// Cuántas ocurrencias pasadas del mismo día de la semana se promedian (~3 meses).
// Con pocas semanas de historial esto simplemente va a encontrar menos puntos --
// no hace falta ajustarlo, mejora solo a medida que se acumulan datos.
const OCURRENCIAS_ATRAS = 12;

export default async function PronosticoPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin" && role !== "encargado") redirect("/admin/dashboard");

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("is_active", true)
    .order("nombre");

  const sp = await searchParams;

  let sucursalId: string | null;
  if (role === "encargado") {
    const { data } = await supabase.from("sucursales").select("id").eq("encargado_user_id", user.id).single();
    sucursalId = data?.id ?? null;
    if (!sucursalId) redirect("/admin/dashboard");
  } else {
    sucursalId = sp.sucursal ?? sucursales?.[0]?.id ?? null;
  }

  const sucursalActual = (sucursales ?? []).find((s) => s.id === sucursalId) ?? null;

  // "Mañana" en hora Argentina, y las fechas de las últimas OCURRENCIAS_ATRAS
  // veces que cayó ese mismo día de la semana (siempre restando múltiplos
  // exactos de 7 días, así que no hay que calcular el día de la semana a mano).
  const manana       = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const mananaFecha  = fechaHoyAR(manana);
  const mananaLabel  = new Date(mananaFecha + "T12:00:00").toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long",
  });

  const fechasComparables = Array.from({ length: OCURRENCIAS_ATRAS }, (_, i) =>
    fechaHoyAR(new Date(manana.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000))
  );

  const [{ data: products }, ventasRes] = await Promise.all([
    supabase.from("products").select("id, name, sku, unit_label").eq("is_active", true).order("name"),
    sucursalId
      ? (admin as any)
          .from("movimientos")
          .select("fecha, movimiento_items(product_id, cantidad)")
          .eq("sucursal_id", sucursalId)
          .eq("tipo", "venta")
          .in("fecha", fechasComparables)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  type VentaRow = { fecha: string; movimiento_items: { product_id: string; cantidad: number }[] };
  const ventas = (ventasRes.data ?? []) as VentaRow[];

  // Total vendido por producto, por fecha (puede haber más de una venta el mismo día)
  const porProductoFecha = new Map<string, Map<string, number>>();
  for (const v of ventas) {
    for (const item of v.movimiento_items) {
      if (!porProductoFecha.has(item.product_id)) porProductoFecha.set(item.product_id, new Map());
      const m = porProductoFecha.get(item.product_id)!;
      m.set(v.fecha, (m.get(v.fecha) ?? 0) + Number(item.cantidad));
    }
  }

  type Fila = {
    id: string; nombre: string; unitLabel: string | null;
    puntos: { fecha: string; cantidad: number }[];
    promedio: number;
  };

  const filas: Fila[] = (products ?? [])
    .map((p) => {
      const historial = porProductoFecha.get(p.id);
      const puntos = fechasComparables
        .filter((f) => historial?.has(f))
        .map((f) => ({ fecha: f, cantidad: historial!.get(f)! }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha));
      const promedio = puntos.reduce((s, x) => s + x.cantidad, 0) / (puntos.length || 1);
      return { id: p.id, nombre: p.name, unitLabel: p.unit_label, puntos, promedio };
    })
    .filter((f) => f.puntos.length > 0)
    .sort((a, b) => b.promedio - a.promedio);

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Pronóstico</h1>
        <p className="text-sm text-neutral-400 mt-0.5 capitalize">
          Sugerencia para mañana, {mananaLabel}{sucursalActual ? ` · ${sucursalActual.nombre}` : ""}
        </p>
      </div>

      {role === "admin" && (
        <form method="GET" className="flex flex-wrap gap-3 items-end mb-6">
          <div>
            <label className="block text-xs font-semibold text-neutral-500 mb-1">Sucursal</label>
            <select
              name="sucursal" defaultValue={sucursalId ?? ""}
              className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
            >
              {(sucursales ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors"
          >
            Ver
          </button>
        </form>
      )}

      <div className="rounded-xl border border-tierra-200 bg-tierra-50 p-4 mb-6">
        <p className="text-sm text-tierra-800">
          Para cada producto, se promedia lo vendido los mismos días de la semana en semanas anteriores
          (hasta {OCURRENCIAS_ATRAS} atrás). Todavía no ajusta por clima ni eventos especiales — si mañana
          hay algo fuera de lo común, usá esto como piso y ajustá a criterio.
        </p>
      </div>

      {/* Mobile: tarjetas apiladas */}
      <div className="md:hidden rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {filas.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-400">
            Todavía no hay suficiente historial de ventas para {mananaLabel} en esta sucursal.
            A medida que se registren más semanas, acá van a aparecer sugerencias.
          </p>
        ) : (
          filas.map((f) => (
            <div key={f.id} className="px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-neutral-800">{f.nombre}</span>
                <span className="tabular-nums font-semibold text-neutral-800 shrink-0">{fmtCantidad(f.promedio, f.unitLabel)}</span>
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {f.puntos.map((p) => {
                  const d = new Date(p.fecha + "T12:00:00");
                  return `${d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric" })}: ${fmtCantidad(p.cantidad, f.unitLabel)}`;
                }).join(" · ")}
                {f.puntos.length < 3 && (
                  <span className="text-amber-500 font-medium"> (pocos datos)</span>
                )}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "640px" }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Basado en</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Sugerido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center text-sm text-neutral-400">
                    Todavía no hay suficiente historial de ventas para {mananaLabel} en esta sucursal.
                    A medida que se registren más semanas, acá van a aparecer sugerencias.
                  </td>
                </tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.id} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-neutral-800">{f.nombre}</td>
                    <td className="px-3 py-2.5 text-xs text-neutral-400">
                      {f.puntos.map((p) => {
                        const d = new Date(p.fecha + "T12:00:00");
                        return `${d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric" })}: ${fmtCantidad(p.cantidad, f.unitLabel)}`;
                      }).join(" · ")}
                      {f.puntos.length < 3 && (
                        <span className="text-amber-500 font-medium"> (pocos datos)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800">
                      {fmtCantidad(f.promedio, f.unitLabel)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
