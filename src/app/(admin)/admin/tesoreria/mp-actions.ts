"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { registrarHistorial } from "@/lib/tesoreria/historial";
import {
  validarCobros, claseDeCobro, diaArgentino, esClasificacion, etiquetaClasificacion,
} from "@/lib/tesoreria/mp-cobros";

// Mismas convenciones que actions.ts: devuelven { error } en vez de lanzar, escribe solo el servidor (service_role) y cada
// acción verifica el permiso acá (cargar = administrativo de Tesorería).
type Resultado = { error?: string };

const SIN_PERMISO   = "Solo el administrativo de Tesorería puede cargar movimientos";
const SIN_MIGRACION = "Falta aplicar la migración 105 de la base de datos";

// Tabla nueva que todavía no está en src/types/database.ts (ese archivo se regenera aparte): se castea como en el resto del repo.
type Admin = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const TROZO = 500;   // filas por upsert

export interface ResultadoImportacion extends Resultado {
  nuevas?:       number;
  actualizadas?: number;
  sinLocal?:     number;     // cobros que no se pudieron atar a un local (quedan «a clasificar»)
}

export async function importarCobrosMp(filas: unknown, archivo: unknown): Promise<ResultadoImportacion> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

  const validado = validarCobros(filas);
  if ("error" in validado) return { error: validado.error };
  const cobros = validado.valor;

  const admin: Admin = createAdminClient();

  // Local de cada caja: sucursales.mercadopago_pos_id guarda el external_id de la caja (ej. «UNAM136280989»).
  const { data: sucs, error: errSuc } = await admin.from("sucursales").select("id, mercadopago_pos_id").not("mercadopago_pos_id", "is", null);
  if (errSuc) return { error: errSuc.message };
  const porCaja = new Map<string, string>((sucs ?? []).map((s: { id: string; mercadopago_pos_id: string }) => [s.mercadopago_pos_id, s.id]));

  // Cuáles ya estaban, para contar nuevas y actualizadas (y no pisar la clasificación de las que sí).
  const yaEstaban = new Set<string>();
  const ids = cobros.map((c) => c.operation_id);
  for (let i = 0; i < ids.length; i += TROZO) {
    const { data, error } = await admin.from("mp_cobros").select("operation_id").in("operation_id", ids.slice(i, i + TROZO));
    if (error) return { error: error.message.includes("mp_cobros") ? SIN_MIGRACION : error.message };
    for (const f of data ?? []) yaEstaban.add(f.operation_id);
  }

  const dias = cobros.map((c) => diaArgentino(c.fecha_cobro)).sort();
  const desde = dias[0], hasta = dias[dias.length - 1];
  const nuevas = cobros.filter((c) => !yaEstaban.has(c.operation_id)).length;
  const actualizadas = cobros.length - nuevas;

  const nombre = typeof archivo === "string" ? archivo.slice(0, 200) : null;
  const { data: imp, error: errImp } = await admin.from("mp_importaciones")
    .insert({ importado_por: permisos.userId, archivo: nombre, desde, hasta, filas: cobros.length, nuevas, actualizadas })
    .select("id").single();
  if (errImp || !imp) return { error: errImp?.message.includes("mp_importaciones") ? SIN_MIGRACION : (errImp?.message ?? "No se pudo registrar la importación") };

  let sinLocal = 0;
  const ahora = new Date().toISOString();
  const registros = cobros.map((c) => {
    const sucursal_id = c.caja_externa ? (porCaja.get(c.caja_externa) ?? null) : null;
    if (!sucursal_id) sinLocal++;
    return {
      operation_id: c.operation_id, sucursal_id, caja_externa: c.caja_externa,
      fecha_cobro: c.fecha_cobro, fecha_acreditacion: c.fecha_acreditacion, fecha_liberacion: c.fecha_liberacion,
      monto_bruto: c.monto_bruto, tarifa: c.tarifa, monto_neto: c.monto_neto, monto_devuelto: c.monto_devuelto,
      estado: c.estado, estado_detalle: c.estado_detalle, tipo_operacion: c.tipo_operacion, medio_pago: c.medio_pago,
      descripcion: c.descripcion, external_reference: c.external_reference,
      clase: claseDeCobro(c, sucursal_id), importacion_id: imp.id, actualizado_en: ahora,
    };
  });

  // El upsert actualiza solo las columnas que se mandan: la clasificación hecha a mano (clasificacion, nota, quién) no se toca.
  for (let i = 0; i < registros.length; i += TROZO) {
    const { error } = await admin.from("mp_cobros").upsert(registros.slice(i, i + TROZO), { onConflict: "operation_id" });
    if (error) return { error: `Se cargaron algunos cobros y falló el resto: ${error.message}. Volvé a subir el mismo archivo para completar.` };
  }

  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId, accion: "mp_cobros_importados", entidad_id: imp.id,
    detalle: { archivo: nombre, desde, hasta, filas: cobros.length, nuevas, actualizadas, sin_local: sinLocal },
  });
  revalidatePath("/admin/tesoreria");
  if (historial.error) {
    return { nuevas, actualizadas, sinLocal, error: "La importación se guardó, pero no quedó anotada en el historial. Avisale al administrador del sistema." };
  }
  return { nuevas, actualizadas, sinLocal };
}

// Qué es una operación que no es una venta de caja. Se puede cambiar (queda el historial).
export async function clasificarCobroMp(operationId: string, clasificacion: string, nota: string): Promise<Resultado> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return { error: SIN_PERMISO };
  if (!esClasificacion(clasificacion)) return { error: "Elegí qué es este movimiento" };
  const notaLimpia = (nota ?? "").trim().slice(0, 300);
  if (clasificacion === "otro_ingreso" && notaLimpia.length < 3) return { error: "Para «Otro ingreso» escribí de qué se trata" };

  const admin: Admin = createAdminClient();
  const { data: actual, error: errLeer } = await admin.from("mp_cobros")
    .select("operation_id, monto_neto, clase, clasificacion").eq("operation_id", operationId).single();
  if (errLeer || !actual) return { error: "No se encontró ese movimiento" };
  if (actual.clase !== "a_clasificar") return { error: "Ese cobro es una venta de caja, no se clasifica" };

  const { error } = await admin.from("mp_cobros").update({
    clasificacion, clasificacion_nota: notaLimpia || null,
    clasificado_por: permisos.userId, clasificado_en: new Date().toISOString(), actualizado_en: new Date().toISOString(),
  }).eq("operation_id", operationId);
  if (error) return { error: error.message };

  const historial = await registrarHistorial(admin, {
    usuario_id: permisos.userId, accion: "mp_cobro_clasificado",
    detalle: {
      operacion: operationId, monto: Number(actual.monto_neto),
      anterior: actual.clasificacion ? etiquetaClasificacion(actual.clasificacion) : null,
      clasificacion: etiquetaClasificacion(clasificacion),
    },
    motivo: notaLimpia || null,
  });
  revalidatePath("/admin/tesoreria");
  return historial.error ? { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." } : {};
}
