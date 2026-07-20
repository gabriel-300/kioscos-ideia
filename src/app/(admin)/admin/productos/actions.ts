"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import type { Database } from "@/types/database";

type Insert = Database["public"]["Tables"]["products"]["Insert"];
type Update = Database["public"]["Tables"]["products"]["Update"];

// Precio y costo dejaron de ser un único valor por producto -- cada sucursal
// tiene el suyo, siempre obligatorio (ver product_prices, migración 059).
export interface PrecioSucursalInput {
  sucursal_id: string;
  precio_dist: number;
  costo: number;
}

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

// Toda sucursal activa necesita su propio precio y costo -- sin fallback.
// Se valida server-side (además del form) porque esto termina resolviendo
// cuánto se cobra en el POS, no alcanza con confiar en la UI.
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
    if (!(p.precio_dist > 0)) return "El precio de venta tiene que ser mayor a 0 en todas las sucursales.";
    if (!(p.costo >= 0)) return "El costo no puede ser negativo.";
  }
  return null;
}

export async function crearProducto(
  data: Omit<Insert, "id" | "created_at" | "updated_at"> & { stock_minimo?: number; precios: PrecioSucursalInput[] }
): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { precios, ...productData } = data;

  const errorPrecios = await validarPreciosCompletos(supabase, precios);
  if (errorPrecios) return { error: errorPrecios };

  const baseSlug = productData.slug || slugify(productData.name) || "producto";
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

  const payload = { ...productData, slug, created_by: userId };
  const { data: nuevo, error } = await (supabase as any).from("products").insert(payload).select("id").single();
  if (error) return { error: friendlyDbError(error) };

  const { error: preciosError } = await supabase.from("product_prices").insert(
    precios.map((p) => ({
      product_id:  nuevo.id as string,
      sucursal_id: p.sucursal_id,
      precio_dist: p.precio_dist,
      costo:       p.costo,
      updated_by:  userId,
    }))
  );
  if (preciosError) return { error: preciosError.message };

  revalidatePath("/admin/productos");
  return {};
}

