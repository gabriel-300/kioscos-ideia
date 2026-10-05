"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { cargarConfig } from "@/lib/tesoreria/consultas";
import { validarEgreso, validarPago } from "@/lib/tesoreria/validaciones";
import type { EgresoEntrada } from "@/lib/tesoreria/tipos";
import { fechaHoyAR } from "@/lib/fecha";
import { redondearMoneda } from "@/lib/pedidos/pricing";

// Convención del módulo (architecture.md §2 y §9): las acciones devuelven { error } en vez de lanzar, porque
// Next.js oculta el mensaje de un throw en producción. Escribe solo el servidor (service_role), por eso cada acción
// verifica el permiso acá: cargar = admin con es_administrativo (lib/tesoreria/permisos.ts).

type Resultado = { error?: string };

const SIN_PERMISO = "Solo el administrativo de Tesorería puede cargar movimientos";
const SIN_MIGRACION = "Falta aplicar la migración 101 de la base de datos";

async function exigirCargar() {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return null;
  return permisos;
}

function refrescar() {
  revalidatePath("/admin/tesoreria");
}

// ── Registrar un egreso ──────────────────────────────────────────────────────
// Puede venir de un retiro de caja y/o de entregas que cargó el kiosco: en ese caso el egreso las "toma" (les
// pone egreso_id) y dejan de aparecer en "Para registrar".
export async function registrarEgreso(entrada: EgresoEntrada): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const validado = validarEgreso(entrada, fechaHoyAR());
  if ("error" in validado) return { error: validado.error };
  const e = validado.valor;

  const admin = createAdminClient();
  const config = await cargarConfig(admin);
  if (!config) return { error: SIN_MIGRACION };

  const { data: sucursales } = await admin.from("sucursales").select("id").eq("entra_en_tesoreria", true);
  const idsValidos = new Set<string>((sucursales ?? []).map((s: { id: string }) => s.id));
  if (e.sucursal_id && !idsValidos.has(e.sucursal_id)) return { error: "Esa sucursal no entra en Tesorería" };

  // Lo que se va a tomar tiene que existir, ser de un local de Tesorería y no estar ya registrado.
  if (e.retiros_caja_ids.length > 0) {
    const { data } = await admin.from("retiros_caja").select("id, sucursal_id")
      .in("id", e.retiros_caja_ids).is("egreso_id", null);
    const ok = (data ?? []).filter((r: { sucursal_id: string }) => idsValidos.has(r.sucursal_id));
    if (ok.length !== e.retiros_caja_ids.length) return { error: "Algún retiro de caja ya fue registrado o no corresponde. Recargá la pantalla." };
  }
  if (e.entregas_ids.length > 0) {
    const { data } = await admin.from("movimientos").select("id, sucursal_id")
      .in("id", e.entregas_ids).eq("tipo", "entrega").is("anulado_en", null).is("egreso_id", null);
    const ok = (data ?? []).filter((r: { sucursal_id: string }) => idsValidos.has(r.sucursal_id));
    if (ok.length !== e.entregas_ids.length) return { error: "Alguna entrega ya fue registrada o no corresponde. Recargá la pantalla." };
  }

  const { retiros_caja_ids, entregas_ids, ...fila } = e;
  const { data: creado, error } = await admin.from("egresos")
    .insert({ ...fila, created_by: permisos.userId }).select("id").single();
  if (error || !creado) return { error: error?.message ?? "No se pudo guardar el egreso" };

  // Tomar lo del kiosco. El filtro `egreso_id is null` evita pisar a otro administrativo que lo tomó en el medio.
  const tomar = async (tabla: "retiros_caja" | "movimientos", ids: string[]) => {
    if (ids.length === 0) return true;
    const { data } = await admin.from(tabla).update({ egreso_id: creado.id }).in("id", ids).is("egreso_id", null).select("id");
    return (data ?? []).length === ids.length;
  };
  const tomoRetiros  = await tomar("retiros_caja", retiros_caja_ids);
  const tomoEntregas = await tomar("movimientos", entregas_ids);
  if (!tomoRetiros || !tomoEntregas) {
    // Compensación: este egreso recién creado nunca llegó a verse; se suelta lo que alcanzó a tomar y se borra.
    await admin.from("retiros_caja").update({ egreso_id: null }).eq("egreso_id", creado.id);
    await admin.from("movimientos").update({ egreso_id: null }).eq("egreso_id", creado.id);
    await admin.from("egresos").delete().eq("id", creado.id);
    return { error: "Alguien más registró alguno de esos movimientos mientras tanto. Recargá la pantalla." };
  }

  refrescar();
  return {};
}

