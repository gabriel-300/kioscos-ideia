"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { emitirFacturaDeVenta, procesarComprobante, reintentarPendientes } from "@/lib/arca/emitir";
import { cuitValido } from "@/lib/arca/reglas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type ResultadoComprobante = { error?: string; pendiente?: boolean; numero?: number | null; cae?: string | null; tipo?: number; puntoVenta?: number };

/** Facturar a mano una venta (típicamente en efectivo, cuando el cliente pide el comprobante). Factura A solo con CUIT de Responsable Inscripto. */
export async function emitirComprobanteManual(movimientoId: string, documento?: string | null, tipo: "A" | "B" = "B"): Promise<ResultadoComprobante> {
  if (tipo !== "A" && tipo !== "B") return { error: "Tipo de factura inválido." };
  const { userId, role } = await requireStaff();
  const db: Db = createAdminClient();

  const { data: mov } = await db.from("movimientos").select("sucursal_id").eq("id", movimientoId).maybeSingle();
  if (!mov) return { error: "No se encontró la venta." };
  const sinAcceso = await requireSucursalAccess(db, userId, role, mov.sucursal_id);
  if (sinAcceso) return { error: sinAcceso };

  const r = await emitirFacturaDeVenta(db, movimientoId, { origen: "manual", documento, userId, tipo });
  revalidatePath(`/admin/sucursales/${mov.sucursal_id}`);
  revalidatePath("/admin/facturacion");
  if (!r.ok) return { error: r.error, pendiente: r.pendiente };
  const c = r.comprobante;
  return { numero: c.numero, cae: c.cae, tipo: c.cbte_tipo, puntoVenta: c.punto_venta };
}

/** Reintento de un comprobante pendiente o con error (lo hace una persona, tras revisar el motivo). */
export async function reintentarComprobante(id: string): Promise<{ error?: string }> {
  await requireAdmin();
  const r = await procesarComprobante(createAdminClient(), id);
  revalidatePath("/admin/facturacion");
  return r.ok ? {} : { error: r.error };
}

export async function reintentarPendientesAhora(): Promise<{ error?: string; intentados?: number; emitidos?: number }> {
  await requireAdmin();
  const r = await reintentarPendientes(createAdminClient(), 20);
  revalidatePath("/admin/facturacion");
  return r;
}

export async function crearEmisor(data: { cuit: string; razon_social: string; ambiente: "homologacion" | "produccion"; domicilio?: string; ingresos_brutos?: string; inicio_actividades?: string }): Promise<{ error?: string }> {
  await requireAdmin();
  const cuit = data.cuit.replace(/[^0-9]/g, "");
  if (!cuitValido(cuit)) return { error: "El CUIT no es válido." };
  if (!data.razon_social.trim()) return { error: "Falta la razón social." };
  if (data.ambiente !== "homologacion" && data.ambiente !== "produccion") return { error: "Ambiente inválido." };

  const { error } = await (createAdminClient() as Db).from("arca_emisores").insert({
    cuit, razon_social: data.razon_social.trim(), ambiente: data.ambiente,
    domicilio: data.domicilio?.trim() || null,
    ingresos_brutos: data.ingresos_brutos?.trim() || null,
    inicio_actividades: /^\d{4}-\d{2}-\d{2}$/.test(data.inicio_actividades ?? "") ? data.inicio_actividades : null,
  });
  if (error) return { error: error.code === "23505" ? "Ya existe un emisor con ese CUIT en ese ambiente." : error.message };
  revalidatePath("/admin/facturacion");
  return {};
}

export async function configurarSucursalArca(data: {
  sucursalId: string; modo: "desactivado" | "digital"; emisorId: string | null; puntoVenta: number | null;
}): Promise<{ error?: string }> {
  await requireAdmin();
  if (data.modo === "digital") {
    if (!data.emisorId) return { error: "Elegí el emisor." };
    if (!data.puntoVenta || !Number.isInteger(data.puntoVenta) || data.puntoVenta < 1 || data.puntoVenta > 99998) {
      return { error: "El punto de venta tiene que ser un número entre 1 y 99998." };
    }
  }
  const { error } = await (createAdminClient() as Db).from("sucursales").update({
    arca_modo: data.modo,
    arca_emisor_id: data.emisorId || null,
    arca_punto_venta: data.puntoVenta || null,
  }).eq("id", data.sucursalId);
  if (error) return { error: error.message };
  revalidatePath("/admin/facturacion");
  return {};
}
