"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";

// Precio de venta y costo por producto de UNA sucursal -- admin (cualquier
// sucursal) o concesionario (solo la suya). A diferencia de
// actualizarProducto en /admin/productos (que exige cargar el precio de
// TODAS las sucursales activas a la vez, pensado para el catálogo global),
// esto es fila por fila y una sola sucursal -- lo que le faltaba a un
// concesionario para poder vender en su propio local sin depender de que un
// admin le entre a /admin/productos.
async function requireEditRole(sucursalId: string) {
  const { userId, role } = await requireStaff();
  if (role !== "admin" && role !== "concesionario") return { error: "No tenés permisos para editar precios" };
  const admin = createAdminClient();
  const error = await requireSucursalAccess(admin, userId, role, sucursalId);
  if (error) return { error };
  return { admin, userId };
}

export async function actualizarPrecioProducto(data: {
  product_id:  string;
  sucursal_id: string;
  precio_dist: number;
  costo:       number;
}): Promise<{ error?: string }> {
  const check = await requireEditRole(data.sucursal_id);
  if ("error" in check) return { error: check.error };
  const { admin, userId } = check;

  if (!(data.precio_dist > 0)) return { error: "El precio de venta tiene que ser mayor a 0" };
  if (!(data.costo >= 0)) return { error: "El costo no puede ser negativo" };

  const { data: actual } = await admin
    .from("product_prices")
    .select("precio_dist, costo")
    .eq("product_id", data.product_id)
    .eq("sucursal_id", data.sucursal_id)
    .maybeSingle();

  const { error } = await (admin as any).from("product_prices").upsert(
    {
      product_id:  data.product_id,
      sucursal_id: data.sucursal_id,
      precio_dist: data.precio_dist,
      costo:       data.costo,
      updated_by:  userId,
      updated_at:  new Date().toISOString(),
    },
    { onConflict: "product_id,sucursal_id" }
  );
  if (error) return { error: error.message };

  const precioChanged = !actual || actual.precio_dist !== data.precio_dist;
  const costoChanged  = !actual || actual.costo !== data.costo;
  if (precioChanged || costoChanged) {
    await admin.from("product_price_history").insert({
      product_id:           data.product_id,
      sucursal_id:          data.sucursal_id,
      precio_dist_anterior: precioChanged ? (actual?.precio_dist ?? null) : null,
      precio_dist_nuevo:    precioChanged ? data.precio_dist : null,
      costo_anterior:       costoChanged  ? (actual?.costo ?? null) : null,
      costo_nuevo:          costoChanged  ? data.costo : null,
      changed_by:           userId,
    });
  }

  revalidatePath(`/admin/sucursales/${data.sucursal_id}/precios`);
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  return {};
}
