"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff, requireAdmin } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

export interface TransferenciaItemInput {
  product_id: string;
  cantidad:   number;
}

// Enviar (mover mercadería a otro kiosco) está habilitado para cualquiera del
// staff de la sucursal ORIGEN -- admin, encargado o vendedor -- restringido a
// que sea su propia sucursal (mismo criterio que confirmar recepción del lado
// del destino, ver más abajo).
export async function enviarTransferencia(data: {
  sucursal_origen_id:  string;
  sucursal_destino_id: string;
  fecha:               string;
  notas:               string | null;
  items:               TransferenciaItemInput[];
}): Promise<{ error?: string; transferenciaId?: string }> {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  const accesoError = await requireSucursalAccess(supabase, userId, role, data.sucursal_origen_id);
  if (accesoError) return { error: accesoError };

  if (data.sucursal_origen_id === data.sucursal_destino_id) {
    return { error: "La sucursal de origen y destino no pueden ser la misma" };
  }
  if (data.items.length === 0) return { error: "Agregá al menos un producto" };
  if (data.items.some((i) => i.cantidad <= 0)) return { error: "La cantidad debe ser mayor a 0" };

  const { data: destino } = await supabase
    .from("sucursales").select("is_active").eq("id", data.sucursal_destino_id).single();
  if (!destino?.is_active) return { error: "La sucursal destino no está activa" };

  const { data: transferenciaId, error } = await (supabase as any).rpc("enviar_transferencia_stock", {
    p_sucursal_origen_id:  data.sucursal_origen_id,
    p_sucursal_destino_id: data.sucursal_destino_id,
    p_fecha:               data.fecha,
    p_notas:               data.notas,
    p_created_by:          userId,
    p_items:               data.items,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${data.sucursal_origen_id}`);
  revalidatePath(`/admin/sucursales/${data.sucursal_destino_id}`);
  revalidatePath("/admin/stock");
  revalidatePath("/admin/transferencias");
  return { transferenciaId: transferenciaId as string };
}

export interface RecepcionItemInput {
  transferencia_item_id: string;
  cantidad_recibida:     number;
}

// Confirmar recepción lo puede hacer cualquiera del staff del DESTINO
// (vendedor incluido) -- es quien físicamente recibe la mercadería.
export async function confirmarTransferencia(data: {
  transferencia_id: string;
  fecha:            string;
  notas?:           string | null;
  items:            RecepcionItemInput[];
}): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  const { data: transferencia, error: errT } = await supabase
    .from("transferencias_stock")
    .select("sucursal_destino_id, estado, anulada_en")
    .eq("id", data.transferencia_id)
    .single();
  if (errT || !transferencia) return { error: "No se encontró la transferencia" };
  if (transferencia.estado === "recibida") return { error: "Esta transferencia ya fue confirmada" };
  if (transferencia.anulada_en) return { error: "Esta transferencia fue anulada" };

  const accesoError = await requireSucursalAccess(supabase, userId, role, transferencia.sucursal_destino_id);
  if (accesoError) return { error: accesoError };

  if (data.items.length === 0) return { error: "Faltan las cantidades recibidas" };
  if (data.items.some((i) => i.cantidad_recibida < 0)) return { error: "La cantidad recibida no puede ser negativa" };

  const { error } = await (supabase as any).rpc("confirmar_transferencia_stock", {
    p_transferencia_id: data.transferencia_id,
    p_fecha:            data.fecha,
    p_recibido_por:     userId,
    p_notas_recepcion:  data.notas || null,
    p_items:            data.items,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${transferencia.sucursal_destino_id}`);
  revalidatePath("/admin/stock");
  revalidatePath("/admin/transferencias");
  return {};
}

// Anular una transferencia cargada por error -- a diferencia de anular una
// venta (cualquiera del staff de esa sucursal, mientras la caja siga
// abierta), esto lo puede hacer SOLO admin: una transferencia mueve stock
// entre DOS sucursales y no está atada a ningún turno/caja que la acote, así
// que no hay un dueño natural único del lado del staff -- se centraliza en
// admin en vez de repartir el mismo criterio de permisos que enviar/confirmar.
// No borra -- marca (quién, cuándo, motivo obligatorio) y revierte el efecto
// en stock marcando `anulado_en` en el/los movimientos asociados (salida
// siempre, entrada también si ya se había confirmado la recepción) -- mismo
// campo que ya usa `stock_sucursal` para ignorar ventas anuladas, no hace
// falta tocar la view.
export async function anularTransferencia(id: string, motivo: string): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const motivoTrim = motivo?.trim();
  if (!motivoTrim) return { error: "Contá por qué anulás esta transferencia" };

  const { data: transferencia, error: errT } = await supabase
    .from("transferencias_stock")
    .select("sucursal_origen_id, sucursal_destino_id, movimiento_salida_id, movimiento_entrada_id, anulada_en")
    .eq("id", id)
    .single();
  if (errT || !transferencia) return { error: "No se encontró la transferencia" };
  if (transferencia.anulada_en) return { error: "Esta transferencia ya está anulada" };

  const movimientoIds = [transferencia.movimiento_salida_id, transferencia.movimiento_entrada_id]
    .filter((mid): mid is string => !!mid);
  if (movimientoIds.length > 0) {
    const { error: errMov } = await supabase
      .from("movimientos")
      .update({ anulado_en: new Date().toISOString(), anulado_por: userId, motivo_anulacion: motivoTrim })
      .in("id", movimientoIds);
    if (errMov) return { error: errMov.message };
  }

  const { error } = await supabase
    .from("transferencias_stock")
    .update({ anulada_en: new Date().toISOString(), anulada_por: userId, motivo_anulacion: motivoTrim })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${transferencia.sucursal_origen_id}`);
  revalidatePath(`/admin/sucursales/${transferencia.sucursal_destino_id}`);
  revalidatePath("/admin/stock");
  revalidatePath("/admin/movimientos");
  revalidatePath("/admin/transferencias");
  revalidatePath("/admin/dashboard");
  return {};
}
