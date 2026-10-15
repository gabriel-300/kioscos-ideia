// Lecturas de la cuenta corriente por proveedor (migración 106). Cliente admin: quien llama ya verificó el permiso.
// La tabla es nueva y todavía no está en src/types/database.ts, por eso el cast; los resultados se tipan acá.

import type { createAdminClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { cargarEgresosPendientes } from "./consultas";
import type { CompraAdeudada, MovimientoProveedor, TipoMovimiento } from "./proveedores-cuenta";
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
