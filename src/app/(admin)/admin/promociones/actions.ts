"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCatalogo, validarFilaEditable } from "@/lib/auth/catalogo-propio";

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
  precios: PrecioSucursalInput[],
  ownerSucursalId: string | null = null
): Promise<string | null> {
  // Promo con dueño (migración 131): precio solo en la sucursal del dueño.
  if (ownerSucursalId) {
    if (precios.length !== 1 || precios[0].sucursal_id !== ownerSucursalId) {
      return "Una promo propia lleva precio solo en la sucursal de su dueño.";
    }
    if (!(precios[0].price > 0)) return "El precio tiene que ser mayor a 0.";
    return null;
  }
  // Los locales independientes con catálogo propio (migración 131) no reciben las promos de IDEIA.
  const { data: sucursales } = await (supabase as any).from("sucursales").select("id, catalogo_propio").eq("is_active", true);
  const idsActivas = new Set(((sucursales ?? []) as { id: string; catalogo_propio?: boolean | null }[]).filter((s) => s.catalogo_propio !== true).map((s) => s.id));
  const idsRecibidas = new Set(precios.map((p) => p.sucursal_id));
  for (const id of idsActivas) {
    if (!idsRecibidas.has(id)) return "Falta el precio de una de las sucursales activas.";
  }
  for (const p of precios) {
    if (!(p.price > 0)) return "El precio tiene que ser mayor a 0 en todas las sucursales.";
  }
  return null;
}

// Los componentes y la categoría de una promo tienen que ser globales o del mismo
// dueño que la promo: si no, se podría armar un combo con productos de otro local.
async function validarReferencias(
  supabase: ReturnType<typeof createAdminClient>,
  data: PromoInput,
  ownerSucursalId: string | null
): Promise<string | null> {
  const productIds = [...new Set(data.items.map((i) => i.product_id))];
  if (productIds.length > 0) {
    const { data: prods } = await (supabase as any).from("products").select("id, owner_sucursal_id").in("id", productIds);
    const dueños = new Map<string, string | null>((prods ?? []).map((p: { id: string; owner_sucursal_id: string | null }) => [p.id, p.owner_sucursal_id]));
    for (const id of productIds) {
      if (!dueños.has(id)) return "Uno de los productos no existe.";
      const o = dueños.get(id)!;
      if (o !== null && o !== ownerSucursalId) return "Uno de los productos pertenece a otro local.";
    }
  }
  if (data.category_id) {
    const { data: cat } = await (supabase as any).from("categories").select("owner_sucursal_id").eq("id", data.category_id).maybeSingle();
    if (!cat) return "La categoría no existe.";
    const o = (cat as { owner_sucursal_id: string | null }).owner_sucursal_id;
    if (o !== null && o !== ownerSucursalId) return "Esa categoría pertenece a otro local.";
  }
  return null;
}

async function ownerDe(supabase: ReturnType<typeof createAdminClient>, id: string): Promise<string | null> {
  const { data } = await (supabase as any).from("promos").select("owner_sucursal_id").eq("id", id).maybeSingle();
  return (data as { owner_sucursal_id: string | null } | null)?.owner_sucursal_id ?? null;
}

export async function crearPromo(data: PromoInput) {
  const { userId, ownerSucursalId } = await requireCatalogo();
  const supabase = createAdminClient();

  const errorPrecios = await validarPreciosCompletos(supabase, data.precios, ownerSucursalId);
  if (errorPrecios) throw new Error(errorPrecios);
  const errorRefs = await validarReferencias(supabase, data, ownerSucursalId);
  if (errorRefs) throw new Error(errorRefs);

  const { data: promo, error } = await (supabase as any)
    .from("promos")
    .insert({ name: data.name, is_active: data.is_active, tipo: data.tipo, cover_image_url: data.cover_image_url, category_id: data.category_id, requiere_termo: data.requiere_termo, created_by: userId, owner_sucursal_id: ownerSucursalId })
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
  const alcance = await requireCatalogo();
  const { userId } = alcance;
  const errorFila = await validarFilaEditable(alcance, "promos", id);
  if (errorFila) throw new Error(errorFila);
  const supabase = createAdminClient();
  const ownerDeFila = await ownerDe(supabase, id);

  const errorPrecios = await validarPreciosCompletos(supabase, data.precios, ownerDeFila);
  if (errorPrecios) throw new Error(errorPrecios);
  const errorRefs = await validarReferencias(supabase, data, ownerDeFila);
  if (errorRefs) throw new Error(errorRefs);

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
  const alcance = await requireCatalogo();
  const errorFila = await validarFilaEditable(alcance, "promos", id);
  if (errorFila) throw new Error(errorFila);
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("promos").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/promociones");
}

export async function togglePromoActiva(id: string, activa: boolean) {
  const alcance = await requireCatalogo();
  const { userId } = alcance;
  const errorFila = await validarFilaEditable(alcance, "promos", id);
  if (errorFila) throw new Error(errorFila);
  const supabase = createAdminClient();
  const { error } = await (supabase as any).from("promos").update({ is_active: !activa, updated_by: userId }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/promociones");
}
