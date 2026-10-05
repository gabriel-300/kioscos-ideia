// Lecturas de Tesorería. Todas con el cliente admin (no aplica RLS): quien llama ya verificó el permiso con
// permisosTesoreria(). Las consultas que pueden pasar de 1.000 filas usan fetchAll (trampa #1 de architecture.md).
// Las tablas de dinero están tipadas en src/types/database.ts (nada de `any`).

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import type { Egreso, TesoreriaConfig } from "./tipos";
import type { SobreRecibido } from "./calculos";
import type { FilaHistorial, AccionHistorial } from "./historial";

type Admin = ReturnType<typeof createAdminClient>;

export interface SucursalTesoreria { id: string; nombre: string }
export interface ProveedorLista    { id: string; nombre: string }

export interface RetiroPendiente {
  id: string; sucursal_id: string; fecha: string; monto: number; motivo: string | null; comprobante_image_url: string | null;
  created_at: string; creado_por: string | null;   // quién lo cargó en el kiosco (nombre)
  proveedor_id: string | null;                      // pago a proveedor en efectivo (esporádico)
  autorizado_por: string | null;                    // administrador que lo autorizó (nombre)
}
export interface EntregaDescartada {
  id: string; sucursal_id: string; fecha: string; proveedor: string | null; lineas: number;
  descartado_en: string; descartado_por: string | null; motivo: string | null;
}
export interface LineaEntrega { producto: string; unidad: string | null; cantidad: number; precio_unitario: number | null; subtotal: number | null }
export interface EntregaPendiente {
  id: string; sucursal_id: string; fecha: string; proveedor: string | null; proveedor_id: string | null;
  remito_image_url: string | null; nro_remito: string | null; notas: string | null;
  created_at: string; creado_por: string | null;
  total: number;            // suma de lo que cargó el kiosco (0 si no cargó importes)
  lineas: LineaEntrega[];   // qué productos y cuántos ingresaron
}
export interface GastoFijoLista {
  id: string; categoria: string; descripcion: string; monto_estimado: number; dia_vencimiento: number; sucursal_id: string | null;
}

// Nombre de quien cargó cada fila en el kiosco (profiles.full_name).
async function nombresDe(admin: Admin, ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((i): i is string => !!i))];
  if (unicos.length === 0) return new Map();
  const { data, error } = await admin.from("profiles").select("id, full_name").in("id", unicos);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((p) => [p.id, p.full_name?.trim() || "Sin nombre"]));
}

const masNuevoPrimero = (a: { fecha: string }, b: { fecha: string }) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0);

// null = la migración 101 todavía no está aplicada (la pantalla avisa en vez de romperse).
export async function cargarConfig(admin: Admin): Promise<TesoreriaConfig | null> {
  const { data, error } = await admin.from("tesoreria_config").select("fecha_inicio, efectivo_inicial").single();
  if (error || !data) return null;
  return { fecha_inicio: data.fecha_inicio, efectivo_inicial: Number(data.efectivo_inicial) };
}

