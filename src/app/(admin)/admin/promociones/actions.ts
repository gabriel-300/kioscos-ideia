"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";

export interface PromoItemInput {
  product_id: string;
  cantidad:   number;
}

export interface PrecioSucursalInput {
  sucursal_id: string;
  price:       number;
}

export interface PromoInput {
  name:            string;
  is_active:       boolean;
  tipo:            "promo" | "receta";
  cover_image_url: string | null;
  category_id:     string | null;
  requiere_termo:  boolean;
  items:           PromoItemInput[];
  precios:         PrecioSucursalInput[];
}

// Mismo criterio que productos (ver validarPreciosCompletos en
// productos/actions.ts, migración 059): cada sucursal activa es un negocio
// independiente y tiene que tener SU precio cargado, no hay uno "general".
async function validarPreciosCompletos(
  supabase: ReturnType<typeof createAdminClient>,
  precios: PrecioSucursalInput[]
): Promise<string | null> {
  const { data: sucursales } = await supabase.from("sucursales").select("id").eq("is_active", true);
  const idsActivas = new Set((sucursales ?? []).map((s) => s.id));
  const idsRecibidas = new Set(precios.map((p) => p.sucursal_id));
  for (const id of idsActivas) {
    if (!idsRecibidas.has(id)) return "Falta el precio de una de las sucursales activas.";
  }
  for (const p of precios) {
    if (!(p.price > 0)) return "El precio tiene que ser mayor a 0 en todas las sucursales.";
  }
  return null;
}

export async function crearPromo(data: PromoInput) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const errorPrecios = await validarPreciosCompletos(supabase, data.precios);
  if (errorPrecios) throw new Error(errorPrecios);

  const { data: promo, error } = await (supabase as any)
    .from("promos")
    .insert({ name: data.name, is_active: data.is_active, tipo: data.tipo, cover_image_url: data.cover_image_url, category_id: data.category_id, requiere_termo: data.requiere_termo, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (data.items.length > 0) {
    const { error: itemsError } = await (supabase as any)
      .from("promo_items")
      .insert(data.items.map((i) => ({ promo_id: promo.id, product_id: i.product_id, cantidad: i.cantidad })));
    if (itemsError) throw new Error(itemsError.message);
  }

  const { error: preciosError } = await (supabase as any)
    .from("promo_prices")
    .insert(data.precios.map((p) => ({ promo_id: promo.id, sucursal_id: p.sucursal_id, price: p.price, updated_by: userId })));
  if (preciosError) throw new Error(preciosError.message);

  revalidatePath("/admin/promociones");
}

export async function actualizarPromo(id: string, data: PromoInput) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const errorPrecios = await validarPreciosCompletos(supabase, data.precios);
  if (errorPrecios) throw new Error(errorPrecios);

  const { error } = await (supabase as any)
    .from("promos")
    .update({ name: data.name, is_active: data.is_active, tipo: data.tipo, cover_image_url: data.cover_image_url, category_id: data.category_id, requiere_termo: data.requiere_termo, updated_at: new Date().toISOString(), updated_by: userId })
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

  const { error: preciosError } = await (supabase as any)
    .from("promo_prices")
    .upsert(
      data.precios.map((p) => ({ promo_id: id, sucursal_id: p.sucursal_id, price: p.price, updated_by: userId, updated_at: new Date().toISOString() })),
      { onConflict: "promo_id,sucursal_id" }
    );
  if (preciosError) throw new Error(preciosError.message);

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