export async function actualizarProducto(
  id: string,
  data: (Update & { stock_minimo?: number; precios: PrecioSucursalInput[] }) | Record<string, unknown>
): Promise<{ error?: string }> {
  const { userId } = await requireAdmin();
  const supabase = createAdminClient();

  const { precios, ...productData } = data as { precios: PrecioSucursalInput[] } & Record<string, unknown>;

  const errorPrecios = await validarPreciosCompletos(supabase, precios);
  if (errorPrecios) return { error: errorPrecios };

  const { error } = await (supabase as any).from("products").update({ ...productData, updated_by: userId }).eq("id", id);
  if (error) return { error: friendlyDbError(error) };

  // Leer precios actuales por sucursal para detectar cambios y loguear historial
  const { data: actuales } = await supabase
    .from("product_prices")
    .select("sucursal_id, precio_dist, costo")
    .eq("product_id", id);
  const actualPorSucursal = new Map((actuales ?? []).map((a) => [a.sucursal_id, a]));

  const historyItems: Database["public"]["Tables"]["product_price_history"]["Insert"][] = [];
  for (const p of precios) {
    const actual = actualPorSucursal.get(p.sucursal_id);
    const precioChanged = !actual || actual.precio_dist !== p.precio_dist;
    const costoChanged  = !actual || actual.costo !== p.costo;
    if (precioChanged || costoChanged) {
      historyItems.push({
        product_id:           id,
        sucursal_id:          p.sucursal_id,
        precio_dist_anterior: precioChanged ? (actual?.precio_dist ?? null) : null,
        precio_dist_nuevo:    precioChanged ? p.precio_dist : null,
        costo_anterior:       costoChanged  ? (actual?.costo ?? null) : null,
        costo_nuevo:          costoChanged  ? p.costo : null,
        changed_by:           userId,
      });
    }
  }

  const { error: upsertError } = await supabase.from("product_prices").upsert(
    precios.map((p) => ({
      product_id:  id,
      sucursal_id: p.sucursal_id,
      precio_dist: p.precio_dist,
      costo:       p.costo,
      updated_by:  userId,
      updated_at:  new Date().toISOString(),
    })),
    { onConflict: "product_id,sucursal_id" }
  );
  if (upsertError) return { error: upsertError.message };

  if (historyItems.length > 0) {
    await supabase.from("product_price_history").insert(historyItems);
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
  sucursal_id,
  porcentaje,
  campos,
  categoria_id,
}: {
  sucursal_id:  string;
  porcentaje:   number;
  campos:       CamposPrecio;
  categoria_id: string | null;
}): Promise<{ actualizados: number }> {
  const { userId } = await requireAdmin();
  if (porcentaje === 0 || campos.length === 0) return { actualizados: 0 };

  const supabase = createAdminClient();
  const factor = 1 + porcentaje / 100;

  let productIdsFilter: string[] | null = null;
  if (categoria_id) {
    const { data: prods } = await supabase.from("products").select("id").eq("category_id", categoria_id);
    productIdsFilter = (prods ?? []).map((p) => p.id);
    if (productIdsFilter.length === 0) return { actualizados: 0 };
  }

  let query = supabase.from("product_prices").select("id, product_id, precio_dist, costo").eq("sucursal_id", sucursal_id);
  if (productIdsFilter) query = query.in("product_id", productIdsFilter);

  const { data: precios, error } = await query;
  if (error) throw new Error(error.message);
  if (!precios || precios.length === 0) return { actualizados: 0 };

  const updates = precios.map((p) => {
    const patch: { id: string } & Partial<Record<typeof campos[number], number>> = { id: p.id };
    for (const campo of campos) {
      const val = p[campo];
      patch[campo] = Math.round(val * factor);
    }
    return patch;
  });

  const errors = (
    await Promise.all(
      updates.map(({ id, ...fields }) =>
        supabase.from("product_prices").update({ ...fields, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", id)
      )
    )
  ).filter((r) => r.error);
  if (errors.length > 0) throw new Error(errors[0].error!.message);

  const historyItems = precios.map((p) => {
    const patch = updates.find((u) => u.id === p.id)!;
    return {
      product_id:           p.product_id,
      sucursal_id,
      precio_dist_anterior: campos.includes("precio_dist") ? p.precio_dist : null,
      precio_dist_nuevo:    campos.includes("precio_dist") ? patch.precio_dist! : null,
      costo_anterior:       campos.includes("costo") ? p.costo : null,
      costo_nuevo:          campos.includes("costo") ? patch.costo! : null,
      changed_by:           userId,
    };
  });
  await supabase.from("product_price_history").insert(historyItems);

  revalidatePath("/admin/productos");
  return { actualizados: precios.length };
}

// Para proveedores que facturan al precio de venta al público (ej. panificados):
// el costo no es un monto fijo, es "el precio de venta menos un %". Esto calcula
// costo = precio_dist * (porcentajePago / 100) para toda una categoría de una
// sucursal de una vez, en vez de tener que tipear un costo producto por producto.
export async function costearDesdePrecioVenta({
  sucursal_id,
  porcentajePago,
  categoria_id,
}: {
  sucursal_id:    string;
  porcentajePago: number;
  categoria_id:   string | null;
}): Promise<{ actualizados: number }> {
  const { userId } = await requireAdmin();
  if (porcentajePago <= 0 || porcentajePago > 100) return { actualizados: 0 };

  const supabase = createAdminClient();
  const factor = porcentajePago / 100;

  let productIdsFilter: string[] | null = null;
  if (categoria_id) {
    const { data: prods } = await supabase.from("products").select("id").eq("category_id", categoria_id);
    productIdsFilter = (prods ?? []).map((p) => p.id);
    if (productIdsFilter.length === 0) return { actualizados: 0 };
  }

  let query = supabase.from("product_prices").select("id, product_id, precio_dist, costo").eq("sucursal_id", sucursal_id);
  if (productIdsFilter) query = query.in("product_id", productIdsFilter);

  const { data: precios, error } = await query;
  if (error) throw new Error(error.message);
  if (!precios || precios.length === 0) return { actualizados: 0 };

  const updates = precios.map((p) => ({ id: p.id, costo: Math.round(p.precio_dist * factor) }));

  const errors = (
    await Promise.all(
      updates.map(({ id, costo }) => supabase.from("product_prices").update({ costo, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", id))
    )
  ).filter((r) => r.error);
  if (errors.length > 0) throw new Error(errors[0].error!.message);

  const historyItems = precios.map((p) => ({
    product_id:           p.product_id,
    sucursal_id,
    precio_dist_anterior: null,
    precio_dist_nuevo:    null,
    costo_anterior:       p.costo,
    costo_nuevo:          updates.find((u) => u.id === p.id)!.costo,
    changed_by:           userId,
  }));
  await supabase.from("product_price_history").insert(historyItems);

  revalidatePath("/admin/productos");
  return { actualizados: precios.length };
}
