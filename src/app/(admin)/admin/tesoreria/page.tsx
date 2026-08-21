import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { fechaHoyAR } from "@/lib/fecha";
import { PosicionCajaView, type PosicionData } from "./_components/posicion-caja-view";

export const revalidate = 0;
export const metadata: Metadata = { title: "Posición de Caja — Kioscos IDEIA" };

export default async function TesoreriaPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; fecha?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "";
  const { data: perfil } = await (admin as any).from("profiles").select("es_socio").eq("id", user.id).single();
  const esSocio = (perfil as { es_socio: boolean | null } | null)?.es_socio ?? false;

  // Solo Admin/socio -- información financiera consolidada del negocio, no
  // de un turno puntual, no es para vendedores/encargados aunque sean de
  // confianza para el día a día de su kiosco.
  if (role !== "admin" && !esSocio) redirect("/admin/dashboard");

  const sp        = await searchParams;
  const hoy       = fechaHoyAR();
  const fecha     = sp.fecha ?? hoy;
  const esHoy     = fecha === hoy;
  // "Ahora" para hoy (recalcula en vivo), o el cierre del día para una fecha
  // pasada -- así se puede reconstruir la posición de un día anterior para
  // auditar, sin necesitar una tabla de snapshots aparte.
  const cutoffISO = esHoy ? new Date().toISOString() : `${fecha}T23:59:59-03:00`;

  const { data: sucursalesRaw } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");
  const todasSucursales = sucursalesRaw ?? [];
  const sucursalFiltro  = sp.sucursal && todasSucursales.some((s) => s.id === sp.sucursal) ? sp.sucursal : "all";
  const sucursales      = sucursalFiltro === "all" ? todasSucursales : todasSucursales.filter((s) => s.id === sucursalFiltro);
  const sucursalIds     = sucursales.map((s) => s.id);

  if (sucursalIds.length === 0) {
    redirect("/admin/tesoreria");
  }

  const [
    { data: aperturasRaw },
    { data: cierresRaw },
    { data: entregasRaw },
    { data: pagosProvRaw },
    { data: sociosRaw },
    { data: movSocioRaw },
    { data: pagosSocioRaw },
  ] = await Promise.all([
    (admin as any)
      .from("aperturas_caja")
      .select("sucursal_id, fondo_inicial, created_at")
      .in("sucursal_id", sucursalIds)
      .lte("created_at", cutoffISO)
      .order("created_at", { ascending: false }),
    (admin as any)
      .from("cierres_caja")
      .select("sucursal_id, efectivo_declarado, fondo_siguiente, sobre_retirado_en, created_at")
      .in("sucursal_id", sucursalIds)
      .lte("created_at", cutoffISO)
      .order("created_at", { ascending: false }),
    (admin as any)
      .from("movimientos")
      .select("sucursal_id, proveedor_id, movimiento_items(subtotal)")
      .in("sucursal_id", sucursalIds)
      .eq("tipo", "entrega")
      .not("proveedor_id", "is", null)
      .lte("fecha", fecha),
    (admin as any)
      .from("pagos_proveedor")
      .select("sucursal_id, proveedor_id, monto_efectivo, monto_billetera")
      .in("sucursal_id", sucursalIds)
      .lte("fecha_pago", fecha),
    (admin as any).from("profiles").select("id, full_name").eq("es_socio", true),
    (admin as any)
      .from("movimientos_socio")
      .select("sucursal_id, socio_id, tipo, monto")
      .in("sucursal_id", sucursalIds)
      .lte("fecha", fecha),
    (admin as any)
      .from("pagos_socio")
      .select("sucursal_id, socio_id, monto_efectivo, monto_billetera")
      .in("sucursal_id", sucursalIds)
      .lte("fecha", fecha),
  ]);

  // ── 1. Efectivo físico por ubicación ──────────────────────────────────
  // Con la caja abierta se usa el fondo inicial declarado (no se espera al
  // cierre para que el número exista); con la caja cerrada, lo que quedó en
  // el cajón para el turno siguiente (fondo_siguiente) -- eso es literalmente
  // la plata física que hay ahora, el resto ya se separó como sobre.
  type Apertura = { sucursal_id: string; fondo_inicial: number; created_at: string };
  type Cierre = { sucursal_id: string; efectivo_declarado: number; fondo_siguiente: number | null; sobre_retirado_en: string | null; created_at: string };
  const aperturas: Apertura[] = aperturasRaw ?? [];
  const cierres: Cierre[]     = cierresRaw   ?? [];

  const ultimaAperturaPorSucursal = new Map<string, Apertura>();
  for (const a of aperturas) if (!ultimaAperturaPorSucursal.has(a.sucursal_id)) ultimaAperturaPorSucursal.set(a.sucursal_id, a);
  const ultimoCierrePorSucursal = new Map<string, Cierre>();
  for (const c of cierres) if (!ultimoCierrePorSucursal.has(c.sucursal_id)) ultimoCierrePorSucursal.set(c.sucursal_id, c);

  const efectivoPorSucursal = sucursales.map((s) => {
    const apertura = ultimaAperturaPorSucursal.get(s.id) ?? null;
    const cierre   = ultimoCierrePorSucursal.get(s.id) ?? null;
    if (apertura && (!cierre || apertura.created_at > cierre.created_at)) {
      return { sucursalId: s.id, nombre: s.nombre, monto: apertura.fondo_inicial, estado: "abierta" as const };
    }
    if (cierre) {
      return { sucursalId: s.id, nombre: s.nombre, monto: cierre.fondo_siguiente ?? 0, estado: "cerrada" as const };
    }
    return { sucursalId: s.id, nombre: s.nombre, monto: 0, estado: "sin_datos" as const };
  });
  const efectivoTotal = efectivoPorSucursal.reduce((s, r) => s + r.monto, 0);

  // ── 2. Sobres pendientes de retiro ────────────────────────────────────
  // Mismo cálculo que "Historial de cierres" (max(0, declarado - fondo que
  // quedó)) -- un cierre cuenta como pendiente si a la fecha de corte
  // todavía no se había marcado retirado (si se retiró DESPUÉS del corte,
  // para esa fecha pasada seguía pendiente).
  const sobresPorSucursal = sucursales.map((s) => {
    const monto = cierres
      .filter((c) => c.sucursal_id === s.id && (!c.sobre_retirado_en || c.sobre_retirado_en > cutoffISO))
      .reduce((sum, c) => sum + (c.fondo_siguiente != null ? Math.max(0, c.efectivo_declarado - c.fondo_siguiente) : 0), 0);
    return { sucursalId: s.id, nombre: s.nombre, monto };
  });
  const sobresTotal = sobresPorSucursal.reduce((s, r) => s + r.monto, 0);

  // ── 3. Deuda a proveedores ─────────────────────────────────────────────
  // Mismo criterio que /admin/sucursales/[id]/pagos-proveedores: entregas
  // con proveedor asignado menos pagos registrados, sin límite de mes acá
  // (es la deuda TOTAL a la fecha, no de un período).
  type EntregaRow = { sucursal_id: string; proveedor_id: string; movimiento_items: { subtotal: number | null }[] };
  const entregas: EntregaRow[] = entregasRaw ?? [];
  const deudaProvMap = new Map<string, number>();
  for (const m of entregas) {
    const sub = m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    deudaProvMap.set(m.proveedor_id, (deudaProvMap.get(m.proveedor_id) ?? 0) + sub);
  }
  const pagosProv: { proveedor_id: string; monto_efectivo: number; monto_billetera: number }[] = pagosProvRaw ?? [];
  for (const p of pagosProv) {
    deudaProvMap.set(p.proveedor_id, (deudaProvMap.get(p.proveedor_id) ?? 0) - p.monto_efectivo - p.monto_billetera);
  }
  const proveedorIds = [...deudaProvMap.keys()];
  const { data: proveedoresNombres } = proveedorIds.length > 0
    ? await admin.from("proveedores").select("id, nombre").in("id", proveedorIds)
    : { data: [] as { id: string; nombre: string }[] };
  const proveedorNombreMap = new Map((proveedoresNombres ?? []).map((p) => [p.id, p.nombre]));
  const deudaProveedores = [...deudaProvMap.entries()]
    // Un saldo a favor con un proveedor no compensa la deuda con otro -- se
    // clampea en 0 antes de sumar el total, mismo criterio que la pantalla
    // de Pagos a proveedores (ahí lo hace por sucursal, acá agregado).
    .map(([id, saldo]) => ({ id, nombre: proveedorNombreMap.get(id) ?? "Proveedor eliminado", monto: Math.max(0, saldo) }))
    .filter((p) => p.monto > 0)
    .sort((a, b) => b.monto - a.monto);
  const deudaProveedoresTotal = deudaProveedores.reduce((s, p) => s + p.monto, 0);

  // ── 4. Deuda de socios ─────────────────────────────────────────────────
  // Solo retiro_temporal cuenta como deuda (retiro_ganancias es reparto real,
  // no vuelve) -- mismo criterio que /admin/sucursales/[id]/socios.
  const socios: { id: string; full_name: string | null }[] = sociosRaw ?? [];
  const deudaSocioMap = new Map<string, number>();
  for (const r of (movSocioRaw ?? []) as { socio_id: string; tipo: string; monto: number }[]) {
    if (r.tipo === "retiro_temporal") deudaSocioMap.set(r.socio_id, (deudaSocioMap.get(r.socio_id) ?? 0) + r.monto);
  }
  for (const p of (pagosSocioRaw ?? []) as { socio_id: string; monto_efectivo: number; monto_billetera: number }[]) {
    deudaSocioMap.set(p.socio_id, (deudaSocioMap.get(p.socio_id) ?? 0) - p.monto_efectivo - p.monto_billetera);
  }
  const deudaSocios = socios
    .map((s) => ({ id: s.id, nombre: s.full_name ?? "Sin nombre", monto: Math.max(0, deudaSocioMap.get(s.id) ?? 0) }))
    .filter((s) => s.monto > 0)
    .sort((a, b) => b.monto - a.monto);
  const deudaSociosTotal = deudaSocios.reduce((s, r) => s + r.monto, 0);

  const posicionConsolidada = efectivoTotal + sobresTotal - deudaProveedoresTotal - deudaSociosTotal;

  const data: PosicionData = {
    posicionConsolidada,
    efectivoTotal, sobresTotal, deudaProveedoresTotal, deudaSociosTotal,
    efectivoPorSucursal, sobresPorSucursal, deudaProveedores, deudaSocios,
    hayAlgunSocioCargado: socios.length > 0,
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Posición de Caja</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Tesorería consolidada — efectivo, sobres y deudas de todos los kioscos en un solo número</p>
      </div>

      <PosicionCajaView
        data={data}
        sucursales={todasSucursales}
        sucursalFiltro={sucursalFiltro}
        fecha={fecha}
        esHoy={esHoy}
      />
    </div>
  );
}
