import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR } from "@/lib/fecha";

export const revalidate = 0;
export const metadata: Metadata = { title: "Informe mensual — Kioscos IDEIA" };

const AR  = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR");

const CANAL_LABELS: Record<string, string> = {
  consumidor_final:     "Consumidor Final",
  pedido_ya_efectivo:   "Pedido Ya Efectivo",
  pedido_ya_plataforma: "Pedido Ya Plataforma",
  cuenta_corriente:     "Cta. Corriente",
  ambulante:            "Ambulante",
  multa_termo:          "Multa termo",
  pedido_online:        "Pedido Online",
};

export default async function InformeMensualPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; sucursal?: string[] | string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "";
  const { data: perfil } = await (admin as any).from("profiles").select("es_socio").eq("id", user.id).single();
  const esSocio = (perfil as { es_socio: boolean | null } | null)?.es_socio ?? false;

  // Informe consolidado de todo el negocio -- mismo criterio de acceso que
  // /admin/tesoreria (admin o socio), no es para encargado/vendedor/concesionario.
  if (role !== "admin" && !esSocio) redirect("/admin/dashboard");

  const sp  = await searchParams;
  const mes = sp.mes ?? fechaHoyAR().slice(0, 7); // YYYY-MM

  const [anioStr, mesStr] = mes.split("-");
  const anio   = parseInt(anioStr, 10);
  const mesNum = parseInt(mesStr, 10);
  const mesInicio = `${mes}-01`;
  // Día 0 del mes siguiente = último día de este mes, en UTC explícito (es
  // aritmética de calendario pura, no depende de la zona horaria del server).
  const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
  const mesFin = `${mes}-${String(ultimoDia).padStart(2, "0")}`;

  const prevDate = new Date(anio, mesNum - 2, 1);
  const nextDate = new Date(anio, mesNum, 1);
  const prevMes = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const nextMes = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
  const mesLabel = new Date(anio, mesNum - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const mesActual = fechaHoyAR().slice(0, 7);
  const canGoNext = mes < mesActual;

  const { data: todasSucursalesRaw } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");
  const todasSucursales = todasSucursalesRaw ?? [];

  // Default: Parque de las Fiestas + UNAM (los dos kioscos propios -- Villa
  // Sarita queda afuera por defecto por ser una operación a consignación,
  // a pedido explícito de Gabriel). Se puede tildar/destildar desde el filtro.
  const seleccionParam = sp.sucursal;
  const seleccionIds = seleccionParam
    ? (Array.isArray(seleccionParam) ? seleccionParam : [seleccionParam])
    : todasSucursales.filter((s) => s.nombre !== "Villa Sarita").map((s) => s.id);
  const sucursales = todasSucursales.filter((s) => seleccionIds.includes(s.id));
  const sucursalIds = sucursales.map((s) => s.id);

  type Item = { subtotal: number | null };
  type MovRow = {
    sucursal_id: string; canal: string | null;
    pago_efectivo: number | null; pago_billetera: number | null; pago_tarjeta: number | null; pago_transferencia: number | null;
    movimiento_items: Item[];
  };

  // Sin sucursal seleccionada, ni siquiera se consulta -- un .in()/.or() con
  // lista vacía es un filtro mal formado para PostgREST, no "sin resultados".
  const [
    { data: ventasRaw },
    { data: pagosCtcRaw },
    { data: retirosCajaRaw },
    { data: pagosProveedorRaw },
    { data: movSocioRaw },
    { data: pagosSocioRaw },
    { data: gastosRaw },
  ] = sucursalIds.length === 0 ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }] : await Promise.all([
    (admin as any)
      .from("movimientos")
      .select("sucursal_id, canal, pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia, movimiento_items(subtotal)")
      .in("sucursal_id", sucursalIds)
      .eq("tipo", "venta")
      .is("anulado_en", null)
      .gte("fecha", mesInicio).lte("fecha", mesFin) as unknown as Promise<{ data: MovRow[] | null }>,
    (admin as any)
      .from("cta_corriente_pagos")
      .select("sucursal_id, monto_efectivo, monto_billetera")
      .in("sucursal_id", sucursalIds)
      .gte("fecha", mesInicio).lte("fecha", mesFin) as unknown as Promise<{ data: { sucursal_id: string; monto_efectivo: number; monto_billetera: number }[] | null }>,
    (admin as any)
      .from("retiros_caja")
      .select("sucursal_id, monto")
      .in("sucursal_id", sucursalIds)
      .gte("fecha", mesInicio).lte("fecha", mesFin) as unknown as Promise<{ data: { sucursal_id: string; monto: number }[] | null }>,
    (admin as any)
      .from("pagos_proveedor")
      .select("sucursal_id, monto_efectivo, monto_billetera")
      .in("sucursal_id", sucursalIds)
      .gte("fecha_pago", mesInicio).lte("fecha_pago", mesFin) as unknown as Promise<{ data: { sucursal_id: string; monto_efectivo: number; monto_billetera: number }[] | null }>,
    (admin as any)
      .from("movimientos_socio")
      .select("sucursal_id, monto")
      .in("sucursal_id", sucursalIds)
      .gte("fecha", mesInicio).lte("fecha", mesFin) as unknown as Promise<{ data: { sucursal_id: string; monto: number }[] | null }>,
    (admin as any)
      .from("pagos_socio")
      .select("sucursal_id, monto_efectivo, monto_billetera")
      .in("sucursal_id", sucursalIds)
      .gte("fecha", mesInicio).lte("fecha", mesFin) as unknown as Promise<{ data: { sucursal_id: string; monto: number; monto_billetera: number }[] | null }>,
    // gastos: de estas sucursales O generales (sucursal_id null) -- un gasto
    // general (alquiler, sueldo, etc.) es un egreso real igual, no atado a
    // un kiosco puntual. Se muestra en su propia columna "Generales".
    (admin as any)
      .from("gastos")
      .select("sucursal_id, categoria, monto")
      .or(`sucursal_id.in.(${sucursalIds.join(",")}),sucursal_id.is.null`)
      .gte("fecha", mesInicio).lte("fecha", mesFin) as unknown as Promise<{ data: { sucursal_id: string | null; categoria: string; monto: number }[] | null }>,
  ]);

  const ventas          = ventasRaw          ?? [];
  const pagosCtc         = pagosCtcRaw        ?? [];
  const retirosCaja      = retirosCajaRaw     ?? [];
  const pagosProveedor   = pagosProveedorRaw  ?? [];
  const movimientosSocio = movSocioRaw        ?? [];
  const pagosSocio       = pagosSocioRaw      ?? [];
  const gastos           = gastosRaw          ?? [];

  const GENERALES = "generales";
  const columnas = [...sucursales.map((s) => s.id), GENERALES] as string[];
  const nombreCol = (id: string) => id === GENERALES ? "Generales" : (sucursales.find((s) => s.id === id)?.nombre ?? "—");

  function totalesPorSucursal<T>(rows: T[], sucursalOf: (r: T) => string | null, montoOf: (r: T) => number) {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = sucursalOf(r) ?? GENERALES;
      map.set(key, (map.get(key) ?? 0) + montoOf(r));
    }
    return map;
  }

  // ── 1. Ventas por tipo (canal) y por local ─────────────────────────────
  const canalesUsados = [...new Set(ventas.map((v) => v.canal ?? "consumidor_final"))].sort();
  const porCanalYSucursal = new Map<string, Map<string, { facturado: number; cantidad: number }>>();
  for (const v of ventas) {
    const canal = v.canal ?? "consumidor_final";
    const facturado = v.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    if (!porCanalYSucursal.has(canal)) porCanalYSucursal.set(canal, new Map());
    const bySuc = porCanalYSucursal.get(canal)!;
    const prev = bySuc.get(v.sucursal_id) ?? { facturado: 0, cantidad: 0 };
    prev.facturado += facturado; prev.cantidad += 1;
    bySuc.set(v.sucursal_id, prev);
  }
  const totalFacturadoGeneral = ventas.reduce((s, v) => s + v.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0);
  const totalVentasCantidad   = ventas.length;

  // ── 2. Ventas por forma de pago y por local ────────────────────────────
  const MEDIOS: { key: "pago_efectivo" | "pago_billetera" | "pago_tarjeta" | "pago_transferencia"; label: string }[] = [
    { key: "pago_efectivo",      label: "Efectivo" },
    { key: "pago_billetera",     label: "Billetera virtual" },
    { key: "pago_tarjeta",       label: "Tarjeta" },
    { key: "pago_transferencia", label: "Transferencia" },
  ];
  const porMedioYSucursal = new Map<string, Map<string, number>>();
  for (const medio of MEDIOS) {
    porMedioYSucursal.set(medio.key, totalesPorSucursal(ventas, (v) => v.sucursal_id, (v) => v[medio.key] ?? 0));
  }

  // ── 3. Cuenta corriente (vendido a fiado este mes vs. cobrado este mes) ─
  const fiadoVendidoPorSucursal = totalesPorSucursal(
    ventas.filter((v) => v.canal === "cuenta_corriente"),
    (v) => v.sucursal_id,
    (v) => v.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0)
  );
  const fiadoCobradoPorSucursal = totalesPorSucursal(pagosCtc, (p) => p.sucursal_id, (p) => p.monto_efectivo + p.monto_billetera);

  // ── 4. Egresos ──────────────────────────────────────────────────────────
  const retirosCajaPorSucursal    = totalesPorSucursal(retirosCaja, (r) => r.sucursal_id, (r) => r.monto);
  const pagosProveedorPorSucursal = totalesPorSucursal(pagosProveedor, (p) => p.sucursal_id, (p) => p.monto_efectivo + p.monto_billetera);
  const retirosSocioPorSucursal   = totalesPorSucursal(movimientosSocio, (m) => m.sucursal_id, (m) => m.monto);
  const pagosSocioPorSucursal     = totalesPorSucursal(pagosSocio, (p) => p.sucursal_id, (p) => p.monto_efectivo + p.monto_billetera);
  const gastosPorSucursal         = totalesPorSucursal(gastos, (g) => g.sucursal_id, (g) => g.monto);
  const gastosPorCategoria = new Map<string, number>();
  for (const g of gastos) gastosPorCategoria.set(g.categoria, (gastosPorCategoria.get(g.categoria) ?? 0) + g.monto);

  function sumaColumnas(map: Map<string, number>) {
    return columnas.reduce((s, c) => s + (map.get(c) ?? 0), 0);
  }
  const totalRetirosCaja    = sumaColumnas(retirosCajaPorSucursal);
  const totalPagosProveedor = sumaColumnas(pagosProveedorPorSucursal);
  const totalRetirosSocio   = sumaColumnas(retirosSocioPorSucursal);
  const totalPagosSocio     = sumaColumnas(pagosSocioPorSucursal);
  const totalGastos         = sumaColumnas(gastosPorSucursal);
  // Las devoluciones a socios RESTAN -- es efectivo que vuelve a la caja, no
  // que sale (mismo signo que usa la tabla de abajo).
  const totalEgresos = totalRetirosCaja + totalPagosProveedor + totalRetirosSocio - totalPagosSocio + totalGastos;
  const resultadoNeto = totalFacturadoGeneral - totalEgresos;

  function Tabla({ titulo, filas, mostrarTotalGeneral = true }: {
    titulo: string;
    filas: { label: string; porColumna: Map<string, number>; destacado?: boolean }[];
    mostrarTotalGeneral?: boolean;
  }) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 px-4 py-3 border-b border-neutral-100">{titulo}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500"> </th>
                {columnas.map((c) => (
                  <th key={c} className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">{nombreCol(c)}</th>
                ))}
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-tierra-700">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filas.map((f) => {
                const total = columnas.reduce((s, c) => s + (f.porColumna.get(c) ?? 0), 0);
                return (
                  <tr key={f.label} className={f.destacado ? "bg-neutral-50/70" : undefined}>
                    <td className={`px-4 py-2.5 ${f.destacado ? "font-semibold text-neutral-800" : "text-neutral-600"}`}>{f.label}</td>
                    {columnas.map((c) => {
                      const v = f.porColumna.get(c) ?? 0;
                      return (
                        <td key={c} className={`px-4 py-2.5 text-right tabular-nums ${v < 0 ? "text-danger" : "text-neutral-700"}`}>
                          {v !== 0 ? AR.format(v) : <span className="text-neutral-200">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-neutral-900">{AR.format(total)}</td>
                  </tr>
                );
              })}
            </tbody>
            {mostrarTotalGeneral && (
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
                  <td className="px-4 py-2.5 text-xs uppercase tracking-wide text-neutral-500">Total</td>
                  {columnas.map((c) => {
                    const total = filas.reduce((s, f) => s + (f.porColumna.get(c) ?? 0), 0);
                    return <td key={c} className="px-4 py-2.5 text-right tabular-nums text-neutral-800">{AR.format(total)}</td>;
                  })}
                  <td className="px-4 py-2.5 text-right tabular-nums text-tierra-700">
                    {AR.format(filas.reduce((s, f) => s + columnas.reduce((ss, c) => ss + (f.porColumna.get(c) ?? 0), 0), 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1100px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Informe mensual</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Ventas por tipo, local y forma de pago, cuenta corriente y egresos del mes</p>
      </div>

      {/* Filtros */}
      <form method="GET" className="flex flex-wrap gap-4 items-end mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/admin/informe-mensual?${new URLSearchParams([["mes", prevMes], ...sucursalIds.map((id) => ["sucursal", id])]).toString()}`} className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
            <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <span className="font-semibold text-neutral-900 capitalize min-w-32 text-center">{mesLabel}</span>
          {canGoNext ? (
            <Link href={`/admin/informe-mensual?${new URLSearchParams([["mes", nextMes], ...sucursalIds.map((id) => ["sucursal", id])]).toString()}`} className="p-2 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors">
              <svg className="size-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          ) : <div className="size-9" />}
        </div>
        <input type="hidden" name="mes" value={mes} />
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1.5">Sucursales</label>
          <div className="flex flex-wrap gap-3">
            {todasSucursales.map((s) => (
              <label key={s.id} className="inline-flex items-center gap-1.5 text-sm text-neutral-700 cursor-pointer">
                <input type="checkbox" name="sucursal" value={s.id} defaultChecked={sucursalIds.includes(s.id)} className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20" />
                {s.nombre}
              </label>
            ))}
          </div>
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
      </form>

      {sucursales.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-10 text-center text-sm text-neutral-400">
          Elegí al menos una sucursal.
        </div>
      ) : (
        <>
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-xl border border-tierra-200 bg-tierra-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-tierra-600 mb-1">Facturado</p>
              <p className="text-xl font-bold font-display tabular-nums text-tierra-700">{AR.format(totalFacturadoGeneral)}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{NUM.format(totalVentasCantidad)} ventas</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-red-500 mb-1">Egresos</p>
              <p className="text-xl font-bold font-display tabular-nums text-red-700">{AR.format(totalEgresos)}</p>
            </div>
            <div className={`rounded-xl border p-4 ${resultadoNeto >= 0 ? "border-selva-200 bg-selva-50" : "border-danger/20 bg-danger/5"}`}>
              <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${resultadoNeto >= 0 ? "text-selva-600" : "text-danger"}`}>Resultado</p>
              <p className={`text-xl font-bold font-display tabular-nums ${resultadoNeto >= 0 ? "text-selva-700" : "text-danger"}`}>
                {resultadoNeto >= 0 ? "+" : ""}{AR.format(resultadoNeto)}
              </p>
              <p className="text-xs text-neutral-400 mt-0.5">Facturado − egresos</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Sucursales</p>
              <p className="text-xl font-bold font-display text-neutral-900">{sucursales.length}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{sucursales.map((s) => s.nombre).join(", ")}</p>
            </div>
          </div>

          {/* 1. Por tipo (canal) y local */}
          <Tabla
            titulo="Ventas por tipo y local"
            filas={canalesUsados.map((canal) => ({
              label: CANAL_LABELS[canal] ?? canal,
              porColumna: new Map(columnas.map((c) => [c, porCanalYSucursal.get(canal)?.get(c)?.facturado ?? 0])),
            }))}
          />

          {/* 2. Por forma de pago */}
          <Tabla
            titulo="Ventas por forma de pago"
            filas={MEDIOS.map((m) => ({ label: m.label, porColumna: porMedioYSucursal.get(m.key)! }))}
          />

          {/* 3. Cuenta corriente */}
          <Tabla
            titulo="Cuenta corriente (fiado)"
            filas={[
              { label: "Vendido a fiado este mes", porColumna: fiadoVendidoPorSucursal },
              { label: "Cobrado este mes", porColumna: fiadoCobradoPorSucursal },
              {
                label: "Saldo generado este mes", destacado: true,
                porColumna: new Map(columnas.map((c) => [c, (fiadoVendidoPorSucursal.get(c) ?? 0) - (fiadoCobradoPorSucursal.get(c) ?? 0)])),
              },
            ]}
            mostrarTotalGeneral={false}
          />
          <p className="text-xs text-neutral-400 -mt-4 mb-6 px-1">
            "Vendido a fiado" no está incluido en el facturado de la tarjeta de arriba ni en la tabla de forma de pago -- no se cobra en el momento. El saldo total pendiente histórico (no solo el de este mes) se ve en Cta. Corriente.
          </p>

          {/* 4. Egresos */}
          <Tabla
            titulo="Egresos"
            filas={[
              { label: "Retiros de caja", porColumna: retirosCajaPorSucursal },
              { label: "Pagos a proveedores", porColumna: pagosProveedorPorSucursal },
              { label: "Retiros de socios", porColumna: retirosSocioPorSucursal },
              { label: "Devoluciones a socios (resta)", porColumna: new Map(columnas.map((c) => [c, -(pagosSocioPorSucursal.get(c) ?? 0)])) },
              { label: "Gastos", porColumna: gastosPorSucursal },
            ]}
          />

          {gastosPorCategoria.size > 0 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-4 mb-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">Gastos por categoría</p>
              <div className="flex flex-wrap gap-2">
                {[...gastosPorCategoria.entries()].sort((a, b) => b[1] - a[1]).map(([cat, monto]) => (
                  <span key={cat} className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-700 capitalize">
                    {cat}: {AR.format(monto)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-neutral-400 mt-2">
            "Devoluciones a socios" resta del total de egresos porque es efectivo que vuelve a la caja, no que sale. Las devoluciones de Cta. Corriente ya están en la sección de arriba, no se duplican acá.
          </p>
        </>
      )}
    </div>
  );
}
