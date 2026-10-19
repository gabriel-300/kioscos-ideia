// Lecturas de la cuenta corriente por proveedor (migración 106). Cliente admin: quien llama ya verificó el permiso.
// La tabla es nueva y todavía no está en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { cargarEgresosPendientes } from "./consultas";
import { calcularCuentas, type CompraAdeudada, type MovimientoProveedor, type TipoMovimiento } from "./proveedores-cuenta";
import type { Origen } from "./tipos";

type Admin = ReturnType<typeof createAdminClient>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabla = (admin: Admin, nombre: string) => (admin as any).from(nombre);

// Pagos y saldos iniciales vigentes (los anulados no cuentan).
// `tolerarSinTabla`: el Resumen no tiene que romperse si la migración 106 todavía no está aplicada (no hay pagos que restar).
export async function cargarMovimientosProveedor(admin: Admin, tolerarSinTabla = false): Promise<MovimientoProveedor[]> {
  let filas: Record<string, unknown>[];
  try {
    filas = await fetchAll<Record<string, unknown>>((d, h) =>
      tabla(admin, "proveedor_cuenta")
        .select("id, tipo, proveedor_id, sucursal_id, fecha, monto, origen, nota, created_at, created_by", { count: "exact" })
        .is("anulado_en", null).order("id").range(d, h));
  } catch (e) {
    if (tolerarSinTabla && e instanceof Error && e.message.includes("proveedor_cuenta")) return [];
    throw e;
  }
  return filas.map((f) => ({
    id: String(f.id), tipo: f.tipo as TipoMovimiento, proveedor_id: String(f.proveedor_id), sucursal_id: String(f.sucursal_id),
    fecha: String(f.fecha), monto: Number(f.monto), origen: (f.origen as Origen | null) ?? null,
    nota: (f.nota as string | null) ?? null, created_at: String(f.created_at), created_by: (f.created_by as string | null) ?? null,
  }));
}

// La cuenta de UN proveedor en UN local: su saldo hoy y la fecha de corte del saldo inicial (null si no se cargó uno). La usan las
// acciones para (a) no aceptar remitos ni pagos anteriores al corte, que ya están incluidos en el saldo inicial, y (b) pedir
// confirmación cuando un pago deja la cuenta a favor.
export async function cargarCuentaDe(admin: Admin, proveedor_id: string, sucursal_id: string): Promise<{ saldo: number; fechaCorte: string | null }> {
  const [filas, compras] = await Promise.all([
    fetchAll<Record<string, unknown>>((d, h) =>
      tabla(admin, "proveedor_cuenta")
        .select("id, tipo, proveedor_id, sucursal_id, fecha, monto, origen, nota, created_at, created_by", { count: "exact" })
        .eq("proveedor_id", proveedor_id).eq("sucursal_id", sucursal_id).is("anulado_en", null).order("id").range(d, h)),
    fetchAll<{ id: string; fecha: string; monto: number | string; descripcion: string; comprobante_numero: string | null }>((d, h) =>
      admin.from("egresos")
        .select("id, fecha, monto, descripcion, comprobante_numero", { count: "exact" })
        .eq("proveedor_id", proveedor_id).eq("sucursal_id", sucursal_id).eq("pagado", false).is("anulado_en", null).order("id").range(d, h)),
  ]);
  const movimientos: MovimientoProveedor[] = filas.map((f) => ({
    id: String(f.id), tipo: f.tipo as TipoMovimiento, proveedor_id: String(f.proveedor_id), sucursal_id: String(f.sucursal_id),
    fecha: String(f.fecha), monto: Number(f.monto), origen: (f.origen as Origen | null) ?? null,
    nota: (f.nota as string | null) ?? null, created_at: String(f.created_at), created_by: (f.created_by as string | null) ?? null,
  }));
  const cuenta = calcularCuentas(
    compras.map((c) => ({ id: c.id, proveedor_id, sucursal_id, fecha: c.fecha, monto: Number(c.monto), descripcion: c.descripcion, comprobante_numero: c.comprobante_numero })),
    movimientos,
  )[0];
  return { saldo: cuenta?.saldo ?? 0, fechaCorte: movimientos.find((m) => m.tipo === "saldo_inicial")?.fecha ?? null };
}

// Compras que todavía se deben y tienen proveedor de la lista (las que no, no tienen cuenta corriente: se muestran aparte).
export async function cargarComprasAdeudadas(admin: Admin): Promise<CompraAdeudada[]> {
  const pendientes = await cargarEgresosPendientes(admin);
  return pendientes
    .filter((e) => e.proveedor_id)
    .map((e) => ({
      id: e.id, proveedor_id: e.proveedor_id as string, sucursal_id: e.sucursal_id, fecha: e.fecha, monto: e.monto,
      descripcion: e.descripcion, comprobante_numero: e.comprobante_numero,
    }));
}
