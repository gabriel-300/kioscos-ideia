import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR, horaNumAR, diaSemanaIdxAR } from "@/lib/fecha";
import { HeatmapHorario, type CeldaHeatmap } from "./_components/heatmap-horario";

export const revalidate = 0;
export const metadata: Metadata = { title: "Ventas por horario — Kioscos IDEIA" };

const AR  = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR");

const DIAS_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default async function VentasPorHorarioPage({
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
  // Default: últimos 30 días -- un solo día no alcanza para ver un patrón por
  // día de semana (necesita varias repeticiones de cada día para promediar bien).
  const desde = sp.desde ?? fechaHoyAR(new Date(Date.now() - 29 * 86400000));
  const hasta = sp.hasta ?? hoy;
  const sucFilter = sp.sucursal ?? "all";

  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("is_active", true)
    .order("nombre");

  type VentaRow = { id: string; sucursal_id: string; created_at: string; movimiento_items: { subtotal: number | null }[] };

  // PostgREST corta en 1000 filas sin paginar (ver mismo fix en /admin/ventas).
  const PAGE_SIZE = 1000;
  const ventas: VentaRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = (admin as any)
      .from("movimientos")
      .select("id, sucursal_id, created_at, movimiento_items(subtotal)")
      .eq("tipo", "venta")
      .is("anulado_en", null)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .range(from, from + PAGE_SIZE - 1);
    if (sucFilter !== "all") query = query.eq("sucursal_id", sucFilter);

    const { data, error } = (await query) as { data: VentaRow[] | null; error: any };
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    ventas.push(...pagina);
    if (pagina.length < PAGE_SIZE) break;
  }

  // Agregación por (día de semana, hora) -- ambos calculados en horario
  // Argentina, no en el UTC del runtime (ver fecha.ts).
  const porCelda = new Map<string, CeldaHeatmap>();
  const porDia   = new Map<number, { facturado: number; cantidadVentas: number }>();
  const porHora  = new Map<number, { facturado: number; cantidadVentas: number }>();

  for (const venta of ventas) {
    const fecha = new Date(venta.created_at);
    const diaIdx = diaSemanaIdxAR(fecha);
    const hora   = horaNumAR(fecha);
    const facturado = venta.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);

    const key = `${diaIdx}-${hora}`;
    const celda = porCelda.get(key) ?? { diaIdx, hora, facturado: 0, cantidadVentas: 0 };
    celda.facturado += facturado;
    celda.cantidadVentas += 1;
    porCelda.set(key, celda);

    const d = porDia.get(diaIdx) ?? { facturado: 0, cantidadVentas: 0 };
    d.facturado += facturado; d.cantidadVentas += 1;
    porDia.set(diaIdx, d);

    const h = porHora.get(hora) ?? { facturado: 0, cantidadVentas: 0 };
    h.facturado += facturado; h.cantidadVentas += 1;
    porHora.set(hora, h);
  }

  const celdas = [...porCelda.values()];
  const horasConVentas = celdas.map((c) => c.hora);
  // Rango de horas a mostrar: el horario real de actividad del kiosco (con un
  // margen de 1hs a cada lado), no las 24hs del día -- de madrugada no se
  // vende nada y solo agrega columnas vacías sin información.
  const horaMin = horasConVentas.length > 0 ? Math.max(0, Math.min(...horasConVentas) - 1) : 8;
  const horaMax = horasConVentas.length > 0 ? Math.min(23, Math.max(...horasConVentas) + 1) : 22;

  const filasDia = [1, 2, 3, 4, 5, 6, 0].map((diaIdx) => ({
    diaIdx, label: DIAS_LABEL[diaIdx],
    facturado: porDia.get(diaIdx)?.facturado ?? 0,
    cantidadVentas: porDia.get(diaIdx)?.cantidadVentas ?? 0,
  }));

  const totalFacturado = celdas.reduce((s, c) => s + c.facturado, 0);
  const totalVentas    = celdas.reduce((s, c) => s + c.cantidadVentas, 0);

  const diaTop  = [...filasDia].sort((a, b) => b.facturado - a.facturado)[0] ?? null;
  const horaTop = [...porHora.entries()].sort((a, b) => b[1].facturado - a[1].facturado)[0] ?? null;

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Ventas por horario</h1>
        <p className="text-sm text-neutral-400 mt-0.5">En qué días y horarios se concentran las ventas del período</p>
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
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="all">Todas</option>
            {(sucursales ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.sucursal) && (
          <Link href="/admin/ventas-por-horario" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {celdas.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-12 text-center text-sm text-neutral-400">
          Sin ventas en el período seleccionado.
        </div>
      ) : (
        <>
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Facturado</p>
              <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalFacturado)}</p>
              <p className="text-xs text-neutral-400 mt-0.5">{NUM.format(totalVentas)} ventas</p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Día más fuerte</p>
              {diaTop && diaTop.facturado > 0 ? (
                <>
                  <p className="text-lg font-bold font-display text-neutral-900">{diaTop.label}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{AR.format(diaTop.facturado)}</p>
                </>
              ) : <p className="text-sm text-neutral-400 mt-1">—</p>}
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Horario más fuerte</p>
              {horaTop ? (
                <>
                  <p className="text-lg font-bold font-display text-neutral-900">{horaTop[0]}–{horaTop[0] + 1}hs</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{AR.format(horaTop[1].facturado)}</p>
                </>
              ) : <p className="text-sm text-neutral-400 mt-1">—</p>}
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Ticket promedio</p>
              <p className="text-xl font-bold font-display tabular-nums text-neutral-900">
                {AR.format(totalVentas > 0 ? totalFacturado / totalVentas : 0)}
              </p>
            </div>
          </div>

          {/* Heatmap */}
          <div className="rounded-xl border border-neutral-200 bg-white p-4 md:p-6 mb-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-4">Facturado por día y horario</p>
            <HeatmapHorario celdas={celdas} horaMin={horaMin} horaMax={horaMax} />
          </div>

          {/* Tabla por día de semana -- vista accesible sin depender del color */}
          <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Día</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Facturado</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Ventas</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">% del total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {filasDia.map((f) => (
                  <tr key={f.diaIdx} className="hover:bg-neutral-50/80 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-neutral-800">{f.label}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-neutral-800">{AR.format(f.facturado)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{NUM.format(f.cantidadVentas)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">
                      {totalFacturado > 0 ? `${((f.facturado / totalFacturado) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-neutral-400 mt-3">
            Los horarios están calculados en hora Argentina. El período por defecto son los últimos 30 días -- un solo día no alcanza para ver un patrón confiable por día de semana.
          </p>
        </>
      )}
    </div>
  );
}
