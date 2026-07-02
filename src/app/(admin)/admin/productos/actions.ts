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

export async function crearProducto(data: Omit<Insert, "id" | "created_at" | "updated_at"> & { stock_minimo?: number }) {
  await requireAdmin();
  const supabase = createAdminClient();
  const payload = { ...data, slug: data.slug || slugify(data.name) };
  const { error } = await (supabase as any).from("products").insert(payload);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/productos");
}

export async function actualizarProducto(id: string, data: (Update & { stock_minimo?: number }) | Record<string, unknown>) {
  await requireAdmin();
  const supabase = createAdminClient();

  // Leer precios actuales para detectar cambios
  const { data: current } = await supabase.from("products").select("precio_dist, costo").eq("id", id).single();

  const { error } = await (supabase as any).from("products").update(data).eq("id", id);
  if (error) throw new Error(error.message);

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
      });
    }
  }

  revalidatePath("/admin/productos");
}

export async function toggleProductoActivo(id: string, activo: boolean) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("products")
    .update({ is_active: !activo })
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
  await requireAdmin();
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
        supabase.from("products").update(fields as Update).eq("id", id)
      )
    )
  ).filter((r) => r.error);
  if (errors.length > 0) throw new Error(errors[0].error!.message);

  revalidatePath("/admin/productos");
  return { actualizados: products.length };
}
