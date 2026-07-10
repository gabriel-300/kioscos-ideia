"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import type { Database } from "@/types/database";

type Insert = Database["public"]["Tables"]["products"]["Insert"];
type Update = Database["public"]["Tables"]["products"]["Update"];

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Traduce errores de constraint únicos de Postgres a mensajes entendibles
function friendlyDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    if (error.message.includes("sku")) {
      return "Ya existe un producto con ese SKU. Elegí otro (puede que se haya sugerido uno repetido si creaste varios productos seguidos sin refrescar la página).";
    }
    if (error.message.includes("slug")) {
      return "Ya existe un producto con ese nombre.";
    }
    return "Ya existe un producto con ese dato (SKU o nombre duplicado).";
  }
  return error.message;
}

export async function crearProducto(data: Omit<Insert, "id" | "created_at" | "updated_at"> & { stock_minimo?: number }): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const baseSlug = data.slug || slugify(data.name) || "producto";
  const { data: existing } = await (supabase as any)
    .from("products")
    .select("slug")
    .like("slug", `${baseSlug}%`);
  const takenSlugs = new Set((existing ?? []).map((p: { slug: string }) => p.slug));
  let slug = baseSlug;
  let suffix = 2;
  while (takenSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }

  const payload = { ...data, slug, created_by: userId };
  const { error } = await (supabase as any).from("products").insert(payload);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin/productos");
  return {};
}

export async function actualizarProducto(id: string, data: (Update & { stock_minimo?: number }) | Record<string, unknown>): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  // Leer precios actuales para detectar cambios
  const { data: current } = await supabase.from("products").select("precio_dist, costo").eq("id", id).single();

  const { error } = await (supabase as any).from("products").update({ ...data, updated_by: userId }).eq("id", id);
  if (error) return { error: friendlyDbError(error) };

  // Registrar historial si algún precio cambió
  if (current) {
    const d = data as Record<string, unknown>;
    const precioChanged = d.precio_dist !== undefined && d.precio_dist !== current.precio_dist;
    const costoChanged  = d.costo      !== undefined && d.costo      !== current.costo;
    if (precioChanged || costoChanged) {
      await (supabase as any).from("product_price_history").insert({
        product_id:           id,
        precio_dist_anterior: precioChanged ? current.precio_dist : null,
        precio_dist_nuevo:    precioChanged ? d.precio_dist       : null,
        costo_anterior:       costoChanged  ? current.costo       : null,
        costo_nuevo:          costoChanged  ? d.costo             : null,
        changed_by:           userId,
      });
    }
  }

  revalidatePath("/admin/productos");
  return {};
}

export async function toggleProductoActivo(id: string, activo: boolean) {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("products")
    .update({ is_active: !activo, updated_by: userId } as Update)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/productos");
}

type CamposPrecio = ("precio_dist" | "costo")[];

export async function ajustarPrecios({
  porcentaje,
  campos,
  categoria_id,
}: {
  porcentaje:   number;
  campos:       CamposPrecio;
  categoria_id: string | null;
}): Promise<{ actualizados: number }> {
  const { userId } = await requireAdmin();
  if (porcentaje === 0 || campos.length === 0) return { actualizados: 0 };

  const supabase = createAdminClient();
  const factor = 1 + porcentaje / 100;

  let query = supabase.from("products").select("id, precio_dist, costo");
  if (categoria_id) query = query.eq("category_id", categoria_id);

  const { data: products, error } = await query;
  if (error) throw new Error(error.message);
  if (!products || products.length === 0) return { actualizados: 0 };

  const updates = products.map((p) => {
    const patch: { id: string } & Partial<Record<typeof campos[number], number>> = { id: p.id };
    for (const campo of campos) {
      const val = p[campo];
      if (val != null) patch[campo] = Math.round(val * factor);
    }
    return patch;
  });

  const errors = (
    await Promise.all(
      updates.map(({ id, ...fields }) =>
        supabase.from("products").update({ ...fields, updated_by: userId } as Update).eq("id", id)
      )
    )
  ).filter((r) => r.error);
  if (errors.length > 0) throw new Error(errors[0].error!.message);

  // Registrar historial de precios para el ajuste masivo
  const historyItems = products
    .filter((p) => campos.some((c) => p[c] != null))
    .map((p) => {
      const patch = updates.find((u) => u.id === p.id)!;
      return {
        product_id:           p.id,
        precio_dist_anterior: campos.includes("precio_dist") && p.precio_dist != null ? p.precio_dist : null,
        precio_dist_nuevo:    campos.includes("precio_dist") && patch.precio_dist != null ? patch.precio_dist : null,
        costo_anterior:       campos.includes("costo") && p.costo != null ? p.costo : null,
        costo_nuevo:          campos.includes("costo") && patch.costo != null ? patch.costo : null,
        changed_by:           userId,
      };
    });
  if (historyItems.length > 0) {
    await (supabase as any).from("product_price_history").insert(historyItems);
  }

  revalidatePath("/admin/productos");
  return { actualizados: products.length };
}

// Para proveedores que facturan al precio de venta al público (ej. panificados):
// el costo no es un monto fijo, es "el precio de venta menos un %". Esto calcula
// costo = precio_dist * (porcentajePago / 100) para toda una categoría de una vez,
// en vez de tener que tipear un costo producto por producto.
export async function costearDesdePrecioVenta({
  porcentajePago,
  categoria_id,
}: {
  porcentajePago: number;
  categoria_id:   string | null;
}): Promise<{ actualizados: number }> {
  const { userId } = await requireAdmin();
  if (porcentajePago <= 0 || porcentajePago > 100) return { actualizados: 0 };

  const supabase = createAdminClient();
  const factor = porcentajePago / 100;

  let query = supabase.from("products").select("id, precio_dist, costo").not("precio_dist", "is", null);
  if (categoria_id) query = query.eq("category_id", categoria_id);

  const { data: products, error } = await query;
  if (error) throw new Error(error.message);
  if (!products || products.length === 0) return { actualizados: 0 };

  const updates = products.map((p) => ({ id: p.id, costo: Math.round((p.precio_dist ?? 0) * factor) }));

  const errors = (
    await Promise.all(
      updates.map(({ id, costo }) => supabase.from("products").update({ costo, updated_by: userId } as Update).eq("id", id))
    )
  ).filter((r) => r.error);
  if (errors.length > 0) throw new Error(errors[0].error!.message);

  const historyItems = products.map((p) => ({
    product_id:           p.id,
    precio_dist_anterior: null,
    precio_dist_nuevo:    null,
    costo_anterior:       p.costo,
    costo_nuevo:          updates.find((u) => u.id === p.id)!.costo,
    changed_by:           userId,
  }));
  await (supabase as any).from("product_price_history").insert(historyItems);

  revalidatePath("/admin/productos");
  return { actualizados: products.length };
}
