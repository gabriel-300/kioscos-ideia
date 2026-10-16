// Lecturas de las liquidaciones de PedidosYa (migración 108). Cliente admin: quien llama ya verificó el permiso.
// Las tablas nuevas todavía no están en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { aCentavos, sumarDias, type EstadoCruce, type VentaSistema } from "./peya";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = (admin: Admin, nombre: string) => (admin as any).from(nombre);

export type EstadoLiquidacion = "estimado" | "confirmado" | "acreditado" | "conciliado";

// Importes en PESOS tal como están en la base (numeric); las pantallas los muestran, el cálculo se hace en centavos (peya.ts).
export interface LiquidacionPeya {
  id: string; tienda_id: string; sucursal_id: string | null; periodo_desde: string; periodo_hasta: string; estado: EstadoLiquidacion;
  pedidos_entregados: number; pedidos_cancelados: number;
  ventas_netas: number; servicio_ventas: number; servicio_pago_linea: number; cargo_plus: number; cargos_cancelacion: number;
  impuestos_pedidos: number; ingreso_estimado: number;
  publicidad: number | null; iva_comisiones: number | null; retenciones_sirtac: number | null; reintegros: number | null; ajustes: number | null;
  saldo_anterior: number | null; ajustes_nota: string | null;
  total_liquidado: number | null; neto_calculado: number | null; diferencia: number | null;
  fecha_pago_procesado: string | null; fecha_pago_estimada: string | null; fecha_acreditacion_hasta: string | null;
  fecha_acreditacion_real: string | null; monto_acreditado: number | null; mp_operation_id: string | null;
  cuenta_destino: string | null; alerta_plazo: string | null; confirmada_en: string | null; created_at: string;
}

const COLUMNAS_LIQUIDACION =
  "id, tienda_id, sucursal_id, periodo_desde, periodo_hasta, estado, pedidos_entregados, pedidos_cancelados, ventas_netas, servicio_ventas, " +
  "servicio_pago_linea, cargo_plus, cargos_cancelacion, impuestos_pedidos, ingreso_estimado, publicidad, iva_comisiones, retenciones_sirtac, " +
  "reintegros, ajustes, saldo_anterior, ajustes_nota, total_liquidado, neto_calculado, diferencia, fecha_pago_procesado, fecha_pago_estimada, " +
  "fecha_acreditacion_hasta, fecha_acreditacion_real, monto_acreditado, mp_operation_id, cuenta_destino, alerta_plazo, confirmada_en, created_at";

const NUMERICAS = [
  "ventas_netas", "servicio_ventas", "servicio_pago_linea", "cargo_plus", "cargos_cancelacion", "impuestos_pedidos", "ingreso_estimado",
  "publicidad", "iva_comisiones", "retenciones_sirtac", "reintegros", "ajustes", "saldo_anterior", "total_liquidado", "neto_calculado",
  "diferencia", "monto_acreditado",
] as const;

function aLiquidacion(f: Record<string, unknown>): LiquidacionPeya {
  const o = { ...f } as Record<string, unknown>;
  for (const k of NUMERICAS) o[k] = o[k] === null || o[k] === undefined ? null : Number(o[k]);
  for (const k of ["ventas_netas", "servicio_ventas", "servicio_pago_linea", "cargo_plus", "cargos_cancelacion", "impuestos_pedidos", "ingreso_estimado"] as const) {
    o[k] = Number(o[k] ?? 0);
  }
  return o as unknown as LiquidacionPeya;
}

