// Lecturas de Tesorería. Todas con el cliente admin (no aplica RLS): quien llama ya verificó el permiso con
// permisosTesoreria(). Las consultas que pueden pasar de 1.000 filas usan fetchAll (trampa #1 de architecture.md).
// Las tablas de dinero están tipadas en src/types/database.ts (nada de `any`).

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import type { Egreso, TesoreriaConfig } from "./tipos";
import type { SobreRecibido } from "./calculos";

type Admin = ReturnType<typeof createAdminClient>;

export interface SucursalTesoreria { id: string; nombre: string }
export interface ProveedorLista    { id: string; nombre: string }

export interface RetiroPendiente {
  id: string; sucursal_id: string; fecha: string; monto: number; motivo: string | null; comprobante_image_url: string | null;
}
export interface EntregaPendiente {
  id: string; sucursal_id: string; fecha: string; proveedor: string | null; proveedor_id: string | null;
  remito_image_url: string | null; total: number;
}
export interface GastoFijoLista {
  id: string; categoria: string; descripcion: string; monto_estimado: number; dia_vencimiento: number; sucursal_id: string | null;
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
      .select("id, sucursal_id, fecha, monto, motivo, comprobante_image_url", { count: "exact" })
      .in("sucursal_id", sucursalIds).is("egreso_id", null).gte("fecha", desde)
      .order("id").range(d, h));
  return filas.map((r) => ({ ...r, monto: Number(r.monto) })).sort(masNuevoPrimero);
}

export async function cargarEntregasPendientes(admin: Admin, sucursalIds: string[], desde: string): Promise<EntregaPendiente[]> {
  if (sucursalIds.length === 0) return [];
  const filas = await fetchAll((d, h) =>
    admin.from("movimientos")
      .select("id, sucursal_id, fecha, proveedor, proveedor_id, remito_image_url, movimiento_items(subtotal)", { count: "exact" })
      .in("sucursal_id", sucursalIds).eq("tipo", "entrega").is("egreso_id", null).is("anulado_en", null).gte("fecha", desde)
      .order("id").range(d, h));
  return filas
    .map(({ movimiento_items, ...e }) => ({ ...e, total: movimiento_items.reduce((s, i) => s + Number(i.subtotal ?? 0), 0) }))
    .sort(masNuevoPrimero);
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