export async function cargarSucursales(admin: Admin): Promise<SucursalTesoreria[]> {
  const { data, error } = await admin
    .from("sucursales").select("id, nombre").eq("is_active", true).eq("entra_en_tesoreria", true).order("nombre");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function cargarProveedores(admin: Admin): Promise<ProveedorLista[]> {
  const { data, error } = await admin.from("proveedores").select("id, nombre").eq("is_active", true).order("nombre");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function cargarGastosFijos(admin: Admin): Promise<GastoFijoLista[]> {
  const { data, error } = await admin
    .from("gastos_fijos").select("id, categoria, descripcion, monto_estimado, dia_vencimiento, sucursal_id").eq("is_active", true).order("dia_vencimiento");
  if (error) throw new Error(error.message);
  return (data ?? []).map((g) => ({ ...g, monto_estimado: Number(g.monto_estimado) }));
}

// ── Para registrar: lo que cargó el kiosco y todavía no tiene egreso, desde la fecha de inicio ──
export async function cargarRetirosPendientes(admin: Admin, sucursalIds: string[], desde: string): Promise<RetiroPendiente[]> {
  if (sucursalIds.length === 0) return [];
  const filas = await fetchAll((d, h) =>
    admin.from("retiros_caja")
      .select("id, sucursal_id, fecha, monto, motivo, comprobante_image_url, created_at, created_by, proveedor_id, autorizado_por", { count: "exact" })
      .in("sucursal_id", sucursalIds).is("egreso_id", null).gte("fecha", desde)
      .order("id").range(d, h));
  const nombres = await nombresDe(admin, filas.flatMap((r) => [r.created_by, r.autorizado_por]));
  return filas
    .map(({ created_by, autorizado_por, ...r }) => ({
      ...r,
      monto: Number(r.monto),
      creado_por: created_by ? (nombres.get(created_by) ?? null) : null,
      autorizado_por: autorizado_por ? (nombres.get(autorizado_por) ?? null) : null,
    }))
    .sort(masNuevoPrimero);
}

export async function cargarEntregasPendientes(admin: Admin, sucursalIds: string[], desde: string): Promise<EntregaPendiente[]> {
  if (sucursalIds.length === 0) return [];
  const filas = await fetchAll((d, h) =>
    admin.from("movimientos")
      .select("id, sucursal_id, fecha, proveedor, proveedor_id, remito_image_url, nro_remito, notas, created_at, created_by, movimiento_items(cantidad, precio_unitario, subtotal, product:products(name, unit_label))", { count: "exact" })
      .in("sucursal_id", sucursalIds).eq("tipo", "entrega").is("egreso_id", null).is("tesoreria_descartado_en", null).is("anulado_en", null).gte("fecha", desde)
      .order("id").range(d, h));
  const nombres = await nombresDe(admin, filas.map((e) => e.created_by));
  return filas
    .map(({ movimiento_items, created_by, ...e }) => ({
      ...e,
      creado_por: created_by ? (nombres.get(created_by) ?? null) : null,
      total: movimiento_items.reduce((s, i) => s + Number(i.subtotal ?? 0), 0),
      lineas: movimiento_items.map((i) => ({
        producto: i.product?.name ?? "Producto sin nombre",
        unidad: i.product?.unit_label ?? null,
        cantidad: Number(i.cantidad),
        precio_unitario: i.precio_unitario == null ? null : Number(i.precio_unitario),
        subtotal: i.subtotal == null ? null : Number(i.subtotal),
      })),
    }))
    .sort(masNuevoPrimero);
}

// Entregas que el administrativo marcó "no corresponde" (no tienen compra que registrar). Se pueden volver a la lista.
export async function cargarEntregasDescartadas(admin: Admin, sucursalIds: string[], desde: string): Promise<EntregaDescartada[]> {
  if (sucursalIds.length === 0) return [];
  const filas = await fetchAll((d, h) =>
    admin.from("movimientos")
      .select("id, sucursal_id, fecha, proveedor, tesoreria_descartado_en, tesoreria_descartado_por, tesoreria_descartado_motivo, movimiento_items(id)", { count: "exact" })
      .in("sucursal_id", sucursalIds).eq("tipo", "entrega").not("tesoreria_descartado_en", "is", null).gte("fecha", desde)
      .order("id").range(d, h));
  const nombres = await nombresDe(admin, filas.map((f) => f.tesoreria_descartado_por));
  return filas
    .map((f) => ({
      id: f.id, sucursal_id: f.sucursal_id, fecha: f.fecha, proveedor: f.proveedor, lineas: f.movimiento_items.length,
      descartado_en: f.tesoreria_descartado_en as string,
      descartado_por: f.tesoreria_descartado_por ? (nombres.get(f.tesoreria_descartado_por) ?? null) : null,
      motivo: f.tesoreria_descartado_motivo,
    }))
    .sort((a, b) => (a.descartado_en < b.descartado_en ? 1 : -1));
}

// Lo que cargó el kiosco en las entregas vinculadas a cada compra (egreso): para mostrar la diferencia con la factura real.
// Se pide de a 40 egresos para no pasar el largo máximo de la dirección de la consulta.
export async function cargarTotalesKiosco(admin: Admin, egresoIds: string[]): Promise<Map<string, number>> {
  const totales = new Map<string, number>();
  for (let i = 0; i < egresoIds.length; i += 40) {
    const lote = egresoIds.slice(i, i + 40);
    const { data, error } = await admin.from("movimientos").select("egreso_id, movimiento_items(subtotal)").in("egreso_id", lote);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      if (!m.egreso_id) continue;
      const suma = m.movimiento_items.reduce((s, it) => s + Number(it.subtotal ?? 0), 0);
      totales.set(m.egreso_id, (totales.get(m.egreso_id) ?? 0) + suma);
    }
  }
  return totales;
}

// ── Historial (migración 104) ──
// Lo que se hizo en Tesorería en el período, lo más nuevo primero, con el nombre de quien lo hizo. El período es por día
// argentino (UTC-3), no UTC. Tope de 500 filas por consulta: es una pantalla de lectura, no un informe.
export async function cargarHistorial(admin: Admin, desde: string, hasta: string): Promise<FilaHistorial[]> {
  const { data, error } = await admin.from("tesoreria_historial")
    .select("id, creado_en, usuario_id, accion, entidad_id, detalle, motivo")
    .gte("creado_en", `${desde}T00:00:00-03:00`).lte("creado_en", `${hasta}T23:59:59.999-03:00`)
    .order("creado_en", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  const nombres = await nombresDe(admin, (data ?? []).map((f) => f.usuario_id));
  return (data ?? []).map((f) => ({
    id: f.id, creado_en: f.creado_en, usuario_id: f.usuario_id,
    usuario: f.usuario_id ? (nombres.get(f.usuario_id) ?? null) : null,
    accion: f.accion as AccionHistorial, entidad_id: f.entidad_id,
    detalle: (f.detalle && typeof f.detalle === "object" && !Array.isArray(f.detalle) ? f.detalle : {}) as FilaHistorial["detalle"],
    motivo: f.motivo,
  }));
}

// Para mostrar en el Resumen cuántas veces se cambió el efectivo inicial y el último cambio.
export interface CambiosEfectivoInicial { total: number; ultimo: FilaHistorial | null }
export async function cargarCambiosEfectivoInicial(admin: Admin): Promise<CambiosEfectivoInicial> {
  const { data, error, count } = await admin.from("tesoreria_historial")
    .select("id, creado_en, usuario_id, accion, entidad_id, detalle, motivo", { count: "exact" })
    .eq("accion", "efectivo_inicial_cambiado").order("creado_en", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const f = data?.[0];
  if (!f) return { total: 0, ultimo: null };
  const nombres = await nombresDe(admin, [f.usuario_id]);
  return {
    total: count ?? 1,
    ultimo: {
      id: f.id, creado_en: f.creado_en, usuario_id: f.usuario_id, usuario: f.usuario_id ? (nombres.get(f.usuario_id) ?? null) : null,
      accion: f.accion as AccionHistorial, entidad_id: f.entidad_id,
      detalle: (f.detalle && typeof f.detalle === "object" && !Array.isArray(f.detalle) ? f.detalle : {}) as FilaHistorial["detalle"],
      motivo: f.motivo,
    },
  };
}

// ── Egresos ──
const COLUMNAS_EGRESO = "id, fecha, monto, sucursal_id, categoria, proveedor_id, descripcion, comprobante, comprobante_numero, comprobante_path, pagado, origen, fecha_pago, gasto_fijo_id, nota, anulado_en, created_by, created_at";

// La base guarda texto en categoria/comprobante/origen (con CHECK); acá se estrechan a los tipos de ./tipos.
function aEgreso(e: { monto: number | string } & Record<string, unknown>): Egreso {
  return { ...e, monto: Number(e.monto) } as unknown as Egreso;
}

// Egresos vivos (no anulados) cuya fecha de compra cae en el período.
export async function cargarEgresosDelPeriodo(admin: Admin, desde: string, hasta: string): Promise<Egreso[]> {
  const filas = await fetchAll((d, h) =>
    admin.from("egresos").select(COLUMNAS_EGRESO, { count: "exact" })
      .is("anulado_en", null).gte("fecha", desde).lte("fecha", hasta)
      .order("id").range(d, h));
  return filas.map(aEgreso).sort((a, b) => (a.fecha === b.fecha ? (a.created_at < b.created_at ? 1 : -1) : a.fecha < b.fecha ? 1 : -1));
}

// Compras cargadas como pendientes de pago ("se debe"), de cualquier fecha. Lo más viejo primero.
export async function cargarEgresosPendientes(admin: Admin): Promise<Egreso[]> {
  const filas = await fetchAll((d, h) =>
    admin.from("egresos").select(COLUMNAS_EGRESO, { count: "exact" })
      .is("anulado_en", null).eq("pagado", false)
      .order("id").range(d, h));
  return filas.map(aEgreso).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

// Egresos pagados en efectivo de Tesorería desde la fecha de inicio (para el efectivo en mano).
export async function cargarSalidasEfectivo(admin: Admin, desde: string): Promise<Pick<Egreso, "origen" | "monto">[]> {
  const filas = await fetchAll((d, h) =>
    admin.from("egresos").select("origen, monto", { count: "exact" })
      .is("anulado_en", null).eq("pagado", true).eq("origen", "efectivo_tesoreria").gte("fecha_pago", desde)
      .order("id").range(d, h));
  return filas.map((f) => ({ origen: "efectivo_tesoreria" as const, monto: Number(f.monto) }));
}

// ── Lo que viene de los kioscos: ventas y sobres (tabla cierres_caja, una fila por turno) ──
export async function cargarVentasDelPeriodo(admin: Admin, sucursalIds: string[], desde: string, hasta: string): Promise<number> {
  if (sucursalIds.length === 0) return 0;
  const filas = await fetchAll((d, h) =>
    admin.from("cierres_caja").select("total_ventas", { count: "exact" })
      .in("sucursal_id", sucursalIds).gte("fecha", desde).lte("fecha", hasta)
      .order("id").range(d, h));
  return filas.reduce((s, c) => s + Number(c.total_ventas ?? 0), 0);
}

const COLUMNAS_SOBRE = "efectivo_declarado, fondo_siguiente, sobre_monto_verificado";

function aSobre(c: { efectivo_declarado: number | string; fondo_siguiente: number | string | null; sobre_monto_verificado: number | string | null }): SobreRecibido {
  return {
    efectivo_declarado:     Number(c.efectivo_declarado),
    fondo_siguiente:        c.fondo_siguiente == null ? null : Number(c.fondo_siguiente),
    sobre_monto_verificado: c.sobre_monto_verificado == null ? null : Number(c.sobre_monto_verificado),
  };
}

// Sobres que alguien retiró del kiosco desde que arrancó Tesorería (entró efectivo a Tesorería).
export async function cargarSobresRetirados(admin: Admin, sucursalIds: string[], desdeFecha: string): Promise<SobreRecibido[]> {
  if (sucursalIds.length === 0) return [];
  const filas = await fetchAll((d, h) =>
    admin.from("cierres_caja").select(COLUMNAS_SOBRE, { count: "exact" })
      .in("sucursal_id", sucursalIds).gte("sobre_retirado_en", `${desdeFecha}T00:00:00-03:00`)
      .order("id").range(d, h));
  return filas.map(aSobre);
}

// Sobres de cierres posteriores al arranque que todavía nadie retiró del kiosco (informativo).
export async function cargarSobresSinRetirar(admin: Admin, sucursalIds: string[], desdeFecha: string): Promise<SobreRecibido[]> {
  if (sucursalIds.length === 0) return [];
  const filas = await fetchAll((d, h) =>
    admin.from("cierres_caja").select(COLUMNAS_SOBRE, { count: "exact" })
      .in("sucursal_id", sucursalIds).gte("fecha", desdeFecha).is("sobre_retirado_en", null)
      .order("id").range(d, h));
  return filas.map(aSobre);
}
