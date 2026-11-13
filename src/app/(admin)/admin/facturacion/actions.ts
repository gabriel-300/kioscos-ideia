"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { emitirFacturaDeVenta, procesarComprobante, reintentarPendientes } from "@/lib/arca/emitir";
import { cuitValido, datosFaltantesEmisor, esFacturaRechazada } from "@/lib/arca/reglas";
import { esFactura } from "@/lib/arca/tipos";
import { probarEmisor, type PruebaEmisor } from "@/lib/arca/probar";
import { comoComprobanteVenta } from "@/lib/arca/venta-factura";
import { lineasParaReimprimir } from "@/lib/arca/ticket-datos";
import type { ComprobanteVenta, LineaTicket } from "@/lib/arca/ticket-html";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type ResultadoComprobante = { error?: string; pendiente?: boolean; numero?: number | null; cae?: string | null; tipo?: number; puntoVenta?: number };

/** Facturar a mano una venta (típicamente en efectivo, cuando el cliente pide el comprobante). Factura A solo con CUIT de Responsable Inscripto. */
export async function emitirComprobanteManual(movimientoId: string, documento?: string | null, tipo: "A" | "B" = "B", exento = false, referencia?: string | null): Promise<ResultadoComprobante> {
  if (tipo !== "A" && tipo !== "B") return { error: "Tipo de factura inválido." };
  const { userId, role } = await requireStaff();
  const db: Db = createAdminClient();

  const { data: mov } = await db.from("movimientos").select("sucursal_id").eq("id", movimientoId).maybeSingle();
  if (!mov) return { error: "No se encontró la venta." };
  const sinAcceso = await requireSucursalAccess(db, userId, role, mov.sucursal_id);
  if (sinAcceso) return { error: sinAcceso };

  const r = await emitirFacturaDeVenta(db, movimientoId, { origen: "manual", documento, userId, tipo, exento, referencia });
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
  // Facturar de verdad con un emisor al que le faltan datos que el ticket imprime dejaría comprobantes incompletos.
  if (data.modo === "digital" && data.emisorId) {
    const { data: emisor } = await (createAdminClient() as Db).from("arca_emisores")
      .select("ambiente, activo, domicilio, ingresos_brutos, inicio_actividades").eq("id", data.emisorId).maybeSingle();
    if (!emisor?.activo) return { error: "El emisor elegido no está activo." };
    const faltan = datosFaltantesEmisor(emisor);
    if (faltan.length > 0) return { error: `Antes de facturar de verdad, completá en el emisor: ${faltan.join(", ")}.` };
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

/** Corrige los datos que se imprimen en el ticket. El CUIT y el ambiente no se cambian: serían otro emisor. */
export async function editarEmisor(id: string, data: { razon_social: string; domicilio?: string; ingresos_brutos?: string; inicio_actividades?: string; activo: boolean; factura_a_con_retencion?: boolean }): Promise<{ error?: string }> {
  await requireAdmin();
  if (!data.razon_social.trim()) return { error: "Falta la razón social." };
  const inicio = (data.inicio_actividades ?? "").trim();
  if (inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) return { error: "El inicio de actividades tiene que ser una fecha." };
  const { error } = await (createAdminClient() as Db).from("arca_emisores").update({
    razon_social: data.razon_social.trim(),
    domicilio: data.domicilio?.trim() || null,
    ingresos_brutos: data.ingresos_brutos?.trim() || null,
    inicio_actividades: inicio || null,
    activo: data.activo,
    ...(data.factura_a_con_retencion === undefined ? {} : { factura_a_con_retencion: data.factura_a_con_retencion }),
  }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/facturacion");
  return {};
}

/** Prueba de conexión con ARCA, SOLO LECTURA (no emite nada). Corre desde donde corre la app: sirve para verificar Cloudflare. */
export async function probarConexionArca(): Promise<{ error?: string; resultados?: PruebaEmisor[] }> {
  await requireAdmin();
  const db: Db = createAdminClient();
  const [{ data: emisores, error: e1 }, { data: sucursales, error: e2 }] = await Promise.all([
    db.from("arca_emisores").select("id, cuit, razon_social, ambiente").eq("activo", true).order("created_at"),
    db.from("sucursales").select("nombre, arca_emisor_id, arca_punto_venta, arca_modo"),
  ]);
  if (e1 || e2) return { error: (e1 ?? e2).message };
  if (!emisores?.length) return { error: "No hay emisores cargados." };
  const resultados: PruebaEmisor[] = [];
  for (const emisor of emisores) resultados.push(await probarEmisor(db, emisor, sucursales ?? []));
  return { resultados };
}

export type DatosTicket = { lineas: LineaTicket[]; total: number; fecha: string; id: string; sucursalNombre: string; factura: ComprobanteVenta };

/** Datos para volver a imprimir una factura ya emitida. Solo lectura. */
export async function datosTicketComprobante(comprobanteId: string): Promise<{ error?: string; ticket?: DatosTicket }> {
  await requireAdmin();
  const db: Db = createAdminClient();
  const { data: c } = await db.from("comprobantes_arca").select("*").eq("id", comprobanteId).maybeSingle();
  if (!c) return { error: "No se encontró el comprobante." };
  if (c.estado !== "emitido" || !c.cae || !c.numero) return { error: "Solo se pueden imprimir comprobantes ya emitidos." };
  if (!esFactura(c.cbte_tipo)) return { error: "Las notas de crédito no se imprimen desde acá." };

  const { data: mov } = await db.from("movimientos")
    .select("id, fecha, sucursal:sucursales(nombre), movimiento_items(cantidad, precio_unitario, subtotal, product:products(name))")
    .eq("id", c.movimiento_id).maybeSingle();
  if (!mov) return { error: "No se encontró la venta de este comprobante." };

  return {
    ticket: {
      lineas: lineasParaReimprimir(mov.movimiento_items ?? [], Number(c.imp_total)),
      total: Number(c.imp_total),
      fecha: mov.fecha,
      id: String(mov.id).slice(-8).toUpperCase(),
      sucursalNombre: mov.sucursal?.nombre ?? "",
      factura: await comoComprobanteVenta(db, c),
    },
  };
}

/** Descarta una factura que ARCA rechazó (sin CAE ni número) para poder emitirla de nuevo. No toca nada que ARCA haya autorizado. */
export async function descartarComprobanteRechazado(id: string): Promise<{ error?: string }> {
  await requireAdmin();
  const db: Db = createAdminClient();
  const { data: c } = await db.from("comprobantes_arca").select("id, estado, numero, sucursal_id").eq("id", id).maybeSingle();
  if (!c) return { error: "No se encontró el comprobante." };
  if (!esFacturaRechazada(c)) return { error: "Solo se pueden descartar comprobantes que ARCA rechazó (con error y sin número)." };
  const { error } = await db.from("comprobantes_arca").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/facturacion");
  if (c.sucursal_id) revalidatePath(`/admin/sucursales/${c.sucursal_id}`);
  return {};
}
