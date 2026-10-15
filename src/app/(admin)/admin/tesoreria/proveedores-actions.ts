"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { registrarHistorial } from "@/lib/tesoreria/historial";
import { validarMovimientoProveedor, type MovimientoEntrada } from "@/lib/tesoreria/proveedores-cuenta";
import { fechaHoyAR } from "@/lib/fecha";

// Mismas convenciones que actions.ts: devuelven { error } en vez de lanzar, escribe solo el servidor (service_role) y cada
// acción verifica el permiso acá (cargar = administrativo de Tesorería).
type Resultado = { error?: string };

const SIN_PERMISO   = "Solo el administrativo de Tesorería puede cargar movimientos";
const SIN_MIGRACION = "Falta aplicar la migración 106 de la base de datos";

// Tabla nueva que todavía no está en src/types/database.ts (ese archivo se regenera aparte): se castea como en el resto del repo.
type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const esTablaFaltante = (m: string) => m.includes("proveedor_cuenta") && /does not exist|schema cache|no existe/i.test(m);

// Un pago a cuenta o un saldo inicial. El saldo inicial es único por proveedor y local; si se cargó mal, se anula y se vuelve a cargar.
export async function registrarMovimientoProveedor(entrada: MovimientoEntrada): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const validado = validarMovimientoProveedor(entrada, fechaHoyAR());
  if ("error" in validado) return { error: validado.error };
  const m = validado.valor;

  const admin: Admin = createAdminClient();
  const [{ data: prov }, { data: suc }] = await Promise.all([
    admin.from("proveedores").select("id, nombre").eq("id", m.proveedor_id).eq("is_active", true).maybeSingle(),
    admin.from("sucursales").select("id, nombre").eq("id", m.sucursal_id).eq("entra_en_tesoreria", true).maybeSingle(),
  ]);
  if (!prov) return { error: "Ese proveedor no existe o está desactivado" };
  if (!suc)  return { error: "Ese local no entra en Tesorería" };

  const { data: creado, error } = await admin.from("proveedor_cuenta")
    .insert({ ...m, created_by: permisos.userId }).select("id").single();
  if (error || !creado) {
    const msg = error?.message ?? "";
    if (esTablaFaltante(msg)) return { error: SIN_MIGRACION };
    if (/proveedor_cuenta_saldo_inicial_uni|duplicate key/i.test(msg)) {
      return { error: "Ya hay un saldo inicial cargado para ese proveedor y local. Si estaba mal, anulalo y cargalo de nuevo." };
    }
    return { error: msg || "No se pudo guardar" };
  }

  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId,
    accion: m.tipo === "pago" ? "proveedor_pago" : "proveedor_saldo_inicial",
    entidad_id: creado.id,
    detalle: { monto: m.monto, proveedor: prov.nombre, sucursal: suc.nombre, origen: m.origen, fecha: m.fecha },
    motivo: m.nota,
  });
  revalidatePath("/admin/tesoreria");
  if (historial.error) {
    console.error("[tesoreria] no se pudo anotar en el historial:", historial.error);
    return { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." };
  }
  return {};
}

export async function anularMovimientoProveedor(id: string, motivo: string): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const texto = (motivo ?? "").trim();
  if (texto.length < 3)   return { error: "Escribí el motivo de la anulación" };
  if (texto.length > 200) return { error: "El motivo es demasiado largo (máximo 200 caracteres)" };

  const admin: Admin = createAdminClient();
  const { data, error } = await admin.from("proveedor_cuenta")
    .update({ anulado_en: new Date().toISOString(), anulado_por: permisos.userId, anulado_motivo: texto })
    .eq("id", id).is("anulado_en", null)
    .select("id, tipo, monto, proveedor:proveedores(nombre), sucursal:sucursales(nombre)");
  if (error) return { error: esTablaFaltante(error.message) ? SIN_MIGRACION : error.message };
  if ((data ?? []).length === 0) return { error: "Ese movimiento ya estaba anulado. Recargá la pantalla." };

  const fila = data![0] as { tipo: string; monto: number | string; proveedor: { nombre: string } | null; sucursal: { nombre: string } | null };
  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId, accion: "proveedor_movimiento_anulado", entidad_id: id, motivo: texto,
    detalle: { tipo: fila.tipo, monto: Number(fila.monto), proveedor: fila.proveedor?.nombre ?? null, sucursal: fila.sucursal?.nombre ?? null },
  });
  revalidatePath("/admin/tesoreria");
  return historial.error ? { error: "Se anuló, pero no quedó anotado en el historial. Avisale al administrador del sistema." } : {};
}
