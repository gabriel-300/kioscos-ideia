import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";
import { AlertaRow } from "./_components/alerta-row";

export const revalidate = 0;
export const metadata: Metadata = { title: "Alertas de precio — Kioscos IDEIA" };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type AlertaRowData = {
  id:                string;
  proveedor:          string | null;
  costo_anterior:     number;
  costo_nuevo:        number;
  revisado_por:       string | null;
  costo_actualizado:  boolean;
  nota_admin:         string | null;
  product:            { name: string; sku: string } | null;
  movimiento:         { fecha: string; sucursal: { nombre: string } | null } | null;
};

export default async function AlertasPrecioPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; proveedor?: string }>;
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

  const { data: alertasRaw, error } = await (admin as any)
    .from("alertas_precio")
    .select(`
      id, proveedor, costo_anterior, costo_nuevo, revisado_por, costo_actualizado, nota_admin,
      product:products(name, sku),
      movimiento:movimientos(fecha, sucursal:sucursales(nombre))
    `)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  let alertas = (alertasRaw ?? []) as AlertaRowData[];
  alertas = alertas.filter((a) => {
    const fecha = a.movimiento?.fecha;
    if (!fecha) return true;
    return fecha >= desde && fecha <= hasta;
  });
  if (sp.proveedor) {
    const q = sp.proveedor.toLowerCase();
    alertas = alertas.filter((a) => a.proveedor?.toLowerCase().includes(q));
  }

  const sinRevisar = alertas.filter((a) => !a.revisado_por);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Alertas de precio</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Diferencias entre el costo cargado en las entregas y el costo del catálogo</p>
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
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Proveedor</label>
          <input type="text" name="proveedor" defaultValue={sp.proveedor ?? ""} placeholder="Buscar…"
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700" />
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.proveedor) && (
          <Link href="/admin/alertas-precio" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjeta resumen */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-6 max-w-xs">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Sin revisar</p>
        <p className={`text-xl font-bold font-display tabular-nums ${sinRevisar.length > 0 ? "text-amber-600" : "text-selva-700"}`}>
          {sinRevisar.length}
        </p>
      </div>

      {/* Lista */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        {alertas.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-400">Sin alertas de precio en el período seleccionado.</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {alertas.map((a) => {
              const variacion = a.costo_anterior > 0 ? ((a.costo_nuevo - a.costo_anterior) / a.costo_anterior) * 100 : 0;
              return (
                <AlertaRow
                  key={a.id}
                  alertaId={a.id}
                  fecha={a.movimiento?.fecha ?? hoy}
                  sucursalNombre={a.movimiento?.sucursal?.nombre ?? "—"}
                  proveedor={a.proveedor}
                  productoNombre={a.product?.name ?? "Producto eliminado"}
                  sku={a.product?.sku ?? ""}
                  costoAnteriorTexto={AR.format(a.costo_anterior)}
                  costoNuevoTexto={AR.format(a.costo_nuevo)}
                  variacionTexto={`${variacion > 0 ? "+" : ""}${variacion.toFixed(0)}%`}
                  variacionPositiva={variacion > 0}
                  revisado={a.revisado_por != null}
                  costoActualizado={a.costo_actualizado}
                  notaAdmin={a.nota_admin}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
