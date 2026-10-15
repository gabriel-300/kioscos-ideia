// Lecturas de la solapa «Mercado Pago» de Tesorería (migración 105). Cliente admin: quien llama ya verificó el permiso.
// Las tablas son nuevas y todavía no están en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import type { CobroGuardado, OrdenQr } from "./mp-cobros";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = (admin: Admin, nombre: string) => (admin as any).from(nombre);

export interface CobroLista extends CobroGuardado {
  tipo_operacion: string; medio_pago: string | null; descripcion: string | null;
  clasificacion_nota: string | null; clasificado_en: string | null;
}

export interface ImportacionMp {
  id: string; creado_en: string; archivo: string | null; desde: string; hasta: string;
  filas: number; nuevas: number; actualizadas: number;
}

const COLUMNAS_COBRO =
  "operation_id, sucursal_id, fecha_cobro, fecha_liberacion, monto_bruto, tarifa, monto_neto, monto_devuelto, estado, clase, " +
  "clasificacion, external_reference, tipo_operacion, medio_pago, descripcion, clasificacion_nota, clasificado_en";

function aCobro(f: Record<string, unknown>): CobroLista {
  return {
    ...(f as unknown as CobroLista),
    monto_bruto: Number(f.monto_bruto), tarifa: Number(f.tarifa), monto_neto: Number(f.monto_neto), monto_devuelto: Number(f.monto_devuelto),
  };
}

// Cobros del período (instantes ISO con huso). Paginado: un mes puede pasar de 1.000 filas.
export async function cargarCobrosMp(admin: Admin, desdeIso: string, hastaIso: string): Promise<CobroLista[]> {
  const filas = await fetchAll<Record<string, unknown>>((d, h) =>
    tabla(admin, "mp_cobros").select(COLUMNAS_COBRO, { count: "exact" })
      .gte("fecha_cobro", desdeIso).lte("fecha_cobro", hastaIso).order("operation_id").range(d, h));
  return filas.map(aCobro);
}

// Lo que todavía no se clasificó, de cualquier mes: si no, uno de septiembre no se podría clasificar desde ningún lado.
export async function cargarCobrosSinClasificar(admin: Admin): Promise<CobroLista[]> {
  const filas = await fetchAll<Record<string, unknown>>((d, h) =>
    tabla(admin, "mp_cobros").select(COLUMNAS_COBRO, { count: "exact" })
      .eq("clase", "a_clasificar").is("clasificacion", null).order("operation_id").range(d, h));
  return filas.map(aCobro);
}

export async function cargarImportacionesMp(admin: Admin, limite = 20): Promise<ImportacionMp[]> {
  const { data, error } = await tabla(admin, "mp_importaciones")
    .select("id, creado_en, archivo, desde, hasta, filas, nuevas, actualizadas").order("creado_en", { ascending: false }).limit(limite);
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportacionMp[];
}

// Todos los rangos importados (para saber qué días están cubiertos), no solo los últimos.
export async function cargarRangosImportados(admin: Admin): Promise<{ desde: string; hasta: string }[]> {
  const filas = await fetchAll<{ desde: string; hasta: string }>((d, h) =>
    tabla(admin, "mp_importaciones").select("desde, hasta", { count: "exact" }).order("id").range(d, h));
  return filas;
}

// Órdenes de QR del sistema en el período (con un día de margen: la hora de pago y la del cobro pueden cruzar medianoche).
export async function cargarOrdenesQr(admin: Admin, desdeIso: string, hastaIso: string): Promise<OrdenQr[]> {
  const margen = 24 * 3600_000;
  const desde = new Date(Date.parse(desdeIso) - margen).toISOString();
  const hasta = new Date(Date.parse(hastaIso) + margen).toISOString();
  const filas = await fetchAll<Record<string, unknown>>((d, h) =>
    tabla(admin, "mercadopago_qr_orders")
      .select("external_reference, mp_payment_id, estado, monto, paid_at, movimiento_id, sucursal_id", { count: "exact" })
      .eq("estado", "pagado").gte("paid_at", desde).lte("paid_at", hasta).order("id").range(d, h));
  return filas.map((f) => ({ ...(f as unknown as OrdenQr), monto: Number(f.monto) }));
}
