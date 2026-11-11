import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { fechaHoyAR, primerDiaMesAR, fmtFechaLarga } from "@/lib/fecha";

// Tablero del DUEÑO de un local independiente (migración 131): lo mismo que mira un administrador, pero solo de su local
// (ventas, formas de pago, productos más vendidos y estado de la caja). Todo con el cliente admin y acotado a su sucursal:
// quien llama (dashboard/page.tsx) ya resolvió cuál es su sucursal desde la sesión, nunca desde la URL.

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

type Item = { subtotal: number | null; cantidad: number | null; product: { id: string; name: string } | { id: string; name: string }[] | null };
type Venta = {
  id: string; fecha: string;
  pago_efectivo: number | null; pago_billetera: number | null; pago_tarjeta: number | null; pago_transferencia: number | null;
  movimiento_items: Item[];
};

const totalDe = (v: Venta) => v.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);

function Tarjeta({ titulo, valor, sub, href }: { titulo: string; valor: string; sub?: string; href?: string }) {
  const cuerpo = (
    <div className="bg-white rounded-xl border border-neutral-200 p-5 hover:border-neutral-300 hover:shadow-sm transition-all h-full">
      <p className="text-xl md:text-2xl font-bold font-display text-neutral-900 tabular-nums leading-tight mb-1 whitespace-nowrap">{valor}</p>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{titulo}</p>
      {sub && <p className="text-xs text-neutral-400 mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{cuerpo}</Link> : cuerpo;
}

function diasAtras(n: number): string {
  return fechaHoyAR(new Date(Date.now() - n * 86400000));
}

export async function DashboardDueno({ sucursalId }: { sucursalId: string }) {
  const admin = createAdminClient();
  const hoy = fechaHoyAR();
  const mesInicio = primerDiaMesAR();
  const desde = mesInicio < diasAtras(13) ? mesInicio : diasAtras(13);

  const [{ data: sucursal }, ventas, { data: aperturaHoy }, { data: cierresRecientes }, { count: sobresSinRetirar }] = await Promise.all([
    (admin as any).from("sucursales").select("nombre").eq("id", sucursalId).maybeSingle() as Promise<{ data: { nombre: string } | null }>,
    fetchAll<Venta>((d, h) =>
      (admin as any)
        .from("movimientos")
        .select("id, fecha, pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia, movimiento_items(subtotal, cantidad, product:products(id, name))", { count: "exact" })
        .eq("sucursal_id", sucursalId)
        .eq("tipo", "venta")
        .is("anulado_en", null)
        .gte("fecha", desde)
        .order("id")
        .range(d, h)
    ),
    (admin as any).from("aperturas_caja").select("fondo_inicial").eq("sucursal_id", sucursalId).eq("fecha", hoy) as Promise<{ data: { fondo_inicial: number }[] | null }>,
    (admin as any)
      .from("cierres_caja")
      .select("id, fecha, numero_liquidacion, total_ventas, diferencia")
      .eq("sucursal_id", sucursalId)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5) as Promise<{ data: { id: string; fecha: string; numero_liquidacion: number | null; total_ventas: number | null; diferencia: number | null }[] | null }>,
    (admin as any).from("cierres_caja").select("id", { count: "exact", head: true }).eq("sucursal_id", sucursalId).is("sobre_retirado_por", null) as Promise<{ count: number | null }>,
  ]);

  const delMes = ventas.filter((v) => v.fecha >= mesInicio);
  const deHoy = ventas.filter((v) => v.fecha === hoy);
  const totalMes = delMes.reduce((s, v) => s + totalDe(v), 0);
  const totalHoy = deHoy.reduce((s, v) => s + totalDe(v), 0);
  const ticket = delMes.length > 0 ? totalMes / delMes.length : 0;

  const metodos = {
    Efectivo: delMes.reduce((s, v) => s + (v.pago_efectivo ?? 0), 0),
    Billetera: delMes.reduce((s, v) => s + (v.pago_billetera ?? 0), 0),
    Tarjeta: delMes.reduce((s, v) => s + (v.pago_tarjeta ?? 0), 0),
    Transferencia: delMes.reduce((s, v) => s + (v.pago_transferencia ?? 0), 0),
  };
  const totalMetodos = Object.values(metodos).reduce((s, n) => s + n, 0);

  // Últimos 14 días (de más viejo a más nuevo).
  const porDia = Array.from({ length: 14 }, (_, k) => {
    const fecha = diasAtras(13 - k);
    return { fecha, total: ventas.filter((v) => v.fecha === fecha).reduce((s, v) => s + totalDe(v), 0) };
  });
  const maxDia = Math.max(...porDia.map((d) => d.total), 1);

  const productos = new Map<string, { nombre: string; cantidad: number; total: number }>();
  for (const v of delMes) {
    for (const i of v.movimiento_items) {
      const p = Array.isArray(i.product) ? i.product[0] : i.product;
      if (!p) continue;
      const e = productos.get(p.id) ?? { nombre: p.name, cantidad: 0, total: 0 };
      e.cantidad += Number(i.cantidad ?? 0);
      e.total += i.subtotal ?? 0;
      productos.set(p.id, e);
    }
  }
  const top = [...productos.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  const maxTop = top[0]?.total ?? 1;

  const cajaAbierta = (aperturaHoy ?? []).length > 0;
  const diferenciaMes = (cierresRecientes ?? []).filter((c) => c.fecha >= mesInicio).reduce((s, c) => s + (c.diferencia ?? 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Dashboard</h1>
        <p className="text-sm text-neutral-400 mt-0.5 capitalize">{(sucursal?.nombre ?? "").trim()} · {fmtFechaLarga(new Date())}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <Tarjeta titulo="Ventas de hoy" valor={AR.format(totalHoy)} sub={`${deHoy.length} ${deHoy.length === 1 ? "venta" : "ventas"}`} href="/admin/ventas-diarias" />
        <Tarjeta titulo="Ventas del mes" valor={AR.format(totalMes)} sub={`${delMes.length} ${delMes.length === 1 ? "venta" : "ventas"}`} href="/admin/ventas" />
        <Tarjeta titulo="Ticket promedio" valor={AR.format(ticket)} sub="Por venta, en el mes" />
        <Tarjeta
          titulo="Caja de hoy"
          valor={cajaAbierta ? "Abierta" : "Cerrada"}
          sub={cajaAbierta ? `Fondo inicial ${AR.format(aperturaHoy![0].fondo_inicial)}` : "Sin turno abierto"}
          href={`/admin/sucursales/${sucursalId}`}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <p className="text-sm font-semibold text-neutral-800 mb-4">Ventas de los últimos 14 días</p>
          <div className="flex items-end gap-1.5 h-36">
            {porDia.map((d) => (
              <div key={d.fecha} className="flex-1 flex flex-col items-center justify-end h-full gap-1" title={`${d.fecha}: ${AR.format(d.total)}`}>
                <div className="w-full rounded-t bg-selva-600/80 min-h-[2px]" style={{ height: `${Math.max((d.total / maxDia) * 100, d.total > 0 ? 4 : 1)}%` }} />
                <span className="text-[10px] text-neutral-400 tabular-nums">{d.fecha.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <p className="text-sm font-semibold text-neutral-800 mb-4">Formas de pago del mes</p>
          {totalMetodos === 0 ? (
            <p className="text-sm text-neutral-400">Todavía no hay ventas este mes.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(metodos).map(([nombre, monto]) => (
                <div key={nombre}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-neutral-600">{nombre}</span>
                    <span className="tabular-nums text-neutral-800 font-medium">{AR.format(monto)} · {Math.round((monto / totalMetodos) * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="h-full bg-tierra-600" style={{ width: `${(monto / totalMetodos) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <p className="text-sm font-semibold text-neutral-800 mb-4">Productos más vendidos del mes</p>
          {top.length === 0 ? (
            <p className="text-sm text-neutral-400">Todavía no hay ventas este mes.</p>
          ) : (
            <div className="space-y-3">
              {top.map((p) => (
                <div key={p.nombre}>
                  <div className="flex justify-between gap-3 text-xs mb-1">
                    <span className="text-neutral-700 truncate">{p.nombre}</span>
                    <span className="tabular-nums text-neutral-500 shrink-0">{NUM.format(p.cantidad)} u. · {AR.format(p.total)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="h-full bg-selva-600" style={{ width: `${(p.total / maxTop) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-neutral-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-neutral-800">Últimos cierres de caja</p>
            <Link href="/admin/cierres" className="text-xs text-tierra-700 hover:underline font-medium">Ver todos</Link>
          </div>
          {(cierresRecientes ?? []).length === 0 ? (
            <p className="text-sm text-neutral-400">Todavía no hay cierres.</p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {(cierresRecientes ?? []).map((c) => {
                const dif = c.diferencia ?? 0;
                return (
                  <div key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-neutral-600">{c.fecha.slice(8)}/{c.fecha.slice(5, 7)} {c.numero_liquidacion != null && <span className="text-neutral-300">#{c.numero_liquidacion}</span>}</span>
                    <span className="tabular-nums font-medium text-neutral-800">{AR.format(c.total_ventas ?? 0)}</span>
                    <span className={`tabular-nums text-xs font-semibold ${dif === 0 ? "text-selva-700" : dif < 0 ? "text-danger" : "text-blue-600"}`}>
                      {dif === 0 ? "Exacto" : `${dif > 0 ? "+" : "-"}${AR.format(Math.abs(dif))}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-neutral-100 flex justify-between text-xs text-neutral-500">
            <span>Diferencia de caja del mes (últimos cierres)</span>
            <span className="tabular-nums font-medium">{diferenciaMes === 0 ? "—" : `${diferenciaMes > 0 ? "+" : "-"}${AR.format(Math.abs(diferenciaMes))}`}</span>
          </div>
          {(sobresSinRetirar ?? 0) > 0 && (
            <Link href="/admin/cierres" className="mt-3 block rounded-lg bg-amber-50 text-amber-700 text-xs font-medium px-3 py-2 hover:bg-amber-100 transition-colors">
              {sobresSinRetirar} {sobresSinRetirar === 1 ? "sobre" : "sobres"} de caja por retirar
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
