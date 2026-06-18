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
  sucursal_id: string;
  fecha:       string;
  tipo:        "entrega" | "devolucion" | "ajuste" | "venta";
  notas:       string | null;
  items:       ItemInput[];
}) {
  const { userId, role } = await requireStaff();
  const supabase         = createAdminClient();

  // Encargados solo pueden registrar movimientos en su propia sucursal
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

  const { data: mov, error } = await supabase
    .from("movimientos")
    .insert({
      sucursal_id: data.sucursal_id,
      fecha:       data.fecha,
      tipo:        data.tipo,
      notas:       data.notas,
      created_by:  userId,
    })
    .select("id")
    .single();

  if (error || !mov) throw new Error(error?.message ?? "Error al crear movimiento");

  const items = data.items.map((item) => ({
    movimiento_id:   mov.id,
    product_id:      item.product_id,
    cantidad:        item.cantidad,
    precio_unitario: item.precio_unitario,
    subtotal:        item.precio_unitario != null ? item.cantidad * item.precio_unitario : null,
  }));

  const { error: itemsError } = await supabase.from("movimiento_items").insert(items);
  if (itemsError) {
    await supabase.from("movimientos").delete().eq("id", mov.id);
    throw new Error(itemsError.message);
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
