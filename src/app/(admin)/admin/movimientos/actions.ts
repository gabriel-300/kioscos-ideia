"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth/require-role";

export interface ItemInput {
  product_id:      string;
  cantidad:        number;
  precio_unitario: number | null;
}

export async function crearMovimiento(data: {
  sucursal_id:       string;
  fecha:             string;
  tipo:              "entrega" | "devolucion" | "ajuste" | "venta";
  notas:             string | null;
  items:             ItemInput[];
  proveedor?:        string | null;
  nro_remito?:       string | null;
  remito_image_url?: string | null;
  canal?:            string | null;
  personal_id?:      string | null;
  pago_efectivo?:      number | null;
  pago_billetera?:     number | null;
  pago_tarjeta?:       number | null;
  pago_transferencia?: number | null;
}) {
  const { userId, role } = await requireStaff();
  const supabase         = createAdminClient();

  // Encargados no pueden hacer ajustes de stock
  if (role === "encargado" && data.tipo === "ajuste") {
    throw new Error("No tenés permisos para realizar ajustes de stock");
  }

  // Encargados y vendedores solo pueden registrar en su propia sucursal
  if (role === "encargado") {
    const { data: suc } = await supabase
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", data.sucursal_id)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }
  if (role === "vendedor") {
    const profileRes = await (supabase as any)
      .from("profiles")
      .select("sucursal_id")
      .eq("id", userId)
      .single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== data.sucursal_id) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  const items = data.items.map((item) => ({
    product_id:      item.product_id,
    cantidad:        item.cantidad,
    precio_unitario: item.precio_unitario ?? null,
    subtotal:        item.precio_unitario != null ? item.cantidad * item.precio_unitario : null,
  }));

  const rpcRes = await (supabase as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id:        data.sucursal_id,
    p_fecha:              data.fecha,
    p_tipo:               data.tipo,
    p_notas:              data.notas              ?? null,
    p_proveedor:          data.proveedor          ?? null,
    p_nro_remito:         data.nro_remito         ?? null,
    p_canal:              data.canal              ?? "consumidor_final",
    p_personal_id:        data.personal_id        ?? null,
    p_pago_efectivo:      data.pago_efectivo      ?? null,
    p_pago_billetera:     data.pago_billetera     ?? null,
    p_pago_tarjeta:       data.pago_tarjeta       ?? null,
    p_pago_transferencia: data.pago_transferencia ?? null,
    p_created_by:         userId,
    p_items:              items,
  });

  if (rpcRes.error) throw new Error(rpcRes.error.message ?? "Error al crear movimiento");

  // Asociar imagen si se proporcionó — intentamos con el ID devuelto por la función
  if (data.remito_image_url) {
    const newId = typeof rpcRes.data === "string" ? rpcRes.data : null;
    if (newId) {
      await (supabase as any).from("movimientos").update({ remito_image_url: data.remito_image_url }).eq("id", newId);
    } else {
      // Fallback: actualizar el movimiento más reciente con los mismos parámetros
      const { data: recent } = await (supabase as any)
        .from("movimientos").select("id")
        .eq("sucursal_id", data.sucursal_id).eq("tipo", data.tipo).eq("fecha", data.fecha)
        .order("created_at", { ascending: false }).limit(1).single();
      if (recent?.id) {
        await (supabase as any).from("movimientos").update({ remito_image_url: data.remito_image_url }).eq("id", recent.id);
      }
    }
  }

  revalidatePath("/admin/movimientos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/sucursales");
  revalidatePath("/admin/stock");
}

export async function eliminarMovimiento(id: string) {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: mov } = await supabase
    .from("movimientos")
    .select("sucursal_id")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("movimientos").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/movimientos");
  if (mov?.sucursal_id) {
    revalidatePath(`/admin/sucursales/${mov.sucursal_id}`);
    revalidatePath("/admin/stock");
  }
}
