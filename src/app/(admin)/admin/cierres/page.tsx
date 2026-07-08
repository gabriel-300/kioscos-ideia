import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CierresExportButton } from "./_components/export-button";
import { NotaBadge } from "./_components/nota-badge";
import { SobreEstado } from "./_components/sobre-estado";
import { fechaHoyAR } from "@/lib/fecha";

export const revalidate = 0;
export const metadata: Metadata = { title: "Informe de cierres — Kioscos IDEIA" };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

function DiferenciaBadge({ d }: { d: number | null }) {
  if (d === null) return <span className="text-neutral-300 text-xs">—</span>;
  if (d === 0)
    return <span className="text-xs font-semibold text-selva-600 bg-selva-50 px-2 py-0.5 rounded-full">Exacto</span>;
  if (d > 0)
    return <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">+{AR.format(d)}</span>;
  return <span className="text-xs font-semibold text-danger bg-danger/5 px-2 py-0.5 rounded-full">{AR.format(d)}</span>;
}

export default async function CierresPage({
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
  const desde = sp.desde ?? fechaHoyAR(new Date(Date.now() - 29 * 86400000));
  const hasta = sp.hasta ?? hoy;
  const sucFilter = sp.sucursal ?? "all";

  // Fetch sucursales (para el filtro)
  const { data: sucursales } = await supabase
    .from("sucursales")
    .select("id, nombre")
    .eq("is_active", true)
    .order("nombre");

  // Fetch cierres con join a sucursales y aperturas
  let query = (admin as any)
    .from("cierres_caja")
    .select(`
      id, fecha, total_ventas, efectivo_declarado, billetera_declarada, tarjeta_declarada, transferencia_declarada, diferencia, notas, created_by, created_at, fondo_siguiente, numero_liquidacion,
      sobre_retirado_por, sobre_retirado_en, sobre_monto_verificado, sobre_verificado_por, sobre_verificado_en, sobre_notas,
      sucursales(id, nombre)
    `)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false });

  if (sucFilter !== "all") {
    query = query.eq("sucursal_id", sucFilter);
  }

  type CierreRow = {
    id: string;
    fecha: string;
    total_ventas: number | null;
    efectivo_declarado: number | null;
    billetera_declarada: number | null;
    tarjeta_declarada: number | null;
    transferencia_declarada: number | null;
    diferencia: number | null;
    notas: string | null;
    created_by: string | null;
    created_at: string;
    fondo_siguiente: number | null;
    numero_liquidacion: number | null;
    sobre_retirado_por: string | null;
    sobre_retirado_en: string | null;
    sobre_monto_verificado: number | null;
    sobre_verificado_por: string | null;
    sobre_verificado_en: string | null;
    sobre_notas: string | null;
    sucursales: { id: string; nombre: string } | null;
  };

  const { data: cierresRaw } = (await query) as { data: CierreRow[] | null };
  const cierres = cierresRaw ?? [];

  // Fetch aperturas del mismo rango para cruzar fondo_inicial (con created_at para multi-turno)
  const { data: aperturasRaw } = await ((admin as any)
    .from("aperturas_caja")
    .select("sucursal_id, fecha, fondo_inicial, created_at")
    .gte("fecha", desde)
    .lte("fecha", hasta)) as unknown as { data: { sucursal_id: string; fecha: string; fondo_inicial: number; created_at: string }[] | null };

  const aperturasBySuc: Record<string, { fecha: string; fondo_inicial: number; created_at: string }[]> = {};
  for (const a of aperturasRaw ?? []) {
    if (!aperturasBySuc[a.sucursal_id]) aperturasBySuc[a.sucursal_id] = [];
    aperturasBySuc[a.sucursal_id].push({ fecha: a.fecha, fondo_inicial: a.fondo_inicial, created_at: a.created_at });
  }
  function findFondo(sucId: string, cierreDate: string, cierreCreatedAt: string): number | null {
    const candidates = (aperturasBySuc[sucId] ?? []).filter(
      (a) => a.fecha === cierreDate && a.created_at <= cierreCreatedAt
    );
    if (!candidates.length) return null;
    return candidates.sort((a, b) => b.created_at.localeCompare(a.created_at))[0].fondo_inicial;
  }

  // Fetch retiros del mismo rango, para mostrar cuánto se retiró durante cada turno
  const { data: retirosRaw } = await ((admin as any)
    .from("retiros_caja")
    .select("sucursal_id, fecha, monto, motivo, created_at")
    .gte("fecha", desde)
    .lte("fecha", hasta)) as unknown as { data: { sucursal_id: string; fecha: string; monto: number; motivo: string; created_at: string }[] | null };

  const retirosBySuc: Record<string, { fecha: string; monto: number; motivo: string; created_at: string }[]> = {};
  for (const r of retirosRaw ?? []) {
    if (!retirosBySuc[r.sucursal_id]) retirosBySuc[r.sucursal_id] = [];
    retirosBySuc[r.sucursal_id].push(r);
  }
  // Cierres ordenados ascendente por sucursal, para encontrar "el cierre anterior" y acotar la ventana del turno
  const cierresBySucAsc: Record<string, string[]> = {};
  for (const c of cierres) {
    const suc = c.sucursales as { id: string } | null;
    if (!suc) continue;
    if (!cierresBySucAsc[suc.id]) cierresBySucAsc[suc.id] = [];
    cierresBySucAsc[suc.id].push(c.created_at);
  }
  for (const key in cierresBySucAsc) cierresBySucAsc[key].sort();

  function retirosDelTurno(sucId: string, cierreCreatedAt: string) {
    const anteriores = (cierresBySucAsc[sucId] ?? []).filter((ts) => ts < cierreCreatedAt);
    const cotaInferior = anteriores.length > 0 ? anteriores[anteriores.length - 1] : null;
    return (retirosBySuc[sucId] ?? []).filter(
      (r) => r.created_at <= cierreCreatedAt && (cotaInferior === null || r.created_at > cotaInferior)
    );
  }

  // Fetch nombres de usuarios (created_by, y quién retiró/verificó el sobre)
  const userIds = [...new Set(
    cierres.flatMap((c) => [c.created_by, c.sobre_retirado_por, c.sobre_verificado_por]).filter(Boolean)
  )] as string[];
  let profileMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      if (p.full_name) profileMap[p.id] = p.full_name;
    }
    // Los socios (admin) pueden no tener full_name en profiles -- se completa
    // con el nombre/email de auth.users para no mostrar "—" para ellos.
    const faltantes = userIds.filter((id) => !profileMap[id]);
    if (faltantes.length > 0) {
      const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 200 });
      for (const id of faltantes) {
        const u = (authUsers ?? []).find((au) => au.id === id);
        if (u) profileMap[id] = (u.user_metadata?.full_name as string | undefined) ?? u.email ?? id;
      }
    }
  }

  // Totales del período
  const totalVentas        = cierres.reduce((s, c) => s + (c.total_ventas ?? 0), 0);
  // El efectivo declarado incluye el fondo inicial que ya estaba en el cajón --
  // sumar ese monto crudo a través de varios cierres cuenta la misma plata
  // (el fondo se recicla de un turno al siguiente) varias veces. Para el total
  // se usa el mismo neto que ya calcula "Diferencia" por fila: efectivo - fondo
  // inicial + retiros del turno = plata real que entró por ventas en efectivo.
  const totalEfectivo      = cierres.reduce((s, c) => {
    const suc = c.sucursales as { id: string } | null;
    const fondo = suc ? findFondo(suc.id, c.fecha, c.created_at) : null;
    const retiros = suc ? retirosDelTurno(suc.id, c.created_at).reduce((ss, r) => ss + r.monto, 0) : 0;
    return s + (c.efectivo_declarado ?? 0) - (fondo ?? 0) + retiros;
  }, 0);
  const totalBilletera     = cierres.reduce((s, c) => s + ((c as any).billetera_declarada ?? 0), 0);
  const totalTarjeta       = cierres.reduce((s, c) => s + ((c as any).tarjeta_declarada ?? 0), 0);
  const totalTransferencia = cierres.reduce((s, c) => s + ((c as any).transferencia_declarada ?? 0), 0);
  const totalDiferencia    = cierres.reduce((s, c) => s + (c.diferencia ?? 0), 0);
  const totalRetiros       = cierres.reduce((s, c) => {
    const suc = c.sucursales as { id: string } | null;
    if (!suc) return s;
    return s + retirosDelTurno(suc.id, c.created_at).reduce((ss, r) => ss + r.monto, 0);
  }, 0);

  const cierresExport = cierres.map((c) => {
    const suc = c.sucursales as { id: string; nombre: string } | null;
    const retirosTurno = suc ? retirosDelTurno(suc.id, c.created_at) : [];
    const fondoSig = c.fondo_siguiente;
    return {
      fecha:               c.fecha,
      numero_liquidacion:  c.numero_liquidacion,
      sucursal:            suc?.nombre ?? "—",
      fondo_inicial:       suc ? findFondo(suc.id, c.fecha, c.created_at) : null,
      ventas:              c.total_ventas ?? 0,
      efectivo:            c.efectivo_declarado ?? 0,
      billetera:           (c as any).billetera_declarada ?? 0,
      tarjeta:             (c as any).tarjeta_declarada ?? 0,
      transferencia:       (c as any).transferencia_declarada ?? 0,
      diferencia:          c.diferencia,
      retiros:             retirosTurno.reduce((s, r) => s + r.monto, 0),
      fondo_siguiente:     fondoSig,
      monto_sobre:         fondoSig != null ? Math.max(0, (c.efectivo_declarado ?? 0) - fondoSig) : null,
      notas:               c.notas ?? "",
      encargado:           c.created_by ? (profileMap[c.created_by] ?? "—") : "—",
    };
  });

  return (
    <div className="p-4 md:p-8 max-w-[1600px]">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Informe de cierres</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Cierres de caja por sucursal y período</p>
        </div>
        {cierres.length > 0 && <CierresExportButton cierres={cierresExport} />}
      </div>

      {/* Filtros */}
      <form method="GET" className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Desde</label>
          <input
            type="date"
            name="desde"
            defaultValue={desde}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Hasta</label>
          <input
            type="date"
            name="hasta"
            defaultValue={hasta}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Sucursal</label>
          <select
            name="sucursal"
            defaultValue={sucFilter}
            className="h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          >
            <option value="all">Todas</option>
            {(sucursales ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors"
        >
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.sucursal) && (
          <Link
            href="/admin/cierres"
            className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center"
          >
            Limpiar
          </Link>
        )}
      </form>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          { label: "Ventas sistema", value: AR.format(totalVentas), sub: `${cierres.length} cierres` },
          { label: "Efectivo", value: AR.format(totalEfectivo), sub: "Neto de fondo" },
          { label: "Billetera", value: AR.format(totalBilletera) },
          { label: "Tarjeta", value: AR.format(totalTarjeta) },
          { label: "Transferencia", value: AR.format(totalTransferencia) },
          {
            label: "Diferencia",
            value: totalDiferencia === 0 ? "Cuadra ✓"
              : (totalDiferencia > 0 ? "+" : "") + AR.format(totalDiferencia),
            accent: totalDiferencia !== 0,
            negative: totalDiferencia < 0,
          },
        ].map((c, i) => (
          <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">{c.label}</p>
            <p className={`text-xl font-bold font-display tabular-nums ${
              "negative" in c && c.negative ? "text-danger"
              : "accent" in c && c.accent ? "text-blue-600"
              : "text-neutral-900"
            }`}>{c.value}</p>
            {"sub" in c && c.sub && <p className="text-xs text-neutral-400 mt-0.5">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: "700px" }}>
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Fecha</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sucursal</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">N° Liq.</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Encargado</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Fondo ini.</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Ventas</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Efectivo</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Billetera</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Tarjeta</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Transfer.</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-neutral-500">Diferencia</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Retiros</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Fondo sig.</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">En sobre</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {cierres.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-12 text-center text-sm text-neutral-400">
                    Sin cierres en el período seleccionado.
                  </td>
                </tr>
              ) : (
                cierres.map((c) => {
                  const suc = c.sucursales as { id: string; nombre: string } | null;
                  const fondo = suc ? findFondo(suc.id, c.fecha, c.created_at) : null;
                  const encargado = c.created_by ? (profileMap[c.created_by] ?? "—") : "—";
                  const retirosTurno = suc ? retirosDelTurno(suc.id, c.created_at) : [];
                  const totalRetirosTurno = retirosTurno.reduce((s, r) => s + r.monto, 0);
                  const fondoSiguiente = (c as any).fondo_siguiente as number | null;
                  const montoSobre = fondoSiguiente != null ? Math.max(0, (c.efectivo_declarado ?? 0) - fondoSiguiente) : null;
                  const fechaDisplay = new Date(c.fecha + "T12:00:00").toLocaleDateString("es-AR", {
                    weekday: "short", day: "numeric", month: "short",
                  });

                  return (
                    <tr key={c.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-neutral-800 capitalize">{fechaDisplay}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        {suc ? (
                          <Link href={`/admin/sucursales/${suc.id}`} className="text-tierra-700 hover:underline font-medium">
                            {suc.nombre}
                          </Link>
                        ) : <span className="text-neutral-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-neutral-500">
                        {c.numero_liquidacion != null ? `#${c.numero_liquidacion}` : <span className="text-neutral-200">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-neutral-500">{encargado}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 text-xs">
                        {fondo !== null ? AR.format(fondo) : <span className="text-neutral-200">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-neutral-800">
                        {AR.format(c.total_ventas ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                        {AR.format(c.efectivo_declarado ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                        {AR.format((c as any).billetera_declarada ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 text-xs">
                        {((c as any).tarjeta_declarada ?? 0) > 0 ? AR.format((c as any).tarjeta_declarada) : <span className="text-neutral-200">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-neutral-500 text-xs">
                        {((c as any).transferencia_declarada ?? 0) > 0 ? AR.format((c as any).transferencia_declarada) : <span className="text-neutral-200">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <DiferenciaBadge d={c.diferencia} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs" title={retirosTurno.map((r) => `${r.motivo}: ${AR.format(r.monto)}`).join(" | ") || undefined}>
                        {totalRetirosTurno > 0 ? <span className="text-amber-600 font-medium">{AR.format(totalRetirosTurno)}</span> : <span className="text-neutral-200">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-neutral-500">
                        {fondoSiguiente != null ? AR.format(fondoSiguiente) : <span className="text-neutral-200">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <SobreEstado
                          cierreId={c.id}
                          montoSobre={montoSobre}
                          retiradoPorNombre={c.sobre_retirado_por ? (profileMap[c.sobre_retirado_por] ?? "—") : null}
                          retiradoEn={c.sobre_retirado_en}
                          montoVerificado={c.sobre_monto_verificado}
                          verificadoPorNombre={c.sobre_verificado_por ? (profileMap[c.sobre_verificado_por] ?? "—") : null}
                          verificadoEn={c.sobre_verificado_en}
                          notas={c.sobre_notas}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {c.notas && <NotaBadge nota={c.notas} />}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {cierres.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
                  <td className="px-3 py-2.5 text-xs uppercase tracking-wide text-neutral-500" colSpan={5}>
                    Total ({cierres.length} cierres)
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-800">{AR.format(totalVentas)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{AR.format(totalEfectivo)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{AR.format(totalBilletera)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{AR.format(totalTarjeta)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{AR.format(totalTransferencia)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <DiferenciaBadge d={totalDiferencia} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{AR.format(totalRetiros)}</td>
                  <td />
                  <td />
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="text-xs text-neutral-400 mt-3">
        Diferencia = suma de todos los medios declarados − ventas registradas en el sistema.
        Positivo indica sobrante, negativo indica faltante.
        El total de Efectivo (tarjeta y pie de tabla) es neto del fondo inicial de cada turno — la columna
        "Efectivo" de cada fila sigue mostrando lo contado en el cajón (incluye el fondo).
      </p>
    </div>
  );
}
