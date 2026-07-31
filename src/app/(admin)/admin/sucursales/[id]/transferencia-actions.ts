"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";

export interface TransferenciaItemInput {
  product_id: string;
  cantidad:   number;
}

// Enviar es de encargado/admin (decisión de mover mercadería entre kioscos) --
// vendedor no, a pedido explícito del usuario.
export async function enviarTransferencia(data: {
  sucursal_origen_id:  string;
  sucursal_destino_id: string;
  fecha:               string;
  notas:               string | null;
  items:               TransferenciaItemInput[];
}): Promise<{ error?: string; transferenciaId?: string }> {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  if (role === "vendedor") return { error: "No tenés permisos para enviar transferencias" };
  if (role === "encargado") {
    const { data: suc } = await supabase
      .from("sucursales").select("encargado_user_id").eq("id", data.sucursal_origen_id).single();
    if (suc?.encargado_user_id !== userId) return { error: "No tenés permisos para esta sucursal" };
  }

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
    .select("sucursal_destino_id, estado")
    .eq("id", data.transferencia_id)
    .single();
  if (errT || !transferencia) return { error: "No se encontró la transferencia" };
  if (transferencia.estado === "recibida") return { error: "Esta transferencia ya fue confirmada" };

  if (role === "encargado") {
    const { data: suc } = await supabase
      .from("sucursales").select("encargado_user_id").eq("id", transferencia.sucursal_destino_id).single();
    if (suc?.encargado_user_id !== userId) return { error: "No tenés permisos para esta sucursal" };
  }
  if (role === "vendedor") {
    const profileRes = await (supabase as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== transferencia.sucursal_destino_id) return { error: "No tenés permisos para esta sucursal" };
  }

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