// ── Marcar como pagada una compra que estaba pendiente ───────────────────────
export async function marcarEgresoPagado(id: string, pago: { origen: string; fecha_pago: string }): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const validado = validarPago(pago, fechaHoyAR());
  if ("error" in validado) return { error: validado.error };

  const admin = createAdminClient();
  const { data, error } = await admin.from("egresos")
    .update({ pagado: true, origen: validado.valor.origen, fecha_pago: validado.valor.fecha_pago, updated_by: permisos.userId, updated_at: new Date().toISOString() })
    .eq("id", id).eq("pagado", false).is("anulado_en", null).select("id");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Esa compra ya estaba pagada o fue anulada. Recargá la pantalla." };

  refrescar();
  return {};
}

// ── Anular (nunca se borra una fila de plata) ────────────────────────────────
// Libera los retiros de caja y entregas que tenía: vuelven a "Para registrar".
export async function anularEgreso(id: string, motivo: string): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const texto = (motivo ?? "").trim();
  if (texto.length < 3)   return { error: "Escribí el motivo de la anulación" };
  if (texto.length > 200) return { error: "El motivo es demasiado largo (máximo 200 caracteres)" };

  const admin = createAdminClient();
  const { data, error } = await admin.from("egresos")
    .update({ anulado_en: new Date().toISOString(), anulado_por: permisos.userId, anulado_motivo: texto })
    .eq("id", id).is("anulado_en", null).select("id");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Ese egreso ya estaba anulado. Recargá la pantalla." };

  await admin.from("retiros_caja").update({ egreso_id: null }).eq("egreso_id", id);
  await admin.from("movimientos").update({ egreso_id: null }).eq("egreso_id", id);

  refrescar();
  return {};
}

// ── Efectivo con el que arranca Tesorería ────────────────────────────────────
export async function guardarEfectivoInicial(monto: number): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  if (typeof monto !== "number" || !Number.isFinite(monto) || monto < 0 || monto > 1_000_000_000) {
    return { error: "Ingresá un monto válido (cero o más)" };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("tesoreria_config")
    .update({ efectivo_inicial: redondearMoneda(monto), updated_by: permisos.userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return { error: error.message };

  refrescar();
  return {};
}

// ── Comprobantes (bucket privado `tesoreria`) ────────────────────────────────
// El navegador no puede subir ni leer directo (no hay policies en storage.objects): el servidor firma una URL de
// subida de un solo uso, y otra de lectura que vence en 2 minutos. El archivo ya viene reducido (lib/imagen.ts) y el
// bucket rechaza todo lo que pase de 1 MB.
const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

export async function crearUrlSubidaComprobante(tipo: string): Promise<{ error: string } | { path: string; token: string }> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  const ext = EXTENSIONES[tipo];
  if (!ext) return { error: "Solo se aceptan fotos (JPG, PNG, WebP) o PDF" };

  const path = `${fechaHoyAR().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from("tesoreria").createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "No se pudo preparar la subida" };
  return { path, token: data.token };
}

export async function urlComprobante(egresoId: string): Promise<{ error: string } | { url: string }> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeVer) return { error: "Sin permisos" };

  const admin = createAdminClient();
  const { data } = await admin.from("egresos").select("comprobante_path").eq("id", egresoId).single();
  if (!data?.comprobante_path) return { error: "Este egreso no tiene archivo adjunto" };

  const { data: firmada, error } = await admin.storage.from("tesoreria").createSignedUrl(data.comprobante_path, 120);
  if (error || !firmada) return { error: error?.message ?? "No se pudo abrir el archivo" };
  return { url: firmada.signedUrl };
}
