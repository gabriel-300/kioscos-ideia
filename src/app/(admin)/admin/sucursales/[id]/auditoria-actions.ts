"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth/require-role";
import { fechaHoyAR } from "@/lib/fecha";

export interface AuditoriaItemInput {
  product_id:    string;
  stock_sistema: number;
  stock_contado: number;
  observacion:   string | null;
}

export async function crearAuditoria(
  sucursalId: string,
  items: AuditoriaItemInput[]
): Promise<{ error?: string; diferencias?: number }> {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  // Mismo scoping que crearMovimiento (movimientos/actions.ts)
  if (role === "encargado") {
    const { data: suc } = await supabase
      .from("sucursales").select("encargado_user_id").eq("id", sucursalId).single();
    if (suc?.encargado_user_id !== userId) return { error: "No tenés permisos para esta sucursal" };
  }
  if (role === "vendedor") {
    const { data: profile } = await (supabase as any)
      .from("profiles").select("sucursal_id").eq("id", userId).single();
    if (profile?.sucursal_id !== sucursalId) return { error: "No tenés permisos para esta sucursal" };
  }

  // La auditoría es "por turno" (una por apertura de caja), no por día --
  // si en un mismo día hay dos turnos, cada uno audita el suyo. Hace falta
  // que haya una caja abierta ahora mismo para poder auditar (mismo criterio
  // de "turno" que usa el resto del sistema: la apertura más reciente sin un
  // cierre posterior).
  const [{ data: ultimaApertura }, { data: ultimoCierre }] = await Promise.all([
    (supabase as any)
      .from("aperturas_caja")
      .select("id, created_at")
      .eq("sucursal_id", sucursalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    (supabase as any)
      .from("cierres_caja")
      .select("created_at")
      .eq("sucursal_id", sucursalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const cajaAbierta = ultimaApertura && (!ultimoCierre || ultimaApertura.created_at > ultimoCierre.created_at);
  if (!cajaAbierta) return { error: "No hay una caja abierta -- abrí un turno antes de auditar" };
  const aperturaId = ultimaApertura.id as string;

  const { data: existing } = await (supabase as any)
    .from("auditorias_stock")
    .select("id")
    .eq("apertura_id", aperturaId)
    .maybeSingle();
  if (existing) return { error: "Ya se auditó este turno" };

  const sinObservacion = items.some(
    (i) => i.stock_contado !== i.stock_sistema && !i.observacion?.trim()
  );
  if (sinObservacion) return { error: "Faltan observaciones en algunas diferencias" };

  const { data: auditoria, error: errAud } = await (supabase as any)
    .from("auditorias_stock")
    .insert({ sucursal_id: sucursalId, fecha: fechaHoyAR(), apertura_id: aperturaId, created_by: userId })
    .select("id")
    .single();
  if (errAud || !auditoria) return { error: errAud?.message ?? "No se pudo crear la auditoría" };

  const rows = items.map((i) => ({
    auditoria_id:  auditoria.id,
    product_id:    i.product_id,
    stock_sistema: i.stock_sistema,
    stock_contado: i.stock_contado,
    observacion:   i.observacion || null,
  }));
  const { error: errItems } = await (supabase as any).from("auditoria_stock_items").insert(rows);
  if (errItems) return { error: errItems.message };

  revalidatePath(`/admin/sucursales/${sucursalId}`);
  revalidatePath("/admin/auditoria");

  return { diferencias: items.filter((i) => i.stock_contado !== i.stock_sistema).length };
}

type ItemConAuditoria = {
  id:          string;
  product_id:  string;
  diferencia:  number;
  revisado_por: string | null;
  auditoria:   { sucursal_id: string; fecha: string } | null;
};

export async function aprobarAjuste(itemId: string, notaAdmin?: string): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { data: item, error: errItem } = await (supabase as any)
    .from("auditoria_stock_items")
    .select("id, product_id, diferencia, revisado_por, auditoria:auditorias_stock(sucursal_id, fecha)")
    .eq("id", itemId)
    .single();
  const row = item as ItemConAuditoria | null;
  if (errItem || !row || !row.auditoria) return { error: "No se encontró la diferencia" };
  if (row.revisado_por) return { error: "Esta diferencia ya fue revisada" };

  const { error: errRpc } = await (supabase as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id: row.auditoria.sucursal_id,
    p_fecha:       row.auditoria.fecha,
    p_tipo:        "ajuste",
    p_notas:       "Ajuste aprobado por auditoría diaria",
    p_created_by:  userId,
    p_items: [{
      product_id:      row.product_id,
      cantidad:        row.diferencia,
      precio_unitario: null,
      subtotal:        null,
      promo_id:        null,
    }],
  });
  if (errRpc) return { error: errRpc.message ?? "No se pudo aplicar el ajuste" };

  const { error: errUpdate } = await (supabase as any)
    .from("auditoria_stock_items")
    .update({
      revisado_por:    userId,
      revisado_en:     new Date().toISOString(),
      ajuste_aplicado: true,
      nota_admin:      notaAdmin || null,
    })
    .eq("id", itemId);
  if (errUpdate) return { error: errUpdate.message };

  revalidatePath("/admin/auditoria");
  revalidatePath("/admin/stock");
  revalidatePath(`/admin/sucursales/${row.auditoria.sucursal_id}`);
  return {};
}

export async function marcarRevisadoSinAjustar(itemId: string, notaAdmin?: string): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from("auditoria_stock_items")
    .update({
      revisado_por: userId,
      revisado_en:  new Date().toISOString(),
      nota_admin:   notaAdmin || null,
    })
    .eq("id", itemId)
    .is("revisado_por", null);
  if (error) return { error: error.message };

  revalidatePath("/admin/auditoria");
  return {};
}