export async function cargarLiquidacionesPeya(admin: Admin, limite = 40): Promise<LiquidacionPeya[]> {
  const { data, error } = await tabla(admin, "peya_liquidaciones").select(COLUMNAS_LIQUIDACION)
    .order("periodo_hasta", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(aLiquidacion);
}

export async function cargarLiquidacionPeya(admin: Admin, id: string): Promise<LiquidacionPeya | null> {
  const { data, error } = await tabla(admin, "peya_liquidaciones").select(COLUMNAS_LIQUIDACION).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? aLiquidacion(data as Record<string, unknown>) : null;
}

export async function cargarLiquidacionPorPeriodo(admin: Admin, tiendaId: string, desde: string, hasta: string): Promise<LiquidacionPeya | null> {
  const { data, error } = await tabla(admin, "peya_liquidaciones").select(COLUMNAS_LIQUIDACION)
    .eq("tienda_id", tiendaId).eq("periodo_desde", desde).eq("periodo_hasta", hasta).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? aLiquidacion(data as Record<string, unknown>) : null;
}

// La última liquidación de esa tienda con fecha de pago CONFIRMADA y período anterior: de ahí sale el plazo de cobro esperado.
export async function cargarLiquidacionPrevia(admin: Admin, tiendaId: string, antesDe: string): Promise<{ periodo_hasta: string; fecha_pago_procesado: string | null } | null> {
  const { data, error } = await tabla(admin, "peya_liquidaciones").select("periodo_hasta, fecha_pago_procesado")
    .eq("tienda_id", tiendaId).lt("periodo_hasta", antesDe).not("fecha_pago_procesado", "is", null)
    .order("periodo_hasta", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { periodo_hasta: string; fecha_pago_procesado: string | null } | null) ?? null;
}

export interface PedidoGuardado {
  id: string; nro_pedido: string; estado: string; forma_pago: string | null; fecha_pedido: string | null; entregado_en: string | null;
  motivo_rechazo: string | null; total_parcial: number; impuesto: number; comision_pago_linea: number; cargo_plus: number; comision: number;
  gastos_operativos: number; ingreso_estimado: number; efectivo_cobrado: number; monto_adeudado: number; articulos: string | null;
  movimiento_id: string | null; conciliacion: EstadoCruce | "sin_revisar"; diferencia_importe: number | null; cobrado_por: string | null;
  revisado_en: string | null; revisado_nota: string | null;   // migración 109: ya se averiguó qué pasó (deja de ser una alerta)
}

export async function cargarPedidosDeLiquidacion(admin: Admin, liquidacionId: string): Promise<PedidoGuardado[]> {
  const filas = await fetchAll<Record<string, unknown>>((d, h) =>
    tabla(admin, "peya_pedidos")
      .select("id, nro_pedido, estado, forma_pago, fecha_pedido, entregado_en, motivo_rechazo, total_parcial, impuesto, comision_pago_linea, cargo_plus, comision, gastos_operativos, ingreso_estimado, efectivo_cobrado, monto_adeudado, articulos, movimiento_id, conciliacion, diferencia_importe, cobrado_por, revisado_en, revisado_nota", { count: "exact" })
      .eq("liquidacion_id", liquidacionId).order("nro_pedido").range(d, h));
  const n = (v: unknown) => Number(v ?? 0);
  return filas.map((f) => ({
    ...(f as unknown as PedidoGuardado),
    total_parcial: n(f.total_parcial), impuesto: n(f.impuesto), comision_pago_linea: n(f.comision_pago_linea), cargo_plus: n(f.cargo_plus), comision: n(f.comision),
    gastos_operativos: n(f.gastos_operativos), ingreso_estimado: n(f.ingreso_estimado), efectivo_cobrado: n(f.efectivo_cobrado), monto_adeudado: n(f.monto_adeudado),
    diferencia_importe: f.diferencia_importe === null || f.diferencia_importe === undefined ? null : Number(f.diferencia_importe),
  }));
}

export interface ArchivoPeya { id: string; tipo: "csv" | "excel" | "pdf"; nombre: string; path: string; bytes: number | null; subido_en: string }
export async function cargarArchivosDeLiquidacion(admin: Admin, liquidacionId: string): Promise<ArchivoPeya[]> {
  const { data, error } = await tabla(admin, "peya_archivos").select("id, tipo, nombre, path, bytes, subido_en")
    .eq("liquidacion_id", liquidacionId).order("subido_en");
  if (error) throw new Error(error.message);
  return (data ?? []) as ArchivoPeya[];
}

// Tienda de PedidosYa → local del sistema (sucursales.pedidoya_store_id).
export async function cargarTiendasPeya(admin: Admin): Promise<Map<string, { sucursal_id: string; nombre: string }>> {
  const { data, error } = await admin.from("sucursales").select("id, nombre, pedidoya_store_id").not("pedidoya_store_id", "is", null);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((s: { id: string; nombre: string; pedidoya_store_id: string | null }) => [s.pedidoya_store_id as string, { sucursal_id: s.id, nombre: s.nombre }]));
}

const CANALES_PEDIDOYA = ["pedido_ya_plataforma", "pedido_ya_efectivo", "pedido_ya"];
const TROZO = 100;

// Ventas de PedidosYa del local en el período (con un día de margen: se carga después de medianoche). El importe de una venta
// «plataforma» NO está en los medios de pago (es cero: no se cobra en el momento): es la suma de sus productos.
export async function cargarVentasParaCruce(admin: Admin, sucursalId: string, desde: string, hasta: string): Promise<VentaSistema[]> {
  const movs = await fetchAll<{ id: string; created_at: string; canal: string | null }>((d, h) =>
    admin.from("movimientos").select("id, created_at, canal", { count: "exact" })
      .eq("sucursal_id", sucursalId).eq("tipo", "venta").is("anulado_en", null).in("canal", CANALES_PEDIDOYA)
      .gte("fecha", sumarDias(desde, -1)).lte("fecha", sumarDias(hasta, 1)).order("id").range(d, h));
  const totales = new Map<string, number>();
  for (let i = 0; i < movs.length; i += TROZO) {
    const ids = movs.slice(i, i + TROZO).map((m) => m.id);
    const items = await fetchAll<{ movimiento_id: string; subtotal: number | string | null }>((d, h) =>
      admin.from("movimiento_items").select("movimiento_id, subtotal", { count: "exact" }).in("movimiento_id", ids).order("id").range(d, h));
    for (const it of items) totales.set(it.movimiento_id, (totales.get(it.movimiento_id) ?? 0) + aCentavos(Number(it.subtotal ?? 0)));
  }
  return movs.map((m) => ({ id: m.id, creado_en: m.created_at, total: totales.get(m.id) ?? 0, canal: m.canal ?? "" }));
}

// Para el Resumen: si la migración 108 todavía no está aplicada no hay nada «a cobrar» y el Resumen no se rompe.
export async function cargarLiquidacionesPeyaSiExiste(admin: Admin): Promise<LiquidacionPeya[]> {
  try {
    return await cargarLiquidacionesPeya(admin);
  } catch (e) {
    if (e instanceof Error && e.message.includes("peya_liquidaciones")) return [];
    throw e;
  }
}

// De estas ventas, las que ya están cruzadas con algún pedido de PedidosYa (de cualquier liquidación).
export async function cargarVentasYaCruzadas(admin: Admin, ventaIds: string[]): Promise<Set<string>> {
  const usadas = new Set<string>();
  for (let i = 0; i < ventaIds.length; i += 200) {
    const { data, error } = await tabla(admin, "peya_pedidos").select("movimiento_id").in("movimiento_id", ventaIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as { movimiento_id: string }[]) usadas.add(f.movimiento_id);
  }
  return usadas;
}
