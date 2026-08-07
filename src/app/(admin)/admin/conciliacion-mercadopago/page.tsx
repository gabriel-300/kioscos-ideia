import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fechaHoyAR, fmtFechaHora, fmtFechaSolo } from "@/lib/fecha";

export const revalidate = 0;
export const metadata: Metadata = { title: "Conciliación Mercado Pago — Kioscos IDEIA" };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

type QrOrder = { sucursal_id: string; monto: number; paid_at: string; movimiento_id: string | null };
type Transferencia = { sucursal_id: string | null; monto: number; recibido_en: string; movimiento_id: string | null };
type Venta = { id: string; fecha: string; sucursal_id: string; pago_billetera: number | null; pago_transferencia: number | null };

export default async function ConciliacionMercadoPagoPage({
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
  const desde = sp.desde ?? fechaHoyAR(new Date(Date.now() - 6 * 86400000));
  const hasta = sp.hasta ?? hoy;

  const [{ data: sucursales }, qrRes, transfRes, ventasRes] = await Promise.all([
    supabase.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    (admin as any)
      .from("mercadopago_qr_orders")
      .select("sucursal_id, monto, paid_at, movimiento_id")
      .eq("estado", "pagado")
      .gte("paid_at", `${desde}T00:00:00`)
      .lte("paid_at", `${hasta}T23:59:59`) as unknown as Promise<{ data: QrOrder[] | null }>,
    (admin as any)
      .from("mercadopago_transferencias_recibidas")
      .select("sucursal_id, monto, recibido_en, movimiento_id")
      .gte("recibido_en", `${desde}T00:00:00`)
      .lte("recibido_en", `${hasta}T23:59:59`) as unknown as Promise<{ data: Transferencia[] | null }>,
    (admin as any)
      .from("movimientos")
      .select("id, fecha, sucursal_id, pago_billetera, pago_transferencia")
      .eq("tipo", "venta")
      .is("anulado_en", null)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .or("pago_billetera.gt.0,pago_transferencia.gt.0") as unknown as Promise<{ data: Venta[] | null }>,
  ]);

  const sucNombreMap = new Map((sucursales ?? []).map((s) => [s.id, s.nombre]));
  const sucFiltro = sp.sucursal ?? "";

  let qr        = qrRes.data ?? [];
  let transferencias = transfRes.data ?? [];
  let ventas    = ventasRes.data ?? [];
  if (sucFiltro) {
    qr = qr.filter((q) => q.sucursal_id === sucFiltro);
    transferencias = transferencias.filter((t) => t.sucursal_id === sucFiltro);
    ventas = ventas.filter((v) => v.sucursal_id === sucFiltro);
  }

  const movimientosVinculados = new Set([
    ...qr.filter((q) => q.movimiento_id).map((q) => q.movimiento_id as string),
    ...transferencias.filter((t) => t.movimiento_id).map((t) => t.movimiento_id as string),
  ]);

  const pagosSinVenta = [
    ...qr.filter((q) => !q.movimiento_id).map((q) => ({ tipo: "QR" as const, sucursal: sucNombreMap.get(q.sucursal_id) ?? "—", monto: q.monto, fecha: q.paid_at })),
    ...transferencias.filter((t) => !t.movimiento_id).map((t) => ({ tipo: "Transferencia" as const, sucursal: t.sucursal_id ? (sucNombreMap.get(t.sucursal_id) ?? "—") : "Sin asignar", monto: t.monto, fecha: t.recibido_en })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));

  const ventasSinPagoMp = ventas
    .filter((v) => !movimientosVinculados.has(v.id))
    .map((v) => ({
      sucursal: sucNombreMap.get(v.sucursal_id) ?? "—",
      fecha: v.fecha,
      monto: (v.pago_billetera ?? 0) + (v.pago_transferencia ?? 0),
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  // Todo lo que Mercado Pago confirmó de verdad, esté vinculado a una venta
  // o no -- ver la lista de abajo para lo que todavía no tiene venta.
  const totalConfirmadoMp = qr.reduce((s, q) => s + q.monto, 0) + transferencias.reduce((s, t) => s + t.monto, 0);
  const totalRegistradoSistema = ventas.reduce((s, v) => s + (v.pago_billetera ?? 0) + (v.pago_transferencia ?? 0), 0);
  const diferenciaTotal = totalRegistradoSistema - totalConfirmadoMp;

  return (
    <div className="p-4 md:p-8 max-w-[1100px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Conciliación Mercado Pago</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Compara lo que Mercado Pago confirmó contra lo que el sistema registró como cobrado por QR/transferencia</p>
      </div>

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
          <select name="sucursal" defaultValue={sucFiltro}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="">Todas</option>
            {(sucursales ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
        {(sp.desde || sp.hasta || sp.sucursal) && (
          <Link href="/admin/conciliacion-mercadopago" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Confirmado por Mercado Pago</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalConfirmadoMp)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Registrado en el sistema</p>
          <p className="text-xl font-bold font-display tabular-nums text-neutral-900">{AR.format(totalRegistradoSistema)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${diferenciaTotal === 0 ? "border-selva-200 bg-selva-50" : "border-danger/20 bg-danger/5"}`}>
          <p className={`text-xs font-semibold uppercase tracking-widest mb-1 ${diferenciaTotal === 0 ? "text-selva-700" : "text-danger"}`}>
            {diferenciaTotal === 0 ? "Cierra ✓" : "Diferencia"}
          </p>
          <p className={`text-xl font-bold font-display tabular-nums ${diferenciaTotal === 0 ? "text-selva-700" : "text-danger"}`}>
            {diferenciaTotal > 0 ? "+" : ""}{AR.format(diferenciaTotal)}
          </p>
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-sm font-semibold text-neutral-800 mb-1">Pagos que Mercado Pago confirmó sin venta vinculada</h2>
        <p className="text-xs text-neutral-400 mb-3">Posible venta no registrada, o transferencia todavía sin conciliar (ver la sucursal correspondiente).</p>
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          {pagosSinVenta.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">Nada pendiente en este rango.</p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {pagosSinVenta.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <span className="font-medium text-neutral-800">{p.sucursal}</span>
                    <span className="text-neutral-400 ml-2 text-xs">{p.tipo} · {fmtFechaHora(p.fecha)}</span>
                  </div>
                  <span className="font-semibold tabular-nums">{AR.format(p.monto)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-800 mb-1">Ventas por billetera/transferencia sin pago de Mercado Pago vinculado</h2>
        <p className="text-xs text-neutral-400 mb-3">El vendedor tipeó un monto a mano sin usar el QR, o la transferencia fue a otro alias/banco.</p>
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          {ventasSinPagoMp.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-400">Nada pendiente en este rango.</p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {ventasSinPagoMp.map((v, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <span className="font-medium text-neutral-800">{v.sucursal}</span>
                    <span className="text-neutral-400 ml-2 text-xs">{fmtFechaSolo(v.fecha + "T12:00:00")}</span>
                  </div>
                  <span className="font-semibold tabular-nums">{AR.format(v.monto)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-neutral-400 mt-6">
        Solo cubre lo que pasó desde que existe esta conciliación -- no hay forma de reconstruir pagos anteriores.
      </p>
    </div>
  );
}
