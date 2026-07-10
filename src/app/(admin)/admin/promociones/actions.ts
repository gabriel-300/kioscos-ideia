"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

export interface PromoItemInput {
  product_id: string;
  cantidad:   number;
}

export interface PromoInput {
  name:            string;
  price:           number;
  is_active:       boolean;
  tipo:            "promo" | "receta";
  cover_image_url: string | null;
  items:           PromoItemInput[];
}

export async function crearPromo(data: PromoInput) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { data: promo, error } = await (supabase as any)
    .from("promos")
    .insert({ name: data.name, price: data.price, is_active: data.is_active, tipo: data.tipo, cover_image_url: data.cover_image_url, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (data.items.length > 0) {
    const { error: itemsError } = await (supabase as any)
      .from("promo_items")
      .insert(data.items.map((i) => ({ promo_id: promo.id, product_id: i.product_id, cantidad: i.cantidad })));
    if (itemsError) throw new Error(itemsError.message);
  }

  revalidatePath("/admin/promociones");
}

export async function actualizarPromo(id: string, data: PromoInput) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { error } = await (supabase as any)
    .from("promos")
    .update({ name: data.name, price: data.price, is_active: data.is_active, tipo: data.tipo, cover_image_url: data.cover_image_url, updated_at: new Date().toISOString(), updated_by: userId })
    .eq("id", id);
  if (error) throw new Error(error.message);

  const { error: deleteError } = await (supabase as any).from("promo_items").delete().eq("promo_id", id);
  if (deleteError) throw new Error(deleteError.message);

  if (data.items.length > 0) {
    const { error: itemsError } = await (supabase as any)
      .from("promo_items")
      .insert(data.items.map((i) => ({ promo_id: id, product_id: i.product_id, cantidad: i.cantidad })));
    if (itemsError) throw new Error(itemsError.message);
  }

  revalidatePath("/admin/promociones");
}

export async function eliminarPromo(id: string) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("promos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/promociones");
}

export async function togglePromoActiva(id: string, activa: boolean) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("promos").update({ is_active: !activa, updated_by: userId }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/promociones");
}
