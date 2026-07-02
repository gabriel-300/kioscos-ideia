import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { HistorialSucursal } from "./_components/historial-sucursal";
import { NuevaEntregaButton } from "./_components/nueva-entrega-button";
import { CierreCajaButton } from "./_components/cierre-caja-button";
import { AperturaCajaButton } from "./_components/apertura-caja-button";
import { RetiroEfectivoButton } from "./_components/retiro-efectivo-button";

export const revalidate = 0;

type StockRow = { product_id: string; product_name: string; sku: string; entradas: number; salidas: number; stock_actual: number };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("sucursales").select("nombre").eq("id", id).single();
  return { title: data ? `${data.nombre} — Kioscos IDEIA` : "Sucursal — Kioscos IDEIA" } satisfies Metadata;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-tierra-200 bg-tierra-50" : "border-neutral-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold font-display tabular-nums ${accent ? "text-tierra-700" : "text-neutral-900"}`}>{value}</p>
      {sub && <p className="text-xs text-neutral-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function SucursalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const hoy = new Date().toISOString().slice(0, 10);

  type CierreRow = { fecha: string; fondo_inicial: number; total_ventas: number; efectivo_declarado: number; billetera_declarada: number; tarjeta_declarada: number | null; transferencia_declarada: number | null; diferencia: number | null; notas: string | null; created_at: string };
  type AperturaRow = { fondo_inicial: number; notas: string | null; created_at: string };

  const [{ data: sucursal }, { data: movimentos }, { data: products }, { data: categories }, { data: cierresData }, { data: stockRows }, { data: aperturasData }, { data: retirosHoy }, personalResult] = await Promise.all([
    supabase.from("sucursales").select("*").eq("id", id).single(),
    (supabase as any)
      .from("movimientos")
      .select(`
        id, fecha, tipo, notas, canal, personal_id, created_at,
        pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
        movimiento_items(
          id, cantidad, precio_unitario, subtotal,
          product:products(id, name, sku)
        )
      `)
      .eq("sucursal_id", id)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }) as unknown as Promise<{ data: any[] | null; error: any }>,
    supabase.from("products").select("*").eq("is_active", true).order("name"),
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    (supabase as any).from("cierres_caja").select("*").eq("sucursal_id", id).eq("fecha", hoy).order("created_at", { ascending: false }).limit(1) as unknown as Promise<{ data: CierreRow[] | null }>,
    (supabase as any).from("stock_sucursal").select("product_id, product_name, sku, entradas, salidas, stock_actual").eq("sucursal_id", id) as Promise<{ data: StockRow[] | null }>,
    (supabase as any).from("aperturas_caja").select("fondo_inicial, notas, created_at").eq("sucursal_id", id).eq("fecha", hoy).order("created_at", { ascending: false }).limit(1) as unknown as Promise<{ data: AperturaRow[] | null }>,
    (supabase as any).from("retiros_caja").select("id, fecha, monto, motivo, created_at").eq("sucursal_id", id).order("fecha", { ascending: false }).order("created_at", { ascending: false }) as unknown as Promise<{ data: { id: string; fecha: string; monto: number; motivo: string; created_at: string }[] | null }>,
    (supabase as any)
      .from("profiles")
      .select("id, full_name")
      .eq("sucursal_id", id) as unknown as Promise<{ data: { id: string; full_name: string | null }[] | null }>,
  ]);

  const movimientos = movimentos;
  const aperturaActual = aperturasData?.[0] ?? null;
  const ultimoCierre   = cierresData?.[0] ?? null;
  const cajaAbierta    = aperturaActual != null && (ultimoCierre == null || aperturaActual.created_at > ultimoCierre.created_at);

  if (!sucursal) notFound();

  const personal = (personalResult.data ?? []).map((p) => ({ id: p.id, nombre: p.full_name ?? "Sin nombre" }));
  const personalMap: Record<string, string> = Object.fromEntries(personal.map((p) => [p.id, p.nombre]));

  // Staff solo puede ver su propia sucursal
  const role = user.app_metadata?.role as string | undefined;
  if (role === "encargado" && sucursal.encargado_user_id !== user.id) {
    redirect("/admin/dashboard");
  }
  if (role === "vendedor" && !personal.some((p) => p.id === user.id)) {
    redirect("/admin/dashboard");
  }

  const movs       = movimientos ?? [];
  const todosRetiros = retirosHoy ?? []; // ahora trae todos, no solo hoy
  const retirosHoyFilt = todosRetiros.filter((r) => r.fecha === hoy);

  // Totales
  const totalEntregado = movs
    .filter((m) => m.tipo === "entrega")
    .reduce((sum, m) => sum + m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0), 0);

  const totalDevuelto = movs
    .filter((m) => m.tipo === "devolucion")
    .reduce((sum, m) => sum + m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0), 0);

  const cantidadEntregas = movs.filter((m) => m.tipo === "entrega").length;

  const totalUnidadesVendidas = movs
    .filter((m) => m.tipo === "venta")
    .reduce((sum, m) => sum + m.movimiento_items.reduce((s: number, i: { cantidad: number }) => s + i.cantidad, 0), 0);

  const cantidadRegistrosVenta = movs.filter((m) => m.tipo === "venta").length;

  const retiros        = retirosHoyFilt;
  const totalRetiros   = retiros.reduce((sum, r) => sum + r.monto, 0);

  const ventasHoy      = movs.filter((m) => m.tipo === "venta" && m.fecha === hoy);
  const totalVentasHoy = ventasHoy.reduce(
    (sum, m) => sum + m.movimiento_items.reduce((s: number, i: { subtotal: number | null }) => s + (i.subtotal ?? 0), 0),
    0
  );

  const stockActual: Record<string, number> = Object.fromEntries(
    (stockRows ?? []).map((r) => [r.product_id, r.stock_actual])
  );

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        {role === "admin" && (
          <Link
            href="/admin/sucursales"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-700 mb-3 transition-colors"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Sucursales
          </Link>
        )}

        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">{sucursal.nombre}</h1>
              {!sucursal.is_active && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500">Inactiva</span>
              )}
            </div>
            <p className="text-sm text-neutral-400 mt-0.5">
              {sucursal.localidad}{sucursal.provincia && sucursal.provincia !== sucursal.localidad ? `, ${sucursal.provincia}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(role === "encargado" || role === "vendedor") ? (
              <>
                <RetiroEfectivoButton sucursalId={sucursal.id} />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="entrega"
                  label="Registrar recepción"
                  variant="ghost"
                />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="venta"
                  stockMap={stockActual}
                  categories={categories ?? []}
                  personal={personal}
                  cajaAbierta={cajaAbierta}
                />
              </>
            ) : (
              <>
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="venta"
                  variant="ghost"
                  stockMap={stockActual}
                  categories={categories ?? []}
                  personal={personal}
                  cajaAbierta={cajaAbierta}
                />
                <NuevaEntregaButton
                  sucursalId={sucursal.id}
                  sucursalNombre={sucursal.nombre}
                  products={(products ?? []) as Parameters<typeof NuevaEntregaButton>[0]["products"]}
                  defaultTipo="entrega"
                />
              </>
            )}
            <AperturaCajaButton
              sucursalId={sucursal.id}
              sucursalNombre={sucursal.nombre}
              cajaAbierta={cajaAbierta}
              aperturaActual={aperturaActual}
            />
            <CierreCajaButton
              sucursalId={sucursal.id}
              sucursalNombre={sucursal.nombre}
              movimientos={(movs as Parameters<typeof CierreCajaButton>[0]["movimientos"])}
              cajaAbierta={cajaAbierta}
              ultimoCierre={ultimoCierre}
              aperturaActual={aperturaActual}
            />
          </div>
        </div>
      </div>

      {/* ── Caja del día (staff) ── */}
      {(role === "encargado" || role === "vendedor") && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {/* Apertura */}
          <div className={`rounded-xl border p-4 ${cajaAbierta ? "bg-selva-50 border-selva-200" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${cajaAbierta ? "text-selva-600" : "text-neutral-400"}`}>
              Fondo inicial
            </p>
            {cajaAbierta && aperturaActual ? (
              <p className="text-xl font-bold font-display tabular-nums text-selva-700">{AR.format(aperturaActual.fondo_inicial)}</p>
            ) : (
              <p className="text-sm text-neutral-400">Sin apertura</p>
            )}
          </div>

          {/* Ventas hoy */}
          <div className="rounded-xl border border-tierra-100 bg-tierra-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-tierra-600 mb-2">Ventas hoy</p>
            <p className="text-xl font-bold font-display tabular-nums text-tierra-700">
              {totalVentasHoy > 0 ? AR.format(totalVentasHoy) : "—"}
            </p>
            <p className="text-[11px] text-tierra-600 mt-1">{ventasHoy.length} {ventasHoy.length === 1 ? "registro" : "registros"}</p>
          </div>

          {/* Retiros */}
          <div className={`rounded-xl border p-4 ${totalRetiros > 0 ? "bg-danger-bg/30 border-danger/20" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${totalRetiros > 0 ? "text-danger" : "text-neutral-400"}`}>
              Retiros
            </p>
            {totalRetiros > 0 ? (
              <>
                <p className="text-xl font-bold font-display tabular-nums text-danger">{AR.format(totalRetiros)}</p>
                <p className="text-[11px] text-neutral-500 mt-1">{retiros.length} {retiros.length === 1 ? "retiro" : "retiros"}</p>
              </>
            ) : (
              <p className="text-sm text-neutral-400">Sin retiros</p>
            )}
          </div>

          {/* Cierre */}
          <div className={`rounded-xl border p-4 ${!cajaAbierta && ultimoCierre ? "bg-selva-50 border-selva-200" : "bg-neutral-50 border-neutral-200"}`}>
            <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${!cajaAbierta && ultimoCierre ? "text-selva-600" : "text-neutral-400"}`}>
              Cierre
            </p>
            {!cajaAbierta && ultimoCierre ? (
              <>
                <p className="text-sm font-bold text-selva-700">Cerrado ✓</p>
                <p className="text-[11px] text-selva-600 mt-1">{AR.format(ultimoCierre.total_ventas ?? 0)}</p>
              </>
            ) : (
              <p className="text-sm text-neutral-400">Pendiente</p>
            )}
          </div>
        </div>
      )}

      {/* Info del encargado */}
      {(sucursal.encargado_nombre || sucursal.direccion || sucursal.encargado_telefono) && (
        <div className="bg-white rounded-xl border border-neutral-200 p-4 mb-6 flex flex-wrap gap-5 text-sm">
          {sucursal.encargado_nombre && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Encargado</p>
              <p className="text-neutral-800 font-medium">{sucursal.encargado_nombre}</p>
            </div>
          )}
          {sucursal.encargado_telefono && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Teléfono</p>
              <a
                href={`tel:${sucursal.encargado_telefono}`}
                className="text-tierra-700 hover:underline font-medium"
              >
                {sucursal.encargado_telefono}
              </a>
            </div>
          )}
          {sucursal.encargado_email && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Email</p>
              <a href={`mailto:${sucursal.encargado_email}`} className="text-tierra-700 hover:underline font-medium">
                {sucursal.encargado_email}
              </a>
            </div>
          )}
          {sucursal.direccion && (
            <div>
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Dirección</p>
              <p className="text-neutral-800">{sucursal.direccion}</p>
            </div>
          )}
          {sucursal.notas && (
            <div className="w-full">
              <p className="text-xs text-neutral-400 font-medium mb-0.5">Notas</p>
              <p className="text-neutral-600">{sucursal.notas}</p>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total entregado"
          value={totalEntregado > 0 ? AR.format(totalEntregado) : "—"}
          sub={`${cantidadEntregas} entregas`}
          accent
        />
        <StatCard
          label="Ventas registradas"
          value={totalUnidadesVendidas > 0 ? `${totalUnidadesVendidas} u.` : "—"}
          sub={`${cantidadRegistrosVenta} registros`}
        />
        <StatCard
          label="Devoluciones"
          value={totalDevuelto > 0 ? AR.format(totalDevuelto) : "—"}
          sub={`${movs.filter((m) => m.tipo === "devolucion").length} movimientos`}
        />
        <StatCard
          label="Saldo kiosco"
          value={totalEntregado - totalDevuelto > 0 ? AR.format(totalEntregado - totalDevuelto) : "—"}
          sub="entregado − devuelto"
        />
      </div>

      {/* Historial */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-neutral-900">Historial de movimientos</h2>
          <span className="text-xs text-neutral-400">{movs.length} registros</span>
        </div>
        <HistorialSucursal
          movimientos={movs as Parameters<typeof HistorialSucursal>[0]["movimientos"]}
          sucursalNombre={sucursal.nombre}
          retiros={todosRetiros}
          personalMap={personalMap}
        />
      </div>
    </div>
  );
}
