"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { registrarHistorial, type AccionHistorial } from "@/lib/tesoreria/historial";
import { validarMovimientoPersona, type MovimientoPersonaEntrada, type TipoMovimientoPersona } from "@/lib/tesoreria/persona-cuenta";
import { fechaHoyAR } from "@/lib/fecha";

// Mismas convenciones que cuentas-actions.ts: devuelven { error } en vez de lanzar, escribe solo el servidor (service_role) y cada
// acción verifica el permiso acá (cargar = administrativo de Tesorería).
type Resultado = { error?: string };

const SIN_PERMISO   = "Solo el administrativo de Tesorería puede cargar movimientos";
const SIN_MIGRACION = "Falta aplicar la migración 129 de la base de datos";

// Tabla nueva que todavía no está en src/types/database.ts (ese archivo se regenera aparte): se castea como en el resto del repo.
type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const esTablaFaltante = (m: string) => m.includes("persona_cuenta") && /does not exist|schema cache|no existe/i.test(m);

const ACCION_POR_TIPO: Record<TipoMovimientoPersona, AccionHistorial> = {
  saldo_inicial:    "persona_saldo_inicial",
  adelanto:         "persona_adelanto",
  reposicion:       "persona_reposicion",
  descuento_sueldo: "persona_descuento_sueldo",
};

// Saldo inicial (uno solo vigente por persona), adelanto, reposición o descuento de sueldo.
export async function registrarMovimientoPersona(entrada: MovimientoPersonaEntrada): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const validado = validarMovimientoPersona(entrada, fechaHoyAR());
  if ("error" in validado) return { error: validado.error };
  const m = validado.valor;

  const admin: Admin = createAdminClient();
  const { data: persona } = await admin.from("profiles").select("id, full_name").eq("id", m.persona_id).maybeSingle();
  if (!persona) return { error: "No se encontró a esa persona" };

  const { data: creado, error } = await admin.from("persona_cuenta")
    .insert({ ...m, created_by: permisos.userId }).select("id").single();
  if (error || !creado) {
    const msg = error?.message ?? "";
    if (esTablaFaltante(msg)) return { error: SIN_MIGRACION };
    if (/persona_cuenta_saldo_inicial_uni|duplicate key/i.test(msg)) {
      return { error: "Esa persona ya tiene un saldo inicial cargado. Si estaba mal, anulalo y cargalo de nuevo." };
    }
    return { error: msg || "No se pudo guardar" };
  }

  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId,
    accion: ACCION_POR_TIPO[m.tipo],
    entidad_id: creado.id,
    detalle: { persona: (persona.full_name ?? "").trim() || "Sin nombre", monto: m.monto, fecha: m.fecha, origen: m.origen },
    motivo: m.nota,
  });
  revalidatePath("/admin/tesoreria");
  if (historial.error) {
    console.error("[tesoreria] no se pudo anotar en el historial:", historial.error);
    return { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." };
  }
  return {};
}

export async function anularMovimientoPersona(id: string, motivo: string): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const texto = (motivo ?? "").trim();
  if (texto.length < 3)   return { error: "Escribí el motivo de la anulación" };
  if (texto.length > 200) return { error: "El motivo es demasiado largo (máximo 200 caracteres)" };

  const admin: Admin = createAdminClient();
  const { data, error } = await admin.from("persona_cuenta")
    .update({ anulado_en: new Date().toISOString(), anulado_por: permisos.userId, anulado_motivo: texto })
    .eq("id", id).is("anulado_en", null).select("id, persona_id, tipo, monto");
  if (error) return { error: esTablaFaltante(error.message) ? SIN_MIGRACION : error.message };
  if ((data ?? []).length === 0) return { error: "Ese movimiento ya estaba anulado. Recargá la pantalla." };

  const fila = data![0] as { persona_id: string; tipo: string; monto: number | string };
  const { data: persona } = await admin.from("profiles").select("full_name").eq("id", fila.persona_id).maybeSingle();
  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId, accion: "persona_movimiento_anulado", entidad_id: id, motivo: texto,
    detalle: { persona: (persona?.full_name ?? "").trim() || "Sin nombre", tipo: fila.tipo, monto: Number(fila.monto) },
  });
  revalidatePath("/admin/tesoreria");
  return historial.error ? { error: "Se anuló, pero no quedó anotado en el historial. Avisale al administrador del sistema." } : {};
}
